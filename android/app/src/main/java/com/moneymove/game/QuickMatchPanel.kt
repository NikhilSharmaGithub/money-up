package com.moneymove.game

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.Crossfade
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * A matchmade table that has not dealt itself in yet: the Play-now lobby.
 *
 * It runs in two acts, and the panel only ever says what the act in front of
 * you needs. First the search — twenty seconds of the table looking for
 * people, the last five filling the chairs nobody took — where the one thing
 * that matters is the number counting down, so it is big and gold and there
 * is nothing to press but "I'm ready". Then the ready phase: everyone but the
 * host says they are ready, the host starts, and a table nobody starts starts
 * itself when its own clock runs out, so strangers are never held hostage by
 * an idle host. The rules the table rolled sit under the seats, the host can
 * change the ones the server allows, and everyone can talk.
 *
 * A server too old to run the lobby sends only the fuse; that table gets the
 * waiting room it always had, with nothing to press, because anything offered
 * there would come back refused.
 *
 * iOS's QuickMatchPanel and the web's quick lobby, in their order and their
 * words.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun QuickMatchPanel(store: GameStore, state: GameState, modifier: Modifier = Modifier) {
    val p = P.current
    val players = state.players
    val seats = maxOf(players.size, state.settings.maxPlayers)
    val lobby = state.quickLobby

    // One tick serves the whole panel. The deadlines are the server's, so
    // somebody who walks in late sees what is really left rather than a
    // fresh twenty.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(250)
        }
    }
    val left = state.quickSecondsLeft(now)

    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (lobby == null || lobby.isGathering) {
            // The table spends most of its search actually looking for people
            // and only the last few seconds filling the chairs nobody took.
            // Saying which is the difference between "nobody came" and a
            // table that quietly padded itself out while claiming to search.
            // Five seconds is the server's own bot window.
            Row(
                Modifier.padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                CircularProgressIndicator(Modifier.size(18.dp), color = p.red, strokeWidth = 2.dp)
                Text(
                    if ((left ?: 99) > 5) "Finding players…" else "Filling the table…",
                    color = p.ink, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold,
                )
            }
            if (left != null) Countdown(left, searching = lobby != null)
        } else {
            ReadyHeadline(lobby, left)
        }

        if (lobby != null) ReadyActions(store, state, lobby)

        SeatRow(store, state, seats)

        Text(
            "${players.size} of $seats seated",
            color = p.ink2, fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
        )

        RolledRules(state.quickRoll)

        if (lobby != null) {
            // One sheet for both: the host's has the rows the server lets
            // them change unlocked, everybody else's is the same sheet to
            // read. What a table plays by is never a secret from the people
            // about to play it.
            // The toolbox to change them, the scales to read them — iOS's
            // two pictures for the two buttons.
            MMButton(
                if (store.isHost) "Change rules" else "See all rules",
                Modifier.fillMaxWidth(),
                kind = BtnKind.GHOST, big = true, icon = if (store.isHost) "toolbox" else "scales",
            ) { store.openRules() }
            ChatWithTable(store)
        }

        TableTalkTicker(store)
    }
}

/**
 * The seconds left in the search, big and gold — the one element that says
 * the table is on its way whether or not anybody presses anything.
 *
 * `searching` is the Play-now lobby, where the number is the search and not
 * the kick-off: a server with no lobby only ever counted down to the deal.
 */
@Composable
private fun Countdown(left: Int, searching: Boolean) {
    val p = P.current
    val shape = RoundedCornerShape(16.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .background(p.card, shape)
            .border(1.dp, p.gold.copy(alpha = 0.5f), shape)
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        // Counting down, so each number drops in from above as the last one
        // falls away.
        AnimatedContent(
            targetState = left,
            transitionSpec = {
                val roll = tween<IntOffset>(200)
                (slideInVertically(roll) { h -> -h / 2 } + fadeIn(tween(200))) togetherWith
                    (slideOutVertically(roll) { h -> h / 2 } + fadeOut(tween(120))) using
                    SizeTransform(clip = false)
            },
            label = "kickoff",
        ) { n ->
            Text(
                if (n > 0) "$n" else "…",
                color = p.gold, fontSize = 42.sp, fontWeight = FontWeight.ExtraBold,
                style = LocalTextStyle.current.merge(TextStyle(fontFeatureSettings = "tnum")),
            )
        }
        // At nought the number has nothing left to say, so the caption says
        // what comes next — in iOS's and the web's words, capitals and all.
        Text(
            when {
                searching && left > 0 -> "SECONDS TO FIND PLAYERS"
                searching -> "STARTING THE READY ROUND"
                left > 0 -> "SECONDS TO KICK-OFF"
                else -> "DEALING YOU IN"
            },
            color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
        )
    }
}

