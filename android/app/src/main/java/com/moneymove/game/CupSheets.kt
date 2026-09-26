package com.moneymove.game

import androidx.lifecycle.viewModelScope
import android.text.format.DateFormat
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The cup: a knockout tournament with a prize at the end of it.
 *
 * Everyone who enters inside the join window is paired off when the doors
 * shut, winners play on, and the last three standing are paid by hand. The
 * server owns every bit of that — this file asks `/api/cup` every few seconds
 * and draws whatever came back.
 *
 * Four screens, each iOS's own: the card on the Social tab (CupCard.swift),
 * which is where a player joins, leaves, types a code and walks to their
 * table; the poster behind "What is a cup?"; the tournament room behind the
 * card's header; and the chart behind that. The card carries the controls
 * because that is where the iPhone carries them — a player comparing the two
 * phones should find Join in the same place on both.
 *
 * It draws nothing at all unless the owner has switched cups on. That is the
 * point of the switch: the feature can ship, be tested against the real
 * server, and still not exist as far as any player is concerned.
 */

// ─────────────────────────────────────────── what the server answers with ──

/** `GET /api/cup` — one cup, plus a row each for the ones it is not showing. */
@Serializable
data class CupFeed(
    val enabled: Boolean = false,
    val cup: CupView? = null,
    val others: List<CupBrief> = emptyList(),
)

/** A cup this card is not showing: enough to tell it apart and choose it. */
@Serializable
data class CupBrief(
    val id: String = "",
    val name: String = "",
    val state: String = "",
    val openedAt: Double? = null,
    val closesAt: Double? = null,
    val entrants: Int = 0,
    val maxPlayers: Int = 0,
    val joined: Boolean = false,
    val needsCode: Boolean = false,
)

@Serializable
data class CupView(
    val id: String = "",
    val name: String = "",
    /** "scheduled" | "joining" | "running" | "done". */
    val state: String = "",
    val prize: CupPrize = CupPrize(),
    val local: CupLocalPrize? = null,
    val openedAt: Double? = null,
    val closesAt: Double? = null,
    val entrants: Int = 0,
    /** Nought means no limit — see tournament.js. */
    val maxPlayers: Int = 0,
    /**
     * Whether a join code is wanted. Never the code itself: an invite-only
     * cup whose code any client could read is not invite-only, and the server
     * deliberately keeps `joinCode` on the owner's desk. Nothing in this file
     * may print a code the server did not send to this player.
     */
    val needsCode: Boolean = false,
    val schedule: CupSchedule? = null,
    val plan: List<CupPlanRound> = emptyList(),
    val rounds: Int = 0,
    val round: CupRound? = null,
    val standings: CupStandings? = null,
    val you: CupYou = CupYou(),
)

@Serializable
data class CupPrize(
    val currency: String = "USD",
    val first: Int = 0,
    val second: Int = 0,
    val third: Int = 0,
)

/**
 * The same three prizes in the money the reader thinks in, when the server
 * knows today's rate for the country they fly. Null otherwise, and the
 * owner's own figure is shown instead — a made-up conversion is worse than
 * none, because a prize is a promise somebody has to pay.
 */
@Serializable
data class CupLocalPrize(
    val code: String = "",
    val symbol: String = "",
    val approximate: Boolean = true,
    val first: Int = 0,
    val second: Int = 0,
    val third: Int = 0,
)

@Serializable
data class CupSchedule(
    /** Minutes past midnight, in the ORGANISER's clock — see [scheduleLine]. */
    val times: List<Int> = emptyList(),
    val windowMinutes: Int = 10,
    val matchMinutes: Int = 90,
    val offsetMinutes: Int = 0,
)

@Serializable
data class CupPlanRound(
    val n: Int = 0,
    val label: String = "",
    val players: Int = 0,
    val opensAt: Double? = null,
    val closesAt: Double? = null,
    val done: Boolean = false,
    val yours: Boolean = false,
    val projected: Boolean = false,
)

@Serializable
data class CupRound(
    val n: Int = 0,
    /** "round" | "final" | "thirdPlace". */
    val kind: String? = null,
    val matches: List<CupMatch> = emptyList(),
)

@Serializable
data class CupMatch(
    val a: String? = null,
    val b: String? = null,
    /** "pending" | "playing" | "done". */
    val state: String? = null,
    val winner: String? = null,
)

@Serializable
data class CupStandings(
    val first: CupPlacing? = null,
    val second: CupPlacing? = null,
    val third: CupPlacing? = null,
)

@Serializable
data class CupPlacing(val code: String? = null, val name: String? = null)

@Serializable
data class CupYou(
    val joined: Boolean = false,
    /** This reader's own friend code — theirs, so it is theirs to be shown. */
    val code: String? = null,
    val name: String? = null,
    val out: Boolean = false,
    /** "first" | "second" | "third", once it is over. */
    val placed: String? = null,
    val roomId: String? = null,
    val opponent: String? = null,
    val survived: Int = 0,
    val round: Int? = null,
    val roundLabel: String? = null,
    /** Still in the cup. Absent before the draw, when everybody still is. */
    val left: Int? = null,
    val next: CupNext? = null,
)

/**
 * The match in front of this player. The whole reason the detail sheet
 * exists: "you are in round three" is not what somebody wants to know at
 * nine in the evening; "you play Ravi at ten, and the door shuts at ten
 * past" is.
 */
@Serializable
data class CupNext(
    val round: Int = 0,
    val label: String = "",
    val opponent: String? = null,
    val opponentCode: String? = null,
    val opensAt: Double? = null,
    val closesAt: Double? = null,
    val open: Boolean = false,
    val roomId: String? = null,
    /** When the whistle goes, once the game has started. */
    val endsAt: Double? = null,
)

/** `GET /api/cup/bracket` — the chart, asked for only when somebody opens it. */
@Serializable
data class CupBracketFeed(val enabled: Boolean = false, val bracket: CupBracketView? = null)

@Serializable
data class CupBracketView(
    val id: String = "",
    val name: String = "",
    val state: String = "",
    val prize: CupPrize = CupPrize(),
    val local: CupLocalPrize? = null,
    val entrants: Int = 0,
    val you: CupBracketYou? = null,
    val standings: CupStandings? = null,
    val rounds: List<CupBracketRound> = emptyList(),
)

@Serializable
data class CupBracketYou(
    val code: String? = null,
    val name: String? = null,
    val out: Boolean = false,
    val placed: String? = null,
)

@Serializable
data class CupBracketRound(
    val n: Int = 0,
    val kind: String? = null,
    /** "Final", "Semi-finals", "Round of 64" — the server names its own rounds. */
    val label: String = "",
    val players: Int = 0,
    val matches: List<CupBracketMatch> = emptyList(),
)

/**
 * One match on the chart. Names, never identities: the bracket is the screen
 * a whole field of strangers reads, and `mine` is the only thing on it that
 * knows who is asking.
 */
@Serializable
data class CupBracketMatch(
    val a: String? = null,
    val b: String? = null,
    /** Net worth at the whistle, when a game was decided on it. */
    val aScore: Int? = null,
    val bScore: Int? = null,
    val state: String? = null,
    val winner: String? = null,
    val walkover: Boolean = false,
    @SerialName("void") val voided: Boolean = false,
    val mine: Boolean = false,
)

// ──────────────────────────────────────────────────────────────── the poll ──

/**
 * One poll for the whole app, and the thing that walks a player into their
 * table.
 *
 * Deliberately not part of [AccountStore]: a cup being played wants asking
 * every four seconds, and a wallet does not. It is also why this must be
 * created ABOVE the tab bar — a poll that only runs while the Social tab is
 * open is a poll that never seats the player who is waiting on the Play tab.
 */
class CupStore private constructor(private val game: GameStore, private val scope: CoroutineScope) {

    private val api get() = Api(game.prefs.server, game.token)

    var feed: CupFeed? by mutableStateOf(null)
        private set

    /** A join or a leave is in flight — the button says so rather than idling. */
    var busy: Boolean by mutableStateOf(false)
        private set

    /** The last thing that went wrong, for the one line a sheet shows. */
    var notice: String? by mutableStateOf(null)
        private set

    var bracket: CupBracketView? by mutableStateOf(null)
        private set

    /** The chart was asked for and did not come — the sheet says so. */
    var bracketFailed: Boolean by mutableStateOf(false)
        private set

    /**
     * Which cup is being looked at. Blank lets the server pick the one that
     * matters most to this reader; once it has picked, this follows it, so
     * joining and the chart always act on the cup actually on screen.
     */
    var showing: String by mutableStateOf("")
        private set

    /**
     * The table this device has already been walked into. A player should
     * find their first cup game without hunting for it — but only once.
     * Coming back out of a game must not throw them straight back in.
     */
    private var sentTo: String? = null

    /** The cup as it exists for a player: nothing while cups are switched off. */
    val live: CupView? get() = feed?.takeIf { it.enabled }?.cup

    val others: List<CupBrief> get() = feed?.takeIf { it.enabled }?.others ?: emptyList()

