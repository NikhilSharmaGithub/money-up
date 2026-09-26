package com.moneymove.game

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Where a game starts.
 *
 * iOS's Play tab, top to bottom and in its order, because it is the order
 * people actually use it in: the brand, the way back into a table still
 * running, who you are, today's coins and the quieter way to a couple more,
 * then the ways into a new game — straight in with whoever is playing, a
 * private table of your own, or a code somebody sent you — and last, where
 * the browsing starts: who is winning, and whose table you can walk into.
 *
 * The bell, the rules and the wallet are not up here, because they are not
 * on iOS's Play tab either: the bell rings on Social, the rules are read in
 * Settings and the coins are counted at the top of the Store — all three of
 * which this app has in the same places. The parameters that used to feed
 * that corner stay only so the scaffold that passes them still builds.
 */
@Suppress("UNUSED_PARAMETER")
@Composable
fun PlayTab(
    store: GameStore,
    account: AccountStore,
    unreadNotices: Int = 0,
    onNotices: () -> Unit = {},
    onHowTo: () -> Unit = {},
) {
    // Not drawn here — iOS shows the cup on Social and nowhere else — but
    // kept alive all the same: the cup poll is also the thing that walks a
    // player into the table they were drawn for, and somebody waiting on this
    // tab has to be seated as readily as somebody waiting on Social.
    rememberCupStore(store)

    LaunchedEffect(Unit) { account.refresh() }
    // The leaderboard is fetched with the History half of the account, and
    // this tab is where iOS shows it; asking here is what puts it on screen
    // for somebody who never opens History.
    LaunchedEffect(Unit) { account.refreshHistory() }
    // The poll hangs off the tab rather than off the card. The card is not
    // drawn while the list is empty, and an effect inside something that
    // never composes never starts — so the card could never appear at all.
    LaunchedEffect(Unit) { store.pollPublicRooms() }

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // iOS's tabPage: eighteen between cards, twenty off the top, and
            // no wider than 560 so a tablet reads as a column, not a banner.
            Column(
                Modifier
                    .widthIn(max = 560.dp)
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                BrandHeader(boards = account.boards?.boards?.size)
                ContinueCard(store)
                AccountCard(account, store)
                // Coins first, then the table: collecting is a two-second
                // errand and the reward reads as part of who you are.
                DailyCard(account, store)
                // The other way to a couple of coins, and a much quieter one:
                // nothing at all until the server turns ads on, and nothing
                // again once the day's views are spent.
                FreeCoinsOffer(account, store)
                QuickPlayCard(store)
                PrivateTableCard(store)
                LeaderboardCard(account)
                PublicRoomsCard(store)
            }
        }

        // The ad covers everything, tab bar included, because that is what
        // iOS's full-screen cover does. The offer above asked for it and is
        // waiting on the gate; this completes it.
        account.adRequest?.let { gate ->
            HouseAdBreak(account.adRequestCoins) { played -> gate.complete(played) }
        }
    }
}

// ── the brand ──────────────────────────────────────────────────────────────

/**
 * The mark, the name, the promise, and the three numbers that sell the
 * table. The first screen anybody sees, and iOS's opens with branding and a
 * reason to stay rather than a toolbar.
 */
@Composable
private fun BrandHeader(boards: Int?) {
    val p = P.current
    Column(
        Modifier.fillMaxWidth().padding(top = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        LogoMark(84.dp, Modifier.padding(top = 4.dp, bottom = 6.dp))
        Wordmark()
        Text(
            "Buy streets. Build hotels. Bankrupt your friends.",
            color = p.ink2, fontSize = 14.sp, fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        )
        // The count is the server's own shelf, once it has answered. It was a
        // "19" typed in here, and the day six continents joined the shelf the
        // header went on saying nineteen; 25 is only the stand-in until then.
        Row(
            Modifier.padding(top = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(26.dp),
        ) {
            BrandStat(boards?.takeIf { it > 0 }?.toString() ?: "25", "BOARDS")
            BrandStat("8", "PLAYERS")
            BrandStat("∞", "BANKRUPTCIES")
        }
    }
}

@Composable
private fun BrandStat(value: String, label: String) {
    val p = P.current
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        Text(value, color = p.gold, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
        Text(
            label,
            color = p.ink3, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
        )
    }
}

/**
 * The brand mark: an ivory die showing five, tipped a little, on a gold ring
 * — iOS's LogoMark (LogoView.swift) at the same proportions. Drawn rather
 * than shipped as a picture so it re-inks with every table style; the ring
 * is the palette's gold, and the die is ivory on every one of them, as it is
 * on iOS. Only the still version: the roll-in is iOS's splash, and Android's
 * splash is the system's.
 *
 * The box is the die; the ring spills past it, as iOS's does.
 */
@Composable
internal fun LogoMark(size: Dp, modifier: Modifier = Modifier) {
    val p = P.current
    val ring = p.gold.copy(alpha = 0.55f)
    val face = RoundedCornerShape(size * 0.19f)
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size)) {
            val d = this.size.minDimension
            drawCircle(
                color = ring,
                radius = d * 0.62f,
                center = center + Offset(0f, d * 0.02f),
                style = Stroke(width = d * 0.02f),
            )
        }
        Box(
            Modifier
                .size(size)
                .rotate(-11f)
                .shadow(size * 0.1f, face, clip = false, ambientColor = LOGO_SHADOW, spotColor = LOGO_SHADOW)
                .clip(face)
                .background(Brush.linearGradient(listOf(Color(0xFFFFFCF4), Color(0xFFEFE7D8))))
                .border(1.dp, Color.Black.copy(alpha = 0.12f), face),
        ) {
            Canvas(Modifier.fillMaxSize()) {
                val d = this.size.minDimension
                val r = d * 0.105f
                val off = d * 0.27f
                for ((x, y) in PIPS) {
                    drawCircle(LOGO_PIP, radius = r, center = center + Offset(x * off, y * off))
                }
            }
        }
    }
}