/**
 * The ready phase's headline, in the card the countdown stood in: who the
 * table is waiting on, and when it stops waiting. The second line is what
 * makes the lobby safe to sit in with strangers — however long anybody
 * dawdles, the table starts by itself.
 */
@Composable
private fun ReadyHeadline(lobby: QuickLobby, left: Int?) {
    val p = P.current
    val shape = RoundedCornerShape(16.dp)
    val waiting = lobby.waitingCount
    // Nobody left to wait on reads as everyone ready even before the server
    // says Start is live, as iOS and the web read it: a chair being refilled
    // is the house's business, not somebody the table is waiting for.
    val all = lobby.canStart == true || waiting == 0
    Column(
        Modifier
            .fillMaxWidth()
            .background(p.card, shape)
            .border(1.dp, if (all) p.good.copy(alpha = 0.6f) else p.gold.copy(alpha = 0.5f), shape)
            .padding(horizontal = 14.dp, vertical = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (all) ReadyTick(20.dp, ring = false)
            Text(
                if (all) "Everyone's ready" else "Waiting for $waiting to get ready",
                color = p.ink, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold,
                textAlign = TextAlign.Center,
            )
        }
        if (left != null) {
            Text(
                if (left > 0) "Starts by itself in ${clockLabel(left)}" else "Dealing you in…",
                color = p.gold, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                style = LocalTextStyle.current.merge(TextStyle(fontFeatureSettings = "tnum")),
            )
        }
    }
}

/** 24 -> "0:24", 90 -> "1:30": the start window is a minute and a half at most. */
private fun clockLabel(seconds: Int): String = "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"

/**
 * What this seat can do about the table starting.
 *
 * The host gets Start, and it only goes live when the server says it would
 * be taken — never while the search is still running, never while somebody
 * is still reading the rules. Everybody else gets "I'm ready", and once they
 * are, the same button in green saying so; tapping it again takes it back,
 * for whoever wants a moment longer. A spectator has no seat to ready and
 * gets nothing. The buttons move only when the server's push says they have.
 */
@Composable
private fun ReadyActions(store: GameStore, state: GameState, lobby: QuickLobby) {
    val p = P.current
    val me = state.player(store.meId) ?: return
    if (store.isHost) {
        val live = lobby.startLive
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // MMButton never fades itself when it is off, as iOS's style does
            // not; the lobby wants the dead Start to look dead, so it says so.
            MMButton(
                "Start game",
                Modifier.fillMaxWidth().alpha(if (live) 1f else 0.45f),
                kind = BtnKind.PRIMARY, big = true, enabled = live,
                lead = { PlayTriangle(13.dp, it) },
            ) {
                store.start()
                Haptics.tap()
            }
            if (lobby.isGathering) {
                Text(
                    "You're the host. Start unlocks when the search ends.",
                    color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                    textAlign = TextAlign.Center,
                )
            }
        }
    } else if (me.isReady) {
        MMButton(
            "Ready",
            Modifier.fillMaxWidth(),
            kind = BtnKind.GOOD, big = true,
            lead = { ink -> SfMark("checkmark", 17.dp, ink) },
        ) {
            store.setReady(false)
            SoundKit.click()
            Haptics.tap()
        }
    } else {
        MMButton(
            "I'm ready",
            Modifier.fillMaxWidth(),
            kind = BtnKind.PRIMARY, big = true,
        ) {
            store.setReady(true)
            SoundKit.click()
            Haptics.tap()
        }
    }
}

