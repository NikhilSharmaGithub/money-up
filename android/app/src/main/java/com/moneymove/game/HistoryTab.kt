package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.abs

/**
 * What this player has done, and what is still waiting for them.
 *
 * Two different things share this tab: tables still running without this
 * device, and games already in the books. The unfinished ones come first —
 * they are the only rows here anybody can still do something about — then the
 * shelf of everything ever won, then every game played out, newest first.
 * iOS's History, in iOS's order.
 */
@Composable
fun HistoryTab(account: AccountStore, game: GameStore) {
    val p = P.current
    // The shelf is the one thing on this tab the server has to answer, and a
    // single dropped request would leave it missing until the tab is opened
    // again — so it asks a few times, further apart each time, until it has.
    LaunchedEffect(Unit) {
        for (attempt in 1..4) {
            account.refreshHistory()
            delay(attempt * 5_000L)
            if (account.achievements != null) break
        }
    }
    val unfinished = game.unfinishedGames
    val played = game.matchHistory

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // iOS's tabPage: eighteen between cards, twenty off the top, and no
        // wider than 560 so a tablet reads as a column, not a banner.
        Column(
            Modifier
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            // iOS's page title: thirty-point heavy, six more down from the top.
            Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("History", color = p.ink, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold)
                Text(
                    "Games you can still finish, and the ones already played.",
                    color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.Medium,
                )
            }

            // Every table this device left with a game still running on it.
            // The server keeps the seat warm — a bot plays it — so each is a
            // game to walk back into rather than a result to read.
            if (unfinished.isNotEmpty()) {
                SectionHeading("door", "Still going without you")
                for (g in unfinished) key(g.roomId) {
                    UnfinishedRow(g) { game.resume(g) }
                }
            }

            Shelf(account.achievements, games = played.size)

            if (played.isEmpty()) {
                if (unfinished.isEmpty()) EmptyHistory()
            } else {
                SectionHeading("trophy", "Played out")
                for (m in played) key(m.id) { MatchRow(m) }
            }
        }
    }
}

@Composable
private fun SectionHeading(glyph: String, text: String) {
    Row(Modifier.fillMaxWidth().padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(glyph, size = 13.dp, tint = P.current.ink3)
        Spacer(Modifier.width(6.dp))
        SectionLabel(text)
    }
}

// ── still going ─────────────────────────────────────────────────────────────

@Composable
private fun UnfinishedRow(g: UnfinishedGame, onRejoin: () -> Unit) {
    val p = P.current
    // iOS's row, line for line: the board's name and the code's chip, then
    // who was there, then when you left — every line always, as iOS prints
    // them. The card keeps its drop shadow, so the tap is taken without a
    // clip round it that would cut the shadow off.
    Panel(
        Modifier.clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
            onRejoin()
        },
        padding = 13.dp,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(mapGlyph(g.mapIcon), size = 26.dp, tint = p.gold)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        g.mapName,
                        modifier = Modifier.weight(1f, fill = false),
                        color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.Bold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        g.roomId.uppercase(),
                        color = p.ink2, fontSize = 9.sp, fontWeight = FontWeight.Black,
                        fontFamily = FontFamily.Monospace, letterSpacing = 0.8.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(99.dp))
                            .background(p.sunken)
                            .padding(horizontal = 6.dp, vertical = 2.5.dp),
                    )
                }
                Text(
                    g.players.joinToString(", "),
                    color = p.ink2, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "Left ${relativeNamed(g.leftAt)}" +
                        if (g.guests > 0) " · ${g.guests + 1} players on this device" else "",
                    color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.Medium,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            // iOS's twelve either side of a Spacer that keeps six.
            Spacer(Modifier.width(30.dp))
            Text(
                "Rejoin",
                color = p.accentInk, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold,
                modifier = Modifier
                    .clip(RoundedCornerShape(99.dp))
                    .background(p.gold)
                    .padding(horizontal = 11.dp, vertical = 6.dp),
            )
        }
    }
}

// ── the shelf ───────────────────────────────────────────────────────────────