    /**
     * Ask, wait, ask again — closer together the more there is to miss.
     *
     * iOS's CupWatch, miss for miss: a failure backs off five, ten, fifteen,
     * twenty seconds, and after the fourth in a row it stops and the card
     * stays as it was. Coming back to the home tabs asks afresh (see
     * [ensureWatching]), as iOS's landing screen restarts its watcher when it
     * appears again. While this device sits at a table the poll rests, as
     * iOS's does with the landing screen out of sight.
     */
    suspend fun watch() {
        var misses = 0
        while (true) {
            if (game.roomId != null) {
                delay(5_000L)
                continue
            }
            if (!load()) {
                misses++
                if (misses > 4) return
                delay(misses * 5_000L)
                continue
            }
            misses = 0
            delay(
                when {
                    feed?.enabled != true -> 60_000L
                    live?.state == "scheduled" -> 30_000L
                    live?.state == "joining" -> 3_000L
                    live?.state == "running" -> 4_000L
                    else -> 20_000L
                }
            )
        }
    }

    /** Look at one of the other cups instead. */
    fun show(cupId: String) {
        showing = cupId
        // A refusal belongs to the cup it was about. Carried across to the
        // next cup in the list, "This one is full" is a lie about that one.
        notice = null
        scope.launch { load() }
    }

    fun refresh() {
        scope.launch { load() }
    }

    fun enter(code: String = "") {
        val cupId = showing
        scope.launch {
            busy = true
            notice = null
            // `code` and `cupId` are the names the route reads out of the
            // body; the token is added by the post. The refusal comes back in
            // the server's own words — "That code does not match", "This one
            // is full" — which is the only sentence somebody holding the
            // wrong code can act on.
            val reply = api.postOrError(
                "/api/cup/join",
                mapOf("code" to code.trim(), "cupId" to cupId),
            )
            if (reply.ok) {
                Haptics.turn()
                game.showToast("Joined — good luck")
                load()
            } else {
                // iOS's words when the server gave none, or never answered.
                val why = reply.error ?: "Could not enter the cup"
                notice = why
                game.showToast(why, isError = true)
            }
            busy = false
        }
    }

    /**
     * Out again, before the doors shut. Nothing is said either way, as on
     * iOS: the card is re-read straight after, and it shows which it was —
     * back to Join, or still in.
     */
    fun leave() {
        val cupId = showing
        scope.launch {
            busy = true
            notice = null
            api.postOrError("/api/cup/leave", mapOf("cupId" to cupId))
            load()
            busy = false
        }
    }

    /** The chart, on demand. */
    fun openBracket(cupId: String) {
        // The chart from the cup somebody was reading a moment ago is worse
        // than an empty screen: it is another cup's bracket wearing this one's
        // name, and a reader looks for themselves in it.
        if (bracket?.id != cupId) bracket = null
        scope.launch {
            bracketFailed = false
            val body = api.get("/api/cup/bracket", mapOf("cup" to cupId))
            val answer = body?.let {
                runCatching { MMJson.decodeFromString(CupBracketFeed.serializer(), it) }.getOrNull()
            }
            bracket = answer?.takeIf { it.enabled }?.bracket
            bracketFailed = bracket == null
        }
    }

    private suspend fun load(): Boolean {
        val body = api.get("/api/cup", mapOf("show" to showing)) ?: return false
        val fresh = runCatching { MMJson.decodeFromString(CupFeed.serializer(), body) }.getOrNull()
            ?: return false
        feed = fresh
        // Follow whatever came back: the server picks the cup that matters
        // most to this reader, and everything else acts on the one on screen.
        fresh.cup?.id?.let { showing = it }
        if (fresh.enabled) seat(fresh.cup?.you?.roomId)
        return true
    }

    /** Your table is ready: walk in, once. */
    private fun seat(room: String?) {
        if (room == null || room == sentTo || game.roomId != null) return
        sentTo = room
        game.showToast("Your cup table is ready")
        Haptics.turn()
        scope.launch {
            delay(900)
            // Still not at a table a beat later. Somebody who opened a game of
            // their own in the meantime would rather not be yanked out of it.
            if (game.roomId == null) game.connect(room)
        }
    }

    private var watching: kotlinx.coroutines.Job? = null

    /** Starts the poll if it is not running — the first time, or after it gave up. */
    fun ensureWatching() {
        if (watching?.isActive == true) return
        watching = scope.launch { watch() }
    }

    companion object {
        private var shared: CupStore? = null

        /**
         * The one poll the app has, on the table store's own lifetime: a
         * watcher rebuilt with each tab forgot the cup the player picked,
         * forgot where it had already walked them, and stopped asking on the
         * Store, History and Settings tabs. iOS keeps one for the whole
         * landing screen; so does this.
         */
        fun shared(game: GameStore): CupStore {
            shared?.takeIf { it.game === game }?.let { return it }
            return CupStore(game, game.viewModelScope).also { shared = it }
        }

        /**
         * The poll the screen in front is running, so the card can join and
         * leave through the same one the tournament room reads.
         *
         * The card is handed only the cup by the tab that draws it, and iOS's
         * card holds the whole watcher. Rather than start a second poll —
         * two polls is two walks into the same table — the one already
         * running says where it is. Only one tab is composed at a time, so
         * there is only ever one in front.
         */
        var front: CupStore? by mutableStateOf(null)
    }
}

/**
 * The app's one cup poll, the same instance whichever tab asks — see
 * [CupStore.shared]. Asking for it is what (re)starts the watch, and it is not
 * torn down when the tab that asked goes away.
 */
@Composable
fun rememberCupStore(game: GameStore): CupStore {
    val cups = remember(game) { CupStore.shared(game) }
    LaunchedEffect(cups) { cups.ensureWatching() }
    DisposableEffect(cups) {
        CupStore.front = cups
        onDispose { }
    }
    return cups
}

// ──────────────────────────────────────────────────────────────── the card ──

/**
 * The cup on the Social tab, face for face with iOS's CupCard: announced,
 * open for joining, being played, and over — each with the controls that
 * state wants, on the card itself.
 *
 * Draws nothing at all when there is no cup, which is also what happens when
 * the owner has cups switched off — [CupStore.live] is null either way. A
 * finished cup with no standings draws nothing either, exactly as on iOS.
 *
 * [onOpen] is the tournament room, which the header and "Open the tournament"
 * lead to. Everything else the card does itself: the poll it joins and leaves
 * through is [CupStore.front], and the account and the table come from the
 * activity's own stores, the same instances the tab above was handed.
 */
