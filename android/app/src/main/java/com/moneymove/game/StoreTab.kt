package com.moneymove.game

import android.app.Activity
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The shop, laid out the way the iPhone lays out its Store tab: the title and
 * the purse, one line on where coins come from, the coin packs, and then every
 * shelf at once — pieces, faces, boards — one under the other.
 *
 * Every shelf at once, not a row of buttons choosing one. The owner held the
 * two phones side by side, and a shop that hides two thirds of itself behind
 * a toggle is a different shop from one you can scroll.
 *
 * Everything on it is style. Coins buy a piece to push round the board, a face
 * for the chip beside your name, and a game on a board somebody else paid to
 * make — never an advantage, because a board game you can buy your way
 * through is not a board game anybody wants to lose at fairly. That is said
 * out loud under the title rather than left to be discovered, because it is
 * the one thing a player wants to know before they read a price.
 *
 * The daily reward and the watch-an-ad offer are not here. iOS keeps both on
 * the Play tab, and so does this app; the Store is where coins are spent.
 */
@Composable
fun StoreTab(store: AccountStore, billing: Billing) {
    val p = P.current
    // The toast layer is GameStore's and sits over every tab, so the shop
    // speaks through it the way iOS's does, instead of parking a red line at
    // the foot of a page nobody has scrolled to the bottom of.
    val game: GameStore = viewModel()
    val items = store.store?.items.orEmpty()

    // iOS's storeFailed: AccountStore says the moment a catalogue fetch comes
    // back empty-handed with nothing cached, and Try again asks again.
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) { store.refreshStore() }
    val gaveUp = store.storeFailed && store.store == null

    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // iOS's tabPage: eighteen between the pieces, twenty off the top, and
        // no wider than 560 so a tablet reads as a column rather than a banner.
        Column(
            Modifier
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f).padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text("Store", color = p.ink, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold)
                    Text(
                        "Win games, earn coins, dress your piece.",
                        color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.Medium,
                    )
                }
                CoinChip(store.coins, Modifier.padding(top = 10.dp))
            }

            // What the server actually pays: the daily ladder runs one coin to
            // seven, a win is worth two and a runner-up one. Promising fifty a
            // game would make every price on this page read as a rip-off the
            // first time somebody won and counted.
            Text(
                "Collect your daily coins, and take a couple more for every game you win. " +
                    "Everything here is pure style — never pay-to-win.",
                modifier = Modifier.fillMaxWidth(),
                color = p.ink3, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium,
            )

            CoinPacks(store, billing, game)

            if (items.isEmpty()) {
                ShopPlaceholder(failed = gaveUp) { attempt++ }
            } else {
                Shelf(store, game, items, "dice", "Token skins", "Your piece on the board.", "token")
                Shelf(store, game, items, "people", "Avatars", "Your face in the player chip.", "avatar")
                // Boards are the one thing in this shop that is not a costume,
                // so they get a shelf that shows the board rather than an emoji.
                BoardStoreShelf(store, game)
            }
        }
    }
}

/** How long Google Play gets to name its prices before the packs say so. */
private const val PLAY_PATIENCE_MS = 8_000L

/** Billing's own words for a phone with no Play Store to ask. */
private const val PLAY_MISSING = "Google Play isn't available on this device."

/** Billing's own words for a purchase parked on somebody's approval. */
private const val PLAY_PENDING = "Waiting on approval for that purchase."

/**
 * iOS's store purse: the coin and the count beside it, in a capsule of glass.
 *
 * It is the one piece of glass on this page. Everything else here is what
 * people came to look at — the packs, the shelves, the boards — and stays
 * paper; the purse is the page's own chrome, so it floats over the page
 * rather than being printed on it.
 *
 * The brass moves out of the capsule and into the light. The gold capsule it
 * was becomes the film, which already carries the table's brass, and the rim,
 * which is brass on every table. The count goes into the glass's own ink
 * ([labelInk]), as iOS's purse and the web's print theirs: the raw gold on
 * the material measures as little as 3.2:1 on a daylight table, and the coin
 * beside the number is brass by its own drawing, so the purse still reads as
 * gold without the number having to be. Being one of the fixed-colour
 * glyphs, the coin is also why this is Regular glass and never Clear.
 *
 * Flat, as a button in the page is ([Embedded]): the purse scrolls with the
 * page, so nothing ever slides beneath it, and the page's blurred copy is
 * recorded from the very content it sits in, which would be sampling last
 * frame's picture of itself. What is behind it is the page's own ramp, and a
 * blur hands a linear ramp straight back, so dropping it costs nothing
 * anybody can see. No tint, either: a tint marks the one thing on screen that
 * is primary, and a gold wash on the purse reads as a button that is not
 * there.
 */
