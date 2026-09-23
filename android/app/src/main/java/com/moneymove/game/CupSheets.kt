package com.moneymove.game

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
 * The one decision that shaped all three screens: the card is a poster and
 * nothing else. It says what the cup is, when it opens, how many have entered
 * and carries a single button, because a landing screen that grows a code
 * box, a leave button and a bracket is a landing screen nobody can find the
 * Play button on any more. Entering, leaving, the rules and the chart all
 * live behind that one button.
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
    val left: Int = 0,
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
class CupStore(private val game: GameStore, private val scope: CoroutineScope) {

    private val api get() = Api(game.prefs.server, game.token)

    var feed: CupFeed? by mutableStateOf(null)
        private set

    /** A join or a leave is in flight — the button says so rather than idling. */
    var busy: Boolean by mutableStateOf(false)
        private set

    /** The last thing that went wrong, for the one line a sheet shows. */
    var notice: String? by mutableStateOf(null)

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
     * A failure backs off but never gives up. Stopping after a handful of
     * misses, which is what the iOS app does, means a phone that lost signal
     * in a lift stops asking for good, and the player is knocked out of a
     * round whose door opened while their app sat there holding a stale card.
     */
    suspend fun watch() {
        var misses = 0
        while (true) {
            if (!load()) {
                misses++
                delay(minOf(misses.toLong(), 12L) * 5_000L)
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
            // body; the token is added by Api.post.
            val body = api.post(
                "/api/cup/join",
                mapOf("code" to code.trim(), "cupId" to cupId),
            )
            if (body == null) {
                notice = whyNot(code)
            } else {
                Haptics.turn()
                game.showToast("Joined — good luck")
            }
            load()
            busy = false
        }
    }

    fun leave() {
        val cupId = showing
        scope.launch {
            busy = true
            notice = null
            val body = api.post("/api/cup/leave", mapOf("cupId" to cupId))
            if (body == null) notice = "Too late to withdraw — the doors have shut."
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

    /**
     * Why the server said no.
     *
     * [Api] hands back null for anything that is not a 2xx, so the sentence
     * the server wrote — "That code does not match", "This one is full" —
     * never reaches here. The likeliest reason is worked out from the cup
     * already on screen instead, because "Could not enter" tells somebody
     * holding the wrong code nothing they can act on.
     */
    private fun whyNot(code: String): String {
        val cup = live
        return when {
            cup == null -> "No cup is open."
            cup.state == "scheduled" -> "Not open yet — joining opens at the announced time."
            cup.state != "joining" -> "Joining has closed on this one."
            cup.maxPlayers > 0 && cup.entrants >= cup.maxPlayers -> "This one is full."
            others.any { it.joined } ->
                "You are already in another cup — leave that one first."
            cup.needsCode && code.isBlank() -> "This one needs a join code."
            cup.needsCode -> "That code does not match."
            else -> "Could not enter. A prize needs somebody to pay, so entering needs a sign-in."
        }
    }
}

/**
 * The store, alive for as long as the screen that made it. Put this above the
 * tab bar rather than inside a tab — see [CupStore] on why.
 */
@Composable
fun rememberCupStore(game: GameStore): CupStore {
    val scope = rememberCoroutineScope()
    val cups = remember(game) { CupStore(game, scope) }
    LaunchedEffect(cups) { cups.watch() }
    return cups
}

// ──────────────────────────────────────────────────────────────── the card ──

/**
 * The poster on the landing screen: what this cup is, when it opens, how many
 * have entered, and one button that opens everything else.
 *
 * Draws nothing at all when there is no cup, which is also what happens when
 * the owner has cups switched off — [CupStore.live] is null either way.
 */
@Composable
fun CupCard(cup: CupView?, onOpen: () -> Unit) {
    if (cup == null) return
    val p = P.current
    Panel {
        CupHead(cup)
        Spacer(Modifier.height(12.dp))

        when (cup.state) {
            "scheduled" -> {
                DoorCountdown("Joining opens in", cup.openedAt)
                val opens = whenText(cup.openedAt, LONG_DATE)
                if (opens != null) {
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon("snooze", size = 13.dp, tint = p.ink3)
                        Spacer(Modifier.width(6.dp))
                        Hint(opens + windowNote(cup))
                    }
                }
                Spacer(Modifier.height(12.dp))
                PrizeRow(cup.prize, cup.local)
                Spacer(Modifier.height(10.dp))
                Hint("Come back then — entering takes one tap.")
            }

            "joining" -> {
                DoorBar(cup)
                Spacer(Modifier.height(12.dp))
                PrizeRow(cup.prize, cup.local)
                if (cup.you.joined) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "You are in. Your first game starts when joining closes.",
                        color = p.good, fontSize = 12.5.sp, fontWeight = FontWeight.Medium,
                    )
                } else if (cup.needsCode) {
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon("key", size = 13.dp, tint = p.ink3)
                        Spacer(Modifier.width(6.dp))
                        Hint("Invite only — you need the code from whoever set it up.")
                    }
                }
            }

            "running" -> {
                Text(
                    roundName(cup.round),
                    color = p.ink2, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                )
                val matches = cup.round?.matches.orEmpty()
                if (matches.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    TableLights(matches.take(60).map { it.state != "done" })
                }
                Spacer(Modifier.height(12.dp))
                PrizeRow(cup.prize, cup.local)
                Spacer(Modifier.height(10.dp))
                Text(
                    standingLine(cup),
                    color = if (cup.you.roomId != null) p.good else p.ink3,
                    fontSize = 12.5.sp, fontWeight = FontWeight.Medium,
                )
            }

            "done" -> {
                val s = cup.standings
                Text(
                    s?.first?.name?.let { "$it takes it" } ?: "Nobody finished this one",
                    color = p.ink2, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                )
                // A cup nobody finished has a standings object with three
                // empty places in it, and three dashes is not a podium.
                if (s?.first != null) {
                    Spacer(Modifier.height(10.dp))
                    PodiumRow("1st", s.first, cupMoney(cup.prize, cup.local, CupPlace.FIRST),
                        gold = true, mine = cup.you.placed == "first")
                    Spacer(Modifier.height(6.dp))
                    PodiumRow("2nd", s.second, cupMoney(cup.prize, cup.local, CupPlace.SECOND),
                        gold = false, mine = cup.you.placed == "second")
                    Spacer(Modifier.height(6.dp))
                    PodiumRow("3rd", s.third, cupMoney(cup.prize, cup.local, CupPlace.THIRD),
                        gold = false, mine = cup.you.placed == "third")
                }
                if (cup.you.placed != null) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "You finished ${cup.you.placed}. The prize is paid by hand — " +
                            "hold on to your friend code.",
                        color = p.good, fontSize = 12.5.sp, fontWeight = FontWeight.Medium,
                    )
                }
            }
        }

        Spacer(Modifier.height(14.dp))
        // One button, whatever the cup is doing. Entering, leaving, the rules
        // and the chart are all one tap behind it — a card that grew a code
        // box and a Leave button would bury the Play button below it.
        MMButton(
            label = openLabel(cup),
            kind = if (cup.state == "joining" && !cup.you.joined) BtnKind.GOLD else BtnKind.GHOST,
            icon = if (cup.state == "running" || cup.state == "done") "chart" else "trophy",
            modifier = Modifier.fillMaxWidth(),
            onClick = onOpen,
        )
    }
}