@Composable
fun CupCard(cup: CupView?, onOpen: () -> Unit) {
    if (cup == null) return
    if (cup.state !in CARD_STATES) return
    val standings = cup.standings
    if (cup.state == "done" && standings == null) return

    val cups = CupStore.front
    val game: GameStore = viewModel()
    val account: AccountStore = viewModel()
    // Entering needs an account — a prize needs somebody it can be paid to —
    // and the Social tab reads "signed in" the same way when it opens the room.
    val signedIn = account.me?.provider != null
    val busy = cups?.busy == true
    var poster by remember { mutableStateOf(false) }
    var code by remember(cup.id) { mutableStateOf("") }
    val p = P.current

    // A tap that has nowhere to go opens the room, which says what to do —
    // only reachable if the tab never started its poll, which it always does.
    fun join(withCode: String = "") = cups?.enter(withCode) ?: onOpen()

    LandingCard(padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when (cup.state) {
                // Announced, not open. Everybody can see it and count down to
                // it, and nobody can enter yet — a cup that opens the second
                // the owner presses a button is only played by whoever
                // happened to be online at that second.
                "scheduled" -> {
                    CupHead(cup, "Knockout — last one standing takes ${cupMoney(cup, CupPlace.FIRST)}", "soon", onOpen)
                    cup.openedAt?.let { opens ->
                        val now = tick(1000)
                        Row(Modifier.fillMaxWidth()) {
                            Text(
                                "Joining opens in",
                                color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                                modifier = Modifier.weight(1f).alignByBaseline(),
                            )
                            Text(
                                countdown(opens.toLong() - now),
                                color = p.gold, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold,
                                style = TABULAR, modifier = Modifier.alignByBaseline(),
                            )
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon("snooze", size = 13.dp)
                            Spacer(Modifier.width(6.dp))
                            Text(
                                (whenText(opens, LONG_DATE) ?: "") + windowNote(cup),
                                color = p.ink2, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
                            )
                        }
                    }
                    PrizeRow(cup.prize, cup.local)
                    CardNote("Come back then — joining takes one tap.", p.ink3)
                    MoreButton("What is a cup?", "question") { poster = true }
                    OtherCups(cups)
                }

                "joining" -> {
                    CupHead(cup, "Knockout — last one standing takes ${cupMoney(cup, CupPlace.FIRST)}", null, onOpen)
                    DoorClock(cup)
                    PrizeRow(cup.prize, cup.local)
                    when {
                        !signedIn -> Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(11.dp))
                                .background(p.sunken)
                                .padding(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon("key", size = 14.dp)
                            Spacer(Modifier.width(7.dp))
                            // The sign-in buttons are on the account card,
                            // directly above this one on the same tab.
                            Text(
                                "Sign in above to join — a prize needs somebody to pay",
                                color = p.ink2, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
                            )
                        }

                        cup.you.joined -> {
                            CardNote("Joined. Your first game starts when joining closes.", p.good)
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                MoreButton("How it works", "question", Modifier.weight(1f)) { poster = true }
                                // Only as wide as its word, in the middle of
                                // its half — iOS frames Leave outside its
                                // style, so the well hugs the label.
                                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                                    LandingButton("Leave", LandingKind.GHOST, enabled = !busy) { cups?.leave() }
                                }
                            }
                        }

                        else -> {
                            if (cup.needsCode) {
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    // Empty because the app genuinely does not
                                    // know the answer: the server never sends
                                    // an invite cup's code, only that one is
                                    // wanted.
                                    CodeField(code, Modifier.weight(1f)) { code = it }
                                    LandingButton(
                                        "",
                                        LandingKind.GOLD,
                                        enabled = !busy,
                                        lead = { ink ->
                                            Row(
                                                Modifier.padding(horizontal = 4.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                            ) {
                                                if (busy) LandingSpinner(ink, size = 17.dp) else Icon("trophy", size = 17.dp)
                                                Spacer(Modifier.width(7.dp))
                                                Text(
                                                    if (busy) "…" else "Join",
                                                    color = ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                                                )
                                            }
                                        },
                                    ) { join(code) }
                                }
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    Icon("key", size = 13.dp)
                                    Spacer(Modifier.width(7.dp))
                                    Text(
                                        "Invite only — you need the code from whoever set it up.",
                                        color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                                    )
                                }
                            } else {
                                LandingButton(
                                    if (busy) "Joining…" else "Join",
                                    LandingKind.GOLD,
                                    modifier = Modifier.fillMaxWidth(),
                                    enabled = !busy,
                                    lead = { ink ->
                                        if (busy) LandingSpinner(ink, size = 18.dp) else Icon("trophy", size = 18.dp)
                                    },
                                ) { join() }
                            }
                            MoreButton("What is a cup?", "question") { poster = true }
                        }
                    }
                    OtherCups(cups)
                }

                "running" -> {
                    CupHead(cup, roundName(cup.round), null, onOpen)
                    val matches = cup.round?.matches.orEmpty()
                    if (matches.isNotEmpty()) TableLights(matches.take(60).map { it.state != "done" })
                    PrizeRow(cup.prize, cup.local)
                    CardNote(standingLine(cup), if (cup.you.roomId != null) p.good else p.ink3)
                    cup.you.roomId?.let { room ->
                        LandingButton(
                            "Go to your table",
                            LandingKind.PRIMARY,
                            modifier = Modifier.fillMaxWidth(),
                            // In the table's ink, not the button's: iOS hands
                            // this drawing no tint, and an untinted drawing
                            // paints itself in ink rather than taking the
                            // label's colour.
                            lead = { Icon("dice", size = 18.dp) },
                        ) {
                            Haptics.tap()
                            game.connect(room)
                        }
                    }
                    MoreButton("Open the tournament", "chart") { onOpen() }
                    OtherCups(cups)
                }

                // Over. The server keeps a finished cup in front of everyone
                // for a few minutes, because one that vanishes the moment it
                // is won never tells the winner they won it.
                else -> {
                    val s = standings ?: return@Column
                    CupHead(
                        cup,
                        s.first?.let { "${it.name ?: "Somebody"} takes it" } ?: "Nobody finished this one",
                        null, onOpen,
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        PlaceRow("1st", s.first, cupMoney(cup, CupPlace.FIRST), gold = true,
                            mine = cup.you.placed == "first", style = PlaceStyle.CARD)
                        PlaceRow("2nd", s.second, cupMoney(cup, CupPlace.SECOND), gold = false,
                            mine = cup.you.placed == "second", style = PlaceStyle.CARD)
                        PlaceRow("3rd", s.third, cupMoney(cup, CupPlace.THIRD), gold = false,
                            mine = cup.you.placed == "third", style = PlaceStyle.CARD)
                    }
                    if (cup.you.placed != null) {
                        CardNote(
                            "You finished ${cup.you.placed}. The prize is paid by hand — hold on to your friend code.",
                            p.good,
                        )
                    }
                    MoreButton("Open the tournament", "chart") { onOpen() }
                    OtherCups(cups)
                }
            }
        }
    }

    if (poster) CupPosterSheet(cup) { poster = false }
}

private val CARD_STATES = setOf("scheduled", "joining", "running", "done")

/**
 * The top of every face: the trophy, the name and one line under it, and on
 * the right a chevron and the head-count. The whole row opens the room.
 */
@Composable
private fun CupHead(cup: CupView, subtitle: String, countLabel: String?, onOpen: () -> Unit) {
    val p = P.current
    val tile = RoundedCornerShape(13.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(tile)
            .clickable { Haptics.tap(); onOpen() },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(42.dp)
                .clip(tile)
                .background(p.goldSoft)
                .border(1.dp, p.gold, tile),
            contentAlignment = Alignment.Center,
        ) { Icon("trophy", size = 20.dp) }
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                cup.name,
                color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                subtitle,
                color = p.ink3, fontSize = 11.5.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        }
        // iOS's Spacer(minLength: 6) between two eleven-point gaps.
        Spacer(Modifier.width(28.dp))
        RowChevron(p.ink3, size = 11.dp)
        Spacer(Modifier.width(11.dp))
        val announced = countLabel != null
        Text(
            countLabel
                ?: if (cup.maxPlayers > 0) "${cup.entrants}/${cup.maxPlayers} joined" else "${cup.entrants} joined",
            modifier = Modifier
                .clip(RoundedCornerShape(99.dp))
                .background(if (announced) p.goldSoft else p.sunken)
                .border(1.dp, if (announced) p.gold else p.rule, RoundedCornerShape(99.dp))
                .padding(horizontal = 9.dp, vertical = 4.dp),
            color = if (announced) p.gold else p.ink2,
            fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, style = TABULAR, maxLines = 1,
        )
    }
}

/** "What is a cup?", "How it works", "Open the tournament": a plain well, full width. */
@Composable
private fun MoreButton(title: String, glyph: String, modifier: Modifier = Modifier.fillMaxWidth(), onTap: () -> Unit) {
    LandingButton(
        title,
        LandingKind.GHOST,
        modifier = modifier,
        gap = 7.dp,
        lead = { ink -> Icon(glyph, size = 14.dp, tint = ink) },
    ) {
        Haptics.tap()
        onTap()
    }
}

/** One sentence on the card, in whichever ink the moment calls for. */
@Composable
private fun CardNote(text: String, tone: Color) {
    Text(
        text,
        modifier = Modifier.fillMaxWidth(),
        color = tone, fontSize = 12.5.sp, lineHeight = 17.sp, fontWeight = FontWeight.Medium,
    )
}

/** The box a join code goes in: wide, heavy and monospaced, in capitals. */
@Composable
private fun CodeField(value: String, modifier: Modifier = Modifier, onChange: (String) -> Unit) {
    val p = P.current
    val shape = RoundedCornerShape(12.dp)
    val face = TextStyle(
        color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, fontFamily = FontFamily.Monospace,
    )
    BasicTextField(
        value = value,
        onValueChange = { onChange(it.uppercase().take(16)) },
        modifier = modifier,
        singleLine = true,
        textStyle = face,
        cursorBrush = SolidColor(p.red),
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.Characters,
            autoCorrectEnabled = false,
        ),
        decorationBox = { inner ->
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(46.dp)
                    .clip(shape)
                    .background(p.sunken)
                    .border(1.dp, p.rule, shape)
                    .padding(horizontal = 13.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (value.isEmpty()) Text("JOIN CODE", style = face.copy(color = p.ink3))
                inner()
            }
        },
    )
}

/**
 * The three places, first among them wider in weight — it is what everybody
 * is here for. The poster pads them a point taller than the card does.
 */
@Composable
private fun PrizeRow(prize: CupPrize, local: CupLocalPrize?, tall: Boolean = false) {
    val p = P.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PrizePill("1st", cupMoney(prize, local, CupPlace.FIRST), true, tall, Modifier.weight(1f))
        PrizePill("2nd", cupMoney(prize, local, CupPlace.SECOND), false, tall, Modifier.weight(1f))
        PrizePill("3rd", cupMoney(prize, local, CupPlace.THIRD), false, tall, Modifier.weight(1f))
    }
}

