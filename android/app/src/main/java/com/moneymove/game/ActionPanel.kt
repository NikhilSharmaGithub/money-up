package com.moneymove.game

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The one panel that says what this player may do next.
 *
 * It answers a single question — what happens if I touch the screen right
 * now — and it only ever offers what the server would actually accept. A
 * button that comes back refused is worse than no button.
 *
 * iOS's dock, phase for phase and in its order: the topmost trade offer, then
 * whose turn it is and how long they have, then whatever this moment needs —
 * roll, buy or send to auction, the climb out of debt, end turn — or, on
 * somebody else's turn, who is playing and their clock. An auction is not
 * here: the whole table bids, so it sits in the centre well where everybody
 * looks (CenterWell.kt).
 *
 * A lobby is not a dock. A private table gets the button that starts it, the
 * board, the seats and your own look; a matchmade one gets its waiting room
 * ([QuickMatchPanel]), because nobody there has anything to press.
 *
 * The three callbacks default to the table's own sheets, so a screen that
 * does not care how they open need not pass them.
 *
 * [backdrop] is what the dock hangs over, declared rather than read, because
 * the adaptive face is chosen from it: the board's own felt by default, which
 * is where a tablet puts it — inside the centre well — and the page for the
 * phone, which hangs it under the board and says so.
 */
@Composable
fun ActionPanel(
    store: GameStore,
    state: GameState,
    modifier: Modifier = Modifier,
    onTrade: () -> Unit = { store.openTrade() },
    onProperties: () -> Unit = { store.openProperties() },
    onSettings: () -> Unit = { store.openRules() },
    backdrop: BackdropKind = BackdropKind.Felt,
) {
    when {
        state.isQuickWaiting -> QuickMatchPanel(store, state, modifier)
        state.isLobby -> LobbyPanel(store, state, onSettings, modifier.padding(horizontal = 12.dp))
        else -> Dock(store, state, onTrade, onProperties, backdrop, modifier.padding(horizontal = 12.dp))
    }
}

/**
 * The dock proper. One surface, because it is one thing: the trade and the
 * phase blocks inside it are drawn on it rather than being little panels of
 * their own. Its height follows the moment, so nothing in it is fixed.
 *
 * And when the moment changes, the dock does not swap one card for another:
 * the shell stretches to its new height on the material's own spring while
 * the rows inside cross over, the new ones arriving a beat after the old ones
 * start to leave. Roll → walking → buy → end turn is one piece of glass
 * changing shape four times, which is the thing the material does that paper
 * cannot, and the reason the whole dock is a single surface and not a stack.
 */
@Composable
private fun Dock(
    store: GameStore,
    state: GameState,
    onTrade: () -> Unit,
    onProperties: () -> Unit,
    backdrop: BackdropKind,
    modifier: Modifier,
) {
    // The one irreversible button in the dock should not go off on a single
    // tap, so it asks — through the table's question host (SafetySheets.kt),
    // which holds iOS's wording once. Squared up while it is open, there is
    // nothing left to go bankrupt over, and the question goes by itself.
    val inDebt = store.myDebt != null
    LaunchedEffect(inDebt) {
        if (!inDebt && store.confirm == TableConfirm.DEBT_BANKRUPT) store.dismissConfirm()
    }

    val turn = state.turn
    val moment = when {
        store.isMyTurn && turn != null -> DockMoment(DockStage.MINE, turn.playerId)
        state.isPlaying -> DockMoment(DockStage.WAITING)
        state.isEnded -> DockMoment(DockStage.ENDED)
        else -> DockMoment(DockStage.IDLE)
    }

    DockSurface(backdrop, modifier) {
        // Incoming offers, the ones set aside, and the one this phone sent.
        TradeDock(store)

        DockMorph(moment) { shown ->
            when (shown.stage) {
                DockStage.MINE -> {
                    // The seat is the one this moment was keyed on, not the
                    // one the turn has moved to: on its way out, the row says
                    // what it said, not the next player's name.
                    TurnHeader(store, state, shown.seat, turn?.endsAt)
                    DeadlockLine(store)
                    // The server answers a roll before the piece has taken
                    // a step, so the buy prompt — and whatever else the
                    // landing decides — arrives while the token is still
                    // walking. While THIS seat's move is on stage the dock
                    // stays neutral, and the controls take over when it
                    // lands. Other seats' turns, trades and chat never wait.
                    val phase = when {
                        turn == null || turn.playerId != shown.seat -> null
                        store.theatreHolding(turn.playerId) -> WALKING
                        turn.phase == "roll" && store.me?.inJail == true -> IN_PRISON
                        else -> turn.phase
                    }
                    DockMorph(phase) { controls ->
                        when {
                            controls == WALKING -> WalkingRow()
                            controls != null && turn != null -> TurnControls(
                                store, state, turn, controls, onTrade, onProperties,
                            ) { store.ask(TableConfirm.DEBT_BANKRUPT) }
                        }
                    }
                }

                DockStage.WAITING -> WaitingRow(store, state)

                DockStage.ENDED -> EndedControls(store, state)

                DockStage.IDLE -> Unit
            }
        }
    }
}

/** Which of the dock's faces is up. The seat is kept so a pass & play hand-over is a change too. */
private data class DockMoment(val stage: DockStage, val seat: String? = null)

private enum class DockStage { MINE, WAITING, ENDED, IDLE }

/** The dock's controls while this seat's own piece is still walking. */
private const val WALKING = "walking"

/** A roll from a prison cell: a different set of answers from a free roll. */
private const val IN_PRISON = "roll-prison"

/**
 * The dock's own surface: one pane of glass, r22 — the ladder's dock rung —
 * with twelve of padding, so everything drawn on it at r10 sits concentric
 * and the gap round a block never pinches in the corner.
 *
 * No tint and no ring. The card this replaced ringed itself in the accent on
 * this seat's turn, and the obvious move was to hand that colour to the
 * material — but a tint is a property of the whole pane, so the dock came out
 * a slab of brand colour with its buttons lost in it, which is iOS's reason
 * for leaving it off too. The turn is already said twice in here, by the
 * header and by the one coloured button; a surface that shouts it a third
 * time has stopped being glass. The rim replaces the hairline, and the
 * shadow is the material's own, deepening while the board is mid-move.
 *
 * Regular and never Clear: the dock carries live numbers, and Clear does not
 * adapt. Everything inside takes its ink from the glass ([OnGlass]) and its
 * controls stand on it as marks, not panes ([GlassHost]) — glass on glass
 * samples a copy of the table with no dock in it, and comes out as a hole.
 *
 * Its size follows its content on the material's morph spring — the stretch
 * [Dock] describes — and under Reduce Motion it simply is its new size.
 *
 * It keeps a layer of its own, so the glass is drawn when the dock changes
 * and not whenever the table round it does. On a tablet it sits inside the
 * board's own well, and the pieces there breathe every frame of the game;
 * with nothing between the two, the dock's shadow was re-blurred sixty times
 * a second along with them, to come out exactly the same.
 */
