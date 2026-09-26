package com.moneymove.game

import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseIn
import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * A table.
 *
 * iOS's GameScreen, layout for layout. A phone at a live game is two zones:
 * the board high, taking whatever room the controls leave it, and one control
 * cluster at thumb height — the seat strip directly on top of the dock — with
 * the chat bubble floating over the seam. Nothing scrolls the dock away. It
 * used to be one long scrolling column, and the Roll button moved down the
 * page every time somebody sent an offer; a button that moves is a button
 * that gets missed.
 *
 * A lobby keeps the strip above the board and the lobby panel under it, and a
 * tablet plays the board flat as a tabletop: huge in the middle, the dock in
 * its centre well, and a pod in each corner for whoever sits on that side.
 * Which sheet is open and what the table is asking live in the store, so any
 * file can open a deed or a trade and this one draws it.
 *
 * The glass here is in two layers, and the line between them is the design,
 * as it is in the shell (AppScaffold.kt). Below is the table — the bar, the
 * board, the seats, the dock, the chat button — which [MMBackdropHost]
 * records and blurs once for everything above to share. The bar and the dock
 * are glass too, but they sit beside the board rather than over it, with the
 * flat page behind them, where a blur has nothing to add; they are part of
 * what the layer above refracts. Above are the surfaces that genuinely float
 * over the live board — the turn banner, the kick-off headline and a
 * tablet's corner pods — and those sample the copy, which can never contain
 * them, except while a question has put the table out of focus and there is
 * nothing left for a second blur to do. The two full-screen questions are up
 * there as well, but they lay
 * their own paper under the film, as a sheet does, so the tiles never read
 * through the words; and the coins fly over everything, though they are not
 * glass. The shell's own copy is of the whole app and is recorded only while
 * its toast is up; this one is of the table, and only while something here
 * is floating over it.
 *
 * And while the board performs, the copy holds still: see `boardBusy` below.
 */
@Composable
fun GameScreen(store: GameStore, account: AccountStore, onTheme: ((MMTheme) -> Unit)? = null) {
    val p = P.current
    val state = store.state

    // The board dealing itself out at kick-off, and coins flying to the
    // wallet when the earned watermark rises. Both are holders the screen
    // drives rather than things that watch the store themselves.
    val deck = rememberDeckIntro(store)
    val flight = remember { CoinFlight() }
    LaunchedEffect(account.wallet?.earned) { flight.note(account.wallet) }

    // The system back gesture is the back chevron: mid-game it asks, anywhere
    // else it goes. A sheet or a question on screen answers it first.
    BackHandler(enabled = store.sheet == null && store.confirm == null && !store.showGameOver) {
        store.requestLeave()
    }

    // The table is the one screen that can break its frame budget — glass
    // over a board that animates for forty minutes — so it is the one that
    // watches its own frames, and its glass runs at whatever the governor
    // allows. It ships here, with the glass it governs.
    val level = rememberGlassGovernor(LocalGlassLevel.current)

    // Full-screen questions: the chair taken by the clock, and the deadlock
    // rule the one time it applies. While one is up the table behind it goes
    // out of focus rather than under a wall of black.
    val modal = store.timedOut || store.reliefPopup != null

    // The board mid-performance. The shell hears the store's curtain — dice,
    // a walk, a card being read — but two performances happen with no
    // curtain over them, so the table keeps their time itself, as iOS's
    // does: the board dealing itself in at kick-off, and the dice landing on
    // a throw that walks nobody, a prison roll that misses its double. For
    // the length of either the glass stops re-recording what it refracts;
    // the material itself carries on untouched. The deal is read through
    // derived state, so its clock ticking costs this screen nothing until
    // the deal starts or lands. The throw is keyed exactly as the dice
    // themselves land (CenterWell.kt's DicePair) — the pair and whether this
    // turn has rolled — or a throw that comes up with the faces the last turn
    // left on the table would land with the copy still re-recording under it.
    val dealing by remember(deck) { derivedStateOf { deck.dealing } }
    val dice = state?.turn?.dice
    val rolled = state?.turn?.rolledThisTurn == true
    var tumbling by remember { mutableStateOf(false) }
    LaunchedEffect(dice, rolled) {
        tumbling = dice != null
        if (dice != null) {
            delay((Choreography.DICE_LEAD * 1000).toLong())
            tumbling = false
        }
    }
    val boardBusy = LocalBoardBusy.current || dealing || tumbling

    // The shadow's two ends, and what moves it between them: the board
    // mid-move, a sheet risen over the table, a question over the whole
    // screen. Never a timer.
    val busy = boardBusy || store.sheet != null || store.showGameOver || modal

    val depth = rememberTableDepth(modal)
    val blurring by remember(depth) { derivedStateOf { depth.value > 0.dp } }
    var barHeight by remember { mutableIntStateOf(0) }

    CompositionLocalProvider(
        LocalGlassLevel provides level,
        LocalGlassBusy provides busy,
        // Round the table and not the sheets, which are drawn outside this:
        // a sheet is not hanging over the board.
        LocalBoardBusy provides boardBusy,
    ) {
        BoxWithConstraints(Modifier.fillMaxSize().background(p.page)) {
            // iOS's regular width is an iPad; 600dp is where Android draws that line.
            val wide = maxWidth >= TABLET_WIDTH
            val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
            val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
            MMBackdropHost(
                Modifier.fillMaxSize(),
                overLiveBoard = true,
                backdrop = {
                    Box(Modifier.fillMaxSize().outOfFocus(depth, blurring)) {
                        Column(Modifier.fillMaxSize().padding(top = top + 4.dp)) {
                            TableBar(store, Modifier.onSizeChanged { barHeight = it.height })
                            Spacer(Modifier.height(BAR_GAP))
                            val rest = Modifier.weight(1f)
                            // Whichever board is drawn deals itself from the one deck, so the
                            // lobby's board and the game's are one deal in the player's eyes.
                            CompositionLocalProvider(LocalDeckIntro provides deck) {
                                when {
                                    state == null -> Connecting(store, rest)
                                    wide && state.isLobby -> TabletLobby(store, state, rest)
                                    wide -> TabletTable(store, state, rest)
                                    state.isLobby -> PhoneLobby(store, state, rest)
                                    else -> PhoneTable(store, state, rest)
                                }
                            }
                        }

                        // A round button at thumb height, because the chat is the half of a
                        // board game that is not the board. Only on a phone at a live table:
                        // the lobby and the tablet reach it from the bar. Down here with the
                        // table rather than up with the floating glass: it is a solid plate,
                        // with no window in it for a blurred copy to show through, and a
                        // banner passing over it should see it.
                        if (!wide && state != null && !state.isLobby) {
                            ChatBubble(
                                store,
                                Modifier
                                    .align(Alignment.BottomEnd)
                                    .padding(end = 14.dp, bottom = 128.dp + bottom),
                            )
                        }
                    }
                },
            ) {
                // While a question has the table out of focus, nothing up here
                // samples it. The table under it is blurred already, so the
                // copy would be a blur of that blur — a second full-screen pass
                // every frame, for as long as the question waits — and the turn
                // banner, which hangs above the question's scrim, would show
                // the table through it undimmed. The film alone, over what is
                // really behind it, is exact. Reduce Transparency passes through.
                val floating = if (blurring && level != GlassLevel.Opaque) GlassLevel.Flat else level
                CompositionLocalProvider(LocalGlassLevel provides floating) {
                    // A tablet's pods hang over the corners of the board, so they
                    // float with the glass that does, placed where the table's own
                    // layout used to put them: under the bar, clear of the system
                    // bars and the side insets.
                    if (wide && state != null && !state.isLobby) {
                        val sides = WindowInsets.navigationBars.only(WindowInsetsSides.Horizontal).asPaddingValues()
                        val direction = LocalLayoutDirection.current
                        val barDp = with(LocalDensity.current) { barHeight.toDp() }
                        CornerPods(
                            store,
                            Modifier.padding(
                                top = top + 4.dp + barDp + BAR_GAP,
                                bottom = bottom,
                                start = sides.calculateStartPadding(direction),
                                end = sides.calculateEndPadding(direction),
                            ),
                        )
                    }

                    // The coins fly to their own pill in the corner, which is above
                    // everything. The deal-in is drawn by the board itself, over its well.
                    // While the result sheet is up the sheet draws them instead: it is a
                    // window over this one, and the win's payout lands while it is open.
                    if (!store.showGameOver) CoinFlightLayer(flight)

                    // Removed by the clock: the one thing that has happened, so it covers
                    // the table until the player says they would rather watch. The scrim
                    // only fades — scaled with the card, its edges were seen closing in
                    // from the sides of the screen — and the card grows on its own inside.
                    // Under the card, the relief card, the headline and the turn banner,
                    // as iOS hangs those four above the table's own overlay: the "X's
                    // turn" that fires as the turn passes shows at full strength over it.
                    AnimatedVisibility(
                        visible = store.timedOut,
                        enter = fadeIn(),
                        exit = fadeOut(),
                    ) {
                        TimedOutOverlay(store)
                    }

                    CardPopup(store, Modifier.align(Alignment.Center))
                    ReliefCardOverlay(store)
                    HeadlineOverlay(store, Modifier.align(Alignment.Center))
                    TurnBanner(store, Modifier.align(Alignment.TopCenter))
                }
            }
        }
    }

    TableSheets(store, account, onTheme, flight)
    // Leave, who gives up, and the two bankruptcies — SafetySheets.kt
    // holds the one copy of iOS's wording.
    TableConfirmHost(store)
}

