package com.moneymove.game

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.google.ads.mediation.admob.AdMobAdapter
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

// Google's half of the rewarded break — RewardedAdNetwork.swift, on Android.
//
// AccountStore owns the loop that matters — offer, watch, claim — and this
// file is only ever the middle of it: the thirty seconds in which a real
// network gets to fill a slot the house would otherwise fill itself. Nothing
// here decides what a view is worth and nothing here moves a coin. The ticket
// does that, at the gateway, and on AdMob the gateway waits for Google's own
// server-side callback before it believes anybody.
//
// The same three rules iOS keeps:
//
//   Nothing is asked of Google until something is about to be shown. The SDK
//   is started once per process, from inside a break that is already wanted,
//   and every request waits for that. What linking it costs unconditionally
//   is the SDK's own content provider at launch, which this app cannot stop
//   and does not try to — it is why the manifest's app id must never be bad —
//   and the manifest delays its measurement until the SDK is started.
//
//   No consent screen. Every request carries npa=1, Google's own extra for
//   "serve a contextual ad, not a profiled one", so there is nothing about the
//   player being used and no consent flow to build. It pays less than a
//   personalised ad; that switch is Google's UMP SDK plus a consent sheet, and
//   a decision for the day the revenue is worth the extra screen.
//
//   A break that cannot be filled is still a break that was promised. Every
//   way this file can fail — no id, a sample id with live units, no fill, a
//   load that hangs, a show the system refuses, an SDK that throws — comes
//   back as UNAVAILABLE, and the caller puts the house ad up in its place.
//   That mirrors the server, which picks the house adapter by the same
//   reasoning the moment AdMob cannot serve.

/**
 * The three answers a network ad can give. There is deliberately no "paid":
 * what a view was worth is the gateway's ruling, never this file's.
 */
enum class NetworkAdOutcome {
    /** Google's SDK reported the reward earned. The claim is worth making. */
    EARNED,
    /** A real ad played and was closed before it earned anything. */
    DISMISSED,
    /** Nothing played. The caller still owes the player their break. */
    UNAVAILABLE,
}

object AdMobNetwork {

    private const val TAG = "MMAds"

    /**
     * How long a fill is worth waiting for before the slot goes back to the
     * house. Google's own load times out eventually; this is the number that
     * decides how long a player stares at a spinner if it doesn't.
     */
    private const val LOAD_TIMEOUT_MS = 12_000L

    /**
     * How long an ad that has gone up gets to report coming down. Not a fill
     * timeout — the player is watching it — only the answer to "the SDK has
     * stopped talking to us". Matched to the gateway's five-minute ticket:
     * past that there is nothing left to redeem, so nothing left to wait for.
     */
    private const val STUCK_TIMEOUT_MS = 300_000L

    private const val APP_ID_KEY = "com.google.android.gms.ads.APPLICATION_ID"

    /** What app/build.gradle.kts puts in the manifest when it has no id. */
    private const val GOOGLE_SAMPLE_APP_ID = "ca-app-pub-3940256099942544~3347511713"

    /** Every one of Google's published test units starts with this. */
    private const val GOOGLE_SAMPLE_UNITS = "ca-app-pub-3940256099942544/"

    // ── the activity an ad is put in front of ────────────────────────────

    /**
     * The activity on screen right now, and only weakly. Google's full-screen
     * ad needs an Activity to launch from, the offer loop lives in a
     * ViewModel that must never hold one, and the break can be asked for from
     * any tab. So MainActivity says when it is in front, and this remembers it
     * without keeping it alive: a break looks it up at the moment it shows
     * and lets go the moment that call returns.
     */
    @Volatile private var front: WeakReference<Activity>? = null

