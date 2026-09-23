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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

/**
 * The shop.
 *
 * Everything here is style. Coins buy a piece to push round the board, a face
 * for the chip beside your name, and a game on a board somebody else paid to
 * make — never an advantage, because a board game you can buy your way
 * through is not a board game anybody wants to lose at fairly.
 *
 * That is said out loud at the top rather than left to be discovered, because
 * it is the single thing a player wants to know before they read a price.
 */
@Composable
fun StoreTab(store: AccountStore, billing: Billing) {
    val p = P.current
    var kind by remember { mutableStateOf("token") }


    LaunchedEffect(Unit) { store.refreshStore() }

    val owned = store.wallet?.owned.orEmpty().toSet()
    val worn = store.wallet?.equipped.orEmpty()
    val items = store.store?.items.orEmpty().filter { it.kind == kind }

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Store", color = p.ink, fontSize = 26.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.weight(1f))
            CoinChip(store.coins)
        }
        Spacer(Modifier.height(4.dp))
        Hint("Win games, earn coins, dress your piece. Everything here is pure style — never pay-to-win.")

        Spacer(Modifier.height(16.dp))
        CoinWays(store)

        // Only when the server says there is one. An offer that cannot be
        // taken is worse than no offer.
        Spacer(Modifier.height(10.dp))
        AdOfferRow(store, "freeCoins") { store.watchAd("freeCoins") }

        // Coin packs: the one thing in this app that costs real money.
        Spacer(Modifier.height(12.dp))
        CoinPacks(store, billing)

        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((id, label) in listOf("token" to "Pieces", "avatar" to "Faces", "board" to "Boards")) {
                MMButton(
                    label,
                    kind = if (kind == id) BtnKind.PRIMARY else BtnKind.GHOST,
                    modifier = Modifier.weight(1f),
                ) { kind = id }
            }
        }

        Spacer(Modifier.height(14.dp))
        // The boards are asked for separately and answered separately, so the
        // shelf is not made to wait on the catalogue the pieces come out of.
        if (kind == "board") {
            BoardShelf(store)
        } else if (store.store == null) {
            Hint("Opening the shop…")
        } else {
            Shelf(store, items, owned, worn[kind])
        }

        store.notice?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = p.bad, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(28.dp))
    }

    // The ad itself covers everything, because that is what an ad does. The
    // store asked for it and is waiting on the gate; this completes it.
    store.adRequest?.let { gate ->
        // Five seconds, because the server will not settle a claim that
        // arrives less than three after the ticket was cut — a view nobody
        // could have watched is the one thing it can refuse on its own.
        HouseAdOverlay(seconds = 5) { played -> gate.complete(played) }
    }
}

/**
 * The coin packs, straight off Play.
 *
 * Prices come from Play rather than from this app, because a price written
 * here would be wrong in every country but one — Play knows what this player
 * actually pays and in which currency.
 */
@Composable
private fun CoinPacks(store: AccountStore, billing: Billing) {
    val p = P.current
    val activity = androidx.compose.ui.platform.LocalContext.current as? android.app.Activity
    LaunchedEffect(Unit) { billing.start(store) }
    Panel {
        SectionLabel("Coin packs", icon = "bag")
        Spacer(Modifier.height(10.dp))
        for (pack in billing.offers) {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon("coin", size = 20.dp)
                Spacer(Modifier.width(11.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        pack.name,
                        color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.Bold,
                    )
                    Hint("${pack.coins} coins")
                }
                // No price until Play has answered, because a price written
                // here would be wrong in every country but one.
                MMButton(
                    pack.price ?: "…", kind = BtnKind.GOLD,
                    enabled = activity != null && pack.price != null
                        && billing.onSale && billing.buying == null,
                ) { activity?.let { billing.buy(it, pack.packId) } }
            }
        }
        billing.notice?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = p.bad, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun CoinChip(coins: Int) {
    val p = P.current
    Row(
        Modifier
            .clip(RoundedCornerShape(99.dp))
            .background(p.goldSoft)
            .border(1.dp, p.gold, RoundedCornerShape(99.dp))
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon("coin", size = 16.dp)
        Spacer(Modifier.width(7.dp))
        Text("$coins", color = p.gold, fontSize = 15.sp, fontWeight = FontWeight.Black)
    }
}

/** The two ways to get coins that cost nothing: the daily, and winning. */
@Composable
private fun CoinWays(store: AccountStore) {
    val p = P.current
    val daily = store.daily
    Panel {
        SectionLabel("Get coins", icon = "coin")
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    "Daily reward",
                    color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                )
                Hint(
                    when {
                        daily == null -> "Checking…"
                        !daily.signedIn -> "Sign in and it is yours every day."
                        daily.claimable -> "${daily.amount} coin${if (daily.amount == 1) "" else "s"} waiting" +
                            if (daily.streak > 1) " · ${daily.streak}-day streak" else ""
                        else -> "Collected. Come back tomorrow."
                    }
                )
            }
            Spacer(Modifier.width(10.dp))
            MMButton(
                if (daily?.claimable == true) "Collect" else "Collected",
                kind = if (daily?.claimable == true) BtnKind.GOLD else BtnKind.GHOST,
                enabled = daily?.claimable == true,
            ) { store.claimDaily() }
        }
        Spacer(Modifier.height(10.dp))
        Rule()
        Spacer(Modifier.height(10.dp))
        Hint("Every game you win pays a couple more. Coins are earned at the table first.")
    }
}

