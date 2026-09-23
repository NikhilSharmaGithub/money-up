package com.moneymove.game

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The five places the app has, and the one screen that is not a place.
 *
 * Play, Store, Social, History and Settings are a tab bar, exactly as on iOS.
 * A table is not one of them: when this device is sitting at a board the
 * board takes the whole screen, because a board game is somewhere you are,
 * not a page you navigated to.
 */
enum class Tab(val label: String, val icon: String) {
    PLAY("Play", "dice"),
    STORE("Store", "bag"),
    SOCIAL("Social", "people"),
    HISTORY("History", "chart"),
    SETTINGS("Settings", "palette"),
}

@Composable
fun AppScaffold(
    store: GameStore,
    account: AccountStore,
    onTheme: (MMTheme) -> Unit,
    onAppearance: (MMAppearance) -> Unit,
) {
    val p = P.current
    var tab by remember { mutableStateOf(Tab.PLAY) }
    var welcome by remember { mutableStateOf(!store.prefs.seenWelcome) }
    var howTo by remember { mutableStateOf(false) }
    val atTable = store.roomId != null

    Box(Modifier.fillMaxSize().background(p.page)) {
        if (atTable) {
            GameScreen(store, account)
        } else {
            Column(Modifier.fillMaxSize()) {
                Spacer(Modifier.height(WindowInsets.statusBars.asPaddingValues().calculateTopPadding()))
                Box(Modifier.weight(1f)) {
                    // The rules, one tap from wherever somebody met one.
                    if (tab == Tab.PLAY) {
                        Box(Modifier.align(Alignment.TopEnd).padding(top = 6.dp, end = 4.dp)) {
                            MMButton("", kind = BtnKind.GHOST, icon = "bulb") { howTo = true }
                        }
                    }
                    when (tab) {
                        Tab.PLAY -> PlayTab(store, account)
                        Tab.STORE -> StoreTab(account)
                        Tab.SOCIAL -> SocialTab(account, store)
                        Tab.HISTORY -> HistoryTab(account, store)
                        Tab.SETTINGS -> SettingsTab(store, account, onTheme, onAppearance)
                    }
                }
                TabBar(tab) { tab = it }
            }
        }

        // Six cards for somebody who has never been here, over everything
        // else, because a stranger dropped onto a board with eight buttons on
        // it is how a game loses the people who would have liked it.
        if (welcome) {
            WelcomeIntro {
                welcome = false
                store.prefs.seenWelcome = true
            }
        }
        if (howTo) HowToPlaySheet { howTo = false }

        // Toasts sit above everything, including a table.
        AnimatedVisibility(
            visible = store.toast != null,
            enter = fadeIn(), exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 96.dp),
        ) {
            store.toast?.let { t ->
                Text(
                    t.text,
                    color = if (t.isError) Color.White else p.page,
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier
                        .padding(horizontal = 24.dp)
                        .clip(RoundedCornerShape(99.dp))
                        .background(if (t.isError) p.bad else p.ink)
                        .padding(horizontal = 17.dp, vertical = 11.dp),
                )
            }
        }
    }
}

@Composable
private fun TabBar(current: Tab, onPick: (Tab) -> Unit) {
    val p = P.current
    Column {
        Rule()
        Row(
            Modifier
                .fillMaxWidth()
                .background(p.card)
                .padding(bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding())
                .padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            for (t in Tab.entries) {
                val on = t == current
                Column(
                    Modifier
                        .clip(RoundedCornerShape(14.dp))
                        .clickable { onPick(t) }
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(t.icon, size = 21.dp, tint = if (on) p.red else p.ink3)
                    Spacer(Modifier.height(3.dp))
                    Text(
                        t.label,
                        color = if (on) p.red else p.ink3,
                        fontSize = 10.5.sp,
                        fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                    )
                }
            }
        }
    }
}