private fun openLabel(cup: CupView): String = when {
    cup.state == "scheduled" -> "What is a cup?"
    cup.state == "joining" && cup.you.joined -> "You are in — open it"
    cup.state == "joining" -> "Enter the cup"
    cup.state == "done" -> "See how it finished"
    else -> "Open the tournament"
}

@Composable
private fun CupHead(cup: CupView) {
    val p = P.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(42.dp)
                .clip(RoundedCornerShape(13.dp))
                .background(p.goldSoft)
                .border(1.dp, p.gold, RoundedCornerShape(13.dp)),
            contentAlignment = Alignment.Center,
        ) { Icon("trophy", size = 20.dp) }
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Text(cup.name, color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(2.dp))
            Hint(
                "Knockout — last one standing takes " +
                    cupMoney(cup.prize, cup.local, CupPlace.FIRST)
            )
        }
        Spacer(Modifier.width(8.dp))
        Chip(
            if (cup.maxPlayers > 0) "${cup.entrants}/${cup.maxPlayers}" else "${cup.entrants}",
            icon = "people",
            tint = if (cup.state == "joining") p.gold else p.ink2,
        )
    }
}

/** The three places, first among them louder — it is what everybody is here for. */
@Composable
private fun PrizeRow(prize: CupPrize, local: CupLocalPrize?) {
    val p = P.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PrizePill("1st", cupMoney(prize, local, CupPlace.FIRST), p.gold, p.goldSoft, true,
            Modifier.weight(1f))
        PrizePill("2nd", cupMoney(prize, local, CupPlace.SECOND), p.ink3, p.sunken, false,
            Modifier.weight(1f))
        PrizePill("3rd", cupMoney(prize, local, CupPlace.THIRD), p.ink3, p.sunken, false,
            Modifier.weight(1f))
    }
}

@Composable
private fun PrizePill(
    place: String,
    amount: String,
    tint: Color,
    fill: Color,
    big: Boolean,
    modifier: Modifier = Modifier,
) {
    val p = P.current
    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier
            .clip(shape)
            .background(fill)
            .border(1.dp, if (big) tint else p.rule, shape)
            .padding(vertical = 8.dp, horizontal = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            place.uppercase(),
            color = if (big) tint else p.ink3,
            fontSize = 10.sp, letterSpacing = 0.9.sp, fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            amount,
            color = if (big) p.gold else p.ink,
            fontSize = if (big) 16.sp else 13.sp,
            fontWeight = FontWeight.Black,
            maxLines = 1,
        )
    }
}

