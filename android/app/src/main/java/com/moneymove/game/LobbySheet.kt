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
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The house rules, before anybody rolls.
 *
 * Every switch here says what it does to the game rather than naming the
 * rule: "auctions" is a word, "a street nobody buys goes to the highest
 * bidder" is the thing that will happen. People agree to rules they
 * understand and argue about rules they do not.
 *
 * Only the host may change anything; everybody else gets the same screen
 * read-only, which is how you find out what you have sat down to.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LobbySheet(store: AccountStore, game: GameStore, onDismiss: () -> Unit) {
    val p = P.current
    val state = game.state ?: return onDismiss()
    val s = state.settings
    val host = game.isHost
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    LaunchedEffect(Unit) { store.refreshStore() }

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
                Icon("scales", size = 20.dp, tint = p.red)
                Spacer(Modifier.width(8.dp))
                Text("House rules", color = p.ink, fontSize = 19.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.weight(1f))
                MMButton("Done", kind = BtnKind.GHOST) { onDismiss() }
            }
            if (!host) {
                Spacer(Modifier.height(6.dp))
                Hint("The host sets these. This is what you have sat down to.")
            }
            if (state.quick == true) {
                Spacer(Modifier.height(6.dp))
                Hint("A quick table deals its own rules — nobody gets to pick them.")
            }

            Spacer(Modifier.height(16.dp))
            SectionLabel("The board", icon = "map")
            Spacer(Modifier.height(8.dp))
            BoardRow(store, game, host && state.quick != true)

            Spacer(Modifier.height(16.dp))
            SectionLabel("Money")
            Spacer(Modifier.height(8.dp))
            Choice(
                "Everybody starts with",
                listOf(1000, 1500, 2000, 2500, 3000).map { money(it) to it },
                s.startingCash,
                enabled = host && state.quick != true,
            ) { game.updateSettings(mapOf("startingCash" to it)) }

            Spacer(Modifier.height(14.dp))
            Choice(
                "Seats",
                (2..8).map { "$it" to it },
                s.maxPlayers,
                enabled = host && state.quick != true,
            ) { game.updateSettings(mapOf("maxPlayers" to it)) }

            Spacer(Modifier.height(14.dp))
            Choice(
                "Time on the clock",
                listOf("Off" to 0, "60s" to 60, "90s" to 90, "2 min" to 120, "3 min" to 180),
                s.turnSeconds ?: 90,
                enabled = host && state.quick != true,
            ) { game.updateSettings(mapOf("turnSeconds" to it)) }

            Spacer(Modifier.height(18.dp))
            SectionLabel("Rules")
            Spacer(Modifier.height(4.dp))
            val editable = host && state.quick != true
            Rule("auction", s.auction != false, editable,
                "Auctions", "A street nobody buys goes to the highest bidder.") {
                game.updateSettings(mapOf("auction" to it))
            }
            Rule("x2rent", s.x2rent != false, editable,
                "Double rent on a full country", "Own every street of a colour and bare rent doubles.") {
                game.updateSettings(mapOf("x2rent" to it))
            }
            Rule("evenBuild", s.evenBuild != false, editable,
                "Even build", "Houses go up across a country together, never four on one street.") {
                game.updateSettings(mapOf("evenBuild" to it))
            }
            Rule("mortgage", s.mortgage != false, editable,
                "Mortgages", "Raise cash against a street you own, and buy it back later.") {
                game.updateSettings(mapOf("mortgage" to it))
            }
            Rule("vacationCash", s.vacationCash != false, editable,
                "Vacation pays", "Every fine and tax piles up on Vacation for whoever lands there.") {
                game.updateSettings(mapOf("vacationCash" to it))
            }
            Rule("noRentInPrison", s.noRentInPrison != false, editable,
                "No rent from prison", "A landlord behind bars collects nothing.") {
                game.updateSettings(mapOf("noRentInPrison" to it))
            }
            Rule("randomizeOrder", s.randomizeOrder != false, editable,
                "Shuffle the turn order", "Who goes first is drawn rather than who joined first.") {
                game.updateSettings(mapOf("randomizeOrder" to it))
            }
            Rule("allowBots", s.allowBots == true, editable,
                "Let the house fill empty seats", "Bots sit down so a short table still plays.") {
                game.updateSettings(mapOf("allowBots" to it))
            }

            Spacer(Modifier.height(18.dp))
            SectionLabel("At the table", icon = "people")
            Spacer(Modifier.height(8.dp))
            for (player in state.players) {
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PlayerDisc(player, size = 28.dp)
                    Spacer(Modifier.width(9.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            player.name + if (player.id == state.hostId) " · host" else "",
                            color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                        )
                        if (player.isBot == true) Hint("A house player")
                    }
                    if (host && player.id != game.meId) {
                        MMButton("Host", kind = BtnKind.GHOST) { game.makeHost(player.id) }
                        Spacer(Modifier.width(6.dp))
                        MMButton("Kick", kind = BtnKind.DANGER) { game.kick(player.id) }
                    }
                }
            }
        }
    }
}