@Composable
private fun DockSurface(backdrop: BackdropKind, modifier: Modifier, content: @Composable ColumnScope.() -> Unit) {
    val surface = rememberGlassSurface(backdrop)
    val reduceMotion = rememberReduceMotion()
    Column(
        modifier
            .fillMaxWidth()
            .graphicsLayer {}
            .mmGlass(backdrop = backdrop, shape = MMShapes.r22)
            .padding(DOCK_INSET)
            .then(if (reduceMotion) Modifier else Modifier.animateContentSize(GlassMotion.morphSize)),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        // iOS's VStack centres what does not fill it: the short hint lines
        // ("Not enough cash for this one.", the prison attempts, the double)
        // sit in the middle of the card. Everything else fills the width.
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val column = this
        OnGlass(surface) { column.content() }
    }
}

/** The dock's padding: r22 less this is the r10 every block on it is drawn at. */
private val DOCK_INSET = 12.dp

/** A block drawn on the dock — the deadlock strip, the debt — concentric with the shell. */
private val DOCK_BLOCK: Shape = MMShapes.innerShape(22.dp, DOCK_INSET)

/**
 * One of the dock's faces, crossing to the next as [key] changes.
 *
 * The old rows fade out quickly and the new ones fade in a hundred
 * milliseconds behind them, so for a moment the shell is visibly between two
 * things rather than blinking from one to the other. The size snaps here and
 * is left to [DockSurface]'s spring, which is the stretch: this only
 * crossfades. Nothing is clipped here while it moves either: the shell's
 * stretch is the clip, so old rows taller than the new face are closed over
 * by the shell as it shrinks, not cut off by a box round themselves. Under
 * Reduce Motion there is no stretch to do that, so it is a plain 160 ms
 * cross-fade inside a box that is simply its new size and clips its own.
 *
 * The rows the content draws stack as the dock's own do, eight apart and
 * centred.
 *
 * A face on its way out is a picture of what the dock said, and no longer a
 * control ([inert]). The card this replaced took its buttons away as soon as
 * the turn moved on; a fading End turn that still answered a second tap
 * would send it for whoever the phone now speaks for, and a fading Bankrupt
 * would open its question after the debt was paid.
 */
@Composable
private fun <T> DockMorph(key: T, content: @Composable ColumnScope.(T) -> Unit) {
    val reduceMotion = rememberReduceMotion()
    AnimatedContent(
        targetState = key,
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = Alignment.TopCenter,
        transitionSpec = {
            if (reduceMotion) {
                (fadeIn(tween(GlassMotion.REDUCED_MS)) togetherWith fadeOut(tween(GlassMotion.REDUCED_MS)))
                    .using(SizeTransform(clip = true) { _, _ -> snap() })
            } else {
                (fadeIn(tween(ROWS_IN_MS, delayMillis = ROWS_STAGGER_MS)) togetherWith fadeOut(tween(ROWS_OUT_MS)))
                    .using(SizeTransform(clip = false) { _, _ -> snap() })
            }
        },
        label = "mm.dock",
    ) { shown ->
        Column(
            Modifier
                .fillMaxWidth()
                .then(if (shown != key) Modifier.inert() else Modifier),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            content(shown)
        }
    }
}

/** The spec's dock timings: rows cross 100 ms apart inside the 380 ms stretch. */
private const val ROWS_STAGGER_MS = 100
private const val ROWS_IN_MS = 240
private const val ROWS_OUT_MS = 140

/**
 * Drawn, and nothing more: every touch is taken before the buttons inside
 * see it — one already under a finger is cancelled rather than clicked —
 * and a screen reader is not led to a row that is leaving.
 */
private fun Modifier.inert(): Modifier = this
    .pointerInput(Unit) {
        awaitPointerEventScope {
            while (true) {
                awaitPointerEvent(PointerEventPass.Initial).changes.forEach { it.consume() }
            }
        }
    }
    .clearAndSetSemantics {}

// ── ink on glass ───────────────────────────────────────────────────────────

/**
 * Everything in [content] is printed on [surface].
 *
 * The palette's second and third inks are paper's. On the material the third
 * measures 1.53:1 and has no lifted form that is still a third rank, so it
 * does not exist there: anything below that reaches for `ink3` is handed the
 * glass's lifted second ink instead, and anything reaching for `ink2` gets
 * the same lift — 4.95:1 raw against 5.82:1. It is said once, here, by the
 * surface, which is how the web's `.glass` says it (it redefines `--ink-2`
 * and `--ink-3` for everything inside), so the lines on a pane do not each
 * have to know they are on one. And the controls stand on the pane as marks
 * rather than panes of their own ([GlassHost]).
 *
 * Paper laid on the glass takes paper's ink back ([OnPaper]).
 */
@Composable
internal fun OnGlass(surface: GlassSurface, content: @Composable () -> Unit) {
    val p = P.current
    val ink = surface.labelInk()
    val quiet = surface.labelInk(quiet = true)
    val lifted = remember(p, ink, quiet) { p.copy(ink = ink, ink2 = quiet, ink3 = quiet) }
    CompositionLocalProvider(LocalPalette provides lifted) {
        GlassHost(surface, content)
    }
}

/**
 * Paper, wherever it is laid — on a glass pane or straight on the page. Its
 * inks are the table's own again, third rank and all, because a card was
 * never short of contrast and its quiet line is how a hint reads as a hint;
 * and a control on it is a pane over a card, as it is in a [Panel]. On the
 * page this changes nothing but what the controls are told is behind them,
 * which is the truth.
 */
@Composable
internal fun OnPaper(content: @Composable () -> Unit) {
    val theme = LocalTheme.current
    val dark = LocalAppearanceDark.current
    val own = remember(theme, dark) { theme.palette(dark) }
    CompositionLocalProvider(
        LocalPalette provides own,
        LocalGlassHost provides null,
        LocalControlBackdrop provides BackdropKind.Paper,
        content = content,
    )
}

/**
 * A figure printed on glass: the balance in [content] takes the glass's own
 * green and red ([goodInk], [badInk]) in place of the palette's, which on
 * the material fall to about 4.5:1 by day and 3.5:1 by night. [OnGlass]
 * cannot say this for the whole pane, because the palette's green and red
 * are also the Good and Bankrupt plates, and a plate keeps its colour — so
 * it goes round the number itself and nothing else. Off glass it changes
 * nothing.
 */
@Composable
internal fun GlassMoney(content: @Composable () -> Unit) {
    val host = LocalGlassHost.current
    val p = P.current
    val good = host?.goodInk()
    val bad = host?.badInk()
    val money = remember(p, good, bad) {
        if (good == null || bad == null) p else p.copy(good = good, bad = bad)
    }
    CompositionLocalProvider(LocalPalette provides money, content = content)
}

// ── my turn ────────────────────────────────────────────────────────────────

/**
 * Whose hands these buttons are in, and how long they have. On a pass & play
 * phone the dock serves several seats and would otherwise look identical for
 * all of them; and the clock belongs here too, because your own turn is the
 * one where the countdown actually costs you something.
 */
