package com.moneymove.game

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.Brush
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/**
 * The game's settings.
 *
 * iOS's SettingsSheet section for section, in its order and in its words: the
 * board, the players, the teams, the table's style, the money, the rules. The
 * two phones sit at the same tables, and a host on one reading "Vacation
 * cash" while the guest on the other reads something else for the same
 * switch is two people arguing about different rules.
 *
 * Only the host may change anything, and only in the lobby; everybody else
 * gets the same rows, dimmed, which is how you find out what you have sat
 * down to. The seats are not here: iOS keeps them, Add player and the kick in
 * the lobby panel under the board (ActionPanel.kt), and a second copy would be
 * a second place to kick.
 *
 * Every board there is, and the shop for one of them, come up as sheets of
 * their own on top of this one, the way iOS stacks BoardPickerSheet and
 * BoardBuySheet over its settings — on the page's colour rather than the
 * sheet's, as iOS paints them, and each gone again with its own Done or Close
 * to leave the settings exactly where they were. They used to be drawn in
 * place of the settings, which on a phone beside an iPhone was a different
 * sheet changing its face where iOS slides a new one up.
 *
 * `onTheme` is the app's own table-style setter. The style is the player's,
 * not the room's, and it lives with the activity rather than with the game —
 * so the section only appears when the screen that opened this hands it over,
 * which the table always does.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LobbySheet(
    store: AccountStore,
    game: GameStore,
    onTheme: ((MMTheme) -> Unit)? = null,
    onDismiss: () -> Unit,
) {
    val p = P.current
    if (game.state == null) return onDismiss()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.sheet,
        // The grabber is drawn into the settings' own bar, where iOS puts it.
        dragHandle = null,
    ) {
        Box(Modifier.fillMaxWidth()) {
            // Done lowers the sheet first and only then lets it go, as iOS's
            // dismiss() slides it down, rather than taking it off in a frame.
            LobbySetup(
                store, game,
                onDone = { scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() } },
                onTheme = onTheme,
            )
            // iOS floats its toasts above every sheet; this sheet is a window
            // over the one the table's toast is drawn in, so it draws it too.
            ToastPill(game, Modifier.align(Alignment.BottomCenter))
        }
    }
}

/**
 * The settings without a sheet around them — for a screen wide enough to keep
 * the setup beside the board, the way iPad's lobby does. It scrolls itself;
 * give it a bounded height. With no `onDone` there is no Done button and no
 * grabber, because there is nothing to close. The board list and the shop
 * still come up as sheets, as they do over iPad's lobby.
 */