/** The classic five. */
private val PIPS = listOf(-1f to -1f, 1f to -1f, 0f to 0f, -1f to 1f, 1f to 1f)
private val LOGO_PIP = Color(0xFF1B5E3F)
private val LOGO_SHADOW = Color.Black.copy(alpha = 0.35f)

/** iOS's Wordmark: MONEY in ink, MOVE in the table's colour, heavy and a point apart. */
@Composable
internal fun Wordmark(fontSize: TextUnit = 40.sp) {
    val p = P.current
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(color = p.ink)) { append("MONEY") }
            withStyle(SpanStyle(color = p.red)) { append("MOVE") }
        },
        fontSize = fontSize,
        fontWeight = FontWeight.ExtraBold,
        letterSpacing = 1.sp,
        maxLines = 1,
    )
}

// ── the way back ───────────────────────────────────────────────────────────

/**
 * The way back into the table you stepped away from — the server has been
 * holding the seat, and a bot has been playing it.
 *
 * The newest table still going, which is the same entry that heads History's
 * "Still going without you", so the two can never disagree about which game
 * that is. Tapping it asks the table whether it is still there: a code whose
 * game has ended opens an empty room instead of failing, and the store reads
 * that as gone, says so, and takes the card away.
 */
@Composable
private fun ContinueCard(store: GameStore) {
    val latest = store.unfinishedGames.firstOrNull() ?: return
    val p = P.current
    val shape = RoundedCornerShape(16.dp)
    // Tables remembered before the list carried board names have none to
    // show, and "Room ab12 · " with nothing after it reads as a bug. Every
    // table iOS remembers has one, so with a name the line is iOS's exactly.
    val line = buildString {
        append("Room ${latest.roomId}")
        if (latest.mapName.isNotBlank()) append(" · ${latest.mapName}")
        if (latest.guests > 0) append(" · ${latest.guests + 1} players on this device")
    }
    Row(
        Modifier
            .fillMaxWidth()
            .cardShadow(shape)
            .clip(shape)
            .background(p.card)
            .border(1.5.dp, p.gold.copy(alpha = 0.55f), shape)
            .clickable { store.resume(latest) }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon("door", size = 24.dp, tint = p.gold)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Continue game", color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
            Text(line, color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }
        // iOS's twelve either side of a Spacer that never shrinks below
        // eight: the line wraps where the iPhone's does, not later.
        Spacer(Modifier.width(32.dp))
        RowChevron(p.gold, 13.dp)
    }
}

// ── today's coins ──────────────────────────────────────────────────────────

/** Days the ladder climbs before it tops out — seven pips is the whole climb. */
private const val LADDER = 7

private class Celebration(val amount: Int, val day: Int)

/**
 * Which of the card's faces is up, with what it needs to draw itself. Data
 * classes, so a recomposition that changes nothing hands the transition the
 * same face rather than a fresh one to animate towards.
 */
private sealed interface DailyFace {
    data class Party(val party: Celebration) : DailyFace
    data object Locked : DailyFace
    data class Claim(val d: DailyView) : DailyFace
    data class Quiet(val d: DailyView) : DailyFace
}

/**
 * The one reason to open the app on a day you weren't going to play.
 *
 * iOS's DailyRewardCard, in its order of loudness: a button in the table's
 * own colour while there is something to collect — crimson on Crimson, green
 * on Felt, violet on Royale, whatever style the player picked — a short
 * celebration the moment it lands, a single
 * muted line for the rest of the day — and, signed out, the reward behind a
 * sign-in, because a reward that vanishes without explanation reads as a
 * bug. Nothing at all until the server has answered: a coin you may not even
 * be owed should not flash a placeholder at the top of the screen.
 */
