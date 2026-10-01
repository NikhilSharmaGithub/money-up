package com.moneymove.game

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.findRootCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * How it ended.
 *
 * iOS's result sheet, in iOS's order: who took it, the way into the next game
 * while everybody is still looking, a way to tell somebody, the chart that
 * settles the argument about when it was lost, and then the report card —
 * standings, titles, and the whole table's numbers side by side. History
 * files away the same [PlayerResult] snapshot, so a result read again next
 * week is the one that was on screen tonight.
 *
 * It wears iOS's sheet chrome too: the grabber, an inline title that stays
 * put while the report card scrolls under it, and two heights — it opens at
 * half, where the headline, the next game and the share button are, and the
 * chart and the report card are a drag up.
 *
 * `account` is here for adding somebody you just played and for the wallet a
 * doubled win lands in. It defaults to the activity's own AccountStore — the
 * instance the tabs hold — so a table that has none to hand still gets a
 * sheet where both work.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GameOverSheet(
    store: GameStore,
    account: AccountStore = viewModel(),
    /**
     * The table's coin flight. iOS flies coins in a window above every sheet;
     * this sheet is a window over the table's, so the payout a win brings —
     * which lands while the sheet is up — is flown here, over it.
     */
    flight: CoinFlight? = null,
    onDismiss: () -> Unit,
) {
    val state = store.state ?: return onDismiss()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    val results = PlayerResult.snapshot(state)
    val context = LocalContext.current
    // How far the sheet's own bottom edge sits from the screen's, so the toast
    // can be drawn at the screen's: at half height most of the sheet is still
    // off the bottom of the screen, and a toast pinned to it would be too.
    var toastShift by remember { mutableIntStateOf(0) }
    // The seat whose profile is open over the standings, if one is.
    var profileOf by remember { mutableStateOf<PlayerResult?>(null) }
    // Seats asked to be friends this sitting — from a standings row or from
    // a profile — so the row's button settles into its tick either way.
    var added by remember { mutableStateOf(emptySet<String>()) }

    MMSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .onGloballyPositioned { c ->
                    val screen = c.findRootCoordinates().size.height
                    toastShift = (screen - (c.positionInRoot().y + c.size.height)).roundToInt()
                },
        ) {
            Column(Modifier.fillMaxWidth()) {
                SheetBar("Game over")
                val sheetScroll = rememberScrollState()
                Column(
                    Modifier
                        .fillMaxWidth()
                        .scrollEdge(sheetScroll)
                        .verticalScroll(sheetScroll)
                        .padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Icon("trophy", size = 46.dp, modifier = Modifier.padding(top = 8.dp))
                    WinnerHeadline(state)
                    RematchAction(store, account, state, onDismiss)
                    // One tap out with the room code attached — the fastest way a
                    // finished game turns into the next one, and the only moment
                    // anybody wants to tell somebody.
                    // iOS's ghost big button — the sunken well — with its
                    // share arrow at the symbol's own fifteen points.
                    MMButton(
                        resultShareLabel(store.iWon),
                        kind = BtnKind.PLAIN, big = true, icon = GlyphFor.SHARE_RESULT, iconSize = 15.dp,
                        modifier = Modifier.fillMaxWidth(),
                    ) { shareText(context, store.shareText) { store.showToast("Invite copied") } }
                    WorthChart(state)
                    StandingsCard(
                        store, account, results,
                        added = added,
                        onAdded = { added = added + it },
                        onOpen = { profileOf = it },
                    )
                    TitlesCard(results)
                    StatsCard(results)
                    MMButton(
                        "Leave room", kind = BtnKind.PLAIN, big = true,
                        modifier = Modifier.fillMaxWidth(),
                    ) { onDismiss(); store.leave() }
                }
            }
            // A bottom sheet is a window of its own over the app's, and the
            // app draws its toasts in the app's — so without this the answer
            // to "add friend" would land underneath the very sheet that asked.
            // iOS gives toasts a window above every sheet for exactly that
            // reason; this is the same pill, drawn inside the one sheet.
            ToastPill(
                store,
                Modifier
                    .align(Alignment.BottomCenter)
                    .offset { IntOffset(0, toastShift) },
            )
            flight?.let { CoinFlightLayer(it) }
        }
    }

    // Raised beside the result sheet rather than inside it, as the DM sheet
    // is beside Friends: a sheet is a window of its own, so this one opens
    // over the standings and closes back onto them.
    profileOf?.let { seat ->
        key(seat.id) {
            PlayerProfileSheet(
                store, account, seat,
                onAsked = { added = added + seat.id },
            ) { profileOf = null }
        }
    }
}

/**
 * iOS's inline navigation bar, as this sheet has it there: the grabber over
 * it, the title centred in it, and nothing either side — the result has no
 * Done button; it is dragged away, or left through "Leave room".
 */
