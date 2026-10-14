package com.moneymove.game

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The middle of the board: whatever the whole table is looking at right now.
 *
 * iOS's CenterWell, phase for phase. An auction takes the middle for every
 * seat, not just the one that rolled — the whole room bids, so the box sits
 * where the whole room looks. A lobby shows the board it is about to be, a
 * finished game who took it, and a game in play shows the dice over the
 * table's own murmur: the last few log lines, ghosted, with a History chip in
 * the corner for the whole story.
 *
 * A board with an empty middle reads as a board that has not loaded. The dice
 * live here because that is where everyone at a real table looks when they
 * are thrown, and because the number has to land in the eye before the piece
 * starts walking — `Choreography.DICE_LEAD` is the pause that buys it.
 *
 * `actionsInWell` is the tablet tabletop: the whole dock sits inside the well,
 * dead-centre, where everyone around the table can reach it. A phone leaves it
 * off and hangs the dock under the board.
 */
@Composable
fun CenterWell(
    store: GameStore,
    modifier: Modifier = Modifier,
    actionsInWell: Boolean = false,
    onHistory: () -> Unit = { store.openLog() },
) {
    val state = store.state ?: return
    val auction = state.auction

    Box(modifier.padding(8.dp)) {
        when {
            // An auction born of a landing waits behind the curtain until that
            // walk finishes — every viewer watches the same piece arrive
            // first, and the well shows the dice until it does.
            auction != null && !store.auctionCurtained -> AuctionBox(
                store, auction,
                Modifier
                    .align(Alignment.Center)
                    // Room for the clocks, which ride above every phase of
                    // the well rather than vanishing under a bid.
                    .padding(top = if (hasClockRow(state)) 26.dp else 0.dp),
            )

            state.isLobby -> LobbyWell(state, Modifier.align(Alignment.Center))

            // Who took it waits for the walk that settled it: until the
            // fanfare, the well is still the table in play.
            state.isEnded && !store.gameOverHeld ->
                EndedWell(store, state, showResults = actionsInWell, Modifier.align(Alignment.Center))

            else -> PlayingWell(store, state, actionsInWell, onHistory)
        }

        // The server puts a deadline on every turn — the house's seats
        // included — so the clock is a fixture of the table. It hangs off the
        // whole well rather than the dice, because an auction replaces the
        // dice and the clock must not blink out with them.
        //
        // A timed table's game clock rides beside it, the whole game's time
        // next to this turn's, and an eye counts whoever is watching from the
        // rail. One row, so the three never stack down into the dice.
        if (state.isPlaying) {
            Row(
                Modifier.align(Alignment.TopCenter).padding(top = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                GameClock(state.gameClock, timeUp = state.timeUp == true)
                TurnClock(state.turn?.endsAt)
                WatchersChip(state.watcherCount)
            }
        }
    }
}

/** Whether anything rides the top of the well — the auction box makes room for it. */
private fun hasClockRow(state: GameState): Boolean =
    state.turn?.endsAt != null || state.gameClock != null || state.watcherCount > 0

// ── in play ────────────────────────────────────────────────────────────────

/**
 * The dice on their plate, over the log running quietly across the whole
 * well. The feed is deliberately ghosted — background murmur, not a wall of
 * text competing with the board — and the History chip is the way into all
 * of it.
 */
@Composable
private fun BoxScope.PlayingWell(
    store: GameStore,
    state: GameState,
    actionsInWell: Boolean,
    onHistory: () -> Unit,
) {
    val p = P.current
    BoxWithConstraints(Modifier.matchParentSize()) {
        val wide = maxWidth
        WellFeed(store, Modifier.fillMaxSize())

        Column(
            Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        ) {
            val dice = state.turn?.dice
            // A bankrupt player at a "player decides" table is choosing what
            // happens to their streets, and the whole table waits on it — so
            // the middle says who, and how long they have, where the dice
            // were. Their own phone asks them over the whole screen instead.
            val deciding = store.othersBankruptChoice
            if (deciding != null) {
                DecidingCard(store, deciding, compact = !actionsInWell && wide < 300.dp)
            } else if (dice != null && dice.size == 2) {
                val die = (wide * 0.17f).coerceIn(44.dp, 76.dp)
                val plate = RoundedCornerShape(24.dp)
                Box(
                    Modifier
                        .shadow(18.dp, plate, clip = false, ambientColor = PLATE_SHADOW, spotColor = PLATE_SHADOW)
                        .clip(plate)
                        .background(p.boardBG.copy(alpha = 0.92f))
                        .padding(vertical = die * 0.30f, horizontal = die * 0.42f),
                ) {
                    DicePair(dice[0], dice[1], rollId = state.turn?.rolledThisTurn == true, size = die)
                }
            }
            val pot = state.vacationPot ?: 0
            if (state.settings.vacationCash == true && pot > 0) {
                Row(
                    Modifier
                        .clip(RoundedCornerShape(99.dp))
                        .background(p.goldSoft)
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon("island", size = 13.dp)
                    Text(money(pot), color = p.gold, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold)
                }
            }

            // The tabletop: roll, buy and end turn live right here, in the
            // middle of the table.
            if (actionsInWell) {
                ActionPanel(
                    store, state,
                    modifier = Modifier.widthIn(max = minOf(wide * 0.74f, 470.dp)),
                )
            }
        }

        HistoryChip(onHistory, Modifier.align(Alignment.BottomEnd))
    }
}

/**
 * The table's running commentary, behind the dice. Only what has been said
 * since kick-off: a game opens on a quiet table and fills as it goes, instead
 * of dumping the lobby's backlog all at once. Newest at the bottom, the older
 * lines running off the top under a fade, the whole of it at half strength.
 *
 * Read off the log as the store shows it, not as the server sent it: the
 * rent a walk has not reached yet is not murmured here either (see the purse
 * ledger in GameStore.kt).
 */
@Composable
private fun WellFeed(store: GameStore, modifier: Modifier) {
    val floor = store.logFloor
    val lines = store.shownLog.filter { it.at > floor }.takeLast(12)
    Box(
        modifier
            .clipToBounds()
            .graphicsLayer {
                alpha = 0.5f
                // The fade is a mask, and a mask needs a layer of its own to
                // cut into, or it cuts into the board underneath too.
                compositingStrategy = CompositingStrategy.Offscreen
            }
            .drawWithContent {
                drawContent()
                drawRect(FEED_FADE, blendMode = BlendMode.DstIn)
            },
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .align(Alignment.BottomStart)
                // Measured at full height and pinned to the bottom, so the
                // lines that do not fit leave by the top, the way a feed
                // scrolled to its newest line does.
                .wrapContentHeight(Alignment.Bottom, unbounded = true)
                .padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for (line in lines) key(line.key) { FeedLine(line) }
        }
    }
}

