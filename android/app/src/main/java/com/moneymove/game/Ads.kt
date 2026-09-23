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
 */

@Serializable
data class AdPlacement(
    val enabled: Boolean = false,
    /** grant | multiplier */
    val kind: String = "grant",
    val coins: Int = 0,
    val factor: Int = 1,
    val dailyCap: Int = 0,
    val description: String = "",
    val remaining: Int = 0,
    val unitId: String = "",
)

@Serializable
data class AdsConfig(
    val enabled: Boolean = false,
    /** house | admob — who is actually selling the view. */
    val provider: String = "house",
    val placements: Map<String, AdPlacement> = emptyMap(),
    val remaining: Map<String, Int> = emptyMap(),
) {
    fun placement(slot: String): AdPlacement? =
        placements[slot]?.takeIf { enabled && it.enabled }

    /** Whether there is anything left to offer in this slot today. */
    fun open(slot: String): Boolean = placement(slot)?.let { it.remaining > 0 } == true
}

@Serializable
data class AdOffer(
    val ok: Boolean = false,
    val ticket: String = "",
    val placement: String = "",
    val provider: String = "house",
    val expiresAt: Double = 0.0,
    val error: String? = null,
)

@Serializable
data class AdReward(
    val ok: Boolean = false,
    val coins: Int = 0,
    val balance: Int = 0,
    val error: String? = null,
    val retryable: Boolean = false,
)
