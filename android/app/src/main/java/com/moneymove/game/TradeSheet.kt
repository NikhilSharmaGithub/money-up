package com.moneymove.game

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

// Trading, all of it: the composer, the sheet an offer arrives on, and the
// offers that sit in the dock while somebody makes up their mind.
//
// A trade is the one move in this game that needs two people to agree, and
// the one that happens on somebody else's clock. So every screen here is
// written for the person who did not write the deal: both sides in the same
// shape, what is on the table drawn as itself, and a line saying which way
// the price on the deeds leans — face value only, and each meter says so.
//
// The store holds everything that decides anything — who may trade with
// whom, what a side is worth, whether Accept can be funded, who is reading —
// so these screens only draw it, and a pass & play phone gets the same rules
// on every seat. iOS: TradeSheet.swift, TradeOfferSheet.swift and the trade
// half of ActionPanel.swift.

/**
 * Making an offer, or answering one.
 *
 * Opened the way iOS opens it. With nobody named, it first asks who to trade
 * with — every partner as a full row, so a seven-player table does not lose
 * the last four off the edge of the screen. With somebody named (a seat chip,
 * "Ask for it", a counter-offer) it opens straight on the deal, already
 * loaded with whatever [draft] carries.
 *
 * Cash is a slider rather than a keyboard. On a phone, typing a number means
 * a keyboard over the half of the screen showing what you are trading for,
 * and the track ending at the player's own cash means an amount they do not
 * have cannot be dragged to.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TradeSheet(store: GameStore, draft: TradeDraft = TradeDraft(), onDismiss: () -> Unit) {
    val state = store.state
    val seat = store.tradeSeat(draft)
    val fromPlayer = state?.player(seat)
    // A seat that is out holds nothing and an offer from it comes back
    // "Invalid player", so whichever button opened this, it closes again —
    // and so does a composer the game ended under.
    if (state == null || !state.isPlaying || fromPlayer == null || fromPlayer.isBankrupt) {
        LaunchedEffect(Unit) { onDismiss() }
        return
    }

    val counter = draft.countering
    // Fixed as the sheet opens. A counter always answers its sender; a named
    // player still has to be in the game, or the picker asks again rather
    // than aiming the deal at whoever happens to be first.
    val aimed = remember(draft) {
        if (counter != null) draft.to ?: counter.from
        else draft.to?.takeIf { id -> store.tradePartners(seat).any { it.id == id } }
    }
    var picked by remember(draft) { mutableStateOf<String?>(null) }
    val target = aimed ?: picked

    var giveTiles by remember(draft) { mutableStateOf(draft.give) }
    var getTiles by remember(draft) { mutableStateOf(draft.get) }
    var giveCash by remember(draft) { mutableIntStateOf(draft.giveCash) }
    var getCash by remember(draft) { mutableIntStateOf(draft.getCash) }
    var giveCards by remember(draft) { mutableIntStateOf(draft.giveCards) }
    var getCards by remember(draft) { mutableIntStateOf(draft.getCards) }

    // Negotiating: the other side sees their offer being read while the
    // counter is written. Harmless after the counter goes — the store never
    // pings an offer that is already gone.
    DisposableEffect(counter?.id, seat) {
        val id = counter?.id
        if (id != null) store.beginReading(id, seat)
        onDispose { if (id != null) store.endReading(id, seat) }
    }

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    // Set the moment the sheet starts to go. It slides for a third of a
    // second and still takes taps while it does; iOS does not, so a second
    // tap on Send in that time must not send the offer twice.
    var leaving by remember { mutableStateOf(false) }
    // iOS's dismiss() slides the sheet down before it is gone. Taking it out
    // of the table's slot straight away would make it vanish in place, so the
    // buttons that close it let it leave first.
    val close: () -> Unit = {
        if (!leaving) {
            leaving = true
            scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
        }
    }
    MMSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        if (target == null) {
            PartnerPicker(
                store,
                partners = store.tradePartners(seat),
                give = draft.give,
                onCancel = close,
                onPick = { id ->
                    // On iOS the picker and the deal are two sheets: picking
                    // somebody sends the one down and brings the other up.
                    scope.launch {
                        sheetState.hide()
                        picked = id
                        sheetState.show()
                    }
                },
            )
            return@MMSheet
        }

        // Gone means gone from the table, as iOS reads it: a partner who has
        // gone bankrupt still gets the whole deal, and Send is then answered
        // by the store's own refusal.
        val gone = state.player(target) == null
        TradeBar(
            title = if (counter == null) "Trade" else "Negotiate",
            onCancel = close,
            action = if (counter == null) "Send" else "Counter",
            actionEnabled = !gone,
        ) {
            if (leaving) return@TradeBar
            val sent = store.sendTrade(
                to = target,
                give = TradeSide(money = giveCash, tiles = giveTiles.sorted(), cards = giveCards),
                get = TradeSide(money = getCash, tiles = getTiles.sorted(), cards = getCards),
                from = seat,
                countering = counter,
            )
            // False means the store said why in a toast and the deal is
            // still worth keeping — nothing on it, or no line to send it on.
            if (sent) close()
        }

        val them = state.player(target)
        if (gone || them == null) {
            MissingTarget(Modifier.weight(1f), close)
            return@MMSheet
        }

        val mine = store.tilesOf(seat)
        val theirs = store.tilesOf(target)
        val giveCap = store.tradeCash(seat)
        val getCap = store.tradeCash(target)
        val giveCardCap = store.tradeCards(seat)
        val getCardCap = store.tradeCards(target)
        // What the meter weighs is what would actually go: streets still held,
        // and cash and cards cut to what each side still has.
        val giving = TradeSide(
            money = giveCash.coerceIn(0, giveCap),
            tiles = giveTiles.filter { it in mine },
            cards = giveCards.coerceIn(0, giveCardCap),
        )
        val getting = TradeSide(
            money = getCash.coerceIn(0, getCap),
            tiles = getTiles.filter { it in theirs },
            cards = getCards.coerceIn(0, getCardCap),
        )

        // The deal takes the whole height, as iOS's large detent does, even
        // when there is little on it yet.
        val sheetScroll = rememberScrollState()
        Column(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .scrollEdge(sheetScroll)
                .verticalScroll(sheetScroll)
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ComposerHeader(store, fromPlayer, them)
            DealMeter(give = store.sideWorth(giving), get = store.sideWorth(getting))

            val balance = store.tradeBalance(seat, target, giving, getting)
            if (balance.worthSaying) {
                BalanceRow(balance) {
                    if (balance.proposerPays) giveCash = giving.money + balance.topUp
                    else getCash = getting.money + balance.topUp
                    Haptics.tap()
                }
            }

            SideCard(
                store,
                title = "You give",
                tiles = mine,
                picked = giveTiles,
                onToggle = { giveTiles = giveTiles.toggle(it) },
                cash = giveCash, cashLimit = giveCap, onCash = { giveCash = it },
                cards = giveCards, cardLimit = giveCardCap, onCards = { giveCards = it },
            )
            SideCard(
                store,
                title = "You get",
                tiles = theirs,
                picked = getTiles,
                onToggle = { getTiles = getTiles.toggle(it) },
                cash = getCash, cashLimit = getCap, onCash = { getCash = it },
                cards = getCards, cardLimit = getCardCap, onCards = { getCards = it },
            )
        }
    }
}

private fun Set<Int>.toggle(i: Int): Set<Int> = if (contains(i)) this - i else this + i

/**
 * The button iOS calls ghost: a sunken fill with no edge. MMButton draws its
 * GHOST and PLAIN kinds that way alike; this names which one iOS means.
 */
