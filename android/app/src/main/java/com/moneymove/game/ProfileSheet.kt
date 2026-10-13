package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// ── somebody's profile ──────────────────────────────────────────────────────

/**
 * Who a profile is opened about, and what the opener already knows of them —
 * enough to draw the top of the card in the moment before the server answers.
 *
 * A finished game's standings know the most (the colour they played in
 * tonight); a leaderboard row and a friend know their name, flag and level
 * or face. The card itself is always read afresh by [code].
 */
data class ProfileSeed(
    val code: String,
    val name: String,
    /** Their seat colour tonight, for the disc; none away from a table. */
    val color: String? = null,
    val flag: String? = null,
    val avatar: String? = null,
    /** The level the opener saw, until the card's own lands. */
    val level: Int = 0,
) {
    companion object {
        fun of(seat: PlayerResult) = ProfileSeed(
            code = seat.code, name = seat.name, color = seat.color,
            flag = seat.flag, avatar = seat.avatar, level = seat.level,
        )

        fun of(row: LeaderRow) = ProfileSeed(
            code = row.code, name = row.name.ifBlank { "Player" }, flag = row.flag, level = row.level,
        )

        fun of(friend: Friend) = ProfileSeed(
            code = friend.code, name = friend.name.ifBlank { friend.code },
            flag = friend.flag, avatar = friend.avatar,
        )
    }
}

/**
 * Somebody's card: their level, their record, the titles that keep landing
 * on their seat, their career, and the one thing worth doing about them —
 * asking to be friends, or saying yes to them having asked.
 *
 * Opened from a finished game's standings, from a leaderboard row and from a
 * friend, so it lives on its own rather than inside any one of them. Each
 * raises it beside its own sheet, the way the DM sheet is raised beside
 * Friends: a sheet is a window of its own, so this one opens over whatever
 * list it came from and closes back onto it.
 *
 * The card is read afresh every time it opens, by the code, as this player —
 * a list can be minutes old, and a "Request sent" from before they answered
 * would be wrong the moment it showed. A house player answers like anybody
 * else: the server keeps their numbers steady and their requests unanswered,
 * and nothing here treats them differently.
 *
 * Its own short sheet, opened at its full height: there is little below the
 * button to drag up to.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlayerProfileSheet(
    store: GameStore,
    account: AccountStore,
    seed: ProfileSeed,
    onAsked: () -> Unit = {},
    onDismiss: () -> Unit,
) {
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var card by remember { mutableStateOf<PlayerProfile?>(null) }
    var failed by remember { mutableStateOf<String?>(null) }
    // What a tap has since made true, over what the card said as it loaded.
    var relation by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(seed.code) {
        val got = account.player(seed.code)
        card = got.profile
        failed = got.error
    }

    val name = card?.name?.ifBlank { null } ?: seed.name
    val flag = card?.flag?.ifBlank { null } ?: seed.flag
    val code = card?.code?.ifBlank { null } ?: seed.code
    val level = card?.level?.takeIf { it > 0 } ?: seed.level

    fun ask() {
        if (busy) return
        Haptics.tap()
        busy = true
        account.befriend(code, quiet = true) { error, accepted ->
            busy = false
            if (error != null) {
                store.showToast(error, isError = true)
            } else {
                // They had already asked, so the add made the friendship.
                relation = if (accepted) "friend" else "sent"
                onAsked()
                if (accepted) Haptics.turn()
                store.showToast(if (accepted) "You and $name are now friends" else "Request sent")
            }
        }
    }

    fun accept() {
        if (busy) return
        Haptics.tap()
        busy = true
        account.answerFriend(code, accept = true) { error ->
            busy = false
            if (error != null) {
                store.showToast(error, isError = true)
            } else {
                relation = "friend"
                onAsked()
                Haptics.turn()
                store.showToast("You and $name are now friends")
            }
        }
    }

    MMSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Box(Modifier.fillMaxWidth()) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(start = 16.dp, end = 16.dp, bottom = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                ProfileGrabber(Modifier.padding(top = 5.dp, bottom = 6.dp))
                // Their face if they wear one, else their initial in the
                // colour they played in tonight — the disc the standings drew.
                AvatarDisc(name, seed.color, size = 72.dp, avatar = card?.avatar?.ifBlank { null } ?: seed.avatar)
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            name,
                            modifier = Modifier.weight(1f, fill = false),
                            color = p.ink, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        // The flag they chose, theirs to show as it is.
                        flag?.takeIf { it.isNotBlank() }?.let {
                            Spacer(Modifier.width(8.dp))
                            Text(it, fontSize = 20.sp, maxLines = 1, softWrap = false)
                        }
                    }
                    LevelChip(level)
                }
                val shown = card
                when {
                    shown != null -> ProfileRecord(
                        shown,
                        relation = relation ?: shown.relation,
                        busy = busy,
                        onAsk = ::ask,
                        onAccept = ::accept,
                    )
                    failed != null -> Box(
                        Modifier.fillMaxWidth().heightIn(min = 120.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            failed.orEmpty(),
                            color = p.bad, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                            textAlign = TextAlign.Center,
                        )
                    }
                    // Held at about the height the record will take, so the
                    // sheet does not leap when it lands.
                    else -> Box(
                        Modifier.fillMaxWidth().heightIn(min = 120.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        LandingSpinner(quietInk(), 22.dp)
                    }
                }
            }
            // A sheet is a window of its own, so the answer to Add friend is
            // drawn in this one or it would land under it — as the result
            // sheet draws its own.
            ToastPill(store, Modifier.align(Alignment.BottomCenter))
        }
    }
}

/**
 * The record itself: four numbers on a card, how long they have been at it,
 * up to three titles, the career, and the button where the two of you stand.
 */
