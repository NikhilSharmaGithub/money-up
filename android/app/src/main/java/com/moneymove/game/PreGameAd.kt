package com.moneymove.game

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.gms.ads.interstitial.InterstitialAd as GoogleInterstitial

// The one ad that pays the player nothing — InterstitialAd.swift, on Android.
//
// Everything else in this app trades: watch thirty seconds, take the purse
// twice, or a couple of coins. This does not. It is a full-screen break shown
// as the player sits down at a new table, and the only thing on the other side
// of it is the game they just asked for.
//
// Which is exactly why it is held to tighter rules than the rewarded ads:
//
//   It never delays the game. The search, the new table, the join all run
//   behind it, and a table opens on its own schedule whether or not an ad is
//   still on screen. Nothing here is awaited by anything that matters, and
//   nothing here suspends.
//
//   It is shown at the START of the wait, not the end. A break that lands in
//   the last three seconds is a break the player is still closing while their
//   first turn runs. At the tap, a Play-now break is spent inside the lobby's
//   twenty seconds of looking for people rather than over the table.
//
//   Only for a table the player is sitting down at by their own tap: Play
//   now, and the quick Play again that is one; a private game of their own;
//   a code, whether typed or carried by a friend's invite; a seat in a
//   friend's lobby or a public room. Never where it would hold up a game that
//   already exists — a private rematch (the room waits on its host), a cup
//   match, the way back into a table still running, a push or a link.
//
//   It obeys a gap the owner sets, and refuses itself if the server has not
//   named a unit. No unit, no house fallback: a house interstitial would be a
//   full-screen advert for the game to somebody already playing it.
//
//   Contextual, never profiled — npa=1, exactly as the rewarded path does.
//
// Shown from those taps through [PreGameAd.beforeGame], as iOS shows it from
// inside its buttons. MainActivity only keeps one loaded while the player is
// on the tabs, and the result of a matchmade game loads its own. Main thread
// only, like every caller it has.

object PreGameAd {

    private const val SLOT = "preGame"
    private const val TAG = "MMAds"

    /**
     * When the last one was shown on this device, so the owner's gap means
     * something across launches rather than only within one. iOS's key.
     */
    private const val STORE = "mm.ads"
    private const val LAST_SHOWN = "mm.ads.lastInterstitial"

    /**
     * AdMob's ads go stale after an hour and show nothing when they do — and
     * a stale one would still have spent the owner's gap. Kept a little under.
     */
    private const val SHELF_LIFE_MS = 55 * 60_000L

    private var loaded: GoogleInterstitial? = null
    private var loadedAt = 0L
    private var loading = false

    /**
     * Whether a break is due: ads on, this slot on, a unit to serve from, and
     * the owner's gap elapsed. Asked before anything is loaded, so a player
     * who is not due one costs Google no request and appears in no log.
     */
    fun isDue(context: Context, config: AdsConfig?): Boolean {
        val slot = config?.interstitial(SLOT) ?: return false
        val gapMs = (slot.everyMinutes.coerceAtLeast(0.0) * 60_000).toLong()
        return System.currentTimeMillis() - lastShownAt(context) >= gapMs
    }

    /**
     * Load one, quietly, so it is ready the moment it is wanted. Safe to call
     * as often as anything likes: when nothing is due it returns without
     * touching the SDK at all.
     */
    fun preload(context: Context, config: AdsConfig?) {
        val app = context.applicationContext
        if (loaded != null && SystemClock.elapsedRealtime() - loadedAt > SHELF_LIFE_MS) loaded = null
        if (loading || loaded != null || !isDue(app, config)) return
        val unit = config?.interstitial(SLOT)?.unitId?.trim().orEmpty()
        if (!AdMobNetwork.canServe(app, unit)) return
        loading = true
        AdMobNetwork.kick(app)
        try {
            GoogleInterstitial.load(app, unit, AdMobNetwork.request(), object : InterstitialAdLoadCallback() {
                override fun onAdLoaded(ad: GoogleInterstitial) {
                    loading = false
                    loaded = ad
                    loadedAt = SystemClock.elapsedRealtime()
                }

                override fun onAdFailedToLoad(error: LoadAdError) {
                    loading = false
                    Log.i(TAG, "interstitial $unit did not fill: ${error.code} ${error.message}")
                }
            })
        } catch (t: Throwable) {
            loading = false
            Log.w(TAG, "interstitial load threw: ${t.message}")
        }
    }

    /**
     * Show it if one is ready. Returns immediately either way — nothing about
     * the game waits on this. The activity is only lent for the call: Google
     * launches its own on top of it, and nothing here keeps it.
     */
    fun showIfReady(activity: Activity, config: AdsConfig?) {
        if (!isDue(activity, config)) return
        val ad = loaded ?: return
        loaded = null
        if (SystemClock.elapsedRealtime() - loadedAt > SHELF_LIFE_MS) return
        if (activity.isFinishing || activity.isDestroyed) return
        setLastShownAt(activity, System.currentTimeMillis())
        try {
            ad.show(activity)
        } catch (t: Throwable) {
            Log.w(TAG, "interstitial show threw: ${t.message}")
        }
    }

    /**
     * The break for a tap that sits the player at a new table — the one call
     * every such button makes, before or beside whatever it sets going.
     *
     * The tap is all it needs: the activity Google launches from is found
     * from the button's own context. Nothing goes up while a rewarded break
     * is under way — that runs from the offer being asked for to the coins
     * being claimed, so a tap can land in the seconds either side of the ad
     * itself, and a break between the two would be two ads for one tap.
     * Everything else — the owner's gap, a unit, an ad loaded in time — is
     * [showIfReady]'s to refuse, and a refusal is silence: the table the tap
     * asked for is on its way regardless.
     */
    fun beforeGame(context: Context, account: AccountStore) {
        if (account.adPlaying != null) return
        val activity = context.findActivity() ?: return
        showIfReady(activity, account.ads)
    }

    private fun lastShownAt(context: Context): Long =
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getLong(LAST_SHOWN, 0L)

    private fun setLastShownAt(context: Context, at: Long) {
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putLong(LAST_SHOWN, at).apply()
    }

    /**
     * A composable's context is the activity only most of the time — a sheet
     * or a themed wrapper hands out something wrapped around it — so the
     * wrappers are peeled until one is. Ui.kt keeps the same walk to itself.
     */
    private tailrec fun Context.findActivity(): Activity? = when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> null
    }
}
