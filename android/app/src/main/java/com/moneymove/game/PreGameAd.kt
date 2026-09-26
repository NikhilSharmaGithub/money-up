package com.moneymove.game

import android.app.Activity
import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.gms.ads.interstitial.InterstitialAd as GoogleInterstitial

// The one ad that pays the player nothing — InterstitialAd.swift, on Android.
//
// Everything else in this app trades: watch thirty seconds, take the purse
// twice, or a couple of coins. This does not. It is a full-screen break shown
// while a quick match is being found, and the only thing on the other side of
// it is the game the player was already waiting for.
//
// Which is exactly why it is held to tighter rules than the rewarded ads:
//
//   It never delays the game. The search runs behind it and the table opens on
//   its own schedule whether or not an ad is still on screen. Nothing here is
//   awaited by anything that matters, and nothing here suspends.
//
//   It is shown at the START of the wait, not the end. A break that lands in
//   the last three seconds is a break the player is still closing while their
//   first turn runs.
//
//   It obeys a gap the owner sets, and refuses itself if the server has not
//   named a unit. No unit, no house fallback: a house interstitial would be a
//   full-screen advert for the game to somebody already playing it.
//
//   Contextual, never profiled — npa=1, exactly as the rewarded path does.
//
// Driven from MainActivity off GameStore's own state rather than from the Play
// button, so no screen has to know it exists. Main thread only, like every
// caller it has.

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

    private fun lastShownAt(context: Context): Long =
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getLong(LAST_SHOWN, 0L)

    private fun setLastShownAt(context: Context, at: Long) {
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putLong(LAST_SHOWN, at).apply()
    }
}
