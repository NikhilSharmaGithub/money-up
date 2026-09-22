package com.moneymove.game

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat

/**
 * MoneyMove on Android.
 *
 * One activity, all of it Compose. The screen the player is on is a value in
 * the store rather than a back-stack entry, for the same reason the iOS app
 * has one window: a board game is one place you are, with sheets over it, not
 * a stack of pages you navigate.
 */
class MainActivity : ComponentActivity() {

    private val store: GameStore by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        WindowCompat.setDecorFitsSystemWindows(window, false)

        setContent {
            val prefs = store.prefs
            var theme by remember { mutableStateOf(prefs.theme) }
            var appearance by remember { mutableStateOf(prefs.appearance) }
            val systemDark = isSystemInDarkTheme()
            val dark = when (appearance) {
                MMAppearance.SYSTEM -> systemDark
                MMAppearance.LIGHT -> false
                MMAppearance.DARK -> true
            }
            MoneyMoveTheme(theme, dark) {
                Root(
                    store = store,
                    onTheme = { theme = it; prefs.theme = it },
                    onAppearance = { appearance = it; prefs.appearance = it },
                )
            }
        }
    }
}

@Composable
private fun Root(
    store: GameStore,
    onTheme: (MMTheme) -> Unit,
    onAppearance: (MMAppearance) -> Unit,
) {
    val p = P.current
    Box(Modifier.fillMaxSize().background(p.page)) {
        AppScaffold(store = store, onTheme = onTheme, onAppearance = onAppearance)
    }
}
