package com.moneymove.game

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * Today's three missions, under the daily coin — the second reason to open
 * the app on a day you were not going to play.
 *
 * Three rows, each with the drawn mark of what it asks for, the title in the
 * server's words, a bar and its count, and what it pays — XP alone since
 * 1.0.6's round 2; a Claim button in the table's colour once it is done, and
 * a tick once it has been collected. Under them the bonus for finishing all
 * three, the one row on the card that pays coins. Progress is counted for
 * everybody, so a player who is not signed in still sees it climb, and the
 * card says once, at the bottom, what collecting it takes — the daily
 * reward's rule, in the daily reward's button.
 *
 * Nothing at all until the server has answered, as the daily card waits: a
 * placeholder mission is a promise nobody made.
 */
@Composable
fun MissionsCard(account: AccountStore, store: GameStore) {
    val view = account.missions ?: return
    if (view.missions.isEmpty()) return
    val p = P.current
    val context = LocalContext.current
    // The ones on their way, so a second tap cannot send a second claim.
    // The server would pay it once anyway; this is so it does not look as
    // though it might not.
    var claiming by remember { mutableStateOf(emptySet<String>()) }

    // A clock, not an animation: the reset line moves twice a minute, and
    // a card left open past the server's midnight asks for the new three a
    // second after it, so it is never showing yesterday's. It keeps asking,
    // a minute apart, until the new day's card has a new midnight on it — a
    // server whose clock runs a little behind this phone's answers the first
    // ask with the old day.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(view.resetsAt) {
        while (true) {
            now = System.currentTimeMillis()
            val reset = view.resetsAt.toLong()
            if (reset > 0 && now >= reset + 1_000) {
                account.refreshMissions()
                delay(60_000)
            } else {
                delay(if (reset > 0) minOf(30_000L, maxOf(1_000L, reset + 1_000 - now)) else 30_000L)
            }
        }
    }

    fun claim(id: String) {
        if (id in claiming) return
        claiming = claiming + id
        Haptics.tap()
        SoundKit.click()
        account.claimMission(id) { r ->
            claiming = claiming - id
            when {
                r.error != null -> store.showToast(r.error, isError = true)
                // A repeat is a success that paid nothing: the card has
                // already caught up, and there is nothing to celebrate.
                r.paid <= 0 && r.xp <= 0 -> Unit
                else -> {
                    Haptics.turn()
                    SoundKit.gain()
                    // A mission pays XP alone, and wears the level's star;
                    // only the bonus brings coins, and the coin with them.
                    store.showToast(claimLine(r.paid, r.xp), glyph = if (r.paid > 0) "coin" else "star")
                }
            }
        }
    }

    LandingCard(padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(30.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(p.goldSoft)
                    .border(1.dp, p.gold.copy(alpha = 0.55f), RoundedCornerShape(9.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon("star", size = 17.dp, tint = p.gold)
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Daily missions", color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
                val left = view.resetsAt.toLong() - now
                Text(
                    buildString {
                        append("${view.doneCount} of ${view.missions.size} done")
                        if (left > 0) append(" · new ones in ${resetText(left)}")
                    },
                    color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (m in view.missions) {
                MissionRow(
                    m,
                    signedIn = view.signedIn,
                    busy = m.id in claiming,
                ) { claim(m.id) }
            }
            BonusRow(view, busy = BONUS in claiming) { claim(BONUS) }
        }
        if (!view.signedIn) {
            Spacer(Modifier.height(12.dp))
            Text(
                "Progress counts for everyone — sign in to collect the XP and the bonus.",
                color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
            )
            // A sign-in button that cannot sign anyone in is a dead tap, as
            // the account card knows; the sentence above is then the answer.
            if (account.auth?.google == true) {
                Spacer(Modifier.height(9.dp))
                LandingButton(
                    if (account.signingIn) "Signing in…" else "Sign in to claim",
                    LandingKind.GHOST, big = true,
                    enabled = !account.signingIn,
                    lead = { ink ->
                        if (account.signingIn) {
                            LandingSpinner(ink)
                        } else {
                            Icon("key", size = 17.dp, tint = ink, modifier = Modifier.graphicsLayer { rotationZ = 45f })
                        }
                    },
                ) { signInWithGoogleTapped(context, account, store) }
            }
        }
    }
}

/** The bonus's id on the claim, as the server spells it. */
private const val BONUS = "bonus"

/**
 * One mission: its mark, its words, its bar, and the one thing to do about
 * it. The trailing end is the only part that changes as it goes from
 * running to done to collected, and it springs between them so the change
 * is seen to happen.
 */
@Composable
private fun MissionRow(m: Mission, signedIn: Boolean, busy: Boolean, onClaim: () -> Unit) {
    val p = P.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        MissionMark(missionGlyph(m.kind), done = m.done)
        Spacer(Modifier.width(11.dp))
        // Read as one line — what it asks, how far along, and whether it is
        // done — and the Claim button after it as a button of its own.
        Column(
            Modifier
                .weight(1f)
                .clearAndSetSemantics {
                    contentDescription = "${m.title}, ${countText(m)}" + when {
                        m.claimed -> ", collected"
                        m.done -> ", done"
                        else -> ""
                    }
                },
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            // The title is the only weighted child, and fills: it takes all
            // the width the count leaves and pushes the count to the end. A
            // second, flexible spacer beside it would split that width in
            // half and keep the unused half, cutting titles short with room
            // to spare.
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    m.title.ifBlank { m.kind },
                    modifier = Modifier.weight(1f),
                    color = if (m.claimed) p.ink3 else p.ink, fontSize = 13.5.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    countText(m),
                    color = if (m.done) p.good else p.ink3, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold,
                    style = TextStyle(fontFeatureSettings = "tnum"),
                    maxLines = 1, softWrap = false,
                )
            }
            MissionBar(m.fraction, done = m.done)
        }
        Spacer(Modifier.width(12.dp))
        val face = when {
            m.claimed -> Trailing.COLLECTED
            m.done && signedIn -> Trailing.CLAIM
            else -> Trailing.REWARD
        }
        AnimatedContent(
            targetState = face,
            transitionSpec = {
                (fadeIn(tween(200)) + scaleIn(tween(260), initialScale = 0.8f)) togetherWith
                    fadeOut(tween(120)) using SizeTransform(clip = false)
            },
            label = "mission-${m.id}",
        ) { f ->
            when (f) {
                Trailing.COLLECTED -> Collected()
                Trailing.CLAIM -> LandingButton(
                    "Claim", LandingKind.PRIMARY,
                    enabled = !busy,
                    lead = { ink ->
                        when {
                            busy -> LandingSpinner(ink, 16.dp)
                            m.coins > 0 -> Icon("coin", size = 15.dp)
                            // The star in the plate's own ink: an inked
                            // glyph on a coloured plate is part of the label.
                            else -> Icon("star", size = 14.dp, tint = ink)
                        }
                    },
                    gap = 6.dp,
                ) { onClaim() }
                Trailing.REWARD -> RewardPill(m.coins, m.xp, dim = !m.done)
            }
        }
    }
}