@Composable
private fun DailyCard(account: AccountStore, store: GameStore) {
    val d = account.daily ?: return
    val context = LocalContext.current
    var claiming by remember { mutableStateOf(false) }
    var celebrating by remember { mutableStateOf<Celebration?>(null) }

    // Only a spent day has a deadline. A second past it, so the server has
    // turned the page before it is asked; otherwise a phone left awake past
    // midnight sits on a countdown that has run out while the coins wait.
    LaunchedEffect(d.claimable, d.nextAt) {
        val next = d.nextAt ?: return@LaunchedEffect
        if (d.claimable) return@LaunchedEffect
        val wait = next.toLong() - System.currentTimeMillis() + 1_000
        if (wait <= 0) return@LaunchedEffect
        delay(wait)
        account.refresh()
    }

    val party = celebrating
    val face: DailyFace = when {
        // A celebration owns the card until it has finished playing; the
        // reload that lands halfway through must not yank it away mid-count.
        party != null -> DailyFace.Party(party)
        !d.signedIn -> DailyFace.Locked
        d.claimable -> DailyFace.Claim(d)
        else -> DailyFace.Quiet(d)
    }

    // iOS's springs between faces: the celebration grows in from 94% as it
    // fades up, and the quiet line settles in the same way after it.
    AnimatedContent(
        targetState = face,
        contentKey = { it::class },
        transitionSpec = {
            (fadeIn(tween(220)) + scaleIn(tween(300), initialScale = 0.94f)) togetherWith
                (fadeOut(tween(160)) + scaleOut(tween(160), targetScale = 0.94f)) using
                SizeTransform(clip = false)
        },
        label = "daily",
    ) { f ->
        when (f) {
            is DailyFace.Party -> DailyCelebration(f.party) { celebrating = null }
            DailyFace.Locked -> DailyLocked(
                signingIn = account.signingIn,
                canSignIn = account.auth?.google == true,
            ) { signInWithGoogleTapped(context, account, store) }
            is DailyFace.Claim -> DailyClaim(f.d, claiming) {
                if (claiming) return@DailyClaim
                claiming = true
                Haptics.tap()
                SoundKit.click()
                val offered = f.d.amount
                val day = f.d.streak + 1
                account.claimDaily { paid, error ->
                    claiming = false
                    if (paid == null) {
                        // Already claimed is the client being eager, not
                        // broken: the reload has turned the card to the day
                        // the server has, and there is nothing to say. Any
                        // other refusal is shown in the server's own words —
                        // going quiet on one would leave the button looking
                        // like it did nothing.
                        if (error != null) store.showToast(error, isError = true)
                        return@claimDaily
                    }
                    Haptics.turn()
                    SoundKit.gain()
                    // The count runs up to what the server paid, as iOS's does.
                    celebrating = Celebration(if (paid > 0) paid else offered, day)
                }
            }
            is DailyFace.Quiet -> DailyQuiet(f.d)
        }
    }
}

@Composable
private fun DailyHead(subtitle: String) {
    val p = P.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon("coin", size = 26.dp)
        Spacer(Modifier.width(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Daily reward", color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
            Text(subtitle, color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium)
        }
    }
}

/** Signed out. The coin has not gone anywhere — it is behind an account, and the card says which. */
@Composable
private fun DailyLocked(signingIn: Boolean, canSignIn: Boolean, onSignIn: () -> Unit) {
    val p = P.current
    LandingCard(padding = 16.dp) {
        DailyHead("Sign in and it is yours every day")
        Spacer(Modifier.height(11.dp))
        LadderStrip(0)
        Spacer(Modifier.height(11.dp))
        // The button wears the table's own colour, like Play now and every
        // other call to action on the tab, so changing the style changes it
        // too. iOS draws the key in plain ink — it is not handed the button's
        // colour — so it keeps its own dark shape on whatever colour that is.
        LandingButton(
            if (signingIn) "Signing in…" else "Sign in to collect",
            LandingKind.PRIMARY, big = true,
            enabled = !signingIn && canSignIn,
            lead = { ink ->
                // Stood upright, as SF's key.fill stands: the drawn key lies
                // corner to corner.
                if (signingIn) {
                    LandingSpinner(ink)
                } else {
                    Icon("key", size = 18.dp, tint = p.ink, modifier = Modifier.graphicsLayer { rotationZ = 45f })
                }
            },
        ) { onSignIn() }
        Spacer(Modifier.height(11.dp))
        Text(
            "Signing in unlocks the daily reward.",
            color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
        )
    }
}

/** Coins on the table: the loudest thing on the tab for as long as it takes to tap it. */
@Composable
private fun DailyClaim(d: DailyView, claiming: Boolean, onClaim: () -> Unit) {
    val p = P.current
    val day = d.streak + 1
    val amount = d.amount
    LandingCard(padding = 16.dp) {
        DailyHead(if (day > 1) "Day $day of your streak" else "Waiting for you")
        Spacer(Modifier.height(11.dp))
        // Days already banked, not counting today's — today's pip is the one
        // the button lights, and the celebration is the only place it does.
        LadderStrip(day - 1)
        Spacer(Modifier.height(11.dp))
        LandingButton(
            if (claiming) "Collecting…" else "Collect $amount ${if (amount == 1) "coin" else "coins"}",
            LandingKind.PRIMARY, big = true,
            enabled = !claiming,
            lead = { ink -> if (claiming) LandingSpinner(ink) else Icon("coin", size = 19.dp) },
        ) { onClaim() }
        Spacer(Modifier.height(11.dp))
        Text(
            if (day >= LADDER) "Your streak is paying the most it ever will — just don't break it."
            else "Come back tomorrow and it pays a little more.",
            color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
        )
    }
}

/**
 * The few seconds the coins land in: the card takes the table's colour, the
 * number runs up from nothing, and today's pip lights.
 *
 * The table's colour, not gold — the reward used to be the one gold thing on
 * a crimson or royal page, and a card that ignored the style a player picked
 * read as a piece of some other app. The coin stays gold: it is a coin. The
 * card's own fill stays card-coloured, because iOS lays its soft wash behind
 * a card that is already opaque, so on the iPhone the rim is all of that
 * colour anybody sees.
 */
