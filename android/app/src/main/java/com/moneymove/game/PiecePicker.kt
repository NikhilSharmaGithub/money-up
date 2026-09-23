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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/**
 * Changing your piece and your colour without getting up from the table.
 *
 * Two questions that look like one and are answered by two different halves
 * of the server. The piece is a cosmetic: `/api/store/equip` writes it to the
 * profile and, if that player is sitting at a table, restyles the piece there
 * and then — so it can be changed at any point in a game. The colour is the
 * table's key to who is who, and `updateAppearance` only accepts it while the
 * room is still a lobby; a swap once the dice are out would relabel every
 * ownership pip on the board under the people reading them.
 *
 * So the swatches go grey and say why, rather than being taken, sent, and
 * silently ignored by a server that answers nothing. A control that does
 * nothing is worse than a control that is honestly shut.
 *
 * Only pieces this player already owns are on the shelf here. The shop is two
 * taps away on the home screen and belongs there; a table mid-game is no
 * place to start spending.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PiecePicker(store: GameStore, account: AccountStore, onDismiss: () -> Unit) {
    val p = P.current
    val state = store.state
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    // The wallet says what is owned and what is worn, and both can be stale by
    // the time somebody opens this — a piece bought on the home screen two
    // minutes ago is exactly the piece they came here to put on.
    LaunchedEffect(Unit) { account.refreshStore() }

    val owned = account.wallet?.owned.orEmpty().toSet()
    val worn = account.wallet?.equipped?.get("token").orEmpty()
    val shelf = account.store?.items.orEmpty().filter { it.kind == "token" && it.id in owned }

    // What the sheet shows while an equip is still in the post. The wallet is
    // the truth and takes the guess back over the moment it agrees; a refusal
    // drops it there and then, so the gold ring can never end up on a piece
    // the board is not actually wearing.
    var guess by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(worn) { if (guess == worn) guess = null }
    val showing = guess ?: worn

    fun wear(item: StoreItem?) {
        val id = item?.id.orEmpty()
        if (busy != null || id == showing) return
        busy = id
        guess = id
        SoundKit.click()
        Haptics.tap()
        scope.launch {
            // No `itemId` in the body at all is how the server spells taking a
            // piece off: equipItem() deletes the slot on a null, and Api.post
            // drops null values before it builds the payload. Sending an empty
            // string instead would come back "Not owned".
            val reply = store.api.post(
                "/api/store/equip",
                mapOf("slot" to "token", "itemId" to item?.id),
            )
            if (reply == null) {
                guess = null
                store.showToast("Couldn't change your piece — try again.", isError = true)
            } else {
                // The same note the Store tab writes when it equips, so the
                // two screens agree about what this device is wearing.
                store.prefs.tokenSkin = item?.emoji.orEmpty()
            }
            account.refreshStore()
            busy = null
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.sheet,
        dragHandle = null,
    ) {
        // Twenty pieces on the shelf is six rows of them, which is taller
        // than a small phone's sheet — and a Done button below the fold is a
        // sheet people close with the back gesture and wonder if it saved.
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp)
                .padding(bottom = 28.dp),
        ) {
            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Your piece", color = p.ink, fontSize = 22.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.weight(1f))
                Chip("${account.coins}", icon = "coin", tint = p.gold)
            }
            Spacer(Modifier.height(3.dp))
            Hint("Everything here is style. It changes what the table sees, never what it costs you.")

            Spacer(Modifier.height(16.dp))
            SectionLabel("Pieces", icon = "people")
            Spacer(Modifier.height(8.dp))
            PieceShelf(
                store = store,
                shelf = shelf,
                worn = showing,
                busy = busy,
                loading = account.store == null,
                onWear = { wear(it) },
            )

            Spacer(Modifier.height(18.dp))
            SectionLabel("Your colour", icon = "palette")
            Spacer(Modifier.height(8.dp))
            Swatches(store, state)

            Spacer(Modifier.height(18.dp))
            MMButton("Done", kind = BtnKind.GHOST, modifier = Modifier.fillMaxWidth()) { onDismiss() }
        }
    }
}

/**
 * The pieces themselves, plain disc first.
 *
 * The plain disc is where every player starts, so taking a skin back off has
 * to be a thing you can tap rather than a setting you have to go and find.
 */