@Composable
private fun TurnHeader(store: GameStore, state: GameState, seat: String?, endsAt: Double?) {
    val p = P.current
    val guest = state.player(seat)?.takeIf { it.id != store.meId }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        if (guest != null) {
            PlayerDisc(guest, size = 20.dp)
            // A long name gives up a fifth of its size before it gives up any
            // letters, as iOS's minimumScaleFactor(0.8) has it. The line takes
            // all the width the clock leaves — iOS's Spacer yields to the
            // text — rather than sharing it half and half with a spacer. In
            // the glass's brass: the raw gold on a daylight film is 3.2:1.
            FitText(
                "${guest.name}'s turn — pass the phone",
                modifier = Modifier.weight(1f),
                color = LocalGlassHost.current?.goldInk() ?: p.gold,
                fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
            )
        } else {
            // The glass's quiet ink: on the dock the palette's second rank is
            // the lifted one ([OnGlass]), and there is no third.
            Text("Your turn", color = p.ink2, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
        }
        TurnClock(endsAt, compact = true)
    }
}

/**
 * The deadlock rule is counting for this seat. It says the number and the way
 * out, once per turn, and then gets out of the way — the rule already
 * introduced itself as a card the first time it could ever apply, and that
 * card is shown only once.
 */
@Composable
private fun DeadlockLine(store: GameStore) {
    val p = P.current
    val me = store.me ?: return
    if (me.lapsBlocked <= 0 || me.isBankrupt) return
    val laps = me.lapsToRelief
    // A notice drawn on the dock, not a second pane — glass on glass would
    // have it sampling the very bar it sits on — at the dock's concentric
    // r10, in the glass's quiet ink as iOS prints it. The brass goes through
    // the material as a wash, at the strength the material gives its own one
    // tint, rather than lying on it as a slip of gold paper.
    Row(
        Modifier
            .fillMaxWidth()
            .background(p.gold.copy(alpha = tintAlpha()), DOCK_BLOCK)
            .padding(horizontal = 9.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon("scales", size = 13.dp, tint = p.gold)
        Text(
            "$laps lap${if (laps == 1) "" else "s"} until the street you're missing changes hands — or trade for it first.",
            color = p.ink2, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold,
        )
    }
}

/**
 * The piece is still on its way — the same quiet voice as the waiting row,
 * gone the moment the store's curtain lifts and the landing's controls take
 * the stage. Inside the dock, so the dock does not change height as it swaps.
 */
@Composable
private fun WalkingRow() {
    val p = P.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon("dice", size = 17.dp, tint = p.ink2)
        Text("Moving…", color = p.ink2, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.weight(1f))
        Spinner()
    }
}

/**
 * What this seat can do in [phase]. The phase is the one the dock's face was
 * keyed on rather than the turn's own, so a face on its way out keeps saying
 * what it said while the next one arrives over it.
 */
@Composable
private fun TurnControls(
    store: GameStore,
    state: GameState,
    turn: TurnState,
    phase: String,
    onTrade: () -> Unit,
    onProperties: () -> Unit,
    onBankrupt: () -> Unit,
) {
    val me = store.me
    when (phase) {
        "debt" -> DebtControls(store, state, turn, onProperties, onBankrupt)

        "action" -> {
            val pending = turn.pending?.takeIf { it.type == "buy" } ?: return
            val tile = store.tile(pending.tile) ?: return
            val price = pending.price ?: tile.price ?: 0
            val canAfford = (me?.money ?: 0) >= price
            MMButton(
                "Buy ${tile.name} — ${money(price)}", kind = BtnKind.GOOD, big = true,
                modifier = Modifier.fillMaxWidth(), enabled = canAfford,
            ) { store.buy() }
            if (state.settings.auction != false) {
                MMButton(
                    "Send to auction", kind = BtnKind.GHOST, big = true, icon = "gavel",
                    modifier = Modifier.fillMaxWidth(),
                ) { store.skipBuy() }
            } else {
                MMButton("Skip", kind = BtnKind.GHOST, big = true, modifier = Modifier.fillMaxWidth()) {
                    store.skipBuy()
                }
            }
            if (!canAfford) Hint("Not enough cash for this one.")
        }

        IN_PRISON -> {
            MMButton(
                "Roll for a double", kind = BtnKind.PRIMARY, big = true, icon = "dice",
                modifier = Modifier.fillMaxWidth(),
            ) { store.roll() }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MMButton(
                    "Pay $50 & wait", kind = BtnKind.GHOST, big = true,
                    modifier = Modifier.weight(1f), enabled = (me?.money ?: 0) >= 50,
                ) { store.jailPay() }
                if ((me?.getOutCards ?: 0) > 0) {
                    MMButton(
                        "Use card", kind = BtnKind.GOLD, big = true, icon = "ticket",
                        modifier = Modifier.weight(1f),
                    ) { store.jailCard() }
                }
            }
            // The fine buys the door and nothing else, so the panel says so
            // before it is pressed — a player who expects to roll afterwards
            // has spent $50 on a turn they were losing anyway.
            Hint("In prison · attempt ${(me?.jailTurns ?: 0) + 1} of 3")
            Hint("Paying the fine ends your turn — the card lets you roll.")
        }

        "roll" -> {
            MMButton(
                "Roll dice", kind = BtnKind.PRIMARY, big = true, icon = "dice",
                modifier = Modifier.fillMaxWidth(),
            ) { store.roll() }
            if ((turn.doubles ?: 0) > 0) Hint("Double! Free roll (${turn.doubles} of 2)")
        }

        // The last moment of a turn is when people build and deal, so the
        // two doors sit right beside the button that closes it: iOS's bank
        // portico, and its pair of arrows passing each other — the same
        // arrows the trade lines in the log wear — rather than the handshake.
        "end" -> Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // building.columns.fill is a solid silhouette; the drawn bank's
            // columns are a pale wash, so it is drawn as one solid shape.
            GlyphButton("Your properties", big = true, onClick = onProperties) {
                CutoutGlyph("bank", 21.dp, it, holes = false)
            }
            // Always there at the end of a turn, as iOS's is: the sheet
            // itself says so when there is nobody left to deal with. Gating
            // it on the main seat hid it from a pass-and-play guest still in
            // the game after the main seat went bankrupt.
            GlyphButton("Offer a trade", big = true, onClick = onTrade) { SwapArrows(26.dp, it, flipped = true) }
            MMButton("End turn →", kind = BtnKind.PRIMARY, big = true, modifier = Modifier.weight(1f)) {
                store.endTurn()
            }
        }

        // An auction is the well's, and every other phase has nothing to press.
        else -> Unit
    }
}

/**
 * The climb out of the red.
 *
 * The server already took every dollar the debtor had, so the balance below
 * zero IS what is still owed — and every dollar raised streams straight to
 * whoever the debt names, the number climbing toward zero on its own. This
 * panel shows the climb and opens the door that raises cash; nothing here
 * "pays" anything. "Back in the black" is the gate out, and it stays shut
 * until there is nothing left to owe, because pressed any earlier the server
 * answers "Still not enough money".
 */
