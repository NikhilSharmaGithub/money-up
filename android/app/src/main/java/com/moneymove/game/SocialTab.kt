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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/**
 * Friends, and everybody else.
 *
 * A friend code is the whole identity system: six characters, hashed from a
 * token, no email and no phone number. It is at the top because reading yours
 * out is how somebody adds you, and adding somebody is what this screen is
 * for. The leaderboard is below it — the same names, further away.
 */
@Composable
fun SocialTab(account: AccountStore, game: GameStore, messaging: MessagingStore) {
    val p = P.current
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var talkingTo by remember { mutableStateOf<Friend?>(null) }
    var blocked by remember { mutableStateOf(false) }

    // The blocked list and this player's own code both come back here, and
    // both are things the chat depends on having.
    LaunchedEffect(Unit) {
        account.refreshSocial(onBlocked = game::applyBlocked, onMyCode = game::applyMyCode)
    }

    val social = account.social
    val mine = account.me?.code?.takeIf { it.isNotBlank() } ?: friendCode(game.token)

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Text("Social", color = p.ink, fontSize = 26.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(16.dp))

        Panel {
            SectionLabel("Your friend code", icon = "key")
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    mine,
                    color = p.red, fontSize = 26.sp, fontWeight = FontWeight.Black,
                    letterSpacing = 4.sp,
                )
                Spacer(Modifier.weight(1f))
                Chip("${social?.friends?.size ?: 0} friends", icon = "people")
            }
            Spacer(Modifier.height(6.dp))
            Hint("Read it out and they can add you. No email, no phone number.")
        }

        Spacer(Modifier.height(12.dp))

        Panel {
            SectionLabel("Add a friend")
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    BasicTextField(
                        value = code,
                        onValueChange = { code = it.uppercase().filter(Char::isLetterOrDigit).take(6) },
                        singleLine = true,
                        textStyle = TextStyle(
                            color = p.ink, fontSize = 18.sp,
                            fontWeight = FontWeight.Black, letterSpacing = 4.sp,
                        ),
                        cursorBrush = SolidColor(p.red),
                        decorationBox = { inner ->
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(p.sunken)
                                    .padding(horizontal = 14.dp, vertical = 12.dp),
                            ) {
                                if (code.isEmpty()) {
                                    Text(
                                        "ABC123", color = p.ink3, fontSize = 18.sp,
                                        fontWeight = FontWeight.Black, letterSpacing = 4.sp,
                                    )
                                }
                                inner()
                            }
                        },
                    )
                }
                Spacer(Modifier.width(8.dp))
                MMButton("Add", kind = BtnKind.PRIMARY, enabled = code.length == 6 && !busy) {
                    busy = true
                    account.addFriend(code) { busy = false; if (it == null) code = "" }
                }
            }
            account.notice?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = p.bad, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        social?.requests?.takeIf { it.isNotEmpty() }?.let { reqs ->
            Spacer(Modifier.height(12.dp))
            Panel {
                SectionLabel("Asking to be friends", icon = "people")
                Spacer(Modifier.height(8.dp))
                for (r in reqs) {
                    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                        NameDisc(r.name)
                        Spacer(Modifier.width(9.dp))
                        Text(r.name.ifBlank { r.code }, color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.weight(1f))
                        MMButton("Accept", kind = BtnKind.GOOD) { account.answerFriend(r.code, true) }
                        Spacer(Modifier.width(6.dp))
                        MMButton("No", kind = BtnKind.GHOST) { account.answerFriend(r.code, false) }
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        Panel {
            SectionLabel("Friends", icon = "people")
            Spacer(Modifier.height(8.dp))
            val friends = social?.friends.orEmpty()
            if (friends.isEmpty()) {
                Hint("Nobody yet. Swap codes with whoever you play with.")
            } else {
                for (f in friends) {
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        NameDisc(f.name)
                        Spacer(Modifier.width(9.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                f.name.ifBlank { f.code },
                                color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                            )
                            Hint(if (f.room != null) "At a table right now" else if (f.online) "Online" else f.code)
                        }
                        // A friend at a table is one tap from being played with,
                        // which is the only reason to keep a friends list.
                        MMButton("", kind = BtnKind.GHOST, icon = "chat") { talkingTo = f }
                        Spacer(Modifier.width(6.dp))
                        if (f.room != null) {
                            MMButton("Join", kind = BtnKind.PRIMARY) { game.connect(f.room) }
                        } else {
                            MMButton("Remove", kind = BtnKind.GHOST) { account.removeFriend(f.code) }
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        Panel {
            SectionLabel("Leaderboard", icon = "trophy")
            Spacer(Modifier.height(8.dp))
            if (account.leaderboard.isEmpty()) {
                Hint("Nobody has won a game yet today.")
            } else {
                for ((i, row) in account.leaderboard.take(12).withIndex()) {
                    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                        when (i) {
                            0 -> Icon("medalGold", size = 20.dp)
                            1 -> Icon("medalSilver", size = 20.dp)
                            2 -> Icon("medalBronze", size = 20.dp)
                            else -> Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
                                Text("${i + 1}", color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                        Spacer(Modifier.width(10.dp))
                        Text(
                            row.name.ifBlank { row.code },
                            color = if (row.code == mine) p.red else p.ink,
                            fontSize = 14.sp,
                            fontWeight = if (row.code == mine) FontWeight.Black else FontWeight.SemiBold,
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            "${row.wins}",
                            color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Black,
                        )
                        Spacer(Modifier.width(4.dp))
                        Text("wins", color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Panel {
            SectionLabel("Blocked", icon = "shield")
            Spacer(Modifier.height(6.dp))
            Hint("People whose lines you never see. Blocking is quiet — they are not told.")
            Spacer(Modifier.height(10.dp))
            MMButton("Who I have blocked", kind = BtnKind.GHOST, modifier = Modifier.fillMaxWidth()) {
                blocked = true
            }
        }

        Spacer(Modifier.height(28.dp))
    }

    talkingTo?.let { friend ->
        DMSheet(
            friend, messaging, account,
            onBlocked = { game.applyBlocked(game.blockedCodes + it) },
        ) { talkingTo = null }
    }
    if (blocked) {
        val safety = rememberSafety()
        val scope = rememberCoroutineScope()
        BlockedPlayersSheet(
            codes = game.blockedCodes,
            onUnblock = { code ->
                scope.launch {
                    // The answer carries the whole list, so the screen never
                    // has to guess what the server now thinks.
                    safety.unblock(code).blocked?.let(game::applyBlocked)
                }
            },
            onDismiss = { blocked = false },
        )
    }
}

/** A disc with an initial, for a person who is not at this table. */
@Composable
private fun NameDisc(name: String, size: androidx.compose.ui.unit.Dp = 30.dp) {
    val p = P.current
    Box(
        Modifier.size(size).clip(RoundedCornerShape(99.dp)).background(p.sunken),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            (name.firstOrNull() ?: '?').uppercase(),
            color = p.ink2, fontSize = (size.value * 0.42f).sp, fontWeight = FontWeight.Black,
        )
    }
}