@Composable
fun LobbySetup(
    store: AccountStore,
    game: GameStore,
    modifier: Modifier = Modifier,
    onDone: (() -> Unit)? = null,
    onTheme: ((MMTheme) -> Unit)? = null,
) {
    val state = game.state ?: return
    // iOS's canEdit, and only that: the host, while the table is still in the
    // lobby. The lobby panel never offers this sheet at a cup table or to a
    // quick table waiting on its fuse, exactly as iOS's does not.
    val editable = game.isHost && state.isLobby

    // The two sheets that can stand on this one. A board id here is the shop,
    // open on that board.
    var allBoards by remember { mutableStateOf(false) }
    var shopping by remember { mutableStateOf<String?>(null) }
    val shopBoard = shopping?.let { store.board(it) }

    // A board the shelf has since stopped listing closes its shop rather than
    // leaving a wish behind that would spring a sheet about it the next time
    // the shelf happened to list it again.
    LaunchedEffect(shopping, shopBoard) {
        if (shopping != null && shopBoard == null) shopping = null
    }

    LaunchedEffect(Unit) { store.refreshStore() }

    Box(modifier.fillMaxWidth()) {
        // iOS's own gutter: 14 across and 12 down — under a bar 69 high that
        // the cards scroll up beneath, as they pass under iOS's transparent
        // inline bar, rather than being cut off in a straight line under it.
        // At rest the first card sits exactly where it did below the bar.
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 14.dp)
                .padding(top = SETTINGS_BAR + 12.dp, bottom = 12.dp),
        ) {
            SettingsFace(
                store, game, state, editable, onTheme,
                onOpenAll = { allBoards = true },
                onShop = { shopping = it },
            )
        }
        // iOS's navigation bar stays where it is while the settings scroll
        // beneath it, over a soft fade of the sheet into what passes under.
        val sheet = P.current.sheet
        Box(
            Modifier
                .fillMaxWidth()
                .background(Brush.verticalGradient(0f to sheet, 0.72f to sheet, 1f to sheet.copy(alpha = 0f))),
        ) {
            SettingsBar(onDone)
        }
    }

    // iOS's BoardPickerSheet pads its shelves 16 all round.
    if (allBoards) {
        BoardPageSheet(
            game, gutter = 16.dp, onClose = { allBoards = false },
            bar = { close -> AllBoardsBar(store, close) },
        ) { close ->
            AllBoards(
                store, game, editable,
                // Picking one is the answer to what the list was opened for,
                // so the list goes, as iOS's does.
                onPick = { id ->
                    game.updateSettings(mapOf("mapId" to id))
                    close()
                },
                onShop = { shopping = it },
                onBack = close,
                showBar = false,
            )
        }
    }

    // Composed after the list, so a shop opened from the list comes up over
    // it rather than under it. iOS's BoardBuySheet pads itself 18 all round.
    // Keyed on the board, so a second board's shop is a fresh sheet scrolled
    // to its top, not the first one's wearing a new name.
    if (shopBoard != null) {
        key(shopBoard.id) {
            BoardPageSheet(
                game, gutter = 18.dp, onClose = { shopping = null },
                bar = { close -> ShopBar(close) },
            ) { close ->
                BoardShop(
                    store, game, shopBoard,
                    showBar = false,
                    onBought = { id ->
                        // Bought from the lobby: play it straight away. That
                        // is what they were reaching for when they tapped it —
                        // and, as on iOS, a host who bought it from the list
                        // is done with the list too. Anyone else is still
                        // looking, so their list stays.
                        if (editable) {
                            game.updateSettings(mapOf("mapId" to id))
                            allBoards = false
                        }
                        close()
                    },
                    onBack = close,
                )
            }
        }
    }
}

/**
 * A sheet on top of the settings for one of BoardPicker.kt's two big pages,
 * as iOS presents them: its own sheet on the page's colour, no grabber (iOS
 * asks for none on either), always the full height (the large detent), the
 * page's own bar pinned at the top where iOS's navigation bar sits, and the
 * page's own scroll under it. Its way out lowers it first and only then lets
 * go of it, so it slides down the way it came up rather than blinking out.
 * The table's toast is drawn over it, as iOS floats its toasts over sheets.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BoardPageSheet(
    game: GameStore,
    gutter: Dp,
    onClose: () -> Unit,
    bar: @Composable (close: () -> Unit) -> Unit,
    content: @Composable (close: () -> Unit) -> Unit,
) {
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val close: () -> Unit = {
        scope.launch { sheetState.hide() }.invokeOnCompletion { onClose() }
    }
    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = sheetState,
        containerColor = p.page,
        dragHandle = null,
    ) {
        Box(Modifier.fillMaxWidth().fillMaxHeight()) {
            Column(Modifier.fillMaxSize()) {
                // Sixteen above the page's 44-high bar puts its title and its
                // button on the line iOS's navigation bar puts them, as the
                // settings' own bar does. It stays there while the page scrolls.
                Box(Modifier.padding(horizontal = gutter).padding(top = 16.dp)) { bar(close) }
                // iOS's scroll starts where its bar ends, nine points below
                // it on these sheets, and then the page's own gutter.
                Column(
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = gutter)
                        .padding(top = 9.dp + gutter, bottom = gutter),
                ) {
                    content(close)
                }
            }
            ToastPill(game, Modifier.align(Alignment.BottomCenter))
        }
    }
}

/** What each menu offers — SettingsSheet.swift's lists, which are the ranges the server clamps to. */
private val MAX_PLAYERS = (2..8).toList()
private val STARTING_CASH = listOf(500, 1000, 1500, 2000, 2500, 3000, 5000)
private val TURN_CLOCK = listOf(0, 30, 60, 90, 120, 180)
private val TEAM_COUNTS = listOf(0, 2, 3, 4)