@Composable
private fun SheetBar(title: String) {
    Box(Modifier.fillMaxWidth()) {
        Grabber(Modifier.align(Alignment.TopCenter).padding(top = 5.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .padding(top = 16.dp, bottom = 11.dp)
                .height(44.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                title,
                color = P.current.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
        }
    }
}

/**
 * iOS's sheet grabber: 36 by 5, five points down from the top edge, in the
 * system's faint label grey. That grey is iOS's own rather than a table ink,
 * so it is the same on every table style, as it is there.
 */
@Composable
private fun Grabber(modifier: Modifier = Modifier) {
    val dark = P.current.sheet.luminance() < 0.5f
    Box(
        modifier
            .size(width = 36.dp, height = 5.dp)
            .clip(CircleShape)
            .background(if (dark) Color(0x4DEBEBF5) else Color(0x4D3C3C43)),
    )
}

/**
 * A team takes the table as a team, so it is named first and in its own
 * colour; the seat the server happened to file as `winner` is only the
 * headline when there were no teams.
 */
@Composable
private fun WinnerHeadline(state: GameState) {
    val p = P.current
    val team = state.winningTeamInfo
    val winner = state.winner
    val (text, colour) = when {
        team != null -> "Team ${team.name} wins!" to cssColor(team.color, p.ink)
        winner != null -> "${winner.name} wins!" to cssColor(winner.color, p.ink)
        else -> "Game over" to p.ink
    }
    Text(
        text,
        color = colour, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold,
        textAlign = TextAlign.Center,
    )
}

/**
 * The next game, where one belongs — under the offer to double a win, when
 * there is one. A cup match is played once — the bracket already has the
 * result, and a second game at this table would settle nothing. A matchmade
 * table does not reconvene either: offering "the same players" would tell the
 * room the seats were never strangers, so it finds a fresh one. Anywhere
 * else, whoever presses first takes the host chair.
 *
 * Finding a fresh one is Play now again, so it carries Play now's break, at
 * the tap. A private rematch carries none: the room waits on whoever presses
 * first, and a break in front of them would hold up everybody else.
 */
@Composable
private fun RematchAction(store: GameStore, account: AccountStore, state: GameState, onDismiss: () -> Unit) {
    val p = P.current
    val context = LocalContext.current
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        // Dark until the server turns ads on — then a win can double up. It
        // draws nothing at all on a dark server, for a loser, or once today's
        // views are spent.
        DoubleWinOffer(store, account, state)
        when {
            state.cup == true -> Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(11.dp))
                    .background(p.goldSoft)
                    .padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon("trophy", size = 15.dp)
                Spacer(Modifier.width(7.dp))
                Text(
                    "A cup match is played once — the bracket has your result.",
                    color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                )
            }
            state.quick == true -> {
                // The tabs keep a break loaded, but the player is still at a
                // table here and has been for the whole game — so the result
                // asks for its own, while the standings are being read.
                LaunchedEffect(account.ads) { PreGameAd.preload(context, account.ads) }
                MMButton(
                    "Play again", kind = BtnKind.PRIMARY, big = true, icon = "replay",
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    onDismiss()
                    PreGameAd.beforeGame(context, account)
                    store.playAgainQuick()
                }
                Caption("Finds you a fresh table.")
            }
            else -> {
                MMButton(
                    "Play again", kind = BtnKind.PRIMARY, big = true, icon = "replay",
                    modifier = Modifier.fillMaxWidth(),
                ) { store.rematch(); Haptics.tap(); onDismiss() }
                if (!store.isHost) Caption("Whoever presses first hosts the next one.")
            }
        }
    }
}

/** A line under an answer, set straight on the sheet's glass, in its quiet ink. */
@Composable
private fun Caption(text: String) {
    Text(
        text,
        color = quietInk(), fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
        textAlign = TextAlign.Center,
    )
}

// ── doubling a win ──────────────────────────────────────────────────────────

private const val DOUBLE_WIN = "doubleWin"

/**
 * What a doubled win came to last time, for as long as the app is open. Only
 * the server knows what a win is worth, and asking costs a ticket, so the
 * first offer of a session says it in words and every one after it can do the
 * arithmetic — iOS keeps the same memory on its ad desk.
 */
private var lastDouble: Pair<Int, Int>? by mutableStateOf(null)

/**
 * Win a game, watch one ad, take the purse twice — iOS's DoubleWinOffer.
 *
 * It asks the server afresh every time the sheet opens, and that is the whole
 * point: what is left in this slot is not a daily allowance, it is "is there
 * a win of yours waiting to be doubled", a question whose answer changes the
 * moment this sheet appears. A config read before the game ended says zero.
 *
 * The loop is iOS's AdDesk.watch — offer, break, claim — spoken here rather
 * than through the account's shared one because the paid face needs the
 * claim's `awarded`, the purse before and after, and the shared loop hands
 * back only whether it went. The break is the same one it plays: Google's
 * when the gateway says Google, the house ad for every other answer. Once
 * paid, the offer is replaced by what it bought: an offer already taken must
 * not still look pressable.
 */
