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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Everything this player owns, grouped by country.
 *
 * Grouped, because a street on its own is worth its bare rent and a country
 * is worth building on — and the whole question a player opens this to answer
 * is "what am I one street away from". A flat list of twenty-two names does
 * not answer it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PropertiesSheet(store: GameStore, onDismiss: () -> Unit, onOpenTile: (Int) -> Unit) {
    val p = P.current
    val state = store.state ?: return onDismiss()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    val mine = store.myTiles()
    val byGroup = mine.groupBy { store.tile(it)?.group ?: "" }
    val worth = mine.sumOf { i ->
        val t = store.tile(i)
        val own = state.owner(i)
        val houses = own?.houseCount ?: 0
        val base = if (own?.isMortgaged == true) (t?.price ?: 0) / 2 else (t?.price ?: 0)
        base + houses * (t?.houseCost ?: 0)
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
                .padding(horizontal = 18.dp)
                .padding(bottom = 28.dp),
        ) {
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon("bank", size = 20.dp, tint = p.red)
                Spacer(Modifier.width(8.dp))
                Text("Your streets", color = p.ink, fontSize = 19.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.weight(1f))
                MMButton("Done", kind = BtnKind.GHOST) { onDismiss() }
            }
            Spacer(Modifier.height(4.dp))
            Hint("${mine.size} deeds · about ${money(worth)} on the board")

            if (mine.isEmpty()) {
                Spacer(Modifier.height(20.dp))
                Hint("Nothing yet. Land on something and buy it.")
                Spacer(Modifier.height(20.dp))
                return@Column
            }

            Spacer(Modifier.height(14.dp))
            for ((key, tiles) in byGroup.entries.sortedBy { it.key }) {
                val info = state.groups[key]
                val all = state.map.groups?.get(key).orEmpty()
                val whole = all.isNotEmpty() && all.all { state.owner(it)?.owner == store.meId }
                val missing = all.size - tiles.size

                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(bottom = 12.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(p.card)
                        .border(
                            if (whole) 2.dp else 1.dp,
                            if (whole) cssColor(info?.color, p.red) else p.rule,
                            RoundedCornerShape(14.dp),
                        )
                        .padding(12.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier
                                .size(10.dp, 22.dp)
                                .clip(RoundedCornerShape(3.dp))
                                .background(cssColor(info?.color, p.ink3)),
                        )
                        Spacer(Modifier.width(9.dp))
                        Text(
                            info?.name ?: key.ifBlank { "Other" },
                            color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.weight(1f))
                        // The one thing this screen exists to answer.
                        if (whole) Chip("complete", tint = cssColor(info?.color, p.red))
                        else if (all.isNotEmpty()) {
                            Chip("$missing to go", tint = p.ink3)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    for (i in tiles.sorted()) {
                        val tile = store.tile(i) ?: continue
                        val own = state.owner(i)
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(9.dp))
                                .clickable { onOpenTile(i) }
                                .padding(horizontal = 6.dp, vertical = 7.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                tile.name,
                                color = if (own?.isMortgaged == true) p.ink3 else p.ink,
                                fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold,
                            )
                            Spacer(Modifier.weight(1f))
                            when {
                                own?.isMortgaged == true -> Chip("mortgaged", icon = "bank", tint = p.bad)
                                (own?.houseCount ?: 0) >= 5 -> Chip("hotel", icon = "hotel", tint = p.good)
                                (own?.houseCount ?: 0) > 0 ->
                                    Chip("${own?.houseCount}", icon = "house", tint = p.good)
                                else -> Text(
                                    money(tile.price ?: 0),
                                    color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
