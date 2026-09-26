package com.moneymove.game

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.luminance
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Everything this player owns, grouped by country — and, while they owe
 * money, the way out of it. iOS's PropertiesSheet (DeedSheets.swift).
 *
 * Grouped, because a street on its own is worth its bare rent and a country
 * is worth building on — and the whole question a player opens this to answer
 * is "what am I one street away from". A flat list of twenty-two names does
 * not answer it. Countries come in board order, then airports, then
 * utilities, each under its own name, as iOS lists them.
 *
 * Every row says what it earns right now rather than what it cost, carries
 * the moves the rules would take on it, and — when it can change hands —
 * a way to put it in a trade. The trade doors hand over to the composer
 * through the store, stepping this sheet aside first: one sheet at a time,
 * because two bottom sheets fight.
 *
 * The sheet stands the full height of the screen, empty or not, with its
 * title bar pinned while the list scrolls under it — iOS's large sheet with
 * its inline navigation bar.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PropertiesSheet(store: GameStore, onDismiss: () -> Unit, onOpenTile: (Int) -> Unit) {
    val p = P.current
    val state = store.state ?: return onDismiss()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    val mine = store.myTiles()
    // Step aside, then open the next thing: whether this sheet is shown from
    // the store's single slot or from a flag of the screen's own, closing it
    // first means the composer the store opens next is the one left standing.
    val handOff: (() -> Unit) -> Unit = { next -> onDismiss(); next() }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.sheet,
        dragHandle = null,
    ) {
        Box(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize()) {
                TitleBar(
                    // The deal starts from the list: the composer opens with
                    // nobody picked and nothing on the table yet.
                    // Whenever there is something to deal, as iOS shows it;
                    // the composer says so itself when nobody is left to
                    // deal with.
                    onTrade = if (mine.isNotEmpty()) {
                        { handOff { store.openTrade() } }
                    } else null,
                    onDone = onDismiss,
                )
                Column(
                    Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .verticalScroll(rememberScrollState())
                        .padding(14.dp)
                        .padding(bottom = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    RaiseCashCard(store, state)
                    PropertyList(store, state, mine, onDismiss, onOpenTile, handOff)
                }
            }
            DeedsGrabber(Modifier.align(Alignment.TopCenter))
        }
    }
}

/**
 * iOS's inline navigation bar: the title centred in the bar's own weight,
 * Trade at the leading edge and Done at the trailing one. Both are plain
 * toolbar items — no box, no outline — in the bar's tint, which this sheet
 * never sets, so it is the system accent. Trade is iOS's toolbar Label,
 * which a navigation bar shows as its icon alone: arrow.left.arrow.right,
 * the two arrows passing each other, left over right.
 */
@Composable
private fun TitleBar(onTrade: (() -> Unit)?, onDone: () -> Unit) {
    val p = P.current
    val tint = if (p.sheet.luminance() < 0.5f) Color(0xFF0A84FF) else Color(0xFF007AFF)
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(top = 12.dp)
            .heightIn(min = 44.dp),
    ) {
        if (onTrade != null) {
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .size(44.dp)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                        onTrade()
                    }
                    .semantics { contentDescription = "Trade" },
                contentAlignment = Alignment.CenterStart,
            ) {
                // Twenty-two points of box inks the pair about sixteen wide,
                // the width Apple's symbol comes out at 13.5 bold.
                SwapArrows(22.dp, tint, flipped = true)
            }
        }
        Text(
            "Your properties",
            modifier = Modifier.align(Alignment.Center).padding(horizontal = 72.dp),
            color = p.ink,
            fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            "Done",
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                    onDone()
                }
                .padding(vertical = 10.dp),
            color = tint,
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

// ── raising cash ───────────────────────────────────────────────────────────

/**
 * Owing money turns this sheet into a rescue plan. The balance below zero is
 * exactly what is still owed — every sale streams straight through to
 * whoever the debt names — so the number here climbs to zero as the rows
 * below get tapped, biggest sources of cash first. Mortgaging waits while
 * buildings stand, so the list re-reads itself after each tap and the
 * mortgages appear once the houses are gone.
 */