/**
 * The door, drawn as a bar that empties.
 *
 * A number on its own makes the reader do the arithmetic; a bar says at a
 * glance whether there is time to think about it.
 */
@Composable
private fun DoorBar(cup: CupView) {
    val p = P.current
    val closes = cup.closesAt ?: return
    val now = tick(500)
    val left = (closes.toLong() - now).coerceAtLeast(0L)
    val opened = cup.openedAt?.toLong() ?: (closes.toLong() - 300_000L)
    val span = (closes.toLong() - opened).coerceAtLeast(1L)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Hint("Joining closes in", Modifier.weight(1f))
        Text(
            countdown(left),
            // Under half a minute the clock stops being information and
            // starts being a nudge.
            color = if (left <= 30_000L) p.bad else p.ink,
            fontSize = 15.sp, fontWeight = FontWeight.Black,
        )
    }
    Spacer(Modifier.height(6.dp))
    Box(
        Modifier
            .fillMaxWidth()
            .height(6.dp)
            .clip(RoundedCornerShape(99.dp))
            .background(p.sunken)
            .border(1.dp, p.rule, RoundedCornerShape(99.dp)),
    ) {
        Box(
            Modifier
                .fillMaxWidth((left.toFloat() / span.toFloat()).coerceIn(0f, 1f))
                .height(6.dp)
                .clip(RoundedCornerShape(99.dp))
                .background(Brush.horizontalGradient(listOf(p.gold, p.red)))
        )
    }
}

/** A plain countdown, for a door that has not opened yet. */
@Composable
private fun DoorCountdown(label: String, at: Double?) {
    val p = P.current
    if (at == null) return
    val now = tick(1000)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Hint(label, Modifier.weight(1f))
        Text(
            countdown((at.toLong() - now).coerceAtLeast(0L)),
            color = p.gold, fontSize = 17.sp, fontWeight = FontWeight.Black,
        )
    }
}

/**
 * One light per table in the round being played, lit while it is still being
 * fought over.
 *
 * A big cup has fifty of these, so they wrap. Drawn rather than laid out
 * because fifty composed dots to say "how much of this round is left" is
 * fifty composables for one sentence.
 */
@Composable
private fun TableLights(live: List<Boolean>) {
    val p = P.current
    val step = 13.dp
    val radius = 4.dp
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val perRow = ((maxWidth / step).toInt()).coerceAtLeast(1)
        val rows = (live.size + perRow - 1) / perRow
        val density = LocalDensity.current
        val stepPx = with(density) { step.toPx() }
        val radiusPx = with(density) { radius.toPx() }
        Canvas(Modifier.fillMaxWidth().height(step * rows.coerceAtLeast(1))) {
            live.forEachIndexed { i, on ->
                drawCircle(
                    color = if (on) p.gold else p.rule2,
                    radius = radiusPx,
                    center = Offset(
                        x = (i % perRow) * stepPx + radiusPx,
                        y = (i / perRow) * stepPx + radiusPx,
                    ),
                )
            }
        }
    }
}

@Composable
private fun PodiumRow(
    place: String,
    who: CupPlacing?,
    amount: String,
    gold: Boolean,
    mine: Boolean,
) {
    val p = P.current
    val shape = RoundedCornerShape(12.dp)
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
            .padding(vertical = 9.dp, horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            when (place) {
                "1st" -> "medalGold"
                "2nd" -> "medalSilver"
                else -> "medalBronze"
            },
            size = 16.dp,
        )
        Spacer(Modifier.width(9.dp))
        Text(
            who?.name ?: "—",
            color = p.ink, fontSize = 13.5.sp, fontWeight = FontWeight.Black,
            maxLines = 1, modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            amount,
            color = if (gold) p.gold else p.ink2,
            fontSize = 13.sp, fontWeight = FontWeight.Black,
        )
    }
}

// ─────────────────────────────────────────────────────────────── the sheet ──

