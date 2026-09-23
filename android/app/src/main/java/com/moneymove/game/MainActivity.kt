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
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

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
    private val account: AccountStore by viewModels()
    private val messaging: MessagingStore by viewModels()
    private val billing: Billing by viewModels()

    /**
     * A link somebody sent.
     *
     * Invite links carry the table in the query — .../?room=g3d5s — which an
     * intent filter cannot match on, so the filter takes the host and this
     * reads the code off the URI. `singleTask` means a second link while the
     * app is already open arrives at onNewIntent rather than starting a
     * second copy of the game, which is why both doors lead here.
     */
    private fun roomFrom(intent: android.content.Intent?): String? {
        val data = intent?.data ?: return null
        val room = data.getQueryParameter("room")
            ?: data.pathSegments?.lastOrNull()?.takeIf { it.length in 4..12 }
        return room?.lowercase()?.filter(Char::isLetterOrDigit)?.takeIf { it.isNotBlank() }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        roomFrom(intent)?.let { store.connect(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        roomFrom(intent)?.let { store.connect(it) }
        enableEdgeToEdge()
        WindowCompat.setDecorFitsSystemWindows(window, false)

        // Sound and the three taps the app uses. Both read the player's own
        // switch, so turning sound off turns the whole kit off rather than
        // muting it one call site at a time.
        SoundKit.attach(this, store.prefs.soundOn)
        Haptics.attach(this)

        // Push: the device token, if this build can get one. It cannot yet —
        // there is no google-services.json — so this is a registration that
        // politely does nothing rather than a crash. See PushRegistration.
        lifecycleScope.launch { PushRegistration.register(this@MainActivity) }

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
                    account = account,
                    messaging = messaging,
                    billing = billing,
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
    account: AccountStore,
    messaging: MessagingStore,
    billing: Billing,
    onTheme: (MMTheme) -> Unit,
    onAppearance: (MMAppearance) -> Unit,
) {
    val p = P.current
    Box(Modifier.fillMaxSize().background(p.page)) {
        AppScaffold(
            store = store, account = account, messaging = messaging, billing = billing,
            onTheme = onTheme, onAppearance = onAppearance,
        )
    }
}