@Composable
private fun RaiseCashCard(store: GameStore, state: GameState) {
    val p = P.current
    val debt = store.myDebt ?: return
    val remaining = store.debtRemaining
    val options = store.raiseOptions()
    val raisable = options.sumOf { it.amount }
    val payee = state.debtPayee(debt)

    DeedsCard {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            DeedsPanelTitle(if (remaining > 0) "Still in the red" else "Back in the black")
            // Red and breathing while anything is owed, green once square; the
            // figure rolls as it climbs.
            MoneyText(
                amount = -remaining,
                text = money(remaining),
                fontSize = 30.sp,
                fontWeight = FontWeight.ExtraBold,
            )
            Text(
                if (remaining > 0) "Everything you raise goes straight to $payee — watch this climb to zero."
                else "You're square — the debt has settled itself.",
                color = p.ink3,
                fontSize = 12.5.sp,
                lineHeight = 17.sp,
                fontWeight = FontWeight.Medium,
            )
            if (remaining > 0) {
                if (options.isEmpty()) {
                    Text(
                        "Nothing left to sell or mortgage.",
                        color = p.ink2, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (option in options.take(6)) RaiseRow(option) { store.raise(option) }
                    }
                    Text(
                        if (raisable >= remaining) "Biggest first — these add up to ${money(raisable)}."
                        else "These add up to ${money(raisable)}; selling buildings first can unlock more.",
                        color = p.ink3,
                        fontSize = 11.5.sp,
                        lineHeight = 15.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
    }
}

/** One way out of the red, one tap. The store buzzes and speaks from the owning seat. */
@Composable
private fun RaiseRow(option: RaiseOption, onClick: () -> Unit) {
    val p = P.current
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(p.sunken)
            .clickable { onClick() }
            .padding(horizontal = 11.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            option.label,
            modifier = Modifier.weight(1f),
            color = p.ink,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.width(6.dp))
        Text("+${money(option.amount)}", color = p.good, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold)
    }
}

// ── the list ───────────────────────────────────────────────────────────────

@Composable
private fun PropertyList(
    store: GameStore,
    state: GameState,
    mine: List<Int>,
    onDismiss: () -> Unit,
    onOpenTile: (Int) -> Unit,
    handOff: (() -> Unit) -> Unit,
) {
    val p = P.current
    if (mine.isEmpty()) {
        Column(
            Modifier.fillMaxWidth().padding(top = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon("island", size = 36.dp)
            Text(
                "Nothing owned yet — land on a street and buy it.",
                color = p.ink3,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center,
            )
        }
        return
    }

    val streets = mine.filter { store.tile(it)?.type == "property" }
    val airports = mine.filter { store.tile(it)?.type == "airport" }
    val utilities = mine.filter { store.tile(it)?.type == "utility" }
    // `mine` is in board order and groupBy keeps first-seen order, so the
    // countries read the way they sit on the board — not alphabetically by
    // whatever key the server gave them.
    val byGroup = streets.groupBy { store.tile(it)?.group ?: "?" }

    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        for ((key, tiles) in byGroup) {
            val info = state.groups[key]
            Section(
                store, state,
                title = info?.name ?: key,
                mark = if (info != null) { { GroupPennant(cssColor(info.color, Color(0xFF888888))) } } else null,
                tiles = tiles,
                groupKey = key,
                onOpenTile = onOpenTile,
                handOff = handOff,
            )
        }
        if (airports.isNotEmpty()) {
            Section(
                store, state, "Airports", { Icon("plane", size = 14.dp, tint = p.ink3, modifier = Modifier.graphicsLayer { rotationZ = 90f }) },
                airports, null, onOpenTile, handOff,
            )
        }
        if (utilities.isNotEmpty()) {
            Section(
                store, state, "Utilities", { Icon("bolt", size = 14.dp, tint = p.ink3) },
                utilities, null, onOpenTile, handOff,
            )
        }
        BankruptRow(store, onDismiss)
    }
}

/**
 * One family of deeds under its name. A country counts how much of it this
 * seat holds — "2 of 3", or FULL SET in gold — and, one street short, says
 * which street and who is sitting on it. Airports and utilities have no set
 * to finish, so they carry no count.
 */
@Composable
private fun Section(
    store: GameStore,
    state: GameState,
    title: String,
    mark: (@Composable () -> Unit)?,
    tiles: List<Int>,
    groupKey: String?,
    onOpenTile: (Int) -> Unit,
    handOff: (() -> Unit) -> Unit,
) {
    val p = P.current
    val seat = store.activeId
    val progress = groupKey
        ?.let { state.map.groups?.get(it) }
        ?.takeIf { it.isNotEmpty() }
        ?.let { idxs -> idxs.count { state.owner(it)?.owner == seat } to idxs.size }
    val fullSet = progress != null && progress.first == progress.second

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (mark != null) {
                mark()
                Spacer(Modifier.width(6.dp))
            }
            DeedsPanelTitle(title, modifier = Modifier.weight(1f))
            if (progress != null) {
                Spacer(Modifier.width(6.dp))
                Tag(
                    if (fullSet) "FULL SET" else "${progress.first} of ${progress.second}",
                    colour = if (fullSet) p.accentInk else p.ink3,
                    background = if (fullSet) p.gold else p.sunken,
                    fontSize = 8.5.sp,
                    letterSpacing = 0.6.sp,
                    horizontal = 7.dp,
                )
            }
        }
        if (groupKey != null && progress != null && progress.first == progress.second - 1) {
            OneAwayLine(store, state, groupKey, handOff)
        }
        for (i in tiles) {
            TileRow(store, state, i, fullSet, onOpen = { onOpenTile(i) }, handOff = handOff)
        }
    }
}

