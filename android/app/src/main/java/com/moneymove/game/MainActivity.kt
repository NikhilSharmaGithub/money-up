package com.moneymove.game

import android.Manifest
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
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
     * The two places a tapped push can lead that are sheets rather than a
     * table: the owner's notes, and the tournament room. The tap arrives
     * here, at the activity, so the switches live here too, and [Root] draws
     * the sheets over whatever is on screen.
     */
    private var noticesOpen by mutableStateOf(false)
    private var cupRoomOpen by mutableStateOf(false)

    /**
     * The system's notification prompt, for the end of a finished game (see
     * [watchForTheAsk]). Registered as the activity is made, which is when
     * the API insists on it. Nothing is done with the answer here: the dialog
     * only pauses the activity, and ON_RESUME is where the token is handed
     * over (see [watchPush]) — which is also how a yes given to the cup
     * card's own prompt is heard.
     */
    private val askToNotify = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

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
        // A cup reminder tapped while the app was still on screen. From the
        // background, ON_START does the asking (see watchCupInFront); here
        // nothing else would, and the player tapped because a door is open.
        if (intent.getBooleanExtra(CupReminders.EXTRA_OPEN, false) &&
            lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        ) {
            CupStore.shared(store).resume()
        }
        followPush(intent)
    }

    /**
     * Where a tapped push leads, read off the data push.js sends with it
     * (see [PushAbout]).
     *
     *  - A push that names a table goes to it: the turn waiting there, or the
     *    cup match whose door has just opened. Straight in, as a room link
     *    does, because that is what the push asked the player to do.
     *  - A cup push about no table yet — the draw, the quarter of an hour's
     *    warning, how it ended — opens the tournament room.
     *  - An invite is asked about at once rather than at the next ten-second
     *    poll, so the banner is up by the time the app is, and answered there
     *    like any other.
     *  - A note opens the notes, which fetch themselves as they open.
     */
    private fun followPush(intent: Intent?) {
        val about = PushAbout.from(intent) ?: return
        when (about.kind) {
            PushAbout.Kind.TURN -> about.room?.let { store.connect(it) }
            PushAbout.Kind.CUP -> {
                val cups = CupStore.shared(store)
                val table = about.room
                if (table != null) {
                    store.connect(table)
                } else {
                    // Asked for by name only when the card has nothing on it
                    // yet — a cold start. Switching a card that is already
                    // showing a cup would pull that cup out from under a
                    // room about to open on it; and the one the server puts
                    // on the card is the player's own anyway.
                    if (cups.live == null) about.cup?.let { cups.show(it) }
                    cupRoomOpen = true
                }
                // From the background ON_START asks about the cup; on screen
                // nothing else would.
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) cups.resume()
            }
            PushAbout.Kind.INVITE -> messaging.refreshInvite()
            PushAbout.Kind.NOTICE -> noticesOpen = true
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        roomFrom(intent)?.let { store.connect(it) }
        // A push tapped with the app closed. Only on a fresh start: an
        // activity rebuilt, or reopened from Recents after the process died,
        // carries the intent that first started it, and nobody should be
        // walked back into a table because of a push from an hour ago.
        if (savedInstanceState == null &&
            (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0
        ) {
            followPush(intent)
        }
        enableEdgeToEdge()
        WindowCompat.setDecorFitsSystemWindows(window, false)

        // Sound and the three taps the app uses. Both read the player's own
        // switch, so turning sound off turns the whole kit off rather than
        // muting it one call site at a time.
        SoundKit.attach(this, store.prefs.soundOn)
        Haptics.attach(this)

        // Push. The channels come first: the server names one in every push
        // and Android draws those without asking the app, so they have to
        // exist before the first can arrive. Registration, and a push that
        // lands while the app is open, are watchPush; the one prompt is
        // watchForTheAsk. In a build without google-services.json all of it
        // is a quiet no-op — see PushRegistration.
        PushChannels.ensure(this)
        watchPush()
        watchForTheAsk()

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
        watchCupInFront()

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
                    noticesOpen = noticesOpen,
                    onNoticesClosed = { noticesOpen = false },
                    cupRoomOpen = cupRoomOpen,
                    onCupRoomClosed = { cupRoomOpen = false },
                )
            }
        }
    }

    /**
     * The cup poll runs only while the app is on screen, and asks again the
     * moment it comes back — iOS's landing screen reloads its cup watcher on
     * willEnterForeground, and its watcher is suspended in between. What
     * reaches a phone that is not looking is the server's cup push, or the
     * reminders this poll sets while the server cannot send one
     * (CupReminders); what the player sees on coming back is this.
     *
     * It lives here rather than in a tab so that coming back to any tab
     * counts, and so the Store, History and Settings tabs keep it too. The
     * CupStore is the same instance the tabs get from rememberCupStore,
     * because the GameStore handed to them is this activity's own; what the
     * player picked, and where they were already walked, survive a trip to
     * the background.
     */
    private fun watchCupInFront() {
        val cups = CupStore.shared(store)
        lifecycle.addObserver(LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> {
                    CupReminders.inFront = true
                    cups.resume()
                }
                Lifecycle.Event.ON_STOP -> {
                    CupReminders.inFront = false
                    cups.pause()
                }
                else -> Unit
            }
        })
    }

    /**
     * Push, from the activity's side.
     *
     * The token is handed over every time the app comes to the front —
     * ON_RESUME rather than ON_START, because a permission dialog, this
     * activity's or the cup card's, only pauses the activity, and a yes given
     * there is the moment registration becomes possible. PushRegistration
     * sends only what has changed, or an answer a quarter of an hour old, so
     * a resume that changes nothing costs a look at a token FCM already has.
     *
     * A push that lands while the app is on screen draws nothing, as on iOS;
     * what it was about is fetched instead, so the screen catches up at once
     * rather than at its next poll. A turn needs nothing: the socket already
     * has it, and the board is showing it.
     */
    private fun watchPush() {
        lifecycle.addObserver(LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                lifecycleScope.launch { PushRegistration.register(this@MainActivity) }
            }
        })
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                MoneyMoveMessagingService.heard.collect { about ->
                    when (about.kind) {
                        PushAbout.Kind.TURN -> Unit
                        PushAbout.Kind.CUP -> CupStore.shared(store).resume()
                        PushAbout.Kind.INVITE -> messaging.refreshInvite()
                        PushAbout.Kind.NOTICE -> messaging.refreshNotices()
                    }
                }
            }
        }
    }

    /**
     * The notification prompt, at iOS's moment: the result of a game this
     * device played is on screen (AskingNicely.swift's askAfterFirstGame,
     * which the result sheet runs as it appears). The finished game is
     * counted here as well — iOS counts it in GameStore, as the result
     * arrives, and this is the same moment read off the same store.
     *
     * Counted once per game however often the standings are reopened, and
     * only for a seat this device played: a table only watched is nobody's
     * good moment. The prompt waits 1.2 seconds, iOS's number, so it never
     * lands before the standings do; standings swiped away in that beat take
     * the ask with them, to the next time a result is on screen. Never on
     * launch, and never twice — see PushRegistration.shouldAsk.
     */
    private fun watchForTheAsk() {
        var counted: String? = null
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                snapshotFlow {
                    store.state?.takeIf { it.isEnded && store.showGameOver && store.iPlayed }?.id
                }.collectLatest { ended ->
                    if (ended == null) return@collectLatest
                    if (ended != counted) {
                        counted = ended
                        PushRegistration.noteFinishedGame(this@MainActivity)
                    }
                    if (!PushRegistration.shouldAsk(this@MainActivity)) return@collectLatest
                    delay(1_200)
                    // Spent only if the dialog actually went up.
                    runCatching { askToNotify.launch(Manifest.permission.POST_NOTIFICATIONS) }
                        .onSuccess { PushRegistration.markAsked(this@MainActivity) }
                }
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
    noticesOpen: Boolean,
    onNoticesClosed: () -> Unit,
    cupRoomOpen: Boolean,
    onCupRoomClosed: () -> Unit,
) {
    val p = P.current
    Box(Modifier.fillMaxSize().background(p.page)) {
        AppScaffold(
            store = store, account = account, messaging = messaging, billing = billing,
            onTheme = onTheme, onAppearance = onAppearance,
        )
    }

    // Where a tapped push leads when that is a sheet (MainActivity.followPush).
    // A sheet is a window of its own, so drawing it here rather than from
    // inside AppScaffold changes nothing about how it looks.
    if (noticesOpen) NoticesSheet(messaging, onNoticesClosed)

    // The tournament room belongs to the tabs. Over a table it would cover
    // the game, so sitting down — the card walking the player to a door that
    // has just opened, say — closes it.
    val atTable = store.roomId != null
    LaunchedEffect(atTable) { if (atTable) onCupRoomClosed() }
    if (cupRoomOpen && !atTable) {
        val cups = remember(store) { CupStore.shared(store) }
        val feed = cups.feed
        when {
            cups.live != null -> CupDetailSheet(
                cups = cups,
                game = store,
                signedIn = account.me?.provider != null,
                onDismiss = onCupRoomClosed,
            )
            // The card has answered and there is no cup on it: nothing to
            // open. Until it answers — a cold start — the room waits for it,
            // rather than opening on nothing and closing itself at once.
            feed != null -> LaunchedEffect(feed) { onCupRoomClosed() }
        }
    }
}