/**
 * Every title this player has ever been handed, and how often, under the four
 * lifetime numbers behind them. Quiet until there is something on it — a wall
 * of zeroes is not an achievement — and absent until the server has answered.
 */
@Composable
private fun Shelf(info: Achievements?, games: Int) {
    info ?: return
    val nothing = info.titles.isEmpty() && info.wins == 0 && info.turnsPlayed == 0
    if (nothing && games == 0) return
    val p = P.current
    // Most-earned first, then alphabetical so a tie doesn't shuffle itself
    // about between refreshes.
    val shelf = info.titles.entries.sortedWith(
        compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key },
    )

    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon("medalGold", size = 13.dp)
            Spacer(Modifier.width(6.dp))
            SectionLabel("Your shelf")
        }
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Tally("${info.wins}", "WINS", Modifier.weight(1f))
            // The server counts wins, not games — only this phone remembers
            // the games themselves. On a fresh install that would read "12
            // wins, 0 games", so the wins are the floor they actually are.
            Tally("${maxOf(games, info.wins)}", "GAMES", Modifier.weight(1f))
            Tally(compact(info.winnings), "WON", Modifier.weight(1f))
            Tally("${info.turnsPlayed}", "TURNS", Modifier.weight(1f))
        }
        Spacer(Modifier.height(12.dp))
        if (shelf.isEmpty()) {
            Text(
                "No titles yet. Every game hands them out at the end — collect rent, close trades, build the most, and one lands on your seat.",
                color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium,
            )
        } else {
            // As many 132dp-or-wider columns as fit, each an equal share.
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val columns = ((maxWidth + 8.dp) / (132.dp + 8.dp)).toInt().coerceAtLeast(1)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (row in shelf.chunked(columns)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for ((title, count) in row) TitleChip(title, count, Modifier.weight(1f))
                            repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Tally(value: String, label: String, modifier: Modifier = Modifier) {
    val p = P.current
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        ShrinkText(
            value,
            color = p.gold, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold, minScale = 0.6f,
            style = TextStyle(fontFeatureSettings = "tnum"),
        )
        Spacer(Modifier.height(2.dp))
        Text(
            label,
            color = p.ink3, fontSize = 8.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.9.sp,
        )
    }
}

/**
 * The report card's title styling, worn again: gold and heavy — a badge
 * should read the same on the shelf as it did the night it landed.
 */
@Composable
private fun TitleChip(title: String, count: Int, modifier: Modifier = Modifier) {
    val p = P.current
    val shape = RoundedCornerShape(12.dp)
    Row(
        modifier
            .clip(shape)
            .background(p.goldSoft)
            .border(1.dp, p.gold.copy(alpha = 0.55f), shape)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon("trophy", size = 13.dp)
        Spacer(Modifier.width(6.dp))
        ShrinkText(
            title,
            modifier = Modifier.weight(1f),
            color = p.gold, fontSize = 13.5.sp, fontWeight = FontWeight.ExtraBold, minScale = 0.8f,
        )
        if (count > 1) {
            // iOS's six either side of a Spacer that keeps two.
            Spacer(Modifier.width(14.dp))
            Text(
                "×$count",
                color = p.accentInk, fontSize = 11.sp, fontWeight = FontWeight.Black,
                style = TextStyle(fontFeatureSettings = "tnum"),
                modifier = Modifier
                    .clip(RoundedCornerShape(99.dp))
                    .background(p.gold)
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            )
        }
    }
}

/**
 * One line that gives up a little size before it gives up any letters — iOS's
 * `minimumScaleFactor`. It steps down five per cent at a time until the line
 * fits or `minScale` is reached, and only then ellipsizes, so "Master
 * Builder" on a narrow chip reads whole on both phones.
 */
@Composable
private fun ShrinkText(
    text: String,
    color: Color,
    fontSize: TextUnit,
    fontWeight: FontWeight,
    minScale: Float,
    modifier: Modifier = Modifier,
    style: TextStyle = TextStyle.Default,
) {
    var scale by remember(text) { mutableFloatStateOf(1f) }
    Text(
        text,
        modifier = modifier,
        color = color, fontSize = fontSize * scale, fontWeight = fontWeight,
        style = style,
        maxLines = 1, overflow = TextOverflow.Ellipsis,
        onTextLayout = { laid ->
            if (laid.hasVisualOverflow && scale > minScale) scale = maxOf(minScale, scale - 0.05f)
        },
    )
}

/**
 * A lifetime of winnings runs to seven figures — four columns have room for
 * "$1.4M", never for "$1,412,900".
 */
private fun compact(n: Int): String = when {
    abs(n) >= 1_000_000 -> "$" + java.text.DecimalFormat("0.#").format(n / 1_000_000.0) + "M"
    abs(n) >= 10_000 -> "$${n / 1000}k"
    else -> money(n)
}

// ── played out ──────────────────────────────────────────────────────────────

@Composable
private fun EmptyHistory() {
    val p = P.current
    Panel(padding = 22.dp) {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon("dice", size = 38.dp, tint = p.ink3)
            Text("No games yet", color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Text(
                "Play a match — your wins (and your bankruptcies) land here.",
                color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * One finished game. Records filed before the outcome was kept only have the
 * win flag; and a table nobody finished has no winner and no turn count to
 * quote — "Nobody · 0 turns" would invent a result that never happened.
 */
@Composable
private fun MatchRow(match: MatchRecord) {
    val p = P.current
    val unfinished = (match.outcome ?: if (match.won) "won" else "lost") == "left"
    val seats = "${match.players.size} player${if (match.players.size == 1) "" else "s"}"
    val line = if (unfinished) {
        "Left before the end · $seats"
    } else {
        "${match.winner} · $seats" +
            if (match.turns > 0) " · ${match.turns} turn${if (match.turns == 1) "" else "s"}" else ""
    }

    Panel(padding = 13.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(mapGlyph(match.mapIcon), size = 26.dp, tint = p.ink2)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        match.mapName,
                        modifier = Modifier.weight(1f, fill = false),
                        color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.Bold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        if (unfinished) "LEFT" else if (match.won) "WON" else "LOST",
                        color = if (match.won) p.accentInk else p.ink3,
                        fontSize = 8.sp, fontWeight = FontWeight.Black, letterSpacing = 0.8.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(99.dp))
                            .background(if (match.won) p.gold else p.sunken)
                            .padding(horizontal = 6.dp, vertical = 2.5.dp),
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (!unfinished) {
                        Icon("trophy", size = 12.dp)
                        Spacer(Modifier.width(4.dp))
                    }
                    Text(
                        line,
                        color = p.ink2, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    relativeNamed(match.date),
                    color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.Medium,
                )
            }
            if (!match.won) {
                // iOS's twelve either side of a Spacer that keeps eight.
                Spacer(Modifier.width(32.dp))
                Text(
                    money(match.myWorth),
                    color = if (match.myWorth > 0) p.good else p.bad,
                    fontSize = 13.sp, fontWeight = FontWeight.ExtraBold,
                )
            }
        }
    }
}

/**
 * How long ago, in the words iOS's named relative dates use — "now", "30
 * seconds ago", "5 minutes ago", "yesterday", "last week" — so a row reads
 * the same sentence on both phones rather than one of them printing a
 * calendar date. Like iOS it names the largest unit that has passed, so a
 * table left half a minute ago says so rather than claiming "now".
 */
private fun relativeNamed(then: Long, now: Long = System.currentTimeMillis()): String {
    val s = (now - then) / 1000
    val day = 86_400L
    fun ago(n: Long, unit: String) = "$n $unit${if (n == 1L) "" else "s"} ago"
    return when {
        s < 1 -> "now"
        s < 60 -> ago(s, "second")
        s < 3_600 -> ago(s / 60, "minute")
        s < day -> ago(s / 3_600, "hour")
        s < 2 * day -> "yesterday"
        s < 7 * day -> ago(s / day, "day")
        s < 14 * day -> "last week"
        s < 30 * day -> ago(s / (7 * day), "week")
        s < 60 * day -> "last month"
        s < 365 * day -> ago(s / (30 * day), "month")
        s < 730 * day -> "last year"
        else -> ago(s / (365 * day), "year")
    }
}