@Composable
private fun FeedLine(line: LogLine) {
    val p = P.current
    val turn = line.kind == "turn"
    Row(verticalAlignment = Alignment.Top) {
        Box(Modifier.width(12.dp).padding(top = 3.dp), contentAlignment = Alignment.Center) {
            FeedMark(line.kind)
        }
        Spacer(Modifier.width(6.dp))
        // The font's own leading, as iOS sets the line: no fixed height.
        Text(
            line.text,
            color = if (turn) p.ink else p.ink2,
            fontSize = 11.5.sp,
            fontWeight = if (turn) FontWeight.Bold else FontWeight.Medium,
        )
    }
}

/**
 * The mark at the head of a line: iOS's SF symbol for each kind, in iOS's
 * feed colours.
 *
 * iOS paints each kind of line one fixed hue whatever the table's style, so
 * these are fixed too rather than read from the palette — the same line is
 * the same colour on both phones at one table. Every one is iOS's own shape:
 * where iOS's mark is a filled shape with a hole through it — the rent house
 * and its door, the warning triangle and its "!", the surprise coin and its
 * "?" — a glyph of that shape is cut out the same way; the turn's play
 * triangle, the trade's passing arrows and the bankrupt's crossed octagon
 * are drawn in ActionPanel.kt; and the few the drawn set has nothing like —
 * the dollar coin, the cart, the gift, the die showing five, the hammer and
 * the hammer in its disc, the person with a plus or a minus — are drawn here
 * ([FeedSymbol]). A kind iOS has no mark for gets its plain dot.
 */
@Composable
private fun FeedMark(kind: String) {
    val p = P.current
    val size = 9.dp
    when (kind) {
        "dice" -> FeedSymbol(Sym.DIE_FIVE, size, FEED_DICE)
        "money" -> FeedSymbol(Sym.DOLLAR_COIN, size, FEED_MONEY)
        "rent" -> CutoutGlyph("house", size, FEED_RED)
        "buy" -> FeedSymbol(Sym.CART, size, FEED_BLUE)
        "turn" -> PlayTriangle(8.dp, FEED_GOLD)
        "jail", "warn" -> CutoutGlyph("warning", size, FEED_ORANGE)
        "bankrupt" -> OctagonCross(size, FEED_RED)
        "auction" -> FeedSymbol(Sym.HAMMER, size, FEED_GOLD)
        "trade" -> SwapArrows(size, FEED_GOLD, flipped = true)
        "system" -> CutoutGlyph("sparkle", size, FEED_SYSTEM, holes = false)
        "treasure" -> FeedSymbol(Sym.GIFT, size, FEED_ORANGE)
        // questionmark.circle.fill: the drawn "question" is a disc with the
        // "?" and its dot on it, so cutting them through gives iOS's mark.
        "surprise" -> CutoutGlyph("question", size, FEED_PINK)
        "build" -> FeedSymbol(Sym.HAMMER_DISC, size, FEED_BLUE)
        // building.columns.fill, one solid silhouette.
        "mortgage" -> CutoutGlyph("bank", size, FEED_QUIET, holes = false)
        "join" -> FeedSymbol(Sym.PERSON_PLUS, size, FEED_QUIET)
        "leave" -> FeedSymbol(Sym.PERSON_MINUS, size, FEED_QUIET)
        else -> Box(Modifier.size(8.dp).clip(CircleShape).background(p.ink3))
    }
}

/** The SF symbols iOS's feed uses that the drawn set has no shape for. */
private enum class Sym { DOLLAR_COIN, CART, GIFT, DIE_FIVE, HAMMER, HAMMER_DISC, PERSON_PLUS, PERSON_MINUS }

/**
 * One of iOS's feed symbols, drawn on the 32 grid the glyph set uses: solid in
 * [tint], with the marks iOS cuts through a `.fill` symbol cut clean through
 * here too, on a layer of its own so a hole goes no further than the mark.
 */