@Composable
private fun DebtControls(
    store: GameStore,
    state: GameState,
    turn: TurnState,
    onProperties: () -> Unit,
    onBankrupt: () -> Unit,
) {
    val p = P.current
    val debt = turn.debt
    val debtor = state.player(debt?.debtor)
    // Live off the balance itself — debt.amount is the same number, but the
    // climb should read straight from the figure that moves.
    val remaining = maxOf(0, -(debtor?.money ?: 0))
    val mine = debtor?.id == store.meId
    // Rent streams to a named creditor; a pay-everyone card to the players it
    // still owes, by name; taxes, repairs and fines to the bank.
    val payee = state.debtPayee(debt)

    // Drawn on the dock at its concentric r10, as the deadlock strip is, and
    // washed through the material in the bad colour the way that one is in
    // the brass.
    Column(
        Modifier
            .fillMaxWidth()
            .background(p.bad.copy(alpha = tintAlpha()), DOCK_BLOCK)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // iOS's warning here is the filled triangle in the red of the
            // number beside it, the "!" cut clean through — not the amber
            // road sign the drawn set keeps for itself. The glyph keeps the
            // raw red, as iOS's does — it is a mark beside words that say the
            // same thing — and the words take the glass's.
            CutoutGlyph("warning", 18.dp, p.bad)
            GlassMoney {
                MoneyText(
                    -remaining,
                    text = "${money(remaining)} in the red",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.ExtraBold,
                    positive = P.current.bad,
                )
            }
        }
        // Pass & play: name whose hole this is when the phone is speaking for
        // a seat that is not the main player's.
        Text(
            if (mine) "Everything you raise goes to $payee until you're square."
            else "${debtor?.name ?: "This player"} is in the red — everything they raise goes to $payee until they're square.",
            color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
        )
    }
    MMButton(
        "Back in the black", kind = BtnKind.GOOD, big = true,
        modifier = Modifier.fillMaxWidth(), enabled = remaining == 0,
    ) { store.payDebt() }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        MMButton("Raise cash", kind = BtnKind.GHOST, big = true, modifier = Modifier.weight(1f)) { onProperties() }
        MMButton("Bankrupt", kind = BtnKind.DANGER, big = true, modifier = Modifier.weight(1f)) { onBankrupt() }
    }
}

// ── everyone else's turn ───────────────────────────────────────────────────

/**
 * Somebody else is playing — or this phone's seats are out of it.
 *
 * Out of the running, the dock would otherwise sit there saying "…is
 * playing" forever with no hint that your seat is done. On a pass & play
 * phone "you" means every seat this device holds: while any of them still
 * plays, the dock is theirs, not a spectator's.
 */
@Composable
private fun WaitingRow(store: GameStore, state: GameState) {
    val p = P.current
    val locals = state.players.filter { store.isLocal(it.id) }
    val me = locals.firstOrNull { it.id == store.meId } ?: locals.firstOrNull()
    if (me != null && locals.all { it.isBankrupt }) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // Walked out, dozed off past the clock, or spent everything —
            // three different endings, so three different marks.
            Icon(
                if (me.wasRemoved) (if (me.removedFor == "quit") "door" else "snooze") else "payment",
                size = 17.dp, tint = p.ink2,
            )
            Text(
                if (me.wasRemoved) "You're out of this game — watching how it ends."
                else "You went bankrupt — watching how it ends.",
                modifier = Modifier.weight(1f),
                color = p.ink2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
            )
        }
        return
    }

    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // The line takes every bit of width the clock leaves and wraps if it
        // ever needs to, as iOS's does — never an ellipsis on a plain name.
        // iOS's Spacer keeps eight clear between the two, on top of the
        // row's ten either side of it.
        val who = store.currentPlayer
        if (who != null) {
            PlayerDisc(who, size = 26.dp)
            Text(
                "${who.name} is playing…",
                modifier = Modifier.weight(1f),
                color = p.ink2, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.width(8.dp))
        } else {
            Spacer(Modifier.weight(1f))
        }
        // The clock runs on every turn, not just yours — watching someone
        // else's tick down is what makes the wait readable. A table with only
        // one person at it has no clock, and then it shows nothing.
        TurnClock(state.turn?.endsAt, compact = true)
        Spinner()
    }
}

// ── the end ────────────────────────────────────────────────────────────────

/**
 * The game is over. Anyone can call the next one — the chair goes to whoever
 * asks first — except at a cup match, which is played once and is already in
 * the bracket. iOS's dock asks the same table to go again whatever kind of
 * table it was, and so does this one; the server takes a rematch at a
 * matchmade table as readily as at a private one.
 *
 * The result sheet can be swiped away, so the way back to the standings
 * stays here.
 */
@Composable
private fun EndedControls(store: GameStore, state: GameState) {
    val p = P.current
    if (store.canRematch) {
        MMButton(
            "Play again", kind = BtnKind.PRIMARY, big = true, icon = "replay",
            modifier = Modifier.fillMaxWidth(),
        ) { store.rematch() }
        val caption = if (!store.isHost) "Whoever presses first hosts the next one." else null
        if (caption != null) {
            Text(
                caption,
                modifier = Modifier.fillMaxWidth(),
                color = p.ink2, fontSize = 12.5.sp, fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center,
            )
        }
    }
    MMButton(
        "Final standings", kind = BtnKind.GHOST, big = true, icon = "trophy",
        modifier = Modifier.fillMaxWidth(),
    ) {
        store.openResults()
        Haptics.tap()
    }
}

// ── the lobby ──────────────────────────────────────────────────────────────

/**
 * A private table that has not started, in iOS's order: the button that
 * starts it, the board, the doors to another seat and to the rules, who is
 * sitting down and the empty chairs, and at the foot, your own look.
 *
 * Every button is the server's own gate, so nothing here comes back refused:
 * Host goes to a connected person and never to a bot; the kick and the house
 * players stay away from a cup table, which is between the two who were
 * drawn; you move yourself between teams and the host moves the bots.
 *
 * The one exception is Start Game, and it is iOS's exception too. It is never
 * greyed: with house players off and nobody else sat down, the server answers
 * "Need at least 2 players", and that sentence arrives as a toast. A dimmed
 * button with a hint under it said the same thing in a second voice that
 * iOS's lobby does not have.
 *
 * The board's three boxes sit here for everyone, host or guest. A guest
 * cannot change the board, but still wants to know where they are sitting,
 * and still gets to look through every board there is.
 */