@Composable
private fun PrizePill(place: String, amount: String, big: Boolean, tall: Boolean, modifier: Modifier = Modifier) {
    val p = P.current
    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier
            .clip(shape)
            .background(if (big) p.goldSoft else p.sunken)
            .border(1.dp, if (big) p.gold else p.rule, shape)
            .padding(vertical = if (tall) 9.dp else 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            place.uppercase(),
            color = if (big) p.gold else p.ink3,
            fontSize = 10.sp, letterSpacing = 0.9.sp, fontWeight = FontWeight.ExtraBold,
        )
        // Shrinks rather than cuts, down to seven-tenths: "≈₹16,700" is the
        // whole point of the pill and cannot lose its last digit.
        FitText(
            amount,
            color = if (big) p.gold else p.ink,
            fontSize = if (big) 17.sp else 14.sp,
            fontWeight = FontWeight.ExtraBold,
            minScale = 0.7f,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * The door, drawn as a bar that empties. A number on its own makes the reader
 * do the arithmetic; a bar says at a glance whether there is time to think.
 */
@Composable
private fun DoorClock(cup: CupView) {
    val p = P.current
    val closes = cup.closesAt ?: return
    val now = tick(500)
    val left = (closes.toLong() - now).coerceAtLeast(0L)
    val opened = cup.openedAt?.toLong() ?: (closes.toLong() - 300_000L)
    val span = (closes.toLong() - opened).coerceAtLeast(1L)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(
                "Joining closes in",
                color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                modifier = Modifier.weight(1f).alignByBaseline(),
            )
            Text(
                countdown(left),
                // Under half a minute the clock stops being information and
                // starts being a nudge.
                color = if (left <= 30_000L) p.bad else p.ink,
                fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, style = TABULAR,
                modifier = Modifier.alignByBaseline(),
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(5.dp)
                .clip(RoundedCornerShape(99.dp))
                .background(p.sunken)
                .border(1.dp, p.rule, RoundedCornerShape(99.dp)),
        ) {
            Box(
                Modifier
                    .fillMaxWidth((left.toFloat() / span.toFloat()).coerceIn(0f, 1f))
                    .height(5.dp)
                    .clip(RoundedCornerShape(99.dp))
                    .background(Brush.horizontalGradient(listOf(p.gold, p.red))),
            )
        }
    }
}

/**
 * One light per table in the round being played: lit and breathing while it
 * is still being fought over, dim once it is decided. A big cup has fifty of
 * them, so they wrap — eight-point dots, thirteen-point columns five apart,
 * as iOS's adaptive grid lays them.
 */
@Composable
private fun TableLights(live: List<Boolean>) {
    val p = P.current
    val column = 13.dp
    val gutter = 5.dp
    val dot = 8.dp
    val pulse by rememberInfiniteTransition(label = "lights").animateFloat(
        1f, 0.4f,
        infiniteRepeatable(tween(1_600, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "pulse",
    )
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val perRow = (((maxWidth + gutter) / (column + gutter)).toInt()).coerceAtLeast(1)
        val rows = ((live.size + perRow - 1) / perRow).coerceAtLeast(1)
        val density = LocalDensity.current
        val stepX = with(density) { (column + gutter).toPx() }
        val stepY = with(density) { (dot + gutter).toPx() }
        val half = with(density) { (dot / 2).toPx() }
        val centreX = with(density) { (column / 2).toPx() }
        Canvas(Modifier.fillMaxWidth().height(dot * rows + gutter * (rows - 1))) {
            live.forEachIndexed { i, on ->
                drawCircle(
                    color = if (on) p.gold else p.rule2,
                    radius = half,
                    center = Offset(
                        x = (i % perRow) * stepX + centreX,
                        y = (i / perRow) * stepY + half,
                    ),
                    alpha = if (on) pulse else 1f,
                )
            }
        }
    }
}

/**
 * The cups this card is not showing. A screen has room for one card and a
 * person can be interested in more than one cup.
 */
@Composable
private fun OtherCups(cups: CupStore?) {
    val others = cups?.others.orEmpty()
    if (others.isEmpty()) return
    val p = P.current
    // One clock read at the top and handed down the list: [tick] starts a
    // coroutine per call, and six cups counting towards six different minutes
    // do not need six of them to agree on the same second.
    val now = tick(1000)
    Column(Modifier.padding(top = 2.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Rule()
        Text(
            "ALSO ON",
            color = p.ink3, fontSize = 10.sp, letterSpacing = 1.sp, fontWeight = FontWeight.ExtraBold,
        )
        for (o in others) {
            OtherCupRow(o, now) {
                Haptics.tap()
                cups?.show(o.id)
            }
        }
    }
}

@Composable
private fun OtherCupRow(o: CupBrief, now: Long, onPick: () -> Unit) {
    val p = P.current
    val shape = RoundedCornerShape(11.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.sunken)
            .border(1.dp, p.rule, shape)
            .clickable { onPick() }
            .padding(vertical = 9.dp, horizontal = 11.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                o.name, color = p.ink, fontSize = 13.sp,
                fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (o.joined) {
                Spacer(Modifier.width(7.dp))
                Text(
                    "JOINED", color = p.good, fontSize = 8.5.sp,
                    letterSpacing = 0.6.sp, fontWeight = FontWeight.Black,
                )
            }
        }
        val count = if (o.maxPlayers > 0) "${o.entrants}/${o.maxPlayers}" else "${o.entrants}"
        val code = if (o.needsCode) " · invite only" else ""
        Text(
            when (o.state) {
                "scheduled" -> "opens in ${countdown((o.openedAt?.toLong() ?: 0L) - now)} · $count$code"
                "joining" -> "closes in ${countdown((o.closesAt?.toLong() ?: 0L) - now)} · $count$code"
                "running" -> "being played · $count"
                else -> "finished"
            },
            color = p.ink2, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
        )
    }
}

/** Which of iOS's three standings rows a [PlaceRow] is drawn as. */
private enum class PlaceStyle { CARD, ROOM, CHART }

/**
 * One place on the podium: "1ST", who, and what it pays.
 *
 * iOS draws it three times, a little differently each time — tighter on the
 * card, with the friend code and an add button in the room, plain on the
 * chart — and [style] says which. [onAdd] is the room's add button; [asked]
 * turns it into a tick once the request has gone.
 */
@Composable
private fun PlaceRow(
    place: String,
    who: CupPlacing?,
    amount: String,
    gold: Boolean,
    mine: Boolean,
    style: PlaceStyle,
    asked: Boolean = false,
    onAdd: (() -> Unit)? = null,
) {
    val p = P.current
    val card = style == PlaceStyle.CARD
    val shape = RoundedCornerShape(if (card) 11.dp else 12.dp)
    val code = who?.code.orEmpty()
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (gold) p.goldSoft else p.sunken)
            .border(
                if (mine) 2.dp else 1.dp,
                if (mine) p.good else if (gold) p.gold else p.rule,
                shape,
            )
            .padding(vertical = if (card) 8.dp else 9.dp, horizontal = if (card) 11.dp else 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            place.uppercase(),
            modifier = Modifier.width(26.dp),
            color = if (gold) p.gold else p.ink3,
            fontSize = 10.sp, fontWeight = FontWeight.ExtraBold,
            letterSpacing = if (card) 0.9.sp else 0.sp,
            maxLines = 1,
        )
        Spacer(Modifier.width(if (style == PlaceStyle.ROOM) 10.dp else 9.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(
                who?.name ?: "—",
                color = p.ink, fontSize = 13.5.sp, fontWeight = FontWeight.ExtraBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (style == PlaceStyle.ROOM && code.isNotEmpty()) {
                Text(
                    code,
                    color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
        Spacer(Modifier.width(6.dp))
        Text(
            amount,
            color = if (gold) p.gold else p.ink2,
            fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, style = TABULAR,
        )
        // Playing somebody is the best introduction there is, so the people
        // you just played are one tap from being friends.
        if (onAdd != null) {
            Spacer(Modifier.width(10.dp))
            Box(
                Modifier
                    .size(30.dp)
                    .clip(CircleShape)
                    .background(p.card)
                    .clickable(enabled = !asked) { onAdd() },
                contentAlignment = Alignment.Center,
            ) {
                // iOS's person.badge.plus and checkmark, both drawn here: the
                // generated set has neither a person with a plus nor a tick.
                if (asked) Tick(p.good, 13.dp) else PersonPlus(p.ink2, 15.dp)
            }
        }
    }
}

/**
 * iOS's person.badge.plus, drawn: a head and shoulders with a plus at the
 * shoulder, in strokes the weight of the tick that replaces it.
 */
@Composable
private fun PersonPlus(tint: Color, size: Dp) {
    Canvas(Modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height
        val stroke = w * 0.12f
        // The head, and the shoulders under it as a half-round.
        drawCircle(tint, radius = w * 0.17f, center = Offset(w * 0.36f, h * 0.30f), style = Stroke(width = stroke))
        val shoulders = Path().apply {
            moveTo(w * 0.06f, h * 0.90f)
            cubicTo(w * 0.06f, h * 0.58f, w * 0.66f, h * 0.58f, w * 0.66f, h * 0.90f)
        }
        drawPath(shoulders, tint, style = Stroke(width = stroke, cap = StrokeCap.Round))
        // The plus, up by the shoulder, where iOS's badge sits.
        val cx = w * 0.82f
        val cy = h * 0.42f
        val arm = w * 0.15f
        drawLine(tint, Offset(cx - arm, cy), Offset(cx + arm, cy), strokeWidth = stroke, cap = StrokeCap.Round)
        drawLine(tint, Offset(cx, cy - arm), Offset(cx, cy + arm), strokeWidth = stroke, cap = StrokeCap.Round)
    }
}

/** A tick, drawn: iOS's checkmark, for a request that has gone. */
@Composable
private fun Tick(tint: Color, size: Dp) {
    Canvas(Modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height
        val path = Path().apply {
            moveTo(w * 0.12f, h * 0.55f)
            lineTo(w * 0.40f, h * 0.82f)
            lineTo(w * 0.90f, h * 0.20f)
        }
        drawPath(
            path, tint,
            style = Stroke(width = w * 0.16f, cap = StrokeCap.Round, join = StrokeJoin.Round),
        )
    }
}

// ─────────────────────────────────────────────────────────────── the sheets ──

/**
 * The bar iOS's navigation stack draws over a sheet: the title centred, and
 * the way out on the right in the table's accent. It stays put while the page
 * scrolls under it, as the iPhone's does.
 */
@Composable
private fun CupNavBar(title: String, action: String, onAction: () -> Unit) {
    val p = P.current
    Box(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 16.dp)) {
        Text(
            title,
            modifier = Modifier.align(Alignment.Center).padding(horizontal = 64.dp),
            color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Text(
            action,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .clip(RoundedCornerShape(8.dp))
                .clickable { onAction() }
                .padding(horizontal = 4.dp, vertical = 6.dp),
            color = p.red, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
        )
    }
}

/** iOS's section label in the room and the chart: small, heavy, spaced capitals. */
@Composable
private fun CupLabel(text: String) {
    Text(
        text.uppercase(),
        color = P.current.ink3, fontSize = 10.5.sp, letterSpacing = 1.sp, fontWeight = FontWeight.ExtraBold,
    )
}

/**
 * The tournament room — iOS's CupDetailSheet. It exists to answer the
 * question a player in a cup actually has at nine in the evening: not "what
 * round am I in" but "who do I play, when does the door open, and what
 * happens if I miss it". That goes at the top; everything else is history.
 *
 * Joining is not here. It is on the card, as it is on iOS, and a player who
 * has not joined is told where to find it.
 *
 * The whole chart is a sheet of its own over the room, as on iOS, under the
 * bar iOS gives it: its Done closes it back onto the room, which has kept its
 * place underneath.
 *
 * [signedIn] is no longer read: the sign-in note lives on the card now. It
 * stays in the signature for the tab that opens this.
 */
@Suppress("UNUSED_PARAMETER")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CupDetailSheet(
    cups: CupStore,
    game: GameStore,
    signedIn: Boolean,
    onDismiss: () -> Unit,
) {
    val p = P.current
    // The cup this room was opened on, kept: iOS's room shows the watcher's
    // live copy only while it is the same cup, and its own snapshot
    // otherwise — so a finished cup ageing off the server does not shut the
    // room mid-read, and a server that moves on to another cup does not turn
    // this room into that one under the reader.
    val opened = remember { cups.live }
    val cup = cups.live?.takeIf { it.id == opened?.id } ?: opened
    if (cup == null) {
        LaunchedEffect(Unit) { onDismiss() }
        return
    }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var chart by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.page,
        dragHandle = null,
    ) {
        Box(Modifier.fillMaxWidth()) {
            Column(Modifier.fillMaxWidth()) {
                CupNavBar(cup.name, "Done", onDismiss)
                Column(
                    Modifier
                        .weight(1f, fill = false)
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp)
                        .padding(bottom = 12.dp),
                ) {
                    DetailBody(cup, game, onDismiss) { chart = true }
                }
            }
            // A sheet is a window over the one the app's toast is drawn in;
            // iOS floats its toasts over every sheet, so the podium's "Request
            // sent" and "Your cup table is ready" are drawn here too.
            ToastPill(game, Modifier.align(Alignment.BottomCenter))
        }
    }

    if (chart) CupChartSheet(cups, cup.id) { chart = false }
}

/**
 * The chart — iOS's CupChartSheet — over the room: the bracket's own name in
 * the bar once it has landed, "The chart" until then, and Done to go back.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CupChartSheet(cups: CupStore, cupId: String, onDismiss: () -> Unit) {
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.page,
        dragHandle = null,
    ) {
        Column(Modifier.fillMaxWidth()) {
            val b = cups.bracket?.takeIf { it.id == cupId }
            CupNavBar(b?.name ?: "The chart", "Done", onDismiss)
            Column(
                Modifier
                    .weight(1f, fill = false)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp)
                    .padding(bottom = 12.dp),
            ) {
                CupBracket(cups, cupId)
            }
        }
    }
}

@Composable
private fun DetailBody(
    cup: CupView,
    game: GameStore,
    onDismiss: () -> Unit,
    onChart: () -> Unit,
) {
    val p = P.current
    val scope = rememberCoroutineScope()
    var asked by remember { mutableStateOf(emptySet<String>()) }

    // Playing somebody is the best introduction there is, so the people on
    // the podium are one tap from being friends — iOS's add button, and its
    // two answers, in its words when the server gives none. The friends list
    // behind this sheet keeps itself live, so it catches up on its own.
    fun ask(code: String) {
        scope.launch {
            val reply = game.api.postOrError("/api/friends", mapOf("code" to code))
            if (reply.ok) {
                asked = asked + code
                Haptics.tap()
                game.showToast("Request sent")
            } else {
                game.showToast(reply.error ?: "Could not send that", isError = true)
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        // The banner: who may enter, what it pays, and when it runs.
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(54.dp)
                    .clip(RoundedCornerShape(15.dp))
                    .background(p.goldSoft)
                    .border(1.dp, p.gold, RoundedCornerShape(15.dp)),
                contentAlignment = Alignment.Center,
            ) { Icon("trophy", size = 26.dp) }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    if (cup.needsCode) "Invite only" else "Open to everyone",
                    color = p.ink3, fontSize = 10.sp,
                    letterSpacing = 0.8.sp, fontWeight = FontWeight.ExtraBold,
                )
                Text(
                    "Knockout — last one standing takes ${cupMoney(cup, CupPlace.FIRST)}",
                    color = p.ink2, fontSize = 12.5.sp, lineHeight = 17.sp, fontWeight = FontWeight.SemiBold,
                )
                scheduleLine(cup.schedule)?.let {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon("snooze", size = 12.dp)
                        Spacer(Modifier.width(5.dp))
                        Text(it, color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tile("Prize pool", poolMoney(cup.prize, cup.local), Modifier.weight(1f))
            Tile(
                if (cup.state == "done") "Finished" else "Round",
                if (cup.state == "done") "—" else "${cup.you.round ?: cup.rounds} of ${depth(cup.entrants)}",
                Modifier.weight(1f),
            )
            Tile("Still in", "${cup.you.left ?: cup.entrants}", Modifier.weight(1f))
        }

        cup.you.next?.let { NextMatch(it, cup, game, onDismiss) }

        if (!cup.you.joined) {
            if (cup.state == "joining") {
                Text(
                    "You have not joined this one. Close this and tap Join on the card.",
                    color = p.ink3, fontSize = 12.5.sp, lineHeight = 17.sp, fontWeight = FontWeight.Medium,
                )
            } else if (cup.you.out) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(p.sunken)
                        .padding(11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon("skull", size = 15.dp)
                    Spacer(Modifier.width(7.dp))
                    Text(
                        "You are out of this one. The chart below shows how it finished.",
                        color = p.ink2, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }

        val run = yourRun(cup)
        if (run.isNotEmpty()) {
            CupLabel("Your run")
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (rung in run) RunRung(rung)
            }
        }

        cup.standings?.takeIf { it.first != null }?.let { s ->
            CupLabel("Final standings")
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((label, who, place) in listOf(
                    Triple("1st", s.first, CupPlace.FIRST),
                    Triple("2nd", s.second, CupPlace.SECOND),
                    Triple("3rd", s.third, CupPlace.THIRD),
                )) {
                    val code = who?.code.orEmpty()
                    val mine = code.isNotEmpty() && code == cup.you.code
                    PlaceRow(
                        label, who, cupMoney(cup, place),
                        gold = place == CupPlace.FIRST, mine = mine, style = PlaceStyle.ROOM,
                        asked = code in asked,
                        onAdd = if (code.isNotEmpty() && !mine) ({ ask(code) }) else null,
                    )
                }
            }
        }

        if (cup.plan.isNotEmpty()) {
            CupLabel("The whole plan")
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (r in cup.plan) PlanRow(r)
            }
        }

        LandingButton(
            "See the whole chart",
            LandingKind.GHOST,
            big = true,
            lead = { ink -> Icon("chart", size = 16.dp, tint = ink) },
        ) {
            Haptics.tap()
            onChart()
        }

        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            CupLabel("How it works")
            for (line in ruleLines(cup)) {
                Row(Modifier.fillMaxWidth()) {
                    Box(
                        Modifier
                            .padding(top = 6.dp)
                            .size(4.dp)
                            .clip(CircleShape)
                            .background(p.ink3),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        line,
                        color = p.ink3, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
    }
}

@Composable
private fun Tile(label: String, value: String, modifier: Modifier = Modifier) {
    val p = P.current
    val shape = RoundedCornerShape(13.dp)
    Column(
        modifier
            .clip(shape)
            .background(p.sunken)
            .border(1.dp, p.rule, shape)
            .padding(vertical = 11.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(
            label,
            color = p.ink3, fontSize = 10.5.sp,
            letterSpacing = 0.7.sp, fontWeight = FontWeight.ExtraBold,
            textAlign = TextAlign.Center, maxLines = 1,
        )
        FitText(
            value,
            color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.Black,
            minScale = 0.6f, textAlign = TextAlign.Center,
        )
    }
}

/** Who, when the door opens, when it shuts, and the way in once there is one. */
@Composable
private fun NextMatch(next: CupNext, cup: CupView, game: GameStore, onDismiss: () -> Unit) {
    val p = P.current
    val now = tick(1000)
    val shape = RoundedCornerShape(15.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (next.open) p.goldSoft else p.sunken)
            .border(if (next.open) 1.5.dp else 1.dp, if (next.open) p.gold else p.rule, shape)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        Text(
            if (next.open) "YOUR MATCH IS OPEN" else "YOUR NEXT MATCH",
            color = if (next.open) p.good else p.ink3,
            fontSize = 10.5.sp, letterSpacing = 0.9.sp, fontWeight = FontWeight.ExtraBold,
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Contender(cup.you.name ?: "You", mine = true, modifier = Modifier.weight(1f))
            Text(
                "v", color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.padding(horizontal = 10.dp),
            )
            Contender(next.opponent ?: "a bye", mine = false, modifier = Modifier.weight(1f))
        }

        if (!next.open && next.opensAt != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon("snooze", size = 13.dp)
                Spacer(Modifier.width(6.dp))
                Text(
                    "Opens in ${countdown(next.opensAt.toLong() - now)} · " +
                        (whenText(next.opensAt, SHORT_TIME) ?: ""),
                    color = p.ink2, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
                )
            }
        } else if (next.open && next.closesAt != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon("warning", size = 13.dp)
                Spacer(Modifier.width(6.dp))
                Text(
                    "Door shuts in ${countdown(next.closesAt.toLong() - now)} — " +
                        "miss it and you are out",
                    color = p.bad, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
                )
            }
        }

        val room = next.roomId
        if (room != null) {
            LandingButton(
                "Play your match",
                LandingKind.PRIMARY,
                big = true,
                // The table's ink, as on the card's "Go to your table": iOS
                // gives this drawing no tint of its own.
                lead = { Icon("dice", size = 18.dp) },
            ) {
                Haptics.turn()
                onDismiss()
                game.connect(room)
            }
        } else if (next.open) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                LandingSpinner(p.gold, size = 16.dp)
                Spacer(Modifier.width(7.dp))
                Text(
                    "Making your table…",
                    color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

@Composable
private fun Contender(name: String, mine: Boolean, modifier: Modifier = Modifier) {
    val p = P.current
    val shape = RoundedCornerShape(11.dp)
    Box(
        modifier
            .clip(shape)
            .background(if (mine) p.card else p.card.copy(alpha = p.card.alpha * 0.6f))
            .border(1.dp, if (mine) p.gold else p.rule, shape)
            .padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            name,
            color = if (mine) p.ink else p.ink2,
            fontSize = 14.sp, fontWeight = FontWeight.ExtraBold,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

private class Rung(val label: String, val line: String, val kind: Int, val players: Int = 0)

/**
 * Where this player has got to, built from the round the card already
 * carries. The whole bracket is a fetch of its own, and this sheet has to
 * open instantly.
 */
private fun yourRun(cup: CupView): List<Rung> {
    val me = cup.you.name ?: return emptyList()
    val round = cup.round ?: return emptyList()
    return round.matches.filter { it.a == me || it.b == me }.map { m ->
        val other = if (m.a == me) m.b else m.a
        val won = m.winner == me
        Rung(
            label = if (round.kind == "final") "The final" else "Round ${round.n}",
            line = when {
                m.state != "done" -> "playing ${other ?: "…"}"
                won -> "beat ${other ?: "a walkover"}"
                else -> "lost to ${m.winner ?: "the other side"}"
            },
            kind = if (m.state != "done") 2 else if (won) 1 else 0,
        )
    }
}

@Composable
private fun RunRung(rung: Rung) {
    val p = P.current
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.sunken)
            .border(1.dp, p.rule, shape)
            .padding(vertical = 9.dp, horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RungDot(rung.kind)
        Spacer(Modifier.width(10.dp))
        Text(rung.label, color = p.ink, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold)
        Spacer(Modifier.width(10.dp))
        Text(
            rung.line,
            color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.Medium,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Gold while it is still being played, green for a win, red for the loss. */
@Composable
private fun RungDot(kind: Int) {
    val p = P.current
    Box(
        Modifier
            .size(9.dp)
            .clip(CircleShape)
            .background(if (kind == 2) p.gold else if (kind == 1) p.good else p.bad),
    )
}

/**
 * Every round, with the evening it falls on.
 *
 * A knockout is completely predictable — each round halves the field and
 * takes the next slot on the clock — so nobody should have to work out how
 * many nights they have signed up to, or which one they can miss.
 */
@Composable
private fun PlanRow(r: CupPlanRound) {
    val p = P.current
    val live = r.yours && !r.done
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (live) p.goldSoft else p.sunken)
            .border(1.dp, if (live) p.gold else p.rule, shape)
            .padding(vertical = 8.dp, horizontal = 11.dp)
            .alpha(if (r.done) 0.6f else 1f),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(22.dp)
                .clip(CircleShape)
                .background(if (r.yours) p.goldSoft else p.card)
                .border(1.dp, if (r.yours) p.gold else p.rule, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "${r.n}",
                color = if (r.done) p.ink3 else p.ink2,
                fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, style = TABULAR,
            )
        }
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(
                r.label,
                color = if (r.done) p.ink3 else p.ink,
                fontSize = 13.sp, fontWeight = FontWeight.ExtraBold,
            )
            Text(
                "${r.players} players → ${(r.players + 1) / 2} through",
                color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.Medium,
            )
        }
        Spacer(Modifier.width(6.dp))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
            whenText(r.opensAt, SHORT_DATE)?.let {
                Text(
                    it,
                    color = if (r.done) p.ink3 else p.ink2,
                    fontSize = 12.sp, fontWeight = FontWeight.ExtraBold,
                )
            }
            if (r.done || r.projected) {
                Text(
                    if (r.done) "played" else "planned",
                    color = p.ink3, fontSize = 9.5.sp, fontWeight = FontWeight.ExtraBold,
                )
            }
        }
    }
}

/**
 * The rules that catch people out, in the order they catch them.
 *
 * The last line is not decoration: a prize contest inside an app has to say
 * plainly that the shop it was downloaded from has nothing to do with it. iOS
 * names Apple; this names Google, whose shop this one came from.
 */
private fun ruleLines(cup: CupView): List<String> {
    val out = mutableListOf("Win your match and you go through. Lose it and you are out.")
    val sched = cup.schedule?.takeIf { it.times.isNotEmpty() }
    if (sched != null) {
        out += "Each round opens at its time and stays open ${sched.windowMinutes} minutes. " +
            "Turn up inside that window or you are out — even if you would have won."
        out += "A game still running when the next round is due is decided on net worth — " +
            "whoever is ahead goes through, so one long game never holds up everybody else's evening."
    }
    out += "Free to enter — no coins, no purchase, no payment of any kind."
    out += "Prizes are awarded and paid by hand by MoneyMove, the organiser. Keep your friend code."
    out += "Google is not a sponsor of this tournament and is not involved in it in any way."
    return out
}

// ─────────────────────────────────────────────────────────────── the poster ──

/**
 * What a cup is — iOS's CupPosterSheet — in the order somebody deciding
 * whether to enter wants it: the prize, the shape of the thing, and the rules
 * that catch people out. Opened by "What is a cup?" and "How it works" on the
 * card, which is not inside a sheet, so this is a sheet of its own.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CupPosterSheet(cup: CupView, onDismiss: () -> Unit) {
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.page,
        dragHandle = null,
    ) {
        Column(Modifier.fillMaxWidth()) {
            CupNavBar("The cup", "Done", onDismiss)
            Column(
                Modifier
                    .weight(1f, fill = false)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Box(
                    Modifier
                        .size(62.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(p.goldSoft)
                        .border(1.dp, p.gold, RoundedCornerShape(20.dp)),
                    contentAlignment = Alignment.Center,
                ) { Icon("trophy", size = 30.dp) }

                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(
                        cup.name,
                        color = p.ink, fontSize = 23.sp, fontWeight = FontWeight.Black,
                        textAlign = TextAlign.Center,
                    )
                    Text(
                        "Knockout · winner takes ${cupMoney(cup, CupPlace.FIRST)}",
                        color = p.ink2, fontSize = 12.5.sp, fontWeight = FontWeight.Medium,
                    )
                }

                PrizeRow(cup.prize, cup.local, tall = true)

                PosterRungs(cup)

                cup.schedule?.takeIf { it.times.isNotEmpty() }?.let { WhenBox(cup, it) }

                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    PosterRule(
                        "Everyone enters at once.",
                        "When joining shuts the whole field is paired off — a hundred players make fifty tables.",
                    )
                    PosterRule(
                        "Win and you go through. Lose and you are out.",
                        "One defeat ends your tournament: there is no second chance and no losers' bracket.",
                    )
                    cup.schedule?.takeIf { it.times.isNotEmpty() }?.let { sched ->
                        PosterRule(
                            "Turn up inside the window.",
                            "Each round opens at its time and stays open ${sched.windowMinutes} minutes. " +
                                "Miss it and you are out — even if you would have won.",
                        )
                        PosterRule(
                            "Every game is ${sched.matchMinutes} minutes.",
                            "Nobody bankrupt by then? The player with the higher net worth goes through.",
                        )
                    }
                    PosterRule(
                        "Two seats, no bots.",
                        "A cup table cannot be filled with house players, and the link cannot seat a third.",
                    )
                }

                // iOS names Apple here, as its guidelines ask; the shop this
                // copy came from is Google's, so Google is the one named.
                Text(
                    if (cup.local == null) {
                        "Free to enter; an account is needed so a prize can be paid. Prizes are paid by " +
                            "hand by MoneyMove — keep your friend code. Google is not a sponsor of this " +
                            "tournament and is not involved in any way."
                    } else {
                        "Prizes are set in ${cup.prize.currency.ifBlank { "USD" }} and shown here in your " +
                            "own money at today’s rate. Free to enter; an account is needed so a prize " +
                            "can be paid. Google is not a sponsor of this tournament and is not involved " +
                            "in any way."
                    },
                    modifier = Modifier.padding(top = 2.dp),
                    color = p.ink3, fontSize = 11.5.sp, lineHeight = 16.sp,
                    fontWeight = FontWeight.Medium, textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/** The ladder a cup of this size actually runs: 100 → 50 → 25 → … → the cup. */
@Composable
private fun PosterRungs(cup: CupView) {
    val p = P.current
    val steps = mutableListOf<Int>()
    var left = maxOf(2, cup.entrants)
    while (left > 1 && steps.size < 9) {
        steps += left
        left = (left + 1) / 2
    }
    val box = RoundedCornerShape(9.dp)
    Row(
        Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (n in steps) {
            Text(
                "$n",
                modifier = Modifier
                    .clip(box)
                    .background(p.sunken)
                    .border(1.dp, p.rule, box)
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, style = TABULAR,
            )
            Text("→", color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        }
        Box(
            Modifier
                .clip(box)
                .background(p.goldSoft)
                .border(1.dp, p.gold, box)
                .padding(horizontal = 8.dp, vertical = 4.dp),
        ) { Icon("trophy", size = 15.dp) }
    }
}

/** What this cup commits its players to, in dates and hours. */
@Composable
private fun WhenBox(cup: CupView, sched: CupSchedule) {
    val p = P.current
    val clock = sched.times.joinToString(" and ") { "%02d:%02d".format(it / 60, it % 60) }
    var n = maxOf(2, if (cup.maxPlayers > 0) cup.maxPlayers else cup.entrants)
    var rounds = 0
    while (n > 1) {
        n = (n + 1) / 2
        rounds++
    }
    val perNight = maxOf(1, sched.times.size)
    val evenings = (rounds + perNight - 1) / perNight
    val shape = RoundedCornerShape(13.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.sunken)
            .border(1.dp, p.rule, shape)
            .padding(horizontal = 13.dp, vertical = 4.dp),
    ) {
        WhenLine("Joining shuts", whenText(cup.closesAt, LONG_DATE) ?: "—")
        WhenLine("Rounds", clock)
        WhenLine("Evenings", "$evenings · $rounds rounds")
        whenText(cup.plan.lastOrNull()?.opensAt, LONG_DATE)?.let { WhenLine("The final", it) }
    }
}

@Composable
private fun WhenLine(label: String, value: String) {
    val p = P.current
    Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.width(10.dp))
        Text(
            value,
            modifier = Modifier.weight(1f),
            color = p.ink, fontSize = 12.5.sp, fontWeight = FontWeight.ExtraBold,
            textAlign = TextAlign.End,
        )
    }
}