/**
 * How far out of focus the table is: the material's own twenty while a
 * full-screen question is up, from API 31, and nothing otherwise.
 *
 * This is where a flat black scrim used to do the job alone, and a black
 * scrim says "behind" by taking the table away. A blur says it the way a
 * lens does — real depth of field. It is not free: the pieces go on
 * breathing under the question, so the blur is taken again every frame. But
 * it is the only one on screen while it is up, because the glass floating
 * over the table stops sampling it for as long ([GameScreen]). Below API 31
 * there is no blur to spend, and under Reduce Transparency the player has
 * asked not to look through anything; in both the scrims keep their full
 * strength instead (TableOverlays.kt's scrim, which asks the same two things).
 */
@Composable
private fun rememberTableDepth(modal: Boolean): State<Dp> {
    val reduceMotion = rememberReduceMotion()
    val focusable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        LocalGlassLevel.current != GlassLevel.Opaque
    val target = if (modal && focusable) GlassSpec.BLUR else 0.dp
    return animateDpAsState(
        target,
        tween(if (reduceMotion) GlassMotion.REDUCED_MS else GlassMotion.APPEAR_MS),
        label = "mm.depth",
    )
}

/**
 * The table, blurred by [depth]. The layer that does it exists only while
 * [blurring]: the table is otherwise drawn straight into the backdrop host's
 * own pass, which is what lets the host re-record it the frame something on
 * the board changes, and freeze it while the board is busy. The radius is
 * read in the layer, so the fade costs redraws and not recompositions.
 */
private fun Modifier.outOfFocus(depth: State<Dp>, blurring: Boolean): Modifier =
    if (!blurring) this else graphicsLayer {
        val r = depth.value.toPx()
        renderEffect = if (r > 0.5f) BlurEffect(r, r, TileMode.Clamp) else null
    }

private val TABLET_WIDTH = 600.dp

/** The air between the bar and whatever the table puts under it. */
private val BAR_GAP = 10.dp

/** How far a corner pod reaches in from the side: 172 of pod and 12 of margin, and a little air. */
private val POD_INSET = 196.dp

/**
 * The room the floating +/- needs above the seat strip: it rests fifteen
 * points over the chip's top, five of which are the strip's own air — so ten
 * more, and the strip is iOS's 54 wherever it lends this upward.
 */
private val BADGE_ROOM = 10.dp

/**
 * The air above and below the chips. iOS frames its strip at 54 points round
 * a 44-point chip, so the strip is the same height in the lobby and at the
 * table, and the dock starts five points under the chips rather than on them.
 */
private val STRIP_AIR = 5.dp

/** A round button in the bar, and the room code's capsule round its text. */
private val BAR_BUTTON = 34.dp
private val ROOM_CAPSULE_CHROME = 7.dp + 6.dp + 26.dp

/**
 * The bar's padding round its doors: a 22 shell with 8 of it holds 14s, the
 * spec's concentric pairing for the game's top bar on every client.
 */
private val BAR_INSET = 8.dp

/** A door's shape on the bar — its press well, the share plate, the code's well. */
private val DOOR_SHAPE: Shape = MMShapes.innerShape(22.dp, BAR_INSET)

/** The room code: iOS's 14-point heavy monospace, a point of tracking, the case it was typed in. */
private val ROOM_CODE = TextStyle(
    fontSize = 14.sp,
    fontWeight = FontWeight.ExtraBold,
    fontFamily = FontFamily.Monospace,
    letterSpacing = 1.sp,
)

// ── the layouts ────────────────────────────────────────────────────────────

/** No state yet: the spinner, what the socket is doing, and why the server said no. */
@Composable
private fun Connecting(store: GameStore, modifier: Modifier) {
    val p = P.current
    Column(
        modifier.fillMaxWidth().padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
    ) {
        // iOS's spinner at its own size: twenty points across.
        CircularProgressIndicator(Modifier.size(20.dp), color = p.red, strokeWidth = 2.dp)
        Text(
            when (store.connection) {
                GameStore.Connection.CONNECTED -> "Joining room…"
                GameStore.Connection.CONNECTING -> "Connecting to the server…"
                GameStore.Connection.DISCONNECTED -> "Reconnecting…"
            },
            color = p.ink3, fontSize = 14.sp, fontWeight = FontWeight.Medium,
        )
        // Banned, a full room, a cup table you were not drawn for: the reason
        // stays on screen, where a toast would have slid away and left the
        // spinner to run forever.
        store.joinError?.let {
            Text(it, color = p.bad, fontSize = 13.sp, textAlign = TextAlign.Center)
        }
    }
}

/**
 * A phone at a live table. The board takes the slack and the controls keep
 * their place: whatever the dock grows by comes out of the board, never out
 * of the buttons. The table's running commentary lives inside the board's
 * centre well, behind the dice, so it costs the dock nothing.
 */
@Composable
private fun PhoneTable(store: GameStore, state: GameState, modifier: Modifier) {
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    BoxWithConstraints(modifier.fillMaxWidth()) {
        // A dock taller than this — three offers and an auction at once —
        // scrolls inside itself rather than pushing the board off the phone.
        val dockMax = maxHeight * 0.6f
        Column(Modifier.fillMaxSize()) {
            BoardZone(
                store,
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 6.dp)
                    .padding(top = 2.dp),
            )
            Seats(store, state, badgeRoom = BADGE_ROOM, lend = BADGE_ROOM)
            // Straight on from the strip, as iOS stacks them: the strip's own
            // air under its chips is the whole gap.
            Dock(store, state, bottom + 4.dp, Modifier.heightIn(max = dockMax))
        }
    }
}

/**
 * A phone in the lobby: the seats, the board as a preview, and the lobby
 * panel under it. The board gives way before the panel does — the Start
 * button is the one thing on this screen somebody came to press.
 */
