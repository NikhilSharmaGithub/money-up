package com.moneymove.game

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseOut
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
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

    // How much of the optics this phone pays for before anything on screen
    // has a say: Battery Saver or a low-RAM phone goes flat, API 31 frosts,
    // API 33 lenses. Reduce Transparency joins it here once its row in
    // Settings ▸ Appearance exists — Android has no signal for it below 31.
    val glassLevel = rememberBaseGlassLevel()

    // The board telling the story of the last action: dice, a walk, a card.
    // The glass keeps working through it; only what it refracts stops being
    // re-recorded, for the second or two nobody is looking at anything but
    // the dice. The curtain is the one signal the whole table already waits
    // behind, so the glass waits behind it too.
    val boardBusy = atTable && store.holdUntil != 0L

    // How far the tab on screen has been scrolled, for the bar's light and
    // shadow. A fresh count for every tab, because every tab opens at rest.
    val density = LocalDensity.current
    val scroll = remember(tab, density) {
        with(density) { TabScroll(swingPx = SCROLL_SWING.toPx(), stepPx = SCROLL_STEP.toPx()) }
    }

    CompositionLocalProvider(
        LocalGlassLevel provides glassLevel,
        LocalBoardBusy provides boardBusy,
    ) {
        // Two layers, and the line between them is the design. Below is
        // everything the glass floats over — the page and whatever sits on
        // it, the tabs or the table — which is what the host records and
        // blurs once for every piece of glass to share. Above are the glass
        // surfaces, siblings of that recording and never inside it: a bar
        // that samples a picture with itself in it shows last frame's bar
        // through this frame's, and recording the root instead would draw
        // the whole app twice for every frame it recorded.
        MMBackdropHost(
            Modifier.fillMaxSize(),
            overLiveBoard = atTable,
            backdrop = {
                val edgeAbove = if (atTable) null else navigationBottom() + TAB_BAR_HEIGHT
                Box(Modifier.fillMaxSize().pageRamp(p.page, p.page2, edgeAbove)) {
                    if (atTable) {
                        GameScreen(store, account, onTheme)
                    } else {
                        Column(Modifier.fillMaxSize()) {
                            Spacer(Modifier.height(WindowInsets.statusBars.asPaddingValues().calculateTopPadding()))
                            Box(Modifier.weight(1f).nestedScroll(scroll)) {
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
                            // The bar itself is glass and lives in the layer
                            // above; down here the page keeps its room, to the
                            // dp, so the tabs still end at the bar's top edge.
                            Spacer(Modifier.height(navigationBottom() + TAB_BAR_HEIGHT))
                        }
                    }
                }
            },
        ) {
            if (!atTable) {
                // Flat, on purpose, and not a step down. Nothing slides under
                // this bar — the tabs fade out just above its top edge — so all
                // it could ever sample is the page ramp, which the film already
                // sits over for real. Sampling it anyway would keep the host
                // recording the whole landing screen every frame for a bar
                // that looks the same either way: the record the spec skips
                // for the page family. Reduce Transparency passes through.
                val flat = if (glassLevel == GlassLevel.Opaque) GlassLevel.Opaque else GlassLevel.Flat
                CompositionLocalProvider(LocalGlassLevel provides flat) {
                    TabBar(tab, scroll, Modifier.align(Alignment.BottomCenter)) { tab = it }
                }
            }

            // None of these is floating over the recording. The intro paints
            // its own page over everything, and the two sheets are windows of
            // their own, where a position in this root means nothing — so any
            // glass inside them is its own backdrop, never a sample of the
            // tabs they cover.
            CompositionLocalProvider(LocalBackdrop provides null) {
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
            }

            // A friend asking this player to their table, over the tabs or the
            // board alike — hung here, outside the table-or-tabs switch, for
            // exactly that reason.
            InviteBanner(messaging, store, Modifier.align(Alignment.TopCenter))

            // Toasts sit above everything, including a table.
            ToastLayer(store, atTable, Modifier.align(Alignment.BottomCenter))
        }
    }
}