@Composable
private fun LobbyPanel(store: GameStore, state: GameState, onSettings: () -> Unit, modifier: Modifier) {
    val p = P.current
    // The wallet, the piece shelf and the board shelf. The same instance the
    // activity holds, so a coin spent here is a coin gone on the home screen.
    val account: AccountStore = viewModel()
    val cup = state.cup == true
    val teams = state.settings.teams ?: 0

    // The panel itself stands on the page, and its controls are panes of glass
    // over it. The cards in it are paper, and say so ([OnPaper]), so a
    // control on a seat is told there is a card behind it, not the page.
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (store.isHost) {
            MarkButton("Start Game", BtnKind.PRIMARY, onClick = { store.start() }) { PlayTriangle(13.dp, it) }
        } else {
            Row(
                Modifier.padding(top = 2.dp).align(Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Spinner(15.dp)
                Text("waiting for the host…", color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        if (cup) OnPaper { CupBanner(state) }

        // A cup fixes its own board, so a cup table has no boxes to show.
        if (!cup) LobbyBoards(store, account)

        // A cup table is set by the cup: two chairs, one board, no house
        // players, and a second seat on this device would be sitting in your
        // opponent's chair. The server refuses all of it; this is so nobody
        // is invited to try.
        if (store.canAddLocalPlayer) {
            MMButton(
                "Add player on this device", kind = BtnKind.GHOST, big = true, icon = "people",
                modifier = Modifier.fillMaxWidth(),
            ) { store.addLocalPlayer() }
        }
        if (!cup) {
            MMButton(
                "Game settings", kind = BtnKind.GHOST, big = true, icon = "toolbox",
                modifier = Modifier.fillMaxWidth(),
            ) { onSettings() }
        }

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OnPaper {
                for (player in state.players) key(player.id) { LobbySeat(store, state, player, teams) }
                repeat(state.openSeats) { EmptySeat(store) }
            }
        }

        if (store.isHost && teams > 0) {
            MarkButton("Balance teams", BtnKind.GHOST, onClick = { store.balanceTeams() }) { SwapArrows(20.dp, it) }
        }

        OnPaper { YourLook(store, account, state) }
    }
}

/**
 * What this table is and what is riding on it. A cup match looks exactly
 * like any other two-player game otherwise, and losing one costs more.
 */
@Composable
private fun CupBanner(state: GameState) {
    val p = P.current
    val shape = RoundedCornerShape(13.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.goldSoft)
            .border(1.dp, p.gold, shape)
            .padding(11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Icon("trophy", size = 18.dp)
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text("Cup match", color = p.ink, fontSize = 13.5.sp, fontWeight = FontWeight.ExtraBold)
            Text(
                if (state.openSeats > 0) "Waiting for the player drawn against you"
                else "Winner goes through. Loser is out of the cup.",
                color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
            )
        }
    }
}

/**
 * The board, as three boxes with a drawing of each, on a card of its own
 * under the Start button — iOS's MMCard round BoardBoxes, with the map mark
 * and the "Board" heading BoardBoxes leaves to whoever holds it.
 *
 * The rest of the shelf and the shop for a locked board open over the table
 * as a sheet, the way iOS opens them over its lobby. Only the host deals a
 * board; everybody else gets the same boxes dimmed, and can still open every
 * board there is to read it.
 */
@Composable
private fun LobbyBoards(store: GameStore, account: AccountStore) {
    val p = P.current
    val editable = store.isHost
    var listing by remember { mutableStateOf(false) }
    var shopping by remember { mutableStateOf<String?>(null) }
    val shape = RoundedCornerShape(16.dp)
    val lift = Color.Black.copy(alpha = if (p.page.luminance() < 0.5f) 0.35f else 0.10f)

    Column(
        Modifier
            .fillMaxWidth()
            .shadow(8.dp, shape, clip = false, ambientColor = lift, spotColor = lift)
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OnPaper {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon("map", size = 13.dp, tint = p.ink2)
                PanelTitle("Board")
            }
            BoardBoxes(account, store, editable, onOpenAll = { listing = true }, onShop = { shopping = it })
        }
    }

    val board = shopping?.let { account.board(it) }
    if (listing || board != null) {
        BoardsSheet(
            store, account, editable, board,
            onPicked = { listing = false },
            onShop = { shopping = it },
            onClose = {
                shopping = null
                listing = false
            },
        )
    }
}

/**
 * Every board, or the shop for one of them, over the lobby. One sheet with two
 * faces rather than a sheet on a sheet — BoardPicker.kt's list and shop are
 * drawn to swap in place, with a Back button between them — so a shop opened
 * from the list goes back to the list, and one opened straight from a box
 * goes back to the table.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BoardsSheet(
    store: GameStore,
    account: AccountStore,
    editable: Boolean,
    board: BoardListing?,
    onPicked: () -> Unit,
    onShop: (String?) -> Unit,
    onClose: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    // A scroll position per face: the list keeps its place, and each board's
    // shop starts at its own top.
    val listScroll = rememberScrollState()
    val shopScroll = key(board?.id) { rememberScrollState() }

    // The app's one sheet ([MMSheet]) — the glass the lobby settings lay their
    // own copy of these two pages on (LobbySheet.kt's BoardPageSheet), so a
    // board's list and its shop look the same whichever door they came
    // through. A 16-point gutter for the list and 18 for a shop, as iOS's.
    MMSheet(
        onDismissRequest = onClose,
        sheetState = sheetState,
    ) {
        val gutter = if (board != null) 18.dp else 16.dp
        // Always the full height, as iOS's large detent is, with the page's
        // bar pinned over its scroll the way iOS's navigation bar stays put.
        Box(Modifier.fillMaxWidth().fillMaxHeight()) {
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.padding(horizontal = gutter).padding(top = 16.dp)) {
                    if (board != null) ShopBar { onShop(null) } else AllBoardsBar(account, onClose)
                }
                Column(
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .verticalScroll(if (board != null) shopScroll else listScroll)
                        .padding(horizontal = gutter)
                        // iOS's scroll starts nine under its bar, then the gutter.
                        .padding(top = 9.dp + gutter, bottom = 28.dp),
                ) {
                    if (board != null) {
                        BoardShop(
                            account, store, board,
                            onBought = { id ->
                                // Bought from the lobby by the host: play it straight
                                // away, which is what they were reaching for. A guest
                                // cannot deal it, so as on iOS only the shop goes and
                                // the list they bought it from stays.
                                if (editable) {
                                    store.updateSettings(mapOf("mapId" to id))
                                    onClose()
                                } else {
                                    onShop(null)
                                }
                            },
                            onBack = { onShop(null) },
                            showBar = false,
                        )
                    } else {
                        AllBoards(
                            account, store, editable,
                            onPick = { id ->
                                store.updateSettings(mapOf("mapId" to id))
                                onPicked()
                            },
                            onShop = { onShop(it) },
                            onBack = onClose,
                            showBar = false,
                        )
                    }
                }
            }
            // The table's toast, over this sheet: iOS floats its toasts above
            // every sheet, and a purchase's answer must not land underneath.
            ToastPill(store, Modifier.align(Alignment.BottomCenter))
        }
    }
}

@Composable
private fun LobbySeat(store: GameStore, state: GameState, player: PlayerState, teams: Int) {
    val p = P.current
    val team = state.teamOf(player)
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        PlayerDisc(player, size = 34.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(
                    player.name,
                    modifier = Modifier.weight(1f, fill = false),
                    color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                SeatTags(player, state.hostId, store.meId)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                MoneyText(player.money, fontSize = 12.5.sp)
                if (teams > 0 && team != null) {
                    val c = cssColor(team.color, p.ink2)
                    Text(
                        team.name,
                        modifier = Modifier
                            .clip(RoundedCornerShape(99.dp))
                            .background(c.copy(alpha = 0.16f))
                            .padding(horizontal = 7.dp, vertical = 2.dp),
                        color = c, fontSize = 10.sp, fontWeight = FontWeight.Black,
                    )
                }
            }
        }
        // iOS types "⇄" and "✕" on these two; the drawn set's arrows, laid
        // down, and its cross are the same marks.
        if (teams > 0 && store.canCycleTeam(player)) {
            GlyphButton("Move ${player.name} to the next team", onClick = {
                store.setTeam(((player.team ?: -1) + 1) % teams, player.id)
            }) { SwapArrows(18.dp, it) }
        }
        // The chair travels: a host can hand it to anyone at the table.
        if (store.canMakeHost(player)) {
            MMButton("Host", kind = BtnKind.GHOST) {
                store.makeHost(player.id)
                Haptics.tap()
            }
        }
        if (store.canKick(player)) {
            GlyphButton("Remove ${player.name} from the table", onClick = { store.kick(player.id) }) {
                Icon("close", size = 20.dp, tint = it)
            }
        }
    }
}

/** A chair nobody has taken yet, dashed, with a house player to fill it. */
@Composable
private fun EmptySeat(store: GameStore) {
    val p = P.current
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .dashedBorder(p.rule2)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Empty seat", color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.weight(1f))
        if (store.canAddBot) MMButton("Add bot", kind = BtnKind.GHOST) { store.addBot() }
    }
}