/**
 * The settings themselves, the six cards of iOS's SettingsSheet. They bring
 * no gutter of their own; [LobbySetup] gives them iOS's.
 */
@Composable
private fun SettingsFace(
    store: AccountStore,
    game: GameStore,
    state: GameState,
    editable: Boolean,
    onTheme: ((MMTheme) -> Unit)?,
    onOpenAll: () -> Unit,
    onShop: (String) -> Unit,
) {
    val p = P.current
    val s = state.settings
    val teams = s.teams ?: 0
    val clock = s.turnSeconds ?: 90

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (!editable) {
            LockedNote(
                if (state.isLobby) "Only the host can change the settings."
                else "Settings are locked once the game starts.",
            )
        }

        // Three boards, each wearing its own drawn map, under the same header
        // the lobby panel gives them — so there is one board picker in the app.
        SettingsCard(spacing = 8.dp) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon("map", size = 13.dp, tint = p.ink2)
                PanelTitle("Board")
            }
            BoardBoxes(store, game, editable, onOpenAll = onOpenAll, onShop = onShop)
        }

        SettingsCard {
            PanelTitle("Players")
            MenuRow(
                "Max players", "${s.maxPlayers}",
                MAX_PLAYERS.map { "$it players" to it },
                s.maxPlayers, editable,
            ) { game.updateSettings(mapOf("maxPlayers" to it)) }
            Rule()
            ToggleRow(
                "Private room", "Hidden from the public room list — invite link only.",
                s.isPrivate ?: true, editable,
            ) { game.updateSettings(mapOf("isPrivate" to it)) }
            Rule()
            ToggleRow(
                "Allow bots", "Empty seats are filled with bots when the game starts.",
                s.allowBots ?: false, editable,
            ) { game.updateSettings(mapOf("allowBots" to it)) }
        }

        SettingsCard {
            PanelTitle("Teams")
            MenuRow(
                "Teams", teamsLabel(teams),
                TEAM_COUNTS.map { teamsLabel(it) to it },
                teams, editable,
            ) { game.updateSettings(mapOf("teams" to it)) }
            if (teams > 0) BalanceTeams(game, editable)
            Caption("Teammates never charge each other rent and win together")
        }

        if (onTheme != null) {
            SettingsCard(padding = 16.dp, spacing = 10.dp) {
                PanelTitle("Table style")
                TableStyle(onTheme)
            }
        }

        SettingsCard {
            PanelTitle("Money")
            MenuRow(
                "Starting cash", money(s.startingCash),
                STARTING_CASH.map { money(it) to it },
                s.startingCash, editable,
            ) { game.updateSettings(mapOf("startingCash" to it)) }
        }

        // A switch whose key is missing from the push reads what iOS reads
        // for it, so the two phones cannot show one table two ways.
        SettingsCard {
            PanelTitle("Rules")
            MenuRow(
                "Turn clock", if (clock == 0) "Off" else "${clock}s",
                TURN_CLOCK.map { (if (it == 0) "Off" else "$it seconds") to it },
                clock, editable,
            ) { game.updateSettings(mapOf("turnSeconds" to it)) }
            Caption("Run out of time and the table moves on without you.")
            Rule()
            ToggleRow(
                "x2 rent on full sets", "Unimproved streets earn double once you own the whole set.",
                s.x2rent ?: false, editable,
            ) { game.updateSettings(mapOf("x2rent" to it)) }
            Rule()
            ToggleRow(
                "Vacation cash", "Taxes and fees pile up on Vacation for whoever lands there.",
                s.vacationCash ?: false, editable,
            ) { game.updateSettings(mapOf("vacationCash" to it)) }
            Rule()
            ToggleRow(
                "Auction", "Skipped properties go under the hammer instead of staying unsold.",
                s.auction ?: true, editable,
            ) { game.updateSettings(mapOf("auction" to it)) }
            Rule()
            ToggleRow(
                "No rent while jailed", "Owners collect nothing while they sit in prison.",
                s.noRentInPrison ?: false, editable,
            ) { game.updateSettings(mapOf("noRentInPrison" to it)) }
            Rule()
            ToggleRow(
                "Mortgage", "Properties can be mortgaged to the bank for quick cash.",
                s.mortgage ?: true, editable,
            ) { game.updateSettings(mapOf("mortgage" to it)) }
            Rule()
            ToggleRow(
                "Even build", "Houses must be spread evenly across a colour set.",
                s.evenBuild ?: true, editable,
            ) { game.updateSettings(mapOf("evenBuild" to it)) }
            Rule()
            ToggleRow(
                "Randomize order", "Shuffle the turn order when the game starts.",
                s.randomizeOrder ?: true, editable,
            ) { game.updateSettings(mapOf("randomizeOrder" to it)) }
        }
    }
}