/**
 * The room behind the card: the clock, the rules, and the two buttons that
 * put somebody in a cup or take them out of it.
 *
 * What happens next goes at the top, because that is the question a player in
 * a cup actually has at nine in the evening. Everything below it is history
 * and timetable.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CupDetailSheet(
    cups: CupStore,
    game: GameStore,
    signedIn: Boolean,
    onDismiss: () -> Unit,
) {
    val p = P.current
    // A cup that ends while somebody is reading about it takes its sheet with
    // it, rather than leaving them looking at a screen about nothing.
    val cup = cups.live ?: return onDismiss()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var chart by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.sheet,
        dragHandle = null,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp)
                .padding(bottom = 28.dp),
        ) {
            Spacer(Modifier.height(16.dp))

            if (chart) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        cup.name, color = p.ink, fontSize = 20.sp,
                        fontWeight = FontWeight.Black, modifier = Modifier.weight(1f),
                    )
                    MMButton("Back", kind = BtnKind.GHOST) { chart = false }
                }
                Spacer(Modifier.height(14.dp))
                // Drawn in place rather than in a second sheet on top of this
                // one: two stacked sheets on a phone leave about an inch of
                // chart between the two drag shadows.
                CupBracket(cups, cup.id)
            } else {
                DetailBody(cups, cup, game, signedIn, onDismiss) { chart = true }
            }

            Spacer(Modifier.height(14.dp))
            MMButton("Close", kind = BtnKind.GHOST, modifier = Modifier.fillMaxWidth()) {
                onDismiss()
            }
        }
    }
}

@Composable
private fun DetailBody(
    cups: CupStore,
    cup: CupView,
    game: GameStore,
    signedIn: Boolean,
    onDismiss: () -> Unit,
    onChart: () -> Unit,
) {
    val p = P.current

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
        Column(Modifier.weight(1f)) {
            Text(cup.name, color = p.ink, fontSize = 20.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(2.dp))
            Text(
                if (cup.needsCode) "Invite only" else "Open to everyone",
                color = p.ink3, fontSize = 10.sp,
                letterSpacing = 0.8.sp, fontWeight = FontWeight.Black,
            )
        }
    }

    scheduleLine(cup.schedule)?.let {
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon("snooze", size = 12.dp, tint = p.ink3)
            Spacer(Modifier.width(6.dp))
            Hint(it)
        }
    }

    Spacer(Modifier.height(14.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Tile("Prize pool", poolMoney(cup.prize, cup.local), Modifier.weight(1f))
        Tile(
            if (cup.state == "done") "Finished" else "Round",
            if (cup.state == "done") "—" else "${cup.you.round ?: cup.rounds} of ${depth(cup.entrants)}",
            Modifier.weight(1f),
        )
        Tile("Still in", "${if (cup.you.left > 0) cup.you.left else cup.entrants}", Modifier.weight(1f))
    }

    cup.you.next?.let {
        Spacer(Modifier.height(14.dp))
        NextMatch(it, cup, game, onDismiss)
    }

    Spacer(Modifier.height(14.dp))
    JoinBox(cups, cup, signedIn)

    val run = yourRun(cup)
    if (run.isNotEmpty()) {
        Spacer(Modifier.height(16.dp))
        SectionLabel("Your run")
        Spacer(Modifier.height(8.dp))
        for (rung in run) {
            RunRung(rung)
            Spacer(Modifier.height(6.dp))
        }
    }

    cup.standings?.takeIf { it.first != null }?.let { s ->
        Spacer(Modifier.height(16.dp))
        SectionLabel("Final standings", icon = "trophy")
        Spacer(Modifier.height(8.dp))
        PodiumRow("1st", s.first, cupMoney(cup.prize, cup.local, CupPlace.FIRST),
            gold = true, mine = cup.you.placed == "first")
        Spacer(Modifier.height(6.dp))
        PodiumRow("2nd", s.second, cupMoney(cup.prize, cup.local, CupPlace.SECOND),
            gold = false, mine = cup.you.placed == "second")
        Spacer(Modifier.height(6.dp))
        PodiumRow("3rd", s.third, cupMoney(cup.prize, cup.local, CupPlace.THIRD),
            gold = false, mine = cup.you.placed == "third")
    }

    if (cup.plan.isNotEmpty()) {
        Spacer(Modifier.height(16.dp))
        SectionLabel("The whole plan", icon = "snooze")
        Spacer(Modifier.height(8.dp))
        for (r in cup.plan) {
            PlanRow(r)
            Spacer(Modifier.height(6.dp))
        }
    }

    Spacer(Modifier.height(14.dp))
    MMButton(
        "See the whole chart",
        kind = BtnKind.GHOST, icon = "chart", big = true,
        modifier = Modifier.fillMaxWidth(),
        onClick = onChart,
    )

    Spacer(Modifier.height(16.dp))
    SectionLabel("How it works", icon = "question")
    Spacer(Modifier.height(8.dp))
    for (line in ruleLines(cup)) {
        Row(Modifier.fillMaxWidth().padding(bottom = 7.dp)) {
            Box(
                Modifier
                    .padding(top = 6.dp)
                    .size(4.dp)
                    .clip(RoundedCornerShape(99.dp))
                    .background(p.ink3)
            )
            Spacer(Modifier.width(9.dp))
            Hint(line)
        }
    }

    val others = cups.others
    if (others.isNotEmpty()) {
        Spacer(Modifier.height(10.dp))
        Rule()
        Spacer(Modifier.height(12.dp))
        SectionLabel("Also on")
        Spacer(Modifier.height(8.dp))
        for (o in others) {
            OtherCupRow(o) { cups.show(o.id) }
            Spacer(Modifier.height(6.dp))
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
            .padding(vertical = 11.dp, horizontal = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            label.uppercase(),
            color = p.ink3, fontSize = 10.sp,
            letterSpacing = 0.7.sp, fontWeight = FontWeight.Black,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(3.dp))
        Text(value, color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.Black, maxLines = 1)
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
    ) {
        Text(
            if (next.open) "YOUR MATCH IS OPEN" else "YOUR NEXT MATCH",
            color = if (next.open) p.good else p.ink3,
            fontSize = 10.5.sp, letterSpacing = 0.9.sp, fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Contender(cup.you.name ?: "You", mine = true, modifier = Modifier.weight(1f))
            Text(
                "v", color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.padding(horizontal = 10.dp),
            )
            Contender(next.opponent ?: "a bye", mine = false, modifier = Modifier.weight(1f))
        }

        if (!next.open && next.opensAt != null) {
            Spacer(Modifier.height(9.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon("snooze", size = 13.dp, tint = p.ink3)
                Spacer(Modifier.width(6.dp))
                Hint(
                    "Opens in ${countdown(next.opensAt.toLong() - now)} · " +
                        (whenText(next.opensAt, SHORT_TIME) ?: "")
                )
            }
        } else if (next.open && next.closesAt != null) {
            Spacer(Modifier.height(9.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon("warning", size = 13.dp, tint = p.bad)
                Spacer(Modifier.width(6.dp))
                Text(
                    "Door shuts in ${countdown(next.closesAt.toLong() - now)} — " +
                        "miss it and you are out",
                    color = p.bad, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
                )
            }
        }

        // The whistle on a game already being played. Being cut off is
        // survivable; being cut off at a time nobody told you is not.
        if (next.endsAt != null) {
            Spacer(Modifier.height(7.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon("scales", size = 13.dp, tint = p.ink3)
                Spacer(Modifier.width(6.dp))
                Hint(
                    "Whistle at ${whenText(next.endsAt, SHORT_TIME) ?: "the hour"} — " +
                        "whoever is ahead on net worth goes through."
                )
            }
        }

        val room = next.roomId
        if (room != null) {
            Spacer(Modifier.height(12.dp))
            MMButton(
                "Play your match",
                kind = BtnKind.PRIMARY, icon = "dice", big = true,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Haptics.turn()
                onDismiss()
                game.connect(room)
            }
        } else if (next.open) {
            Spacer(Modifier.height(10.dp))
            Hint("Making your table…")
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
            .background(p.card)
            .border(1.dp, if (mine) p.gold else p.rule, shape)
            .padding(vertical = 10.dp, horizontal = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            name,
            color = if (mine) p.ink else p.ink2,
            fontSize = 14.sp, fontWeight = FontWeight.Black, maxLines = 1,
        )
    }
}

/**
 * Entering and leaving.
 *
 * A prize needs somebody it can be paid to, so a device with no account is
 * told that instead of being given a button that fails — the same reason the
 * daily coin asks, only more so.
 */
