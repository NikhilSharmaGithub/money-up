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
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
 * The table styles, the light switch, and the few facts about this device
 * worth showing a player who has gone looking for them.
 */
@Composable
fun SettingsTab(
    store: GameStore,
    account: AccountStore,
    onTheme: (MMTheme) -> Unit,
    onAppearance: (MMAppearance) -> Unit,
) {
    val p = P.current
    var theme by remember { mutableStateOf(store.prefs.theme) }
    var appearance by remember { mutableStateOf(store.prefs.appearance) }
    var sound by remember { mutableStateOf(store.prefs.soundOn) }

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Text("Settings", color = p.ink, fontSize = 26.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(16.dp))

        Panel {
            SectionLabel("Table style", icon = "palette")
            Spacer(Modifier.height(4.dp))
            Hint("Seven tables, each with its own daytime and night look.")
            Spacer(Modifier.height(12.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (row in MMTheme.entries.chunked(4)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        for (t in row) {
                            val on = t == theme
                            Column(
                                Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(12.dp))
                                    .border(
                                        if (on) 2.dp else 1.dp,
                                        if (on) p.red else p.rule,
                                        RoundedCornerShape(12.dp),
                                    )
                                    .clickable { theme = t; onTheme(t) }
                                    .padding(vertical = 10.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Box(Modifier.size(22.dp).clip(RoundedCornerShape(99.dp)).background(t.dot))
                                Spacer(Modifier.height(6.dp))
                                Text(
                                    t.title.substringBefore(' '),
                                    color = if (on) p.ink else p.ink2,
                                    fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                        // Keep the last, short row the same tile width as the first.
                        repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))

        Panel {
            SectionLabel("Appearance", icon = "moon")
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (a in MMAppearance.entries) {
                    val on = a == appearance
                    MMButton(
                        a.title,
                        kind = if (on) BtnKind.PRIMARY else BtnKind.GHOST,
                        modifier = Modifier.weight(1f),
                    ) { appearance = a; onAppearance(a) }
                }
            }
            Spacer(Modifier.height(8.dp))
            Hint(appearance.caption)
        }

        Spacer(Modifier.height(12.dp))

        Panel {
            SectionLabel("Sound", icon = if (sound) "soundOn" else "soundOff")
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        "Sound effects",
                        color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                    )
                    Hint("Dice, footsteps, cash and the door of the prison.")
                }
                Switch(
                    checked = sound,
                    onCheckedChange = {
                        sound = it
                        store.prefs.soundOn = it
                        SoundKit.enabled = it
                        Haptics.enabled = it
                        if (it) SoundKit.click()
                    },
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

        Spacer(Modifier.height(12.dp))

        Panel {
            SectionLabel("This device", icon = "key")
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Friend code", color = p.ink2, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.weight(1f))
                Chip(friendCode(store.token), tint = p.red)
            }
            Spacer(Modifier.height(8.dp))
            Hint("Share it and a friend can add you from their Social tab.")
        }

        Spacer(Modifier.height(12.dp))

        Panel {
            SectionLabel("Account", icon = "shield")
            Spacer(Modifier.height(8.dp))
            val me = account.me
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        me?.provider?.let { "Signed in with ${it.replaceFirstChar(Char::uppercase)}" }
                            ?: "Playing as a guest",
                        color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                    )
                    Hint(
                        if (me?.provider != null) "Your coins and friends follow this account."
                        else "Your coins live on this device only. Signing in keeps them."
                    )
                }
                Chip("${account.coins}", icon = "coin", tint = p.gold)
            }
            Spacer(Modifier.height(10.dp))
            Hint("Karma ${me?.karma ?: 100} · leaving games early costs a point.")
        }

        Spacer(Modifier.height(12.dp))

        Panel {
            SectionLabel("About", icon = "bulb")
            Spacer(Modifier.height(8.dp))
            Hint("MoneyMove · the same game in a browser, on an iPhone and here.")
            Spacer(Modifier.height(6.dp))
            Hint("moneymove.live")
        }

        Spacer(Modifier.height(28.dp))
    }
}
