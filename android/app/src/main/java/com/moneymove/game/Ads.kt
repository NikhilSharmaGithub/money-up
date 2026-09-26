package com.moneymove.game

import kotlinx.serialization.Serializable

/**
 * The ads the server is willing to pay for.
 *
 * Nothing about an ad is decided here. The server says whether ads are on for
 * this platform at all, which placements exist, how many views are left today
 * and what each one is worth; the client's whole job is to draw what it is
 * told and then prove the ad played. A client that decided any of this for
 * itself would be a client that could be asked to pay itself.
 *
 * Two steps, and both have to land:
 *
 *  1. `POST /api/ads/offer` — nothing is promised and nothing is spent, but
 *     the server has already decided this view will be paid for, so a player
 *     is never shown thirty seconds of video against a cap they had hit.
 *  2. `POST /api/ads/reward` — the ticket proves the server agreed, and the
 *     adapter proves the ad actually played. Both, or nothing moves.
 *
 * Every field below has a default, because a server older or newer than this
 * build answers with fewer fields or more, and one missing number must never
 * turn the whole switchboard into a decode failure — that would read as "ads
 * are off" to a player the owner is trying to pay.
 */

@Serializable
data class AdPlacement(
    val enabled: Boolean = false,
    /** grant | multiplier */
    val kind: String = "grant",
    val coins: Int = 0,
    // A number the desk lets the owner type, so it is read as one: a factor
    // of 1.5 decoded into an Int would throw away the whole config.
    val factor: Double = 1.0,
    val dailyCap: Int = 0,
    val description: String = "",
    val remaining: Int = 0,
    /** The id this client hands its SDK for this slot; empty on the house. */
    val unitId: String = "",
)

/**
 * A break that pays nothing — see PreGameAd. The server only ever switches
 * one on when ads are on, the slot is on and it has a unit to name, because
 * there is nothing to fall back to: a house interstitial would be a
 * full-screen advert for the game to somebody already playing it.
 */
@Serializable
data class AdInterstitial(
    val enabled: Boolean = false,
    /** The shortest gap between two of them, in minutes. */
    val everyMinutes: Double = 0.0,
    val unitId: String = "",
)

/**
 * The one object a client needs to boot an SDK, as the server sees it. Only
 * ever read for a sanity check — the app id this build actually uses is the
 * one in its own manifest, because that is the only one the SDK will read.
 */
@Serializable
data class AdNetworkInfo(
    val id: String = "house",
    val appId: String = "",
    val test: Boolean = false,
)

@Serializable
data class AdsConfig(
    val enabled: Boolean = false,
    /** house | admob — who is actually selling the view. */
    val provider: String = "house",
    val placements: Map<String, AdPlacement> = emptyMap(),
    val interstitials: Map<String, AdInterstitial> = emptyMap(),
    val remaining: Map<String, Int> = emptyMap(),
    val network: AdNetworkInfo = AdNetworkInfo(),
    val testMode: Boolean = false,
) {
    fun placement(slot: String): AdPlacement? =
        placements[slot]?.takeIf { enabled && it.enabled }

    /** Whether there is anything left to offer in this slot today. */
    fun open(slot: String): Boolean = placement(slot)?.let { it.remaining > 0 } == true

    /** The break's terms, or null when there is no break to take at all. */
    fun interstitial(slot: String): AdInterstitial? =
        interstitials[slot]?.takeIf { enabled && it.enabled && it.unitId.isNotBlank() }

    /**
     * A fresh `remaining` map from an offer or a claim, folded in. The count
     * on the button moves the moment the server says it did, rather than
     * after the next full read of the switchboard.
     */
    fun noting(fresh: Map<String, Int>): AdsConfig {
        if (fresh.isEmpty()) return this
        return copy(
            remaining = remaining + fresh,
            placements = placements.mapValues { (slot, p) ->
                fresh[slot]?.let { p.copy(remaining = it) } ?: p
            },
        )
    }
}

@Serializable
data class AdOfferReward(val coins: Int = 0)

/**
 * POST /api/ads/offer. A refusal arrives in the same shape with `error` set,
 * and with a non-2xx status — which is why it is read through postOrError.
 */
@Serializable
data class AdOffer(
    val ok: Boolean = false,
    val ticket: String = "",
    val placement: String = "",
    val provider: String = "house",
    val expiresAt: Double = 0.0,
    val reward: AdOfferReward = AdOfferReward(),
    val remaining: Map<String, Int> = emptyMap(),
    /**
     * Present only when the gateway is serving AdMob: the unit to load, the
     * nonce Google's server-side callback has to carry back so /api/ads/ssv
     * can tell which ticket it just confirmed, and a short opaque tag it
     * cross-checks that confirmation against. None of the three is the wallet
     * token — nothing that spends coins is handed to an ad network.
     */
    val unitId: String = "",
    val customData: String = "",
    val userId: String = "",
    val appId: String = "",
    val test: Boolean = false,
    val error: String? = null,
    /** Seconds until the same ask would be allowed, when it was a cooldown. */
    val retryInSec: Double? = null,
)

/** POST /api/ads/reward — the only message in the app that moves coins. */
@Serializable
data class AdReward(
    val ok: Boolean = false,
    val placement: String = "",
    /** What this view paid. */
    val awarded: Int = 0,
    /** The wallet afterwards. */
    val coins: Int = 0,
    val remaining: Map<String, Int> = emptyMap(),
    val error: String? = null,
    val retryInSec: Double? = null,
    /**
     * Not "no" — "not yet". The gateway sets this when the only thing missing
     * is Google's own confirmation of a view that has already happened; the
     * ticket was not burnt, and the same claim is worth making again.
     */
    val pending: Boolean = false,
)

/**
 * The server's own wording, with its "try again in" attached — iOS's
 * AdDesk.refusal, so a cooldown reads the same on either phone. Anything
 * longer than an hour is a cap rather than a cooldown, and the sentence
 * already says so better than a countdown would.
 */
fun adRefusal(error: String, retryInSec: Double?): String {
    val wait = kotlin.math.ceil(retryInSec ?: 0.0).toInt()
    if (wait <= 0 || wait > 3600) return error
    if (wait < 60) return "$error — try again in ${wait}s."
    val mins = kotlin.math.ceil(wait / 60.0).toInt()
    return "$error — try again in $mins minute${if (mins == 1) "" else "s"}."
}
