package com.moneymove.game

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * A table.
 *
 * The board, the seats around it, and the one panel that says what this
 * player may do next. A lobby is the same screen with the board sitting
 * undealt and the seats still filling up.
 */
@Composable
fun GameScreen(store: GameStore, account: AccountStore) {
    val p = P.current
    val state = store.state
    var tappedTile by remember { mutableStateOf<Int?>(null) }
    var chatOpen by remember { mutableStateOf(false) }
    var tradeOpen by remember { mutableStateOf(false) }
    var rulesOpen by remember { mutableStateOf(false) }
    var deedsOpen by remember { mutableStateOf(false) }
    var watching by remember { mutableStateOf(false) }
    var pieceOpen by remember { mutableStateOf(false) }

    // The board dealing itself out at kick-off, and coins flying to the
    // wallet when the earned watermark rises. Both are holders the screen
    // drives rather than things that watch the store themselves.
    val deck = rememberDeckIntro(store)
    val flight = remember { CoinFlight() }
    LaunchedEffect(account.wallet?.earned) { flight.note(account.wallet) }

    Box(Modifier.fillMaxSize().background(p.page)) {
        Column(
            Modifier
                .fillMaxSize()
                .padding(top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding())
                .verticalScroll(rememberScrollState()),
        ) {
            TableBar(
                store,
                onPiece = { pieceOpen = true },
                onDeeds = { deedsOpen = true },
                onRules = { rulesOpen = true },
            )

            if (state == null) {
                Box(Modifier.fillMaxWidth().height(320.dp), contentAlignment = Alignment.Center) {
                    Hint(
                        when (store.connection) {
                            GameStore.Connection.CONNECTING -> "Finding the table…"
                            GameStore.Connection.CONNECTED -> "Taking a seat…"
                            GameStore.Connection.DISCONNECTED -> "Reconnecting…"
                        }
                    )
                }
            } else {
                Seats(store, state)
                Spacer(Modifier.height(8.dp))
                AwaitingSeats(store, Modifier.padding(horizontal = 12.dp))
                Box(Modifier.padding(horizontal = 10.dp)) {
                    BoardView(store) { tappedTile = it }
                }
                Spacer(Modifier.height(10.dp))
                for (offer in state.trades.filter { it.to == store.meId && it.ignored != true }) {
                    TradeOfferCard(store, offer, Modifier.padding(horizontal = 12.dp))
                    Spacer(Modifier.height(10.dp))
                }
                ActionPanel(store, state, onTrade = { tradeOpen = true })
                Spacer(Modifier.height(10.dp))
                Feed(state)
            }
            Spacer(Modifier.height(
                WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 20.dp
            ))
        }

        // The deal-in sits over the board and nothing else; the coins fly to
        // the wallet chip, which is above everything.
        DeckIntroOverlay(deck)
        CoinFlightLayer(flight)

        CardPopup(store, Modifier.align(Alignment.Center))
        ReliefCardOverlay(store)
        TurnBanner(store, Modifier.align(Alignment.TopCenter))

        // Removed by the clock: the one thing that has happened, so it covers
        // everything until the player says they would rather watch.
        if (store.timedOut && !watching) {
            TimedOutOverlay(store, onWatch = { watching = true })
        }

        // A round button at thumb height, because the chat is the half of a
        // board game that is not the board — and a badge, because a game
        // where nobody notices the chat is a game where nobody uses it.
        ChatButton(
            store,
            Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 18.dp, bottom = 26.dp),
        ) { chatOpen = true }
    }

    tappedTile?.let { i ->
        DeedSheet(store, i) { tappedTile = null }
    }
    if (chatOpen) ChatSheet(store) { chatOpen = false }
    if (tradeOpen) TradeSheet(store) { tradeOpen = false }
    if (rulesOpen) LobbySheet(account, store) { rulesOpen = false }
    if (pieceOpen) PiecePicker(store, account) { pieceOpen = false }
    if (deedsOpen) {
        PropertiesSheet(
            store,
            onDismiss = { deedsOpen = false },
            onOpenTile = { deedsOpen = false; tappedTile = it },
        )
    }
    if (store.showGameOver) GameOverSheet(store) { store.showGameOver = false }
}

@Composable
private fun ChatButton(store: GameStore, modifier: Modifier = Modifier, onOpen: () -> Unit) {
    val p = P.current
    Box(modifier) {
        Box(
            Modifier
                .size(52.dp)
                .clip(RoundedCornerShape(99.dp))
                .background(p.card)
                .border(1.dp, p.rule2, RoundedCornerShape(99.dp))
                .clickable { onOpen() },
            contentAlignment = Alignment.Center,
        ) {
            Icon("chat", size = 22.dp, tint = p.ink2)
        }
        if (store.unreadChat > 0) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .size(20.dp)
                    .clip(RoundedCornerShape(99.dp))
                    .background(p.red),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (store.unreadChat > 9) "9+" else store.unreadChat.toString(),
                    color = p.accentInk, fontSize = 10.sp, fontWeight = FontWeight.Black,
                )
            }
        }
    }
}

