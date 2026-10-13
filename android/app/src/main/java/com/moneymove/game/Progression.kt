package com.moneymove.game

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs

/**
 * Levels, on screen: the chip a level is worn as, the bar that fills toward
 * the next one, the moment one is crossed, and a player's career.
 *
 * The numbers are all the server's (docs/API-1.0.6.md). Nothing here works a
 * level out from XP, because the curve is the server's to change and a chip
 * that disagreed with the profile card it opens would be the one thing
 * nobody believed.
 */

// ── the chip ────────────────────────────────────────────────────────────────

/**
 * "Lv 12", worn beside a name: the drawn star and the number on a soft gold
 * capsule — never an emoji, so it takes each table's own gold. `compact` is
 * the seat-chip size, the 8.5 of the other capsules a seat wears; the full
 * size sits beside a name on a profile or a leaderboard row.
 *
 * Draws nothing below level one — a pass & play guest's nought, or an older
 * server that sends no level at all — so a caller can always place it.
 */
@Composable
fun LevelChip(level: Int?, modifier: Modifier = Modifier, compact: Boolean = false) {
    val lv = level?.takeIf { it > 0 } ?: return
    val p = P.current
    val fontSize: TextUnit = if (compact) 8.5.sp else 10.5.sp
    val star: Dp = if (compact) 8.dp else 10.dp
    Row(
        modifier
            .clip(MMShapes.pill)
            .background(p.goldSoft)
            .border(1.dp, p.gold.copy(alpha = 0.55f), MMShapes.pill)
            .padding(horizontal = if (compact) 5.dp else 7.dp, vertical = if (compact) 1.dp else 2.dp)
            .clearAndSetSemantics { contentDescription = "Level $lv" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Icon("star", size = star, tint = p.gold)
        Text(
            "Lv $lv",
            color = p.gold, fontSize = fontSize, fontWeight = FontWeight.Black,
            style = TextStyle(fontFeatureSettings = "tnum"),
            maxLines = 1, softWrap = false,
        )
    }
}

// ── the bar ─────────────────────────────────────────────────────────────────

/**
 * How far through this level, as a bar: a sunken track and a gold fill that
 * slides to where it now is, so XP earned while the screen is up is seen to
 * arrive. Under Reduce Motion it is simply there.
 */
@Composable
fun XpBar(fraction: Float, modifier: Modifier = Modifier, height: Dp = 6.dp) {
    val p = P.current
    val reduceMotion = rememberReduceMotion()
    val shown by animateFloatAsState(
        fraction.coerceIn(0f, 1f),
        if (reduceMotion) tween(0) else spring(dampingRatio = 1f, stiffness = Spring.StiffnessLow),
        label = "xp",
    )
    val shape = RoundedCornerShape(99.dp)
    Box(
        modifier
            .height(height)
            .clip(shape)
            .background(p.sunken)
            .border(1.dp, p.rule, shape),
    ) {
        // A sliver at the least once anything is earned, so 3 XP of 200
        // still reads as a start rather than an empty bar.
        val fill = if (shown > 0f) maxOf(shown, 0.03f) else 0f
        if (fill > 0f) {
            Box(
                Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(fill)
                    .clip(shape)
                    .background(p.gold),
            )
        }
    }
}

/**
 * The line a level is read in: the chip, the bar, and the XP still to go —
 * the account card's strip and the result sheet's, the same three things in
 * the same order on both.
 */
@Composable
fun LevelStrip(
    level: Int,
    xp: Int,
    floor: Int,
    next: Int,
    modifier: Modifier = Modifier,
) {
    val p = P.current
    val toGo = maxOf(0, next - xp)
    Row(
        modifier
            .fillMaxWidth()
            .clearAndSetSemantics {
                contentDescription = "Level $level, $toGo XP to level ${level + 1}"
            },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LevelChip(level)
        Spacer(Modifier.width(8.dp))
        XpBar(levelProgress(xp, floor, next), Modifier.weight(1f))
        Spacer(Modifier.width(8.dp))
        Text(
            "${grouped(toGo)} XP to Lv ${level + 1}",
            color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.Bold,
            style = TextStyle(fontFeatureSettings = "tnum"),
            maxLines = 1, softWrap = false,
        )
    }
}

// ── crossing one ────────────────────────────────────────────────────────────

/**
 * "Level 7!" — the moment a level is crossed, on the result sheet when a
 * game did it and on the Play tab when a mission claim did, or when the
 * phone was not at the table at the time.
 *
 * The star pops in on a spring and settles from a quarter-turn, the way the
 * daily coin lands; the coins it paid are named under it, because a level-up
 * that pays and does not say so reads as one that did not pay.
 */
@Composable
fun LevelUpBanner(up: LevelUp, modifier: Modifier = Modifier) {
    val p = P.current
    val pop = remember(up.to) { Animatable(0f) }
    val reduceMotion = rememberReduceMotion()
    LaunchedEffect(up.to) {
        if (reduceMotion) pop.snapTo(1f)
        else pop.animateTo(1f, spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessMediumLow))
    }
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.goldSoft)
            .border(1.5.dp, p.gold, shape)
            .padding(horizontal = 14.dp, vertical = 12.dp)
            .clearAndSetSemantics {
                contentDescription = "Level ${up.to}!" + if (up.coins > 0) " Plus ${up.coins} coins." else ""
            },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(13.dp))
                .background(p.card)
                .border(1.dp, p.gold, RoundedCornerShape(13.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                "star", size = 28.dp, tint = p.gold,
                modifier = Modifier
                    .scale(0.5f + 0.5f * pop.value)
                    .rotate(-72f * (1f - pop.value)),
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                "Level ${up.to}!",
                color = p.gold, fontSize = 22.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.scale(0.85f + 0.15f * pop.value),
            )
            Text(
                if (up.to - up.from > 1) "Up ${up.to - up.from} levels at once" else "You levelled up",
                color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
            )
        }
        if (up.coins > 0) {
            Spacer(Modifier.width(12.dp))
            Row(
                Modifier
                    .clip(MMShapes.pill)
                    .background(p.card)
                    .border(1.dp, p.gold.copy(alpha = 0.55f), MMShapes.pill)
                    .padding(horizontal = 9.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon("coin", size = 14.dp)
                Text(
                    "+${up.coins}",
                    color = p.ink, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold,
                    style = TextStyle(fontFeatureSettings = "tnum"),
                )
            }
        }
    }
}