@Composable
private fun DoubleWinOffer(store: GameStore, account: AccountStore, state: GameState) {
    val p = P.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var ads by remember { mutableStateOf<AdsConfig?>(null) }
    var busy by remember { mutableStateOf(false) }
    var doubled by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    var counted by remember { mutableIntStateOf(0) }
    // Held while the house ad is up, with what the break is worth; the loop
    // below is waiting on it.
    var gate by remember { mutableStateOf<Pair<CompletableDeferred<Boolean>, Int>?>(null) }

    LaunchedEffect(Unit) {
        // A read that didn't land leaves the offer off; a dark server answers
        // `enabled: false` and every placement comes back switched off.
        val body = store.api.get("/api/ads/config", mapOf("platform" to "android")) ?: return@LaunchedEffect
        runCatching { MMJson.decodeFromString(AdsConfig.serializer(), body) }.getOrNull()?.let { ads = it }
    }

    suspend fun watch(spec: AdPlacement, factor: Int) {
        if (busy) return
        Haptics.tap()
        SoundKit.click()
        busy = true
        val paid: Int = try {
            val asked = store.api.postOrError(
                "/api/ads/offer", mapOf("placement" to DOUBLE_WIN, "platform" to "android"),
            )
            val offer = asked.body
                ?.let { runCatching { MMJson.decodeFromString(AdOffer.serializer(), it) }.getOrNull() }
            if (offer == null) {
                store.showToast("Couldn't reach the server — try again.", isError = true)
                return
            }
            // A refusal is the freshest count there is, as much as a yes.
            ads = ads?.noting(offer.remaining)
            offer.error?.let {
                store.showToast(adRefusal(it, offer.retryInSec), isError = true)
                return
            }
            if (offer.ticket.isBlank()) {
                store.showToast("That did not go through — try again.", isError = true)
                return
            }
            // What this break is being watched for. Only the server knows the
            // figure — a doubled win pays whatever that win paid.
            val worth = offer.reward.coins.takeIf { it > 0 } ?: spec.coins

            // Google first, but only when the gateway itself said Google.
            // Every way it can fail to fill the slot ends at the house ad.
            val network = if (offer.provider == "admob") {
                AdMobNetwork.showRewarded(
                    context,
                    unitId = offer.unitId,
                    customData = offer.customData,
                    userId = offer.userId,
                    serverAppId = offer.appId,
                )
            } else {
                NetworkAdOutcome.UNAVAILABLE
            }
            val watched = when (network) {
                NetworkAdOutcome.EARNED -> true
                NetworkAdOutcome.DISMISSED -> false
                NetworkAdOutcome.UNAVAILABLE -> {
                    val g = CompletableDeferred<Boolean>()
                    gate = g to worth
                    try { g.await() } finally { gate = null }
                }
            }
            if (!watched) {
                store.showToast("Closed early — nothing was paid for that one.")
                return
            }

            val claim = redeemAd(store.api, offer.ticket)
            if (claim == null) {
                store.showToast("Couldn't reach the server — try again.", isError = true)
                return
            }
            ads = ads?.noting(claim.remaining)
            claim.error?.let {
                store.showToast(adRefusal(it, claim.retryInSec), isError = true)
                return
            }
            // The server is the authority on the size of the payout: a claim
            // that disagrees with the offer's figure pays what the claim says.
            claim.awarded.takeIf { it > 0 } ?: worth
        } finally {
            busy = false
        }
        // The wallet is re-read rather than trusting the copy that rode back.
        account.refresh()
        SoundKit.gain()
        Haptics.turn()
        // The claim pays the bonus, so the purse it was added to is the bonus
        // divided by the extra share, and the total is the two together.
        val from = maxOf(1, (paid.toDouble() / (factor - 1)).roundToInt())
        val to = from + paid
        lastDouble = from to to
        counted = from
        doubled = from to to
        // The purse the win paid, and then the purse it became — a hop, not a
        // repaint: the figure must be seen to change.
        delay(260)
        counted = to
    }

    val sums = doubled
    val spec = ads?.takeIf { it.open(DOUBLE_WIN) }?.placement(DOUBLE_WIN)
    val iWon = state.winner?.id == store.meId
    when {
        sums != null -> DoublePaid(sums, counted)
        spec != null && iWon -> {
            val factor = maxOf(2, spec.factor.roundToInt())
            val sum = lastDouble?.let { (from, to) -> " ($from → $to coins)" } ?: ""
            Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                OfferButton(
                    if (busy) "Loading the ad…" else "Watch an ad — double your winnings$sum",
                    busy = busy,
                ) { scope.launch { watch(spec, factor) } }
                Text(
                    "Five seconds, and the win pays ${if (factor == 2) "twice" else "$factor times"}." +
                        if (spec.remaining > 0) " ${spec.remaining} left today." else "",
                    color = quietInk(), fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }

    // The break covers everything, as iOS's full-screen cover does, and names
    // what it is being watched for. The X, or the system back gesture, is the
    // way out early, and early pays nothing.
    gate?.let { (g, coins) ->
        HouseAdBreak(coins) { played -> g.complete(played) }
    }
}

/**
 * The offer's button: the primary kind, big, with the coin leading — and while
 * the break is being fetched, a spinner in the coin's place, which the shared
 * button has no slot for. Otherwise it is [MMButton]'s primary big face.
 */
@Composable
private fun OfferButton(label: String, busy: Boolean, onClick: () -> Unit) {
    val p = P.current
    // iOS's primary big MMButtonStyle: seventeen bold, fourteen-point corners,
    // 14/22 padding and the faint white rim; the coin at nineteen, or the
    // system spinner in its place, and a label that wraps from the leading
    // edge, as a SwiftUI label does.
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.red)
            .border(1.dp, Color.White.copy(alpha = 0.18f), shape)
            .clickable(enabled = !busy) { onClick() }
            .padding(horizontal = 22.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) {
            LandingSpinner(p.accentInk)
        } else {
            Icon("coin", size = 19.dp)
        }
        Spacer(Modifier.width(8.dp))
        Text(
            label,
            color = p.accentInk, fontSize = 17.sp, fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Start,
        )
    }
}