@Composable
private fun PosterRule(head: String, body: String) {
    val p = P.current
    val shape = RoundedCornerShape(12.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.sunken)
            .border(1.dp, p.rule, shape)
            .padding(11.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(head, color = p.ink, fontSize = 12.5.sp, fontWeight = FontWeight.ExtraBold)
        Text(body, color = p.ink2, fontSize = 12.5.sp, lineHeight = 17.sp, fontWeight = FontWeight.Medium)
    }
}

// ────────────────────────────────────────────────────────────── the chart ──

/**
 * The chart — iOS's CupChartSheet, as content: the podium once there is one,
 * this reader's own run, and the bracket itself, a column per round scrolled
 * sideways and opened on the reader's own match.
 *
 * Asked for on demand. A two-hundred-entrant bracket is two hundred matches,
 * and re-sending that on the card's four-second poll to draw a countdown
 * would be silly.
 */
@Composable
fun CupBracket(cups: CupStore, cupId: String, modifier: Modifier = Modifier) {
    val p = P.current
    LaunchedEffect(cupId) { cups.openBracket(cupId) }
    val b = cups.bracket?.takeIf { it.id == cupId }

    if (b == null) {
        Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            if (cups.bracketFailed) {
                Text(
                    "Could not load the chart.",
                    modifier = Modifier.padding(40.dp),
                    color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.Medium,
                )
            } else {
                Box(Modifier.padding(60.dp)) { LandingSpinner(p.gold) }
            }
        }
        return
    }

    val you = b.you
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        b.standings?.takeIf { it.first != null }?.let { s ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                PlaceRow("1st", s.first, cupMoney(b.prize, b.local, CupPlace.FIRST), gold = true,
                    mine = s.first?.code != null && s.first?.code == you?.code, style = PlaceStyle.CHART)
                PlaceRow("2nd", s.second, cupMoney(b.prize, b.local, CupPlace.SECOND), gold = false,
                    mine = s.second?.code != null && s.second?.code == you?.code, style = PlaceStyle.CHART)
                PlaceRow("3rd", s.third, cupMoney(b.prize, b.local, CupPlace.THIRD), gold = false,
                    mine = s.third?.code != null && s.third?.code == you?.code, style = PlaceStyle.CHART)
            }
        }

        val run = chartRun(b)
        if (run.isNotEmpty()) {
            CupLabel("Your run")
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (rung in run) LadderRung(rung)
            }
        }

        CupLabel("The chart")
        ChartTree(b)
    }
}