@Composable
private fun JoinBox(cups: CupStore, cup: CupView, signedIn: Boolean) {
    val p = P.current
    var draft by remember { mutableStateOf("") }

    cups.notice?.let {
        Text(
            it, color = p.bad, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
        )
    }

    when {
        // Leaving is only ever offered while the doors are open — the server
        // refuses a withdrawal after that, and a button that comes back
        // refused is worse than no button.
        cup.state != "joining" -> when {
            cup.you.out -> Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(p.sunken)
                    .padding(11.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon("skull", size = 15.dp, tint = p.ink3)
                Spacer(Modifier.width(8.dp))
                Hint("You are out of this one. The chart shows how it finished.")
            }

            cup.you.joined -> Hint(
                if (cup.state == "done") "That was your cup — the standings are below."
                else "You are still in. Your next match is above."
            )

            cup.state == "scheduled" ->
                Hint("Not open yet. Come back when the doors open — entering takes one tap.")

            else -> Hint("Joining has closed on this one. The chart below is the whole field.")
        }

        !signedIn -> {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(11.dp))
                    .background(p.sunken)
                    .padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon("key", size = 14.dp, tint = p.ink3)
                Spacer(Modifier.width(8.dp))
                Text(
                    "Sign in on the Settings tab to enter — a prize needs somebody to pay.",
                    color = p.ink2, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
                )
            }
        }

        cup.you.joined -> {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "You are in.",
                    color = p.good, fontSize = 13.sp, fontWeight = FontWeight.Black,
                    modifier = Modifier.weight(1f),
                )
                MMButton("Leave", kind = BtnKind.GHOST, enabled = !cups.busy) { cups.leave() }
            }
        }

        cup.needsCode -> {
            // The box starts empty because the app genuinely does not know the
            // answer: the server never sends an invite cup's code to a player,
            // only that one is wanted.
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    BasicTextField(
                        value = draft,
                        onValueChange = { draft = it.uppercase().take(16) },
                        singleLine = true,
                        textStyle = TextStyle(
                            color = p.ink, fontSize = 16.sp,
                            fontWeight = FontWeight.Black, letterSpacing = 2.sp,
                        ),
                        cursorBrush = SolidColor(p.red),
                        decorationBox = { inner ->
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(p.sunken)
                                    .border(1.dp, p.rule, RoundedCornerShape(12.dp))
                                    .padding(horizontal = 13.dp, vertical = 13.dp),
                            ) {
                                if (draft.isEmpty()) {
                                    Text(
                                        "JOIN CODE", color = p.ink3, fontSize = 16.sp,
                                        fontWeight = FontWeight.Black, letterSpacing = 2.sp,
                                    )
                                }
                                inner()
                            }
                        },
                    )
                }
                Spacer(Modifier.width(8.dp))
                MMButton(
                    if (cups.busy) "…" else "Join",
                    kind = BtnKind.GOLD, icon = "trophy", enabled = !cups.busy,
                ) { cups.enter(draft) }
            }
            Spacer(Modifier.height(7.dp))
            Hint("Invite only — you need the code from whoever set it up.")
        }

        else -> {
            MMButton(
                if (cups.busy) "Joining…" else "Join the cup",
                kind = BtnKind.GOLD, icon = "trophy", big = true,
                enabled = !cups.busy,
                modifier = Modifier.fillMaxWidth(),
            ) { cups.enter() }
        }
    }
}