@Composable
private fun FeedSymbol(sym: Sym, size: Dp, tint: Color) {
    Canvas(Modifier.size(size).graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }) {
        val k = this.size.minDimension / 32f
        scale(k, k, pivot = Offset.Zero) {
            fun hole(path: Path, width: Float) = drawPath(
                path, Color.Black, blendMode = BlendMode.Clear,
                style = Stroke(width, cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
            fun hammer(colour: Color, blend: BlendMode) {
                // A claw hammer lying corner to corner: the head up and to the
                // left, the handle running down to the right.
                rotate(45f, pivot = Offset(16f, 16f)) {
                    drawRoundRect(colour, Offset(8.5f, 5f), Size(15f, 6.2f), CornerRadius(1.6f), blendMode = blend)
                    drawRoundRect(colour, Offset(14.4f, 10f), Size(3.2f, 18f), CornerRadius(1.6f), blendMode = blend)
                }
            }
            when (sym) {
                Sym.DOLLAR_COIN -> {
                    drawCircle(tint, 14f, Offset(16f, 16f))
                    hole(pathOf("M16 7.8v16.4"), 2.6f)
                    hole(pathOf("M20.2 12.4c-.9-1.4-2.4-2.2-4.2-2.2-2.4 0-4.1 1.3-4.1 3.2 0 4.4 8.4 2.1 8.4 6.5 0 2-1.8 3.3-4.3 3.3-2 0-3.6-.9-4.5-2.3"), 2.6f)
                }
                Sym.CART -> {
                    drawPath(pathOf("M2.5 5.5h4l3.6 16.2h15.6"), tint, style = Stroke(2.8f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                    drawPath(pathOf("M7.6 8.4h21.2l-2.6 10.6H9.9z"), tint)
                    drawCircle(tint, 2.7f, Offset(11.6f, 26.6f))
                    drawCircle(tint, 2.7f, Offset(23.8f, 26.6f))
                }
                Sym.GIFT -> {
                    drawRoundRect(tint, Offset(3.5f, 10.5f), Size(25f, 6f), CornerRadius(1.6f))
                    drawRoundRect(tint, Offset(5.5f, 17.8f), Size(21f, 11.2f), CornerRadius(1.6f))
                    // The ribbon is the gap down the middle, lid and box both.
                    drawRect(Color.Black, Offset(14.9f, 10f), Size(2.2f, 19.5f), blendMode = BlendMode.Clear)
                    drawPath(pathOf("M16 10.2c-1.6-4.4-7.6-5.6-7.6-2.2 0 2.2 4 2.2 7.6 2.2z"), tint, style = Stroke(2.4f, join = StrokeJoin.Round))
                    drawPath(pathOf("M16 10.2c1.6-4.4 7.6-5.6 7.6-2.2 0 2.2-4 2.2-7.6 2.2z"), tint, style = Stroke(2.4f, join = StrokeJoin.Round))
                }
                Sym.DIE_FIVE -> {
                    drawRoundRect(tint, Offset(3f, 3f), Size(26f, 26f), CornerRadius(6.5f))
                    for ((x, y) in listOf(10f to 10f, 22f to 10f, 16f to 16f, 10f to 22f, 22f to 22f)) {
                        drawCircle(Color.Black, 2.6f, Offset(x, y), blendMode = BlendMode.Clear)
                    }
                }
                Sym.HAMMER -> hammer(tint, BlendMode.SrcOver)
                Sym.HAMMER_DISC -> {
                    drawCircle(tint, 14f, Offset(16f, 16f))
                    scale(0.62f, 0.62f, pivot = Offset(16f, 16f)) { hammer(Color.Black, BlendMode.Clear) }
                }
                Sym.PERSON_PLUS, Sym.PERSON_MINUS -> {
                    drawCircle(tint, 5.4f, Offset(12.4f, 10.4f))
                    drawPath(pathOf("M2.8 27.4c0-5.3 4.3-9.4 9.6-9.4s9.6 4.1 9.6 9.4z"), tint)
                    // The badge sits clear of the figure, as SF's does.
                    drawCircle(Color.Black, 6.6f, Offset(25f, 12f), blendMode = BlendMode.Clear)
                    drawLine(tint, Offset(21.2f, 12f), Offset(28.8f, 12f), 2.8f, StrokeCap.Round)
                    if (sym == Sym.PERSON_PLUS) drawLine(tint, Offset(25f, 8.2f), Offset(25f, 15.8f), 2.8f, StrokeCap.Round)
                }
            }
        }
    }
}

private val feedPaths = HashMap<String, Path>()

private fun pathOf(d: String): Path = feedPaths.getOrPut(d) { PathParser().parsePathString(d).toPath() }

/** iOS's ActivityFeed hues, one per kind of line. */
private val FEED_DICE = Color(0xFF8B5CF6)
private val FEED_MONEY = Color(0xFF4ADE80)
private val FEED_RED = Color(0xFFFB7185)
private val FEED_BLUE = Color(0xFF60A5FA)
private val FEED_GOLD = Color(0xFFFBBF24)
private val FEED_ORANGE = Color(0xFFFB923C)
private val FEED_SYSTEM = Color(0xFFF04156)
private val FEED_PINK = Color(0xFFF472B6)
private val FEED_QUIET = Color(0xFF94A3B8)

/** Clear at the top, most of the way in by a third, whole at the bottom. */
private val FEED_FADE = Brush.verticalGradient(
    0f to Color.Transparent,
    0.3f to Color.Black.copy(alpha = 0.55f),
    1f to Color.Black,
)

private val PLATE_SHADOW = Color.Black.copy(alpha = 0.35f)

/** The whole game log, one tap away from its ghost. */
@Composable
private fun HistoryChip(onHistory: () -> Unit, modifier: Modifier = Modifier) {
    val p = P.current
    val shape = RoundedCornerShape(99.dp)
    Row(
        modifier
            .padding(10.dp)
            .clip(shape)
            .background(p.card.copy(alpha = 0.92f))
            .border(1.dp, p.rule, shape)
            .clickable {
                onHistory()
                Haptics.tap()
            }
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon(GlyphFor.HISTORY, size = 11.dp, tint = p.ink2)
        Text("History", color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

// ── the lobby, and the end ─────────────────────────────────────────────────

/**
 * The board the table is about to play, and a dot per chair filled with each
 * player's colour. A matchmade table waits undealt, so its deck sits here on
 * the table, idly riffling, until kick-off deals it out.
 */
@Composable
private fun LobbyWell(state: GameState, modifier: Modifier) {
    val p = P.current
    Column(
        modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (state.quick == true) IdleDeck(Modifier.padding(bottom = 4.dp))
        Icon(mapGlyph(state.map.icon), size = 28.dp)
        // No line limit, as on iOS: a long board name wraps before anything
        // else happens to it.
        Text(
            state.map.name,
            color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        // The lobby always shows the printed board; at a table set to
        // shuffle, the layout everybody sees here is not the one they will
        // play, so the well says so before the dice do.
        if (state.settings.shuffleBoard == true && state.hostSetsRules) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon("shuffle", size = 11.dp, tint = p.ink3)
                Text("Shuffled at the start", color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (i in 0 until state.settings.maxPlayers) {
                val seat = state.players.getOrNull(i)
                if (seat != null) {
                    Box(
                        Modifier
                            .size(11.dp)
                            .clip(CircleShape)
                            .background(cssColor(seat.color, p.ink3))
                            .border(1.dp, Color.White.copy(alpha = 0.6f), CircleShape),
                    )
                } else {
                    Box(Modifier.size(11.dp).dashedBorder(p.rule2, width = 1.5.dp, cornerRadius = 5.5.dp, dash = 3.dp, gap = 3.dp))
                }
            }
        }
        Text(
            "${state.players.size} of ${state.settings.maxPlayers} seats",
            color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium,
        )
    }
}

/**
 * Who took the table, in iOS's words: the winner's name, or "Nobody". The way
 * back to the standings rides here only on the tabletop, where there is no
 * dock under the board to carry it.
 */
@Composable
private fun EndedWell(store: GameStore, state: GameState, showResults: Boolean, modifier: Modifier) {
    val p = P.current
    val who = state.winner?.name ?: "Nobody"
    Column(
        modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon("trophy", size = 36.dp)
        // Decided on the clock: say so first, or "Asha wins!" reads as
        // though everybody else went bankrupt.
        if (state.endedOnClock) TimesUpTag()
        Text(
            "$who wins!",
            color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold,
            textAlign = TextAlign.Center,
        )
        if (showResults) {
            MMButton("Final standings", Modifier.padding(top = 2.dp), kind = BtnKind.GHOST, icon = "trophy") {
                store.openResults()
                Haptics.tap()
            }
        }
    }
}

// ── the auction ────────────────────────────────────────────────────────────

/**
 * The auction, for every seat at the table — one card for an ordinary
 * auction and for a lot from a bankrupt player's estate (1.0.7, H1).
 *
 * Read top to bottom it answers what a bidder asks, in that order: what kind
 * of sale this is (and for an estate, whose, and how far through it is);
 * what is under the hammer, as a little deed — its colour, its mark, its
 * name, the printed price and the rent that makes it worth having; where
 * the bidding stands and who holds it, beside a ring that says how long is
 * left; and what this seat can do about it — a row of paddles and a Pass,
 * or a pill that says why not. An estate ends on the streets still to come.
 *
 * The server lets anyone still in the race bid, not just the player who
 * turned the street down, so this never asks whose turn it is. On a pass &
 * play phone with more than one seat still racing, a chip per seat says
 * whose paddle the buttons are; otherwise the store picks the seat.
 *
 * It is paper on the felt — a card laid on the table — and it measures the
 * well it is given: a phone's is a couple of hundred points high once the
 * clocks have their row, so the card tightens to fit rather than spilling
 * over the tiles, and on a tablet it opens out.
 */
@Composable
private fun AuctionBox(store: GameStore, auction: AuctionState, modifier: Modifier) {
    val p = P.current
    // Whoever picked up a paddle by hand. Dropped the moment that seat leaves
    // the race, so it can never bid for a ghost; a new street starts clean.
    var chosen by remember(auction.tile) { mutableStateOf<String?>(null) }
    LaunchedEffect(auction.inRace) {
        if (chosen != null && chosen !in auction.inRace) chosen = null
    }
    val racers = store.auctionRacers
    val progress = store.estateProgress(auction)

    // The card is laid down rather than switched on: a short rise and settle
    // as the hammer comes up. Under Reduce Motion it is simply there.
    val reduceMotion = rememberReduceMotion()
    val rise = remember { Animatable(if (reduceMotion) 1f else 0f) }
    LaunchedEffect(Unit) { rise.animateTo(1f, spring(dampingRatio = 0.8f, stiffness = 420f)) }

    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val fit = when {
            maxHeight < 226.dp -> AuctionFit.COMPACT
            maxHeight < 300.dp || maxWidth < 300.dp -> AuctionFit.TIGHT
            else -> AuctionFit.ROOMY
        }
        val shape = MMShapes.r18
        Column(
            Modifier
                .widthIn(max = 400.dp)
                .fillMaxWidth()
                .graphicsLayer {
                    val t = rise.value
                    alpha = t.coerceIn(0f, 1f)
                    scaleX = 0.94f + 0.06f * t
                    scaleY = 0.94f + 0.06f * t
                    translationY = (1f - t) * 10.dp.toPx()
                }
                .shadow(14.dp, shape, clip = false, ambientColor = PLATE_SHADOW, spotColor = PLATE_SHADOW)
                .background(p.card, shape)
                .border(1.dp, p.rule, shape)
                .padding(
                    horizontal = if (fit == AuctionFit.ROOMY) 16.dp else 11.dp,
                    vertical = if (fit == AuctionFit.ROOMY) 14.dp else 9.dp,
                ),
            verticalArrangement = Arrangement.spacedBy(if (fit == AuctionFit.ROOMY) 10.dp else 6.dp),
        ) {
            AuctionHeader(store, auction, progress, fit)
            LotDeed(store, auction.tile, fit)
            BidLine(store, auction, chosen, fit)

            if (racers.size > 1) {
                SeatChipRow(
                    seats = racers.mapNotNull { store.state?.player(it) },
                    selected = store.biddingSeat(chosen),
                ) { chosen = it }
            }

            PaddleRow(store, auction, chosen, racers.size, fit)

            if (auction.estate != null && fit != AuctionFit.COMPACT) UpNext(store, auction, progress)
        }
    }
}

/** How much room the well gave the card: the clocks' row on a small phone leaves very little. */
private enum class AuctionFit { COMPACT, TIGHT, ROOMY }

/**
 * The gavel and the kind of sale. An estate lot says whose estate it is,
 * with their face, and how far through it the table is: a pip per lot and
 * "Lot 2 of 4" — given up, as the row runs out of room, in that order.
 */
@Composable
private fun AuctionHeader(store: GameStore, auction: AuctionState, progress: EstateProgress?, fit: AuctionFit) {
    val p = P.current
    val estate = auction.estate
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon("gavel", size = 14.dp, tint = p.gold)
        Text(
            if (estate != null) "ESTATE SALE" else "AUCTION",
            color = p.gold, fontSize = 10.5.sp, fontWeight = FontWeight.Black, letterSpacing = 1.4.sp,
            maxLines = 1, softWrap = false,
        )
        if (estate == null) {
            Spacer(Modifier.weight(1f))
            // At an auction-only table nobody saw a Buy button; say why the
            // hammer is up rather than leave it to the log.
            if (store.state?.isAuctionOnly == true) {
                Text(
                    "Auction-only table",
                    color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            return@Row
        }
        // The bankrupt seat stays in the roster, so its face is still there to show.
        val who = store.state?.players?.let { all ->
            all.firstOrNull { it.name == estate.from && it.isBankrupt } ?: all.firstOrNull { it.name == estate.from }
        }
        AvatarDisc(estate.from, who?.color, size = 17.dp, avatar = who?.avatar)
        // The smallest card never draws pips: their room goes to the name.
        NameAndLot(
            estate.from.ifBlank { "A bankrupt player" }, progress, estate.left,
            pips = fit != AuctionFit.COMPACT, modifier = Modifier.weight(1f),
        )
    }
}

/**
 * The bankrupt player's name and the sale's count, sharing what the header
 * has left. The count reads "Lot 2 of 4" beside its pips wherever that still
 * leaves the name whole — or, for a long one, [NAME_FLOOR] of it before the
 * ellipsis. Short of that it gives up the pips first, then the words, for
 * "2/4": measured, so a phone with the room says it in full.
 */
@Composable
private fun NameAndLot(name: String, progress: EstateProgress?, left: Int, pips: Boolean, modifier: Modifier) {
    val p = P.current
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val nameStyle = LocalTextStyle.current.merge(TextStyle(fontSize = 11.5.sp, fontWeight = FontWeight.Bold))
    val countStyle = LocalTextStyle.current.merge(TABULAR).merge(TextStyle(fontSize = 10.5.sp, fontWeight = FontWeight.ExtraBold))
    BoxWithConstraints(modifier) {
        val lot = progress?.lot
        val total = progress?.total
        val room = constraints.maxWidth
        // Pips with words, words alone, pips with the short count, the short
        // count alone: the first that fits is the one drawn.
        val (dots, words) = remember(name, lot, total, left, pips, room, nameStyle, countStyle) {
            val ladder = listOf(true to true, false to true, true to false, false to false)
                .filter { (dots, _) -> pips || !dots }
            if (!constraints.hasBoundedWidth) return@remember ladder.first()
            with(density) {
                val want = minOf(
                    measurer.measure(name, nameStyle, maxLines = 1, softWrap = false).size.width,
                    NAME_FLOOR.roundToPx(),
                )
                ladder.firstOrNull { (dots, words) ->
                    val count = measurer.measure(lotLabel(lot, total, left, words), countStyle, maxLines = 1, softWrap = false).size.width
                    val marks = if (dots && lot != null && total != null) pipsWidth(total) else 0.dp
                    val strip = if (marks > 0.dp) marks.roundToPx() + LOT_GAP.roundToPx() else 0
                    want + NAME_GAP.roundToPx() + strip + count <= room
                } ?: ladder.last()
            }
        }
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(NAME_GAP),
        ) {
            Text(
                name,
                modifier = Modifier.weight(1f),
                color = p.ink2, fontSize = 11.5.sp, fontWeight = FontWeight.Bold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            LotCount(progress, left, words = words, pips = dots)
        }
    }
}

/** Between the bankrupt player's name and the count, as the header spaces everything. */
private val NAME_GAP = 6.dp

/** As much of a long name as the count leaves before it settles for "2/4". */
private val NAME_FLOOR = 72.dp

/** Between the pips (or the bar) and the count's words. */
private val LOT_GAP = 5.dp

/** One pip; the lot under the hammer now is the larger; and the gap between two. */
private val LOT_PIP = 5.dp
private val LOT_PIP_NOW = 7.dp
private val LOT_PIP_GAP = 3.dp

/** A sale too long for pips draws a bar this wide instead. */
private val LOT_BAR = 34.dp

/** How wide [LotCount] draws the pips for a sale of [total] lots: nothing for one lot. */
private fun pipsWidth(total: Int): Dp = when {
    total in 2..8 -> LOT_PIP * (total - 1) + LOT_PIP_NOW + LOT_PIP_GAP * (total - 1)
    total > 8 -> LOT_BAR
    else -> 0.dp
}

/**
 * The count's words: "Lot 2 of 4", or "2/4" without [words]. A sale this
 * phone never saw start says only what the server does, how many are left.
 */
private fun lotLabel(lot: Int?, total: Int?, left: Int, words: Boolean): String = when {
    lot != null && total != null -> if (words) "Lot $lot of $total" else "$lot/$total"
    left <= 0 -> "Last lot"
    else -> "$left more"
}

/**
 * Where the sale has got to: a pip per lot — the ones gone, this one, the
 * ones to come — and the count. A sale too long for pips gets a thin bar; a
 * sale this phone never saw start says only what the server does, how many
 * are left.
 */
@Composable
private fun LotCount(progress: EstateProgress?, left: Int, words: Boolean, pips: Boolean) {
    val p = P.current
    val lot = progress?.lot
    val total = progress?.total
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(LOT_GAP)) {
        if (lot != null && total != null && pips) {
            if (total in 2..8) {
                Row(horizontalArrangement = Arrangement.spacedBy(LOT_PIP_GAP), verticalAlignment = Alignment.CenterVertically) {
                    for (i in 1..total) {
                        val now = i == lot
                        Box(
                            Modifier
                                .size(if (now) LOT_PIP_NOW else LOT_PIP)
                                .clip(CircleShape)
                                .background(
                                    when {
                                        now -> p.gold
                                        i < lot -> p.gold.copy(alpha = 0.4f)
                                        else -> p.rule2
                                    },
                                ),
                        )
                    }
                }
            } else if (total > 8) {
                Box(Modifier.size(width = LOT_BAR, height = 4.dp).clip(MMShapes.pill).background(p.rule2)) {
                    Box(
                        Modifier
                            .fillMaxHeight()
                            .fillMaxWidth(lot / total.toFloat())
                            .clip(MMShapes.pill)
                            .background(p.gold),
                    )
                }
            }
        }
        // "2/4" is a fraction to a screen reader; it hears the words.
        val label = lotLabel(lot, total, left, words)
        val heard = lotLabel(lot, total, left, words = true)
        Text(
            label,
            modifier = if (label != heard) Modifier.semantics { contentDescription = heard } else Modifier,
            color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.ExtraBold,
            style = LocalTextStyle.current.merge(TABULAR),
            maxLines = 1, softWrap = false,
        )
    }
}

/**
 * What is under the hammer, as a little deed: a band of its colour down the
 * left, its mark, its name, the rent that makes it worth having — or, when
 * it would finish somebody's set, whose — and the printed price, which is
 * what the bidding is measured against. A new lot slides in over the last.
 */
@Composable
private fun LotDeed(store: GameStore, index: Int, fit: AuctionFit) {
    val p = P.current
    AnimatedContent(
        targetState = index,
        transitionSpec = {
            (fadeIn(tween(220, delayMillis = 60)) + slideInHorizontally(tween(260)) { it / 6 }) togetherWith
                (fadeOut(tween(140)) + slideOutHorizontally(tween(200)) { -it / 6 }) using SizeTransform(clip = false)
        },
        label = "lot",
    ) { shown ->
        val tile = store.tile(shown)
        val group = tile?.let { store.groupInfo(it) }
        val colour = deedColour(tile, group)
        val shape = MMShapes.r14
        val roomy = fit == AuctionFit.ROOMY
        Row(
            Modifier
                .fillMaxWidth()
                .clip(shape)
                .background(p.sunken)
                .deedBand(colour, 6.dp)
                .border(1.dp, p.rule, shape)
                .padding(start = 15.dp, end = 11.dp, top = if (roomy) 10.dp else 7.dp, bottom = if (roomy) 10.dp else 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(if (roomy) 11.dp else 9.dp),
        ) {
            LotBadge(tile, group, if (roomy) 32.dp else 25.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                FitText(
                    tile?.name ?: "Property",
                    color = p.ink, fontSize = if (roomy) 17.sp else 14.5.sp, fontWeight = FontWeight.ExtraBold,
                    minScale = 0.7f,
                )
                if (fit != AuctionFit.COMPACT) LotNote(store, tile)
            }
            tile?.price?.let { price ->
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(0.dp)) {
                    Text(
                        "DEED",
                        color = p.ink3, fontSize = 8.5.sp, fontWeight = FontWeight.Black, letterSpacing = 1.sp,
                        maxLines = 1,
                    )
                    Text(
                        money(price),
                        color = p.ink, fontSize = if (roomy) 15.sp else 13.sp, fontWeight = FontWeight.ExtraBold,
                        style = LocalTextStyle.current.merge(TABULAR),
                        maxLines = 1, softWrap = false,
                    )
                }
            }
        }
    }
}

/**
 * The deed's one line of small print: the rent ("Rent $18 · hotel $950"),
 * unless the lot would finish somebody's colour — then that, which matters
 * more to every bidder at the table: green when it is your own set, red
 * when it is a rival's.
 */
@Composable
private fun LotNote(store: GameStore, tile: TileData?) {
    val p = P.current
    val rent = tile?.rentLine
    val set = completes(store, tile)
    val line = buildAnnotatedString {
        if (set != null) {
            append(rent?.substringBefore(" · ") ?: "")
            if (rent != null) append(" · ")
            withStyle(SpanStyle(color = if (set.first) p.good else p.bad, fontWeight = FontWeight.ExtraBold)) {
                append(set.second)
            }
        } else if (rent != null) {
            append(rent)
        }
    }
    if (line.isEmpty()) return
    Text(
        line,
        color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold,
        maxLines = 1, overflow = TextOverflow.Ellipsis,
    )
}

/**
 * Whether this street would finish a colour: every other street of it held
 * by one player still in. (true, "completes your set") for a seat on this
 * phone, (false, "completes Arjun's set") for anybody else; null otherwise.
 */
private fun completes(store: GameStore, tile: TileData?): Pair<Boolean, String>? {
    val s = store.state ?: return null
    if (tile?.type != "property") return null
    val members = s.map.groups?.get(tile.group ?: return null) ?: return null
    val others = members.filter { it != tile.index }
    if (others.isEmpty()) return null
    val owner = s.owner(others.first())?.owner ?: return null
    if (others.any { s.owner(it)?.owner != owner }) return null
    val who = s.player(owner)?.takeIf { !it.isBankrupt } ?: return null
    return if (store.isLocal(owner)) true to "completes your set" else false to "completes ${who.name}'s set"
}

/**
 * Where the bidding stands: the bid, large, and who holds it — or, before
 * anybody has, that nobody has and what it opens at — beside the ring that
 * says how long is left. A seat on this phone holding the top bid is told
 * so in a green pill rather than reading its own name.
 */
@Composable
private fun BidLine(store: GameStore, auction: AuctionState, chosen: String?, fit: AuctionFit) {
    val p = P.current
    val roomy = fit == AuctionFit.ROOMY
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(if (roomy) 5.dp else 3.dp)) {
            val leader = store.auctionLeader
            if (auction.bid > 0 && leader != null) {
                // Each new bid rolls in from below, as a number that went up.
                AnimatedContent(
                    targetState = auction.bid,
                    transitionSpec = {
                        (slideInVertically(tween(220)) { it / 2 } + fadeIn(tween(220))) togetherWith
                            (slideOutVertically(tween(180)) { -it / 2 } + fadeOut(tween(120))) using SizeTransform(clip = false)
                    },
                    label = "bid",
                ) { bid ->
                    Text(
                        money(bid),
                        color = p.gold,
                        fontSize = when (fit) {
                            AuctionFit.ROOMY -> 34.sp
                            AuctionFit.TIGHT -> 27.sp
                            AuctionFit.COMPACT -> 23.sp
                        },
                        fontWeight = FontWeight.ExtraBold,
                        style = LocalTextStyle.current.merge(TABULAR),
                        maxLines = 1, softWrap = false,
                    )
                }
                if (store.isLocal(leader.id)) {
                    StatePill(
                        if (leader.id == store.meId) "You lead" else "${leader.name} leads",
                        PillTone.GOOD, glyph = "check",
                    )
                } else {
                    LeaderChip(leader)
                }
            } else {
                Text(
                    "No bids yet",
                    color = p.ink, fontSize = if (roomy) 22.sp else 18.sp, fontWeight = FontWeight.ExtraBold,
                    maxLines = 1, softWrap = false,
                )
                Text(
                    "Opens at ${money(auction.nextBid)}",
                    color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                )
            }
        }
        // No deadline, no ring: a table with nobody to wait for runs the
        // auction until it is settled, and a ring pinned at nought would lie.
        auction.endsAt?.let { end ->
            CountdownRing(
                end, auction.windowSeconds,
                size = when (fit) {
                    AuctionFit.ROOMY -> 54.dp
                    AuctionFit.TIGHT -> 44.dp
                    AuctionFit.COMPACT -> 38.dp
                },
                stroke = if (roomy) 5.dp else 4.dp,
            )
        }
    }
}

/** "Arjun leads": the leader's face and name in a capsule, the name in their colour's ink. */
@Composable
private fun LeaderChip(leader: PlayerState) {
    val p = P.current
    Row(
        Modifier
            .clip(MMShapes.pill)
            .background(p.sunken)
            .border(1.dp, p.rule, MMShapes.pill)
            .padding(start = 3.dp, end = 10.dp, top = 3.dp, bottom = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        AvatarDisc(leader.name, leader.color, size = 18.dp, avatar = leader.avatar)
        Text(
            "${leader.name} leads",
            color = p.ink, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * What this seat can do: a paddle for each amount it can put up and a Pass,
 * all one row — or, when it cannot bid, the pill that says why. Holding the
 * top bid there is nothing to press but patience; out of the race it is
 * "You passed"; out of the game "You're out"; and from the rail, watching.
 */
@Composable
private fun PaddleRow(store: GameStore, auction: AuctionState, chosen: String?, racers: Int, fit: AuctionFit) {
    val p = P.current
    val seat = store.biddingSeat(chosen)
    val height = if (fit == AuctionFit.ROOMY) 40.dp else 34.dp
    if (seat == null) {
        val alive = store.aliveLocalSeats.isNotEmpty()
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            when {
                store.isSpectating -> StatePill("Watching", PillTone.QUIET, glyph = "eye")
                alive -> StatePill("You passed", PillTone.QUIET)
                else -> StatePill("You're out", PillTone.QUIET)
            }
        }
        return
    }
    if (seat == auction.leader) {
        Text(
            "Anyone still in can outbid you",
            modifier = Modifier.fillMaxWidth(),
            color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
        return
    }
    // Say whose paddle this is when it is not the main seat's. With two
    // racers the chips above already name the bidder.
    if (racers < 2 && seat != store.meId) {
        store.state?.player(seat)?.let { who ->
            Text(
                "Bidding as ${who.name}",
                modifier = Modifier.fillMaxWidth(),
                color = cssColor(who.color, p.ink2), fontSize = 10.5.sp, fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
    }
    val amounts = store.bidSteps(seat)
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (amounts.isEmpty()) {
            Text(
                "${money(auction.nextBid)} is more than you can raise",
                modifier = Modifier.weight(1f),
                color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                lineHeight = 14.sp, maxLines = 2,
            )
        } else {
            for (amount in amounts) {
                Paddle(money(amount), p.gold, p.accentInk, height, Modifier.weight(1f)) {
                    store.bid(amount, seat)
                    Haptics.tap()
                }
            }
        }
        Paddle(
            "Pass", p.sunken, p.bad, height,
            if (amounts.isEmpty()) Modifier.width(78.dp) else Modifier.weight(0.9f),
            outline = p.rule,
        ) { store.passBid(seat) }
    }
}

/**
 * One paddle: a short, wide button that gives under the thumb — a paddle
 * that does not move when pressed feels like the bid did not go. The amount
 * shrinks to fit rather than wrap, so "$1,290" sits on one line in a third
 * of a phone's well.
 */
@Composable
private fun Paddle(
    label: String,
    fill: Color,
    ink: Color,
    height: Dp,
    modifier: Modifier = Modifier,
    outline: Color = Color.White.copy(alpha = 0.18f),
    onClick: () -> Unit,
) {
    val press = remember { MutableInteractionSource() }
    val down by press.collectIsPressedAsState()
    val give by animateFloatAsState(if (down) 0.95f else 1f, spring(dampingRatio = 0.7f), label = "paddle")
    val shape = MMShapes.r10
    Box(
        modifier
            .height(height)
            .graphicsLayer {
                scaleX = give
                scaleY = give
                alpha = if (down) 0.85f else 1f
            }
            .clip(shape)
            .background(fill)
            .border(1.dp, outline, shape)
            .clickable(interactionSource = press, indication = null, role = Role.Button) { onClick() }
            .padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        FitText(label, color = ink, fontSize = 13.5.sp, fontWeight = FontWeight.ExtraBold, minScale = 0.7f)
    }
}

/**
 * An estate's next lots, by name, so the table knows what it is saving its
 * money for — "Up next  Rome · Venice". A phone that did not see the estate
 * go only knows how many, and says that.
 */
@Composable
private fun UpNext(store: GameStore, auction: AuctionState, progress: EstateProgress?) {
    val p = P.current
    val estate = auction.estate ?: return
    val names = progress?.upNext.orEmpty().mapNotNull { store.tile(it)?.name }
    val line = buildAnnotatedString {
        when {
            names.isNotEmpty() -> {
                withStyle(SpanStyle(color = p.ink2, fontWeight = FontWeight.ExtraBold)) { append("Up next  ") }
                append(names.joinToString(" · "))
                val more = estate.left - names.size
                if (more > 0) append(" · +$more")
            }
            estate.left <= 0 -> append("The last lot of ${estate.from.ifBlank { "this" }}'s estate")
            estate.left == 1 -> append("1 more lot after this")
            else -> append("${estate.left} more lots after this")
        }
    }
    Text(
        line,
        modifier = Modifier.fillMaxWidth(),
        color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
        maxLines = 1, overflow = TextOverflow.Ellipsis,
    )
}

/**
 * One chip per seat on this phone still racing. Tap a chip and the paddles
 * below speak for that player — the chat composer wears the same row, so
 * picking who a shared phone speaks for reads the same everywhere.
 */
@Composable
private fun SeatChipRow(seats: List<PlayerState>, selected: String?, choose: (String) -> Unit) {
    val p = P.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally)) {
        for (seat in seats) {
            val on = seat.id == selected
            val colour = cssColor(seat.color, p.ink3)
            val shape = RoundedCornerShape(99.dp)
            Row(
                Modifier
                    .clip(shape)
                    .background(if (on) p.sunken else Color.Transparent)
                    .border(if (on) 1.5.dp else 1.dp, if (on) colour else p.rule, shape)
                    .clickable {
                        choose(seat.id)
                        Haptics.tap()
                    }
                    .padding(horizontal = 6.dp, vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Box(Modifier.size(13.dp).clip(CircleShape).background(colour), contentAlignment = Alignment.Center) {
                    Text(
                        (seat.name.firstOrNull() ?: '?').uppercase(),
                        color = Color.White, fontSize = 8.sp, fontWeight = FontWeight.ExtraBold,
                        maxLines = 1, softWrap = false,
                    )
                }
                Text(
                    seat.name,
                    color = if (on) p.ink else p.ink3, fontSize = 9.5.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

// ── the dice ───────────────────────────────────────────────────────────────

/**
 * Two dice, thrown.
 *
 * They land rather than appear — swung in from a tilt and a little small, on
 * a spring — because a number that simply replaces the last one is a label,
 * and this is supposed to be a throw. iOS's DiceView, at its angle and scale.
 */
@Composable
private fun DicePair(a: Int, b: Int, rollId: Boolean, size: Dp) {
    val land = remember { Animatable(1f) }
    LaunchedEffect(a, b, rollId) {
        land.snapTo(0f)
        // iOS's spring(duration: 0.45, bounce: 0.45): a damping ratio of
        // 1 − 0.45 and a stiffness of (2π / 0.45)².
        land.animateTo(1f, spring(dampingRatio = 0.55f, stiffness = 195f))
    }
    Row(
        Modifier.graphicsLayer {
            val t = land.value
            rotationZ = (1f - t) * -18f
            val s = 0.6f + 0.4f * t
            scaleX = s
            scaleY = s
        },
        horizontalArrangement = Arrangement.spacedBy(size * 0.28f),
    ) {
        Die(a, size)
        Die(b, size)
    }
}

@Composable
private fun Die(value: Int, size: Dp) {
    val shape = RoundedCornerShape(size * 0.24f)
    Box(
        Modifier
            .size(size)
            .shadow(size * 0.12f, shape, clip = false, ambientColor = PLATE_SHADOW, spotColor = PLATE_SHADOW)
            .clip(shape)
            .background(Brush.verticalGradient(listOf(Color.White, DIE_FOOT))),
    ) {
        Canvas(Modifier.size(size)) {
            val s = this.size.minDimension
            val r = s * 0.0835f
            // iOS's three-by-three pip grid: a sixth of the face in from each
            // side, the pips a sixth wide with a tenth between them.
            val lo = s * 0.238f
            val mid = s * 0.5f
            val hi = s * 0.762f
            val pips: List<Pair<Float, Float>> = when (value) {
                1 -> listOf(mid to mid)
                2 -> listOf(lo to lo, hi to hi)
                3 -> listOf(lo to lo, mid to mid, hi to hi)
                4 -> listOf(lo to lo, hi to lo, lo to hi, hi to hi)
                5 -> listOf(lo to lo, hi to lo, mid to mid, lo to hi, hi to hi)
                6 -> listOf(lo to lo, hi to lo, lo to mid, hi to mid, lo to hi, hi to hi)
                else -> emptyList()
            }
            for ((x, y) in pips) {
                drawCircle(PIP, radius = r, center = Offset(x, y))
            }
        }
    }
}

/** Digits of one width, so a ticking number does not shuffle sideways. */
private val TABULAR = TextStyle(fontFeatureSettings = "tnum")

/** The die's own colours — the felt green pip on warm ivory iOS throws. */
private val DIE_FOOT = Color(0xFFEFE7E2)
private val PIP = Color(0xFF1B5E3F)