/**
 * One row per round this reader played, in order — the short answer to
 * "where am I", and the only part of a chart that stays readable when a
 * hundred people entered.
 */
private fun chartRun(b: CupBracketView): List<Rung> {
    val me = b.you?.name ?: return emptyList()
    return b.rounds.mapNotNull { r ->
        val m = r.matches.firstOrNull { it.mine } ?: return@mapNotNull null
        val other = if (m.a == me) m.b else m.a
        val won = m.winner == me
        Rung(
            label = r.label,
            line = when {
                m.state != "done" -> other?.let { "playing $it" } ?: "waiting for a table"
                m.voided -> "nobody came"
                won -> "beat ${other ?: "a walkover"}"
                else -> "lost to ${m.winner ?: "the other side"}"
            },
            kind = if (m.state != "done") 2 else if (won) 1 else 0,
            players = r.players,
        )
    }
}

@Composable
private fun LadderRung(rung: Rung) {
    val p = P.current
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (rung.kind == 2) p.goldSoft else p.sunken)
            .border(
                1.dp,
                when (rung.kind) {
                    2 -> p.gold
                    1 -> p.good.copy(alpha = 0.45f)
                    else -> p.rule
                },
                shape,
            )
            .padding(vertical = 9.dp, horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RungDot(rung.kind)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(rung.label, color = p.ink, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold)
            Text(rung.line, color = p.ink2, fontSize = 11.5.sp, fontWeight = FontWeight.Medium)
        }
        Spacer(Modifier.width(6.dp))
        Text(
            "${rung.players}",
            modifier = Modifier
                .clip(RoundedCornerShape(99.dp))
                .background(p.card)
                .border(1.dp, p.rule, RoundedCornerShape(99.dp))
                .padding(horizontal = 8.dp, vertical = 2.dp),
            color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, style = TABULAR,
        )
    }
}