@Composable
private fun DailyCelebration(party: Celebration, onDone: () -> Unit) {
    val p = P.current
    var counted by remember { mutableIntStateOf(0) }
    val pop = remember { Animatable(0f) }
    LaunchedEffect(party) {
        launch { pop.animateTo(1f, spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMediumLow)) }
        // Coins land one after another rather than all at once — the number
        // arriving is the whole point of having tapped the button.
        if (party.amount > 0) {
            val steps = minOf(22, party.amount)
            for (i in 1..steps) {
                val t = i.toFloat() / steps
                val eased = 1f - (1f - t).pow(3)
                counted = (party.amount * eased).roundToInt()
                delay(28)
            }
        }
        counted = party.amount
        delay(1_400)
        onDone()
    }
    LandingCard(padding = 16.dp, stroke = p.red.copy(alpha = 0.7f), strokeWidth = 1.5.dp) {
        Column(
            Modifier.fillMaxWidth().padding(vertical = 4.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Icon(
                "coin", size = 40.dp,
                modifier = Modifier
                    .scale(0.6f + 0.4f * pop.value)
                    .rotate(-25f * (1f - pop.value)),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "+$counted",
                    color = p.red, fontSize = 34.sp, fontWeight = FontWeight.Black,
                    style = TABULAR,
                )
                Spacer(Modifier.width(5.dp))
                Text(
                    if (counted == 1) "coin" else "coins",
                    color = p.red.copy(alpha = 0.85f), fontSize = 15.sp, fontWeight = FontWeight.ExtraBold,
                )
            }
            Text(
                if (party.day > 1) "Day ${party.day} in a row" else "Day one — see you tomorrow",
                color = p.ink2, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
            )
            LadderStrip(party.day, Modifier.padding(horizontal = 20.dp))
        }
    }
}

/** The other twenty-three hours: one line, no button, no colour. */
@Composable
private fun DailyQuiet(d: DailyView) {
    val p = P.current
    // The countdown is the only moving part, and it only moves twice a
    // minute — a clock, not an animation.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            now = System.currentTimeMillis()
        }
    }
    val head = if (d.streak > 0) "Day ${d.streak} collected" else "Collected"
    val wait = d.nextAt?.let { "$head · next in ${untilText(it.toLong() - now)}" } ?: head
    LandingCard(padding = 13.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon("coin", size = 20.dp, alpha = 0.7f)
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Back tomorrow", color = p.ink2, fontSize = 13.5.sp, fontWeight = FontWeight.Bold)
                Text(wait, color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.Medium)
            }
            if (d.amount > 0) {
                Spacer(Modifier.width(28.dp))
                Text(
                    "+${d.amount}",
                    color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(99.dp))
                        .background(p.sunken)
                        .padding(horizontal = 9.dp, vertical = 4.dp),
                )
            }
        }
    }
}

/** "7h 12m", then "12m", then "40s" — coarse until it matters. */
private fun untilText(ms: Long): String {
    val secs = maxOf(0L, ms / 1000)
    val hours = secs / 3600
    val mins = (secs % 3600) / 60
    return when {
        hours > 0 -> "${hours}h ${mins}m"
        mins > 0 -> "${mins}m"
        else -> "${secs}s"
    }
}

/**
 * Seven pips: the whole climb from day one to the top of the ladder, lit in
 * the table's own colour so the strip follows the style with the button.
 */
@Composable
private fun LadderStrip(day: Int, modifier: Modifier = Modifier) {
    val p = P.current
    val lit = day.coerceIn(0, LADDER)
    val pill = RoundedCornerShape(99.dp)
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        repeat(LADDER) { i ->
            val on = i < lit
            Box(
                Modifier
                    .weight(1f)
                    .height(5.dp)
                    .clip(pill)
                    .background(if (on) p.red else p.sunken)
                    .then(if (on) Modifier else Modifier.border(1.dp, p.rule, pill)),
            )
        }
    }
}

// ── a couple more coins ────────────────────────────────────────────────────

/** What AccountStore says when the ad was waved away before it finished. */
private const val AD_CLOSED_EARLY = "The ad was closed before it finished."

/**
 * iOS's FreeCoinsOffer: a quiet offer under the daily reward, and on purpose
 * the plainest card on the tab — a gift you have to work five seconds for
 * should never outshout the one that costs nothing. It never nags: nothing
 * plays by itself, and once today's views are spent the card is gone rather
 * than greyed out.
 */
@Composable
private fun FreeCoinsOffer(account: AccountStore, store: GameStore) {
    val spec = account.ads?.placement("freeCoins") ?: return
    if (spec.remaining <= 0) return
    val p = P.current
    val busy = account.adPlaying != null
    val worth = spec.coins
    val tile = RoundedCornerShape(11.dp)
    // While an ad is on its way the button holds a spinner and nothing else.
    val spinner: (@Composable (Color) -> Unit)? = if (busy) {
        { ink -> LandingSpinner(ink) }
    } else {
        null
    }
    LandingCard(padding = 13.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(34.dp)
                    .clip(tile)
                    .background(p.sunken)
                    .border(1.dp, p.rule, tile),
                contentAlignment = Alignment.Center,
            ) {
                Icon("ticket", size = 18.dp, tint = p.ink2)
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(
                    "Watch an ad for $worth coin${if (worth == 1) "" else "s"}",
                    color = p.ink, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                )
                Text(
                    "${spec.remaining} left today",
                    color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
                )
            }
            Spacer(Modifier.width(28.dp))
            LandingButton(
                if (busy) "" else "Watch",
                LandingKind.GHOST,
                enabled = !busy,
                lead = spinner,
            ) {
                Haptics.tap()
                SoundKit.click()
                account.watchAd("freeCoins") { error, paid ->
                    // iOS's words for each ending, so the same five seconds
                    // end the same way on either phone — and the thank-you
                    // names what the claim actually paid, not the offer's quote.
                    when (error) {
                        null -> store.showToast(
                            "+$paid coin${if (paid == 1) "" else "s"} — thanks for watching.",
                            glyph = "coin",
                        )
                        AD_CLOSED_EARLY -> store.showToast("Closed early — nothing was paid for that one.")
                        else -> store.showToast(error, isError = true)
                    }
                }
            }
        }
    }
}

