package com.moneymove.game

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.graphics.graphicsLayer
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch

/*
 * The first two minutes.
 *
 * Somebody who has never played this opens the app and sees a Play button and
 * five tabs. They can work it out — property games are old and most people
 * half-know the rules — but "half-know" is where a new player loses their
 * first game to somebody who owns a full set, and losing your first game
 * without understanding why is how you stop playing.
 *
 * So: six cards, once, before anything else. The turn, why full sets decide
 * games, why deals matter, and then what the app does that a board game
 * cannot. The same six iOS shows, word for word, so a player who moves from
 * one phone to the other has been told the same things.
 *
 * It is skippable from the first frame, because a player who wants to play
 * now is the best kind of player. It can be read again from Settings, so
 * skipping costs nothing. And it is versioned rather than a yes or no: when
 * there is genuinely something new worth two minutes, the number goes up and
 * it shows once more.
 */

/** Bump this when the intro gains something existing players should see. */
const val INTRO_VERSION = 1

/** One card: a drawing, a headline, a line under it, and two or three points, each with its own drawing. */
private class IntroPage(
    val glyph: String,
    val title: String,
    val line: String,
    val points: List<Pair<String, String>>,
)

private val INTRO_PAGES = listOf(
    IntroPage(
        "globe", "Welcome to MoneyMove",
        "Buy streets. Build hotels. Bankrupt your friends.",
        listOf(
            "people" to "Two to eight players, on one phone or across the world",
            "map" to "Twenty-five boards — a world tour, six continents, single countries, and a few odd ones",
            "dice" to "A game runs about half an hour",
        ),
    ),
    IntroPage(
        "dice", "A turn is three things",
        "Roll, move, and deal with wherever you land.",
        listOf(
            "dice" to "Roll two dice and move. A double lets you roll again — three in a row and you are in prison",
            "key" to "Land on a street nobody owns and you may buy it. Turn it down and everyone bids for it",
            "payment" to "Land on somebody else's and you pay their rent",
        ),
    ),
    IntroPage(
        "houses", "Whole sets win games",
        "One street collects pennies. A country collects the game.",
        listOf(
            "crane" to "Own every street of one colour and you can build — houses first, then a hotel",
            "cash" to "Rent climbs steeply with each one. A hotel on a good set ends most games",
            "warning" to "This is the rule new players lose to. Chase sets, not bargains",
        ),
    ),
    IntroPage(
        "trade", "Deals decide it",
        "Nobody completes a set by luck alone.",
        listOf(
            "trade" to "Offer cash, streets and prison cards to anyone, any time",
            "gavel" to "A street somebody refuses goes to auction — that is where sets get finished",
            "bank" to "Short of money? Mortgage a street for half, and buy it back later",
        ),
    ),
    IntroPage(
        "people", "Play with anyone",
        "One tap and you are at a table.",
        listOf(
            "bolt" to "Play now drops you in with whoever else is online",
            "door" to "Or make a private room and send the link to your friends",
            "ticket" to "Nobody around? Pass one phone around the table instead",
        ),
    ),
    IntroPage(
        "trophy", "Cups, coins and boards",
        "There is more here than one game.",
        listOf(
            "trophy" to "Tournaments run to a clock, with real prizes for the last few standing",
            "coin" to "Win games and turn up daily to earn coins",
            "map" to "Two boards are free every day. Spend the coins to keep the ones you love",
        ),
    ),
)

/**
 * The intro itself: six cards that swipe both ways, a dot for each, and a way
 * out of every one. `onDone` runs when they finish it or skip it — either way
 * it is done, and whoever opened it decides what that means: the first launch
 * records the version, the Settings row simply closes.
 *
 * It paints the whole screen and keeps clear of the system bars itself, so it
 * can sit over the app's root or fill a dialog window the same way.
 */
