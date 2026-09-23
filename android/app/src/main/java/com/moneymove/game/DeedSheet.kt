package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * One street, and everything its owner may do with it.
 *
 * The rent ladder is the part people actually open this for — what the next
 * house is worth is the whole decision — so it comes first, with the current
 * step marked. The buttons below only ever offer what the server would
 * accept; a button that comes back refused is worse than no button.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeedSheet(store: GameStore, index: Int, onDismiss: () -> Unit) {
    val p = P.current
    val state = store.state ?: return onDismiss()
    val tile = store.tile(index) ?: return onDismiss()
    val own = state.owner(index)
    val group = store.groupInfo(tile)
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.sheet,
        dragHandle = null,
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp).padding(bottom = 28.dp)) {
            Spacer(Modifier.height(14.dp))

            // The colour band, exactly as the tile wears it on the board.
            group?.let {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(8.dp)
                        .clip(RoundedCornerShape(99.dp))
                        .background(cssColor(it.color, p.red))
                )
                Spacer(Modifier.height(12.dp))
            }

            Text(tile.name, color = p.ink, fontSize = 22.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(3.dp))
            Hint(
                buildString {
                    group?.let { append(it.name) }
                    tile.price?.let { if (isNotEmpty()) append(" · "); append(money(it)) }
                }
            )

            Spacer(Modifier.height(14.dp))
            OwnerLine(store, state, own)

            if (tile.type == "property") {
                Spacer(Modifier.height(14.dp))
                RentLadder(tile, own, p)
            }

            Spacer(Modifier.height(16.dp))
            Actions(store, index, tile, own)
            Spacer(Modifier.height(12.dp))
            MMButton("Close", kind = BtnKind.GHOST, modifier = Modifier.fillMaxWidth()) { onDismiss() }
        }
    }
}

@Composable
private fun OwnerLine(store: GameStore, state: GameState, own: TileOwnership?) {
    val p = P.current
    val owner = own?.let { state.player(it.owner) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (owner == null) {
            Icon("bank", size = 16.dp, tint = p.ink3)
            Spacer(Modifier.width(7.dp))
            Text("Still with the bank", color = p.ink2, fontSize = 14.sp, fontWeight = FontWeight.Medium)
        } else {
            PlayerDisc(owner, size = 22.dp)
            Spacer(Modifier.width(8.dp))
            Text(
                if (owner.id == store.meId) "Yours" else owner.name,
                color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
            )
            if (own.isMortgaged) {
                Spacer(Modifier.width(8.dp))
                Chip("Mortgaged", icon = "bank", tint = p.bad)
            }
        }
    }
}

/**
 * What this street charges, step by step, with the step it is on marked.
 *
 * A deed is opened to answer one question — is the next house worth it — and
 * a column of numbers with no "you are here" makes the reader do the
 * arithmetic the sheet exists to save them.
 */
@Composable
private fun RentLadder(tile: TileData, own: TileOwnership?, p: Palette) {
    val rents = tile.rent ?: return
    val here = own?.houseCount ?: 0
    val labels = listOf("Bare", "1 house", "2 houses", "3 houses", "4 houses", "Hotel")
    Column(Modifier.fillMaxWidth()) {
        SectionLabel("Rent", icon = "cash")
        Spacer(Modifier.height(6.dp))
        for ((step, rent) in rents.withIndex()) {
            val on = own != null && step == here
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (on) p.sunken else androidx.compose.ui.graphics.Color.Transparent)
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    labels.getOrElse(step) { "$step" },
                    color = if (on) p.ink else p.ink2,
                    fontSize = 13.sp,
                    fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    money(rent),
                    color = if (on) p.red else p.ink2,
                    fontSize = 13.5.sp,
                    fontWeight = if (on) FontWeight.Black else FontWeight.SemiBold,
                )
            }
        }
        tile.houseCost?.takeIf { it > 0 }?.let {
            Spacer(Modifier.height(6.dp))
            Hint("Each house costs ${money(it)}.")
        }
    }
}

@Composable
private fun Actions(store: GameStore, index: Int, tile: TileData, own: TileOwnership?) {
    val p = P.current
    if (own == null || own.owner != store.meId) {
        Hint(
            if (own == null) "Land on it to buy it."
            else "Somebody else's street — a trade is the only way to it."
        )
        return
    }
    val cost = tile.houseCost ?: 0
    // Build all earns its place only when it would do something Build does
    // not: one more building is one tap either way.
    val sweep = if (tile.type == "property") store.buildAllCount(index) else 0

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (tile.type == "property") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MMButton(
                    if (own.houseCount == 4) "Hotel ${money(cost)}" else "Build ${money(cost)}",
                    kind = BtnKind.GOOD, icon = "crane",
                    modifier = Modifier.weight(1f),
                    enabled = store.canBuild(index),
                ) { store.build(index) }
                if (sweep > 1) {
                    MMButton(
                        "All ×$sweep", kind = BtnKind.PRIMARY, icon = "houses",
                        modifier = Modifier.weight(1f),
                    ) { store.buildAll(index) }
                }
            }
            MMButton(
                if (own.houseCount == 5) "Sell the hotel +${money(cost / 2)}"
                else "Sell a house +${money(cost / 2)}",
                kind = BtnKind.GHOST, modifier = Modifier.fillMaxWidth(),
                enabled = store.canSellHouse(index),
            ) { store.sellHouse(index) }
        }
        if (own.isMortgaged) {
            val lift = kotlin.math.ceil((tile.price ?: 0) / 2.0 * 1.1).toInt()
            MMButton(
                "Buy the mortgage back ${money(lift)}",
                kind = BtnKind.GOLD, icon = "bank", modifier = Modifier.fillMaxWidth(),
                enabled = (store.me?.money ?: 0) >= lift && store.state?.settings?.mortgage != false,
            ) { store.unmortgage(index) }
        } else {
            MMButton(
                "Mortgage +${money((tile.price ?: 0) / 2)}",
                kind = BtnKind.GOLD, icon = "bank", modifier = Modifier.fillMaxWidth(),
                enabled = store.canMortgage(index),
            ) { store.mortgage(index) }
        }
        // Why a greyed-out Build is greyed out. Even build is the rule people
        // meet first and understand last, so it gets named.
        buildBlocker(store, index, tile, own)?.let { Hint(it) }
    }
}

/** The one sentence that explains a dead Build button, or null when it is live. */
private fun buildBlocker(store: GameStore, index: Int, tile: TileData, own: TileOwnership): String? {
    val state = store.state ?: return null
    if (tile.type != "property") return "Airports and utilities can only be mortgaged."
    if (own.isMortgaged) return "Buy the mortgage back before building."
    if (own.houseCount >= 5) return "Fully built — nothing more to add."
    if (store.canBuild(index)) return null
    val group = tile.group ?: return null
    val idxs = state.map.groups?.get(group).orEmpty()
    if (!store.ownsFullGroup(store.meId, group)) return "You need every street of this country to build."
    if (idxs.any { state.owner(it)?.isMortgaged == true }) {
        return "Lift the mortgage on the rest of this country first."
    }
    if (state.settings.evenBuild == true) {
        val behind = idxs.filter { (state.owner(it)?.houseCount ?: 0) < own.houseCount }
            .mapNotNull { store.tile(it)?.name }
        if (behind.isNotEmpty()) return "Even build — put a house on ${behind.joinToString(" and ")} first."
    }
    if ((store.me?.money ?: 0) < (tile.houseCost ?: 0)) return "Short on cash for the next house."
    return if (state.turn?.playerId != store.meId) "Building happens on your own turn." else null
}