// ── the bar ─────────────────────────────────────────────────────────────────

/** The settings bar's height: 16 over the 44-point bar and 9 under it. */
private val SETTINGS_BAR = 69.dp

/**
 * The strip across the top, laid out the way iOS's inline navigation bar
 * lays it out: the grabber over it, "Game settings" in the middle in the
 * system's 17-point semibold, and Done on the right. iOS has no mark beside
 * the title and nothing on the left.
 */
@Composable
private fun SettingsBar(onDone: (() -> Unit)?) {
    val p = P.current
    Box(Modifier.fillMaxWidth()) {
        if (onDone != null) SheetGrabber(Modifier.align(Alignment.TopCenter).padding(top = 5.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                // On the iPhone the Done capsule's top is 16.7 under the
                // sheet's edge and the first card's top 21 under its
                // bottom, of which the settings' own gutter is 12.
                .padding(top = 16.dp, bottom = 9.dp)
                .heightIn(min = 44.dp),
        ) {
            Text(
                "Game settings",
                modifier = Modifier.align(Alignment.Center),
                color = p.ink,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
            if (onDone != null) DoneCapsule(Modifier.align(Alignment.CenterEnd), onDone)
        }
    }
}

/**
 * iOS's Done: the toolbar's pale 44-point capsule, with the word in the bold
 * rounded 16 the sheet asks for and tinted the table's accent. Not an
 * outlined button — iOS does not draw one there.
 */
@Composable
private fun DoneCapsule(modifier: Modifier, onClick: () -> Unit) {
    val p = P.current
    // A shade between the card and the sunken fill, with a lighter hairline
    // round it — measured off the iPhone, where the capsule's edge stands
    // clear of the sheet rather than melting into it.
    Box(
        modifier
            .height(44.dp)
            .clip(CircleShape)
            .background(lerp(p.card, p.sunken, 0.5f))
            .border(1.dp, p.rule2, CircleShape)
            .clickable(role = Role.Button) { onClick() }
            .padding(horizontal = 15.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text("Done", color = p.red, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

/**
 * iOS's sheet grabber, which this sheet asks for by name: 36 by 5, five
 * points down from the top edge, in the system's faint label grey. That grey
 * is iOS's own rather than a table ink, so it is the same on every style.
 */
@Composable
private fun SheetGrabber(modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(width = 36.dp, height = 5.dp)
            .clip(CircleShape)
            .background(systemFaintGrey(P.current.sheet.luminance() < 0.5f)),
    )
}

// ── the cards ───────────────────────────────────────────────────────────────

/**
 * iOS's MMCard with its rows twelve apart: 16 round, the card fill, a
 * hairline, and the soft lift under it — deeper in the dark, where a card
 * needs more to stand off the sheet.
 */
@Composable
private fun SettingsCard(
    padding: Dp = 14.dp,
    spacing: Dp = 12.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val p = P.current
    val shape = RoundedCornerShape(16.dp)
    val lift = Color.Black.copy(alpha = if (p.page.luminance() < 0.5f) 0.35f else 0.10f)
    Column(
        Modifier
            .fillMaxWidth()
            .shadow(8.dp, shape, clip = false, ambientColor = lift, spotColor = lift)
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .padding(padding),
        verticalArrangement = Arrangement.spacedBy(spacing),
        content = content,
    )
}

/** iOS's PanelTitle: small capitals tracked a point apart, in the quietest ink. */
@Composable
private fun PanelTitle(text: String) {
    Text(
        text.uppercase(),
        color = P.current.ink3,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 1.sp,
        maxLines = 1,
    )
}

/** The line under a control — iOS's 12-point medium in the quietest ink. */
@Composable
private fun Caption(text: String) {
    Text(text, color = P.current.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium)
}

/** Why the rows are dimmed — whose they are, or that the game has them now. */
@Composable
private fun LockedNote(text: String) {
    val p = P.current
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Padlock(p.ink3)
        Text(text, color = p.ink2, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

/**
 * Deal everybody across the teams as evenly as the seats allow — iOS's
 * "⇄  Balance teams", a big ghost button: the sunken fill, no keyline, the
 * 17-point bold label. iOS's button style never reads the disabled flag, so a
 * guest sees it at full strength; it simply does nothing for them.
 */
@Composable
private fun BalanceTeams(game: GameStore, enabled: Boolean) {
    val p = P.current
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.sunken)
            .clickable(enabled = enabled, role = Role.Button) { game.balanceTeams() }
            .padding(horizontal = 22.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TeamSwapMark(18.dp, p.ink)
        Spacer(Modifier.width(8.dp))
        Text("Balance teams", color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

// ── the rows ────────────────────────────────────────────────────────────────

/**
 * One switch. The whole row is the control, as iOS's Toggle is, and it only
 * moves when the server's next push says so — no local state to drift from
 * the room. A locked row keeps its colours at iOS's 0.6 rather than going
 * the grey a disabled control goes, so a guest can still read it.
 */
@Composable
private fun ToggleRow(
    title: String,
    caption: String,
    on: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    val p = P.current
    Row(
        Modifier
            .fillMaxWidth()
            .alpha(if (enabled) 1f else 0.6f)
            .toggleable(value = on, enabled = enabled, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold)
            Caption(caption)
        }
        // iOS stops a caption well short of its switch: on the iPhone
        // "Hidden from the public room list — invite link only." breaks
        // before "link", which leaves more than 31 between the words and the
        // switch, and "…bots when the" still fits, which leaves less than
        // 50. Twelve here ran the captions on under the switch's shoulder and
        // broke them in different places from the iPhone beside it.
        Spacer(Modifier.width(40.dp))
        // A disabled SwiftUI Toggle fades the switch itself on top of the
        // row's 0.6, so a guest's switches sit back further than their words.
        // The half is the system's usual disabled fade; it has not been
        // measured off a guest's iPhone.
        SwitchMark(on, Modifier.alpha(if (enabled) 1f else 0.5f))
    }
}

/**
 * The switch itself, drawn, because Material's is a different object. iOS's —
 * measured off the sheet on an iPhone — is a 63 by 28 capsule holding a white
 * 37 by 24 capsule of a knob two points in from either end: the table's accent
 * when on, the system's faint grey when off, and the same white knob either
 * way. Material's is shorter and taller, with a round knob that shrinks while
 * it is off, a keyline round the well and, in the dark Felt table, a knob in
 * the accent's own near-black; nine of those down one sheet read as a
 * different sheet. It is only the picture: the row around it is the control,
 * and the row is what tells a screen reader it is a switch.
 */
@Composable
private fun SwitchMark(on: Boolean, modifier: Modifier = Modifier) {
    val p = P.current
    val offWell = systemFaintGrey(p.sheet.luminance() < 0.5f)
    // iOS's switch settles in about a quarter of a second without a bounce —
    // the same spring the table-style dots use below.
    val t by animateFloatAsState(
        if (on) 1f else 0f, spring(dampingRatio = 1f, stiffness = 630f), label = "switch",
    )
    Canvas(modifier.size(width = 63.dp, height = 28.dp)) {
        val h = size.height
        drawRoundRect(lerp(offWell, p.red, t), cornerRadius = CornerRadius(h / 2))
        val inset = 2.dp.toPx()
        val knobW = 37.dp.toPx()
        val knobH = h - inset * 2
        drawRoundRect(
            Color.White,
            topLeft = Offset(inset + (size.width - inset * 2 - knobW) * t, inset),
            size = Size(knobW, knobH),
            cornerRadius = CornerRadius(knobH / 2),
        )
    }
}

/**
 * iOS's faint system grey — its tertiary label colour, a third of the way to
 * the label ink. It is the switch's empty well and the sheet's grabber, and it
 * is iOS's own rather than a table ink, so it is the same on every style. The
 * dark value is what the iPhone draws under an off switch on the Felt card,
 * to within a unit or two on each channel.
 */
private fun systemFaintGrey(dark: Boolean): Color =
    if (dark) Color(0x4DEBEBF5) else Color(0x4D3C3C43)

/**
 * A choice from a short list, as iOS's menu row: the name, the value in the
 * accent, the up-and-down chevrons, and a list in the system's 17-point
 * regular with a tick leading the current one. Seven cash amounts will not
 * sit across a phone as chips, which is why iOS made this a menu.
 */
@Composable
private fun <T> MenuRow(
    title: String,
    value: String,
    options: List<Pair<String, T>>,
    current: T,
    enabled: Boolean,
    onPick: (T) -> Unit,
) {
    val p = P.current
    var open by remember { mutableStateOf(false) }
    Box {
        // As tall as its words and no taller, which is how tall iOS's menu
        // label is — about 17 on the iPhone. A 32-high floor sat each of
        // these rows about eight lower than iOS's and made every card with
        // one in it fifteen longer. The thumb loses nothing by it: Compose already
        // stretches a small target's touch out to the platform minimum.
        Row(
            Modifier
                .fillMaxWidth()
                .alpha(if (enabled) 1f else 0.6f)
                .clickable(enabled = enabled) { open = true },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            Text(value, color = p.red, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            Spacer(Modifier.width(8.dp))
            UpDownChevrons(p.ink3)
        }
        DropdownMenu(
            expanded = open && enabled,
            onDismissRequest = { open = false },
            shape = RoundedCornerShape(14.dp),
            containerColor = p.card,
            border = BorderStroke(1.dp, p.rule),
        ) {
            for ((label, v) in options) {
                val ticked = v == current
                DropdownMenuItem(
                    // Every row keeps the tick's column, ticked or not, so the
                    // words line up down the list the way iOS lines them up.
                    leadingIcon = {
                        Box(Modifier.size(16.dp), contentAlignment = Alignment.Center) {
                            if (ticked) MenuTick(p.ink)
                        }
                    },
                    text = {
                        Text(label, color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.Normal, maxLines = 1)
                    },
                    onClick = {
                        open = false
                        if (!ticked) onPick(v)
                    },
                )
            }
        }
    }
}

private fun teamsLabel(n: Int): String = if (n == 0) "Off" else "$n teams"

/**
 * The seven table styles as a row of dots, and the name of the one you are
 * on — iOS's ThemePicker: 30-point dots ten apart, the chosen one ringed
 * three points out and grown a touch. Yours alone: it restyles this phone,
 * not the room.
 */
@Composable
private fun TableStyle(onTheme: (MMTheme) -> Unit) {
    val p = P.current
    val current = LocalTheme.current
    val styles = MMTheme.entries
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        BoxWithConstraints {
            // Seven of iOS's dots and their gaps are 270 across. A phone
            // narrower than that gets the same row smaller rather than cut off.
            val gap = 10.dp
            val dot = minOf(30.dp, (maxWidth - gap * (styles.size - 1)) / styles.size)
            Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                for (t in styles) {
                    val on = t == current
                    // iOS's spring(duration: 0.25): no bounce, a quarter-second settle.
                    val scale by animateFloatAsState(
                        if (on) 1.08f else 1f, spring(dampingRatio = 1f, stiffness = 630f), label = "style",
                    )
                    val ring by animateFloatAsState(
                        if (on) 1f else 0f, spring(dampingRatio = 1f, stiffness = 630f), label = "ring",
                    )
                    Box(
                        Modifier
                            .size(dot)
                            .graphicsLayer { scaleX = scale; scaleY = scale }
                            // The ring sits outside the dot, as iOS pads it out
                            // by three, so it is drawn past the dot's own edge.
                            .drawBehind {
                                drawCircle(t.dot)
                                if (ring > 0f) {
                                    drawCircle(
                                        p.ink.copy(alpha = p.ink.alpha * ring),
                                        radius = size.minDimension / 2 + 3.dp.toPx(),
                                        style = Stroke(2.5.dp.toPx()),
                                    )
                                }
                            }
                            .clip(CircleShape)
                            .selectable(selected = on, role = Role.RadioButton) {
                                onTheme(t)
                                Haptics.tap()
                                SoundKit.click()
                            }
                            .semantics { contentDescription = t.title },
                    )
                }
            }
        }
        Text(current.title, color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
    }
}

// ── marks iOS takes from its symbol set ─────────────────────────────────────
//
// Glyphs.kt is generated from the web client's icons and has none of these,
// so each is drawn here, in the ink its row asks for.

/**
 * SF's lock.fill, the mark iOS leads the locked note with: a solid body and
 * the shackle standing over it. A key is not a lock, and the note is about
 * the lock.
 */
@Composable
private fun Padlock(tint: Color, size: Dp = 12.dp) {
    Canvas(Modifier.size(width = size * 0.8f, height = size)) {
        val w = this.size.width
        val h = this.size.height
        val bodyTop = h * 0.44f
        drawRoundRect(
            tint,
            topLeft = Offset(0f, bodyTop),
            size = Size(w, h - bodyTop),
            cornerRadius = CornerRadius(w * 0.18f),
        )
        val stroke = w * 0.17f
        val left = w * 0.2f + stroke / 2
        val right = w - left
        val r = (right - left) / 2
        val top = stroke / 2
        val shackle = Path().apply {
            moveTo(left, bodyTop + stroke)
            lineTo(left, top + r)
            arcTo(Rect(left, top, right, top + 2 * r), 180f, 180f, false)
            lineTo(right, bodyTop + stroke)
        }
        drawPath(shackle, tint, style = Stroke(width = stroke, cap = StrokeCap.Butt))
    }
}

/**
 * SF's chevron.up.chevron.down, beside every menu row's value: one chevron
 * up, one down, in bold strokes. The drawn set's swap is two arrows passing,
 * which says "exchange" rather than "choose".
 *
 * Proportioned off the iPhone's own at iOS's 11 points: 8.3 wide and 11.7
 * tall in ink, each arm at forty-five degrees, a stroke of about 1.65, and a
 * two-point gap between the pair. The first drawing was a point and a half
 * narrower with steeper arms, which beside the value read as a thin caret.
 */
@Composable
private fun UpDownChevrons(tint: Color, size: Dp = 11.dp) {
    val weight = size * 0.15f
    val inkWidth = size * 0.755f
    // SF's image box is wider than its ink — about 10.9 points round 8.3 —
    // so the box is drawn that wide with the ink centred in it, leaving the
    // point and a bit of air either side that sets the chevron where the
    // iPhone's sits against the value and the card's edge.
    Canvas(Modifier.size(width = size * 0.99f, height = size * 1.064f)) {
        val box = this.size.width
        val x0 = (box - inkWidth.toPx()) / 2f
        val w = inkWidth.toPx()
        val h = this.size.height
        val stroke = weight.toPx()
        val half = stroke / 2
        // At forty-five degrees an arm drops as far as it runs across.
        val arm = (w - stroke) / 2
        val style = Stroke(width = stroke, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val up = Path().apply {
            moveTo(x0 + half, half + arm)
            lineTo(x0 + w / 2, half)
            lineTo(x0 + w - half, half + arm)
        }
        val down = Path().apply {
            moveTo(x0 + half, h - half - arm)
            lineTo(x0 + w / 2, h - half)
            lineTo(x0 + w - half, h - half - arm)
        }
        drawPath(up, tint, style = style)
        drawPath(down, tint, style = style)
    }
}

/** SF's checkmark, on the menu row that is the table's value now. */
@Composable
private fun MenuTick(tint: Color, size: Dp = 14.dp) {
    Canvas(Modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height
        val path = Path().apply {
            moveTo(w * 0.1f, h * 0.54f)
            lineTo(w * 0.38f, h * 0.82f)
            lineTo(w * 0.9f, h * 0.18f)
        }
        drawPath(path, tint, style = Stroke(width = w * 0.15f, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

/**
 * The ⇄ iOS types in front of "Balance teams". The drawn set's swap is the
 * same two passing arrows stood on end, so it is turned a quarter to lie
 * down — the lobby panel's Balance teams draws it the same way.
 */
@Composable
private fun TeamSwapMark(size: Dp, tint: Color) {
    Icon("swap", size = size, tint = tint, modifier = Modifier.graphicsLayer { rotationZ = 90f })
}