// ── the ways in ────────────────────────────────────────────────────────────

/**
 * The shortest path to a table: one tap and the server seats you wherever
 * people are already waiting. It never traps anyone — while the request is
 * in flight only this button waits, and create and join stay live below.
 */
@Composable
private fun QuickPlayCard(store: GameStore) {
    val p = P.current
    val scope = rememberCoroutineScope()
    val searching = store.quickSearching
    LandingCard(padding = 16.dp) {
        LandingButton(
            if (searching) "Finding a table…" else "Play now",
            LandingKind.PRIMARY, big = true, gap = 9.dp,
            enabled = !searching,
            // person.2.fill: both figures solid, as Apple draws the pair.
            lead = { ink -> if (searching) LandingSpinner(ink) else SfMark("person.2.fill", 19.dp, ink) },
        ) {
            Haptics.tap()
            SoundKit.click()
            scope.launch {
                val room = store.quickplay()
                when {
                    // Nothing answered inside iOS's eight seconds, or an
                    // answer with no table in it — iOS words the two apart.
                    room == null -> store.showToast(
                        "Couldn't reach matchmaking — create or join a room instead", isError = true,
                    )
                    room.isEmpty() -> store.showToast(
                        "Matchmaking didn't answer — create or join a room instead", isError = true,
                    )
                    // Sat down somewhere else while this was looking — a
                    // code, a private table. That table wins; being yanked
                    // out of it by a late answer would not.
                    store.roomId == null -> store.connect(room)
                }
            }
        }
        Spacer(Modifier.height(9.dp))
        Text(
            if (searching) "Looking for a table with room…"
            else "Straight into a game with whoever else is playing right now.",
            color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium,
        )
    }
}

/**
 * Who you are at the next table, then a private table of your own, or a code
 * somebody sent you. The flag is picked in Settings' profile card, as on iOS
 * — one place for who you are, rather than two copies drifting apart.
 */
