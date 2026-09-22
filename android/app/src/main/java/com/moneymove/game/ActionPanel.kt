package com.moneymove.game

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The one panel that says what this player may do next.
 *
 * It answers a single question — what happens if I touch the screen right
 * now — and it only ever offers what the server would actually accept. A
 * button that comes back refused is worse than no button.
 */
@Composable
fun ActionPanel(store: GameStore, state: GameState) {
    val p = P.current
    val me = store.me

    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        when {
            state.isLobby -> LobbyPanel(store, state)

            state.isEnded -> Panel {
                SectionLabel("Game over", icon = "trophy")
                Spacer(Modifier.height(8.dp))
                Text(
                    state.winner?.let { "${it.name} wins" } ?: "That's the game",
                    color = p.ink, fontSize = 18.sp, fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(10.dp))
                Row {
                    MMButton("Rematch", kind = BtnKind.PRIMARY, modifier = Modifier.weight(1f)) {
                        store.rematch()
                    }
                    Spacer(Modifier.width(8.dp))
                    MMButton("Leave", kind = BtnKind.GHOST, modifier = Modifier.weight(1f)) {
                        store.leave()
                    }
                }
            }

            !store.isMyTurn -> Panel {
                val who = store.currentPlayer
                SectionLabel("Waiting")
                Spacer(Modifier.height(6.dp))
                Text(
                    who?.let { "${it.name} is playing" } ?: "Waiting for the table",
                    color = p.ink2, fontSize = 14.sp, fontWeight = FontWeight.Medium,
                )
            }

            else -> Panel { TurnActions(store, state, me) }
        }
    }
}

@Composable
private fun ColumnScopeAlias.TurnActions(store: GameStore, state: GameState, me: PlayerState?) {
    val p = P.current
    val turn = state.turn ?: return

    when (turn.phase) {
        "roll" -> if (me?.inJail == true) {
            MMButton(
                "Roll for a double", kind = BtnKind.PRIMARY, big = true, icon = "dice",
                modifier = Modifier.fillMaxWidth(),
            ) { store.roll() }
            Spacer(Modifier.height(8.dp))
            Row {
                MMButton(
                    "Pay $50 & wait", kind = BtnKind.GHOST,
                    modifier = Modifier.weight(1f), enabled = me.money >= 50,
                ) { store.jailPay() }
                if ((me.getOutCards ?: 0) > 0) {
                    Spacer(Modifier.width(8.dp))
                    MMButton("Use card", kind = BtnKind.GOLD, icon = "ticket",
                        modifier = Modifier.weight(1f)) { store.jailCard() }
                }
            }
            Spacer(Modifier.height(8.dp))
            Hint("In prison · attempt ${(me.jailTurns ?: 0) + 1} of 3")
            // The fine buys the door and nothing else, so the panel says so
            // before it is pressed — a player who expects to roll afterwards
            // has spent $50 on a turn they were losing anyway.
            Hint("Paying the fine ends your turn — the card lets you roll.")
        } else {
            MMButton(
                "Roll dice", kind = BtnKind.PRIMARY, big = true, icon = "dice",
                modifier = Modifier.fillMaxWidth(),
            ) { store.roll() }
            if ((turn.doubles ?: 0) > 0) {
                Spacer(Modifier.height(8.dp))
                Hint("Double! Free roll (${turn.doubles} of 2)")
            }
        }

        "action" -> {
            val tile = turn.pending?.tile?.let { store.tile(it) }
            val price = tile?.price ?: 0
            SectionLabel(tile?.name ?: "This street")
            Spacer(Modifier.height(8.dp))
            MMButton(
                "Buy for ${money(price)}", kind = BtnKind.GOOD, big = true,
                modifier = Modifier.fillMaxWidth(),
                enabled = (me?.money ?: 0) >= price,
            ) { store.buy() }
            Spacer(Modifier.height(8.dp))
            MMButton(
                if (state.settings.auction == true) "Send to auction" else "Skip",
                kind = BtnKind.GHOST, modifier = Modifier.fillMaxWidth(),
                icon = if (state.settings.auction == true) "gavel" else null,
            ) { store.skipBuy() }
            if ((me?.money ?: 0) < price) {
                Spacer(Modifier.height(8.dp))
                Hint("Not enough cash for this one.")
            }
        }

        "auction" -> {
            val a = state.auction
            SectionLabel("Auction", icon = "gavel")
            Spacer(Modifier.height(6.dp))
            Text(
                "${store.tile(a?.tile ?: 0)?.name ?: "Street"} · ${money(a?.bid ?: 0)}",
                color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(10.dp))
            Row {
                for (step in listOf(10, 50, 100)) {
                    MMButton("+${money(step)}", kind = BtnKind.GOLD, modifier = Modifier.weight(1f)) {
                        store.bid((a?.bid ?: 0) + step)
                    }
                    Spacer(Modifier.width(6.dp))
                }
                MMButton("Pass", kind = BtnKind.GHOST, modifier = Modifier.weight(1f)) {
                    store.passBid()
                }
            }
        }

        "debt" -> {
            SectionLabel("In the red", icon = "warning")
            Spacer(Modifier.height(6.dp))
            Text(
                "You owe ${money(-(me?.money ?: 0))} to ${state.debtPayee(turn.debt)}.",
                color = p.bad, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(10.dp))
            MMButton("Pay what I can", kind = BtnKind.PRIMARY, modifier = Modifier.fillMaxWidth()) {
                store.payDebt()
            }
            Spacer(Modifier.height(8.dp))
            MMButton("Declare bankrupt", kind = BtnKind.DANGER, modifier = Modifier.fillMaxWidth()) {
                store.declareBankrupt()
            }
        }

        else -> {
            MMButton(
                "End turn", kind = BtnKind.PRIMARY, big = true,
                modifier = Modifier.fillMaxWidth(),
            ) { store.endTurn() }
            Spacer(Modifier.height(8.dp))
            Hint("Build, mortgage or trade before you finish.")
        }
    }
}

/** A table that has not started: who is here, and the one button that starts it. */
@Composable
private fun LobbyPanel(store: GameStore, state: GameState) {
    val p = P.current
    Panel {
        SectionLabel("Waiting to start", icon = "people")
        Spacer(Modifier.height(8.dp))
        Text(
            "${state.players.size} of ${state.settings.maxPlayers} seats taken",
            color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(4.dp))
        store.roomId?.let { Hint("Share the code ${it.uppercase()} and they land straight at this table.") }
        Spacer(Modifier.height(12.dp))
        if (store.isHost) {
            Row {
                MMButton(
                    "Start game", kind = BtnKind.PRIMARY, big = true,
                    modifier = Modifier.weight(1f),
                    enabled = state.players.size >= 2,
                ) { store.start() }
                Spacer(Modifier.width(8.dp))
                MMButton("Add a bot", kind = BtnKind.GHOST, icon = "robot") { store.addBot() }
            }
            if (state.players.size < 2) {
                Spacer(Modifier.height(8.dp))
                Hint("A game needs two. Add a bot, or send somebody the code.")
            }
        } else {
            Hint("The host starts the game.")
        }
    }
}
