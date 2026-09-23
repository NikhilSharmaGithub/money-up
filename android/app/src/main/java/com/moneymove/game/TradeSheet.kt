package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Making an offer.
 *
 * A trade is the one move in this game that needs two people to agree, so the
 * sheet is built to be read by the person who did not write it: both sides
 * side by side, the same shape, with what each of them is handing over spelled
 * out rather than implied by which column it is in.
 *
 * Cash is a slider rather than a keyboard. On a phone, typing a number means
 * a keyboard over the half of the screen showing what you are trading for.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TradeSheet(store: GameStore, onDismiss: () -> Unit) {
    val p = P.current
    val state = store.state ?: return onDismiss()
    val me = store.me ?: return onDismiss()
    val others = state.players.filter { !it.isBankrupt && it.id != store.meId }
    if (others.isEmpty()) return onDismiss()

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var withWhom by remember { mutableStateOf(others.first().id) }
    var myTiles by remember { mutableStateOf(setOf<Int>()) }
    var theirTiles by remember { mutableStateOf(setOf<Int>()) }
    var myCash by remember { mutableStateOf(0f) }
    var theirCash by remember { mutableStateOf(0f) }

    val them = state.player(withWhom)
    val mine = remember(state.ownership, store.meId) { store.myTiles() }
    val theirs = remember(state.ownership, withWhom) {
        state.ownership.filterValues { it.owner == withWhom }.keys.mapNotNull { it.toIntOrNull() }.sorted()
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.sheet,
        dragHandle = null,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
        ) {
            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon("trade", size = 20.dp, tint = p.red)
                Spacer(Modifier.width(8.dp))
                Text("Offer a trade", color = p.ink, fontSize = 19.sp, fontWeight = FontWeight.Black)
            }

            Spacer(Modifier.height(14.dp))
            SectionLabel("With")
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (other in others) {
                    val on = other.id == withWhom
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (on) p.sunken else Color.Transparent)
                            .border(1.dp, if (on) p.red else p.rule, RoundedCornerShape(12.dp))
                            .clickable {
                                withWhom = other.id
                                theirTiles = emptySet()
                                theirCash = 0f
                            }
                            .padding(horizontal = 10.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        PlayerDisc(other, size = 22.dp)
                        Spacer(Modifier.width(7.dp))
                        Text(
                            other.name,
                            color = if (on) p.ink else p.ink2,
                            fontSize = 13.sp, fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Side(
                title = "You give",
                tiles = mine,
                picked = myTiles,
                cash = myCash,
                purse = me.money,
                store = store,
                onToggle = { myTiles = myTiles.toggle(it) },
                onCash = { myCash = it },
            )

            Spacer(Modifier.height(16.dp))
            Side(
                title = "${them?.name ?: "They"} gives",
                tiles = theirs,
                picked = theirTiles,
                cash = theirCash,
                purse = them?.money ?: 0,
                store = store,
                onToggle = { theirTiles = theirTiles.toggle(it) },
                onCash = { theirCash = it },
            )

            Spacer(Modifier.height(18.dp))
            val empty = myTiles.isEmpty() && theirTiles.isEmpty() &&
                myCash.toInt() == 0 && theirCash.toInt() == 0
            MMButton(
                "Send the offer", kind = BtnKind.PRIMARY, big = true, icon = "trade",
                modifier = Modifier.fillMaxWidth(), enabled = !empty,
            ) {
                store.proposeTrade(
                    to = withWhom,
                    give = TradeSide(money = myCash.toInt(), tiles = myTiles.sorted(), cards = 0),
                    get = TradeSide(money = theirCash.toInt(), tiles = theirTiles.sorted(), cards = 0),
                )
                onDismiss()
            }
            if (empty) {
                Spacer(Modifier.height(8.dp))
                Hint("An offer with nothing on either side is not an offer.")
            }
            Spacer(Modifier.height(10.dp))
            MMButton("Cancel", kind = BtnKind.GHOST, modifier = Modifier.fillMaxWidth()) { onDismiss() }
        }
    }
}