@Composable
private fun CoinChip(coins: Int, modifier: Modifier = Modifier) {
    val glass = rememberGlassSurface(BackdropKind.Page)
    Embedded(LocalGlassLightAngle.current) {
        Row(
            modifier
                .mmGlass(
                    backdrop = BackdropKind.Page,
                    shape = MMShapes.pill,
                    lens = false,
                    shadow = GlassShadow.Relaxed,
                )
                .padding(horizontal = 13.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon("coin", size = 17.dp)
            Spacer(Modifier.width(5.dp))
            Text("$coins", color = glass.labelInk(), fontSize = 17.sp, fontWeight = FontWeight.ExtraBold)
        }
    }
}

/** iOS's PanelTitle: small capitals, one point apart, in the quietest ink. */
@Composable
private fun PanelTitle(text: String) {
    Text(
        text.uppercase(),
        color = P.current.ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
    )
}

/**
 * The shelves take a moment to arrive, and they can fail. Either way the tab
 * has to say so — an empty Store reads as "nothing for sale".
 */
@Composable
private fun ShopPlaceholder(failed: Boolean, onRetry: () -> Unit) {
    val p = P.current
    LandingCard(padding = 18.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (failed) {
                OfflineMark(p.bad, 15.dp)
                Spacer(Modifier.width(10.dp))
                Text(
                    "Couldn't load the shop.",
                    color = p.ink2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(6.dp))
                LandingButton("Try again", LandingKind.GHOST) { onRetry() }
            } else {
                LandingSpinner(p.red)
                Spacer(Modifier.width(10.dp))
                Text(
                    "Loading the shop…",
                    color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/**
 * iOS's wifi.exclamationmark, drawn: three rings of signal and a warning
 * stroke beside them, in the table's "bad" ink. The drawn set has no signal
 * glyph, and its warning triangle keeps a yellow of its own where iOS shows
 * red — so the mark is made here, in the shop's own file, from strokes.
 */
@Composable
private fun OfflineMark(tint: Color, size: Dp) {
    Canvas(Modifier.size(size)) {
        val s = this.size.minDimension
        val stroke = s * 0.11f
        val hub = Offset(s * 0.40f, s * 0.84f)
        for (r in listOf(0.18f, 0.35f, 0.52f)) {
            val radius = s * r
            drawArc(
                tint,
                startAngle = 225f,
                sweepAngle = 90f,
                useCenter = false,
                topLeft = Offset(hub.x - radius, hub.y - radius),
                size = Size(radius * 2, radius * 2),
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
        }
        drawCircle(tint, radius = stroke * 0.8f, center = hub)
        val bang = s * 0.92f
        drawLine(tint, Offset(bang, s * 0.2f), Offset(bang, s * 0.58f), strokeWidth = stroke, cap = StrokeCap.Round)
        drawCircle(tint, radius = stroke * 0.65f, center = Offset(bang, s * 0.82f))
    }
}

// ────────────────────────────────────────────────────────────── coin packs ──

/**
 * Paid top-ups. The packs are always listed — the app knows all three without
 * asking anybody — and whether they can be bought is Google Play's answer,
 * shown honestly: checking, on sale, or a Try again.
 *
 * Prices come from Play rather than from this app, because a price written
 * here would be wrong in every country but one — Play knows what this player
 * actually pays and in which currency.
 */
@Composable
private fun CoinPacks(store: AccountStore, billing: Billing, game: GameStore) {
    val p = P.current
    val activity = LocalContext.current as? Activity

    // Play has no "I looked and there was nothing" signal that reaches this
    // screen, so the same fair wait the catalogue gets stands in for iOS's
    // `failed`: past it, with nothing on sale, the line offers a Try again
    // instead of checking forever. A phone with no Play Store says so at once.
    var attempt by remember { mutableIntStateOf(0) }
    var waited by remember { mutableStateOf(false) }
    LaunchedEffect(attempt) {
        waited = false
        billing.start(store)
        delay(PLAY_PATIENCE_MS)
        waited = true
    }

    // What Billing has to say goes up as a toast, as iOS's CoinShop says it:
    // the pending note plainly, everything else as the failure it is.
    LaunchedEffect(billing.notice) {
        val said = billing.notice ?: return@LaunchedEffect
        if (said == PLAY_MISSING) waited = true
        game.showToast(said, isError = said != PLAY_PENDING)
        billing.notice = null
    }

    // iOS toasts "Coins added" once the server has credited the pack. Billing
    // keeps that moment to itself, so the purse is watched instead: a balance
    // that rises by at least the pack's coins after a tap is that moment.
    var awaiting by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    LaunchedEffect(store.coins, awaiting) {
        val (before, worth) = awaiting ?: return@LaunchedEffect
        if (store.coins >= before + worth) {
            awaiting = null
            game.showToast("Coins added — go spend them.", glyph = "coin")
        }
    }
    LaunchedEffect(billing.buying) {
        // Walked out of Play's sheet, or refused: nothing is coming.
        if (billing.buying == null && awaiting != null) {
            delay(15_000L)
            awaiting = null
        }
    }

    val failed = !billing.onSale && waited
    val loading = !billing.onSale && !failed
    val bonuses = store.store?.packs.orEmpty().associate { it.id to it.bonus?.trim()?.toIntOrNull() }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon("coin", size = 13.dp)
            Spacer(Modifier.width(6.dp))
            PanelTitle("Get coins")
        }
        if (failed) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Couldn't reach Google Play.",
                    color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(6.dp))
                LandingButton("Try again", LandingKind.GHOST) { attempt++ }
            }
        } else {
            Text(
                if (billing.onSale) "Top up when the wins aren't coming fast enough."
                else "Checking Google Play…",
                color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
            )
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (pack in billing.offers) {
            val live = billing.onSale && pack.price != null
            val busy = billing.buying == pack.packId
            PackRow(
                pack = pack,
                bonus = bonuses[pack.packId] ?: BUILT_IN_BONUS[pack.packId] ?: 0,
                live = live,
                spinning = busy || (!live && loading),
                enabled = live && !busy && activity != null,
            ) {
                val from = activity ?: return@PackRow
                awaiting = store.coins to pack.coins
                billing.buy(from, pack.packId)
            }
        }
    }
}

/**
 * The bonus each pack carries, as the server's catalogue states it. The
 * served copy wins when it has arrived; this is so the badge is there before
 * it has, exactly as iOS's built-in packs carry theirs.
 */
private val BUILT_IN_BONUS = mapOf("coins.small" to 0, "coins.mid" to 10, "coins.large" to 25)

/**
 * The drawing each pack wears — iOS's packGlyph, keyed on the pack rather than
 * on the emoji the server sends, because the pack is what this app knows for
 * certain. The big one is a chest, not a bank.
 */
private fun packGlyph(packId: String): String = when (packId) {
    "coins.mid" -> "bag"
    "coins.large" -> "toolbox"
    else -> "coin"
}

@Composable
private fun PackRow(
    pack: CoinPackOffer,
    bonus: Int,
    live: Boolean,
    spinning: Boolean,
    enabled: Boolean,
    onBuy: () -> Unit,
) {
    val p = P.current
    val shape = RoundedCornerShape(15.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .alpha(if (live) 1f else 0.55f)
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .clickable(enabled = enabled) { onBuy() }
            .padding(vertical = 11.dp, horizontal = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(packGlyph(pack.packId), size = 32.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    pack.name,
                    color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (bonus > 0) {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "+$bonus%",
                        modifier = Modifier
                            .clip(RoundedCornerShape(99.dp))
                            .background(p.gold)
                            .padding(horizontal = 6.dp, vertical = 2.5.dp),
                        color = p.accentInk, fontSize = 9.sp,
                        letterSpacing = 0.4.sp, fontWeight = FontWeight.Black,
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon("coin", size = 13.dp)
                Spacer(Modifier.width(4.dp))
                Text(
                    "${pack.coins} coins",
                    color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
                )
            }
        }
        Spacer(Modifier.width(6.dp))
        if (spinning) {
            LandingSpinner(p.red)
        } else if (pack.price != null) {
            // Only ever Play's own localised price. A hard-coded figure is
            // wrong everywhere but one country, and printed on a row that
            // cannot be tapped it reads as a broken shop.
            Text(
                pack.price,
                modifier = Modifier
                    .clip(RoundedCornerShape(99.dp))
                    .background(p.red)
                    .padding(horizontal = 13.dp, vertical = 7.dp),
                color = p.accentInk, fontSize = 13.5.sp, fontWeight = FontWeight.ExtraBold,
            )
        }
    }
}

// ───────────────────────────────────────────────────────── pieces and faces ──

/**
 * One shelf of things to wear: its heading, the line under it, and three to a
 * row. Nothing at all when the catalogue has none of this kind.
 */
@Composable
private fun Shelf(
    store: AccountStore,
    game: GameStore,
    catalogue: List<StoreItem>,
    glyph: String,
    title: String,
    sub: String,
    kind: String,
) {
    val p = P.current
    val items = catalogue.filter { it.kind == kind }
    if (items.isEmpty()) return
    val scope = rememberCoroutineScope()
    // Bought here and not yet back from the wallet: the card redraws as owned
    // at once rather than a round trip later, as iOS's does.
    var bought by remember { mutableStateOf(emptySet<String>()) }
    val owned = store.wallet?.owned.orEmpty().toSet() + bought
    val worn = store.wallet?.equipped?.get(kind).orEmpty()
    val coins = store.coins

    // iOS writes the new look into its wallet the instant it is tapped and
    // puts the old one back if the server never agreed. The wallet here is
    // AccountStore's to write, so the guess is held beside it instead: the
    // tick moves on the tap, the wallet takes back over the moment it agrees,
    // and a refusal drops the guess there and then.
    var guess by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(worn) { if (guess == worn) guess = null }
    val showing = guess ?: worn

    // iOS's Cosmetics.wear. No `itemId` at all is how the server spells
    // taking one off: the post drops a null before it builds the body.
    suspend fun wear(item: StoreItem?) {
        guess = item?.id.orEmpty()
        val reply = game.api.postOrError("/api/store/equip", mapOf("slot" to kind, "itemId" to item?.id))
        if (reply.ok) {
            // The same note the lobby's piece row writes, so the next table
            // this device sits at agrees about what it is wearing.
            when (kind) {
                "token" -> game.prefs.tokenSkin = item?.emoji.orEmpty()
                "avatar" -> game.prefs.avatar = item?.emoji.orEmpty()
            }
        } else {
            guess = null
            game.showToast(reply.error ?: "Couldn't change your look — try again.", isError = true)
        }
        store.refreshStore()
    }

    /**
     * iOS's Cosmetics.buyOrEquip: buy it if it isn't yours yet (buying wears
     * it), take it off if it is the one you are wearing, and wear it
     * otherwise. Each refusal is the server's own sentence, and iOS's words
     * when there is none.
     */
    fun tap(item: StoreItem, have: Boolean, on: Boolean) {
        SoundKit.click()
        scope.launch {
            if (!have) {
                val reply = game.api.postOrError("/api/store/buy", mapOf("itemId" to item.id, "expect" to item.price))
                if (!reply.ok) {
                    // A request that never landed must not read as a
                    // purchase: the coins only moved if the server said so.
                    game.showToast(reply.error ?: "Couldn't reach the shop — try again.", isError = true)
                    return@launch
                }
                SoundKit.buy()
                // The purse the reply states, at once, as iOS writes it.
                store.noteBuyReply(reply.body)
                game.showToast("${item.emoji} ${item.name} is yours!")
                bought = bought + item.id
            }
            wear(if (on) null else item)
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(glyph, size = 13.dp, tint = p.ink3)
            Spacer(Modifier.width(6.dp))
            PanelTitle(title)
        }
        Text(sub, color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium)
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (row in items.chunked(3)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (item in row) {
                    val have = item.id in owned
                    val on = item.id == showing
                    ItemCard(
                        item = item,
                        owned = have,
                        equipped = on,
                        // What you cannot afford yet reads as out of reach,
                        // rather than looking like everything else until the
                        // tap bounces back an error.
                        affordable = have || coins >= item.price,
                        modifier = Modifier.weight(1f),
                    ) { tap(item, have, on) }
                }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun ItemCard(
    item: StoreItem,
    owned: Boolean,
    equipped: Boolean,
    affordable: Boolean,
    modifier: Modifier = Modifier,
    onTap: () -> Unit,
) {
    val p = P.current
    val shape = RoundedCornerShape(15.dp)
    Column(
        modifier
            .alpha(if (affordable) 1f else 0.55f)
            .clip(shape)
            .background(if (equipped) p.goldSoft else p.card)
            .border(if (equipped) 1.5.dp else 1.dp, if (equipped) p.gold else p.rule, shape)
            .clickable { onTap() }
            .padding(vertical = 13.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        // A bought skin is the player's own chosen emoji — the one place on
        // this page where an emoji is the thing on sale rather than a
        // drawing standing in for one. That is why it stays: the drawn-icons
        // rule is for chrome, this card is content, and the emoji is the very
        // piece the board, or the player chip, will draw. A glyph here would
        // sell a picture of something else. iOS's storeCard shows the same
        // emoji at the same 34.
        Text(item.emoji, fontSize = 34.sp)
        Text(
            item.name,
            color = p.ink, fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (!owned) {
                Icon("coin", size = 12.dp)
                Spacer(Modifier.width(4.dp))
            }
            Text(
                when {
                    equipped -> "✓ Equipped"
                    owned -> "Tap to equip"
                    else -> "${item.price}"
                },
                color = when {
                    equipped -> p.good
                    owned -> p.ink3
                    affordable -> p.gold
                    else -> p.ink3
                },
                fontSize = 10.5.sp, fontWeight = FontWeight.ExtraBold,
            )
        }
    }
}

// ─────────────────────────────────────────────────────────────────── boards ──

/**
 * Boards, alongside the pieces and the faces.
 *
 * A shelf of its own rather than another [Shelf], because a board is not a
 * piece: it is bought on the strength of the drawing, so the card carries the
 * board itself rather than an emoji — and it says out loud when one is free
 * today. The shop's job is to sell a board, not to sell somebody a board they
 * could have had for nothing this afternoon.
 *
 * A tap opens the board's own page, the same one the lobby opens: the drawing
 * large, what is on it, and the price on a button. The dearest board here is
 * a whole coin pack, and that deserves a page rather than a card's corner.
 */
@Composable
private fun BoardStoreShelf(store: AccountStore, game: GameStore) {
    val p = P.current
    var shopping by remember { mutableStateOf<String?>(null) }

    // A phone that slept through midnight wakes holding yesterday's shelf:
    // yesterday's free pair, yesterday's sale — and a tap on a price that has
    // already turned over comes back refused by the server's `expect` check,
    // which is a rude way to learn the day changed. So it asks again on the
    // way back in, as iOS does on willEnterForeground.
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner, store) {
        val watch = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) store.rolloverIfDue()
        }
        owner.lifecycle.addObserver(watch)
        onDispose { owner.lifecycle.removeObserver(watch) }
    }

    val boards = store.boards?.boards.orEmpty()

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon("map", size = 15.dp, tint = p.ink2)
            Spacer(Modifier.width(7.dp))
            Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text("Boards", color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
                Text(
                    "Classic is free forever and two more every day. Three are on sale, " +
                        "and the shelf is redealt every morning.",
                    color = p.ink3, fontSize = 11.5.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium,
                )
            }
        }

        for (row in boards.chunked(2)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                for (board in row) {
                    BoardCard(board, Modifier.weight(1f)) {
                        SoundKit.click()
                        shopping = board.id
                    }
                }
                repeat(2 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }

    shopping?.let { id ->
        val board = store.board(id)
        if (board == null) {
            LaunchedEffect(id) { shopping = null }
        } else {
            BoardShopSheet(
                store = store,
                board = board,
                onClose = { shopping = null },
                onBought = {
                    shopping = null
                    game.showToast("${board.name} is yours!")
                },
            )
        }
    }
}

/**
 * One board on the shelf: the drawing first and the price last, because the
 * drawing is the thing being sold. Nineteen boards answer to the same handful
 * of glyphs, and a card that leads with a name cannot tell Bharat from Canada.
 */
@Composable
private fun BoardCard(board: BoardListing, modifier: Modifier = Modifier, onTap: () -> Unit) {
    val p = P.current
    // Free forever, or already paid for. Either way there is nothing to sell.
    val owned = board.how == "house" || board.how == "owned"
    val was = board.was
    val shape = RoundedCornerShape(15.dp)

    Column(
        modifier
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .clickable(enabled = !owned) { onTap() }
            .padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(Modifier.fillMaxWidth()) {
            board.preview?.let {
                // A locked board is drawn faint: plainly a board, plainly not
                // one of yours yet.
                MiniBoard(
                    it,
                    Modifier.clip(RoundedCornerShape(10.dp)).background(p.page).padding(4.dp),
                    dim = board.how == "locked",
                )
            }
            val badge = Modifier.align(Alignment.TopEnd).padding(5.dp)
            if (board.how == "today") {
                BoardBadge("FREE TODAY", p.good, Color.White, badge)
            } else if (was != null && was > 0) {
                // Worked out from the two numbers on this card rather than from
                // the headline rate: prices round to the nearest 25, so a flat
                // "30% OFF" was wrong on six of the seven price points.
                val off = ((1 - board.price.toDouble() / was) * 100).toInt()
                BoardBadge("$off% OFF", p.gold, p.accentInk, badge)
            }
        }

        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            // Shrunk a fifth rather than cut: "The Great White North" clipped
            // to "The Great White N…" is the one thing on this card that
            // cannot be guessed from the drawing above it.
            FitText(
                board.name,
                color = p.ink, fontSize = 12.5.sp, fontWeight = FontWeight.ExtraBold,
                textAlign = TextAlign.Center, minScale = 0.8f,
            )
            if (board.teaser.isNotEmpty()) {
                // Two lines, because half a city name is worse than a taller
                // card: "New York City · Boston · San Fra…" sells nothing.
                Text(
                    board.teaser,
                    color = p.ink3, fontSize = 9.5.sp, fontWeight = FontWeight.SemiBold,
                    lineHeight = 12.sp, textAlign = TextAlign.Center, maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            if (!owned) {
                Icon("coin", size = 12.dp)
                Spacer(Modifier.width(4.dp))
            }
            // The old price, struck through, and only while there really is an
            // old one: a "was" that matches the price is the oldest lie in
            // retail, which is why the server sends it only when it is true.
            if (was != null && !owned) {
                Text(
                    "$was",
                    color = p.ink3, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                    textDecoration = TextDecoration.LineThrough,
                )
                Spacer(Modifier.width(4.dp))
            }
            Text(
                when {
                    board.how == "house" -> "Always free"
                    owned -> "✓ Yours"
                    else -> "${board.price}"
                },
                color = if (owned) p.ink3 else p.gold,
                fontSize = 10.5.sp, fontWeight = FontWeight.ExtraBold,
            )
        }
    }
}

/** What a card says out loud about itself — and it never says two things. */
@Composable
private fun BoardBadge(text: String, bg: Color, fg: Color, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier
            .clip(RoundedCornerShape(99.dp))
            .background(bg)
            .padding(horizontal = 6.dp, vertical = 2.5.dp),
        color = fg,
        fontSize = 8.sp,
        fontWeight = FontWeight.Black,
    )
}

/**
 * The board's own page, over the Store — iOS's BoardBuySheet. The page itself
 * is [BoardShop], the same one the lobby opens, so a board is sold the same
 * way wherever it was found. There is no table here, so there is no one-game
 * rent to offer: that door only opens in a lobby this player is hosting.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BoardShopSheet(
    store: AccountStore,
    board: BoardListing,
    onClose: () -> Unit,
    onBought: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    // The app's one sheet ([MMSheet]) — the same glass the lobby lays this
    // very page on (LobbySheet.kt's BoardPageSheet), so a board's shop looks
    // the same wherever it was opened from.
    MMSheet(
        onDismissRequest = onClose,
        sheetState = sheetState,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp)
                .padding(bottom = 28.dp),
        ) {
            BoardShop(
                store = store,
                game = null,
                board = board,
                onBought = { onBought() },
                onBack = onClose,
            )
        }
    }
}