/**
 * The bonus: all three done, a few coins — the only coins on the card since
 * the missions themselves went to XP alone, and its own row, so it is
 * something to aim at.
 */
@Composable
private fun BonusRow(view: MissionsView, busy: Boolean, onClaim: () -> Unit) {
    val p = P.current
    val b = view.bonus
    if (b.coins <= 0) return
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (b.ready) p.goldSoft else p.sunken)
            .border(1.dp, if (b.ready) p.gold.copy(alpha = 0.55f) else p.rule, shape)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon("treasure", size = 20.dp, alpha = if (b.ready || b.claimed) 1f else 0.6f)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(
                "Finish all three",
                color = if (b.claimed) p.ink3 else p.ink, fontSize = 13.sp, fontWeight = FontWeight.Bold,
            )
            Text(
                when {
                    b.claimed -> "Bonus collected — see you tomorrow"
                    b.ready && !view.signedIn -> "Done — sign in to collect the bonus"
                    b.ready -> "All done — the bonus is yours"
                    else -> "${view.doneCount} of ${view.missions.size} so far"
                },
                color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.Medium,
            )
        }
        Spacer(Modifier.width(12.dp))
        when {
            b.claimed -> Collected()
            b.ready && view.signedIn -> LandingButton(
                "Claim", LandingKind.GOLD,
                enabled = !busy,
                lead = { ink -> if (busy) LandingSpinner(ink, 16.dp) else Icon("coin", size = 15.dp) },
                gap = 6.dp,
            ) { onClaim() }
            else -> RewardPill(b.coins, 0, dim = !b.ready)
        }
    }
}

private enum class Trailing { REWARD, CLAIM, COLLECTED }

