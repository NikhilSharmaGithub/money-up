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
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
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

        // Billing is started here as well as on the shop, because the player
        // who most needs its recovery sweep — a purchase Play took and the
        // server never heard about — has no reason to open the shop again.
        billing.start(account)

        // Google's full-screen ads need an Activity to launch from, and the
        // offer loop lives in a ViewModel that must never hold one. This says
        // when this one is in front, weakly. It starts nothing and asks
        // Google for nothing; see AdMobNetwork.
        AdMobNetwork.attach(this)
        watchPreGameBreak()

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

    /**
     * The pre-game break, driven off state rather than off a button.
     *
     * iOS shows it from inside the Play button's own tap. Here the tap lives
     * in PlayTab and the search in GameStore, and neither needs to know an
     * ad exists: the moment GameStore says a quick match is being looked for,
     * the break goes up — at the START of the wait, as on iOS, with the
     * search carrying on behind it. Any other moment on the tabs is a chance
     * to have one ready, which costs nothing when none is due.
     *
     * Only on the rising edge of a search, so coming back to the app halfway
     * through one does not throw an ad at somebody who never tapped anything
     * since; and never over a rewarded break already on screen.
     */
    private fun watchPreGameBreak() {
        var wasSearching = false
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                snapshotFlow { Triple(account.ads, store.roomId == null, store.quickSearching) }
                    .collect { (ads, atTabs, searching) ->
                        if (searching && !wasSearching && account.adPlaying == null) {
                            PreGameAd.showIfReady(this@MainActivity, ads)
                        } else if (!searching && atTabs) {
                            PreGameAd.preload(this@MainActivity, ads)
                        }
                        wasSearching = searching
                    }
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
