package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

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
fun StoreTab(store: AccountStore) {
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
        if (store.store == null) {
            Hint("Opening the shop…")
        } else if (kind == "board") {
            BoardShelf(store, items, owned)
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
 * A board is not a skin: buying one unlocks it for good, and renting one buys
 * a single game on it. Two free boards rotate every day, which is why a board
 * a player cannot buy today is still one they can play today.
 */
@Composable
private fun BoardShelf(store: AccountStore, items: List<StoreItem>, owned: Set<String>) {
    val p = P.current
    val listing = store.boards
    val free = listing?.free.orEmpty().toSet()
    val byMap = listing?.boards.orEmpty().associateBy { it.id }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (free.isNotEmpty()) {
            Panel {
                SectionLabel("Free today", icon = "sparkle")
                Spacer(Modifier.height(6.dp))
                Hint(free.mapNotNull { byMap[it]?.name }.joinToString(" · "))
            }
        }
        for (item in items) {
            val have = item.id in owned
            val board = item.mapId?.let { byMap[it] }
            val freeNow = item.mapId in free
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(p.card)
                    .border(1.dp, p.rule, RoundedCornerShape(14.dp))
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(item.emoji, fontSize = 26.sp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(item.name, color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.Bold)
                    board?.let {
                        Hint("${it.size} tiles · ${it.streets} streets · ${it.countries} countries")
                    }
                }
                Spacer(Modifier.width(10.dp))
                when {
                    have -> Chip("owned", tint = p.good)
                    freeNow -> Chip("free today", tint = p.red)
                    else -> MMButton("${item.price}", kind = BtnKind.GOLD, icon = "coin") {
                        store.buy(item)
                    }
                }
            }
        }
        listing?.let {
            Hint("Or rent any board for ${it.rent} coin — one game, on that table.")
        }
    }
}