/** The mark of what a mission asks for, on a small well that turns green once it is done. */
@Composable
private fun MissionMark(glyph: String, done: Boolean) {
    val p = P.current
    val shape = RoundedCornerShape(10.dp)
    Box(
        Modifier
            .size(34.dp)
            .clip(shape)
            .background(if (done) p.goodSoft else p.sunken)
            .border(1.dp, if (done) p.good.copy(alpha = 0.5f) else p.rule, shape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(glyph, size = 18.dp, tint = if (done) p.good else p.ink2)
    }
}

/**
 * A mission's bar: the table's own colour while it runs, as the daily
 * ladder is, and the good green once it is done.
 */
@Composable
private fun MissionBar(fraction: Float, done: Boolean) {
    val p = P.current
    val reduceMotion = rememberReduceMotion()
    val shown by animateFloatAsState(
        fraction.coerceIn(0f, 1f),
        if (reduceMotion) tween(0) else spring(dampingRatio = 1f, stiffness = Spring.StiffnessLow),
        label = "mission-bar",
    )
    val shape = RoundedCornerShape(99.dp)
    Box(
        Modifier
            .fillMaxWidth()
            .height(5.dp)
            .clip(shape)
            .background(p.sunken)
            .border(1.dp, p.rule, shape),
    ) {
        if (shown > 0f) {
            Box(
                Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(maxOf(shown, 0.04f))
                    .clip(shape)
                    .background(if (done) p.good else p.red),
            )
        }
    }
}

/**
 * What a row pays, before it can be claimed. A mission pays XP alone (1.0.6
 * round 2), so its pill is the level's star and "+10 XP"; the bonus pays
 * coins alone, so its pill is the coin and its number. An older server whose
 * missions still pay both gets the coin with the XP small beside it.
 */
@Composable
private fun RewardPill(coins: Int, xp: Int, dim: Boolean) {
    val p = P.current
    if (coins <= 0 && xp <= 0) return
    Row(
        Modifier
            .alpha(if (dim) 0.75f else 1f)
            .clip(MMShapes.pill)
            .background(p.sunken)
            .border(1.dp, p.rule, MMShapes.pill)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (coins > 0) {
            Icon("coin", size = 13.dp)
            Text(
                "$coins",
                color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold,
                style = TextStyle(fontFeatureSettings = "tnum"),
            )
            if (xp > 0) {
                Text(
                    "+$xp XP",
                    color = p.ink3, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, softWrap = false,
                )
            }
        } else {
            Icon("star", size = 12.dp, tint = p.gold)
            Text(
                "+$xp XP",
                color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold,
                style = TextStyle(fontFeatureSettings = "tnum"),
                maxLines = 1, softWrap = false,
            )
        }
    }
}

/** Collected: the green tick, settled — a state, not a button. */
@Composable
private fun Collected() {
    val p = P.current
    Row(
        Modifier
            .clip(MMShapes.pill)
            .background(p.goodSoft)
            .padding(horizontal = 9.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        CheckMark(p.good)
        Text("Done", color = p.good, fontSize = 11.5.sp, fontWeight = FontWeight.ExtraBold)
    }
}

/**
 * The drawn mark for each kind of mission, from the shared set — the dice
 * for doubles, the gavel for an auction, the Go arrow for laps. A kind newer
 * than this build still gets a mark rather than a blank.
 */
internal fun missionGlyph(kind: String): String = when (kind) {
    "playGames" -> "people"
    "winGame" -> "trophy"
    "buyStreets" -> "key"
    "buildHouses" -> "house"
    "collectRent" -> "cash"
    "completeSet" -> "palette"
    "winAuction" -> "gavel"
    "completeTrade" -> "trade"
    "rollDoubles" -> "dice"
    "lapsBoard" -> "start"
    else -> "star"
}

/** "1/2", or "$900 / $1,500" for the one mission that is counted in dollars. */
private fun countText(m: Mission): String =
    if (m.kind == "collectRent") "${money(m.progress)} / ${money(m.target)}" else "${m.progress}/${m.target}"

/** The toast a claim earns: "+10 XP" for a mission, "+3 coins" for the bonus, both from an older server. */
internal fun claimLine(coins: Int, xp: Int): String = buildString {
    if (coins > 0) append("+$coins coin${if (coins == 1) "" else "s"}")
    if (xp > 0) {
        if (isNotEmpty()) append(" · ")
        append("+$xp XP")
    }
}

/** "5h 12m", then "12m", then "under a minute" — coarse, like the daily card's clock. */
private fun resetText(ms: Long): String {
    val mins = maxOf(0L, ms / 60_000)
    val hours = mins / 60
    return when {
        hours > 0 -> "${hours}h ${mins % 60}m"
        mins > 0 -> "${mins}m"
        else -> "under a minute"
    }
}