// ── your look ──────────────────────────────────────────────────────────────

/**
 * Your look at this table, at the foot of the lobby, where iOS keeps it: the
 * name, the colour, and the piece that sits in the colour — the colour is
 * half of what a player sees of themselves on the board, and the piece is
 * the other half, so they are chosen together, here, in the seconds before
 * kick-off, rather than two screens away.
 *
 * The name goes on the keyboard's Done, as iOS's field sends it on Return. A
 * colour somebody else is wearing is shown faded and cannot be pressed: the
 * server refuses two identical discs on one board, and a swatch that is
 * offered and then bounced is worse than one that is honestly taken.
 */
@Composable
private fun YourLook(store: GameStore, account: AccountStore, state: GameState) {
    val p = P.current
    val focus = LocalFocusManager.current
    val shape = RoundedCornerShape(14.dp)
    // The name as it stands at the table, not as this phone last saved it.
    var nameDraft by remember(state.id) { mutableStateOf(store.me?.name ?: store.nickname) }
    val mine = store.me?.color?.lowercase()
    val taken = state.players.filter { it.id != store.meId }.map { it.color.lowercase() }.toSet()

    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        PanelTitle("Your look")

        BasicTextField(
            value = nameDraft,
            onValueChange = { nameDraft = it },
            singleLine = true,
            textStyle = TextStyle(color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
            cursorBrush = SolidColor(p.red),
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Words,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = {
                store.rename(nameDraft)
                focus.clearFocus()
            }),
            decorationBox = { field ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(p.sunken)
                        .padding(horizontal = 12.dp, vertical = 9.dp),
                ) {
                    if (nameDraft.isEmpty()) {
                        Text("Nickname", color = p.ink3, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    }
                    field()
                }
            },
        )

        // All eight across, as iOS's grid lays them: a row a phone can hold
        // at this size, and one that reads as the whole set at a glance.
        Row(
            Modifier
                .fillMaxWidth()
                .padding(top = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (hex in LOOK_COLOURS) {
                val isTaken = hex in taken
                val isMine = hex == mine
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    Box(
                        Modifier
                            .size(26.dp)
                            // The ring stands clear of the swatch, outside
                            // its bounds, so the row does not grow for it.
                            .drawBehind {
                                if (isMine) {
                                    drawCircle(
                                        p.ink,
                                        radius = 16.5.dp.toPx(),
                                        style = Stroke(width = 2.dp.toPx()),
                                    )
                                }
                            }
                            .alpha(if (isTaken) 0.25f else 1f)
                            .clip(CircleShape)
                            .background(cssColor(hex, p.red))
                            .semantics { contentDescription = if (isMine) "Your colour" else "Colour" }
                            .clickable(enabled = !isTaken, role = Role.Button) {
                                store.setAppearance(color = hex)
                            },
                    )
                }
            }
        }

        Box(
            Modifier
                .padding(top = 2.dp)
                .fillMaxWidth()
                .height(1.dp)
                .background(p.rule),
        )

        LookPieces(store, account)
    }
}

/**
 * The piece you play as: the plain coloured disc first — the look every
 * player starts with, and the thing to tap to take a skin back off — then
 * every piece there is. Yours wear with one tap and ring gold when worn; the
 * rest show their price and open a small shop rather than bouncing an error
 * back at somebody who only wanted to look.
 *
 * The row is its full height from the first frame, holding the shape of the
 * shelf with blank discs while it is still in the post, so the seats above it
 * do not hop when it lands. A shelf whose fetch failed with nothing cached
 * gets a chip to ask again, straight away.
 */
