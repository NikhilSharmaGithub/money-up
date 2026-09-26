package com.moneymove.game

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import kotlin.math.roundToInt

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
    messaging: MessagingStore,
    billing: Billing,
    onTheme: (MMTheme) -> Unit,
    onAppearance: (MMAppearance) -> Unit,
) {
    val p = P.current
    var tab by remember { mutableStateOf(Tab.PLAY) }
    // Versioned rather than seen-or-not, as on iOS: when the intro gains
    // something existing players should read, INTRO_VERSION goes up and it
    // shows once more.
    var welcome by remember { mutableStateOf(store.prefs.introSeen < INTRO_VERSION) }
    var howTo by remember { mutableStateOf(false) }
    var notices by remember { mutableStateOf(false) }

    // The bell has to know there is something to ring about before anybody
    // opens the tab it lives on, so the watch starts with the app.
    LaunchedEffect(Unit) { messaging.watchNotices() }
    // So does the invite poll — a friend's "come and play" has to find the
    // player in a game as readily as on the home screen, and it is told which
    // table this device is at so it never announces the one they are at.
    LaunchedEffect(Unit) { messaging.watchInvites { store.roomId } }
    val atTable = store.roomId != null

    Box(Modifier.fillMaxSize().background(p.page)) {
        if (atTable) {
            GameScreen(store, account, onTheme)
        } else {
            Column(Modifier.fillMaxSize()) {
                Spacer(Modifier.height(WindowInsets.statusBars.asPaddingValues().calculateTopPadding()))
                Box(Modifier.weight(1f)) {
                    when (tab) {
                        // The bell and the rules ride in the landing screen's
                        // own header rather than floating over it — pinned to
                        // the corner they sat on top of the wallet chip, which
                        // is the one thing up there somebody needs to read.
                        Tab.PLAY -> PlayTab(
                            store, account,
                            unreadNotices = messaging.unread,
                            onNotices = { notices = true },
                            onHowTo = { howTo = true },
                        )
                        Tab.STORE -> StoreTab(account, billing)
                        Tab.SOCIAL -> SocialTab(account, store, messaging, onNotices = { notices = true })
                        Tab.HISTORY -> HistoryTab(account, store)
                        Tab.SETTINGS -> SettingsTab(store, account, onTheme, onAppearance, messaging = messaging)
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
                store.prefs.introSeen = INTRO_VERSION
            }
        }
        if (howTo) HowToPlaySheet { howTo = false }
        if (notices) NoticesSheet(messaging) { notices = false }

        // A friend asking this player to their table, over the tabs or the
        // board alike — hung here, outside the table-or-tabs switch, for
        // exactly that reason.
        InviteBanner(messaging, store, Modifier.align(Alignment.TopCenter))

        // Toasts sit above everything, including a table.
        AnimatedVisibility(
            visible = store.toast != null,
            enter = fadeIn(), exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 96.dp),
        ) {
            store.toast?.let { t ->
                val ink = if (t.isError) Color.White else p.page
                Row(
                    Modifier
                        .padding(horizontal = 24.dp)
                        .clip(RoundedCornerShape(99.dp))
                        .background(if (t.isError) p.bad else p.ink)
                        .padding(horizontal = 17.dp, vertical = 11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // A toast with a subject of its own draws it, as iOS's do
                    // — the eye on "watching this one", say.
                    t.glyph?.let {
                        Icon(it, size = 17.dp, tint = ink)
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(
                        t.text,
                        color = ink,
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
    }
}

/**
 * The dock.
 *
 * A tab bar is navigation, which is the layer the material is for, so this is
 * the one surface on the landing screens that turns to glass — and glass has
 * to be floating over something or it is only a panel with a highlight. So the
 * slab welded to the bottom edge lifts off it: sixteen either side, the page
 * showing all the way round, and the hairline that used to divide bar from
 * page goes with the slab, because the material draws its own contour and a
 * rule under something floating reads as a seam in mid-air.
 *
 * The radii are concentric by construction rather than by memory: a 22dp
 * shell with 8dp of padding holds 14dp chips, which is what [MMShapes.inner]
 * says, so the gap around a chip stays one width all the way into the corner.
 * The corner itself is the squircle, not Compose's arc, for the same reason
 * iOS has drawn it that way since 2013 — the rim's hot spot lives in the
 * corner and on a plain arc it lands somewhere else.
 *
 * What is behind it is declared, not sampled: [BackdropKind.Page]. That one
 * word is the whole adaptive flip — the material reads the page's luminance
 * out of the palette and wears the light face over cream and the dark face
 * over a night table, on an API 24 phone with no blur in it exactly as on an
 * API 34 one. And over a flat page the tier-0 film is not an approximation of
 * the blur: a Gaussian convolved with a linear ramp gives the ramp back.
 */
@Composable
private fun TabBar(current: Tab, onPick: (Tab) -> Unit) {
    val p = P.current
    val surface = rememberGlassSurface(BackdropKind.Page)
    val reduceMotion = rememberReduceMotion()
    val chip = MMShapes.innerShape(22.dp, 8.dp)

    // Where the selection is, measured in slots. It travels instead of
    // cutting, and it stretches on the way: a thing in motion is longer along
    // the direction it moves, and that stretch is the difference between one
    // indicator crossing the bar and two of them fading past each other. The
    // peak is 1.12 at the midpoint of whatever distance was asked for, so a
    // jump from Play to Settings stretches once, not four times.
    val index = Tab.entries.indexOf(current).toFloat()
    val travel = remember { Animatable(index) }
    var origin by remember { mutableFloatStateOf(index) }
    LaunchedEffect(index, reduceMotion) {
        origin = travel.value
        if (reduceMotion) {
            travel.snapTo(index)
        } else {
            travel.animateTo(index, tween(GlassMotion.INDICATOR_MS, easing = FastOutSlowInEasing))
        }
    }

    BoxWithConstraints(
        Modifier
            .fillMaxWidth()
            .padding(bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding())
            .padding(start = 16.dp, end = 16.dp, bottom = 8.dp)
            .mmGlass(backdrop = BackdropKind.Page, shape = MMShapes.r22)
            .padding(8.dp)
            .height(46.dp)
    ) {
        val slot = maxWidth / Tab.entries.size
        val slotPx = with(LocalDensity.current) { slot.toPx() }

        // The selected chip is solid accent, not more glass. Stacking a glass
        // chip on a glass bar is the tell that gives away a hand-built
        // material, and the palette already carries the ink designed to sit on
        // the accent — dark on brass, white on purple — so this is the one
        // pairing in the app that never has to be re-measured per table.
        Box(
            Modifier
                .width(slot)
                .fillMaxHeight()
                .offset { IntOffset((slotPx * travel.value).roundToInt(), 0) }
                .graphicsLayer {
                    val span = index - origin
                    val progress =
                        if (abs(span) < 0.001f) 0f
                        else ((travel.value - origin) / span).coerceIn(0f, 1f)
                    scaleX = 1f + 0.12f * 4f * progress * (1f - progress)
                }
                .clip(chip)
                .background(p.red)
        )

        Row(Modifier.fillMaxSize()) {
            for (t in Tab.entries) {
                val on = t == current
                // Ink off the surface rather than the palette, so a label
                // crossfades in step with the film under it instead of
                // snapping a frame early. The quiet tab is ink2, never ink3:
                // the palette's quietest ink measures 1.53:1 on the material.
                val tint = if (on) p.accentInk else surface.ink2
                Column(
                    Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .clip(chip)
                        .clickable { onPick(t) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(t.icon, size = 21.dp, tint = tint)
                    Spacer(Modifier.height(3.dp))
                    Text(
                        t.label,
                        color = tint,
                        fontSize = 10.5.sp,
                        fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                    )
                }
            }
        }
    }
}