private val IOS_GHOST = BtnKind.PLAIN

/**
 * The strip across the top of a trade sheet, laid out the way iOS's
 * navigation bar lays it out: the grabber over it, the way back on the left,
 * the title in the middle, and the one thing that sends on the right.
 *
 * iOS draws both toolbar answers as the same pale capsule — "Cancel" in the
 * system's regular weight, "Send" in the bold rounded face the sheet asks
 * for — not as a filled button and an outlined one. A red Send here was a
 * second, louder button that iOS does not have.
 */
@Composable
private fun TradeBar(
    title: String,
    onCancel: () -> Unit,
    action: String? = null,
    actionEnabled: Boolean = true,
    onAction: () -> Unit = {},
) {
    val p = P.current
    Box(Modifier.fillMaxWidth()) {
        // iOS's drag indicator is visible on both the picker and the deal.
        Grabber(Modifier.align(Alignment.TopCenter).padding(top = 5.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(top = 16.dp, bottom = 11.dp),
        ) {
            NavCapsule("Cancel", modifier = Modifier.align(Alignment.CenterStart)) { onCancel() }
            // The system label colour, as iOS's navigation title is: black,
            // or white at night, whatever the table's own ink.
            Text(
                title,
                modifier = Modifier.align(Alignment.Center),
                color = if (sheetIsDark()) Color.White else Color.Black,
                fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
            if (action != null) {
                NavCapsule(
                    action, bold = true, enabled = actionEnabled,
                    modifier = Modifier.align(Alignment.CenterEnd),
                ) { onAction() }
            }
        }
    }
}

/** One of the navigation bar's two answers: a 44-point capsule with the word in it. */
@Composable
private fun NavCapsule(
    label: String,
    modifier: Modifier = Modifier,
    bold: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val p = P.current
    Box(
        modifier
            .height(44.dp)
            .clip(CircleShape)
            .background(p.card)
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 15.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            // System label colour, as iOS's toolbar words are; ink3 still
            // says a disabled one.
            color = if (!enabled) p.ink3 else if (sheetIsDark()) Color.White else Color.Black,
            fontSize = if (bold) 15.sp else 17.sp,
            fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
            maxLines = 1,
        )
    }
}

/**
 * iOS's sheet grabber: 36 by 5, five points down from the top edge, in the
 * system's faint label grey. That grey is iOS's own rather than a table ink,
 * so it is the same on every table style, as it is there.
 */
@Composable
private fun Grabber(modifier: Modifier = Modifier) {
    val ink = if (sheetIsDark()) Color(0x4DEBEBF5) else Color(0x4D3C3C43)
    Box(
        modifier
            .size(width = 36.dp, height = 5.dp)
            .clip(CircleShape)
            .background(ink),
    )
}

/** Whether the table is in its dark mode. The palette carries no flag, so the sheet's own paper says. */
@Composable
private fun sheetIsDark(): Boolean = P.current.sheet.luminance() < 0.5f

/**
 * iOS's MMCard, which a side of the deal sits on: sixteen-point corners, a
 * hairline edge and a soft shadow under it. The shared Panel is rounder and
 * flat, and beside the deal meter that read as a different kind of card.
 */
@Composable
private fun DealCard(content: @Composable ColumnScope.() -> Unit) {
    val p = P.current
    val shape = RoundedCornerShape(16.dp)
    // Paper on the sheet's glass, and says so as a Panel does: the Hint in
    // here keeps ink3, and the buttons know a card is behind them.
    CompositionLocalProvider(LocalControlBackdrop provides BackdropKind.Paper) {
        Column(
            Modifier
                .fillMaxWidth()
                .shadow(if (sheetIsDark()) 8.dp else 6.dp, shape, clip = false)
                .clip(shape)
                .background(p.card)
                .border(1.dp, p.rule, shape)
                .padding(14.dp),
            content = content,
        )
    }
}

/**
 * iOS's PanelTitle: eleven-point bold capitals, spaced one point apart. The
 * shared section label spaces them wider, which is the web's tracking, not
 * iOS's.
 */
@Composable
private fun CardTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        modifier = modifier,
        color = P.current.ink3,
        fontSize = 11.sp,
        letterSpacing = 1.sp,
        fontWeight = FontWeight.Bold,
    )
}

/** iOS's Divider: one physical pixel of rule, not a whole point of it. */
@Composable
private fun Hairline() {
    val px = with(LocalDensity.current) { 1f.toDp() }
    Box(Modifier.fillMaxWidth().height(px).background(P.current.rule))
}

// ── who with ───────────────────────────────────────────────────────────────

/**
 * "Who do you want to trade with?" — one tap on a player opens the deal.
 * The discoverable front door for trading on a phone, and a list rather than
 * a strip of chips so nobody at a full table is off the edge of the screen.
 *
 * At least half the screen tall, as iOS's medium detent is, so two partners
 * do not arrive as a sliver.
 */