@Composable
private fun LookPieces(store: GameStore, account: AccountStore) {
    val p = P.current
    val scope = rememberCoroutineScope()
    val tokens = account.store?.items.orEmpty().filter { it.kind == "token" }
    val wallet = account.wallet
    // Bought here and not yet back from the wallet: the shelf redraws it as
    // owned at once rather than a round trip later.
    var bought by remember { mutableStateOf(emptySet<String>()) }
    val owned = wallet?.owned.orEmpty().toSet() + bought
    val worn = wallet?.equipped?.get("token").orEmpty()

    // What the row shows while an equip is in the post. The wallet is the
    // truth and takes back over the moment it agrees; a refusal drops the
    // guess there and then, so the gold ring never sits on a piece the board
    // is not wearing.
    var guess by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(worn) { if (guess == worn) guess = null }
    val showing = guess ?: worn

    var busy by remember { mutableStateOf<String?>(null) }
    var buying by remember { mutableStateOf<String?>(null) }
    var shopping by remember { mutableStateOf<StoreItem?>(null) }
    var asks by remember { mutableIntStateOf(0) }

    // The catalogue is read back from the last launch, so from the second
    // one the row is filled on its first frame; and a fetch that fails with
    // nothing cached says so at once, as iOS's shelf does, rather than after
    // a fixed wait.
    LaunchedEffect(asks) { account.refreshStore() }
    val failed = account.storeFailed

    // No `itemId` at all is how the server spells taking a piece off; the
    // post drops a null before it builds the body.
    suspend fun wear(item: StoreItem?) {
        guess = item?.id.orEmpty()
        val reply = store.api.postOrError("/api/store/equip", mapOf("slot" to "token", "itemId" to item?.id))
        if (reply.ok) {
            // The same note the Store tab writes when it equips, so the two
            // screens agree about what this device is wearing.
            store.prefs.tokenSkin = item?.emoji.orEmpty()
        } else {
            guess = null
            store.showToast(reply.error ?: "Couldn't change your look — try again.", isError = true)
        }
        account.refreshStore()
    }

    fun equip(item: StoreItem?) {
        // One at a time: an impatient second tap must not race the first.
        if (busy != null) return
        busy = item?.id.orEmpty()
        SoundKit.click()
        scope.launch {
            wear(item)
            busy = null
        }
    }

    // Buy it if it is not yours yet, then wear it — or take it off, if it is
    // the one already on. Buying always ends with the piece worn: somebody
    // came here to change their piece, not to shop.
    fun shop(item: StoreItem) {
        if (buying != null) return
        val have = item.id in owned
        val on = showing == item.id
        buying = item.id
        SoundKit.click()
        scope.launch {
            var ours = have
            if (!have) {
                val reply = store.api.postOrError("/api/store/buy", mapOf("itemId" to item.id, "expect" to item.price))
                if (reply.ok) {
                    SoundKit.buy()
                    // The purse the reply states, at once, as iOS writes it.
                    account.noteBuyReply(reply.body)
                    store.showToast("${item.emoji} ${item.name} is yours!")
                    bought = bought + item.id
                    ours = true
                } else {
                    // A request that never landed must not read as a
                    // purchase: the coins only moved if the server said so.
                    store.showToast(reply.error ?: "Couldn't reach the shop — try again.", isError = true)
                }
            }
            if (ours) wear(if (on) null else item)
            buying = null
        }
    }

    val disc = cssColor(store.me?.color ?: LOOK_COLOURS.first(), p.red)
    val initial = (store.me?.name ?: store.nickname).take(1).uppercase()
    val coins = wallet?.coins ?: 0

    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            PanelTitle("Your piece")
            Spacer(Modifier.weight(1f))
            Icon("coin", size = 11.dp)
            Spacer(Modifier.width(4.dp))
            Text("$coins", color = p.gold, fontSize = 11.5.sp, fontWeight = FontWeight.ExtraBold)
        }
        Row(
            Modifier
                .fillMaxWidth()
                .height(78.dp)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 2.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            LookChip(
                emoji = "", initial = initial, label = "Classic", price = null,
                selected = showing.isEmpty(), working = busy == "", disc = disc,
            ) { equip(null) }
            for (item in tokens) {
                key(item.id) {
                    val have = item.id in owned
                    LookChip(
                        emoji = item.emoji, initial = initial, label = item.name,
                        price = if (have) null else item.price,
                        selected = showing == item.id, working = busy == item.id, disc = disc,
                    ) {
                        if (have) {
                            equip(item)
                        } else {
                            // Not yours yet — that is a shop trip, not a failed tap.
                            SoundKit.click()
                            shopping = item
                        }
                    }
                }
            }
            if (tokens.isEmpty()) {
                if (failed) {
                    RetryChip {
                        SoundKit.click()
                        asks++
                    }
                } else {
                    repeat(4) { GhostChip() }
                }
            }
        }
    }

    // iOS's PieceShopSheet, the one PiecePicker.kt draws: an inline centred
    // title, Done as the bar's text button, and the grabber. The table's
    // toast rides inside it, because a sheet is a window over the one the
    // table's toast is drawn in, and "is yours!" must not land unseen.
    shopping?.let { first ->
        PieceShopSheet(
            first = first, tokens = tokens, coins = coins, owned = owned, worn = showing, buying = buying,
            onBuy = { shop(it) },
            onDismiss = { shopping = null },
            game = store,
        )
    }
}