@Composable
private fun PrivateTableCard(store: GameStore) {
    val p = P.current
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var rollingName by remember { mutableStateOf(false) }

    fun join() {
        val room = code.trim().lowercase()
        if (room.isEmpty() || creating) return
        store.connect(room)
    }

    LandingCard(padding = 16.dp) {
        PanelTitle("Nickname")
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { NameField(store) }
            Spacer(Modifier.width(8.dp))
            // Empty until the player types or taps this — a name picked for
            // them reads as their name, and they would carry it to the table
            // without ever having chosen it.
            LandingButton(
                "", LandingKind.GOLD,
                modifier = Modifier.semantics { contentDescription = "Pick a random nickname" },
                enabled = !rollingName,
                lead = { ink -> DieFive(ink, hole = p.gold) },
            ) {
                rollingName = true
                SoundKit.click()
                Haptics.tap()
                scope.launch {
                    store.rollNickname()
                    rollingName = false
                }
            }
        }
        Spacer(Modifier.height(14.dp))
        LandingButton(
            "Create a private game",
            LandingKind.GHOST, big = true,
            enabled = !creating,
            lead = { ink -> Icon("dice", size = 19.dp, tint = ink) },
        ) {
            creating = true
            scope.launch {
                val room = store.createRoom()
                creating = false
                when {
                    room == null -> store.showToast("Could not create a room", isError = true)
                    store.roomId == null -> store.connect(room)
                }
            }
        }
        Spacer(Modifier.height(14.dp))
        OrDivider()
        Spacer(Modifier.height(14.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            // The keyboard's own Go joins too, as iOS's return key does:
            // somebody who has just typed a code is already there.
            Box(Modifier.weight(1f)) {
                CodeField(code, onChange = { code = it }, onGo = ::join)
            }
            Spacer(Modifier.width(8.dp))
            // Solid whether or not a code is in the box, as on iOS: the
            // button is where the eye goes, and a blank tap simply does
            // nothing rather than the button fading in and out as you type.
            LandingButton(
                "Join", LandingKind.PRIMARY,
                enabled = code.isNotBlank() && !creating,
            ) { join() }
        }
        // Where iOS says why a code was refused. A refusal lands while the
        // table screen is up, and leaving it clears the reason on both
        // phones, so in practice the table screen is where it is read —
        // but when there is one to show, this is where iOS shows it too.
        store.joinError?.let { err ->
            Spacer(Modifier.height(14.dp))
            Text(err, color = p.bad, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
        }
    }
}

// ── who is winning ─────────────────────────────────────────────────────────

/**
 * iOS's LeaderboardCard: the lifetime table of who has actually won the most
 * games, ever — the five that matter on the card, and the whole fifty a tap
 * away. Standing thirty-first is still a standing, so a player outside the
 * five gets their own row underneath rather than news they have to go and
 * look for. Nothing at all until the board has arrived.
 */
@Composable
private fun LeaderboardCard(account: AccountStore) {
    val top = account.leaderboard
    if (top.isEmpty()) return
    val p = P.current
    var showAll by remember { mutableStateOf(false) }
    val myCode = account.me?.code?.takeIf { it.isNotBlank() }
    val mine = myCode?.let { c -> top.indexOfFirst { it.code == c }.takeIf { it >= 0 } }

    LandingCard(padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon("trophy", size = 13.dp)
            Spacer(Modifier.width(6.dp))
            PanelTitle("Leaderboard")
            Spacer(Modifier.weight(1f))
            if (top.size > 5) {
                LandingButton("See all", LandingKind.GHOST) {
                    SoundKit.click()
                    showAll = true
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            top.take(5).forEachIndexed { rank, entry ->
                LeaderboardRow(rank, entry, isMe = myCode != null && entry.code == myCode)
            }
            if (mine != null && mine >= 5) {
                Box(Modifier.fillMaxWidth().padding(vertical = 1.dp).height(1.dp).background(p.rule))
                LeaderboardRow(mine, top[mine], isMe = true)
            }
        }
        // Inside the card rather than after it, so that whatever the sheet
        // leaves behind in the layout costs the tab's spacing nothing.
        if (showAll) LeaderboardSheet(top, myCode) { showAll = false }
    }
}

/**
 * The whole fifty. iOS opens it at half height with a grabber, the title in
 * the middle and Done on the right; and deep down the list your own row is
 * the one you opened it for, so it is brought on screen rather than left for
 * you to scroll to.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
private fun LeaderboardSheet(entries: List<LeaderRow>, myCode: String?, onDismiss: () -> Unit) {
    val p = P.current
    val sheet = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val finder = remember { BringIntoViewRequester() }
    val mine = myCode?.let { c -> entries.indexOfFirst { it.code == c } } ?: -1

    fun close() {
        scope.launch { sheet.hide() }.invokeOnCompletion { onDismiss() }
    }

    LaunchedEffect(mine) {
        if (mine < 8) return@LaunchedEffect
        delay(300)
        // Asking for a band either side of the row, not just the row, is
        // what lands it near the middle rather than pinned to an edge.
        val band = with(density) { 220.dp.toPx() }
        finder.bringIntoView(Rect(0f, -band, 1f, band))
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheet,
        containerColor = p.sheet,
        dragHandle = {
            Box(
                Modifier
                    .padding(top = 5.dp)
                    .size(36.dp, 5.dp)
                    .clip(RoundedCornerShape(99.dp))
                    .background(p.ink3.copy(alpha = 0.5f)),
            )
        },
    ) {
        Box(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 16.dp)) {
            Text(
                "Leaderboard",
                color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.align(Alignment.Center),
            )
            Text(
                "Done",
                color = p.red, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { close() }
                    .padding(horizontal = 4.dp, vertical = 6.dp),
            )
        }
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "Every game these players have ever won. Only wins get you on the board.",
                color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.Medium,
            )
            LandingCard(padding = 14.dp) {
                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    entries.forEachIndexed { rank, entry ->
                        LeaderboardRow(
                            rank, entry,
                            isMe = myCode != null && entry.code == myCode,
                            modifier = if (rank == mine) Modifier.bringIntoViewRequester(finder) else Modifier,
                        )
                    }
                }
            }
        }
    }
}

/** One line of the table, iOS's LeaderboardRow: the podium gets its metal, everyone below it their number. */
@Composable
private fun LeaderboardRow(rank: Int, entry: LeaderRow, isMe: Boolean, modifier: Modifier = Modifier) {
    val p = P.current
    val shape = RoundedCornerShape(12.dp)
    Row(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (isMe) p.goldSoft else p.sunken)
            .border(if (isMe) 1.5.dp else 1.dp, if (isMe) p.gold else p.rule, shape)
            .padding(horizontal = 9.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(26.dp), contentAlignment = Alignment.Center) {
            when (rank) {
                0 -> Icon("medalGold", size = 22.dp)
                1 -> Icon("medalSilver", size = 22.dp)
                2 -> Icon("medalBronze", size = 22.dp)
                else -> Text(
                    "${rank + 1}",
                    color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.Bold, style = TABULAR,
                )
            }
        }
        Spacer(Modifier.width(10.dp))
        // The player's own flag, which they chose — so theirs to show as it
        // is, the one emoji on the row.
        if (entry.flag.isNotBlank()) {
            Text(entry.flag, fontSize = 18.sp)
            Spacer(Modifier.width(10.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    entry.name.ifBlank { "Player" },
                    color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (isMe) {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "YOU",
                        color = p.accentInk, fontSize = 8.sp, fontWeight = FontWeight.Black,
                        letterSpacing = 0.8.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(99.dp))
                            .background(p.gold)
                            .padding(horizontal = 5.dp, vertical = 2.dp),
                    )
                }
            }
            Text(
                money(entry.winnings) + " won, all-time",
                color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.Medium,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.width(26.dp))
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "${entry.wins}",
                color = p.gold, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, style = TABULAR,
            )
            Text(
                if (entry.wins == 1) "WIN" else "WINS",
                color = p.ink3, fontSize = 7.5.sp, fontWeight = FontWeight.Black, letterSpacing = 0.8.sp,
            )
        }
    }
}