/** The strip at the top: who you are at this table, and the way out. */
@Composable
private fun TableBar(
    store: GameStore,
    onPiece: () -> Unit,
    onDeeds: () -> Unit,
    onRules: () -> Unit,
) {
    val p = P.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon("dice", size = 19.dp, tint = p.red)
        Spacer(Modifier.width(8.dp))
        // One line each, and allowed to shrink. Four icon buttons and a money
        // chip left the title about forty points wide, and "Random / Room
        // 27A6A" came out as five stacked lines that pushed the board down
        // the screen.
        Column(Modifier.weight(1f)) {
            Text(
                store.state?.map?.name ?: "MoneyMove",
                color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            store.roomId?.let {
                Text(
                    "Room ${it.uppercase()}",
                    color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.Medium,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        store.me?.let { me ->
            Chip(money(me.money), icon = "cash", tint = if (me.inDebt) p.bad else p.good)
            Spacer(Modifier.width(6.dp))
        }
        IconTap("palette", onPiece)
        IconTap("bank", onDeeds)
        IconTap("scales", onRules)
        Spacer(Modifier.width(4.dp))
        MMButton("Leave", kind = BtnKind.GHOST) { store.leave() }
    }
}

/**
 * A bare icon in the table bar.
 *
 * MMButton's minimum height and horizontal padding are sized for a label; put
 * four of them side by side with nothing in them and they eat the title.
 */
@Composable
private fun IconTap(glyph: String, onClick: () -> Unit) {
    val p = P.current
    Box(
        Modifier
            .size(38.dp)
            .clip(RoundedCornerShape(11.dp))
            .border(1.dp, p.rule2, RoundedCornerShape(11.dp))
            .clickable { SoundKit.click(); onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(glyph, size = 18.dp, tint = p.ink2)
    }
}

/** Everyone at the table, in turn order, as a row of chips. */
@Composable
private fun Seats(store: GameStore, state: GameState) {
    val p = P.current
    LazyRow(
        Modifier.fillMaxWidth(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(state.players.size) { i ->
            val player = state.players[i]
            val isTurn = state.turn?.playerId == player.id && state.isPlaying
            Row(
                Modifier
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (isTurn) p.sunken else Color.Transparent)
                    .border(1.dp, if (isTurn) p.red else p.rule, RoundedCornerShape(14.dp))
                    .padding(horizontal = 9.dp, vertical = 7.dp)
                    .widthIn(min = 96.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PlayerDisc(player, size = 26.dp)
                Spacer(Modifier.width(7.dp))
                Column {
                    Text(
                        player.name,
                        color = if (player.isBankrupt) p.ink3 else p.ink,
                        fontSize = 12.5.sp, fontWeight = FontWeight.Bold, maxLines = 1,
                    )
                    Text(
                        if (player.isBankrupt) "out" else money(player.money),
                        color = when {
                            player.isBankrupt -> p.ink3
                            player.inDebt -> p.bad
                            else -> p.ink2
                        },
                        fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
                    )
                }
                if (player.inJail) {
                    Spacer(Modifier.width(5.dp))
                    Icon("prison", size = 13.dp, tint = p.ink3)
                }
            }
        }
    }
}

/** The table's own running commentary — the last few lines, newest last. */
@Composable
private fun Feed(state: GameState) {
    val p = P.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        SectionLabel("Table log")
        Spacer(Modifier.height(6.dp))
        for (line in state.log.takeLast(7)) {
            Text(
                line.text,
                color = when (line.kind) {
                    "money" -> p.good
                    "warn", "bankrupt" -> p.bad
                    "turn" -> p.ink
                    else -> p.ink2
                },
                fontSize = 12.5.sp,
                lineHeight = 18.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(vertical = 1.dp),
            )
        }
    }
}

/**
 * The drawn card.
 *
 * Good news or bad, carried in the colour, because the colour is read a
 * second before the words are. Cards that genuinely cut both ways — advance
 * to the priciest street, a windfall if you own it and a rent bill if you do
 * not — keep the deck's own colours rather than promise what they cannot know.
 */
@Composable
private fun CardPopup(store: GameStore, modifier: Modifier = Modifier) {
    val p = P.current
    val card = store.cardPopup
    AnimatedVisibility(
        visible = card != null,
        enter = fadeIn() + scaleIn(initialScale = 0.75f),
        exit = fadeOut(),
        modifier = modifier,
    ) {
        card ?: return@AnimatedVisibility
        val treasure = card.deck == "treasure"
        val accent = when (card.tone) {
            "good" -> p.good
            "bad" -> p.bad
            else -> if (treasure) p.gold else p.red
        }
        val face = when (card.tone) {
            "good" -> p.goodSoft
            "bad" -> p.badSoft
            else -> if (treasure) p.tileTreasure else p.tileSurprise
        }
        Column(
            Modifier
                .padding(horizontal = 36.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(face)
                .border(2.dp, accent, RoundedCornerShape(20.dp))
                .clickable { store.cardPopup = null }
                .padding(26.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(if (treasure) "toolbox" else "question", size = 44.dp, tint = accent)
            Spacer(Modifier.height(10.dp))
            Text(
                if (treasure) "TREASURE" else "SURPRISE",
                color = if (card.tone == "good" || card.tone == "bad") accent else p.ink3,
                fontSize = 11.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(9.dp))
            Text(
                card.text,
                color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center, lineHeight = 23.sp,
            )
        }
    }
}

/** Whose turn it is, said once as the hands change. */
@Composable
private fun TurnBanner(store: GameStore, modifier: Modifier = Modifier) {
    val p = P.current
    val who = store.turnBanner
    AnimatedVisibility(
        visible = who != null, enter = fadeIn(), exit = fadeOut(), modifier = modifier,
    ) {
        who ?: return@AnimatedVisibility
        Row(
            // Clear of the seat strip: the banner is news about the table, not
            // a label on the chip it was landing across.
            Modifier
                .padding(top = 118.dp)
                .clip(RoundedCornerShape(99.dp))
                .background(p.card)
                .border(2.dp, cssColor(who.color, p.red), RoundedCornerShape(99.dp))
                .padding(horizontal = 16.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PlayerDisc(who, size = 22.dp)
            Spacer(Modifier.width(8.dp))
            Text(
                if (who.id == store.meId) "Your turn" else "${who.name}'s turn",
                color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
            )
        }
    }
}