/**
 * A toast, in the material.
 *
 * It was the page turned inside out — an ink pill with page-coloured words,
 * a sticker laid over whatever was there. A toast is the textbook case for
 * glass: it floats, it passes, and what is under it is whatever happened to
 * be there — cards on a tab, the felt at a table. So it is the one surface
 * in the shell that samples the host's blurred copy: from API 31 its words
 * sit on a soft picture of the screen rather than on top of the screen's own
 * text, and below that it is the film alone, as every tier-0 pane is. While
 * it is up the host records; once it has faded out, the host stops.
 * Regular, because it lands on pixels nobody chose and Clear does not adapt;
 * lens off, because a toast is neither navigation nor the focus of anything.
 *
 * An error keeps its red. Through the material's fourteen-percent tint it
 * would come out a pale pink cream, and "that did not work" would read like
 * "done" — the reason a coloured button keeps its plate. So it is a solid
 * plate of `bad` with white words, laid over the pane the way MMButton lays
 * one, and it takes from the glass its shadow and the light on its edge.
 */
@Composable
private fun ToastLayer(store: GameStore, atTable: Boolean, modifier: Modifier = Modifier) {
    val current = store.toast
    // The pill fades out after the toast is gone, so it has to remember what
    // it was showing or it would empty itself on the way out — which it did:
    // the exit fade was asked for from the start and never had anything to
    // fade.
    var held by remember { mutableStateOf<GameStore.Toast?>(null) }
    LaunchedEffect(current) { if (current != null) held = current }
    val shown = current ?: held

    // Declared, like every backdrop in the app. The felt and the page sit on
    // the same side of the crossover on all fourteen palettes, so this never
    // changes which face the pill wears — it only says what is really there.
    val backdrop = if (atTable) BackdropKind.Felt else BackdropKind.Page

    // Ninety-six up, as always, unless that would leave it less than the
    // bar's own inset clear of the tab bar. With three-button navigation the
    // bar's top edge is above ninety-six, and glass lying half across other
    // glass is the one pairing the material must never make; with gestures
    // it was two dp off, close enough for its shadow to land on the bar.
    val lift = if (atTable) {
        TOAST_LIFT
    } else {
        maxOf(TOAST_LIFT, navigationBottom() + TAB_BAR_HEIGHT + TAB_BAR_INSET)
    }

    // It arrives on the material's appear: ease-out over 340 ms, and a plain
    // 160 ms fade under Reduce Motion.
    val reduceMotion = rememberReduceMotion()
    val appear = tween<Float>(
        if (reduceMotion) GlassMotion.REDUCED_MS else GlassMotion.APPEAR_MS,
        easing = EaseOut,
    )

    AnimatedVisibility(
        visible = current != null,
        enter = fadeIn(appear), exit = fadeOut(),
        modifier = modifier.padding(bottom = lift - TOAST_SHADOW_ROOM),
    ) {
        shown?.let { t ->
            val glass = rememberGlassSurface(backdrop)
            val ink = if (t.isError) Color.White else glass.labelInk()
            // An error's plate covers its pane edge to edge, so there is no
            // window in it for a blurred copy to show through. It stays flat,
            // as a plate on a card does, rather than have the host record
            // the whole screen for as long as it is up to paint a picture
            // nobody can see. Reduce Transparency passes through.
            val level = LocalGlassLevel.current
            val paneLevel = if (t.isError && level != GlassLevel.Opaque) GlassLevel.Flat else level
            // Over a table the board moves beneath it — dice, a walk, a
            // card — and its shadow deepens for as long as it does, as
            // everything floating over that board does. Up here it is outside
            // the table's own say, so it asks the curtain directly.
            val busy = LocalGlassBusy.current || LocalBoardBusy.current
            CompositionLocalProvider(
                LocalGlassLevel provides paneLevel,
                LocalGlassBusy provides busy,
            ) {
                ToastPane(t, ink, backdrop)
            }
        }
    }
}

/**
 * The pill itself: the pane, the plate an error lays over it, and the words.
 * The ink is worked out by the caller, off the glass it declared.
 */