private val COLUMN = 186.dp
private val GUTTER = 14.dp

/** The bracket: a column per round, scrolled sideways, every table in it. */
@Composable
private fun ChartTree(b: CupBracketView) {
    val p = P.current
    val scroll = rememberScrollState()
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val viewport = maxWidth
        // Open on the reader's own match rather than at the top of somebody
        // else's: the last round they appear in is where they are, brought
        // to the middle of the screen a beat after the chart lands.
        LaunchedEffect(b.id, b.rounds.size) {
            val i = b.rounds.indexOfLast { r -> r.matches.any { it.mine } }
            if (i < 0) return@LaunchedEffect
            delay(350)
            val x = (COLUMN + GUTTER) * i - (viewport - COLUMN) / 2
            scroll.animateScrollTo(with(density) { x.roundToPx() }.coerceAtLeast(0))
        }
        Row(
            Modifier.horizontalScroll(scroll).padding(vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(GUTTER),
            verticalAlignment = Alignment.Top,
        ) {
            for (r in b.rounds) {
                Column(Modifier.width(COLUMN), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            r.label.ifBlank { "Round ${r.n}" },
                            color = p.ink, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold,
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            "${r.players}", color = p.ink3, fontSize = 10.sp,
                            fontWeight = FontWeight.ExtraBold, style = TABULAR,
                        )
                    }
                    for (m in r.matches) MatchCard(m)
                }
            }
        }
    }
}