// ── a career ────────────────────────────────────────────────────────────────

/**
 * The career grid a profile carries: six lifetime numbers and the board
 * played most, in the labels every client uses. Three to a row, the money
 * cut down so seven figures fit a third of a phone.
 *
 * A career with nothing in it yet says why rather than drawing eighteen
 * noughts: these were only counted from 1.0.6, so a veteran with a hundred
 * wins can still have an empty one.
 */
@Composable
fun CareerCard(career: Career?, modifier: Modifier = Modifier) {
    val p = P.current
    Panel(modifier, padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon("chart", size = 13.dp, tint = p.ink3)
            Spacer(Modifier.width(6.dp))
            SectionLabel("Career")
        }
        Spacer(Modifier.height(10.dp))
        if (career == null || career.isEmpty) {
            Text(
                "Nothing counted yet — every game from now on adds to it.",
                color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium,
            )
            return@Panel
        }
        val cells = listOf(
            grouped(career.streetsBought) to "STREETS BOUGHT",
            grouped(career.housesBuilt) to "HOUSES BUILT",
            grouped(career.auctionsWon) to "AUCTIONS WON",
            careerMoney(career.rentCollected) to "RENT COLLECTED",
            careerMoney(career.biggestRent) to "BIGGEST RENT",
            grouped(career.tradesCompleted) to "TRADES",
        )
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            for (row in cells.chunked(3)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    for ((value, label) in row) CareerCell(value, label, Modifier.weight(1f))
                }
            }
            FavouriteBoard(career.favoriteBoard)
        }
    }
}

/** One career number over its label — [Tally]'s cell, with a label that may wrap to two lines. */
@Composable
private fun CareerCell(value: String, label: String, modifier: Modifier = Modifier) {
    val p = P.current
    Column(modifier.padding(horizontal = 2.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        ShrinkText(
            value,
            color = p.gold, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, minScale = 0.6f,
            style = TextStyle(fontFeatureSettings = "tnum"),
        )
        Spacer(Modifier.height(2.dp))
        Text(
            label,
            color = p.ink3, fontSize = 8.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp,
            textAlign = TextAlign.Center, lineHeight = 10.sp,
        )
    }
}

/** "Favourite board — Classic · 8 games", on a well of its own under the grid. */
@Composable
private fun FavouriteBoard(board: FavoriteBoard?) {
    val p = P.current
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.sunken)
            .border(1.dp, p.rule, shape)
            .padding(horizontal = 11.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon("map", size = 16.dp, tint = p.ink2)
        Spacer(Modifier.width(9.dp))
        Text(
            "FAVOURITE BOARD",
            color = p.ink3, fontSize = 8.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp,
        )
        Spacer(Modifier.width(12.dp))
        Spacer(Modifier.weight(1f))
        Text(
            board?.let { b ->
                val name = b.name.ifBlank { b.id }
                if (b.games > 0) "$name · ${b.games} ${if (b.games == 1) "game" else "games"}" else name
            } ?: "None yet",
            color = if (board != null) p.ink else p.ink3,
            fontSize = 13.sp, fontWeight = FontWeight.ExtraBold,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Career money, cut down for a third of a phone: "$950", "$23.4k", "$1.4M".
 * These are game dollars, so they wear the dollar sign the board does.
 */
internal fun careerMoney(n: Int): String = when {
    abs(n) >= 1_000_000 -> "$" + java.text.DecimalFormat("0.#").format(n / 1_000_000.0) + "M"
    abs(n) >= 10_000 -> "$" + java.text.DecimalFormat("0.#").format(n / 1_000.0) + "k"
    else -> money(n)
}