@Composable
private fun ToastPane(t: GameStore.Toast, ink: Color, backdrop: BackdropKind) {
    val p = P.current
    val pane = Modifier.mmGlass(backdrop = backdrop, shape = MMShapes.pill, lens = false)
    Row(
        Modifier
            // The fade draws through a layer the size of this node, and a
            // part-transparent layer clips to its bounds, so the shadow gets
            // room inside it — or it would be cut flat while fading and snap
            // in whole at the end. Taken back off the lift above, so the pill
            // has not moved.
            .padding(horizontal = 24.dp, vertical = TOAST_SHADOW_ROOM)
            .then(if (t.isError) pane.background(p.bad, MMShapes.pill) else pane)
            .padding(horizontal = 17.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // A toast with a subject of its own draws it, as iOS's do — the eye
        // on "watching this one", say.
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

/**
 * The page everything stands on, and the scroll edge above the tab bar.
 *
 * A ramp, page into page2 from corner to corner, as the root paints it on iOS
 * and the body on the web, and as the intro cards here already paint theirs.
 * It is what [BackdropKind.Page] declares, and a Gaussian of a linear ramp is
 * the ramp — the reason a bar over nothing else can skip the blur and lose
 * nothing by it.
 *
 * [edgeAbove] is how far up from the bottom the tab bar's top edge is, and
 * there the tabs stop being sliced off in a hard line: the last
 * [SCROLL_EDGE] of them fades into the page instead. It is the page drawn
 * over them through a mask rather than the tabs drawn through one, so the
 * only offscreen pass is a strip that tall, not the whole screen every frame
 * it scrolls. And it costs nothing at rest: every tab ends on exactly this
 * much empty padding — iOS's tabPage — so scrolled to the bottom, all it
 * covers is page.
 */
private fun Modifier.pageRamp(page: Color, page2: Color, edgeAbove: Dp?): Modifier = drawWithCache {
    val corner = Offset(size.width, size.height)
    // Two brushes with one line, because a brush remembers the size it last
    // drew at and a strip and a whole screen would have it rebuilt twice a frame.
    val ramp = Brush.linearGradient(listOf(page, page2), start = Offset.Zero, end = corner)
    val strip = Brush.linearGradient(listOf(page, page2), start = Offset.Zero, end = corner)
    val band = edgeAbove?.let {
        val bottom = size.height - it.toPx()
        Rect(0f, bottom - SCROLL_EDGE.toPx(), size.width, bottom)
    }?.takeIf { it.height > 0f && it.bottom > 0f }
    val mask = band?.let {
        Brush.verticalGradient(0f to Color.Transparent, 1f to Color.Black, startY = it.top, endY = it.bottom)
    }
    val layer = Paint()
    onDrawWithContent {
        drawRect(ramp)
        drawContent()
        if (band != null && mask != null) {
            drawIntoCanvas { canvas ->
                canvas.saveLayer(band, layer)
                drawRect(strip, topLeft = band.topLeft, size = band.size)
                drawRect(mask, topLeft = band.topLeft, size = band.size, blendMode = BlendMode.DstIn)
                canvas.restore()
            }
        }
    }
}

/** The system navigation bar's height, which the tab bar stands on. */
@Composable
private fun navigationBottom(): Dp =
    WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

/** The slots: glyph, gap and label. */
private val TAB_BAR_BODY: Dp = 46.dp

/** The shell's padding round the chips — 22 outside, 8 of this, 14 inside. */
private val TAB_BAR_INSET: Dp = 8.dp

/** How far the slab floats off the navigation bar. */
private val TAB_BAR_LIFT: Dp = 8.dp

/**
 * Everything the bar takes above the navigation bar. The page keeps exactly
 * this much clear, and the toast stays above it.
 */
private val TAB_BAR_HEIGHT: Dp = TAB_BAR_LIFT + TAB_BAR_INSET * 2 + TAB_BAR_BODY

/** Where a toast's bottom edge sits, above the bottom of the screen. */
private val TOAST_LIFT: Dp = 96.dp

/** Room for the toast's shadow inside its own fade. */
private val TOAST_SHADOW_ROOM: Dp = 24.dp

/** How much of the tabs fades out above the bar — the spec's scroll-edge mask. */
private val SCROLL_EDGE: Dp = 28.dp

/** Scroll that turns the bar's light one degree: six, as on iOS. */
private const val SCROLL_DP_PER_DEGREE = 6f

/**
 * How far a tab travels before the light has swung its whole way, and where
 * the count stops mattering.
 */
private val SCROLL_SWING: Dp = (GlassSpec.LIGHT_ANGLE_SWING * SCROLL_DP_PER_DEGREE).dp

/** Scrolled further than this from rest, the bar's shadow deepens — iOS's eight. */
private val SCROLL_BUSY: Dp = 8.dp

/** The finest change in the count worth redrawing the bar for. */
private val SCROLL_STEP: Dp = 0.5.dp

/**
 * How far the tab on screen has travelled up from rest, which is what the
 * bar's light and shadow answer to, as the iPhone's bar's do.
 *
 * Heard rather than asked: the tabs keep their scroll states to themselves,
 * so this listens to what their columns tell the nested-scroll chain on the
 * way past and adds it up. The sum is the offset, because every tab opens at
 * rest and has the one column; and one thing puts it right if anything ever
 * slips past unheard — a column pulled down that gives nothing back is at its
 * top, whatever the sum says.
 *
 * Only the first [SCROLL_SWING] of it is published, in [SCROLL_STEP]s. Past
 * that the light has swung as far as it goes and nothing on the bar changes,
 * so the rest of a long scroll costs the bar nothing.
 */
private class TabScroll(private val swingPx: Float, private val stepPx: Float) : NestedScrollConnection {
    private var sum = 0f

    var travelled by mutableFloatStateOf(0f)
        private set

    override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
        // Pointer space: a column moving up reports its travel as negative.
        sum = if (consumed.y == 0f && available.y > 0f) 0f else (sum - consumed.y).coerceAtLeast(0f)
        val shown = sum.coerceAtMost(swingPx)
        val atEnd = shown == 0f || shown == swingPx
        if (abs(shown - travelled) >= stepPx || (atEnd && shown != travelled)) travelled = shown
        return Offset.Zero
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
 *
 * It still answers the tab under it, the way the iPhone's does. The light on
 * its rim swings with the scroll, a degree for every six dp and twenty-two at
 * most, and once the tab is more than eight dp from rest the shadow deepens:
 * the page is moving through the fade above the bar, and a shadow that sat
 * still through that would say the bar was painted on. Neither is a timer;
 * both come back as the tab does.
 */
@Composable
private fun TabBar(current: Tab, scroll: TabScroll, modifier: Modifier = Modifier, onPick: (Tab) -> Unit) {
    val p = P.current
    val surface = rememberGlassSurface(BackdropKind.Page)
    val reduceMotion = rememberReduceMotion()
    val chip = MMShapes.innerShape(22.dp, TAB_BAR_INSET)

    val travelled = with(LocalDensity.current) { scroll.travelled.toDp() }
    val light = GlassSpec.LIGHT_ANGLE +
        (travelled.value / SCROLL_DP_PER_DEGREE).coerceAtMost(GlassSpec.LIGHT_ANGLE_SWING)
    val busy = travelled > SCROLL_BUSY

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

    // The swing and the shadow reach the material through the two locals it
    // already reads, the way a button's press reaches its own. The chips and
    // the labels take no part: nothing they are handed changes as the tab
    // scrolls, so they skip, and what the scroll redraws is the pane.
    CompositionLocalProvider(
        LocalGlassLightAngle provides light,
        LocalGlassBusy provides busy,
    ) {
        BoxWithConstraints(
            modifier
                .fillMaxWidth()
                .padding(bottom = navigationBottom())
                .padding(start = 16.dp, end = 16.dp, bottom = TAB_BAR_LIFT)
                .mmGlass(backdrop = BackdropKind.Page, shape = MMShapes.r22)
                .padding(TAB_BAR_INSET)
                .height(TAB_BAR_BODY)
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
                    // Asked through labelInk, so Increase Contrast promotes it
                    // to ink and Reduce Transparency reads the app's own face,
                    // as every other label on glass does.
                    val tint = if (on) p.accentInk else surface.labelInk(quiet = true)
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
}