@Composable
fun WelcomeIntro(onDone: () -> Unit) {
    val p = P.current
    val pager = rememberPagerState(pageCount = { INTRO_PAGES.size })
    val scope = rememberCoroutineScope()
    val page = pager.currentPage
    val last = page == INTRO_PAGES.lastIndex

    fun finish() {
        SoundKit.click()
        onDone()
    }

    // Back steps back a card rather than leaving: a card read too fast is
    // exactly the one somebody wants again. On the first card there is
    // nothing behind it, and back goes wherever back goes.
    BackHandler(enabled = page > 0) {
        scope.launch { pager.animateScrollToPage(page - 1) }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.linearGradient(listOf(p.page, p.page2)))
            // Takes every touch that lands on it, so nothing underneath can
            // be pressed through the gaps between the cards.
            .pointerInput(Unit) {}
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            // Out, from the first frame.
            Row(Modifier.fillMaxWidth()) {
                Spacer(Modifier.weight(1f))
                Text(
                    "Skip",
                    color = p.ink3, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(99.dp))
                        .clickable { finish() }
                        .padding(horizontal = 18.dp, vertical = 10.dp),
                )
            }

            HorizontalPager(
                state = pager,
                modifier = Modifier.weight(1f).fillMaxWidth(),
            ) { i -> IntroCard(INTRO_PAGES[i]) }

            // The dots, drawn rather than borrowed, so they sit where the
            // rest of the app's chrome sits.
            Row(
                Modifier.padding(bottom = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                for (i in INTRO_PAGES.indices) {
                    val width by animateDpAsState(
                        if (i == page) 20.dp else 7.dp,
                        spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow),
                        label = "dot",
                    )
                    Box(
                        Modifier
                            .size(width, 7.dp)
                            .clip(RoundedCornerShape(99.dp))
                            .background(if (i == page) p.gold else p.rule),
                    )
                }
            }

            // iOS's own big button rather than the shared one, so the last
            // card's gold "Let's play" is the iPhone's size and weight.
            LandingButton(
                if (last) "Let's play" else "Next",
                if (last) LandingKind.GOLD else LandingKind.PRIMARY, big = true,
                modifier = Modifier
                    .padding(horizontal = 22.dp)
                    .padding(bottom = 10.dp),
            ) {
                if (last) finish()
                else {
                    SoundKit.click()
                    scope.launch { pager.animateScrollToPage(page + 1) }
                }
            }

            Text(
                "You can read all this again in Settings.",
                color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(bottom = 18.dp),
            )
        }
    }
}

/**
 * One card: the hero drawing in the gold medallion the rest of the app uses
 * for something worth looking at, the headline, and the points. Centred in
 * the space the pager gives it, and scrollable when a small phone with large
 * text gives it less than it needs.
 */