@Composable
private fun PieceShelf(
    store: GameStore,
    shelf: List<StoreItem>,
    worn: String,
    busy: String?,
    loading: Boolean,
    onWear: (StoreItem?) -> Unit,
) {
    val p = P.current
    val mine = cssColor(store.me?.color, p.red)
    val initial = (store.me?.name ?: store.nickname).firstOrNull()?.uppercase() ?: "?"

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val chips = listOf<StoreItem?>(null) + shelf
        for (row in chips.chunked(4)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                for (item in row) {
                    PieceChip(
                        emoji = item?.emoji.orEmpty(),
                        initial = initial,
                        label = item?.name ?: "Classic",
                        disc = mine,
                        selected = item?.id.orEmpty() == worn,
                        working = busy != null && busy == item?.id.orEmpty(),
                        modifier = Modifier.weight(1f),
                    ) { onWear(item) }
                }
                repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
        if (shelf.isEmpty()) {
            Hint(
                if (loading) "Fetching the shelf…"
                else "The plain disc is the only piece in your bag. The rest are in the Store, " +
                    "on the home screen."
            )
        }
    }
}

@Composable
private fun PieceChip(
    emoji: String,
    initial: String,
    label: String,
    disc: Color,
    selected: Boolean,
    working: Boolean,
    modifier: Modifier = Modifier,
    onTap: () -> Unit,
) {
    val p = P.current
    Column(
        modifier.clickable(enabled = !working) { onTap() },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(52.dp)
                .clip(RoundedCornerShape(99.dp))
                .background(disc)
                .border(
                    if (selected) 2.5.dp else 1.dp,
                    if (selected) p.gold else p.rule,
                    RoundedCornerShape(99.dp),
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (emoji.isEmpty()) {
                Text(initial, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Black)
            } else {
                // A bought skin is the player's own chosen emoji — the one
                // place in this app's chrome where an emoji is the content
                // rather than a drawing standing in for one.
                Text(emoji, fontSize = 27.sp, modifier = Modifier.alpha(if (working) 0.45f else 1f))
            }
        }
        Spacer(Modifier.height(5.dp))
        Text(
            label,
            color = if (selected) p.gold else p.ink2,
            fontSize = 10.5.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * The eight seat colours, and which of them are going spare.
 *
 * A colour somebody else is wearing is refused by `updateAppearance` — two
 * identical discs on one board is a table nobody can read — so it is shown
 * as taken rather than offered and then bounced.
 */
@Composable
private fun Swatches(store: GameStore, state: GameState?) {
    val p = P.current
    val lobby = state?.isLobby == true
    val mine = store.me?.color?.lowercase()
    val taken = state?.players.orEmpty()
        .filter { it.id != store.meId }
        .map { it.color.lowercase() }
        .toSet()

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // Four to a row: eight swatches across fits a tablet and spills off
        // the side of a phone, and this sheet is read on a phone.
        for (row in SEAT_COLOURS.chunked(4)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (hex in row) {
                    val used = hex in taken
                    val on = hex == mine
                    Box(
                        Modifier
                            .size(34.dp)
                            .clip(RoundedCornerShape(99.dp))
                            .background(
                                cssColor(hex, p.red).copy(alpha = if (used || !lobby) 0.3f else 1f)
                            )
                            .border(
                                if (on) 2.5.dp else 1.dp,
                                if (on) p.gold else p.rule,
                                RoundedCornerShape(99.dp),
                            )
                            .clickable(enabled = lobby && !used && !on) {
                                SoundKit.pop()
                                store.setAppearance(color = hex)
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (used) Icon("close", size = 13.dp, tint = p.ink3)
                    }
                }
            }
        }
        Hint(
            if (lobby) "Grey ones are already somebody else's."
            else "Colours are locked once the dice are out — half the board is reading yours."
        )
    }
}

/**
 * The seat colours, exactly as `COLORS` in server/game.js lists them.
 *
 * `updateAppearance` checks the incoming colour against this list and drops
 * anything else on the floor, so a ninth colour invented here would be a
 * swatch that quietly never applies.
 */
private val SEAT_COLOURS = listOf(
    "#4ade80", "#60a5fa", "#f472b6", "#fbbf24",
    "#a78bfa", "#fb7185", "#22d3ee", "#f97316",
)