// ── the tables anyone can walk into ────────────────────────────────────────

/**
 * Open tables, the same list the web landing shows. It carries games already
 * under way too, and those are a different offer — a seat to sit in, or a
 * table to watch — so each row says which before the tap. Hidden entirely
 * while the list is empty, as on iOS: no "nobody's playing" line.
 */
@Composable
private fun PublicRoomsCard(store: GameStore) {
    val rooms = store.publicRooms
    if (rooms.isEmpty()) return
    val p = P.current
    LandingCard(padding = 16.dp) {
        PanelTitle("Public rooms")
        Spacer(Modifier.height(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (room in rooms) {
                val note = when {
                    room.canSit -> ""
                    room.isPlaying -> " · in play, watch only"
                    else -> " · full"
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(p.sunken)
                        .clickable { store.connect(room.id) }
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // eye.fill for a table only to watch — solid, with its
                    // iris cut out, as iOS's symbol is.
                    if (room.canSit) Icon("globe", size = 20.dp, tint = p.ink2) else SfMark("eye.fill", 20.dp, p.ink2)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                        Text(room.map, color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        Text(
                            "${room.players} of ${room.maxPlayers} players · ${room.id}$note",
                            color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold,
                        )
                    }
                    Spacer(Modifier.width(28.dp))
                    RowChevron(p.ink3, 12.dp)
                }
            }
        }
    }
}

// ── the fields ─────────────────────────────────────────────────────────────

@Composable
private fun OrDivider() {
    val p = P.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(1.dp).background(p.rule))
        Text(
            "or join with a code",
            color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 10.dp),
        )
        Box(Modifier.weight(1f).height(1.dp).background(p.rule))
    }
}

/**
 * What this player is called at the next table. Sixteen characters, because
 * that is what the server keeps of a name — anything longer would be cut at
 * the table without a word. The store writes it through to disk as it is
 * typed.
 */
@Composable
private fun NameField(store: GameStore) {
    val p = P.current
    val shape = RoundedCornerShape(12.dp)
    BasicTextField(
        value = store.nickname,
        // No cap while typing, as on iOS: the server trims a name at the
        // table, and a field that stops answering reads as a broken keyboard.
        onValueChange = { store.nickname = it },
        singleLine = true,
        textStyle = TextStyle(color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
        cursorBrush = SolidColor(p.red),
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.Words,
            autoCorrectEnabled = false,
        ),
        decorationBox = { inner ->
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(shape)
                    .background(p.sunken)
                    .border(1.dp, p.rule, shape)
                    .padding(12.dp),
            ) {
                if (store.nickname.isEmpty()) {
                    Text("Your nickname", color = p.ink3, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
                inner()
            }
        },
    )
}

/**
 * The code box. Its hint is the phone's own placeholder grey, not the
 * table's quietest ink: iOS gives this field no prompt colour of its own,
 * so the iPhone draws the system one, and so does this.
 */
@Composable
private fun CodeField(value: String, onChange: (String) -> Unit, onGo: () -> Unit) {
    val p = P.current
    val shape = RoundedCornerShape(12.dp)
    val placeholder = if (p.page.luminance() < 0.5f) Color(0x4DEBEBF5) else Color(0x4D3C3C43)
    val style = TextStyle(
        color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.Bold,
        fontFamily = FontFamily.Monospace,
    )
    BasicTextField(
        value = value,
        // iOS's tidy: lower case, no spaces, and nothing else taken away.
        onValueChange = { onChange(it.lowercase().filter { c -> !c.isWhitespace() }) },
        singleLine = true,
        textStyle = style,
        cursorBrush = SolidColor(p.red),
        // iOS asks for .asciiCapable: a code is letters and digits, and a
        // keyboard with emoji and other scripts on it only invites typos.
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.None,
            autoCorrectEnabled = false,
            keyboardType = KeyboardType.Ascii,
            imeAction = ImeAction.Go,
        ),
        keyboardActions = KeyboardActions(onGo = { onGo() }),
        decorationBox = { inner ->
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(shape)
                    .background(p.sunken)
                    .border(1.dp, p.rule, shape)
                    .padding(12.dp),
            ) {
                if (value.isEmpty()) Text("room code", style = style.copy(color = placeholder))
                inner()
            }
        },
    )
}

/**
 * The die on the nickname button: iOS's die.face.5.fill, a solid face with
 * its five pips punched through to the button underneath. There is no
 * one-die glyph in the shared set — "dice" is a pair — so it is drawn here
 * at the size the iPhone draws it.
 */
@Composable
private fun DieFive(ink: Color, hole: Color) {
    Box(Modifier.size(width = 24.dp, height = 26.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(18.dp)) {
            val s = this.size.minDimension
            drawRoundRect(ink, size = Size(s, s), cornerRadius = CornerRadius(s * 0.22f))
            val r = s * 0.095f
            val off = s * 0.25f
            for ((x, y) in PIPS) {
                drawCircle(hole, radius = r, center = center + Offset(x * off, y * off))
            }
        }
    }
}