@Composable
private fun IntroCard(page: IntroPage) {
    val p = P.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = maxHeight)
                .padding(horizontal = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        ) {
            Box(
                Modifier
                    .size(116.dp)
                    .clip(CircleShape)
                    .background(p.goldSoft)
                    .border(1.5.dp, p.gold.copy(alpha = 0.55f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                IntroGlyph(page.glyph, 54.dp, p.gold)
            }

            Column(
                Modifier.padding(horizontal = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Text(
                    page.title,
                    color = p.ink, fontSize = 25.sp, fontWeight = FontWeight.Black,
                    textAlign = TextAlign.Center,
                )
                Text(
                    page.line,
                    color = p.ink2, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Center,
                )
            }

            val shape = RoundedCornerShape(18.dp)
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(shape)
                    .background(p.card)
                    .border(1.dp, p.rule, shape)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(13.dp),
            ) {
                for ((glyph, text) in page.points) {
                    Row(verticalAlignment = Alignment.Top) {
                        Box(
                            Modifier
                                .size(36.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(p.sunken),
                            contentAlignment = Alignment.Center,
                        ) {
                            IntroGlyph(glyph, 17.dp, p.ink2)
                        }
                        Spacer(Modifier.width(12.dp))
                        Text(
                            text,
                            color = p.ink2, fontSize = 13.5.sp, fontWeight = FontWeight.Medium,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

/**
 * The Settings row that opens the intro again. Skipping it must cost nothing,
 * which means it has to be findable afterwards.
 *
 * The row only; the Settings screen gives it its panel, as iOS's does. It
 * owns the intro it opens, full screen in a window of its own like iOS's
 * cover, and closing that changes nothing about which version was seen —
 * reading it again is not the same as having been shown it.
 */
@Composable
fun IntroAgainRow(modifier: Modifier = Modifier) {
    val p = P.current
    var showing by remember { mutableStateOf(false) }
    Row(
        modifier
            .fillMaxWidth()
            .clickable {
                SoundKit.click()
                showing = true
            }
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon("bulb", size = 17.dp, tint = p.ink2)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text("How MoneyMove works", color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.ExtraBold)
            Text(
                "The six cards you saw when you first opened it",
                color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
            )
        }
        // iOS's ten either side of a Spacer that never shrinks below four, so
        // the subtitle wraps where the iPhone's does.
        Spacer(Modifier.width(24.dp))
        RowChevron(p.ink3, 11.dp)
    }
    if (showing) {
        Dialog(
            onDismissRequest = { showing = false },
            properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            WelcomeIntro { showing = false }
        }
    }
}


/**
 * The rules, for somebody in the middle of a game who has just met one.
 *
 * Written as answers to the questions people actually ask at a table, in the
 * order they ask them — not as a rulebook, which nobody opens twice.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HowToPlaySheet(onDismiss: () -> Unit) {
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val sections = listOf(
        "How do I win?" to
            "Everybody else goes bankrupt. Your net worth is cash plus what your streets and buildings are worth.",
        "When can I build?" to
            "Once you own every street of one colour. Houses go up across the country together — four on one street and none on the others is not allowed unless even build is switched off.",
        "What does a full country do?" to
            "Bare rent doubles the moment you hold all of it, before you build anything.",
        "How do I get out of prison?" to
            "Roll a double, use a card, or pay $50 — but the fine buys the door and nothing else. You do not roll that turn.",
        "What happens if nobody buys a street?" to
            "It goes to auction, and anybody can bid. The winner pays whatever they bid, which can be less than the price.",
        "What is a mortgage?" to
            "Half the price of a street, in cash, now. Buying it back costs ten percent more, and a mortgaged street collects no rent.",
        "Why can I not trade this street?" to
            "Streets with buildings on them cannot be traded. Sell the buildings first.",
        "What is the clock for?" to
            "Ninety seconds a turn, so nobody waits on an empty chair. Miss one and the house plays that turn for you; miss two in a row and your seat goes.",
    )

    MMSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp)
                .padding(bottom = 28.dp),
        ) {
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon("bulb", size = 20.dp)
                Spacer(Modifier.width(8.dp))
                Text("How to play", color = p.ink, fontSize = 19.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.weight(1f))
                MMButton("Done", kind = BtnKind.GHOST) { onDismiss() }
            }
            Spacer(Modifier.height(14.dp))
            for ((q, a) in sections) {
                Column(Modifier.fillMaxWidth().padding(vertical = 9.dp)) {
                    Text(q, color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        a,
                        color = p.ink2, fontSize = 13.5.sp, lineHeight = 20.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
                Rule()
            }
        }
    }
}

/**
 * A mark on the intro cards, drawn as iOS draws it where iOS takes it from
 * its symbol set: both people solid, the folded map, the four solid columns
 * of the bank, the key standing upright, and the warning triangle in its own
 * amber with the "!" cut through. The rest are the drawn set's, as on iOS.
 */
@Composable
private fun IntroGlyph(name: String, size: Dp, tint: Color) {
    when (name) {
        "people" -> SfMark("person.2.fill", size, tint)
        "map" -> SfMark("map.fill", size, tint)
        "bank" -> SfMark("building.columns.fill", size, tint)
        "key" -> Icon(name, size = size, tint = tint, modifier = Modifier.graphicsLayer { rotationZ = 45f })
        "warning" -> ChatSymbol("exclamationmark.triangle.fill", size, Color(0xFFF0A92C))
        else -> Icon(name, size = size, tint = tint)
    }
}
