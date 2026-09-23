package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * What this player has done.
 *
 * Three numbers and a shelf of badges. The numbers are the ones a person
 * actually asks about themselves — how many have I won, how much have I taken
 * off people, how long have I been playing — and the badges are the answer to
 * the fourth: what am I like at this game.
 */
@Composable
fun HistoryTab(account: AccountStore, game: GameStore) {
    val p = P.current
    LaunchedEffect(Unit) { account.refreshHistory() }
    val a = account.achievements

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Text("History", color = p.ink, fontSize = 26.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(16.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Stat("Wins", "${a?.wins ?: 0}", "trophy", Modifier.weight(1f))
            Stat("Won", money(a?.winnings ?: 0), "cash", Modifier.weight(1f))
            Stat("Turns", "${a?.turnsPlayed ?: 0}", "dice", Modifier.weight(1f))
        }

        Spacer(Modifier.height(14.dp))
        Panel {
            SectionLabel("Badges", icon = "medalGold")
            Spacer(Modifier.height(8.dp))
            val titles = a?.titles.orEmpty().entries.sortedByDescending { it.value }
            if (titles.isEmpty()) {
                Hint("None yet. They are handed out at the end of a game — for the biggest rent, the most doubles, the longest stretch in front.")
            } else {
                for ((name, times) in titles) {
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon("medalGold", size = 18.dp)
                        Spacer(Modifier.width(9.dp))
                        Text(
                            name,
                            color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                        )
                        Spacer(Modifier.weight(1f))
                        if (times > 1) Chip("×$times", tint = p.gold)
                    }
                }
            }
        }

        Spacer(Modifier.height(14.dp))
        Panel {
            SectionLabel("Last table", icon = "door")
            Spacer(Modifier.height(8.dp))
            val room = game.prefs.lastRoom
            if (room.isBlank()) {
                Hint("You have not sat down anywhere yet.")
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "Room ${room.uppercase()}",
                            color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                        )
                        Hint("The table holds your seat while you are away.")
                    }
                    MMButton("Open", kind = BtnKind.GHOST) { game.connect(room) }
                }
            }
        }

        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun Stat(label: String, value: String, icon: String, modifier: Modifier = Modifier) {
    val p = P.current
    Column(
        modifier
            .clip(RoundedCornerShape(16.dp))
            .background(p.card)
            .border(1.dp, p.rule, RoundedCornerShape(16.dp))
            .padding(vertical = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, size = 20.dp, tint = p.red)
        Spacer(Modifier.height(7.dp))
        Text(value, color = p.ink, fontSize = 19.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(2.dp))
        Text(
            label.uppercase(),
            color = p.ink3, fontSize = 10.sp, letterSpacing = 1.4.sp, fontWeight = FontWeight.Bold,
        )
    }
}