/**
 * The last street of a set, and who is sitting on it — with the ask ready to
 * send. Holding three of four is the moment a trade is worth making, so the
 * composer opens aimed at the holder and already asking for that street.
 */
@Composable
private fun OneAwayLine(store: GameStore, state: GameState, groupKey: String, handOff: (() -> Unit) -> Unit) {
    val p = P.current
    val missing = store.missingTile(groupKey) ?: return
    val tile = store.tile(missing) ?: return
    val holderName = state.player(state.owner(missing)?.owner)?.name
    val shape = RoundedCornerShape(11.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.goldSoft.copy(alpha = p.goldSoft.alpha * 0.6f))
            .border(1.dp, p.gold.copy(alpha = 0.5f), shape)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // The one street that unlocks the set — the key to it.
        // SF's key.fill stands upright, the bow on top and the teeth low on
        // the right; the drawn key lies corner to corner, so it is stood up.
        Icon("key", size = 15.dp, tint = p.ink2, modifier = Modifier.graphicsLayer { rotationZ = 45f })
        Spacer(Modifier.width(8.dp))
        Text(
            holderName?.let { "1 away — ${tile.name} is with $it" }
                ?: "1 away — ${tile.name} is still with the bank",
            modifier = Modifier.weight(1f),
            color = p.ink2,
            fontSize = 12.sp,
            lineHeight = 16.sp,
            fontWeight = FontWeight.SemiBold,
        )
        if (store.canAskFor(missing)) {
            // iOS's eight either side of a Spacer that keeps six.
            Spacer(Modifier.width(22.dp))
            MMButton("Ask for it", kind = BtnKind.GOLD) { handOff { store.askFor(missing) } }
        }
    }
}

/**
 * One deed. What it earns right now sits on the right — the column a player
 * reads down deciding where the next house goes — or MORTGAGED in its place.
 * The buildings ride beside the name so a built street still shows its
 * rent. Underneath, whatever the rules would take on it this moment, and the
 * door to a trade when it can change hands. The name opens the full deed.
 */
@Composable
private fun TileRow(
    store: GameStore,
    state: GameState,
    i: Int,
    fullSet: Boolean,
    onOpen: () -> Unit,
    handOff: (() -> Unit) -> Unit,
) {
    val p = P.current
    val tile = store.tile(i) ?: return
    val own = state.owner(i)
    val houses = own?.houseCount ?: 0
    val mortgaged = own?.isMortgaged == true
    val group = store.groupInfo(tile)
    val shape = RoundedCornerShape(14.dp)

    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.card)
            .border(1.dp, if (fullSet) p.gold.copy(alpha = 0.55f) else p.rule, shape)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // The name line is not a button, as iOS's row is not: only the row's
        // own buttons answer a tap.
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier.weight(1f),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (group != null) {
                    Box(
                        Modifier
                            .size(4.dp, 16.dp)
                            .clip(RoundedCornerShape(2.dp))
                            .background(cssColor(group.color, Color(0xFF888888))),
                    )
                }
                Text(
                    tile.name,
                    modifier = Modifier.weight(1f, fill = false),
                    color = p.ink,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                when {
                    houses == 5 -> Icon("hotel", size = 15.dp)
                    // iOS types a row of small black squares in the good
                    // green. That square has an emoji form too, and Android's
                    // fonts do not reliably keep to the text one iOS asks for,
                    // so each is drawn instead, at the size the 13-point
                    // glyph comes out: sharp squares about five points
                    // across, a little under two apart.
                    houses > 0 -> Row(horizontalArrangement = Arrangement.spacedBy(1.8.dp)) {
                        repeat(houses) {
                            Box(Modifier.size(5.dp).background(p.good))
                        }
                    }
                }
            }
            Spacer(Modifier.width(8.dp))
            val rent = store.rentNow(i)
            when {
                mortgaged -> Tag("MORTGAGED", colour = p.bad, background = p.redSoft, fontSize = 8.sp, letterSpacing = 0.5.sp)
                rent != null -> Column(horizontalAlignment = Alignment.End) {
                    Text("rent", color = p.ink3, fontSize = 8.sp, fontWeight = FontWeight.SemiBold, lineHeight = 10.sp)
                    Text(money(rent), color = p.good, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold)
                }
            }
        }

        // The door into a trade is on every bare street, as iOS puts it: the
        // rows are already the seat's own, and the composer is the one that
        // says when a deal cannot be made.
        val canTrade = houses == 0
        val buttons = rowButtons(store, state, i, tile, own)
        if (buttons.isNotEmpty() || canTrade) {
            // One line that never wraps, as iOS's HStack: a label too long
            // for its share is cut short instead.
            // The door is measured first and keeps its size; the buttons share
            // what is left in turn, each as wide as its label up to the room
            // remaining.
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    for (b in buttons) {
                        MMButton(b.label, kind = b.kind, icon = b.glyph, fitScale = 1f) { b.action() }
                    }
                }
                if (canTrade) {
                    TradeDoor { handOff { store.openTrade(give = setOf(i), from = own?.owner) } }
                }
            }
        }
    }
}