private class Rung(val label: String, val line: String, val kind: Int)

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
            label = when (round.kind) {
                "final" -> "The final"
                "thirdPlace" -> "Third place"
                else -> "Round ${round.n}"
            },
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
            .background(if (rung.kind == 2) p.goldSoft else p.sunken)
            .border(1.dp, if (rung.kind == 2) p.gold else p.rule, shape)
            .padding(vertical = 9.dp, horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(9.dp)
                .clip(RoundedCornerShape(99.dp))
                .background(if (rung.kind == 2) p.gold else if (rung.kind == 1) p.good else p.bad)
        )
        Spacer(Modifier.width(10.dp))
        Text(rung.label, color = p.ink, fontSize = 13.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.width(8.dp))
        Text(rung.line, color = p.ink2, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
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
                .clip(RoundedCornerShape(99.dp))
                .background(if (r.yours) p.goldSoft else p.card)
                .border(1.dp, if (r.yours) p.gold else p.rule, RoundedCornerShape(99.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text("${r.n}", color = p.ink2, fontSize = 11.sp, fontWeight = FontWeight.Black)
        }
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Text(
                r.label,
                color = if (r.done) p.ink3 else p.ink,
                fontSize = 13.sp, fontWeight = FontWeight.Black,
            )
            Hint("${r.players} players → ${(r.players + 1) / 2} through")
        }
        Spacer(Modifier.width(6.dp))
        Column(horizontalAlignment = Alignment.End) {
            whenText(r.opensAt, SHORT_DATE)?.let {
                Text(
                    it,
                    color = if (r.done) p.ink3 else p.ink2,
                    fontSize = 12.sp, fontWeight = FontWeight.Black,
                )
            }
            Text(
                when {
                    r.done -> "played"
                    r.projected -> "planned"
                    r.closesAt != null -> "shuts ${whenText(r.closesAt, SHORT_TIME)}"
                    else -> ""
                },
                color = p.ink3, fontSize = 9.5.sp, fontWeight = FontWeight.Black,
            )
        }
    }
}

@Composable
private fun OtherCupRow(o: CupBrief, onPick: () -> Unit) {
    val p = P.current
    val now = tick(1000)
    val shape = RoundedCornerShape(11.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.sunken)
            .border(1.dp, p.rule, shape)
            .clickable { onPick() }
            .padding(vertical = 9.dp, horizontal = 11.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                o.name, color = p.ink, fontSize = 13.sp,
                fontWeight = FontWeight.Black, maxLines = 1,
            )
            if (o.joined) {
                Spacer(Modifier.width(7.dp))
                Text(
                    "JOINED", color = p.good, fontSize = 8.5.sp,
                    letterSpacing = 0.6.sp, fontWeight = FontWeight.Black,
                )
            }
        }
        Spacer(Modifier.height(2.dp))
        val count = if (o.maxPlayers > 0) "${o.entrants}/${o.maxPlayers}" else "${o.entrants}"
        val code = if (o.needsCode) " · invite only" else ""
        Hint(
            when (o.state) {
                "scheduled" -> "opens in ${countdown((o.openedAt?.toLong() ?: 0L) - now)} · $count$code"
                "joining" -> "closes in ${countdown((o.closesAt?.toLong() ?: 0L) - now)} · $count$code"
                "running" -> "being played · $count"
                else -> "finished"
            }
        )
    }
}

/**
 * The rules that catch people out, in the order they catch them.
 *
 * The last line is not decoration: a prize contest inside an app has to say
 * plainly that the shop it was downloaded from has nothing to do with it.
 */
