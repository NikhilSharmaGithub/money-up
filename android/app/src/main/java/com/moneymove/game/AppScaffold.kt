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
    onTheme: (MMTheme) -> Unit,
    onAppearance: (MMAppearance) -> Unit,
) {
    val p = P.current
    var tab by remember { mutableStateOf(Tab.PLAY) }
    val atTable = store.roomId != null

    Box(Modifier.fillMaxSize().background(p.page)) {
        if (atTable) {
            GameScreen(store)
        } else {
            Column(Modifier.fillMaxSize()) {
                Spacer(Modifier.height(WindowInsets.statusBars.asPaddingValues().calculateTopPadding()))
                Box(Modifier.weight(1f)) {
                    when (tab) {
                        Tab.PLAY -> PlayTab(store)
                        Tab.STORE -> ComingSoon("Store", "Coins, pieces and board rentals.")
                        Tab.SOCIAL -> ComingSoon("Social", "Friends, messages and the leaderboard.")
                        Tab.HISTORY -> ComingSoon("History", "Every game this device has finished.")
                        Tab.SETTINGS -> SettingsTab(store, onTheme, onAppearance)
                    }
                }
                TabBar(tab) { tab = it }
            }
        }

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

@Composable
private fun ComingSoon(title: String, body: String) {
    val p = P.current
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon("crane", size = 40.dp, tint = p.ink3)
        Spacer(Modifier.height(12.dp))
        Text(title, color = p.ink, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Hint(body)
    }
}