    fun attach(activity: ComponentActivity) {
        activity.lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onResume(owner: LifecycleOwner) {
                front = WeakReference(activity)
            }

            // Stopped rather than paused: Google's own ad is a translucent
            // activity, and the game underneath it only pauses.
            override fun onStop(owner: LifecycleOwner) {
                if (front?.get() === activity) front = null
            }
        })
    }

    private fun frontActivity(): Activity? =
        front?.get()?.takeIf { !it.isFinishing && !it.isDestroyed }

    // ── the application id ───────────────────────────────────────────────

    @Volatile private var appIdRead: String? = null

    /**
     * The id this build's manifest carries — the only one the SDK will ever
     * read, whatever the server believes it should be. Read back the way
     * iOS reads its Info.plist, rather than baked in twice.
     */
    private fun appId(context: Context): String {
        appIdRead?.let { return it }
        val read = try {
            val pm = context.packageManager
            val info = if (Build.VERSION.SDK_INT >= 33) {
                pm.getApplicationInfo(
                    context.packageName,
                    PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()),
                )
            } else {
                @Suppress("DEPRECATION")
                pm.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
            }
            info.metaData?.getString(APP_ID_KEY)?.trim().orEmpty()
        } catch (e: Exception) {
            ""
        }
        appIdRead = read
        return read
    }

    private val warnedSample = AtomicBoolean(false)

    /**
     * Whether this build may ask Google for `unit` at all.
     *
     * The shape checks are iOS's, and cheap. The last check is Android's own.
     * A build with no ADMOB_APP_ID carries Google's sample app id, and a
     * sample app asking for the owner's live units is at best a failed load
     * and at worst live inventory billed to nobody. So under the sample id
     * only Google's own test units are served, which is exactly what the
     * server's test mode hands out: the whole path can be proved on a build
     * nobody has configured, and nothing else is attempted until somebody has.
     */
    internal fun canServe(context: Context, unit: String): Boolean {
        val id = appId(context)
        if (!id.startsWith("ca-app-pub-") || '~' !in id) return false
        val u = unit.trim()
        if (!u.startsWith("ca-app-pub-") || '/' !in u) return false
        if (id == GOOGLE_SAMPLE_APP_ID && !u.startsWith(GOOGLE_SAMPLE_UNITS)) {
            if (warnedSample.compareAndSet(false, true)) {
                Log.w(TAG, "this build has no ADMOB_APP_ID, so live units are left alone — house ads until it does")
            }
            return false
        }
        return true
    }

    // ── starting ─────────────────────────────────────────────────────────

    private val kicked = AtomicBoolean(false)
    private val started = CompletableDeferred<Unit>()
    private val background = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * Starts the SDK, once, and does not wait for it. Set before anything
     * runs, so two offers tapped together cannot both start it. Off the main
     * thread, as Google now asks: its start-up reads disk and wakes every
     * mediation adapter, and the main thread is the one drawing the board.
     */
    internal fun kick(context: Context) {
        if (!kicked.compareAndSet(false, true)) return
        val app = context.applicationContext
        background.launch {
            try {
                MobileAds.initialize(app) { started.complete(Unit) }
            } catch (t: Throwable) {
                // Anything the SDK throws here would take the whole process
                // with it from a background thread. Caught, it costs one
                // warning and every break is a house ad.
                Log.w(TAG, "AdMob would not start: ${t.message}")
                started.complete(Unit)
            }
        }
    }

    /**
     * [kick], waited on. Google's start reports back when every mediation
     * adapter is up or set-up times out, so this normally answers itself; the
     * stopwatch is here because an ad that never loads is a house ad, while a
     * start that never returns is a spinner for ever.
     */
    private suspend fun startOnce(context: Context) {
        kick(context)
        withTimeoutOrNull(LOAD_TIMEOUT_MS) { started.await() }
    }

    /**
     * One ad request, non-personalised. npa=1 is the documented Google extra
     * for a contextual ad, and it rides in AdMobAdapter's bundle because that
     * is the only bundle the SDK reads it from.
     */
    internal fun request(): AdRequest = AdRequest.Builder()
        .addNetworkExtrasBundle(AdMobAdapter::class.java, Bundle().apply { putString("npa", "1") })
        .build()

    // ── the break ────────────────────────────────────────────────────────

    /**
     * Loads one rewarded ad for `unitId` and puts it on screen.
     *
     * `customData` is the gateway's nonce, handed to Google so that its
     * server-side callback can name the ticket it is confirming. Without it a
     * confirmed view would arrive at /api/ads/ssv pointing at nothing and the
     * claim would never be paid.
     *
     * `userId` is the tag the gateway derived from that same nonce and will
     * check the callback against. It is deliberately not the identity token:
     * a value that ends up in an ad network's logs must not be one that can
     * spend coins.
     *
     * `serverAppId` is only ever logged. The server's idea of the app id and
     * the manifest's can disagree — a desk still holding the iOS id, say —
     * and when they do the load fails on its own and the house takes the
     * break; the log line is there so somebody can see why.
     */
    suspend fun showRewarded(
        context: Context,
        unitId: String,
        customData: String,
        userId: String,
        serverAppId: String = "",
    ): NetworkAdOutcome {
        val app = context.applicationContext
        val unit = unitId.trim()
        if (unit.isEmpty() || !canServe(app, unit) || frontActivity() == null) {
            return NetworkAdOutcome.UNAVAILABLE
        }
        if (serverAppId.isNotBlank() && serverAppId.trim() != appId(app)) {
            Log.i(TAG, "the server names app id $serverAppId, this build carries ${appId(app)}")
        }
        startOnce(app)
        val ad = load(app, unit) ?: return NetworkAdOutcome.UNAVAILABLE

        if (customData.isNotEmpty() || userId.isNotEmpty()) {
            // Arrives at our callback as `custom_data`, which is what
            // /api/ads/ssv reads to find the ticket, with `user_id` beside it;
            // the gateway refuses a callback whose tag does not match the
            // ticket it claims to confirm. The same two fields iOS sets.
            val options = ServerSideVerificationOptions.Builder()
            if (customData.isNotEmpty()) options.setCustomData(customData)
            if (userId.isNotEmpty()) options.setUserId(userId)
            ad.setServerSideVerificationOptions(options.build())
        }

        // Looked up again after the load rather than kept from before it: the
        // player has had twelve seconds to leave, and an ad launched from an
        // activity that is going away is one nobody sees.
        val host = frontActivity() ?: return NetworkAdOutcome.UNAVAILABLE
        return present(ad, host)
    }

    /** A fill, or null and the house takes the slot back. */
    private suspend fun load(context: Context, unit: String): RewardedAd? =
        withContext(Dispatchers.Main) {
            withTimeoutOrNull(LOAD_TIMEOUT_MS) {
                suspendCancellableCoroutine<RewardedAd?> { cont ->
                    try {
                        RewardedAd.load(context, unit, request(), object : RewardedAdLoadCallback() {
                            override fun onAdLoaded(ad: RewardedAd) {
                                if (cont.isActive) cont.resume(ad)
                            }

                            // Every load failure is the same failure from
                            // here: no fill, a bad unit id, an account that
                            // isn't approved yet, no network. All of them mean
                            // the house shows the break.
                            override fun onAdFailedToLoad(error: LoadAdError) {
                                Log.i(TAG, "rewarded $unit did not fill: ${error.code} ${error.message}")
                                if (cont.isActive) cont.resume(null)
                            }
                        })
                    } catch (t: Throwable) {
                        Log.w(TAG, "rewarded load threw: ${t.message}")
                        if (cont.isActive) cont.resume(null)
                    }
                }
            }
        }

    /**
     * Puts the ad up and waits out the break.
     *
     * The stopwatch is the ticket's own lifetime rather than a fill timeout:
     * a show that goes up and never reports coming down would park the whole
     * offer loop and leave the button spinning for the session. It answers
     * UNAVAILABLE even if the reward had already fired, and that is the
     * generous answer: the house break follows, and the claim after it still
     * carries the same ticket — which Google's callback has by then confirmed.
     */
    private suspend fun present(ad: RewardedAd, host: Activity): NetworkAdOutcome =
        withContext(Dispatchers.Main) {
            val outcome = withTimeoutOrNull(STUCK_TIMEOUT_MS) {
                suspendCancellableCoroutine<NetworkAdOutcome> { cont ->
                    // Set by the reward listener, read when the ad comes down.
                    // The order is the SDK's own: the reward fires while the
                    // ad is still up, the dismissal after, and a break that
                    // never earned anything only ever dismisses.
                    var earned = false
                    fun settle(o: NetworkAdOutcome) {
                        if (cont.isActive) cont.resume(o)
                    }
                    ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                        override fun onAdDismissedFullScreenContent() =
                            settle(if (earned) NetworkAdOutcome.EARNED else NetworkAdOutcome.DISMISSED)

                        // Nothing reached the screen, so nothing was spent:
                        // the house takes it and the player still gets the
                        // break they were offered.
                        override fun onAdFailedToShowFullScreenContent(error: AdError) {
                            Log.i(TAG, "rewarded would not show: ${error.code} ${error.message}")
                            settle(NetworkAdOutcome.UNAVAILABLE)
                        }
                    }
                    try {
                        // Google's server-side callback is already on its way
                        // to /api/ads/ssv when this fires; it only records
                        // that the claim is now worth making.
                        ad.show(host) { earned = true }
                    } catch (t: Throwable) {
                        Log.w(TAG, "rewarded show threw: ${t.message}")
                        settle(NetworkAdOutcome.UNAVAILABLE)
                    }
                }
            } ?: NetworkAdOutcome.UNAVAILABLE
            // The callback holds the continuation, and the SDK holds the ad
            // for as long as it likes; neither needs to hold this break.
            ad.fullScreenContentCallback = null
            outcome
        }
}