@Composable
private fun PartnerPicker(
    store: GameStore,
    partners: List<PlayerState>,
    give: Set<Int>,
    onCancel: () -> Unit,
    onPick: (String) -> Unit,
) {
    val p = P.current
    val half = (LocalConfiguration.current.screenHeightDp * 0.5f).dp
    Column(Modifier.fillMaxWidth().heightIn(min = half)) {
        TradeBar(title = "Trade with…", onCancel = onCancel)
        val sheetScroll = rememberScrollState()
        Column(
            Modifier
                .fillMaxWidth()
                .scrollEdge(sheetScroll)
                .verticalScroll(sheetScroll)
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Opened from one street: say which, so the list reads as "who gets it".
            if (give.size == 1) {
                store.tile(give.first())?.let { tile ->
                    // The picker's words stand straight on the sheet's glass,
                    // so they take its quiet ink; ink3 is lost on it at night.
                    Text(
                        "Offering ${tile.name}",
                        modifier = Modifier.padding(top = 2.dp),
                        color = quietInk(), fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
                    )
                }
            }
            for (partner in partners) {
                PartnerRow(store, partner) {
                    onPick(partner.id)
                    Haptics.tap()
                }
            }
            if (partners.isEmpty()) {
                Text(
                    "Nobody left to trade with.",
                    modifier = Modifier.padding(top = 40.dp),
                    color = quietInk(), fontSize = 14.sp, fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

@Composable
private fun PartnerRow(store: GameStore, player: PlayerState, onClick: () -> Unit) {
    val p = P.current
    val owned = store.tilesOf(player.id).size
    val team = store.state?.teamOf(player)
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .clickable { onClick() }
            .padding(horizontal = 13.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PlayerDisc(player, size = 38.dp)
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(
                    player.name,
                    modifier = Modifier.weight(1f, fill = false),
                    color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                if (player.isBot == true) SeatTag("BOT", p.ink3)
                // The team's colour is the team's identity; the server's
                // coloured-circle emoji only redrew it.
                if (team != null) {
                    Box(Modifier.size(9.dp).clip(CircleShape).background(cssColor(team.color, p.ink3)))
                }
            }
            Spacer(Modifier.height(2.dp))
            // A seat in the red shows it here too — their cash is spoken for
            // until the balance climbs back to zero.
            Row(verticalAlignment = Alignment.CenterVertically) {
                MoneyText(player.money, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, positive = p.ink3)
                Text(
                    "  ·  $owned propert${if (owned == 1) "y" else "ies"}",
                    color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                )
            }
        }
        // iOS's Spacer keeps its eight points and the row's eleven either
        // side of it, so a long name stops well short of the arrows.
        Spacer(Modifier.width(30.dp))
        SideArrows(size = 17.dp, tint = p.gold, spread = 1.25f)
    }
}

/**
 * Two arrows passing left and right — "these two swap" — drawn as iOS's
 * arrow.left.arrow.right: the one pointing left on top, the one pointing
 * right beneath. The drawn swap glyph runs up and down, which is the offer
 * sheet's badge; turned on its side alone it comes out the other way round,
 * so it is turned and then mirrored. Apple's symbol overflows its point size
 * — seventeen points of it stand twenty tall — while the drawn pair keeps
 * inside three quarters of its square, so callers ask for it a size up.
 */
@Composable
private fun SideArrows(size: Dp, tint: Color, spread: Float = 1f) {
    // [spread] pulls the two arrows apart: stretched across before the turn,
    // it comes out as more room between them after it, as Apple's pair has.
    Icon(
        "swap", size = size, tint = tint,
        modifier = Modifier.graphicsLayer {
            rotationZ = 90f
            scaleX = -spread
        },
    )
}

/** The partner left or went broke with the sheet open — iOS's empty state, centred in the sheet. */
@Composable
private fun MissingTarget(modifier: Modifier = Modifier, onDismiss: () -> Unit) {
    val p = P.current
    Column(
        modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon("door", size = 42.dp, tint = quietInk())
        Text(
            "This player is no longer in the game.",
            color = p.ink2, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
        MMButton("Close", kind = IOS_GHOST) { onDismiss() }
    }
}

// ── the composer ───────────────────────────────────────────────────────────

/** Who is dealing with whom, face to face across the arrows. */
@Composable
private fun ComposerHeader(store: GameStore, from: PlayerState, target: PlayerState) {
    val p = P.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // A name is cut short only when the two no longer fit side by side,
        // as iOS's centred row lets it run; no fixed cap of its own.
        HeaderFace(from, if (from.id == store.meId) "You" else from.name, Modifier.weight(1f, fill = false))
        // Apple's arrow.left.arrow.right stands 16 by 20 here; the drawn
        // pair is squarer, so it is spread apart to the same proportions.
        SideArrows(size = 22.dp, tint = p.red, spread = 1.25f)
        HeaderFace(target, target.name, Modifier.weight(1f, fill = false))
    }
}

@Composable
private fun HeaderFace(player: PlayerState, label: String, modifier: Modifier = Modifier) {
    val p = P.current
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        PlayerDisc(player, size = 44.dp)
        Spacer(Modifier.height(4.dp))
        Text(
            label,
            color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.Bold,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * "You give $X ⇄ You get $Y — verdict", live, so a lopsided deal announces
 * itself before it is sent rather than after it is refused.
 */
@Composable
private fun DealMeter(give: Int, get: Int) {
    val p = P.current
    val diff = get - give
    val (verdict, tone) = when {
        give == 0 && get == 0 -> "build a deal below" to p.ink3
        abs(diff) < 25 -> "even trade" to p.ink3
        diff > 0 -> "+${money(diff)} your way" to p.good
        else -> "${money(-diff)} in their favour" to p.bad
    }
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text("You give", color = p.ink3, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
            Text(money(give), color = p.bad, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold)
        }
        Text(
            verdict,
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 10.dp),
            color = tone, fontSize = 12.sp, fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text("You get", color = p.ink3, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
            Text(money(get), color = p.good, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold)
        }
    }
}

/**
 * The cash that would even the deal out, and who would be putting it in.
 * Only ever money that side actually has — a deal that cannot be paid is not
 * a fair one, so a short side stays visibly short.
 */
@Composable
private fun BalanceRow(balance: TradeBalance, onBalance: () -> Unit) {
    val p = P.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            balance.line,
            modifier = Modifier.weight(1f),
            color = quietInk(), fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
        )
        if (balance.canBalance) {
            // iOS's Spacer(minLength: 6) plus the row's ten either side of it:
            // a sentence that wraps stops that far short of the button.
            Spacer(Modifier.width(26.dp))
            MMButton("Balance it", kind = BtnKind.GOLD, icon = "scales") { onBalance() }
        }
    }
}

/** One side of the deal: the streets that could go, then the cash, then any prison cards. */
@Composable
private fun SideCard(
    store: GameStore,
    title: String,
    tiles: List<Int>,
    picked: Set<Int>,
    onToggle: (Int) -> Unit,
    cash: Int,
    cashLimit: Int,
    onCash: (Int) -> Unit,
    cards: Int,
    cardLimit: Int,
    onCards: (Int) -> Unit,
) {
    DealCard {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            CardTitle(title)

            if (tiles.isEmpty()) {
                Hint("No properties to trade")
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (i in tiles) {
                        TileRow(store, i, on = i in picked) {
                            onToggle(i)
                            Haptics.tap()
                        }
                    }
                }
            }

            Hairline()
            CashRow(cash, cashLimit, onCash)
            if (cardLimit > 0) CardsRow(cards, cardLimit, onCards)
        }
    }
}

@Composable
private fun TileRow(store: GameStore, i: Int, on: Boolean, onToggle: () -> Unit) {
    val p = P.current
    val tile = store.tile(i)
    val own = store.state?.owner(i)
    // A street with buildings on it — or anywhere in its colour — cannot
    // change hands, and the server refuses the whole offer over it. Shown,
    // so the player can see it is theirs, but locked.
    val locked = store.tradeLocked(i)
    val shape = RoundedCornerShape(10.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .alpha(if (locked) 0.45f else 1f)
            .clip(shape)
            .background(if (on) p.goodSoft else p.sunken)
            .border(1.dp, if (on) p.good.copy(alpha = 0.5f) else Color.Transparent, shape)
            .clickable(enabled = !locked) { onToggle() }
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        val colour = tile?.let { store.groupInfo(it) }?.color
        Box(Modifier.size(10.dp).clip(CircleShape).background(cssColor(colour, p.ink3)))
        // The name and its marks take whatever the row can spare and the
        // price sits at the far end, as iOS's Spacer puts it. A name weighed
        // against a spacer of its own would get half the row at most, and
        // leave the price stranded mid-row beside a short one.
        Row(
            Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Text(
                tile?.name ?: "Tile $i",
                modifier = Modifier.weight(1f, fill = false),
                color = p.ink, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            // Tradeable, but it earns nothing until whoever takes it pays to
            // lift the mortgage — worth knowing before the price looks cheap.
            if (own?.isMortgaged == true) {
                Text("MORTGAGED", color = p.ink3, fontSize = 7.5.sp, fontWeight = FontWeight.Black, maxLines = 1)
            }
            // The house marks a street that has houses of its own, as iOS
            // draws it — a bare street locked by its neighbours' buildings
            // is dimmed, not dressed as built on.
            if ((own?.houseCount ?: 0) > 0) Icon("house", size = 13.dp)
        }
        // iOS's Spacer keeps six between the name and the price, on top of
        // the row's nine either side of it.
        Spacer(Modifier.width(6.dp))
        tile?.price?.let { price ->
            Text(money(price), color = p.ink2, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
        }
        DealTick(on)
    }
}

/**
 * The round tick at the end of a street row — filled green once it is in the
 * deal. iOS's checkmark.circle.fill is a knock-out: the check is a hole that
 * shows the row's own fill through it, so it is cut out here on a layer of
 * its own rather than painted white.
 */
@Composable
private fun DealTick(on: Boolean) {
    val p = P.current
    val good = p.good
    val idle = p.ink3
    Canvas(Modifier.size(17.dp).graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }) {
        val r = size.minDimension / 2f
        if (on) {
            drawCircle(good, radius = r, center = center)
            val tick = Path().apply {
                moveTo(size.width * 0.28f, size.height * 0.52f)
                lineTo(size.width * 0.44f, size.height * 0.68f)
                lineTo(size.width * 0.73f, size.height * 0.36f)
            }
            drawPath(
                tick, Color.Black, blendMode = BlendMode.Clear,
                style = Stroke(width = size.minDimension * 0.12f, cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
        } else {
            val w = 1.4.dp.toPx()
            drawCircle(idle, radius = r - w / 2f, center = center, style = Stroke(width = w))
        }
    }
}

/**
 * Cash, on a slider whose track ends at what the player holds. A player with
 * nothing — or in the red, where the balance is a debt and not a wallet — gets
 * a slider that is visibly off and says so, rather than one that moves and
 * means nothing.
 *
 * The slider is iOS's, not Material's: a thin grey track the full width of
 * the card, filling in the accent up to a white capsule thumb. Material's
 * tall bar of a thumb in a thick two-tone track was the one control on the
 * sheet that looked like it came from another app.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CashRow(cash: Int, limit: Int, onCash: (Int) -> Unit) {
    val p = P.current
    val cap = maxOf(0, limit)
    val shown = cash.coerceIn(0, cap)
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Cash", color = p.ink, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            Box(
                Modifier
                    .clip(RoundedCornerShape(99.dp))
                    .background(p.sunken)
                    .border(1.dp, p.rule, RoundedCornerShape(99.dp))
                    .padding(horizontal = 11.dp, vertical = 4.dp),
            ) {
                MoneyText(
                    shown, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold,
                    positive = if (shown > 0) p.ink else p.ink3,
                )
            }
        }
        val fill = p.red
        Slider(
            value = shown.toFloat(),
            onValueChange = { onCash(it.roundToInt().coerceIn(0, cap)) },
            valueRange = 0f..cap.coerceAtLeast(1).toFloat(),
            enabled = cap > 0,
            // iOS's slider stands thirty points tall. Material pads its own
            // out to a 48dp touch target, which put a gap above and below it
            // that iOS does not have; the thumb still takes the drag.
            modifier = Modifier
                .fillMaxWidth()
                .height(30.dp)
                .alpha(if (cap == 0) 0.45f else 1f),
            thumb = { CashThumb() },
            track = { sliderState -> CashTrack(sliderState, fill) },
        )
        Text(
            if (cap == 0) "no cash to offer" else "up to ${money(cap)}",
            color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.Medium,
        )
    }
}

private val THUMB_WIDTH = 37.dp
private val THUMB_HEIGHT = 24.dp

/** iOS's slider knob: a white capsule with a soft shadow, white on every table and in both modes. */
@Composable
private fun CashThumb() {
    Box(
        Modifier
            .size(width = THUMB_WIDTH, height = THUMB_HEIGHT)
            .shadow(3.dp, CircleShape, clip = false)
            .clip(CircleShape)
            .background(Color.White),
    )
}

/**
 * iOS's slider track: six points of the system's fill grey, the accent up to
 * the thumb's centre. Material lays the track out between the thumb's two
 * centres, but iOS runs it the whole width with the thumb resting inside the
 * ends, so it is drawn half a thumb past its box on either side. The grey is
 * iOS's own rather than a table ink — it is the same on every table there.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CashTrack(state: SliderState, fill: Color) {
    val rest = if (sheetIsDark()) Color(0x5C787880) else Color(0x33787880)
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(6.dp),
    ) {
        val reach = THUMB_WIDTH.toPx() / 2f
        val range = state.valueRange
        val span = range.endInclusive - range.start
        val at = if (span > 0f) ((state.value - range.start) / span).coerceIn(0f, 1f) else 0f
        val h = size.height
        val round = CornerRadius(h / 2f)
        drawRoundRect(rest, topLeft = Offset(-reach, 0f), size = Size(size.width + reach * 2f, h), cornerRadius = round)
        drawRoundRect(fill, topLeft = Offset(-reach, 0f), size = Size(size.width * at + reach, h), cornerRadius = round)
    }
}

/**
 * Get-out-of-prison cards. The server trades them and the meters price them,
 * so a side that holds one can put it in — or be asked for it.
 */
@Composable
private fun CardsRow(cards: Int, limit: Int, onCards: (Int) -> Unit) {
    val p = P.current
    val shown = cards.coerceIn(0, maxOf(0, limit))
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon("ticket", size = 15.dp, tint = p.ink)
        Text("Prison cards", color = p.ink, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.weight(1f))
        Text(
            "$shown",
            modifier = Modifier.widthIn(min = 22.dp),
            color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
            textAlign = TextAlign.End,
        )
        DealStepper(shown, limit, onCards)
    }
}

/**
 * A minus and a plus, clamped to what the side holds — iOS's Stepper, which
 * is system chrome: the same neutral fill grey as the cash slider's track
 * beside it, and the system's label colour, on every table style.
 */
@Composable
private fun DealStepper(value: Int, max: Int, onChange: (Int) -> Unit) {
    val dark = sheetIsDark()
    Row(
        Modifier
            .clip(RoundedCornerShape(9.dp))
            .background(if (dark) Color(0x5C787880) else Color(0x33787880)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StepperHalf("−", enabled = value > 0) { onChange((value - 1).coerceIn(0, max)) }
        Box(Modifier.width(1.dp).height(18.dp).background(if (dark) Color(0x4DEBEBF5) else Color(0x4D3C3C43)))
        StepperHalf("+", enabled = value < max) { onChange((value + 1).coerceIn(0, max)) }
    }
}

@Composable
private fun StepperHalf(symbol: String, enabled: Boolean, onClick: () -> Unit) {
    val label = if (sheetIsDark()) Color.White else Color.Black
    Box(
        Modifier
            .size(width = 46.dp, height = 32.dp)
            .clickable(enabled = enabled) { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            symbol,
            color = if (enabled) label else label.copy(alpha = 0.3f),
            fontSize = 19.sp, fontWeight = FontWeight.Medium,
        )
    }
}

// ── an offer, put in front of you ──────────────────────────────────────────

/**
 * The sheet an incoming offer arrives on.
 *
 * The dock lists offers too. But an offer lands while you are looking at the
 * board, and the person who sent it is sitting there waiting, so it comes to
 * the front once, on its own — the store decides when, and never twice for
 * the same deal. `seat` is which of this phone's players it is for.
 *
 * What is on the table is drawn as things rather than described in a line of
 * text — a coin for the cash, a street in its own colour with its own flag, a
 * card for a card. A line reading "$420 · Venice · 1× prison card" is a
 * receipt; this is an offer.
 *
 * Closing it touches nothing: the offer stays live in the dock. Negotiate
 * goes the way iOS's does — this sheet slides away, then the composer comes
 * up in its slot already holding the deal.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TradeOfferSheet(store: GameStore, offer: TradeOffer, seat: String = offer.to, onDismiss: () -> Unit) {
    val p = P.current
    val state = store.state
    if (state == null) {
        LaunchedEffect(Unit) { onDismiss() }
        return
    }
    // The table's copy, so money and readers are as they are now; the one
    // the sheet opened with once the offer has gone.
    val trade = store.liveOffer(offer.id) ?: offer
    val from = state.player(trade.from)
    val mine = state.player(seat)

    // A sheet nobody asked for arrives under whatever finger was already on
    // its way somewhere else — and the button it lands on accepts a trade.
    // So the three answers do nothing at all for a moment after it appears.
    var armed by remember(offer.id) { mutableStateOf(false) }
    // Set when the sheet starts to slide away; nothing arms it again after.
    var leaving by remember(offer.id) { mutableStateOf(false) }
    LaunchedEffect(offer.id) {
        delay(450)
        if (!leaving) armed = true
    }
    // The sender's card lights while this is open.
    DisposableEffect(offer.id, seat) {
        store.beginReading(offer.id, seat)
        onDispose { store.endReading(offer.id, seat) }
    }

    // Face value only: the price on the deed, nothing about how badly anyone
    // needs it. The meter says as much underneath itself.
    val theirs = store.sideWorth(trade.give)
    val ours = store.sideWorth(trade.get)

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    // Every answer lets the sheet slide away before it leaves the table's
    // slot, as iOS's dismiss() does, rather than vanishing where it stood.
    // The answers disarm the moment it starts to go: the sheet still takes
    // taps while it slides, and iOS's does not, so a second tap must not
    // answer an offer that is already answered.
    val close: () -> Unit = {
        if (!leaving) {
            leaving = true
            armed = false
            scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
        }
    }
    // iOS hides this sheet's grabber: it is an answer to give, not a panel
    // to pull about.
    MMSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        // iOS pins this sheet at 540 points, the answers at its foot with the
        // space above them; a bigger deal still grows it rather than clipping.
        Column(Modifier.fillMaxWidth().heightIn(min = 540.dp)) {
            OfferHeader(from) {
                Haptics.tap()
                close()
            }
            Hairline()
            val sheetScroll = rememberScrollState()
            Column(
                Modifier
                    .weight(1f)
                    .scrollEdge(sheetScroll)
                    .verticalScroll(sheetScroll)
                    .padding(horizontal = 16.dp)
                    .padding(top = 16.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        DealPile(store, "You get", trade.give, theirs, from, p.good)
                        DealPile(store, "You give", trade.get, ours, mine, p.bad)
                    }
                    SwapBadge()
                }
                OfferLean(theirs, ours)
            }
            OfferAnswers(
                store, trade, armed,
                onAnswered = close,
                onNegotiate = {
                    // SwiftUI will not swap one sheet for another in the same
                    // frame, so on iOS this one goes down before the composer
                    // comes up. The same here: away first, then the counter.
                    leaving = true
                    armed = false
                    scope.launch {
                        sheetState.hide()
                        store.openCounter(trade)
                    }
                },
            )
        }
    }
}

@Composable
private fun OfferHeader(from: PlayerState?, onClose: () -> Unit) {
    val p = P.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(top = 18.dp, bottom = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialDisc(from, 44.dp, ring = true)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                "${from?.name ?: "Someone"} wants to trade",
                color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                "Their offer is on the table.",
                color = quietInk(), fontSize = 12.5.sp, fontWeight = FontWeight.Medium,
            )
        }
        // iOS's twelve either side of a Spacer that keeps four.
        Spacer(Modifier.width(28.dp))
        Box(
            Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(p.sunken)
                .clickable { onClose() }
                .semantics { contentDescription = "Close" },
            contentAlignment = Alignment.Center,
        ) {
            // Apple's 14-point xmark is eleven points of cross; the drawn one
            // fills a little over half its square, so it is asked for at 20.
            Icon("close", size = 20.dp, tint = p.ink3)
        }
    }
}

/**
 * A plain disc with an initial — the offer sheet's faces. It names who is
 * dealing, not what they bought; the flag and the face are the seat chip's.
 */
@Composable
private fun InitialDisc(player: PlayerState?, size: Dp, ring: Boolean = false) {
    val colour = cssColor(player?.color, Color(0xFF888888))
    val density = LocalDensity.current
    val ringWidth = 3.dp
    // The halo is an overlay on iOS: it spills past the disc without taking
    // any room, so the name beside it sits twelve points from the disc itself.
    Box(
        Modifier
            .size(size)
            .drawBehind {
                val r = size.toPx() / 2f
                drawCircle(colour, radius = r, center = center)
                if (ring) {
                    // iOS strokes a circle 3pt outside the disc — a halo in the
                    // player's colour with a hairline of paper between.
                    val w = ringWidth.toPx()
                    drawCircle(colour.copy(alpha = 0.28f), radius = r + w, center = center, style = Stroke(width = w))
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            (player?.name?.firstOrNull() ?: '?').uppercase(),
            color = Color.White,
            fontSize = with(density) { (size * if (size > 30.dp) 0.41f else 0.55f).toSp() },
            fontWeight = FontWeight.Black,
            maxLines = 1,
        )
    }
}

/** One side of an offer: its label and face-value total, each thing on it, and whose it is. */
@Composable
private fun DealPile(
    store: GameStore,
    label: String,
    side: TradeSide,
    total: Int,
    who: PlayerState?,
    tone: Color,
) {
    val p = P.current
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.sunken)
            .border(1.dp, tone.copy(alpha = 0.42f), shape)
            .padding(13.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Row {
            Text(
                label.uppercase(),
                modifier = Modifier.alignByBaseline(),
                color = tone, fontSize = 10.5.sp, fontWeight = FontWeight.ExtraBold,
                letterSpacing = 0.8.sp,
            )
            Spacer(Modifier.weight(1f))
            Text(
                money(total),
                modifier = Modifier.alignByBaseline(),
                color = p.ink2, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold,
                style = tabularFigures(),
            )
        }
        DealChips(store, side)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            InitialDisc(who, 18.dp)
            Text(
                if (store.isLocal(who?.id)) "from you" else "from ${who?.name ?: "?"}",
                color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/** Everything on one side of the deal, each thing drawn as itself. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DealChips(store: GameStore, side: TradeSide) {
    val p = P.current
    val tiles = side.tiles.mapNotNull { store.tile(it) }
    if (side.money <= 0 && tiles.isEmpty() && side.cards <= 0) {
        Text(
            "nothing",
            modifier = Modifier
                .dashedBorder(p.rule, cornerRadius = 99.dp, dash = 4.dp, gap = 3.dp)
                .padding(horizontal = 9.dp, vertical = 5.dp),
            color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.Medium,
            fontStyle = FontStyle.Italic,
        )
        return
    }
    val measurer = rememberTextMeasurer()
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (side.money > 0) {
            DealChip(border = p.gold.copy(alpha = 0.55f), fill = p.goldSoft) {
                Icon("coin", size = 15.dp)
                Text(money(side.money), color = p.ink, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
            }
        }
        for (t in tiles) {
            val g = store.groupInfo(t)
            val colour = cssColor(g?.color, Color(0xFF7C6BB0))
            DealChip(border = p.rule, fill = p.card, leading = colour) {
                if (g != null && g.flag.isNotBlank()) {
                    val wash = p.sunken
                    // iOS's GroupMedallion sits on a small drop shadow, which
                    // is what lifts a pale flag off a pale chip.
                    Canvas(Modifier.size(16.dp).shadow(1.5.dp, CircleShape, clip = false)) {
                        with(Art) {
                            drawMedallion(g.flag, colour, center, size.minDimension / 2f, wash = wash, measurer = measurer)
                        }
                    }
                } else {
                    Box(Modifier.size(9.dp).clip(CircleShape).background(colour))
                }
                Text(
                    t.name,
                    color = p.ink, fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                // Written as iOS writes the sticker here — a bare "$" and the
                // number, without the thousands comma money() would add.
                Text(
                    "$${t.price ?: 0}",
                    color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold,
                    style = tabularFigures(),
                )
            }
        }
        if (side.cards > 0) {
            DealChip(border = p.rule, fill = p.card) {
                Icon("key", size = 14.dp, tint = p.ink)
                Text(
                    "${side.cards}× out of prison",
                    color = p.ink, fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

/** A capsule for one thing on the table; a street's wears its colour down the leading edge. */
@Composable
private fun DealChip(
    border: Color,
    fill: Color,
    leading: Color? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val shape = RoundedCornerShape(99.dp)
    Row(
        Modifier
            .clip(shape)
            .background(fill)
            .drawBehind {
                if (leading != null) drawRect(leading, size = Size(4.dp.toPx(), size.height))
            }
            .border(1.dp, border, shape)
            .padding(start = if (leading == null) 9.dp else 7.dp, end = 9.dp, top = 5.dp, bottom = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        content = content,
    )
}

/** The badge that straddles the seam between the two piles. */
@Composable
private fun SwapBadge() {
    val p = P.current
    Box(
        Modifier
            .size(34.dp)
            .shadow(4.dp, CircleShape)
            .clip(CircleShape)
            .background(p.card)
            .border(1.dp, p.rule2, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        // Apple's arrow.up.arrow.down here is seventeen wide and fourteen
        // tall; the drawn pair sits closer together, so it is spread apart.
        Icon("swap", size = 19.dp, tint = p.ink2, modifier = Modifier.graphicsLayer { scaleX = 1.3f })
    }
}

/** Which way the deal leans, by the price on the deeds — and it says that is all it is weighing. */
@Composable
private fun OfferLean(theirs: Int, ours: Int) {
    val p = P.current
    val diff = theirs - ours
    val span = maxOf(theirs, ours, 1)
    val lean = (diff.toFloat() / span).coerceIn(-1f, 1f)
    val even = abs(diff) < 25
    // Printed straight on the sheet's glass: an even deal says so in the
    // glass's quiet ink, which holds up there where ink3 does not.
    val tone = if (even) quietInk() else if (diff > 0) p.good else p.bad
    val track = p.sunken
    val notch = p.rule2
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(6.dp),
        ) {
            val w = size.width
            val h = size.height
            val round = CornerRadius(h / 2f)
            drawRoundRect(track, cornerRadius = round)
            val fill = w / 2f * abs(lean)
            if (fill > 0f) {
                val x = if (lean >= 0f) w / 2f else w / 2f - fill
                drawRoundRect(tone, topLeft = Offset(x, 0f), size = Size(fill, h), cornerRadius = round)
            }
            val nw = 2.dp.toPx()
            drawRect(notch, topLeft = Offset(w / 2f - nw / 2f, 0f), size = Size(nw, h))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                when {
                    even -> "An even deal"
                    diff > 0 -> "${money(diff)} your way"
                    else -> "${money(-diff)} their way"
                },
                modifier = Modifier.alignByBaseline(),
                color = tone, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold,
            )
            Text(
                "by the price on the deeds",
                modifier = Modifier.alignByBaseline(),
                color = quietInk(), fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
            )
        }
    }
}

/**
 * The three answers. Accept is the one that cannot be taken back, so it is
 * the big one and the only one with the heavier buzz.
 *
 * Accept is iOS's: live once the sheet has settled, whatever the deal asks
 * for. A deal the seat cannot fund comes back as the server's own toast, as
 * it does there; the dock under the board is where "Short $X" is said ahead.
 *
 * For the moment before they arm, the answers look exactly as they will and
 * simply ignore the tap. iOS's disabled buttons do not dim — its button style
 * never reads the disabled state — so a sheet that faded its answers in for
 * half a second flickered where iOS's stays still.
 */
@Composable
private fun OfferAnswers(
    store: GameStore,
    trade: TradeOffer,
    armed: Boolean,
    onAnswered: () -> Unit,
    onNegotiate: () -> Unit,
) {
    val p = P.current
    Column(
        Modifier
            .fillMaxWidth()
            // No paper of its own. The deal above scrolls inside a column
            // that clips it, so nothing ever passes under the answers, and
            // the strip only repainted the sheet's own colour over the sheet
            // — which on the glass is a band of the old paper across its
            // foot, cutting the platter in two.
            .padding(horizontal = 16.dp)
            .padding(top = 12.dp, bottom = 18.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        MMButton(
            "Accept the deal", kind = BtnKind.GOOD, big = true,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (!armed) return@MMButton
            Haptics.turn()
            store.respondTrade(trade.id, true)
            onAnswered()
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NegotiateButton(Modifier.weight(1f)) {
                if (!armed) return@NegotiateButton
                Haptics.tap()
                onNegotiate()
            }
            MMButton(
                "Decline", kind = IOS_GHOST,
                modifier = Modifier.weight(1f),
            ) {
                if (!armed) return@MMButton
                Haptics.tap()
                store.respondTrade(trade.id, false)
                onAnswered()
            }
        }
        Text(
            "Closing this leaves the offer on the table — the dock keeps it.",
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 2.dp),
            color = quietInk(), fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * Negotiate: iOS's small ghost button with arrow.up.arrow.down six points
 * ahead of the word. Its own rather than MMButton, whose glyph slot cannot
 * spread the drawn pair to Apple's proportions or close the gap to six.
 */
@Composable
private fun NegotiateButton(modifier: Modifier = Modifier, onClick: () -> Unit) {
    val p = P.current
    val shape = RoundedCornerShape(10.dp)
    Row(
        modifier
            .clip(shape)
            .background(p.sunken)
            .clickable(role = Role.Button) { onClick() }
            .padding(horizontal = 14.dp, vertical = 9.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon("swap", size = 14.dp, tint = p.ink, modifier = Modifier.graphicsLayer { scaleX = 1.3f })
        Spacer(Modifier.width(6.dp))
        Text("Negotiate", color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

/** iOS's .monospacedDigit(): the running text style, with every figure the same width. */
@Composable
private fun tabularFigures(): TextStyle = LocalTextStyle.current.copy(fontFeatureSettings = "tnum")

// ── the dock ───────────────────────────────────────────────────────────────

/**
 * Trades, as the dock shows them: the oldest live offer to anyone on this
 * phone with every answer to it, the offers set aside folded into one line,
 * and the offer this phone sent, with the way to take it back.
 *
 * Only the oldest offer takes the dock. Two or three at once would push the
 * board's own controls off the screen, so the rest wait behind "+N more" —
 * and "Later" is how a deal gets thought about while the turn goes on.
 * Draws nothing when there is nothing on the table.
 */
@Composable
fun TradeDock(store: GameStore, modifier: Modifier = Modifier) {
    val incoming = store.incomingOffers
    val parked = store.setAsideOffers
    val sent = store.sentOffers.firstOrNull()
    if (incoming.isEmpty() && parked.isEmpty() && sent == null) return

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        incoming.firstOrNull()?.let { offer ->
            // Keyed on the deal, so the reading ping follows the offer on
            // show rather than the slot it happens to sit in.
            key(offer.id) { TradeOfferCard(store, offer, more = incoming.size - 1) }
        }
        if (parked.isNotEmpty()) SetAsideChip(store, parked.size)
        sent?.let { offer -> key(offer.id) { SentOfferRow(store, offer) } }
    }
}

/**
 * An offer somebody has made a seat on this phone, as the dock holds it:
 * both sides in a line each, who is reading it, whether it can be paid for,
 * and all four answers. `more` is how many further live offers wait behind it.
 *
 * On show it tells the sender their offer is being read — which is also what
 * an iOS player facing this phone sees, so it is not optional.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TradeOfferCard(store: GameStore, offer: TradeOffer, modifier: Modifier = Modifier, more: Int = 0) {
    val p = P.current
    val state = store.state ?: return
    val from = state.player(offer.from)
    // Pass & play: an offer to the other person on this phone says whose it is.
    val forGuest = if (offer.to != store.meId) state.player(offer.to) else null

    DisposableEffect(offer.id, offer.to) {
        store.beginReading(offer.id, offer.to)
        onDispose { store.endReading(offer.id, offer.to) }
    }

    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.goldSoft.copy(alpha = 0.6f))
            .border(1.dp, p.gold.copy(alpha = 0.6f), shape)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon("trade", size = 13.dp, tint = p.ink3)
            Spacer(Modifier.width(8.dp))
            CardTitle(
                "Offer from ${from?.name ?: "?"}${forGuest?.let { " to ${it.name}" } ?: ""}",
                modifier = Modifier.weight(1f),
            )
            if (more > 0) {
                Spacer(Modifier.width(8.dp))
                Text("+$more more", color = p.ink3, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }
        }
        TradeLine("You get", store.tradeSummary(offer.give), p.good)
        TradeLine("You give", store.tradeSummary(offer.get), p.bad)
        store.readingLine(offer)?.let { line ->
            TradeViewingLine(line, p.gold, store.offerReaders(offer).map { cssColor(it.color, p.ink3) })
        }
        // Accepting a deal you can't fund just bounces off the server with a
        // toast; say so before the tap instead. iOS's figure: what the deal
        // asks of this seat less what it holds — so a seat already in the red
        // is short by its debt even on a deal that asks no cash at all.
        val short = offer.get.money - (state.player(offer.to)?.money ?: 0)
        if (short > 0) {
            Text(
                "Short ${money(short)} — sell or mortgage first.",
                color = p.bad, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold,
            )
        }
        // Wraps rather than squeezes: four answers are wider than a small
        // phone, and a squeezed "Negotiate" breaks in the middle of the word.
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // Faded whole — fill, rim and label together — as iOS fades it.
            MMButton("Accept", Modifier.alpha(if (short > 0) 0.45f else 1f), kind = BtnKind.GOOD) {
                if (short > 0) return@MMButton
                store.respondTrade(offer.id, true)
            }
            MMButton("Negotiate", kind = BtnKind.GOLD) { store.openCounter(offer) }
            MMButton("Decline", kind = BtnKind.DANGER) { store.respondTrade(offer.id, false) }
            LaterButton { store.setAside(offer) }
        }
    }
}

/**
 * "Later", as iOS draws it: the ghost button's sunken fill, with a smaller
 * snooze and an eleven-and-a-half-point label, because it is the least of
 * the four answers. The shared button cannot shrink its label, so this is
 * that button's shape and height with iOS's smaller words in it.
 */
@Composable
private fun LaterButton(onClick: () -> Unit) {
    val p = P.current
    // iOS's small ghost button: ten-point corners and 9/14 padding.
    val shape = RoundedCornerShape(10.dp)
    Row(
        Modifier
            .clip(shape)
            .background(p.sunken)
            .clickable { onClick() }
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon("snooze", size = 13.dp, tint = p.ink)
        Text("Later", color = p.ink, fontSize = 11.5.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

/** One side of a deal as a single line: the label on the left, the phrase in the side's colour on the right. */
@Composable
private fun TradeLine(label: String, summary: String, tone: Color) {
    val p = P.current
    // iOS's label, Spacer and trailing summary: the summary ends at the
    // right edge however short it is, and a long one wraps no nearer the
    // label than the HStack's eight either side of the Spacer's eight.
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text(label, color = p.ink3, fontSize = 12.sp)
        Spacer(Modifier.width(24.dp))
        Text(
            summary,
            modifier = Modifier.weight(1f),
            color = tone, fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
            textAlign = TextAlign.End,
        )
    }
}

/**
 * The offers set aside for later, folded into one line. Tapping it puts the
 * oldest back in the dock.
 */
@Composable
fun SetAsideChip(store: GameStore, count: Int = store.setAsideOffers.size, modifier: Modifier = Modifier) {
    val p = P.current
    if (count <= 0) return
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(p.sunken)
            .clickable { store.reviewSetAside() }
            .padding(horizontal = 10.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon("snooze", size = 14.dp, tint = p.ink3)
        Spacer(Modifier.width(6.dp))
        Text(
            "${if (count == 1) "1 offer" else "$count offers"} set aside",
            color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.weight(1f))
        Text("Review", color = p.gold, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

/**
 * An offer this phone sent that is still on the table. It names the deal,
 * not just the recipient — you can't take back what you offered if you can't
 * remember it — and says whether they are reading it or set it aside.
 */
@Composable
fun SentOfferRow(store: GameStore, offer: TradeOffer, modifier: Modifier = Modifier) {
    val p = P.current
    val to = store.state?.player(offer.to)?.name ?: "?"
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                "Offer sent to $to: ${store.tradeSummary(offer.give)} ⇄ ${store.tradeSummary(offer.get)}",
                color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.Medium,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
            val reading = store.readingLine(offer)
            if (reading != null) {
                TradeViewingLine(reading, p.gold, store.offerReaders(offer).map { cssColor(it.color, p.ink3) })
            } else if (offer.isSetAside) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon("snooze", size = 13.dp, tint = p.ink3)
                    Spacer(Modifier.width(5.dp))
                    Text("Set aside for later", color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
        // iOS's Spacer and the row's spacing either side of it.
        Spacer(Modifier.width(24.dp))
        MMButton("Cancel", kind = IOS_GHOST) { store.cancelTrade(offer.id) }
    }
}

/**
 * "Ravi is reading this", under an eye that blinks.
 *
 * The seconds between sending a deal and hearing back are the only part of a
 * trade with nothing in them, and they are exactly when a player decides the
 * other side is ignoring them. A pulsing word says "loading"; an eye that
 * blinks on its own says a person is looking. So the lid closes twice,
 * quickly, and then holds open for a long moment — a human rhythm rather
 * than a spinner's — with the readers' own colours beside it.
 */
@Composable
private fun TradeViewingLine(text: String, colour: Color, faces: List<Color>) {
    val p = P.current
    val lid = remember { Animatable(1f) }
    LaunchedEffect(Unit) {
        while (true) {
            repeat(2) {
                lid.animateTo(0.1f, tween(70))
                delay(10)
                lid.animateTo(1f, tween(90))
                delay(60)
            }
            delay(3_600)
        }
    }
    val shape = RoundedCornerShape(99.dp)
    Row(
        Modifier
            .clip(shape)
            .background(colour.copy(alpha = 0.12f))
            .border(1.dp, colour.copy(alpha = 0.34f), shape)
            .padding(start = 7.dp, end = 9.dp, top = 5.dp, bottom = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Icon("eye", size = 14.dp, tint = colour, modifier = Modifier.graphicsLayer { scaleY = lid.value })
        if (faces.isNotEmpty()) {
            // Overlapping, so each wears a ring in the card's colour or the
            // row reads as one smear.
            val ring = p.card
            Canvas(Modifier.size(width = 12.dp + 8.dp * (faces.size - 1), height = 12.dp)) {
                val r = 6.dp.toPx()
                val step = 8.dp.toPx()
                faces.forEachIndexed { n, c ->
                    val at = Offset(r + step * n, size.height / 2f)
                    drawCircle(c, radius = r, center = at)
                    drawCircle(ring, radius = r, center = at, style = Stroke(width = 1.5.dp.toPx()))
                }
            }
        }
        Text(
            text,
            color = colour, fontSize = 11.5.sp, fontWeight = FontWeight.Bold,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}