private class RowButton(val label: String, val kind: BtnKind, val glyph: String? = null, val action: () -> Unit)

/**
 * The moves the rules would take on this deed right now, in iOS's order,
 * words and kinds. Only live ones: a row full of greyed buttons is a row
 * nobody reads.
 *
 * iOS's ghost button is the sunken fill with ink on it and no edge — PLAIN
 * here, which MMButton draws exactly so.
 */
private fun rowButtons(store: GameStore, state: GameState, i: Int, tile: TileData, own: TileOwnership?): List<RowButton> {
    val out = mutableListOf<RowButton>()
    val hc = tile.houseCost
    // Lit by iOS's rule, which leaves a short purse for the server to answer.
    if (deedBuildLit(store, i) && hc != null) {
        out += RowButton(money(hc), BtnKind.GOOD, "crane") { store.build(i) }
        // The whole country in one press, when that is more than one press
        // saved. The number is what will actually go up, not what the country
        // could hold — a player who cannot afford the fourth house should not
        // be promised it.
        val sweep = store.buildAllCount(i)
        if (sweep > 1) out += RowButton("All ×$sweep", BtnKind.PRIMARY, "houses") { store.buildAll(i) }
    }
    if (store.canSellHouse(i) && hc != null) {
        out += RowButton("Sell +${money(hc / 2)}", BtnKind.PLAIN) { store.sellHouse(i) }
    }
    val price = tile.price
    if (store.canMortgage(i) && price != null) {
        out += RowButton("Mortgage +${money(price / 2)}", BtnKind.GOLD) { store.mortgage(i) }
    }
    // Offered whenever the table plays with mortgages; off turn or short of
    // the loan plus ten percent, the server says so.
    if (own?.isMortgaged == true && state.settings.mortgage != false && price != null) {
        out += RowButton("Unmortgage ${money(tile.unmortgageCost ?: 0)}", BtnKind.PRIMARY) { store.unmortgage(i) }
    }
    return out
}

/**
 * The per-deed way into a trade: the composer, with this street already on
 * our side. iOS's small ghost button round an 11-point arrow.left.arrow.right
 * — its padding and its ten-point corners, so it comes out wider than it is
 * tall, the height of the buttons beside it.
 */