// ── iOS's building blocks, point for point ─────────────────────────────────
//
// The landing screens are the ones held up beside the iPhone, and they were
// given iOS's MMCard and MMButtonStyle here before Ui.kt's Panel and MMButton
// were brought to the same measurements. The two now agree; these stay for
// the lead slot (a spinner or a coin handed the label's ink) and the press
// feel the landing cards were built around.

/** iOS's MMCard shadow: a soft drop under every card on the landing screen. */
private fun Modifier.cardShadow(shape: RoundedCornerShape): Modifier =
    shadow(6.dp, shape, clip = false)

/**
 * iOS's MMCard: sixteen-point corners, the card fill, a hairline, and the
 * shadow. [stroke] swaps the hairline for a rim of its own, as the daily
 * reward's celebration does.
 */
@Composable
internal fun LandingCard(
    modifier: Modifier = Modifier,
    padding: Dp = 14.dp,
    stroke: Color? = null,
    strokeWidth: Dp = 1.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val p = P.current
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier
            .fillMaxWidth()
            .cardShadow(shape)
            .clip(shape)
            .background(p.card)
            .border(strokeWidth, stroke ?: p.rule, shape)
            .padding(padding),
        content = content,
    )
}

/** iOS's MMButtonStyle kinds, as far as the landing screens use them. */
internal enum class LandingKind { PRIMARY, GOLD, GHOST }

/**
 * iOS's MMButtonStyle, point for point: seventeen bold on a big button and
 * fourteen on a small one, fourteen- and ten-point corners, a faint white
 * rim on the coloured kinds, and a ghost that is a filled well rather than
 * an outline. Pressing dims and shrinks it a touch, as on the iPhone.
 *
 * Disabled changes nothing about how it looks — iOS's style never reads the
 * disabled state, so its buttons stay solid and simply stop answering. What
 * leads the label is the caller's, handed the ink the label is drawn in.
 */
@Composable
internal fun LandingButton(
    text: String,
    kind: LandingKind,
    modifier: Modifier = Modifier,
    big: Boolean = false,
    enabled: Boolean = true,
    gap: Dp = 8.dp,
    lead: (@Composable (ink: Color) -> Unit)? = null,
    onClick: () -> Unit,
) {
    val p = P.current
    val bg = when (kind) {
        LandingKind.PRIMARY -> p.red
        LandingKind.GOLD -> p.gold
        LandingKind.GHOST -> p.sunken
    }
    val ink = if (kind == LandingKind.GHOST) p.ink else p.accentInk
    val shape = RoundedCornerShape(if (big) 14.dp else 10.dp)
    val touches = remember { MutableInteractionSource() }
    val pressed by touches.collectIsPressedAsState()
    val press by animateFloatAsState(
        if (pressed) 1f else 0f,
        spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMedium),
        label = "press",
    )
    Row(
        modifier
            .then(if (big) Modifier.fillMaxWidth() else Modifier)
            .graphicsLayer {
                val s = 1f - 0.02f * press
                scaleX = s
                scaleY = s
                alpha = 1f - 0.18f * press
            }
            .clip(shape)
            .background(bg)
            .then(
                if (kind == LandingKind.GHOST) Modifier
                else Modifier.border(1.dp, Color.White.copy(alpha = 0.18f), shape),
            )
            .clickable(
                interactionSource = touches,
                indication = null,
                enabled = enabled,
                role = Role.Button,
                onClick = onClick,
            )
            .padding(horizontal = if (big) 22.dp else 14.dp, vertical = if (big) 14.dp else 9.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (lead != null) {
            lead(ink)
            if (text.isNotEmpty()) Spacer(Modifier.width(gap))
        }
        if (text.isNotEmpty()) {
            Text(
                text,
                color = ink, fontSize = if (big) 17.sp else 14.sp, fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * The iPhone's spinner — eight spokes, the newest brightest, stepping round
 * once a second — for the places iOS puts a ProgressView inside a button.
 */
@Composable
internal fun LandingSpinner(tint: Color, size: Dp = 20.dp) {
    val spin = rememberInfiniteTransition(label = "spinner")
    val turn by spin.animateFloat(
        0f, 8f,
        infiniteRepeatable(tween(1_000, easing = LinearEasing)),
        label = "turn",
    )
    Canvas(Modifier.size(size)) {
        val r = this.size.minDimension / 2
        val head = turn.toInt() % 8
        for (i in 0 until 8) {
            val age = (head - i + 8) % 8
            rotate(i * 45f) {
                drawLine(
                    tint.copy(alpha = tint.alpha * (1f - age * 0.1f).coerceAtLeast(0.3f)),
                    start = Offset(center.x, center.y - r * 0.5f),
                    end = Offset(center.x, center.y - r * 0.88f),
                    strokeWidth = r * 0.2f,
                    cap = StrokeCap.Round,
                )
            }
        }
    }
}

/** iOS's PanelTitle: small capitals, one point apart, in the quietest ink. */
@Composable
private fun PanelTitle(text: String) {
    Text(
        text.uppercase(),
        color = P.current.ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
    )
}

/** Figures that line up as they count, as iOS's monospacedDigit does. */
private val TABULAR = TextStyle(fontFeatureSettings = "tnum")
