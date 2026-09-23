package com.moneymove.game

import androidx.compose.foundation.background
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
 *
 * The sheet has two other faces: every board there is, and the shop for one
 * of them. They are drawn in place of the rules rather than as a second sheet
 * on top of this one — BoardPicker.kt says why — and the way back is a Back
 * button, the same as the cup bracket's.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LobbySheet(store: AccountStore, game: GameStore, onDismiss: () -> Unit) {
    val p = P.current
    val state = game.state ?: return onDismiss()
    val host = game.isHost
    val editable = host && state.quick != true
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // Which face the sheet is showing. A board id here is the shop, open on
    // that board; a board the shelf has since stopped listing quietly falls
    // back to the rules rather than to a screen about nothing.
    var allBoards by remember { mutableStateOf(false) }
    var shopping by remember { mutableStateOf<String?>(null) }
    val shopBoard = shopping?.let { store.board(it) }

    // A scroll position per face. One Column draws all three, and one shared
    // position means the shop opens wherever the board list was left: a
    // thousand dp of shop scrolled to the bottom of two thousand dp of list,
    // with its title and its only way back somewhere above the screen. iOS
    // never had this to fix — there each face is its own sheet, and a sheet
    // brings its own scroll. The two lists keep their place, which is what a
    // list should do; the shop is keyed on the board, so the second board you
    // open starts at the top rather than where you left the first.
    val rulesScroll = rememberScrollState()
    val allScroll = rememberScrollState()
    val shopScroll = key(shopping) { rememberScrollState() }

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
                .verticalScroll(
                    when {
                        shopBoard != null -> shopScroll
                        allBoards -> allScroll
                        else -> rulesScroll
                    },
                )
                .padding(horizontal = 18.dp)
                .padding(bottom = 28.dp),
        ) {
            Spacer(Modifier.height(16.dp))
            when {
                shopBoard != null -> BoardShop(
                    store, game, shopBoard,
                    onBought = { id ->
                        // Bought from the lobby: play it straight away. That is
                        // what they were reaching for when they tapped it.
                        if (editable) game.updateSettings(mapOf("mapId" to id))
                        shopping = null
                        allBoards = false
                    },
                    onBack = { shopping = null },
                )

                allBoards -> AllBoards(
                    store, game, editable,
                    onPick = { id ->
                        game.updateSettings(mapOf("mapId" to id))
                        allBoards = false
                    },
                    onShop = { shopping = it },
                    onBack = { allBoards = false },
                )

                else -> HouseRules(
                    store, game, state, host, editable, onDismiss,
                    onOpenAll = { allBoards = true },
                    onShop = { shopping = it },
                )
            }
        }
    }
}

/**
 * The rules themselves — the face this sheet wears nine times out of ten.
 *
 * Lifted out of [LobbySheet] whole when the sheet grew two more faces. It
 * brings no gutter of its own: the picker and the shop replace exactly this,
 * and three faces each carrying their own padding is three different gutters.
 */
@Composable
private fun HouseRules(
    store: AccountStore,
    game: GameStore,
    state: GameState,
    host: Boolean,
    editable: Boolean,
    onDismiss: () -> Unit,
    onOpenAll: () -> Unit,
    onShop: (String) -> Unit,
) {
    val p = P.current
    val s = state.settings
    Column {
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
        // Three boards, each wearing its own drawn map. What was here before
        // was a grid of names, and nineteen boards answer to much the same
        // handful of words — none of which tells Bharat from Canada.
        BoardBoxes(store, game, editable, onOpenAll = onOpenAll, onShop = onShop)

        Spacer(Modifier.height(16.dp))
        SectionLabel("Money")
        Spacer(Modifier.height(8.dp))
        Choice(
            "Everybody starts with",
            listOf(1000, 1500, 2000, 2500, 3000).map { money(it) to it },
            s.startingCash,
            enabled = editable,
        ) { game.updateSettings(mapOf("startingCash" to it)) }

        Spacer(Modifier.height(14.dp))
        Choice(
            "Seats",
            (2..8).map { "$it" to it },
            s.maxPlayers,
            enabled = editable,
        ) { game.updateSettings(mapOf("maxPlayers" to it)) }

        Spacer(Modifier.height(14.dp))
        Choice(
            "Time on the clock",
            listOf("Off" to 0, "60s" to 60, "90s" to 90, "2 min" to 120, "3 min" to 180),
            s.turnSeconds ?: 90,
            enabled = editable,
        ) { game.updateSettings(mapOf("turnSeconds" to it)) }

        Spacer(Modifier.height(18.dp))
        SectionLabel("Rules")
        Spacer(Modifier.height(4.dp))
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