/**
 * The table talk, one tap from the lobby. The chat key in the top bar still
 * does the same thing; this one is here because the lobby is when strangers
 * say hello, and the bar is a long way up from the Ready button.
 */
@Composable
private fun ChatWithTable(store: GameStore) {
    Box(Modifier.fillMaxWidth()) {
        MMButton(
            "Chat with the table",
            Modifier.fillMaxWidth(),
            kind = BtnKind.GHOST, big = true,
            lead = { ink -> SfMark("bubble.left.and.bubble.right.fill", 19.dp, ink) },
        ) {
            store.openChat()
            Haptics.tap()
        }
        UnreadBadge(store.unreadChat, Modifier.align(Alignment.TopEnd).offset(x = 4.dp, y = (-6).dp))
    }
}

/**
 * Who has landed, and the chairs still open. Faces arrive with a small pop,
 * so a table filling up looks like people sitting down — but the ones already
 * here when the panel opened simply are here.
 *
 * In the Play-now lobby the host wears a crown on the top-left shoulder of
 * their disc and everyone ready a green tick on the top-right — the bottom
 * right is the flag's. A chair somebody walked out of reads "finding…" while
 * the house is on its way to it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SeatRow(store: GameStore, state: GameState, seats: Int) {
    val p = P.current
    val players = state.players
    val lobby = state.quickLobby
    val present = remember { players.mapTo(HashSet()) { it.id } }
    // Wraps rather than running off the side: a six- or eight-seat table is
    // wider than a phone at this size.
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (player in players) {
            key(player.id) {
                val pop = remember { Animatable(if (player.id in present) 1f else 0f) }
                LaunchedEffect(Unit) {
                    pop.animateTo(1f, spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMediumLow))
                }
                val host = lobby != null && player.id == state.hostId
                val ready = lobby != null && !host && player.isReady
                val name = if (store.isLocal(player.id)) "You" else player.name
                SeatCell(
                    Modifier
                        .graphicsLayer {
                            scaleX = pop.value
                            scaleY = pop.value
                            alpha = pop.value.coerceIn(0f, 1f)
                        }
                        // The crown and the tick are drawings, so a screen
                        // reader is told in words what they say.
                        .semantics(mergeDescendants = true) {
                            if (host) stateDescription = "host"
                            else if (ready) stateDescription = "ready"
                        },
                    label = name,
                ) {
                    PlayerDisc(player, size = 38.dp, modifier = Modifier.align(Alignment.Center))
                    if (host) HostCrown(Modifier.align(Alignment.TopStart))
                    if (ready) ReadyTick(16.dp, ring = true, modifier = Modifier.align(Alignment.TopEnd))
                }
            }
        }
        val finding = lobby?.backfillAt != null
        repeat(maxOf(0, seats - players.size)) {
            SeatCell(label = if (finding) "finding…" else "open", faint = true) {
                Box(
                    Modifier
                        .size(38.dp)
                        .align(Alignment.Center)
                        .dashedBorder(p.rule2, width = 1.5.dp, cornerRadius = 19.dp, dash = 4.dp, gap = 3.dp),
                )
            }
        }
    }
}

/**
 * One chair: the face in a box a little bigger than the disc, so the host's
 * crown and the ready tick can sit on its shoulders without pushing the name
 * down — every chair's name stays on one line with the next one's.
 */