@Composable
private fun PhoneLobby(store: GameStore, state: GameState, modifier: Modifier) {
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    BoxWithConstraints(modifier.fillMaxWidth()) {
        // iOS's VStack shares what the strip and its two gaps leave equally
        // between the aspect-fit board and the lobby panel, so the board is
        // at most half of it — and never wider than the screen less its 6pt
        // margins. The panel's half ends at the bottom of the safe area.
        val side = minOf(maxWidth - 12.dp, (maxHeight - 54.dp - 20.dp - bottom) / 2).coerceAtLeast(0.dp)
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Seats(store, state)
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                BoardView(store, Modifier.width(side)) { store.openDeed(it) }
            }
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = bottom + 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                AwaitingSeats(store, Modifier.padding(horizontal = 12.dp))
                ActionPanel(store, state)
            }
        }
    }
}

/**
 * A tablet's lobby: the board previews on the left and the lobby panel lives
 * on the right, the way the iPad splits it.
 */
@Composable
private fun TabletLobby(store: GameStore, state: GameState, modifier: Modifier) {
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
            .padding(bottom = bottom),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        BoxWithConstraints(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.TopCenter) {
            BoardView(store, Modifier.width(minOf(maxWidth, maxHeight))) { store.openDeed(it) }
        }
        Column(
            Modifier
                .width(380.dp)
                .fillMaxHeight()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            AwaitingSeats(store, Modifier.padding(horizontal = 12.dp))
            ActionPanel(store, state)
        }
    }
}

/**
 * A tablet at a live game: a tabletop. The board sits huge in the middle with
 * the whole dock inside its centre well — the dice and the buttons live where
 * everyone round the table can see them — and the strip stays out of the
 * corners, which belong to the pods.
 */
@Composable
private fun TabletTable(store: GameStore, state: GameState, modifier: Modifier) {
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    Box(modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxSize().padding(bottom = bottom)) {
            // The badge's headroom is borrowed from the gap under the bar and
            // no further: any deeper and the strip would sit over the bottom
            // of the bar's buttons and take their taps.
            Seats(store, state, Modifier.padding(horizontal = POD_INSET), badgeRoom = BADGE_ROOM, lend = BADGE_ROOM)
            AwaitingSeats(store, Modifier.padding(horizontal = POD_INSET).padding(top = 10.dp))
            BoxWithConstraints(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp)
                    .padding(top = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                BoardView(
                    store,
                    Modifier.width(minOf(maxWidth, maxHeight)),
                    center = { CenterWell(store, it, actionsInWell = true) },
                ) { store.openDeed(it) }
            }
            // iOS's VStack spacing of ten over its Spacer(minLength: 6).
            Spacer(Modifier.height(16.dp))
        }
        // The corner pods float over this, with the rest of the glass that
        // hangs over the board — see [GameScreen].
    }
}

/**
 * The board, as large as the zone allows and pinned to its top: the slack
 * under it is the seam iOS keeps above the strip, at least ten points of it.
 *
 * Sized in the layout pass rather than read off the zone's constraints in a
 * composition of its own. The dock under it now stretches when it changes
 * phase, which moves this zone's floor every frame of the stretch; asked in
 * composition, that re-ran the whole board — its geometry, its forty tiles'
 * type — sixty times a second even on a phone where the board is as wide as
 * the screen and never changes size at all. Here the board is handed the
 * same square it always was, and is only asked again when that square really
 * is a different size.
 */
@Composable
private fun BoardZone(store: GameStore, modifier: Modifier) {
    Box(modifier, contentAlignment = Alignment.TopCenter) {
        // iOS's seam of at least ten — exactly as deep as the strip below
        // reaches up into it for its money badge, so the strip's bounds never
        // cover the bottom row's tiles and take their taps.
        BoardView(store, Modifier.largestSquare(reserve = BADGE_ROOM)) { store.openDeed(it) }
    }
}

/** The largest square that fits, [reserve] short of the bottom. */
private fun Modifier.largestSquare(reserve: Dp): Modifier = layout { measurable, constraints ->
    val tall = if (constraints.hasBoundedHeight) constraints.maxHeight - reserve.roundToPx() else constraints.maxWidth
    val side = minOf(constraints.maxWidth, tall).coerceAtLeast(0)
    val placeable = measurable.measure(Constraints.fixed(side, side))
    layout(placeable.width, placeable.height) { placeable.place(0, 0) }
}

/**
 * Under the strip: a held chair's vote, right above the buttons it concerns,
 * then the dock — the trades on the table and whatever this moment of the
 * game needs. The two sit edge to edge, as iOS stacks them, so the vote reads
 * as the dock's own first line rather than a card of its own.
 *
 * The room under the dock, [floor], is inside the scroll rather than round
 * it: the dock is glass now, and glass casts its shadow downwards, into
 * exactly that room. Outside, the scroll's own edge cut the shadow off flat
 * along the dock's foot.
 */
@Composable
private fun Dock(store: GameStore, state: GameState, floor: Dp, modifier: Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(bottom = floor),
    ) {
        AwaitingSeats(store, Modifier.padding(horizontal = 12.dp))
        // Under the board, on the page: the dock declares what is there.
        ActionPanel(store, state, backdrop = BackdropKind.Page)
    }
}

// ── the bar ────────────────────────────────────────────────────────────────

/**
 * The strip at the top: the way out, the room code with the connection's
 * state beside it, and the table's doors — sound, chat, and while a game is
 * on, trading and your streets. Share sits last, in the accent, because it is
 * how the next seat gets filled. The lobby's own doors — the house rules and
 * your look — are in the lobby panel, where iOS keeps them.
 *
 * iOS lays the bar out as one row at twelve points between every pair, the
 * flexible space included — so the code sits twelve in from the way out and
 * at least twenty-four clear of the first door. Six round buttons, the code
 * and those gaps come to more than a 360-point phone has, though, so on a
 * narrow phone the gaps close up, down to six, before the code is asked to
 * give way; on anything wider they are iOS's twelve exactly.
 *
 * It is one piece of glass, where it was six card-coloured discs and a
 * capsule standing loose on the page: this is the table's navigation, the
 * layer the material is for, and a row of separate panes is the stacked-
 * glass look the material exists to avoid. The doors are drawn on it — ink on
 * the glass at rest, a well of its own ink under the thumb — and the one
 * coloured door, Share, is a solid plate of the accent in the ink the palette
 * made for it. Over the page, declared: nothing ever passes under the bar,
 * so the film over the flat page is the whole of the optics, and exact.
 */