private fun ruleLines(cup: CupView): List<String> {
    val out = mutableListOf("Win your match and you go through. Lose it and you are out.")
    val sched = cup.schedule?.takeIf { it.times.isNotEmpty() }
    if (sched != null) {
        out += "Each round opens at its time and stays open ${sched.windowMinutes} minutes. " +
            "Turn up inside that window or you are out — even if you would have won."
        out += "A game still running when the next round is due is decided on net worth, so " +
            "one long game never holds up everybody else's evening."
    }
    out += "Free to enter — no coins, no purchase, no payment of any kind."
    out += "Prizes are awarded and paid by hand by MoneyMove, the organiser. Keep your friend code."
    out += "Google is not a sponsor of this tournament and is not involved in it in any way."
    return out
}

// ────────────────────────────────────────────────────────────── the chart ──

/**
 * The bracket: a column per round, scrolled sideways, with this reader's own
 * match marked in every round they appear in.
 *
 * A cup of two hundred draws a hundred tables in its first round, and a
 * column of a hundred names is not a chart anybody reads — so each round
 * shows a window of tables around the reader's own, numbered, with the rest
 * counted at the bottom. The one match that matters to the reader is always
 * in the window, which is the whole job of the screen.
 *
 * Content rather than a sheet of its own, so a caller can put it wherever it
 * belongs — [CupDetailSheet] draws it in place of its own body.
 */
@Composable
fun CupBracket(cups: CupStore, cupId: String, modifier: Modifier = Modifier) {
    LaunchedEffect(cupId) { cups.openBracket(cupId) }
    val b = cups.bracket

    Column(modifier.fillMaxWidth()) {
        if (b == null) {
            Hint(
                if (cups.bracketFailed) "Could not load the chart." else "Drawing the chart…"
            )
            return@Column
        }

        b.standings?.takeIf { it.first != null }?.let { s ->
            SectionLabel("Final standings", icon = "trophy")
            Spacer(Modifier.height(8.dp))
            PodiumRow("1st", s.first, cupMoney(b.prize, b.local, CupPlace.FIRST),
                gold = true, mine = s.first?.code != null && s.first?.code == b.you?.code)
            Spacer(Modifier.height(6.dp))
            PodiumRow("2nd", s.second, cupMoney(b.prize, b.local, CupPlace.SECOND),
                gold = false, mine = s.second?.code != null && s.second?.code == b.you?.code)
            Spacer(Modifier.height(6.dp))
            PodiumRow("3rd", s.third, cupMoney(b.prize, b.local, CupPlace.THIRD),
                gold = false, mine = s.third?.code != null && s.third?.code == b.you?.code)
            Spacer(Modifier.height(16.dp))
        }

        SectionLabel("The chart", icon = "chart")
        Spacer(Modifier.height(4.dp))
        Hint("${b.entrants} entered · ${b.rounds.size} rounds drawn")
        Spacer(Modifier.height(10.dp))

        val scroll = rememberScrollState()
        val density = LocalDensity.current
        // Open on the reader's own match rather than at the top of somebody
        // else's: the last round they appear in is where they are.
        LaunchedEffect(b.id, b.rounds.size) {
            val i = b.rounds.indexOfLast { r -> r.matches.any { it.mine } }
            if (i > 0) scroll.animateScrollTo(with(density) { ((COLUMN + GUTTER) * i).roundToPx() })
        }

        Row(
            Modifier.fillMaxWidth().horizontalScroll(scroll),
            horizontalArrangement = Arrangement.spacedBy(GUTTER),
        ) {
            for (r in b.rounds) RoundColumn(r)
        }
    }
}

private val COLUMN = 190.dp
private val GUTTER = 12.dp

/** How many tables one column shows before it starts counting instead. */
private const val WINDOW = 12