@Composable
private fun SeatCell(
    modifier: Modifier = Modifier,
    label: String,
    faint: Boolean = false,
    face: @Composable BoxScope.() -> Unit,
) {
    val p = P.current
    Column(
        modifier.width(54.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Box(Modifier.size(44.dp), content = face)
        Text(
            label,
            color = if (faint) p.ink3 else p.ink2,
            fontSize = 10.sp,
            fontWeight = if (faint) FontWeight.SemiBold else FontWeight.Bold,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * The host's mark: the drawn crown on a gold coin, ringed in the page so it
 * stands off the disc it sits on. The crown keeps its own gold whatever it
 * is handed, as the rank badge's does.
 */
@Composable
private fun HostCrown(modifier: Modifier = Modifier) {
    val p = P.current
    Box(
        modifier
            .size(18.dp)
            .clip(CircleShape)
            .background(p.goldSoft)
            .border(2.dp, p.page, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon("crown", size = 11.dp)
    }
}

/**
 * The green tick disc that says a seat is ready — white on the palette's
 * green, the pairing the Good button already wears. `ring` sets it off a face
 * it overlaps with a ring of the page.
 */
@Composable
private fun ReadyTick(size: Dp, ring: Boolean, modifier: Modifier = Modifier) {
    val p = P.current
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(p.good)
            .then(if (ring) Modifier.border(2.dp, p.page, CircleShape) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        SfMark("checkmark", size * 0.62f, Color.White)
    }
}

/**
 * What this table plays by: the board, the bankroll, and every house rule
 * that was rolled rather than assumed.
 *
 * Nobody at a matchmade table picked any of it, so it belongs on screen
 * before the dice start — not left to be worked out from the log once
 * somebody is already paying rent they did not expect. The phrases come
 * written from the server, the same words the web lobby and iOS show.
 *
 * Once the host has changed any of it the heading stops saying the table
 * rolled it and says a person did, and the chips they changed wear the
 * accent's ring, so nobody takes a rule somebody chose for the luck of the
 * draw.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RolledRules(roll: QuickRoll?) {
    val parts = roll?.parts.orEmpty()
    if (parts.isEmpty()) return
    val p = P.current
    val changed = roll?.edited.orEmpty().size
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 2.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon("dice", size = 14.dp, tint = p.ink3)
            Text(
                if (changed > 0) "THIS TABLE'S RULES · HOST CHANGED $changed" else "THIS TABLE ROLLED",
                color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
            )
        }
        // However many rules there are, on as many lines as they need.
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            parts.forEachIndexed { i, part ->
                // The board leads, and reads like it.
                val lead = i == 0
                val edited = roll?.isEdited(i) == true
                val shape = RoundedCornerShape(99.dp)
                Text(
                    part,
                    modifier = Modifier
                        .background(p.card, shape)
                        .border(
                            if (edited) 1.5.dp else 1.dp,
                            when {
                                edited -> p.red
                                lead -> p.gold.copy(alpha = 0.5f)
                                else -> p.rule
                            },
                            shape,
                        )
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                        // The ring is a colour, so a screen reader is told in
                        // words, as iOS's chip says it.
                        .semantics { if (edited) contentDescription = "$part, changed by the host" },
                    color = if (lead) p.gold else p.ink2,
                    fontSize = 11.5.sp, fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

/**
 * The waiting room's small talk: gameplay tips and city facts, dealt in turn
 * every eight seconds while the clock runs. The file is fetched once for the
 * app's life and shared by every lobby (the store holds it); a miss keeps the
 * old static sentence for this sitting and is not remembered as the answer.
 */
@Composable
private fun TableTalkTicker(store: GameStore) {
    val p = P.current
    var tips by remember { mutableStateOf(emptyList<String>()) }
    var facts by remember { mutableStateOf(emptyList<String>()) }
    var beat by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) {
        store.loadTableTalk()?.let { talk ->
            tips = talk.tips.shuffled()
            facts = talk.factLines.shuffled()
        }
        // Nothing arrived — the fallback line needs no rotation.
        if (tips.isEmpty() && facts.isEmpty()) return@LaunchedEffect
        while (true) {
            delay(8_000)
            beat++
        }
    }

    // Even beats deal a tip, odd beats a fact; either pile alone still cycles.
    val line = when {
        tips.isEmpty() && facts.isEmpty() -> TableTalk.FALLBACK
        facts.isEmpty() || (beat % 2 == 0 && tips.isNotEmpty()) -> tips[(beat / 2) % tips.size]
        else -> facts[(beat / 2) % facts.size]
    }
    Crossfade(targetState = line, animationSpec = tween(450), label = "tableTalk") { shown ->
        Text(
            shown,
            modifier = Modifier.fillMaxWidth(),
            color = p.ink3, fontSize = 12.5.sp, lineHeight = 17.sp, fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        )
    }
}