@Composable
private fun ProfileRecord(
    card: PlayerProfile,
    relation: String,
    busy: Boolean,
    onAsk: () -> Unit,
    onAccept: () -> Unit,
) {
    val p = P.current
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Panel(padding = 14.dp) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Tally(grouped(card.wins), "WINS", Modifier.weight(1f))
                Tally(grouped(card.played), "GAMES", Modifier.weight(1f))
                Tally("${card.winRate}%", "WIN RATE", Modifier.weight(1f))
                // Coins, not dollars: these are what the wins paid into the
                // wallet, so they wear no dollar sign.
                Tally(grouped(card.winnings), "COINS WON", Modifier.weight(1f))
            }
        }
        if (card.since > 0) ProfileCaption("Playing since ${clockText(card.since, "MMMyyyy", twentyFour = false)}")

        val titles = card.titles.filter { it.title.isNotBlank() }.take(3)
        if (titles.isNotEmpty()) {
            // The shelf's columns: as many 132dp-or-wider as fit, each an
            // equal share, so a long title is not squeezed to its first word.
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val columns = ((maxWidth + 8.dp) / (132.dp + 8.dp)).toInt().coerceIn(1, titles.size)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (row in titles.chunked(columns)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (t in row) TitleChip(t.title, t.count, Modifier.weight(1f))
                            repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }

        // An older server sends no career at all, and a card that says
        // "nothing counted yet" about a server that never counted would be
        // wrong, so only a server that knows about careers gets the grid.
        card.career?.let { CareerCard(it) }

        val wide = Modifier.fillMaxWidth()
        when (relation) {
            // Your own card asks nothing of you.
            "self" -> Unit
            "friend" -> MMButton(
                "Friends", modifier = wide, kind = BtnKind.PLAIN, big = true, enabled = false,
                lead = { CheckMark(p.good) },
            ) {}
            // Settled until they answer, and faded so it reads as a state
            // rather than a button; MMButton itself looks the same disabled.
            "sent" -> Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                MMButton(
                    "Request sent", modifier = wide.alpha(0.7f), kind = BtnKind.PLAIN, big = true, enabled = false,
                    lead = { ink -> CheckMark(ink) },
                ) {}
                ProfileCaption("Waiting for them to say yes.")
            }
            "asked" -> Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                MMButton(
                    "Accept request", modifier = wide, kind = BtnKind.GOLD, big = true, enabled = !busy,
                    lead = { ink -> if (busy) LandingSpinner(ink, 18.dp) else PersonPlusMark(ink) },
                ) { onAccept() }
                ProfileCaption("They asked to be your friend.")
            }
            else -> MMButton(
                "Add friend", modifier = wide, kind = BtnKind.PRIMARY, big = true, enabled = !busy,
                lead = { ink -> if (busy) LandingSpinner(ink, 18.dp) else PersonPlusMark(ink) },
            ) { onAsk() }
        }
    }
}

/** A line under an answer, set straight on the sheet's glass, in its quiet ink. */
@Composable
private fun ProfileCaption(text: String) {
    Text(
        text,
        color = quietInk(), fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
        textAlign = TextAlign.Center,
    )
}

/**
 * iOS's sheet grabber: 36 by 5, in the system's faint label grey — iOS's own
 * rather than a table ink, so it is the same on every table style. The same
 * mark the result sheet hangs at its top.
 */
@Composable
private fun ProfileGrabber(modifier: Modifier = Modifier) {
    val dark = P.current.sheet.luminance() < 0.5f
    Box(
        modifier
            .size(width = 36.dp, height = 5.dp)
            .clip(CircleShape)
            .background(if (dark) Color(0x4DEBEBF5) else Color(0x4D3C3C43)),
    )
}