/** One piece on the shelf: the disc, then its name — or, not yours yet, its price. */
@Composable
private fun LookChip(
    emoji: String,
    initial: String,
    label: String,
    price: Int?,
    selected: Boolean,
    working: Boolean,
    disc: Color,
    onTap: () -> Unit,
) {
    val p = P.current
    val have = price == null
    Column(
        Modifier
            .width(60.dp)
            .clickable(role = Role.Button) { onTap() },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            Modifier
                .size(46.dp)
                .shadow(if (have) 3.dp else 0.dp, CircleShape, clip = false, ambientColor = CHIP_SHADOW, spotColor = CHIP_SHADOW)
                .clip(CircleShape)
                .background(if (have) disc else p.sunken)
                .border(if (selected) 2.5.dp else 1.dp, if (selected) p.gold else p.rule, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (emoji.isEmpty()) {
                Text(initial, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Black)
            } else {
                // A bought skin is the player's own chosen emoji — the one
                // place in the chrome where an emoji is the content rather
                // than a drawing standing in for one. One not yet owned is
                // shown faded and mostly grey, as iOS shows it.
                Text(
                    emoji,
                    fontSize = 25.sp,
                    modifier = if (have) Modifier else Modifier.alpha(0.55f).desaturate(0.2f),
                )
            }
            if (working) {
                Box(
                    Modifier
                        .matchParentSize()
                        .background(Color.Black.copy(alpha = 0.35f)),
                )
                CircularProgressIndicator(Modifier.size(14.dp), color = Color.White, strokeWidth = 2.dp)
            }
        }
        Row(
            Modifier.height(13.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(2.5.dp),
        ) {
            if (price != null) {
                Icon("coin", size = 10.dp)
                Text("$price", color = p.ink3, fontSize = 10.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1)
            } else {
                Text(
                    label,
                    color = if (selected) p.gold else p.ink2,
                    fontSize = 10.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** The shelf never came. One tap asks again — the lobby is no place to be stuck with no pieces. */
@Composable
private fun RetryChip(onTap: () -> Unit) {
    val p = P.current
    Column(
        Modifier
            .width(60.dp)
            .clickable(role = Role.Button) { onTap() },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            Modifier
                .size(46.dp)
                .clip(CircleShape)
                .background(p.sunken)
                .border(1.dp, p.rule, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon("replay", size = 19.dp, tint = p.ink2)
        }
        Box(Modifier.height(13.dp), contentAlignment = Alignment.Center) {
            Text("Try again", color = p.ink2, fontSize = 10.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        }
    }
}

/** A blank disc holding a place on the shelf while it is still in the post. */
@Composable
private fun GhostChip() {
    val p = P.current
    Column(
        Modifier
            .width(60.dp)
            .alpha(0.6f),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            Modifier
                .size(46.dp)
                .clip(CircleShape)
                .background(p.sunken),
        )
        Spacer(Modifier.height(13.dp))
    }
}


/**
 * The seat colours, exactly as `COLORS` in server/game.js lists them and in
 * iOS's order. The server checks an incoming colour against its list and
 * drops anything else, so a ninth colour here would be a swatch that quietly
 * never applies.
 */
private val LOOK_COLOURS = listOf(
    "#4ade80", "#60a5fa", "#f472b6", "#fbbf24",
    "#a78bfa", "#fb7185", "#22d3ee", "#f97316",
)


private val CHIP_SHADOW = Color.Black.copy(alpha = 0.28f)

// ── small parts ────────────────────────────────────────────────────────────

/** iOS's PanelTitle: small tracked capitals over a group, in the quietest ink. */
@Composable
private fun PanelTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        modifier = modifier,
        color = P.current.ink3,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 1.sp,
        maxLines = 1,
    )
}

/**
 * MMButton, big, led by a mark the drawn set has no glyph for — iOS types "▶"
 * in front of Start Game and "⇄" in front of Balance teams. MMButton's icon
 * slot takes a glyph by name and draws it upright, so these two hand theirs
 * in through its lead instead, which gives the mark the ink the words are in.
 * This was a copy of the old paper button, drawn out by hand; it is now the
 * button itself, so it wears the glass the rest of the column does and a
 * primary here is the same plate as a primary anywhere.
 */
@Composable
private fun MarkButton(
    label: String,
    kind: BtnKind,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    mark: @Composable (Color) -> Unit,
) {
    MMButton(label, modifier.fillMaxWidth(), kind = kind, big = true, lead = mark, onClick = onClick)
}

/**
 * A ghost button that is only a drawing — the properties and trade doors
 * beside End turn, a seat's team swap and its kick. It is MMButton with no
 * words, so on the dock it is a well in the dock's own ink and on a seat card
 * a pane of glass, whichever the place says, rather than a sunken paper
 * square wherever it is put.
 *
 * The two big doors frame their drawings in 30 by 26, as iOS does, so the
 * pair are one width whatever the shape inside — and at iOS's 22 points of
 * padding either side, the width iOS gives them.
 */
@Composable
private fun GlyphButton(
    description: String,
    big: Boolean = false,
    onClick: () -> Unit,
    glyph: @Composable (Color) -> Unit,
) {
    MMButton(
        "",
        Modifier.semantics { contentDescription = description },
        kind = BtnKind.GHOST,
        big = big,
        lead = { ink ->
            Box(if (big) Modifier.size(30.dp, 26.dp) else Modifier, contentAlignment = Alignment.Center) {
                glyph(ink)
            }
        },
        onClick = onClick,
    )
}

/** Something is happening that is not this phone's to hurry. */
@Composable
private fun Spinner(size: Dp = 16.dp) {
    CircularProgressIndicator(Modifier.size(size), color = P.current.red, strokeWidth = 2.dp)
}

/**
 * An image drawn at [amount] of its colour — 1 is untouched, 0 is grey. iOS's
 * grayscale modifier, on the emoji of a piece not yet owned: a colour matrix
 * on a layer of its own, which every Android this app runs on can draw.
 */
private fun Modifier.desaturate(amount: Float): Modifier = drawWithContent {
    val paint = Paint().apply {
        colorFilter = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(amount) })
    }
    drawIntoCanvas { canvas ->
        canvas.saveLayer(Rect(Offset.Zero, size), paint)
        drawContent()
        canvas.restore()
    }
}

// ── marks iOS types that the drawn set does not have ───────────────────────
//
// Used here and by the centre well's log (CenterWell.kt), which is why they
// are not private. Each is the nearest drawing of a mark iOS gets from its
// font or its symbol set; Glyphs.kt is generated from the web client's icons
// and is not the place to invent new ones.

/**
 * iOS's ▶: the play triangle it types in front of "Start Game" and draws in
 * its log at the start of each turn. The drawn set's nearest is the GO
 * arrows, a double chevron in its own green that says "pass GO" rather than
 * "begin", so the triangle is drawn here, pointing right, its corners eased
 * the way the system font's are.
 */
@Composable
internal fun PlayTriangle(size: Dp, tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height
        val path = Path().apply {
            moveTo(w * 0.12f, h * 0.06f)
            lineTo(w * 0.94f, h * 0.5f)
            lineTo(w * 0.12f, h * 0.94f)
            close()
        }
        drawPath(path, tint)
        // Rounds the three corners without shrinking the shape by much.
        drawPath(path, tint, style = Stroke(width = w * 0.1f, join = StrokeJoin.Round))
    }
}

/**
 * iOS's ⇄ — typed on the lobby's team buttons — and, [flipped], the ⇆ of the
 * SF symbol on its trade door and in its log. The drawn set's swap glyph is
 * the same two passing arrows stood on end, so it is turned a quarter to lie
 * down; flipped, it is mirrored as well, which puts the left-pointing arrow on
 * top the way the symbol has it.
 */
@Composable
internal fun SwapArrows(size: Dp, tint: Color, flipped: Boolean = false, modifier: Modifier = Modifier) {
    Icon(
        "swap", size = size, tint = tint,
        modifier = modifier.graphicsLayer {
            rotationZ = 90f
            if (flipped) scaleX = -1f
        },
    )
}

/**
 * A glyph as one solid shape in [tint] with its inner marks cut clean
 * through: iOS's filled symbols — the warning triangle and its "!", the house
 * and its door, the question card — where the drawn set has the same shapes
 * in colours of their own that no tint reaches. The glyph's first part is the
 * body and every later part is a hole; with [holes] off they are all body,
 * which makes a silhouette of a glyph with nothing inside it to cut.
 */
@Composable
internal fun CutoutGlyph(
    name: String,
    size: Dp,
    tint: Color,
    modifier: Modifier = Modifier,
    holes: Boolean = true,
) {
    val parts = remember(name) {
        GLYPHS[name].orEmpty().map { part ->
            part to PathParser().parsePathString(part.d).toPath().apply {
                fillType = if (part.evenOdd) PathFillType.EvenOdd else PathFillType.NonZero
            }
        }
    }
    if (parts.isEmpty()) return
    // A layer of its own, so a hole goes through this glyph and no further.
    Canvas(modifier.size(size).graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }) {
        val k = this.size.minDimension / GLYPH_GRID
        scale(k, k, pivot = Offset.Zero) {
            parts.forEachIndexed { i, (part, path) ->
                val blend = if (holes && i > 0) BlendMode.Clear else BlendMode.SrcOver
                if (part.fill != null) drawPath(path, tint, blendMode = blend)
                if (part.stroke != null) {
                    drawPath(
                        path, tint, blendMode = blend,
                        style = Stroke(
                            width = part.strokeWidth,
                            cap = if (part.cap == 1) StrokeCap.Round else if (part.cap == 2) StrokeCap.Square else StrokeCap.Butt,
                            join = if (part.join == 1) StrokeJoin.Round else if (part.join == 2) StrokeJoin.Bevel else StrokeJoin.Miter,
                        ),
                    )
                }
            }
        }
    }
}

/**
 * iOS's crossed octagon — the stop sign its log puts beside a bankruptcy. A
 * skull says the same thing louder than iOS does; this is the mark itself, a
 * flat-topped octagon in [tint] with the cross cut through it.
 */
@Composable
internal fun OctagonCross(size: Dp, tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.size(size).graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }) {
        val s = this.size.minDimension
        val c = s / 2f
        val octagon = Path().apply {
            for (i in 0 until 8) {
                val a = Math.PI / 8 + i * Math.PI / 4
                val x = c + c * kotlin.math.cos(a).toFloat()
                val y = c + c * kotlin.math.sin(a).toFloat()
                if (i == 0) moveTo(x, y) else lineTo(x, y)
            }
            close()
        }
        drawPath(octagon, tint)
        val d = s * 0.19f
        val w = s * 0.13f
        drawLine(Color.Black, Offset(c - d, c - d), Offset(c + d, c + d), strokeWidth = w, cap = StrokeCap.Round, blendMode = BlendMode.Clear)
        drawLine(Color.Black, Offset(c + d, c - d), Offset(c - d, c + d), strokeWidth = w, cap = StrokeCap.Round, blendMode = BlendMode.Clear)
    }
}

/** The grid every drawn glyph is laid out on (Art.GRID). */
private const val GLYPH_GRID = 32f