@Composable
private fun BoardRow(store: AccountStore, game: GameStore, editable: Boolean) {
    val p = P.current
    val current = game.state?.map
    val listing = store.boards
    val free = listing?.free.orEmpty().toSet()
    val owned = store.wallet?.owned.orEmpty()
        .mapNotNull { id -> store.store?.items?.firstOrNull { it.id == id }?.mapId }.toSet()

    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(p.card)
                .border(1.dp, p.rule, RoundedCornerShape(14.dp))
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon("map", size = 20.dp, tint = p.red)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    current?.name ?: "Classic",
                    color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                )
                Hint("${current?.size ?: 40} tiles")
            }
        }
        if (!editable) return
        Spacer(Modifier.height(10.dp))
        // Only the boards this player may actually deal: the ones they own and
        // the two the calendar is giving away today. Offering a locked board
        // is offering a tap that comes back refused.
        val playable = listing?.boards.orEmpty()
            .filter { it.id == "classic" || it.id in free || it.id in owned }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (row in playable.chunked(2)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (board in row) {
                        val on = board.id == current?.id
                        Row(
                            Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(10.dp))
                                .background(if (on) p.sunken else Color.Transparent)
                                .border(1.dp, if (on) p.red else p.rule, RoundedCornerShape(10.dp))
                                .clickable { game.updateSettings(mapOf("mapId" to board.id)) }
                                .padding(horizontal = 9.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(board.icon, fontSize = 15.sp)
                            Spacer(Modifier.width(7.dp))
                            Text(
                                board.name,
                                color = if (on) p.ink else p.ink2,
                                fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                            )
                        }
                    }
                    repeat(2 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** One rule, named by what it does rather than what it is called. */
@Composable
private fun Rule(
    key: String,
    on: Boolean,
    enabled: Boolean,
    title: String,
    what: String,
    onChange: (Boolean) -> Unit,
) {
    val p = P.current
    Row(
        Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Hint(what)
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = on,
            onCheckedChange = if (enabled) onChange else null,
            enabled = enabled,
            colors = SwitchDefaults.colors(
                checkedThumbColor = p.accentInk,
                checkedTrackColor = p.red,
                uncheckedThumbColor = p.ink3,
                uncheckedTrackColor = p.sunken,
                uncheckedBorderColor = p.rule2,
            ),
        )
    }
}

/** A row of mutually exclusive values — cash, seats, the clock. */
@Composable
private fun <T> Choice(
    label: String,
    options: List<Pair<String, T>>,
    current: T,
    enabled: Boolean,
    onPick: (T) -> Unit,
) {
    val p = P.current
    Column {
        Text(label, color = p.ink2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(7.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for ((text, value) in options) {
                val on = value == current
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (on) p.red else p.sunken)
                        .clickable(enabled = enabled) { onPick(value) }
                        .padding(vertical = 9.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text,
                        color = if (on) p.accentInk else p.ink2,
                        fontSize = 12.5.sp,
                        fontWeight = if (on) FontWeight.Black else FontWeight.SemiBold,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}