@Composable
private fun TableBar(store: GameStore, modifier: Modifier = Modifier) {
    val p = P.current
    val playing = store.state?.isPlaying == true
    val context = LocalContext.current
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    val surface = rememberGlassSurface(BackdropKind.Page)
    BoxWithConstraints(modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        val doors = if (playing) 5 else 3
        val code = with(density) { measurer.measure(store.roomId.orEmpty(), ROOM_CODE).size.width.toDp() }
        val used = BAR_BUTTON * (doors + 1) + code + ROOM_CAPSULE_CHROME + BAR_INSET * 2
        val gap = ((maxWidth - used) / (doors + 2)).coerceIn(6.dp, 12.dp)
        Row(
            Modifier
                .fillMaxWidth()
                // A layer of its own, so the bar is drawn when the bar changes
                // and not whenever the table does. Nothing between it and the
                // board holds one, and the pieces breathe every frame of the
                // game: without this the glass — its shadow re-blurred, its
                // rim re-swept — was redrawn sixty times a second along with
                // them, to come out exactly the same.
                .graphicsLayer {}
                .mmGlass(backdrop = BackdropKind.Page, shape = MMShapes.r22)
                .padding(BAR_INSET),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val row = this
            OnGlass(surface) {
                // The doors' ink: the glass's quiet one, which on the bar is
                // what the palette's second rank now answers with.
                val quiet = P.current.ink2
                with(row) {
                    BarDoor("Leave the table", onClick = { store.requestLeave() }) {
                        // iOS's chevron.left: the row arrow, turned round.
                        Box(Modifier.rotate(180f)) { RowChevron(quiet, 13.dp) }
                    }
                    Spacer(Modifier.width(gap))
                    // If a large system font still tips the bar over, the code gives
                    // way rather than the share button falling off the end of it.
                    Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) { RoomCapsule(store) }
                    Spacer(Modifier.width(gap * 2))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(gap),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        SoundToggle(store)
                        Box {
                            // iOS's bubble.left.and.bubble.right.fill: two solid
                            // bubbles, not the drawn set's one bubble with dots.
                            BarDoor("Open chat", onClick = { store.openChat() }) {
                                SfMark("bubble.left.and.bubble.right.fill", 22.dp, quiet)
                            }
                            UnreadBadge(store.unreadChat, Modifier.align(Alignment.TopEnd).offset(x = 5.dp, y = (-4).dp))
                        }
                        if (playing) {
                            // iOS's arrow.left.arrow.right — a left arrow over a right
                            // one. The drawn set's nearest is `swap`, the same two
                            // arrows standing upright, so it is laid on its side and
                            // mirrored to put the left-pointing one on top. Always
                            // live, as on iOS: a seat with nobody left to deal with
                            // opens on the picker's "Nobody left to trade with."
                            BarDoor("Offer a trade", onClick = { store.openTrade() }) {
                                Icon(
                                    "swap", size = 20.dp, tint = quiet,
                                    modifier = Modifier.graphicsLayer {
                                        rotationZ = 90f
                                        scaleX = -1f
                                    },
                                )
                            }
                            // building.columns.fill: four solid columns.
                            BarDoor("Your properties", onClick = { store.openProperties() }) {
                                SfMark("building.columns.fill", 18.dp, quiet)
                            }
                        }
                        store.inviteLink?.let { link ->
                            // The web client reads ?room= on load, so the link seats a
                            // friend from a browser with no install in the way.
                            BarDoor("Share the table", plate = p.red, onClick = {
                                shareText(context, link) { store.showToast("Invite copied") }
                            }) {
                                Icon(GlyphFor.SHARE, size = 20.dp, tint = p.accentInk)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * One of the bar's doors, 34 across. `says` is what a screen reader reads for
 * it: the glyph is a drawing, and a drawing has no name of its own.
 *
 * At rest it is only its drawing, printed on the bar — a disc of its own
 * would be glass on glass, or a paper hole cut in it. Under the thumb, and
 * under a keyboard's focus, a well of the bar's own ink comes up round it at
 * the bar's concentric r14, and the door gives the material's gel. With a
 * [plate] it is that colour, solid, all the time: a coloured button is a
 * plate on this app's glass, never a tint, and on a bar it takes no shadow of
 * its own — the bar casts the one.
 */
@Composable
private fun BarDoor(
    says: String,
    plate: Color? = null,
    onClick: () -> Unit,
    content: @Composable () -> Unit,
) {
    val touches = remember { MutableInteractionSource() }
    val press = rememberGlassPress(touches)
    val focused by touches.collectIsFocusedAsState()
    val well = LocalGlassHost.current?.well() ?: P.current.sunken
    Box(
        Modifier
            .size(BAR_BUTTON)
            .glassPress(press)
            .drawWithCache {
                val outline = DOOR_SHAPE.createOutline(size, layoutDirection, this)
                onDrawBehind {
                    when {
                        plate != null -> drawOutline(outline, plate)
                        focused -> drawOutline(outline, well)
                        press.held > 0f -> drawOutline(outline, well, alpha = press.held)
                    }
                }
            }
            .clickable(
                interactionSource = touches,
                indication = null,
                onClickLabel = says,
                role = Role.Button,
            ) { onClick() }
            .semantics { contentDescription = says },
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}

/**
 * The room code in a well on the bar, with the connection's state in a dot:
 * green while the table is live, gold while the socket is finding its way
 * back. Lose the network mid-game and the board simply stops moving; the dot
 * is what says why. The code is shown as the server wrote it, lower case, the
 * way iOS shows it and the way a friend will type it.
 *
 * A readout rather than a door, so it keeps its well at rest — iOS's capsule,
 * sunk into the glass in the glass's own ink rather than laid on it in paper.
 */
@Composable
private fun RoomCapsule(store: GameStore) {
    val p = P.current
    val well = LocalGlassHost.current?.well() ?: p.sunken
    Row(
        Modifier
            .background(well, DOOR_SHAPE)
            .padding(horizontal = 13.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(if (store.connection == GameStore.Connection.CONNECTED) p.good else p.gold),
        )
        Text(
            store.roomId.orEmpty(),
            color = p.ink,
            style = ROOM_CODE,
            maxLines = 1, softWrap = false,
        )
    }
}

/**
 * One tap to silence the table, without leaving it for Settings. It speaks
 * only when it comes back on — a click to confirm the sound is on is the one
 * click that tells you something. The choice is kept, as the Settings switch
 * keeps it; haptics are not touched, because iOS feels with the sound off.
 *
 * Off used to fade to the palette's third ink. On glass there is no third
 * ink — it measures 1.53:1 there — so off is said by the slash alone, in the
 * same quiet ink as on.
 */
@Composable
private fun SoundToggle(store: GameStore) {
    var on by remember { mutableStateOf(SoundKit.enabled) }
    val quiet = P.current.ink2
    BarDoor(if (on) "Mute sound" else "Turn sound on", onClick = {
        on = !on
        SoundKit.enabled = on
        store.prefs.soundOn = on
        if (on) {
            SoundKit.warmUp()
            SoundKit.click()
        }
    }) {
        // Off is iOS's speaker.slash.fill — a slash through the speaker —
        // where the drawn set puts an X after it.
        if (on) Icon("soundOn", size = 18.dp, tint = quiet)
        else SfMark("speaker.slash.fill", 18.dp, quiet)
    }
}

/**
 * The round chat button that floats over the seam between the strip and the
 * dock. The glyph is as big as iOS's pair of bubbles is in its fifty points —
 * most of the way across — rather than a badge-sized mark lost in the middle.
 *
 * It keeps its brass-to-accent plate: a coloured button on this app's glass
 * is a solid plate, and this one is the table's brand. From the material it
 * takes what a plate takes — the rim catching the light round its edge, the
 * shadow, deepening while the board moves, and the press: the gel, the light
 * swinging round the rim and blooming where the thumb came down, exactly as
 * it does on every MMButton plate, so the one round button on the table does
 * not answer the thumb differently from the square ones.
 */
@Composable
private fun ChatBubble(store: GameStore, modifier: Modifier = Modifier) {
    val p = P.current
    val touches = remember { MutableInteractionSource() }
    val press = rememberGlassPress(touches)
    val glass = rememberGlassSurface(BackdropKind.Page)
    // Reduce Motion and an opaque slab have no light in them to bloom.
    val lit = !press.reduceMotion && LocalGlassLevel.current != GlassLevel.Opaque
    val light = LocalGlassLightAngle.current + GlassSpec.LIGHT_ANGLE_PRESS * press.held
    Box(modifier) {
        CompositionLocalProvider(LocalGlassLightAngle provides light) {
            Box(
                Modifier
                    .size(50.dp)
                    .glassPress(press)
                    .mmGlass(backdrop = BackdropKind.Page, shape = MMShapes.pill, lens = false)
                    .background(Brush.linearGradient(listOf(p.gold, p.red)), MMShapes.pill)
                    .pressBloom(press, glass, MMShapes.pill, lit)
                    .clickable(
                        interactionSource = touches,
                        indication = null,
                        onClickLabel = "Open chat",
                        role = Role.Button,
                    ) {
                        store.openChat()
                        Haptics.tap()
                    }
                    .semantics { contentDescription = "Open chat" },
                contentAlignment = Alignment.Center,
            ) {
                SfMark("bubble.left.and.bubble.right.fill", 30.dp, p.accentInk)
            }
        }
        UnreadBadge(store.unreadChat, Modifier.align(Alignment.TopEnd).offset(x = 4.dp, y = (-3).dp))
    }
}

// ── the seats ──────────────────────────────────────────────────────────────

/**
 * Everyone at the table, in turn order — iOS's PlayerStrip.
 *
 * Each chip is the running scoreboard: HOST and BOT, the live rank with a
 * crown on whoever is actually ahead, NEXT on whoever plays after this turn,
 * the balance (red and breathing in debt, and for a seat that is out, what
 * actually happened to it), the streets owned, the laps the deadlock rule has
 * left, and the shot clock on whoever holds the turn. A team table rings each
 * chip in its team's colour; the turn rings it gold.
 *
 * The strip keeps the seat on the clock in view — or this phone's own between
 * turns — because at a six-seat table the one that matters was forever off
 * the right-hand edge. Tapping a player opens a trade already aimed at them.
 *
 * The strip is iOS's 54 points tall wherever it stands — [STRIP_AIR] above
 * and below the chips. `badgeRoom` is further headroom over the chips for the
 * floating +/- badge, and `lend` is how much of it the strip borrows from
 * whatever sits above it instead of adding to its own height, the way iOS's
 * open-topped clip lets the badge hang over the board.
 */
@Composable
private fun Seats(
    store: GameStore,
    state: GameState,
    modifier: Modifier = Modifier,
    badgeRoom: Dp = 0.dp,
    lend: Dp = 0.dp,
) {
    val ranks = store.liveRanks
    val nextUp = store.nextUpId
    val list = rememberLazyListState()
    // The seats as shown: money a piece is still walking toward has not left
    // anybody's chip yet, and a bankruptcy has not happened until it lands.
    val players = store.shownPlayers

    // Un-animated the first time, the way iOS scrolls on appear; animated on
    // every turn and every arrival after that.
    var placed by remember { mutableStateOf(false) }
    LaunchedEffect(state.turn?.playerId, players.size, state.status) {
        val target = (if (state.isPlaying) state.turn?.playerId else null) ?: store.meId
        val index = players.indexOfFirst { it.id == target }
        if (index < 0) return@LaunchedEffect
        list.centreOn(index, animated = placed)
        placed = true
    }

    LazyRow(
        state = list,
        modifier = modifier
            .fillMaxWidth()
            .then(if (lend > 0.dp) Modifier.overhangTop(lend) else Modifier),
        contentPadding = PaddingValues(
            start = 12.dp, end = 12.dp,
            top = badgeRoom + STRIP_AIR, bottom = STRIP_AIR,
        ),
        // A two-seat table sits in the middle, as iOS's strip does, rather
        // than hugging the left edge.
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        items(players, key = { it.id }) { player ->
            SeatChip(store, state, player, ranks[player.id], nextUp == player.id)
        }
    }
}

@Composable
private fun SeatChip(store: GameStore, state: GameState, player: PlayerState, rank: Int?, isNext: Boolean) {
    val p = P.current
    val isTurn = state.isPlaying && state.turn?.playerId == player.id
    val team = state.teamOf(player)
    val ring = when {
        isTurn -> p.gold
        team != null -> cssColor(team.color, p.rule)
        else -> p.rule
    }
    val shape = RoundedCornerShape(12.dp)
    // A seat that is out is drawn at half strength, badge and all, as iOS
    // fades the whole chip. The badge takes its own fade rather than sharing
    // one with the chip: a faded layer is cut off at its own edges, and the
    // badge rides fifteen points above the chip's.
    val dim = if (player.isBankrupt) 0.5f else 1f
    Box {
        Row(
            Modifier
                .alpha(dim)
                .clip(shape)
                .background(p.card)
                .border(if (isTurn) 2.dp else 1.dp, ring, shape)
                // Who can be traded with is a decision, so it asks the table
                // as it is, not as it is shown.
                .clickable(enabled = store.canTradeWith(state.player(player.id) ?: player)) { store.openTrade(to = player.id) }
                .padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            PlayerDisc(player, size = 32.dp)
            Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        player.name,
                        modifier = Modifier.widthIn(max = 118.dp),
                        color = p.ink, fontSize = 13.5.sp, fontWeight = FontWeight.Bold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    SeatTags(player, state.hostId, store.meId, fontSize = 7.sp, showYou = false)
                    rank?.let { RankBadge(it) }
                    if (isNext && !isTurn) NextTag(store.isLocal(player.id))
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    // In the red the number wears the bad colour and breathes —
                    // the balance itself is the debt, climbing back to zero.
                    // It counts to what it became as the money lands.
                    MoneyText(
                        player.money,
                        fontSize = 13.sp,
                        bankrupt = player.isBankrupt,
                        text = player.outcomeWord ?: money(player.money),
                        count = true,
                        snapKey = store.paintEpoch,
                    )
                    val owned = state.ownedCount(player.id)
                    if (owned > 0 && !player.isBankrupt) {
                        Text("·  $owned", color = p.ink3, fontSize = 9.5.sp, fontWeight = FontWeight.Bold)
                        Icon("houses", size = 10.dp, tint = p.ink3)
                    }
                    if (player.lapsBlocked > 0 && !player.isBankrupt) DeadlockLaps(player.lapsToRelief)
                    if (isTurn) TurnClock(state.turn?.endsAt, compact = true)
                }
            }
        }
        // The coins leave the payer's chip and drop into the payee's, under
        // the badge that says how many.
        CoinSpill(store, player.id, Modifier.align(Alignment.Center))
        // The +/- rides the chip's right shoulder, clear of the name and the
        // money under it; a long amount grows back across the chip's own top
        // rather than out over the seats either side.
        MoneyDeltaBadge(store, player.id, Modifier.align(Alignment.TopEnd).offset(x = 6.dp, y = (-15).dp).alpha(dim))
    }
}

/** Live position by net worth, the crown on whoever is actually ahead. */
@Composable
private fun RankBadge(rank: Int) {
    val p = P.current
    MiniPill(
        "#$rank",
        colour = if (rank == 1) p.gold else p.ink3,
        background = if (rank == 1) p.goldSoft else p.sunken,
        icon = if (rank == 1) "crown" else null,
    )
}

/** Enough warning to look up before the turn lands — no more than that. */
@Composable
private fun NextTag(mine: Boolean) {
    val p = P.current
    MiniPill(
        if (mine) "YOU'RE NEXT" else "NEXT",
        colour = if (mine) p.gold else p.ink3,
        background = if (mine) p.goldSoft else p.sunken,
        fontSize = 7.sp,
        letterSpacing = 0.5.sp,
    )
}

/**
 * How many laps this seat has left before the deadlock rule moves the street
 * they are missing. It states the number and nothing else — the rule already
 * explained itself once, and the way out is a trade, not a warning.
 */
@Composable
fun DeadlockLaps(left: Int, modifier: Modifier = Modifier) {
    val p = P.current
    MiniPill(
        "$left lap${if (left == 1) "" else "s"}",
        colour = p.gold,
        background = p.goldSoft,
        modifier = modifier,
        icon = "scales",
        iconSize = 9.dp,
    )
}

/**
 * "+$200" / "−$150" floating up off a seat for a beat, so rent is something
 * you see leave one player and land on another rather than two numbers that
 * quietly became different numbers. Grouped like every figure on screen — a
 * rent bill reads "−$1,450" — and never cut short to "−$…".
 */
@Composable
fun MoneyDeltaBadge(store: GameStore, playerId: String, modifier: Modifier = Modifier) {
    val p = P.current
    val density = LocalDensity.current
    val rise = with(density) { 8.dp.roundToPx() }
    val leave = with(density) { 12.dp.roundToPx() }
    AnimatedContent(
        targetState = store.moneyDeltas[playerId],
        modifier = modifier,
        contentKey = { it?.id },
        transitionSpec = {
            val bounce = spring<IntOffset>(dampingRatio = 0.55f, stiffness = Spring.StiffnessMediumLow)
            (slideInVertically(bounce) { rise } + fadeIn() + scaleIn(initialScale = 0.7f)) togetherWith
                (slideOutVertically { -leave } + fadeOut()) using SizeTransform(clip = false)
        },
        label = "moneyDelta",
    ) { d ->
        if (d != null) {
            val tone = if (d.amount > 0) p.good else p.bad
            val shape = RoundedCornerShape(99.dp)
            Text(
                "${if (d.amount > 0) "+" else "−"}${money(abs(d.amount))}",
                modifier = Modifier
                    .shadow(4.dp, shape)
                    .background(p.card.copy(alpha = 0.94f), shape)
                    .border(1.dp, tone.copy(alpha = 0.4f), shape)
                    .padding(horizontal = 7.dp, vertical = 2.dp),
                color = tone, fontSize = 12.sp, fontWeight = FontWeight.Black,
                maxLines = 1, softWrap = false,
            )
        }
    }
}

/**
 * Three coins for one change of cash, so money is seen to travel: they lift
 * off a seat that paid — up and away, shrinking as they go, over the first
 * half second — and drop into a seat that was paid, starting a fifth of a
 * second later, as its count starts climbing. Keyed on the badge's own id,
 * so it is born and gone with the badge above it. Under Reduce Motion the
 * number and the badge carry it alone.
 */
@Composable
fun CoinSpill(store: GameStore, playerId: String, modifier: Modifier = Modifier) {
    val d = store.moneyDeltas[playerId] ?: return
    if (rememberReduceMotion()) return
    val paying = d.amount < 0
    val coins = remember(d.id) { List(3) { Animatable(0f) } }
    LaunchedEffect(d.id) {
        coins.forEachIndexed { i, coin ->
            launch {
                if (paying) {
                    delay(COIN_STAGGER * i)
                    coin.animateTo(1f, tween(550, easing = EaseOut))
                } else {
                    delay(200L + COIN_STAGGER * i)
                    coin.animateTo(1f, tween(500, easing = EaseIn))
                }
            }
        }
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        coins.forEachIndexed { i, coin ->
            Box(
                Modifier.graphicsLayer {
                    val t = coin.value
                    val lift = 22.dp.toPx()
                    translationX = (i - 1) * 10.dp.toPx()
                    if (paying) {
                        translationY = -lift * t
                        scaleX = 1f - 0.4f * t
                        scaleY = 1f - 0.4f * t
                        alpha = 1f - t
                    } else {
                        // Falling in from above, and gone as it lands in the
                        // purse — never sitting on top of the number.
                        translationY = -lift * (1f - t)
                        scaleX = 0.6f + 0.4f * t
                        scaleY = 0.6f + 0.4f * t
                        alpha = when {
                            t <= 0f -> 0f
                            t < 0.2f -> t / 0.2f
                            t > 0.75f -> (1f - t) / 0.25f
                            else -> 1f
                        }
                    }
                },
            ) {
                Icon("coin", size = 12.dp)
            }
        }
    }
}

/** The gap between one coin of a spill and the next. */
private const val COIN_STAGGER = 50L

/**
 * Keep an item in the middle of the strip. Taken from the laid-out chips, so
 * a name that is longer than the rest is centred on its own width; one that
 * is off screen is brought in first. The list's own bounds clamp both ends,
 * as iOS's `scrollTo(anchor: .center)` does.
 */
private suspend fun LazyListState.centreOn(index: Int, animated: Boolean) {
    if (layoutInfo.visibleItemsInfo.none { it.index == index }) {
        if (animated) animateScrollToItem(index) else scrollToItem(index)
        withFrameNanos { }
    }
    val info = layoutInfo
    val item = info.visibleItemsInfo.firstOrNull { it.index == index } ?: return
    val middle = (info.viewportStartOffset + info.viewportEndOffset) / 2f
    val delta = item.offset + item.size / 2f - middle
    if (animated) animateScrollBy(delta, tween(300, easing = FastOutSlowInEasing)) else scrollBy(delta)
}

/**
 * Reports `lift` less height than it draws and draws that much higher: the
 * strip keeps room above its chips for the money badge without adding a band
 * of empty page to the layout.
 */
private fun Modifier.overhangTop(lift: Dp): Modifier = layout { measurable, constraints ->
    val up = lift.roundToPx()
    val placeable = measurable.measure(constraints)
    layout(placeable.width, (placeable.height - up).coerceAtLeast(0)) {
        placeable.place(0, -up)
    }
}

// ── the corner pods (tablet) ───────────────────────────────────────────────

/**
 * Every player seated at this device gets a little dashboard pinned to a
 * corner of the screen — name, live cash with the +/- flash, and their own
 * roll / end-turn / trade — so whoever sits on that side of a tablet laid
 * flat can reach one. The top pair reads upside down, facing the people
 * across the table. This device's own player always leads, so the person
 * holding it never finds their own pod printed upside down.
 */
@Composable
private fun CornerPods(store: GameStore, modifier: Modifier = Modifier) {
    val state = store.state ?: return
    val mine = store.shownPlayers.filter { store.isLocal(it.id) && !it.isBankrupt }
    val seats = mine.firstOrNull { it.id == store.meId }?.let { listOf(it) + (mine - it) } ?: mine
    // Each pod is keyed on its seat, so when a seat on this phone goes out
    // and the others close up a corner, a balance keeps counting its own
    // money rather than counting from the number that sat there before.
    Box(modifier.fillMaxSize().padding(12.dp)) {
        seats.getOrNull(2)?.let { key(it.id) { PlayerPod(store, state, it, flipped = true, Modifier.align(Alignment.TopStart)) } }
        seats.getOrNull(3)?.let { key(it.id) { PlayerPod(store, state, it, flipped = true, Modifier.align(Alignment.TopEnd)) } }
        seats.getOrNull(0)?.let { key(it.id) { PlayerPod(store, state, it, flipped = false, Modifier.align(Alignment.BottomStart)) } }
        seats.getOrNull(1)?.let { key(it.id) { PlayerPod(store, state, it, flipped = false, Modifier.align(Alignment.BottomEnd)) } }
    }
}

/**
 * One player's pod: a pane of glass hanging over a corner of the board, r22
 * with twelve of padding so its buttons sit concentric at r10 — the dock's
 * pairing, and the iPad's pod to the point. On this seat's turn it takes the
 * player's own colour as its one tint, where it used to take a ring of it and
 * a coloured drop — a ring round glass is a sticker outline laid over the rim.
 *
 * The top pair read upside down, for the people across the table, and it is
 * only the pod's contents that turn. The pane stays the right way up, so the
 * light catches all four in the same corner and all four cast their shadows
 * the same way — the light is in the room, not in the pod — and the pane
 * samples the board beneath it where it really is.
 */
@Composable
private fun PlayerPod(store: GameStore, state: GameState, player: PlayerState, flipped: Boolean, modifier: Modifier) {
    val p = P.current
    val isTurn = state.isPlaying && state.turn?.playerId == player.id
    val colour = cssColor(player.color, p.red)
    val surface = rememberGlassSurface(BackdropKind.Felt)
    Box(modifier) {
        Box(
            Modifier
                .matchParentSize()
                // Its own layer, as the bar's: the board under it redraws
                // every frame, and the pane need not redraw with it. What it
                // samples still moves, because the copy is a layer too.
                .graphicsLayer {}
                .mmGlass(backdrop = BackdropKind.Felt, shape = POD_SHAPE, tint = if (isTurn) colour else null),
        )
        Box(Modifier.graphicsLayer { rotationZ = if (flipped) 180f else 0f }) {
            Column(
                Modifier
                    .width(172.dp)
                    .padding(POD_PADDING),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val column = this
                OnGlass(surface) {
                    with(column) { PodFace(store, state, player, isTurn) }
                }
            }
            CoinSpill(store, player.id, Modifier.align(Alignment.Center))
            // On the pod's own top edge: inside the card it landed on the name
            // and the clock as soon as the amount ran long.
            MoneyDeltaBadge(store, player.id, Modifier.align(Alignment.TopEnd).offset(x = 4.dp, y = (-13).dp))
        }
    }
}

/** What a pod says: who, how much, the clock on the turn, and what they can press. */
@Composable
private fun ColumnScope.PodFace(store: GameStore, state: GameState, player: PlayerState, isTurn: Boolean) {
    val p = P.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PlayerDisc(player, size = 28.dp)
        Column(Modifier.weight(1f)) {
            Text(
                player.name,
                color = p.ink, fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                // The balance is printed on the pod's glass, so it is the
                // glass's green, or its red in the hole.
                GlassMoney { MoneyText(player.money, fontSize = 15.sp, count = true, snapKey = store.paintEpoch) }
                if (player.lapsBlocked > 0 && !player.isBankrupt) DeadlockLaps(player.lapsToRelief)
            }
        }
        if (isTurn) TurnClock(state.turn?.endsAt, compact = true)
    }
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (isTurn) {
            when (state.turn?.phase) {
                "roll" -> PodButton("Roll", Modifier.weight(1f), glyph = "dice", prominent = true) { store.roll() }
                "end" -> PodButton("End ➜", Modifier.weight(1f), prominent = true) { store.endTurn() }
                else -> Text(
                    if (state.turn?.phase == "action") "your call…" else "…",
                    modifier = Modifier.weight(1f),
                    color = p.ink2, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Center,
                )
            }
        }
        // iOS labels this one with the ⇄ character: a right arrow over
        // a left one. `swap` laid on its side is that very shape, in
        // the drawn set's own hand.
        PodButton(null, Modifier.width(44.dp), glyph = "swap", glyphSize = 18.dp, glyphTurn = 90f, prominent = false) {
            store.openTrade(from = player.id)
        }
    }
}

/**
 * A pod's button, drawn on the pod: the prominent one a solid plate of the
 * accent in the ink made for it, the other a well of the glass's own ink —
 * both at r10, concentric with the pod — and both give the material's gel.
 */
@Composable
private fun PodButton(
    label: String?,
    modifier: Modifier = Modifier,
    glyph: String? = null,
    glyphSize: Dp = 14.dp,
    glyphTurn: Float = 0f,
    prominent: Boolean,
    onClick: () -> Unit,
) {
    val p = P.current
    val touches = remember { MutableInteractionSource() }
    val press = rememberGlassPress(touches)
    val ink = if (prominent) p.accentInk else p.ink
    val fill = if (prominent) p.red else LocalGlassHost.current?.well() ?: p.sunken
    Row(
        modifier
            .glassPress(press)
            .background(fill, POD_BUTTON_SHAPE)
            .clickable(interactionSource = touches, indication = null, role = Role.Button) {
                onClick()
                Haptics.tap()
            }
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (glyph != null) Icon(glyph, size = glyphSize, tint = ink, modifier = Modifier.rotate(glyphTurn))
        if (label != null) Text(label, color = ink, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

/** A pod's corner and padding: r22 at 12 holds its buttons at r10, as iOS's pod does. */
private val POD_PADDING = 12.dp
private val POD_SHAPE: Shape = MMShapes.r22
private val POD_BUTTON_SHAPE: Shape = MMShapes.innerShape(22.dp, POD_PADDING)

// ── what the table has open ────────────────────────────────────────────────

/**
 * The one sheet the table has open, as the store says — one at a time,
 * because two bottom sheets fight. Each closes itself only while it is still
 * the one on show: a sheet that has already been swapped for the next (an
 * offer turning into a counter-offer) must not close its successor on its
 * way out.
 *
 * The result sheet outranks all of them.
 */
@Composable
private fun TableSheets(
    store: GameStore,
    account: AccountStore,
    onTheme: ((MMTheme) -> Unit)?,
    flight: CoinFlight? = null,
) {
    if (store.showGameOver) {
        GameOverSheet(store, account, flight = flight) { store.showGameOver = false }
        return
    }
    val open = store.sheet ?: return
    val close = { if (store.sheet == open) store.closeSheet() }
    when (open) {
        is TableSheet.Deed -> DeedSheet(store, open.tile, onDismiss = close)
        is TableSheet.Properties -> PropertiesSheet(store, onDismiss = close, onOpenTile = { store.openDeed(it) })
        is TableSheet.Trade -> TradeSheet(store, open.draft, onDismiss = close)
        // Read the offer live inside the sheet; closing it leaves the offer
        // on the table and answers nothing.
        is TableSheet.Offer -> TradeOfferSheet(store, open.offer, open.seat, onDismiss = close)
        is TableSheet.ChatLog -> ChatSheet(store, initialTab = open.tab, onDismiss = close)
        // The table style is the player's, not the room's; iOS's settings
        // sheet carries it at the foot, so this one is handed the setter.
        is TableSheet.Rules -> LobbySheet(account, store, onTheme = onTheme, onDismiss = close)
        is TableSheet.Look -> PiecePicker(store, account, onDismiss = close)
        else -> Unit
    }
}

// ── news over the board ────────────────────────────────────────────────────

/**
 * The drawn card.
 *
 * Good news or bad, carried in the colour, because the colour is read a
 * second before the words are. Cards that genuinely cut both ways — advance
 * to the priciest street, a windfall if you own it and a rent bill if you do
 * not — keep the deck's own colours rather than promise what they cannot know.
 * Bad news flinches: one shove, felt as well as seen, so a player watching
 * their own money catches it out of the corner of an eye.
 */
@Composable
private fun CardPopup(store: GameStore, modifier: Modifier = Modifier) {
    val p = P.current
    val shown = store.cardPopup
    // Held for the way out, as the headline's is: the card shrinks to 0.7
    // and fades with its words still on it, after its time is up and on a
    // tap alike, instead of vanishing the instant the store lets it go.
    var last by remember { mutableStateOf<LastCard?>(null) }
    SideEffect { if (shown != null) last = shown }
    val card = shown ?: last
    val shove = remember { Animatable(0f) }
    LaunchedEffect(card?.at) {
        shove.snapTo(0f)
        if (card?.tone == "bad") {
            delay(240)
            Haptics.warn()
            for (step in listOf(-7f, 7f, -4f, 0f)) shove.animateTo(step, tween(85, easing = LinearOutSlowInEasing))
        }
    }
    AnimatedVisibility(
        visible = shown != null,
        enter = fadeIn() + scaleIn(initialScale = 0.7f),
        exit = fadeOut() + scaleOut(targetScale = 0.7f),
        modifier = modifier,
    ) {
        card ?: return@AnimatedVisibility
        val treasure = card.deck == "treasure"
        val accent = when (card.tone) {
            "good" -> p.good
            "bad" -> p.bad
            else -> if (treasure) p.gold else p.red
        }
        val face = when (card.tone) {
            "good" -> p.goodSoft
            "bad" -> p.badSoft
            else -> if (treasure) p.tileTreasure else p.tileSurprise
        }
        val shape = RoundedCornerShape(20.dp)
        Column(
            Modifier
                .offset { IntOffset(shove.value.dp.roundToPx(), 0) }
                // iOS's card is 320 across on every phone it runs on, however
                // short the card's words — a max-only frame still takes the
                // width it is offered. The gutter only matters on an Android
                // narrower than that.
                .padding(horizontal = 16.dp)
                .widthIn(max = 320.dp)
                .fillMaxWidth()
                .shadow(24.dp, shape)
                .clip(shape)
                .background(face)
                .border(2.dp, accent, shape)
                // A tap puts the card away; it is not a button, so it does
                // not flash like one on the way out.
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                    store.cardPopup = null
                }
                .padding(26.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(if (treasure) "toolbox" else "question", size = 46.dp, tint = accent)
            Text(
                if (treasure) "TREASURE" else "SURPRISE",
                color = if (card.tone == "good" || card.tone == "bad") accent else p.ink3,
                fontSize = 11.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold,
            )
            Text(
                card.text,
                color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * Whose turn it is, said once as the hands change. On a phone two people
 * share it says so — "Pass to Asha!" — because the person holding it is
 * about to be the wrong one.
 *
 * A pill of glass floating over the board: it samples the table beneath it
 * rather than blotting it out, and it is tinted with the player it announces
 * — the one tint on it, where the ring of their colour it used to wear would
 * be a sticker outline laid over the rim. The two dp the ring took are back
 * in the padding, so the pill is the size it was. And as it arrives the light
 * runs once round its rim: a turn changing hands is the one moment the glass
 * is allowed to show off, and under Reduce Motion it does not.
 */
@Composable
private fun TurnBanner(store: GameStore, modifier: Modifier = Modifier) {
    val shown = store.turnBanner
    // Held for the way out, so the banner slides up and fades as iOS's does
    // rather than vanishing the moment the store drops it.
    var last by remember { mutableStateOf<PlayerState?>(null) }
    SideEffect { if (shown != null) last = shown }
    val who = shown ?: last
    // Under Reduce Motion it fades where it stands rather than dropping in.
    val reduceMotion = rememberReduceMotion()
    AnimatedVisibility(
        visible = shown != null,
        enter = if (reduceMotion) fadeIn(tween(GlassMotion.REDUCED_MS)) else slideInVertically { -it } + fadeIn(),
        exit = if (reduceMotion) fadeOut(tween(GlassMotion.REDUCED_MS)) else slideOutVertically { -it } + fadeOut(),
        modifier = modifier,
    ) {
        who ?: return@AnimatedVisibility
        val p = P.current
        val surface = rememberGlassSurface(BackdropKind.Felt)
        CompositionLocalProvider(LocalGlassLightAngle provides rememberRimSweep(who.id)) {
            Row(
                // Below the bar, floating over the board: news about the table,
                // not a label on any one chip. The room round it is for its
                // shadow, which the fade would otherwise cut off at its edge.
                Modifier
                    .padding(top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 116.dp)
                    .padding(start = SHADOW_ROOM, end = SHADOW_ROOM, bottom = SHADOW_ROOM)
                    .mmGlass(backdrop = BackdropKind.Felt, shape = MMShapes.pill, tint = cssColor(who.color, p.red))
                    .padding(start = 11.dp, end = 22.dp, top = 11.dp, bottom = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                PlayerDisc(who, size = 30.dp)
                Text(
                    when {
                        who.id == store.meId -> "Your turn!"
                        store.isLocal(who.id) -> "Pass to ${who.name}!"
                        else -> "${who.name}'s turn"
                    },
                    color = surface.labelInk(), fontSize = 16.sp, fontWeight = FontWeight.ExtraBold,
                )
            }
        }
    }
}

/**
 * The light's direction, swept once round the full turn as [key] arrives —
 * the spec's one-shot rim sweep, 900 ms, and off entirely under Reduce
 * Motion, where the light simply stays where it is.
 */
@Composable
private fun rememberRimSweep(key: Any?): Float {
    val reduceMotion = rememberReduceMotion()
    val sweep = remember { Animatable(0f) }
    LaunchedEffect(key, reduceMotion) {
        sweep.snapTo(0f)
        if (!reduceMotion) sweep.animateTo(360f, tween(GlassMotion.RIM_SWEEP_MS, easing = FastOutSlowInEasing))
    }
    return LocalGlassLightAngle.current + sweep.value
}

/**
 * Room inside a fading overlay for its glass to cast a shadow into. A fade
 * draws through a layer the size of its node, and a part-transparent layer is
 * cut at its bounds, so without this the shadow is sliced flat while the
 * overlay fades and snaps in whole at the end.
 */
private val SHADOW_ROOM = 24.dp

/**
 * The table's one line at kick-off — "Japan holds the priciest streets this
 * game!" — with the country's flag at the front of the sentence, as iOS
 * writes it.
 *
 * Glass, as iOS's reveal banner is: it floats over the board's middle while
 * the deck deals itself out, and the board shows through it, softly, rather
 * than being papered over. Its heading is the table's brass, taken halfway to
 * the glass's ink — the raw gold on a daylight film is the pairing that
 * measures 3.2:1 — and the rim takes the place of the gold border.
 */
@Composable
private fun HeadlineOverlay(store: GameStore, modifier: Modifier = Modifier) {
    val shown = store.headline
    // Held for the way out, so the card fades with its words still on it.
    var last by remember { mutableStateOf<TableHeadline?>(null) }
    SideEffect { if (shown != null) last = shown }
    val headline = shown ?: last
    // Under Reduce Motion it fades where it stands rather than growing in.
    val reduceMotion = rememberReduceMotion()
    AnimatedVisibility(
        visible = shown != null,
        enter = if (reduceMotion) fadeIn(tween(GlassMotion.REDUCED_MS)) else fadeIn() + scaleIn(initialScale = 0.8f),
        exit = if (reduceMotion) fadeOut(tween(GlassMotion.REDUCED_MS)) else fadeOut() + scaleOut(targetScale = 0.8f),
        modifier = modifier,
    ) {
        headline ?: return@AnimatedVisibility
        val medal = headline.group?.let { store.state?.groups?.get(it) }?.takeIf { it.flag.isNotBlank() }
        val surface = rememberGlassSurface(BackdropKind.Felt)
        Column(
            Modifier
                .padding(horizontal = 40.dp, vertical = SHADOW_ROOM)
                .mmGlass(backdrop = BackdropKind.Felt, shape = MMShapes.r22)
                .padding(horizontal = 26.dp, vertical = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "THIS GAME",
                color = surface.goldInk(), fontSize = 11.sp, fontWeight = FontWeight.Black, letterSpacing = 2.5.sp,
            )
            // The country's own flag, or the region's pictograph on a
            // single-country board, typed at the head of the sentence exactly
            // as iOS's string has it. It is content in a line of news — the
            // board's own mark for the place — not a piece of chrome.
            Text(
                if (medal != null) "${medal.flag} ${headline.text}" else headline.text,
                style = TextStyle(textAlign = TextAlign.Center),
                color = surface.labelInk(), fontSize = 18.sp, fontWeight = FontWeight.ExtraBold,
            )
        }
    }
}