@Composable
private fun MatchCard(m: CupBracketMatch) {
    val p = P.current
    val done = m.state == "done"
    val shape = RoundedCornerShape(11.dp)
    Box {
        Column(
            Modifier
                .fillMaxWidth()
                .alpha(if (m.state == "pending") 0.6f else 1f)
                .clip(shape)
                .background(if (m.mine) p.goldSoft else p.sunken)
                .border(if (m.mine) 1.5.dp else 1.dp, if (m.mine) p.gold else p.rule, shape)
                .padding(vertical = 5.dp, horizontal = 9.dp),
        ) {
            MatchSide(m.a, m.aScore, won = m.winner != null && m.winner == m.a, done = done)
            Rule()
            MatchSide(m.b, m.bScore, won = m.winner != null && m.winner == m.b, done = done)
            if (m.walkover || m.voided) {
                Text(
                    if (m.voided) "VOID" else "WALKOVER",
                    modifier = Modifier.padding(top = 3.dp),
                    color = p.ink3, fontSize = 8.5.sp,
                    letterSpacing = 0.7.sp, fontWeight = FontWeight.ExtraBold,
                )
            }
        }
        if (m.mine) {
            Text(
                "YOU",
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = (-6).dp, y = (-7).dp)
                    .clip(RoundedCornerShape(99.dp))
                    .background(p.gold)
                    .padding(horizontal = 6.dp, vertical = 1.5.dp),
                color = p.card, fontSize = 8.sp,
                letterSpacing = 0.6.sp, fontWeight = FontWeight.Black,
            )
        }
    }
}

@Composable
private fun MatchSide(name: String?, score: Int?, won: Boolean, done: Boolean) {
    val p = P.current
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            name ?: "—",
            color = if (name == null) p.ink3 else if (won) p.ink else p.ink2,
            fontSize = 12.5.sp,
            fontWeight = if (won) FontWeight.ExtraBold else FontWeight.Medium,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        // A score is the net worth a game was cut off at, so it only means
        // anything once the game is over.
        if (done && score != null) {
            Spacer(Modifier.width(8.dp))
            Text(
                grouped(score),
                color = if (won) p.good else p.ink3,
                fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, style = TABULAR,
            )
        }
    }
}

// ───────────────────────────────────────────────────────────────── the words ──

private enum class CupPlace { FIRST, SECOND, THIRD }

/** Figures that line up as they count, as iOS's monospacedDigit does. */
private val TABULAR = TextStyle(fontFeatureSettings = "tnum")

private fun cupMoney(cup: CupView, place: CupPlace): String = cupMoney(cup.prize, cup.local, place)

/**
 * A prize written the way the reader reads money.
 *
 * The owner sets one number in one currency; the server converts it for
 * whoever asked, and only when it actually knows today's rate. A converted
 * figure carries its "≈" so nobody reads it as the sum they will be handed.
 */
private fun cupMoney(prize: CupPrize, local: CupLocalPrize?, place: CupPlace): String {
    if (local != null) {
        val amount = when (place) {
            CupPlace.FIRST -> local.first
            CupPlace.SECOND -> local.second
            CupPlace.THIRD -> local.third
        }
        return "≈" + unitOf(local) + grouped(amount)
    }
    val amount = when (place) {
        CupPlace.FIRST -> prize.first
        CupPlace.SECOND -> prize.second
        CupPlace.THIRD -> prize.third
    }
    return plain(amount, prize.currency)
}

/** First, second and third added up — what the whole cup is worth. */
private fun poolMoney(prize: CupPrize, local: CupLocalPrize?): String {
    if (local != null) return "≈" + unitOf(local) + grouped(local.first + local.second + local.third)
    return plain(prize.first + prize.second + prize.third, prize.currency)
}

private fun unitOf(local: CupLocalPrize) =
    local.symbol.ifBlank { if (local.code.isBlank()) "" else "${local.code} " }

private fun plain(amount: Int, currency: String): String =
    if (currency.isBlank() || currency == "USD") "$${grouped(amount)}"
    else "$currency ${grouped(amount)}"

/** Thousands split, no currency of its own — [money] in Ui.kt is dollars-only. */
private fun grouped(n: Int): String {
    val digits = kotlin.math.abs(n).toString().reversed().chunked(3).joinToString(",").reversed()
    return if (n < 0) "-$digits" else digits
}

/**
 * "3d 4h", "5h 12m", "4:26" — whichever the wait deserves. Rounded to the
 * nearest second as iOS rounds it, so the two phones read the same number.
 */
private fun countdown(ms: Long): String {
    val left = ((ms.coerceAtLeast(0L) + 500L) / 1000L).toInt()
    if (left >= 86400) return "${left / 86400}d ${left % 86400 / 3600}h"
    if (left >= 3600) return "${left / 3600}h ${left % 3600 / 60}m"
    return "%d:%02d".format(left / 60, left % 60)
}

// The instants, as iOS's Date.formatted writes them: the parts are fixed and
// the locale decides their order, and whether the clock runs to twelve or to
// twenty-four — a player who reads "8:00 PM" everywhere else on their phone
// should not meet "20:00" here.
private const val SHORT_TIME = "jmm"
private const val SHORT_DATE = "EEEjmm"
private const val LONG_DATE = "EEEdMMMjmm"

/** An instant, in the reader's own clock — which is the only one they can act on. */
private fun whenText(epochMs: Double?, skeleton: String): String? = epochMs?.let {
    val locale = Locale.getDefault()
    SimpleDateFormat(DateFormat.getBestDateTimePattern(locale, skeleton), locale).format(Date(it.toLong()))
}

/**
 * "Rounds at 20:00 and 22:00 · 10 minutes to turn up" — the times as the
 * organiser wrote them, word for word as iOS prints them.
 */
private fun scheduleLine(sched: CupSchedule?): String? {
    val times = sched?.times?.takeIf { it.isNotEmpty() } ?: return null
    val clocks = times.map { "%02d:%02d".format(it / 60, it % 60) }
    val joined = if (clocks.size == 1) clocks[0]
    else clocks.dropLast(1).joinToString(", ") + " and " + clocks.last()
    return "Rounds at $joined · ${sched.windowMinutes} minutes to turn up"
}

private fun windowNote(cup: CupView): String {
    val opens = cup.openedAt ?: return ""
    val closes = cup.closesAt ?: return ""
    return " · open for ${((closes - opens) / 60000).toInt()} min"
}

/** How many rounds a field this size takes, so "round 3 of 8" means something. */
private fun depth(entrants: Int): Int {
    var n = maxOf(2, entrants)
    var rounds = 0
    while (n > 1) {
        n = (n + 1) / 2
        rounds++
    }
    return rounds
}

private fun roundName(round: CupRound?): String {
    if (round == null) return "Drawing the bracket…"
    if (round.kind == "final") return "The final"
    if (round.kind == "thirdPlace") return "Third place"
    val live = round.matches.count { it.state != "done" }
    return "Round ${round.n} — $live of ${round.matches.size} still playing"
}

private fun standingLine(cup: CupView): String = when {
    !cup.you.joined -> "Running now — the doors are shut."
    cup.you.out -> "You are out of this one."
    cup.you.roomId != null && cup.you.opponent != null ->
        "Your table is open — you are playing ${cup.you.opponent}."
    cup.you.roomId != null -> "Your table is open — good luck."
    else -> "Waiting for your next table."
}

/**
 * The wall clock, ticking into a recomposition.
 *
 * One timer per call, which is why a screen drawing a list of countdowns
 * reads it once at the top and passes the number down instead of calling it
 * per row. The interval is the call site's to choose: a bar that drains wants
 * asking twice a second, a row that prints minutes does not.
 */
@Composable
private fun tick(everyMs: Long): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(everyMs) {
        while (true) {
            delay(everyMs)
            now = System.currentTimeMillis()
        }
    }
    return now
}