private fun Set<Int>.toggle(i: Int): Set<Int> = if (contains(i)) this - i else this + i

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Side(
    title: String,
    tiles: List<Int>,
    picked: Set<Int>,
    cash: Float,
    purse: Int,
    store: GameStore,
    onToggle: (Int) -> Unit,
    onCash: (Float) -> Unit,
) {
    val p = P.current
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(p.card)
            .border(1.dp, p.rule, RoundedCornerShape(16.dp))
            .padding(14.dp),
    ) {
        SectionLabel(title)
        Spacer(Modifier.height(10.dp))

        if (tiles.isEmpty()) {
            Hint("No streets to offer.")
        } else {
            Column(
                Modifier.heightIn(max = 190.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                for (i in tiles) {
                    val tile = store.tile(i) ?: continue
                    val on = i in picked
                    // A street with buildings cannot be traded, and saying so
                    // here saves an offer that comes back refused.
                    val built = (store.state?.owner(i)?.houseCount ?: 0) > 0
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (on) p.sunken else Color.Transparent)
                            .border(
                                1.dp,
                                if (on) p.red else p.rule,
                                RoundedCornerShape(10.dp),
                            )
                            .clickable(enabled = !built) { onToggle(i) }
                            .padding(horizontal = 10.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        store.groupInfo(tile)?.let {
                            Box(
                                Modifier
                                    .size(8.dp, 20.dp)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(cssColor(it.color, p.red)),
                            )
                            Spacer(Modifier.width(9.dp))
                        }
                        Text(
                            tile.name,
                            color = if (built) p.ink3 else p.ink,
                            fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold,
                        )
                        Spacer(Modifier.weight(1f))
                        if (built) Chip("built", tint = p.ink3)
                        else Text(
                            money(tile.price ?: 0),
                            color = p.ink2, fontSize = 12.5.sp, fontWeight = FontWeight.Medium,
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon("cash", size = 15.dp)
            Spacer(Modifier.width(7.dp))
            Text(
                money(cash.toInt()),
                color = if (cash > 0) p.good else p.ink3,
                fontSize = 14.sp, fontWeight = FontWeight.Black,
            )
            Spacer(Modifier.weight(1f))
            Hint("of ${money(purse)}")
        }
        val colors = SliderDefaults.colors(
            thumbColor = p.red,
            activeTrackColor = p.red,
            inactiveTrackColor = p.sunken,
        )
        Slider(
            value = cash.coerceIn(0f, purse.coerceAtLeast(1).toFloat()),
            onValueChange = onCash,
            valueRange = 0f..purse.coerceAtLeast(1).toFloat(),
            colors = colors,
            // Material draws a stop dot at the far end of an unfilled track.
            // On a money slider it reads as a second thumb somebody has left
            // behind — there is nothing to stop at, so nothing is drawn.
            track = { sliderState ->
                SliderDefaults.Track(
                    sliderState = sliderState,
                    colors = colors,
                    drawStopIndicator = null,
                )
            },
        )
    }
}

/**
 * An offer somebody has made you.
 *
 * It sits on the table rather than in a list, because an offer nobody notices
 * is an offer that expires — and the two buttons are the whole point, so they
 * are the biggest thing on it.
 */
@Composable
fun TradeOfferCard(store: GameStore, offer: TradeOffer, modifier: Modifier = Modifier) {
    val p = P.current
    val state = store.state ?: return
    val from = state.player(offer.from) ?: return

    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(p.card)
            .border(2.dp, p.red, RoundedCornerShape(16.dp))
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            PlayerDisc(from, size = 26.dp)
            Spacer(Modifier.width(8.dp))
            Text(
                "${from.name} offers a trade",
                color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Bold,
            )
        }
        Spacer(Modifier.height(10.dp))
        OfferLine(store, "You get", offer.give)
        Spacer(Modifier.height(6.dp))
        OfferLine(store, "You give", offer.get)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MMButton("Accept", kind = BtnKind.GOOD, modifier = Modifier.weight(1f)) {
                store.respondTrade(offer.id, true)
            }
            MMButton("Decline", kind = BtnKind.GHOST, modifier = Modifier.weight(1f)) {
                store.respondTrade(offer.id, false)
            }
        }
    }
}

@Composable
private fun OfferLine(store: GameStore, label: String, side: TradeSide) {
    val p = P.current
    val names = side.tiles.mapNotNull { store.tile(it)?.name }
    val bits = buildList {
        if (side.money > 0) add(money(side.money))
        addAll(names)
        if (side.cards > 0) add("${side.cards} prison card${if (side.cards == 1) "" else "s"}")
    }
    Row(Modifier.fillMaxWidth()) {
        Text(
            label,
            color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.width(66.dp),
        )
        Text(
            if (bits.isEmpty()) "nothing" else bits.joinToString(" · "),
            color = if (bits.isEmpty()) p.ink3 else p.ink,
            fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
        )
    }
}