/** What the offer bought, in its place: the purse rolling from what it was to what it became. */
@Composable
private fun DoublePaid(sums: Pair<Int, Int>, counted: Int) {
    val p = P.current
    val shape = RoundedCornerShape(14.dp)
    val seen = remember { MutableTransitionState(false).apply { targetState = true } }
    AnimatedVisibility(visibleState = seen, enter = scaleIn(initialScale = 0.94f) + fadeIn()) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(shape)
                .background(p.goldSoft)
                .border(1.dp, p.gold, shape)
                .padding(horizontal = 13.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(p.card)
                    .border(1.dp, p.gold, RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon("coin", size = 24.dp)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    AnimatedContent(
                        targetState = counted,
                        transitionSpec = {
                            (slideInVertically { it / 2 } + fadeIn()) togetherWith
                                (slideOutVertically { -it / 2 } + fadeOut())
                        },
                        label = "doubled",
                    ) { n ->
                        Text(
                            "$n",
                            color = p.gold, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold,
                            style = TextStyle(fontFeatureSettings = "tnum"),
                        )
                    }
                    Spacer(Modifier.width(4.dp))
                    Text("coins", color = p.ink, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                }
                Text(
                    "Doubled — that win paid ${sums.second} instead of ${sums.first}.",
                    color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

/**
 * Redeems one ticket, and waits out a provider that hasn't finished speaking.
 * `pending` is "not yet" rather than "no" — the ticket survives it — so the
 * same claim is made again until it is honoured or fifteen seconds are gone,
 * iOS's budget. Every other refusal is final and comes straight back.
 */
private suspend fun redeemAd(api: Api, ticket: String): AdReward? {
    val deadline = System.currentTimeMillis() + 15_000
    while (true) {
        val claim = api.postOrError("/api/ads/reward", mapOf("ticket" to ticket, "platform" to "android"))
            .body
            ?.let { runCatching { MMJson.decodeFromString(AdReward.serializer(), it) }.getOrNull() }
        if (claim?.pending != true || System.currentTimeMillis() >= deadline) return claim
        delay(((claim.retryInSec ?: 2.0).coerceIn(1.0, 4.0) * 1000).toLong())
    }
}

// ── standings ───────────────────────────────────────────────────────────────

/**
 * The final table, a row a seat. A row with somebody behind it — any seat
 * but this device's own that came with a code — opens their profile, and
 * carries the chevron that says so; the add-friend disc on it is the same
 * request without the detour.
 *
 * [added] is held by the sheet rather than here, because the profile can ask
 * as well, and the row's disc should settle into its tick whichever did.
 */
@Composable
private fun StandingsCard(
    store: GameStore,
    account: AccountStore,
    results: List<PlayerResult>,
    added: Set<String>,
    onAdded: (String) -> Unit,
    onOpen: (PlayerResult) -> Unit,
) {
    val p = P.current
    // The ones on their way, so a second tap cannot send a second request.
    var asking by remember { mutableStateOf(emptySet<String>()) }

    // This device's own seats — the main one and every pass & play seat,
    // which share its token — are never somebody to look up or to ask.
    fun mine(r: PlayerResult) = r.id.startsWith(store.token) || store.isLocal(r.id)
    fun opens(r: PlayerResult) = r.code.isNotBlank() && !mine(r)
    // Drawn only when some row has one, so a table of nobody to look up —
    // pass & play on one phone — keeps its worth column where it was.
    val chevrons = results.any(::opens)

    fun befriend(r: PlayerResult) {
        Haptics.tap()
        // The code the seat came with, which the server now sends for every
        // seat with somebody behind it. A server too old to send one leaves
        // the old way: everybody else reaches this phone under a room-scoped
        // alias, so the one honest source is a line they said here, which
        // carries their real code — somebody who never spoke has no code
        // this device can know.
        val code = r.code.ifBlank { null } ?: store.friendCodeOf(r.id, r.name)
        if (code == null) {
            store.showToast("Ask ${r.name} for their friend code — it never reached this table", isError = true)
            return
        }
        asking = asking + r.id
        // Adding somebody who has already asked you is an acceptance; anyone
        // else gets a request, and "now friends" would be a promise — so the
        // server's own word on which it was decides the toast.
        account.befriend(code, quiet = true) { error, accepted ->
            asking = asking - r.id
            if (error == null) {
                onAdded(r.id)
                store.showToast(if (accepted) "You and ${r.name} are now friends" else "Request sent")
            } else {
                store.showToast(error, isError = true)
            }
        }
    }

    Panel(padding = 14.dp) {
        SectionLabel("Final standings")
        Spacer(Modifier.height(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for ((rank, r) in results.withIndex()) key(r.id) {
                val opensProfile = opens(r)
                // No clip for a rounded ripple: the row is only as tall as its
                // 30dp disc, and the disc's flag and shadow hang past it, so a
                // clip would shave every seat's flag. The ripple is bounded to
                // the row as it is.
                Row(
                    Modifier
                        .fillMaxWidth()
                        .alpha(if (r.bankrupt) 0.6f else 1f)
                        .clickable(enabled = opensProfile, onClickLabel = "Open ${r.name}'s profile") {
                            Haptics.tap()
                            onOpen(r)
                        },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.width(26.dp), contentAlignment = Alignment.Center) { Medal(rank) }
                    Spacer(Modifier.width(10.dp))
                    AvatarDisc(r.name, r.color, size = 30.dp, flag = r.flag, avatar = r.avatar)
                    Spacer(Modifier.width(10.dp))
                    Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            r.name,
                            modifier = Modifier.weight(1f, fill = false),
                            color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        // Never a seat this device played itself. A house
                        // player with a code can be asked like anybody else
                        // — the server simply never answers — and only a
                        // house seat without one, from an older server, is
                        // left without the disc.
                        if (!mine(r) && (r.code.isNotBlank() || !r.isBot)) {
                            Spacer(Modifier.width(10.dp))
                            AddFriendButton(r.name, done = r.id in added, busy = r.id in asking) { befriend(r) }
                        }
                    }
                    // iOS's ten either side of a Spacer that keeps eight.
                    Spacer(Modifier.width(28.dp))
                    // A game can end while a seat is still in the red — the
                    // worth prints in the danger colour, never green.
                    Text(
                        r.outcomeLabel ?: money(r.worth),
                        color = when {
                            r.bankrupt -> p.ink3
                            r.worth < 0 -> p.bad
                            else -> p.good
                        },
                        fontSize = 13.5.sp, fontWeight = FontWeight.ExtraBold,
                    )
                    if (chevrons) {
                        Box(Modifier.width(16.dp), contentAlignment = Alignment.CenterEnd) {
                            if (opensProfile) RowChevron(p.ink3, 10.dp)
                        }
                    }
                }
            }
        }
    }
}

/** Podium finishes get their metal; everyone else gets their number. */
@Composable
private fun Medal(rank: Int) {
    when (rank) {
        0 -> Icon("medalGold", size = 22.dp)
        1 -> Icon("medalSilver", size = 22.dp)
        2 -> Icon("medalBronze", size = 22.dp)
        else -> Text(
            "${rank + 1}",
            color = P.current.ink3, fontSize = 13.sp, fontWeight = FontWeight.Bold,
        )
    }
}

/**
 * iOS's add-friend disc: person.badge.plus on the sunken fill, settling into
 * a green checkmark once added. The drawn set has neither mark, so both are
 * drawn below in iOS's shapes rather than borrowed from the nearest glyph.
 * While the request is out the disc stops taking taps but looks no different,
 * because iOS's shows nothing for that moment either.
 */
@Composable
private fun AddFriendButton(name: String, done: Boolean, busy: Boolean, onClick: () -> Unit) {
    val p = P.current
    Box(
        Modifier
            .size(26.dp)
            .clip(CircleShape)
            .background(if (done) p.goodSoft else p.sunken)
            .border(1.dp, if (done) p.good.copy(alpha = 0.5f) else p.rule, CircleShape)
            .clickable(enabled = !done && !busy) { onClick() }
            .semantics { contentDescription = if (done) "$name added" else "Add $name as a friend" },
        contentAlignment = Alignment.Center,
    ) {
        if (done) CheckMark(p.good) else PersonPlusMark(p.ink2)
    }
}

/** checkmark at eleven points, bold: two strokes, the short one first. */
@Composable
private fun CheckMark(tint: Color) {
    Canvas(Modifier.size(11.dp)) {
        val u = size.width / 11f
        val tick = Path().apply {
            moveTo(1.6f * u, 5.9f * u)
            lineTo(4.4f * u, 8.8f * u)
            lineTo(9.6f * u, 2.2f * u)
        }
        drawPath(tick, tint, style = Stroke(width = 1.9f * u, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

/**
 * person.badge.plus at eleven points, bold: a head and shoulders, and the
 * plus riding the right shoulder — a little wider than it is tall, as the
 * symbol is.
 */
@Composable
private fun PersonPlusMark(tint: Color) {
    // SF's person.badge.plus is the outline person — its head a ring and its
    // shoulders an open arc — with a solid plus beside it.
    Canvas(Modifier.size(width = 14.dp, height = 11.dp)) {
        val u = size.height / 11f
        val line = Stroke(width = 1.5f * u, cap = StrokeCap.Round, join = StrokeJoin.Round)
        drawCircle(tint, radius = 2.3f * u, center = Offset(5f * u, 3.1f * u), style = line)
        val shoulders = Path().apply {
            moveTo(0.9f * u, 10.3f * u)
            cubicTo(0.9f * u, 7.9f * u, 2.6f * u, 6.6f * u, 5f * u, 6.6f * u)
            cubicTo(7.4f * u, 6.6f * u, 9.1f * u, 7.9f * u, 9.1f * u, 10.3f * u)
        }
        drawPath(shoulders, tint, style = line)
        val bar = 1.6f * u
        drawLine(tint, Offset(11.6f * u, 1.4f * u), Offset(11.6f * u, 6.2f * u), bar, StrokeCap.Round)
        drawLine(tint, Offset(9.2f * u, 3.8f * u), Offset(14f * u, 3.8f * u), bar, StrokeCap.Round)
    }
}

// ── somebody's profile ──────────────────────────────────────────────────────

/**
 * Somebody you just played, beyond tonight's numbers: their record, the
 * titles that keep landing on their seat, and the one thing worth doing about
 * them — asking to be friends, or saying yes to them having asked.
 *
 * The card is read afresh every time it opens, by the code the seat carried,
 * as this player — the standings can be minutes old, and a "Request sent"
 * from before they answered would be wrong the moment it showed. A house
 * player answers like anybody else: the server keeps their numbers steady
 * and their requests unanswered, and nothing here treats them differently.
 *
 * Its own short sheet, opened at its full height: there is nothing below the
 * button to drag up to.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlayerProfileSheet(
    store: GameStore,
    account: AccountStore,
    seat: PlayerResult,
    onAsked: () -> Unit,
    onDismiss: () -> Unit,
) {
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var card by remember { mutableStateOf<PlayerProfile?>(null) }
    var failed by remember { mutableStateOf<String?>(null) }
    // What a tap has since made true, over what the card said as it loaded.
    var relation by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(seat.code) {
        val got = account.player(seat.code)
        card = got.profile
        failed = got.error
    }

    val name = card?.name?.ifBlank { null } ?: seat.name
    val flag = card?.flag?.ifBlank { null } ?: seat.flag
    val code = card?.code?.ifBlank { null } ?: seat.code

    fun ask() {
        if (busy) return
        Haptics.tap()
        busy = true
        account.befriend(code, quiet = true) { error, accepted ->
            busy = false
            if (error != null) {
                store.showToast(error, isError = true)
            } else {
                // They had already asked, so the add made the friendship.
                relation = if (accepted) "friend" else "sent"
                onAsked()
                if (accepted) Haptics.turn()
                store.showToast(if (accepted) "You and $name are now friends" else "Request sent")
            }
        }
    }

    fun accept() {
        if (busy) return
        Haptics.tap()
        busy = true
        account.answerFriend(code, accept = true) { error ->
            busy = false
            if (error != null) {
                store.showToast(error, isError = true)
            } else {
                relation = "friend"
                onAsked()
                Haptics.turn()
                store.showToast("You and $name are now friends")
            }
        }
    }

    MMSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Box(Modifier.fillMaxWidth()) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(start = 16.dp, end = 16.dp, bottom = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Grabber(Modifier.padding(top = 5.dp, bottom = 6.dp))
                // Their face if they wear one, else their initial in the
                // colour they played in tonight — the disc the standings drew.
                AvatarDisc(name, seat.color, size = 72.dp, avatar = card?.avatar?.ifBlank { null } ?: seat.avatar)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        name,
                        modifier = Modifier.weight(1f, fill = false),
                        color = p.ink, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    // The flag they chose, theirs to show as it is.
                    flag?.takeIf { it.isNotBlank() }?.let {
                        Spacer(Modifier.width(8.dp))
                        Text(it, fontSize = 20.sp, maxLines = 1, softWrap = false)
                    }
                }
                val shown = card
                when {
                    shown != null -> ProfileRecord(
                        shown,
                        relation = relation ?: shown.relation,
                        busy = busy,
                        onAsk = ::ask,
                        onAccept = ::accept,
                    )
                    failed != null -> Box(
                        Modifier.fillMaxWidth().heightIn(min = 120.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            failed.orEmpty(),
                            color = p.bad, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                            textAlign = TextAlign.Center,
                        )
                    }
                    // Held at about the height the record will take, so the
                    // sheet does not leap when it lands.
                    else -> Box(
                        Modifier.fillMaxWidth().heightIn(min = 120.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        LandingSpinner(quietInk(), 22.dp)
                    }
                }
            }
            // A sheet is a window of its own, so the answer to Add friend is
            // drawn in this one or it would land under it — as the result
            // sheet draws its own.
            ToastPill(store, Modifier.align(Alignment.BottomCenter))
        }
    }
}

/**
 * The record itself: four numbers on a card, how long they have been at it,
 * up to three titles, and the button where the two of you stand.
 */
@Composable
private fun ProfileRecord(
    card: PlayerProfile,
    relation: String,
    busy: Boolean,
    onAsk: () -> Unit,
    onAccept: () -> Unit,
) {
    val p = P.current
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Panel(padding = 14.dp) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Tally(grouped(card.wins), "WINS", Modifier.weight(1f))
                Tally(grouped(card.played), "GAMES", Modifier.weight(1f))
                Tally("${card.winRate}%", "WIN RATE", Modifier.weight(1f))
                // Coins, not dollars: these are what the wins paid into the
                // wallet, so they wear no dollar sign.
                Tally(grouped(card.winnings), "COINS WON", Modifier.weight(1f))
            }
        }
        if (card.since > 0) Caption("Playing since ${clockText(card.since, "MMMyyyy", twentyFour = false)}")

        val titles = card.titles.filter { it.title.isNotBlank() }.take(3)
        if (titles.isNotEmpty()) {
            // The shelf's columns: as many 132dp-or-wider as fit, each an
            // equal share, so a long title is not squeezed to its first word.
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val columns = ((maxWidth + 8.dp) / (132.dp + 8.dp)).toInt().coerceIn(1, titles.size)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (row in titles.chunked(columns)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (t in row) TitleChip(t.title, t.count, Modifier.weight(1f))
                            repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }

        val wide = Modifier.fillMaxWidth()
        when (relation) {
            // Your own card asks nothing of you.
            "self" -> Unit
            "friend" -> MMButton(
                "Friends", modifier = wide, kind = BtnKind.PLAIN, big = true, enabled = false,
                lead = { CheckMark(p.good) },
            ) {}
            // Settled until they answer, and faded so it reads as a state
            // rather than a button; MMButton itself looks the same disabled.
            "sent" -> Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                MMButton(
                    "Request sent", modifier = wide.alpha(0.7f), kind = BtnKind.PLAIN, big = true, enabled = false,
                    lead = { ink -> CheckMark(ink) },
                ) {}
                Caption("Waiting for them to say yes.")
            }
            "asked" -> Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                MMButton(
                    "Accept request", modifier = wide, kind = BtnKind.GOLD, big = true, enabled = !busy,
                    lead = { ink -> if (busy) LandingSpinner(ink, 18.dp) else PersonPlusMark(ink) },
                ) { onAccept() }
                Caption("They asked to be your friend.")
            }
            else -> MMButton(
                "Add friend", modifier = wide, kind = BtnKind.PRIMARY, big = true, enabled = !busy,
                lead = { ink -> if (busy) LandingSpinner(ink, 18.dp) else PersonPlusMark(ink) },
            ) { onAsk() }
        }
    }
}

// ── titles ──────────────────────────────────────────────────────────────────

@Composable
private fun TitlesCard(results: List<PlayerResult>) {
    val titled = results.filter { it.title != null }
    if (titled.isEmpty()) return
    val p = P.current
    Panel(padding = 14.dp) {
        SectionLabel("Titles")
        Spacer(Modifier.height(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (r in titled) key(r.id) {
                Row {
                    // Sat on the first line's baseline and lifted a point, as
                    // iOS seats it: the dot belongs to the title, not the row.
                    Box(
                        Modifier
                            .alignBy { it.measuredHeight }
                            .offset(y = (-1).dp)
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(cssColor(r.color, p.red)),
                    )
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.alignByBaseline(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                r.title.orEmpty(),
                                color = p.gold, fontSize = 13.5.sp, fontWeight = FontWeight.ExtraBold,
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                r.name,
                                color = p.ink, fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                        r.titleReason?.let {
                            Text(it, color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }
        }
    }
}

// ── the report card ─────────────────────────────────────────────────────────

/** The seven numbers worth reading out — the rest live on in the titles. */
private val STAT_ROWS: List<Pair<String, (PlayerStats) -> String>> = listOf(
    "Rent collected" to { s -> money(s.rentCollected ?: 0) },
    "Rent paid" to { s -> money(s.rentPaid ?: 0) },
    "Streets bought" to { s -> "${s.streetsBought ?: 0}" },
    "Houses built" to { s -> "${s.housesBuilt ?: 0}" },
    "Doubles rolled" to { s -> "${s.doubles ?: 0}" },
    "Times jailed" to { s -> "${s.jailed ?: 0}" },
    "Laps of the board" to { s -> "${s.laps ?: 0}" },
)

/**
 * Every seat's numbers side by side, which is what makes them worth reading:
 * one column of your own says nothing about the winner collecting three times
 * the rent you did. A seat with no stats prints zeros rather than dropping
 * out, and the card only goes missing for a result filed before stats were
 * kept at all.
 */
@Composable
private fun StatsCard(results: List<PlayerResult>) {
    if (results.none { it.stats != null }) return
    val p = P.current
    Panel(padding = 14.dp) {
        SectionLabel("Match stats")
        Spacer(Modifier.height(10.dp))
        Box(Modifier.horizontalScroll(rememberScrollState())) {
            StatGrid(columns = results.size + 1, hSpacing = 14.dp, vSpacing = 8.dp) {
                Spacer(Modifier.size(1.dp))
                for (r in results) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        AvatarDisc(r.name, r.color, size = 24.dp, avatar = r.avatar)
                        Text(
                            r.name,
                            modifier = Modifier.widthIn(max = 64.dp),
                            color = p.ink2, fontSize = 9.5.sp, fontWeight = FontWeight.Bold,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                for ((label, value) in STAT_ROWS) {
                    Text(
                        label,
                        color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                        maxLines = 1, softWrap = false,
                    )
                    for (r in results) {
                        Text(
                            value(r.stats ?: PlayerStats()),
                            color = p.ink, fontSize = 12.5.sp, fontWeight = FontWeight.ExtraBold,
                            style = TextStyle(fontFeatureSettings = "tnum"),
                            maxLines = 1, softWrap = false,
                        )
                    }
                }
            }
        }
    }
}

/**
 * A plain grid, row by row: every column as wide as its widest cell and every
 * row as tall as its tallest, so a long label or a long name moves its whole
 * column rather than knocking one row out of line. The label column reads
 * from the left and the players' columns from the right, as iOS's Grid lines
 * them up.
 */
@Composable
private fun StatGrid(columns: Int, hSpacing: Dp, vSpacing: Dp, content: @Composable () -> Unit) {
    Layout(content) { measurables, _ ->
        val cells = measurables.map { it.measure(Constraints()) }
        val rows = (cells.size + columns - 1) / columns
        val widths = IntArray(columns)
        val heights = IntArray(rows)
        cells.forEachIndexed { i, cell ->
            widths[i % columns] = maxOf(widths[i % columns], cell.width)
            heights[i / columns] = maxOf(heights[i / columns], cell.height)
        }
        val h = hSpacing.roundToPx()
        val v = vSpacing.roundToPx()
        val width = widths.sum() + h * (columns - 1)
        val height = heights.sum() + v * (rows - 1).coerceAtLeast(0)
        layout(width, height) {
            var y = 0
            for (row in 0 until rows) {
                var x = 0
                for (col in 0 until columns) {
                    cells.getOrNull(row * columns + col)?.let { cell ->
                        val cx = if (col == 0) x else x + widths[col] - cell.width
                        cell.place(cx, y + (heights[row] - cell.height) / 2)
                    }
                    x += widths[col] + h
                }
                y += heights[row] + v
            }
        }
    }
}

// ── net worth over time ─────────────────────────────────────────────────────

/**
 * Everybody's net worth as a step line, turn by turn — the winner's drawn
 * thicker and solid, everybody else's a little back — on a scale somebody can
 * read a value off, with a legend so four coloured lines have four names.
 *
 * The gold rule is where the game turned: the first turn of the winner's
 * final, unbroken stretch on top. A winner who led from turn one gets no
 * marker, because nothing turned. The axes sit where Swift Charts puts them
 * on iOS — the money down the right, the turns along the bottom.
 *
 * The legend is one centred line, as iOS's is, for every table it fits on;
 * past that it runs onto a second line where iOS would squeeze each name down
 * to its first letter.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WorthChart(state: GameState) {
    val series = state.history.orEmpty()
    val players = state.players
    if (series.size < 3 || players.isEmpty()) return
    val p = P.current
    val winnerId = state.winner?.id
    val flip = turningPoint(series, winnerId)
    val measurer = rememberTextMeasurer()
    val axis = TextStyle(color = p.ink3, fontSize = 9.sp, fontWeight = FontWeight.Medium)
    val note = TextStyle(color = p.gold, fontSize = 9.sp, fontWeight = FontWeight.Bold)

    Panel(padding = 14.dp) {
        SectionLabel("Net worth over time")
        Spacer(Modifier.height(10.dp))
        Canvas(Modifier.fillMaxWidth().height(190.dp)) {
            // A seat missing from a point had nothing then — it reads zero,
            // so a bankrupt line drops to the floor instead of bridging over.
            val worths = series.flatMap { pt -> players.map { pt.w[it.id] ?: 0 } }
            val yTicks = niceTicks(minOf(0, worths.min()), worths.max(), 4)
            val lo = yTicks.first()
            val hi = maxOf(yTicks.last(), lo + 1)
            val t0 = series.first().t
            val t1 = maxOf(series.last().t, t0 + 1)
            val xTicks = niceTicks(t0, t1, 5).filter { it in t0..t1 }

            val gap = 6.dp.toPx()
            val yLabels = yTicks.map { it to measurer.measure(worthLabel(it), axis) }
            val gutter = yLabels.maxOf { it.second.size.width } + gap
            val line = measurer.measure("0", axis).size.height.toFloat()
            // Headroom for the marker's words when there is a marker, and
            // half a label's height otherwise so the top figure isn't clipped.
            val top = if (flip != null) line + 6.dp.toPx() else line / 2f
            val bottom = size.height - line * 2 - 6.dp.toPx()
            val right = size.width - gutter
            val hair = 0.5.dp.toPx()

            fun xOf(t: Int) = right * (t - t0) / (t1 - t0).toFloat()
            fun yOf(v: Int) = bottom - (bottom - top) * (v - lo) / (hi - lo).toFloat()

            for ((v, label) in yLabels) {
                val y = yOf(v)
                drawLine(p.rule, Offset(0f, y), Offset(right, y), hair)
                drawText(label, topLeft = Offset(right + gap, y - label.size.height / 2f))
            }
            for (t in xTicks) {
                val x = xOf(t)
                drawLine(p.rule, Offset(x, top), Offset(x, bottom), hair)
                val label = measurer.measure("$t", axis)
                val lx = (x - label.size.width / 2f).coerceIn(0f, maxOf(0f, right - label.size.width))
                drawText(label, topLeft = Offset(lx, bottom + 2.dp.toPx()))
            }
            val turn = measurer.measure("turn", axis)
            drawText(turn, topLeft = Offset(right - turn.size.width, bottom + line + 4.dp.toPx()))

            for (pl in players) {
                val lead = pl.id == winnerId
                val path = Path()
                var lastY = 0f
                for ((i, pt) in series.withIndex()) {
                    val x = xOf(pt.t)
                    val y = yOf(pt.w[pl.id] ?: 0)
                    // Step at the end of each turn: hold the old value across,
                    // then drop or climb — money moves on a turn, not between.
                    if (i == 0) path.moveTo(x, y) else { path.lineTo(x, lastY); path.lineTo(x, y) }
                    lastY = y
                }
                drawPath(
                    path,
                    cssColor(pl.color, p.red).copy(alpha = if (lead) 1f else 0.75f),
                    style = Stroke(
                        width = (if (lead) 2.5 else 1.8).dp.toPx(),
                        cap = StrokeCap.Round, join = StrokeJoin.Round,
                    ),
                )
            }

            flip?.let { t ->
                val x = xOf(t)
                drawLine(
                    p.gold.copy(alpha = 0.7f), Offset(x, top), Offset(x, bottom), 1.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx())),
                )
                val words = measurer.measure("game turned here", note)
                val crown = 10.dp.toPx()
                val span = crown + 3.dp.toPx() + words.size.width
                // Anchored at the rule and reading right, pulled back in when
                // a late turn would run it off the edge.
                val left = x.coerceAtMost(size.width - span).coerceAtLeast(0f)
                val wordsTop = top - 2.dp.toPx() - words.size.height
                translate(left, wordsTop + (words.size.height - crown) / 2f) {
                    with(Art) { drawGlyph("crown", crown, p.gold) }
                }
                drawText(words, topLeft = Offset(left + crown + 3.dp.toPx(), wordsTop))
            }
        }
        Spacer(Modifier.height(10.dp))
        // One centred line, as iOS's HStack: a crowded table squeezes the
        // names rather than wrapping the legend onto a second line.
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
        ) {
            for (pl in players) {
                Row(Modifier.weight(1f, fill = false), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(7.dp).clip(CircleShape).background(cssColor(pl.color, p.red)))
                    Spacer(Modifier.width(4.dp))
                    Text(
                        pl.name,
                        color = p.ink2, fontSize = 10.5.sp, fontWeight = FontWeight.Bold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    if (pl.id == winnerId) {
                        Spacer(Modifier.width(4.dp))
                        Icon("crown", size = 10.dp)
                    }
                }
            }
        }
    }
}

/** "$4k", "$800" — iOS's axis labels, thousands cut down the same way. */
private fun worthLabel(v: Int): String = "$" + if (v >= 1000) "${v / 1000}k" else "$v"

/**
 * Round-number ticks covering lo..hi, about `want` of them, on the 1-2-5
 * steps Swift Charts chooses for iOS's `.automatic(desiredCount:)`.
 */
private fun niceTicks(lo: Int, hi: Int, want: Int): List<Int> {
    val raw = maxOf(1, hi - lo).toDouble() / want
    val magnitude = 10.0.pow(floor(log10(raw)))
    val n = raw / magnitude
    val nice = when {
        n <= 1.0 -> 1.0
        n <= 2.0 -> 2.0
        n <= 5.0 -> 5.0
        else -> 10.0
    }
    val step = maxOf(1, (nice * magnitude).roundToInt())
    val first = lo.floorDiv(step) * step
    val last = maxOf(-((-hi).floorDiv(step)) * step, first + step)
    return (first..last step step).toList()
}