/** Pieces and faces: a grid of things to wear. */
@Composable
private fun Shelf(store: AccountStore, items: List<StoreItem>, owned: Set<String>, worn: String?) {
    val p = P.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (row in items.chunked(3)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (item in row) {
                    val have = item.id in owned
                    val on = item.id == worn
                    Column(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(14.dp))
                            .background(p.card)
                            .border(
                                if (on) 2.dp else 1.dp,
                                if (on) p.red else p.rule,
                                RoundedCornerShape(14.dp),
                            )
                            .clickable {
                                if (have) store.equip(item) else store.buy(item)
                            }
                            .padding(vertical = 12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(item.emoji, fontSize = 30.sp)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            item.name,
                            color = p.ink, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center, maxLines = 1,
                        )
                        Spacer(Modifier.height(4.dp))
                        if (on) {
                            Chip("worn", tint = p.red)
                        } else if (have) {
                            Chip("owned", tint = p.good)
                        } else {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon("coin", size = 12.dp)
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    "${item.price}",
                                    color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

/**
 * Boards.
 *
 * A shelf of its own rather than another row of [Shelf], because a board is
 * not a piece: it is bought on the strength of the drawing, so the card
 * carries the board itself rather than an emoji — and it says out loud when
 * one is free today. The shop's job is to sell a board, not to sell somebody
 * a board they could have had for nothing this afternoon.
 *
 * Two taps rather than one. A piece costs a few wins' worth of coins and buys
 * on the tap; the dearest board here is twelve hundred, which is a whole coin
 * pack, so the first tap only opens the price. iOS spends a whole sheet on
 * that second tap — this does it in the room the card already has.
 */
@Composable
private fun BoardShelf(store: AccountStore) {
    val listing = store.boards
    // Which card has been asked its price, and which one is in flight.
    var asking by remember { mutableStateOf<String?>(null) }
    var buying by remember { mutableStateOf<String?>(null) }

    // A phone that slept through midnight wakes holding yesterday's shelf:
    // yesterday's free pair, yesterday's sale — and a tap on a price that has
    // already turned over comes back refused by the server's `expect` check,
    // which is a rude way to learn the day changed. The lobby notices for
    // itself, because the countdown it draws runs out in front of the player.
    // This shelf has no clock, so it asks again on the way back in.
    //
    // Deliberately above the early return: an effect below it would be added
    // and thrown away again as the boards land, and the one moment it has to
    // survive is the app being away.
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner, store) {
        val watch = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) store.rolloverIfDue()
        }
        owner.lifecycle.addObserver(watch)
        onDispose { owner.lifecycle.removeObserver(watch) }
    }

    if (listing == null || listing.boards.isEmpty()) {
        // Its own fetch, arriving at its own speed: the pieces are a catalogue
        // anyone may read, and this is an answer about this wallet on this day.
        Hint("Laying the boards out…")
        return
    }

    // The shelf carries the wallet's own count, and that is the one to read
    // when /api/wallet has quietly failed. A player holding nine hundred coins
    // being told they need five hundred more is the bug this fixes.
    val coins = if (store.wallet != null) store.coins else listing.coins

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Hint(
            "Classic is free forever and two more every day. Three are on sale, " +
                "and the shelf is redealt every morning.",
        )
        for (row in listing.boards.chunked(2)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (board in row) {
                    BoardCard(
                        board = board,
                        coins = coins,
                        asking = board.id == asking,
                        busy = board.id == buying,
                        modifier = Modifier.weight(1f),
                        onAsk = {
                            SoundKit.click()
                            asking = if (asking == board.id) null else board.id
                        },
                        onBuy = {
                            buying = board.id
                            // A price that turned over while the card sat open
                            // is refused by the server on `expect` rather than
                            // quietly charged, and the shelf is re-fetched
                            // either way — so there is nothing to guard here.
                            store.buyBoard(board) { error ->
                                buying = null
                                if (error == null) {
                                    SoundKit.buy()
                                    asking = null
                                }
                            }
                        },
                    )
                }
                repeat(2 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
        // Renting needs a table to rent at, and the shop has no table — so
        // this says the offer exists and where it lives, rather than showing a
        // coin button that could only come back refused.
        Hint(
            if (listing.rent.holding != null) {
                "You are holding a game you paid for and never played. Rent any board and " +
                    "the same game moves there — nothing more to pay."
            } else {
                "Or rent a locked board for ${listing.rent.price} coin — one game, at one " +
                    "table. That offer is in the lobby, where the table is."
            },
        )
    }
}

/**
 * One board on the shelf.
 *
 * The drawing first and the price last, in that order, because the drawing is
 * the thing being sold: nineteen boards answer to the same handful of glyphs,
 * and a card that leads with a name and an emoji cannot tell Bharat from
 * Canada — which is exactly what this shop was doing.
 */
@Composable
private fun BoardCard(
    board: BoardListing,
    coins: Int,
    asking: Boolean,
    busy: Boolean,
    modifier: Modifier = Modifier,
    onAsk: () -> Unit,
    onBuy: () -> Unit,
) {
    val p = P.current
    // Free forever, or already paid for. Either way there is nothing to sell.
    val yours = board.how == "house" || board.how == "owned"
    val was = board.was
    val short = (board.price - coins).coerceAtLeast(0)
    val shape = RoundedCornerShape(15.dp)

    Column(
        modifier
            .clip(shape)
            .background(p.card)
            .border(if (asking) 2.dp else 1.dp, if (asking) p.gold else p.rule, shape)
            .clickable(enabled = !yours) { onAsk() }
            .padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.fillMaxWidth()) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(p.page)
                    .padding(4.dp),
                contentAlignment = Alignment.Center,
            ) {
                // A locked board is drawn faint, the way iOS dims it: plainly
                // a board, plainly not one of yours yet. `dim` fades the tile
                // colours themselves rather than the whole drawing, so the
                // page-coloured well behind it keeps its own weight.
                //
                // The board overload, not the preview one: a server too old to
                // send a preview leaves the board wearing its own glyph rather
                // than a hole, and that fallback belongs beside the drawing
                // instead of being written out again in every shelf.
                MiniBoard(board, dim = board.how == "locked")
            }
            val badge = Modifier.align(Alignment.TopEnd).padding(5.dp)
            if (board.how == "today") {
                BoardBadge("FREE TODAY", p.good, Color.White, badge)
            } else if (was != null && was > 0) {
                // Worked out from the two numbers on this card rather than from
                // the headline rate: prices round to the nearest 25, so a flat
                // "30% OFF" was wrong on six of the seven price points.
                val off = ((1 - board.price.toDouble() / was) * 100).toInt()
                BoardBadge("$off% OFF", p.gold, p.accentInk, badge)
            }
        }

        Spacer(Modifier.height(7.dp))
        // Two cards to a row, so a board's name gets half a phone to say
        // itself in — and "The Great White North" does not fit in it at this
        // weight. Shrink it a fifth rather than cut it: a name clipped to
        // "The Great White N…" is the one thing on this card that cannot be
        // guessed from the drawing above it. iOS shrinks by the same fifth.
        FitText(
            board.name,
            color = p.ink, fontSize = 12.5.sp, fontWeight = FontWeight.Black,
            textAlign = TextAlign.Center, minScale = 0.8f,
        )
        Spacer(Modifier.height(2.dp))
        // Two lines, always. Half a city name sells nothing — "New York City ·
        // Boston · San Fra…" — and a card a line taller than the one beside it
        // leaves the row ragged, so the space is kept whether it is filled or
        // not.
        Text(
            board.teaser,
            color = p.ink3, fontSize = 9.5.sp, fontWeight = FontWeight.SemiBold,
            lineHeight = 12.sp, textAlign = TextAlign.Center, maxLines = 2, minLines = 2,
        )
        Spacer(Modifier.height(7.dp))

        if (asking) {
            MMButton(
                when {
                    busy -> "Unlocking…"
                    short > 0 -> "$short more coins needed"
                    else -> "Unlock for ${board.price}"
                },
                kind = if (short > 0) BtnKind.GHOST else BtnKind.GOLD,
                icon = if (short > 0) null else "coin",
                enabled = !busy && short == 0,
                modifier = Modifier.fillMaxWidth(),
            ) { onBuy() }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (!yours) {
                    Icon("coin", size = 12.dp)
                    Spacer(Modifier.width(4.dp))
                }
                // The old price, struck through, and only while there really is
                // an old one: a "was" that matches the price is the oldest lie
                // in retail, which is why the server sends it only when true.
                if (was != null && !yours) {
                    Text(
                        "$was",
                        color = p.ink3, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                        textDecoration = TextDecoration.LineThrough,
                    )
                    Spacer(Modifier.width(4.dp))
                }
                Text(
                    when {
                        board.how == "house" -> "Always free"
                        yours -> "✓ Yours"
                        else -> "${board.price}"
                    },
                    color = if (yours) p.ink3 else p.gold,
                    fontSize = 10.5.sp, fontWeight = FontWeight.Black,
                )
            }
        }
    }
}

/** What a card says out loud about itself — and it never says two things. */
@Composable
private fun BoardBadge(text: String, bg: Color, fg: Color, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier
            .clip(RoundedCornerShape(99.dp))
            .background(bg)
            .padding(horizontal = 6.dp, vertical = 2.5.dp),
        color = fg,
        fontSize = 8.5.sp,
        letterSpacing = 0.4.sp,
        fontWeight = FontWeight.Black,
    )
}