@Composable
private fun RoundColumn(r: CupBracketRound) {
    val p = P.current
    val mine = r.matches.indexOfFirst { it.mine }
    // The window is centred on the reader's own table when they have one, and
    // is the top of the round when they do not.
    val start = if (mine < 0) 0 else (mine - WINDOW / 2).coerceIn(0, maxOf(0, r.matches.size - WINDOW))
    val shown = r.matches.drop(start).take(WINDOW)
    val hidden = r.matches.size - shown.size

    Column(Modifier.width(COLUMN)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                r.label.ifBlank { "Round ${r.n}" },
                color = p.ink, fontSize = 12.sp, fontWeight = FontWeight.Black,
            )
            Spacer(Modifier.width(6.dp))
            Text(
                "${r.players}", color = p.ink3, fontSize = 10.sp, fontWeight = FontWeight.Black,
            )
        }
        Spacer(Modifier.height(8.dp))
        shown.forEachIndexed { i, m ->
            MatchCard(m, start + i + 1)
            Spacer(Modifier.height(8.dp))
        }
        if (hidden > 0) {
            Hint("+ $hidden more tables in this round")
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun MatchCard(m: CupBracketMatch, number: Int) {
    val p = P.current
    val done = m.state == "done"
    val shape = RoundedCornerShape(11.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (m.mine) p.goldSoft else p.sunken)
            .border(if (m.mine) 1.5.dp else 1.dp, if (m.mine) p.gold else p.rule, shape)
            .padding(vertical = 6.dp, horizontal = 9.dp)
            .alpha(if (m.state == "pending") 0.6f else 1f),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "T$number", color = p.ink3, fontSize = 9.sp,
                letterSpacing = 0.5.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.weight(1f),
            )
            if (m.mine) {
                Box(
                    Modifier
                        .clip(RoundedCornerShape(99.dp))
                        .background(p.gold)
                        .padding(horizontal = 6.dp, vertical = 1.dp),
                ) {
                    Text(
                        "YOU", color = p.accentInk, fontSize = 8.sp,
                        letterSpacing = 0.6.sp, fontWeight = FontWeight.Black,
                    )
                }
            }
        }
        Spacer(Modifier.height(3.dp))
        MatchSide(m.a, m.aScore, won = m.winner != null && m.winner == m.a, done = done)
        Rule(Modifier.padding(vertical = 4.dp))
        MatchSide(m.b, m.bScore, won = m.winner != null && m.winner == m.b, done = done)
        if (m.walkover || m.voided) {
            Spacer(Modifier.height(3.dp))
            Text(
                if (m.voided) "VOID — NOBODY CAME" else "WALKOVER",
                color = p.ink3, fontSize = 8.5.sp,
                letterSpacing = 0.7.sp, fontWeight = FontWeight.Black,
            )
        }
    }
}

@Composable
private fun MatchSide(name: String?, score: Int?, won: Boolean, done: Boolean) {
    val p = P.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            name ?: "—",
            color = if (name == null) p.ink3 else if (won) p.ink else p.ink2,
            fontSize = 12.5.sp,
            fontWeight = if (won) FontWeight.Black else FontWeight.Medium,
            maxLines = 1,
            modifier = Modifier.weight(1f),
        )
        // A score is the net worth a game was cut off at, so it only means
        // anything once the game is over.
        if (done && score != null) {
            Spacer(Modifier.width(6.dp))
            Text(
                grouped(score),
                color = if (won) p.good else p.ink3,
                fontSize = 11.sp, fontWeight = FontWeight.Black,
            )
        }
    }
}

// ───────────────────────────────────────────────────────────────── the words ──

private enum class CupPlace { FIRST, SECOND, THIRD }

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

/** "3d 4h", "5h 12m", "4:26" — whichever the wait deserves. */
private fun countdown(ms: Long): String {
    val left = (ms.coerceAtLeast(0L) / 1000L).toInt()
    if (left >= 86400) return "${left / 86400}d ${left % 86400 / 3600}h"
    if (left >= 3600) return "${left / 3600}h ${left % 3600 / 60}m"
    return "%d:%02d".format(left / 60, left % 60)
}

private const val SHORT_TIME = "HH:mm"
private const val SHORT_DATE = "EEE HH:mm"
private const val LONG_DATE = "EEE d MMM, HH:mm"

/** An instant, in the reader's own clock — which is the only one they can act on. */
private fun whenText(epochMs: Double?, pattern: String): String? = epochMs?.let {
    SimpleDateFormat(pattern, Locale.getDefault()).format(Date(it.toLong()))
}

/**
 * "Rounds at 20:00 and 22:00, organiser's clock · 10 minutes to turn up".
 *
 * The times in a schedule are minutes past midnight where the OWNER is, not
 * where the reader is, so they are printed as written and labelled as such.
 * The plan below them carries real instants and is the thing somebody should
 * plan an evening around — a player in London reading an unlabelled "20:00"
 * from a cup run out of Delhi would be four and a half hours wrong.
 */
private fun scheduleLine(sched: CupSchedule?): String? {
    val times = sched?.times?.takeIf { it.isNotEmpty() } ?: return null
    val clocks = times.map { "%02d:%02d".format(it / 60, it % 60) }
    val joined = if (clocks.size == 1) clocks[0]
    else clocks.dropLast(1).joinToString(", ") + " and " + clocks.last()
    return "Rounds at $joined, organiser's clock · ${sched.windowMinutes} minutes to turn up"
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
    !cup.you.joined -> "Being played now — the doors are shut."
    cup.you.out -> "You are out of this one."
    cup.you.roomId != null && cup.you.opponent != null ->
        "Your table is open — you are playing ${cup.you.opponent}."
    cup.you.roomId != null -> "Your table is open — good luck."
    else -> "Waiting for your next table."
}

/**
 * The wall clock, ticking into a recomposition.
 *
 * Every countdown on these screens is derived from it rather than from a
 * timer of its own, so a card with four clocks on it wakes up once a second
 * instead of four times.
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
