// Google Play Billing arrives through one line in android/app/build.gradle.kts:
//
//     implementation("com.android.billingclient:billing:7.1.1")
//
// It is in place. Written down here because no other file in the app names a
// billing type, so from anywhere but this one that line looks unused — and an
// unused-looking dependency is what a tidy-up deletes. Pinned to 7.x on
// purpose: Billing 8.0 changed queryProductDetailsAsync's callback from a
// MutableList<ProductDetails> to a QueryProductDetailsResult, so raising the
// number is a rewrite of catalogue() rather than a version bump. The
// <uses-permission com.android.vending.BILLING> the Play Store wants comes
// from the library's own manifest; it does not need adding.

package com.moneymove.game

import android.app.Activity
import android.app.Application
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.security.MessageDigest

/** One coin pack, as the shop draws it. No billing type reaches a screen. */
data class CoinPackOffer(
    /** The server's own id — 'coins.small'. What the ledger writes down. */
    val packId: String,
    /** Play's id, and Apple's. See [BUILT_IN] for why they are the same. */
    val productId: String,
    val coins: Int,
    val name: String,
    /**
     * Play's price for this phone, in this phone's currency, once Play has
     * answered. Null before that, and null forever on a device that cannot
     * buy — which is the signal a row should not be tappable.
     */
    val price: String? = null,
)

/**
 * The three packs, as the app itself knows them.
 *
 * Deliberately not read from /api/store. The server is not allowed to decide
 * whether the shop exists: this one sleeps on a free plan and can take most
 * of a minute to wake, and the iOS build that hid the whole "Get coins"
 * section while it waited looked, to a reviewer, like an app pointing at an
 * empty store. The served copy is still worth merging in for names and
 * bonuses — it just cannot be the thing the shop needs in order to appear.
 *
 * The product ids are Apple's ids too, on purpose: one packByProductId() in
 * server/store.js answers for both stores, and a second set of ids would be a
 * second thing to keep in step for no gain.
 */
private val BUILT_IN = listOf(
    CoinPackOffer("coins.small", "com.moneymove.game.coins.small", 500, "Pocket change"),
    CoinPackOffer("coins.mid", "com.moneymove.game.coins.mid", 1100, "Deep pockets"),
    CoinPackOffer("coins.large", "com.moneymove.game.coins.large", 2500, "Tycoon chest"),
)

private const val TAG = "MMBilling"

/**
 * Coin packs, bought through Google Play.
 *
 * The Android half of ios/MoneyMove/CoinShop.swift, and the same rule holds:
 * nothing here ever mints a coin. Play hands the app an opaque purchase
 * token, the server asks Google about it (server/playstore.js), and the
 * balance is then re-read from the wallet endpoint. A client that could move
 * its own coin counter is a client that can be asked to move it by somebody
 * who is not the server.
 *
 * WHAT THE OWNER STILL HAS TO DO before a single coin can be bought:
 *
 *  1. Create the app in the Play Console under `com.moneymove.game` and get a
 *     signed build onto a track. In-app products are invisible — and
 *     queryProductDetailsAsync comes back empty — until Play has seen a build.
 *  2. Create three managed (one-time) products with exactly the ids in
 *     [BUILT_IN], priced to match COIN_PACKS in server/store.js, and activate
 *     them. An id that does not match is a pack that cannot be bought and a
 *     redemption the server answers "Unknown product" to.
 *  3. Give the server its service-account key: PLAY_SERVICE_ACCOUNT, a JSON
 *     key from the Cloud project the Console is linked to, with the Android
 *     Publisher API on and "View financial data" granted. server/playstore.js
 *     reads it; without it every redemption is refused, correctly, and this
 *     class hands out nothing.
 *  4. Test with a licence-tester account on an internal-testing track. A
 *     debug build signed with the debug key is a build Play has never heard
 *     of, and the shop will be empty on it however right the code is.
 *
 * Play's callbacks do not promise a thread and Compose state does not forgive
 * being written from the wrong one, so everything this class shows goes
 * through the view-model scope, which is the main one.
 */