@Composable
private fun TradeDoor(onClick: () -> Unit) {
    val p = P.current
    val shape = RoundedCornerShape(10.dp)
    Box(
        Modifier
            .clip(shape)
            .background(p.sunken)
            .clickable { onClick() }
            .semantics { contentDescription = "Offer in a trade" }
            .padding(horizontal = 14.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        SwapArrows(19.dp, p.ink, flipped = true)
    }
}

/**
 * The always-there escape hatch: give up, on your own turn. iOS asks with a
 * confirmation dialog; a dialog raised over a bottom sheet fights it for the
 * window on this side (see ConfirmDialog in Ui.kt), so the same question, the
 * same sentence and the same two answers are asked in place — the button
 * becomes the "are you sure", and only "Go bankrupt" closes the sheet.
 */
@Composable
private fun BankruptRow(store: GameStore, onDismiss: () -> Unit) {
    var confirming by remember { mutableStateOf(false) }
    val myTurn = store.isMyTurn
    LaunchedEffect(myTurn) { if (!myTurn) confirming = false }
    if (!myTurn) return

    Column(Modifier.padding(top = 6.dp)) {
        if (confirming) {
            ConfirmRow(
                title = "Declare bankruptcy?",
                message = "Everything you own returns to the bank and you are out of the game.",
                confirmLabel = "Go bankrupt",
                onConfirm = {
                    confirming = false
                    store.declareBankrupt()
                    onDismiss()
                },
                onCancel = { confirming = false },
                icon = "skull",
            )
        } else {
            MMButton(
                "Declare bankruptcy",
                modifier = Modifier.fillMaxWidth(),
                kind = BtnKind.PLAIN,
                big = true,
                icon = "skull",
            ) { confirming = true }
        }
    }
}

// ── small marks ────────────────────────────────────────────────────────────

/**
 * iOS's PanelTitle: the section name in capitals, small, bold and tracked a
 * point wide, in the quietest ink. Ui.kt's SectionLabel tracks wider than
 * iOS does, so the headings on this sheet set their own.
 */
@Composable
private fun DeedsPanelTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        modifier = modifier,
        color = P.current.ink3,
        fontSize = 11.sp,
        letterSpacing = 1.sp,
        fontWeight = FontWeight.Bold,
    )
}

/** A black-weight capsule: the set count, FULL SET, MORTGAGED. */
@Composable
private fun Tag(
    text: String,
    colour: Color,
    background: Color,
    fontSize: TextUnit,
    letterSpacing: TextUnit,
    horizontal: Dp = 6.dp,
) {
    Text(
        text,
        modifier = Modifier
            .clip(RoundedCornerShape(99.dp))
            .background(background)
            .padding(horizontal = horizontal, vertical = 3.dp),
        color = colour,
        fontSize = fontSize,
        letterSpacing = letterSpacing,
        fontWeight = FontWeight.Black,
        maxLines = 1,
        softWrap = false,
    )
}

/**
 * The grabber iOS puts at the top of both deed sheets: a short rounded bar,
 * faint, over the top edge of the content rather than taking a row of its
 * own. The deed sheet uses it too.
 */
@Composable
internal fun DeedsGrabber(modifier: Modifier = Modifier) {
    // iOS's drag indicator is the system's fixed grey whatever the table's
    // style, as every other sheet here draws it.
    val dark = P.current.sheet.luminance() < 0.5f
    Box(
        modifier
            .padding(top = 5.dp)
            .size(36.dp, 5.dp)
            .clip(CircleShape)
            .background(if (dark) Color(0x4DEBEBF5) else Color(0x4D3C3C43)),
    )
}

/**
 * iOS's MMCard, for the debt card: sixteen-point corners, the card fill, a
 * hairline, and the soft drop that lifts it off the sheet — deeper on a
 * night table. Ui.kt's Panel is the same card; this one keys its lift off
 * the page, as the lobby's settings cards do.
 */
@Composable
private fun DeedsCard(content: @Composable ColumnScope.() -> Unit) {
    val p = P.current
    val shape = RoundedCornerShape(16.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .shadow(6.dp, shape, clip = false)
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .padding(14.dp),
        content = content,
    )
}

/**
 * The banner a country flies beside its name: one drawn pennant on a pole,
 * tinted per group — iOS's GroupBanner, on the same 32-unit grid. A black
 * wash makes the fold a readable second tone out of any hue the server
 * happens to send for a group. The deed sheet flies it too, for a country
 * that came without a mark of its own.
 */
@Composable
internal fun GroupPennant(colour: Color, size: Dp = 15.dp) {
    val ink = P.current.ink
    Canvas(Modifier.size(size)) {
        val k = this.size.minDimension / 32f
        fun at(x: Float, y: Float) = Offset(x * k, y * k)
        fun poly(vararg pts: Pair<Float, Float>) = Path().apply {
            pts.forEachIndexed { n, (x, y) -> if (n == 0) moveTo(x * k, y * k) else lineTo(x * k, y * k) }
            close()
        }
        drawLine(ink, at(7.4f, 4.6f), at(7.4f, 28.6f), strokeWidth = 2.4f * k, cap = StrokeCap.Round, alpha = 0.55f)
        drawCircle(ink, radius = 2f * k, center = at(7.4f, 3.2f), alpha = 0.55f)
        drawPath(poly(8.6f to 5.2f, 28f to 5.2f, 28f to 22.4f, 18.3f to 16.8f, 8.6f to 22.4f), colour)
        drawPath(poly(18.3f to 5.2f, 28f to 5.2f, 28f to 22.4f, 18.3f to 16.8f), Color.Black, alpha = 0.2f)
    }
}