class Billing(app: Application) : AndroidViewModel(app) {

    private val prefs = Prefs(app)
    private val api get() = Api(prefs.server, prefs.token)

    /** The shelf. Prices fill in when Play answers; the rows exist before that. */
    var offers: List<CoinPackOffer> by mutableStateOf(BUILT_IN)
        private set

    /** Play answered with real products — the rows can actually be tapped. */
    var onSale: Boolean by mutableStateOf(false)
        private set

    /** The pack with a purchase flow in the air, so its card can wait. */
    var buying: String? by mutableStateOf(null)
        private set

    /** The last thing that went wrong, for the one line a screen shows. */
    var notice: String? by mutableStateOf(null)

    private var client: BillingClient? = null
    private var connecting = false
    private var details: Map<String, ProductDetails> = emptyMap()

    /**
     * Where a granted pack goes. Held plainly rather than weakly: both are
     * view models on the same activity's store, so neither can outlive the
     * other and there is nothing here to leak.
     */
    private var account: AccountStore? = null

    /** Purchase tokens being settled right now — see [settle]. */
    private val settling = mutableSetOf<String>()

    /**
     * Every branch here has to end with the card released or with a [settle]
     * that will release it, because the shop disables *every* pack's button
     * while [buying] is set. A branch that forgets is not one stuck card — it
     * is a shop that cannot be bought from again until the app is killed.
     */
    private val updates = PurchasesUpdatedListener { result, purchases ->
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                // Play is allowed to answer OK holding nothing, and then there
                // is no settle coming to hand the card back.
                val bought = purchases.orEmpty()
                if (bought.isEmpty()) release() else bought.forEach { settle(it) }
            }
            BillingClient.BillingResponseCode.USER_CANCELED ->
                // Walking out of Play's sheet is not an error and does not
                // get a message; it gets the card back.
                release()
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> {
                // Bought once and never consumed, because the grant did not
                // land last time. The money is already gone, so the answer is
                // to finish that purchase rather than to sell a second one.
                //
                // The card comes back now rather than when the sweep lands,
                // because the sweep can come back empty — the unconsumed
                // purchase can be sitting on a different Google account in
                // this profile — and then nothing would ever unstick it.
                // Tapping again just arrives here a second time, and
                // [settling] keeps the server from being told twice.
                sweep()
                release()
            }
            else -> {
                Log.w(TAG, "purchase failed: ${result.responseCode} ${result.debugMessage}")
                note("That purchase didn't go through.")
                release()
            }
        }
    }

    /**
     * Open the shop. Safe to call on every visit: a live connection is reused
     * and only the catalogue and the sweep are redone.
     *
     * Worth calling once from the activity as well, not only from the shop
     * screen. [sweep] is how a purchase that was paid for but never credited
     * gets a second chance, and hanging that off a visit to the shop means
     * the one player who most needs it — the one whose coins never arrived —
     * only gets it if they go back and look.
     */
    fun start(account: AccountStore) {
        this.account = account
        connect()
    }

    /**
     * Buy one pack.
     *
     * Needs the Activity because Play's sheet is a real activity result;
     * nothing else in this class does, which is why it is a parameter rather
     * than something held.
     */
    fun buy(activity: Activity, packId: String) {
        if (buying != null) return
        val pack = BUILT_IN.firstOrNull { it.packId == packId } ?: return
        val product = details[pack.productId]
        if (product == null) {
            // Either Play has not answered yet or it has nothing to sell on
            // this device. Reconnecting costs nothing and is the only way to
            // find out which before the next tap.
            note("That pack isn't on sale on this device.")
            connect()
            return
        }
        buying = packId
        val flow = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(
                listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(product)
                        .build(),
                ),
            )
            // Play's fraud checks want to know that two purchases came from
            // the same player. They must not be told who that player is: the
            // profile token is a password — it opens the wallet, the friend
            // code and the seat a reconnect walks back into — so what Google
            // gets is a hash of it and never the thing itself.
            .setObfuscatedAccountId(accountHash())
            .build()
        val result = client?.launchBillingFlow(activity, flow)
        if (result?.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(TAG, "flow refused: ${result?.responseCode} ${result?.debugMessage}")
            buying = null
            note("Google Play wouldn't open that purchase.")
        }
    }

    // ── the connection ─────────────────────────────────────────────────────

    private fun connect() {
        if (client?.isReady == true) {
            catalogue()
            sweep()
            return
        }
        if (connecting) return
        connecting = true
        val c = client ?: BillingClient.newBuilder(getApplication<Application>())
            .setListener(updates)
            // A coin pack can be bought by a method that settles later —
            // ask-to-buy, or cash at a counter — and Play refuses to build a
            // client that has not said it understands that.
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder().enableOneTimeProducts().build(),
            )
            .build()
        client = c
        c.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                connecting = false
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    catalogue()
                    sweep()
                } else {
                    // A phone with no Play Store on it, a work profile that
                    // forbids buying, or a build Play has never seen.
                    Log.w(TAG, "setup failed: ${result.responseCode} ${result.debugMessage}")
                    note("Google Play isn't available on this device.")
                }
            }

            override fun onBillingServiceDisconnected() {
                connecting = false
                // Play drops this connection as a matter of routine. The next
                // tap reconnects; retrying in a loop here would be a loop on
                // a phone that has no Play Store to reconnect to at all.
            }
        })
    }

    /**
     * What the three packs cost, in this phone's money.
     *
     * Only ever Play's own localised price. A hard-coded dollar figure is
     * wrong in every country but one, and printed on a row that cannot be
     * tapped it reads as a shop that is broken rather than one that is shut.
     */
    private fun catalogue() {
        val c = client ?: return
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                BUILT_IN.map {
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(it.productId)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()
                },
            )
            .build()
        c.queryProductDetailsAsync(params) { result, found ->
            viewModelScope.launch {
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    Log.w(TAG, "catalogue failed: ${result.responseCode} ${result.debugMessage}")
                    return@launch
                }
                details = found.associateBy { it.productId }
                onSale = details.isNotEmpty()
                offers = BUILT_IN.map { pack ->
                    pack.copy(
                        price = details[pack.productId]
                            ?.oneTimePurchaseOfferDetails
                            ?.formattedPrice,
                    )
                }
                if (found.isEmpty()) {
                    // Almost always step 1 or 2 of the list at the top of this
                    // file rather than anything the player did.
                    Log.w(TAG, "Play has no products for these ids on this build")
                }
            }
        }
    }

    /**
     * Everything Play still believes this player owns.
     *
     * A coin pack should never survive a launch — it is consumed the moment
     * the server has paid it out — so anything found here is a purchase that
     * did not finish: the app died between paying and crediting, or the
     * server was unreachable at the one moment it mattered. The money has
     * already left either way, so it is asked about again on every connect
     * until it lands or Google refunds it.
     */
    private fun sweep() {
        val c = client ?: return
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP)
            .build()
        c.queryPurchasesAsync(params) { result, purchases ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) return@queryPurchasesAsync
            purchases.forEach { settle(it) }
        }
    }

    // ── turning a purchase into coins ──────────────────────────────────────

    /**
     * Hand one purchase to the server, and only then let Play forget it.
     *
     * The order is the whole of this method. Consuming is what makes a
     * purchase token stop existing: it is how the same pack becomes buyable
     * again, and it is also the last moment anything can be retried with.
     * Consume before the server has said yes and a server that was asleep —
     * or that has no Play service account yet — has cost the player real
     * money for nothing, with no token left to try again with. It is the
     * same mistake as claiming the ad reward before the ad: the irreversible
     * step goes last.
     *
     * The listener and the sweep can both arrive holding the same purchase,
     * so [settling] makes sure only one of them is talking to the server
     * about it.
     */
    private fun settle(purchase: Purchase) = viewModelScope.launch {
        val productId = purchase.products.firstOrNull().orEmpty()
        val pack = BUILT_IN.firstOrNull { it.productId == productId }

        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) {
            if (purchase.purchaseState == Purchase.PurchaseState.PENDING) {
                // Ask-to-buy, and the payment methods that settle at a
                // counter. Nothing is owed until Play says it completed, and
                // when it does the purchase comes back through the sweep.
                notice = "Waiting on approval for that purchase."
            }
            if (buying == pack?.packId) buying = null
            return@launch
        }
        if (!settling.add(purchase.purchaseToken)) return@launch

        try {
            // The names server/index.js actually reads at /api/store/redeem/play
            // are `productId` and `purchaseToken`; `token` is added by
            // Api.post. Getting one of these wrong is not a visible failure —
            // it is "Missing purchase details" and a player who paid.
            val body = api.post(
                "/api/store/redeem/play",
                mapOf("productId" to productId, "purchaseToken" to purchase.purchaseToken),
            )
            val reply = body
                ?.let { runCatching { MMJson.parseToJsonElement(it) }.getOrNull() }
                .obj()

            if (!reply.flag("ok")) {
                // Left unconsumed and unacknowledged on purpose. Google
                // refunds a purchase nobody acknowledges within three days,
                // so the worst this costs the player is a wait for their own
                // money back — which is the right worst case for a shop that
                // cannot prove what it just sold. Every [start] tries again.
                //
                // The shared Api swallows the body of a non-2xx answer, so
                // the server's own wording ("Google Play purchases cannot be
                // verified on this server yet", and the rest) cannot be shown
                // here; this line has to stand on its own.
                Log.w(TAG, "grant refused for $productId")
                notice = reply?.get("error").asString()
                    ?: "Couldn't reach the coin vault — we'll try again."
                return@launch
            }

            // Past the server's word, and only now. Consuming is what lets
            // this pack be bought a second time.
            consume(purchase)

            // Re-read rather than added to. The balance is the server's to
            // state; this only asks it again.
            account?.refreshStore()

            // `duplicate` is the server saying it had already paid this order
            // out and is answering ok so the client stops retrying. The coins
            // are right either way — what it changes is whether this moment
            // is worth a sound, and a purchase being settled for the second
            // time is not.
            if (!reply.flag("duplicate")) {
                SoundKit.cash()
                Haptics.tap()
            }

            // Cleared, never written to. [notice] is the failure line — the
            // shop paints it in the bad colour — so a cheerful sentence put
            // there reads as something having gone wrong at the exact moment
            // the player's money left, and a coin counter jumping by five
            // hundred under a cash sound says it better anyway. Clearing is
            // the part that matters: the red line from the attempt that
            // failed must not sit under the one that worked.
            notice = null
        } finally {
            settling.remove(purchase.purchaseToken)
            if (buying == pack?.packId) buying = null
        }
    }

    /**
     * Tell Play the pack was handed over.
     *
     * A refusal here is not fatal and deliberately does not reach the player:
     * the coins are already in the wallet. The token simply stays live, the
     * next sweep finds it, and creditPurchase answers `duplicate` rather than
     * paying a second time — the order id it writes down is what makes that
     * safe to repeat.
     */
    private fun consume(purchase: Purchase) {
        val params = ConsumeParams.newBuilder()
            .setPurchaseToken(purchase.purchaseToken)
            .build()
        client?.consumeAsync(params) { result, _ ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                Log.w(TAG, "consume refused: ${result.responseCode} ${result.debugMessage}")
            }
        }
    }

    // ── plumbing ───────────────────────────────────────────────────────────

    private fun note(text: String) = viewModelScope.launch { notice = text }

    /** Give the shop its buttons back. See [updates] for why this is its own thing. */
    private fun release() = viewModelScope.launch { buying = null }

    /** SHA-256 hex is 64 characters, which is exactly what Play allows here. */
    private fun accountHash(): String =
        MessageDigest.getInstance("SHA-256")
            .digest(prefs.token.toByteArray())
            .joinToString("") { "%02x".format(it) }

    override fun onCleared() {
        client?.endConnection()
        client = null
        super.onCleared()
    }
}

/** A JSON boolean that is only true when the server actually wrote one. */
private fun JsonObject?.flag(name: String): Boolean =
    (this?.get(name) as? JsonPrimitive)?.booleanOrNull == true
