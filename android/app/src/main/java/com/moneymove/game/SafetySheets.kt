package com.moneymove.game

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray

/**
 * Keeping people safe from each other: report, block, and take a block back.
 *
 * Anywhere a player can read something a stranger wrote — table chat, a
 * friends row, somebody's name — they can tell whoever runs the game about
 * that person, and they can make them go away. Reporting is slow and goes to
 * a human; blocking is instant and is the one the person in front of an
 * unpleasant message actually needs.
 *
 * The one decision that shaped this file: nothing here opens a dialog.
 * iOS learned the same lesson the expensive way — a confirmationDialog raised
 * from a Menu inside a detented sheet simply never presented, so Safety.swift
 * uses submenus instead, and Block there is a single destructive menu item
 * with nothing in front of it. The Android version of that trap is an
 * AlertDialog raised from inside a ModalBottomSheet, which fights the sheet
 * for the window and can end up behind it or dismissing it. So Report here is
 * iOS's menu laid out as a sheet, and Block is one tap, as it is there. Never
 * a dialog — with one exception at the bottom of the file, the table's own
 * "are you sure"s, which are asked from the table screen and never from a
 * sheet.
 */

/** Somebody the player wants to report, and where they came across them. */
data class SafetyTarget(
    val code: String,
    val name: String,
    /**
     * Where this was read. The server files anything outside "chat", "dm",
     * "friend" and "name" as "other", so these four strings are the vocabulary
     * and not a suggestion.
     */
    val place: String = "chat",
    /** What they said, as the reporter saw it. The server keeps 400 characters. */
    val quote: String = "",
)

/**
 * The reasons the server will actually file.
 *
 * `id` is the wire value and has to stay in this set — reportPlayer() in
 * server/social.js quietly rewrites anything else to "other", so a typo here
 * does not fail loudly, it just makes every report useless to the person
 * reading the queue.
 */
enum class ReportReason(val id: String, val label: String) {
    ABUSE("abuse", "Harassment or bullying"),
    HATE("hate", "Hate speech"),
    SEXUAL("sexual", "Sexual content"),
    SPAM("spam", "Spam or scams"),
    CHEATING("cheating", "Cheating"),
    NAME("name", "Offensive name"),
    OTHER("other", "Something else"),
}

// ── the calls ──────────────────────────────────────────────────────────────

/**
 * One POST, as a lambda: path and body in, raw JSON body or null out.
 *
 * Taking the call rather than the store keeps these sheets usable from the
 * table (which has a GameStore) and from Settings (which has an AccountStore)
 * without either of them growing a safety department.
 */
typealias SafetyPost = suspend (path: String, body: Map<String, Any?>) -> String?

/** What a safety call came back with. */
data class SafetyReply(
    val ok: Boolean,
    val error: String? = null,
    /**
     * The player's whole blocked list, as the server now holds it.
     *
     * The sheets below never read it — they hand a single code back and let
     * whoever owns the list apply it. It is here for a caller that reconciles
     * against the server directly, because a block answers with the truth and
     * a second GET /api/social to learn the same thing is a wasted round trip.
     */
    val blocked: Set<String>? = null,
)

/**
 * A code the server will actually act on.
 *
 * `isCode` in server/social.js is /^[A-Z0-9]{6}$/, and block, unblock and
 * report all refuse anything else with a 400 — which, because Api.post only
 * hands back the body of a 2xx, reaches this client as an indistinguishable
 * null. House players have no code at all (ChatMessage.code is null for them),
 * so a caller writing `line.code.orEmpty()` would otherwise get a Block button
 * that fails a second later and blames the network for it.
 */
private fun isFriendCode(code: String): Boolean =
    code.length == 6 && code.all { it in 'A'..'Z' || it in '0'..'9' }

/**
 * The server's own `asCode` trims and uppercases before it tests, so a
 * lowercase code is a real code. Matching that here means the guard above
 * refuses exactly what the server would refuse and nothing more.
 */
private fun normalisedCode(raw: String): String = raw.trim().uppercase()

/** True of every reason the call could not be made, so it claims no cause. */
private const val NO_CODE = "We don't have a player code for this one, so there's nothing to send."

/**
 * What iOS says when a call gets no answer it can use — Safety.swift's own
 * sentences, so a failed block reads the same on both phones.
 */
private const val BLOCK_FAILED = "Couldn't block them — try again."
private const val REPORT_FAILED = "Couldn't send that report — try again."
private const val UNBLOCK_FAILED = "Couldn't unblock them — try again."

/** iOS's line once a report has gone: thanks, and the other thing they can do. */
internal fun reportThanks(name: String): String = "Thanks — we'll look into it. You can also block $name."

/** iOS's line once a block has gone through, word for word. */
internal fun blockedLine(name: String): String =
    "Blocked $name. Their messages are hidden and they can't friend or message you."

/**
 * The three safety calls, wrapped round whichever POST it was handed.
 *
 * It owns no state of its own on purpose: who is blocked lives on
 * GameStore.blockedCodes and nowhere else, and a second copy in here would be
 * the copy that goes stale the first time a block happens on another screen.
 */
class Safety(private val post: SafetyPost) {

    /** POST /api/block — `{ token, code }`, answered with the whole blocked list. */
    suspend fun block(code: String): SafetyReply =
        withCode(code) { send("/api/block", mapOf("code" to it), BLOCK_FAILED) }

    /** POST /api/unblock — the same body, the same answer. */
    suspend fun unblock(code: String): SafetyReply =
        withCode(code) { send("/api/unblock", mapOf("code" to it), UNBLOCK_FAILED) }

    /**
     * POST /api/report — `{ token, code, reason, where, text }`.
     *
     * "where" and "text" are what make a report worth reading: the owner's
     * queue shows the line as the reporter saw it, next to the place they saw
     * it. A report that is only a code and a reason is a complaint nobody can
     * act on.
     */
    suspend fun report(target: SafetyTarget, reason: ReportReason): SafetyReply =
        withCode(target.code) {
            send(
                "/api/report",
                mapOf(
                    "code" to it,
                    "reason" to reason.id,
                    "where" to target.place,
                    "text" to target.quote.take(400),
                ),
                REPORT_FAILED,
            )
        }

    /**
     * Refuses here what the server would refuse over the wire.
     *
     * A 400 and a train tunnel are the same null to this client, so a call the
     * code alone makes impossible is worth failing before it is made — the
     * sentence can then say the true thing instead of guessing at the network.
     */
    private suspend fun withCode(raw: String, call: suspend (String) -> SafetyReply): SafetyReply {
        val code = normalisedCode(raw)
        if (!isFriendCode(code)) return SafetyReply(false, NO_CODE)
        return call(code)
    }

    /**
     * Sends one, and turns whatever comes back into something a screen can say.
     *
     * Api.post() hands back the body of a 2xx and null for everything else, so
     * a refusal the server spelled out ("You have sent a lot of reports today")
     * and a train tunnel can arrive here as the same null. [failed] is iOS's
     * sentence for that case, and it names no cause for the same reason iOS's
     * does: telling somebody who has hit the twenty-a-day report cap to check
     * their connection sends them to fix a thing that is not broken.
     */
    private suspend fun send(path: String, body: Map<String, Any?>, failed: String): SafetyReply {
        val raw = post(path, body)
            ?: return SafetyReply(false, failed)
        val reply = runCatching { MMJson.parseToJsonElement(raw) }.getOrNull().obj()
        reply?.get("error").asString()?.let { return SafetyReply(false, it) }
        val blocked = (reply?.get("blocked") as? JsonArray)?.mapNotNull { it.asString() }?.toSet()
        return SafetyReply(true, null, blocked)
    }
}

/** The default way to make those calls: this device's server, this device's token. */
@Composable
fun rememberSafety(): Safety {
    val context = LocalContext.current
    return remember(context) {
        val prefs = Prefs(context)
        val api = Api(prefs.server, prefs.token)
        // Api.post() puts the token in the body itself; every endpoint here
        // reads req.body.token, so nothing else needs to be passed along.
        Safety { path, body -> api.post(path, body) }
    }
}

/**
 * The same calls, made with the identity an [AccountStore] is already using —
 * and, unlike [rememberSafety], with the server's reasons intact.
 *
 * [AccountStore.postForReason] hands a refusal's body back instead of the
 * null a tunnel gives, so "You have sent a lot of reports today" reaches the
 * player in the server's words, and [Safety] only falls back to its
 * cause-free sentence when nothing answered at all. The friends list and
 * Settings use this one; the table chat still has the plain post.
 */
fun AccountStore.safety(): Safety = Safety { path, body -> postForReason(path, body) }

// ── report ─────────────────────────────────────────────────────────────────

/**
 * Report somebody in one tap, or block them in one.
 *
 * On iOS this is not a sheet at all: long-press a line, or tap Report, and a
 * menu comes up with the message lifted above it, "Report Ravi…" opening onto
 * seven reasons and "Block Ravi" underneath in red. This is that menu, laid
 * out on a sheet because that is where Android can raise it from inside
 * another sheet: the line they said sits on top as the lifted message, then
 * the reasons under their heading, then Block on its own.
 *
 * A reason is the whole form, and a tap files it — iOS asks nothing else.
 * What happens next is said in iOS's words: [onSaid] is where a caller that
 * can raise a toast takes the sentence, and the sheet closes, exactly as the
 * menu does. A caller that passes nothing gets the sentence in the menu's
 * place instead, so it is still said.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportSheet(
    code: String,
    name: String,
    place: String = "chat",
    quote: String = "",
    safety: Safety = rememberSafety(),
    onBlocked: (String) -> Unit = {},
    onSaid: ((text: String, isError: Boolean) -> Unit)? = null,
    onDismiss: () -> Unit,
) {
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val target = remember(code, name, place, quote) { SafetyTarget(code, name, place, quote) }
    val who = name.trim().ifBlank { "this player" }

    var sending: ReportReason? by remember { mutableStateOf<ReportReason?>(null) }
    var filed: Boolean by remember { mutableStateOf(false) }
    var said: Pair<String, Boolean>? by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    // iOS's menu is gone the moment an item is chosen and the toast says the
    // rest. Where there is somebody to hand the toast to, this does the same.
    fun say(text: String, isError: Boolean) {
        val out = onSaid
        if (out != null) {
            out(text, isError)
            onDismiss()
        } else {
            said = text to isError
        }
    }

    MMSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        dragHandle = { SheetGrabber() },
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(top = 10.dp, bottom = 28.dp),
        ) {
            // The line being reported, lifted above the menu the way a
            // long-pressed message is on iOS.
            if (quote.isNotBlank()) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(p.card)
                        .border(1.dp, p.rule, RoundedCornerShape(14.dp))
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(
                            who, color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            quote.take(400),
                            color = p.ink, fontSize = 14.sp, lineHeight = 19.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
                Spacer(Modifier.height(12.dp))
            }

            // Seven reasons that all fail on whichever one is tapped is worse
            // than one line saying so now.
            if (!isFriendCode(normalisedCode(code))) {
                Hint(NO_CODE)
                return@Column
            }

            MenuGroup {
                MenuHeading("Report $who…")
                if (filed) {
                    MenuNote(reportThanks(who))
                } else {
                    ReportReason.entries.forEachIndexed { i, reason ->
                        if (i > 0) MenuDivider()
                        MenuItem(
                            reason.label,
                            busy = sending == reason,
                            // One tap sends, so a second tap while the first
                            // is in flight would file the same thing twice
                            // against a daily cap of twenty.
                            enabled = sending == null,
                        ) {
                            sending = reason
                            said = null
                            scope.launch {
                                val reply = safety.report(target, reason)
                                sending = null
                                if (reply.ok) {
                                    Haptics.tap()
                                    filed = true
                                    say(reportThanks(who), isError = false)
                                } else {
                                    say(reply.error ?: REPORT_FAILED, isError = true)
                                }
                            }
                        }
                    }
                }
            }

            said?.takeIf { it.second }?.let { (text, _) ->
                Spacer(Modifier.height(8.dp))
                Text(text, color = p.bad, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }

            // Block is here whether or not a report went, as it sits in iOS's
            // menu beside Report rather than behind it: the person in front of
            // an unpleasant message should never have to file a form first.
            Spacer(Modifier.height(8.dp))
            BlockRow(
                code = code,
                name = name,
                safety = safety,
                onFailed = { say(it, isError = true) },
                onBlocked = {
                    onBlocked(it)
                    onSaid?.invoke(blockedLine(who), false)
                    onDismiss()
                },
            )
        }
    }
}

// ── block ──────────────────────────────────────────────────────────────────

/**
 * "Block Ravi", as iOS's menus offer it: one destructive item, the raised
 * hand on its right, and nothing in front of it — a block takes effect on the
 * tap. Blocking also tears down the friendship, both pending requests and any
 * invite between the two of you; iOS says so in the toast afterwards, which
 * is [blockedLine], and whoever hosts this says it the same way.
 */
@Composable
fun BlockRow(
    code: String,
    name: String,
    modifier: Modifier = Modifier,
    safety: Safety = rememberSafety(),
    onFailed: (String) -> Unit = {},
    onBlocked: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var busy: Boolean by remember(code) { mutableStateOf(false) }
    val who = name.trim().ifBlank { "this player" }

    if (!isFriendCode(normalisedCode(code))) {
        // A house player has no code, so there is nobody on the other end of
        // /api/block. Saying so beats a button that fails a second later.
        Hint("We don't have a player code for this one, so there's nobody to block.", modifier)
        return
    }
    MenuGroup(modifier) {
        MenuItem("Block $who", danger = true, symbol = "hand.raised", busy = busy, enabled = !busy) {
            busy = true
            scope.launch {
                val reply = safety.block(code)
                busy = false
                if (reply.ok) {
                    Haptics.tap()
                    // Uppercased, because whoever holds the blocked set
                    // matches it against the codes the server sends on chat
                    // lines, and those are always uppercase. A lowercase
                    // entry is an entry that never matches.
                    onBlocked(normalisedCode(code))
                } else {
                    onFailed(reply.error ?: BLOCK_FAILED)
                }
            }
        }
    }
}

// ── a menu, drawn ──────────────────────────────────────────────────────────

/** One rounded group of an iOS menu: a card, with hairlines between its items. */
@Composable
private fun MenuGroup(modifier: Modifier = Modifier, content: @Composable ColumnScopeAlias.() -> Unit) {
    val p = P.current
    val shape = RoundedCornerShape(14.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape),
        content = content,
    )
}

/** The name of the submenu that has been opened, above its items, as iOS heads one. */
@Composable
private fun MenuHeading(text: String) {
    val p = P.current
    Text(
        text,
        color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
        maxLines = 1, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
    )
    MenuDivider()
}

/** A sentence where the items were, once one of them has done its job. */
@Composable
private fun MenuNote(text: String) {
    Text(
        text,
        color = P.current.ink2, fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.Medium,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
    )
}

@Composable
private fun MenuDivider() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(P.current.rule))
}

/**
 * One item: the words on the left and, where iOS has one, its symbol on the
 * right — iOS menus put the picture after the words, not before. Red when it
 * is the destructive one. While its call is out the symbol makes way for the
 * iPhone's spinner.
 */
@Composable
private fun MenuItem(
    label: String,
    danger: Boolean = false,
    symbol: String? = null,
    busy: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val p = P.current
    val ink = if (danger) p.bad else p.ink
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 46.dp)
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            color = if (enabled || busy) ink else ink.copy(alpha = 0.45f),
            fontSize = 16.sp, fontWeight = FontWeight.Normal,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (busy) {
            Spacer(Modifier.width(10.dp))
            SfSpinner(ink, 18.dp)
        } else if (symbol != null) {
            Spacer(Modifier.width(10.dp))
            SfMark(symbol, 18.dp, ink)
        }
    }
}

// ── the list ───────────────────────────────────────────────────────────────

/**
 * Everyone this player has blocked, with the way back — iOS's
 * BlockedPlayersSheet: half height to start with a grabber to pull it up,
 * "Blocked players" in the middle of the bar and Done on the right, each code
 * on a card with Unblock beside it, and one quiet line when there is nobody.
 *
 * Only codes, because that is genuinely all the app has: the server answers
 * every block call with a list of friend codes and never sends a name.
 *
 * [onUnblock] is where the new state actually lands, with the whole list the
 * server now holds. The list this app plays against lives on
 * GameStore.blockedCodes, which only GameStore may write, so this sheet does
 * the call and hands the answer back rather than keeping a second copy.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BlockedPlayersSheet(
    codes: Set<String>,
    onUnblock: (code: String, blocked: Set<String>?) -> Unit,
    safety: Safety = rememberSafety(),
    onDismiss: () -> Unit,
) {
    val p = P.current
    // Half height first and the whole screen on a pull, as iOS's
    // [.medium, .large]: the content fills the screen, so the sheet has a
    // half-way stop to open at.
    val sheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    var working: String? by remember { mutableStateOf<String?>(null) }

    fun close() {
        scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
    }

    MMSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        dragHandle = { SheetGrabber() },
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight()) {
            SafetyBar("Blocked players") { close() }
            val sheetScroll = rememberScrollState()
            Column(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .scrollEdge(sheetScroll)
                    .verticalScroll(sheetScroll)
                    .padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (codes.isEmpty()) {
                    Text(
                        "You haven't blocked anyone.",
                        color = quietInk(), fontSize = 13.5.sp, fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(top = 40.dp),
                    )
                }
                // Sorted, as iOS sorts them: a set has no order of its own,
                // and a list that reshuffles itself on every refresh is a list
                // where Unblock lands on the wrong row.
                for (blockedCode in codes.sorted()) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(p.card)
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            blockedCode,
                            color = p.ink, fontSize = 14.sp,
                            fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold,
                            modifier = Modifier.weight(1f),
                        )
                        // While one row is in flight every row is dead, so two
                        // taps cannot race and leave the list disagreeing with
                        // the server about who is on it.
                        // A refusal leaves the row where it was and says
                        // nothing, as iOS's unblock does.
                        SafetyButton("Unblock", ghost = true, enabled = working == null) {
                            working = blockedCode
                            scope.launch {
                                val reply = safety.unblock(blockedCode)
                                working = null
                                if (reply.ok) onUnblock(blockedCode, reply.blocked)
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── sheet chrome ───────────────────────────────────────────────────────────

/**
 * iOS's grabber, for a sheet with more than one height to stop at.
 *
 * It sits on the sheet's glass ([MMSheet] draws it there), so it is inked
 * as a mark on the material rather than on paper: the glass's own quiet ink
 * at the half-strength it always had. The palette's ink3 is the one ink the
 * material cannot carry — it measures 1.53:1 on glass at worst.
 */
@Composable
private fun SheetGrabber() {
    val glass = rememberGlassSurface(BackdropKind.Sheet)
    Box(
        Modifier
            .padding(top = 5.dp, bottom = 3.dp)
            .size(36.dp, 5.dp)
            .clip(RoundedCornerShape(99.dp))
            .background(glass.labelInk(quiet = true).copy(alpha = 0.5f)),
    )
}

/**
 * iOS's inline navigation bar: the title in the middle, and Done on the right
 * in the table's accent — semibold, because it is the confirming action.
 */
@Composable
private fun SafetyBar(title: String, onDone: () -> Unit) {
    val p = P.current
    Box(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 16.dp)) {
        Text(
            title,
            color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.align(Alignment.Center).padding(horizontal = 64.dp),
        )
        Text(
            "Done",
            color = p.red, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .clip(RoundedCornerShape(8.dp))
                .clickable { onDone() }
                .padding(horizontal = 4.dp, vertical = 6.dp),
        )
    }
}

/**
 * iOS's MMButtonStyle, small: fourteen bold on a ten-point corner, the ghost
 * a filled well rather than an outline and the primary the table's accent
 * with a faint white rim. Disabled only stops it answering, as iOS's style
 * never reads the disabled state either.
 */
@Composable
private fun SafetyButton(
    label: String,
    ghost: Boolean,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val p = P.current
    val shape = RoundedCornerShape(10.dp)
    Box(
        modifier
            .clip(shape)
            .background(if (ghost) p.sunken else p.red)
            .then(if (ghost) Modifier else Modifier.border(1.dp, Color.White.copy(alpha = 0.18f), shape))
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 14.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (ghost) p.ink else p.accentInk,
            fontSize = 14.sp, fontWeight = FontWeight.Bold,
        )
    }
}

// ── the rules, before anybody types ────────────────────────────────────────

/**
 * What a player agrees to before they can say anything to a stranger.
 *
 * It is a gate, not a notice: the composer below it stays shut until the
 * button is pressed. That is the whole reason it works — a banner nobody has
 * to act on is a banner nobody reads, and on a store listing that allows
 * open chat between strangers, "we told them" has to mean something they
 * actually did.
 *
 * Agreed once per device and never asked again. It draws nothing after that,
 * so every surface can host it unconditionally.
 */
@Composable
fun CommunityRulesCard(onAgree: () -> Unit = {}) {
    val p = P.current
    val context = LocalContext.current
    val prefs = remember(context) { Prefs(context) }
    var agreed by remember { mutableStateOf(prefs.rulesAgreed) }
    if (agreed) return

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(p.card)
            .border(1.dp, p.gold.copy(alpha = 0.6f), RoundedCornerShape(14.dp))
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // shield.fill: one solid shield in gold.
            SfMark("shield.fill", 15.dp, p.gold)
            Spacer(Modifier.width(7.dp))
            Text(
                "Before you chat",
                color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold,
            )
        }
        Spacer(Modifier.height(8.dp))
        Text(
            "Be kind. There is zero tolerance for harassment, hate, sexual content or "
                + "threats — players who break this are removed. Long-press any message "
                + "to report or block someone.",
            color = p.ink2, fontSize = 12.5.sp, lineHeight = 18.sp,
            fontWeight = FontWeight.Medium,
        )
        Spacer(Modifier.height(8.dp))
        // As wide as its word, on the left, as iOS's small primary button is:
        // a full-width bar reads as the page's main action, and this is a
        // nod, not a sign-up.
        SafetyButton("I agree", ghost = false) {
            Haptics.tap()
            prefs.rulesAgreed = true
            agreed = true
            onAgree()
        }
    }
}

/** Whether writing is allowed yet — the composer stays shut until it is. */
@Composable
fun rememberRulesAgreed(): Boolean {
    val context = LocalContext.current
    val prefs = remember(context) { Prefs(context) }
    // Read through a state so agreeing on one surface opens the other one
    // without either of them knowing the other exists.
    return remember { mutableStateOf(prefs.rulesAgreed) }.let { held ->
        if (!held.value && prefs.rulesAgreed) held.value = true
        held.value
    }
}

// ── the table's own questions ──────────────────────────────────────────────

/**
 * Leaving, giving up and going bankrupt: the questions a table asks before it
 * lets somebody end their own game, in iOS's words (GameScreen.swift's leave
 * and "Who gives up?", ActionPanel.swift and DeedSheets.swift's bankruptcy).
 *
 * The one dialog in this file, and it is safe for the same reason the rest
 * avoid one: these are asked from the table screen itself — the top bar's
 * Leave, the debt panel in the dock — never from inside a sheet. A question
 * raised from inside the properties sheet asks with [ConfirmRow] in place of
 * its button instead.
 *
 * The question lives on [GameStore.confirm], so the control that raises it
 * (store.requestLeave(), store.requestConcede(), store.ask(...)) and this
 * host that answers it never need to know about each other. Mount it once,
 * at the top level of the table screen.
 *
 * No picture beside the question, as iOS's confirmationDialog has none: the
 * title, the sentence and the answers are the whole of it there.
 *
 * "Give up" on a phone with two players still in asks the second question —
 * which of them — straight after the first. iOS waits a beat between the two
 * because SwiftUI will not swap one dialog for another in the same frame;
 * Compose will, so there is no beat here.
 */
@Composable
fun TableConfirmHost(store: GameStore) {
    val question = store.confirm ?: return
    // A question about a game that has since ended has nothing left to
    // answer: every choice in it acts on a live game. It goes by itself.
    if (store.state?.isPlaying != true) {
        LaunchedEffect(question) { store.dismissConfirm() }
        return
    }
    when (question) {
        TableConfirm.LEAVE -> ConfirmDialog(
            title = "Leave the game?",
            message = "A bot holds your seat while you're away, so you can continue from the home " +
                "screen. Leaving for good returns your streets to the bank and costs 1 karma.",
            actions = listOf(
                ConfirmAction("Leave — I'll come back") { store.stepAway() },
                // Conceding keeps the seat as a spectator and the table plays
                // on; on a pass & play phone it asks which player first.
                ConfirmAction("Give up — declare bankruptcy", BtnKind.DANGER) { store.requestConcede() },
                // The quit has to reach the server before the socket goes —
                // it is what hands the streets back — and quitAndLeave waits.
                ConfirmAction("Leave for good", BtnKind.DANGER) { store.quitAndLeave() },
            ),
            onDismiss = store::dismissConfirm,
        )

        // Named per seat: several people share this phone, and the white flag
        // has to land on the right one.
        TableConfirm.CONCEDE -> ConfirmDialog(
            title = "Who gives up?",
            message = "That player declares bankruptcy and stays as a spectator. Everyone else on " +
                "this phone plays on.",
            actions = store.aliveLocalSeats.map { seat ->
                ConfirmAction("${seat.name} gives up", BtnKind.DANGER) { store.concede(seat.id) }
            },
            onDismiss = store::dismissConfirm,
        )

        // From the properties list, where nobody is owed: the bank takes it.
        // The sheet goes with it, as iOS's does — there is nothing left in it
        // that belongs to this player.
        TableConfirm.BANKRUPT -> ConfirmDialog(
            title = "Declare bankruptcy?",
            message = "Everything you own returns to the bank and you are out of the game.",
            actions = listOf(
                ConfirmAction("Go bankrupt", BtnKind.DANGER) {
                    store.declareBankrupt()
                    store.closeSheet()
                },
            ),
            onDismiss = store::dismissConfirm,
        )

        // From the debt panel, where somebody is owed and gets it all.
        TableConfirm.DEBT_BANKRUPT -> ConfirmDialog(
            title = "Declare bankruptcy?",
            message = "Everything you own goes to whoever you owe, and you are out of the game.",
            actions = listOf(
                ConfirmAction("Go bankrupt", BtnKind.DANGER) { store.declareBankrupt() },
            ),
            onDismiss = store::dismissConfirm,
        )
    }
}

// ── the iPhone's own drawings ──────────────────────────────────────────────

/**
 * The system symbols iOS draws on the social, safety and settings screens
 * that icons.js never drew: the raised hand beside every Block, the envelope
 * of Contact us, the bin of Delete account, the bell over the notes, the two
 * bubbles on a friend's Message. The shared set had stand-ins for some of
 * them — a police cap for Block, a chat bubble for Contact us — and a player
 * holding both phones saw a different picture on the same row.
 *
 * Drawn here on the glyph set's own 32-point grid, in outline where Apple
 * draws outline, and all in the ink they are handed. Kept out of Glyphs.kt,
 * which is generated from icons.js and would drop them.
 *
 * A part whose fill or stroke is [CUT] is not painted but rubbed out of what
 * is already there — the gap Apple leaves round a slash, or round the dot on
 * a bell that has something waiting.
 */
private const val CUT: Long = 0x00C07C07L

private fun sfStroke(d: String, width: Float = 2.6f) =
    GlyphPart(d, fill = null, stroke = INK, strokeWidth = width, cap = 1, join = 1)

private fun sfFill(d: String) = GlyphPart(d, fill = INK)

private fun sfCut(d: String, width: Float) =
    GlyphPart(d, fill = null, stroke = CUT, strokeWidth = width, cap = 1, join = 1)

private fun sfCutFill(d: String) = GlyphPart(d, fill = CUT)

private const val SF_HAND =
    "M11.2 28.8C9.6 27.6 8.4 26 7.6 24.2L4.6 17.8A2 2 0 0 1 8 16L8.6 17.6V9.6A2 2 0 0 1 12.6 9.6V15.5" +
        "V6.6A2 2 0 0 1 16.6 6.6V15.5V8A2 2 0 0 1 20.6 8V15.5V11.6A2 2 0 0 1 24.6 11.6V21" +
        "C24.6 25.4 21.6 28.8 17.4 28.8Z"
private const val SF_BELL =
    "M16 4.8c-5 0-8.6 3.8-8.6 8.8v4.6c0 1.4-.5 2.7-1.4 3.7l-1.3 1.5c-.6.7-.1 1.8.8 1.8h21" +
        "c.9 0 1.4-1.1.8-1.8L26 21.9c-.9-1-1.4-2.3-1.4-3.7v-4.6c0-5-3.6-8.8-8.6-8.8Z"
private const val SF_BELL_KNOB = "M14.4 5.4a1.6 1.6 0 0 1 3.2 0Z"
private const val SF_BELL_CLAPPER = "M12.8 26.8h6.4a3.2 3.2 0 0 1 -6.4 0Z"
private const val SF_SLASH = "M4.6 4 27.4 28"
private const val SF_RING = "M4.2 16a11.8 11.8 0 1 0 23.6 0a11.8 11.8 0 1 0 -23.6 0Z"
// The two halves of bubble.left.and.bubble.right: the same rounded bubble,
// once up on the left with its tail bottom-left, and once mirrored, lower and
// to the right, with its tail bottom-right.
private const val SF_BUBBLE_LEFT =
    "M8 4h7a5.5 5.5 0 0 1 5.5 5.5v2.5a5.5 5.5 0 0 1 -5.5 5.5h-6.1l-5.6 3.5 1.3 -4.4" +
        "a5.5 5.5 0 0 1 -2.1 -4.6v-2.5a5.5 5.5 0 0 1 5.5 -5.5Z"
private const val SF_BUBBLE_RIGHT =
    "M24 11h-7a5.5 5.5 0 0 0 -5.5 5.5v2.5a5.5 5.5 0 0 0 5.5 5.5h6.1l5.6 3.5 -1.3 -4.4" +
        "a5.5 5.5 0 0 0 2.1 -4.6v-2.5a5.5 5.5 0 0 0 -5.5 -5.5Z"

private val SF_MARKS: Map<String, List<GlyphPart>> = mapOf(
    // Block, everywhere it is offered.
    "hand.raised" to listOf(sfStroke(SF_HAND)),
    // The Blocked players row.
    "hand.raised.slash" to listOf(sfStroke(SF_HAND), sfCut(SF_SLASH, 6.4f), sfStroke(SF_SLASH)),
    // Contact us.
    "envelope" to listOf(
        sfStroke("M5.4 7.4h21.2a2.8 2.8 0 0 1 2.8 2.8v11.6a2.8 2.8 0 0 1 -2.8 2.8H5.4a2.8 2.8 0 0 1 -2.8 -2.8V10.2a2.8 2.8 0 0 1 2.8 -2.8Z"),
        sfStroke("M3.8 9.2 16 17.8 28.2 9.2"),
    ),
    // Delete account.
    "trash" to listOf(
        sfStroke("M4.8 8.4h22.4"),
        sfStroke("M12 8.2V6.6a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v1.6", 2.4f),
        sfStroke("M7.4 8.6 8.9 25.4a3 3 0 0 0 3 2.8h8.2a3 3 0 0 0 3 -2.8L24.6 8.6"),
        sfStroke("M13 13v10.6M16 13v10.6M19 13v10.6", 2f),
    ),
    // Support & community rules.
    "questionmark.circle" to listOf(
        sfStroke(SF_RING),
        sfStroke("M12.4 12.6c0-2.2 1.6-3.8 3.8-3.8 2.1 0 3.7 1.4 3.7 3.4 0 1.6-.9 2.4-2.1 3.2-1.1.7-1.6 1.3-1.6 2.5v.5", 2.6f),
        sfFill("M14.5 22.6a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z"),
    ),
    // Appearance: System.
    "circle.lefthalf.filled" to listOf(sfStroke(SF_RING), sfFill("M16 4.2a11.8 11.8 0 0 0 0 23.6Z")),
    // Add a friend.
    "plus" to listOf(sfStroke("M16 6.4v19.2M6.4 16h19.2", 3.4f)),
    // Report, in a menu.
    "exclamationmark.bubble" to listOf(
        sfStroke("M8 5.2h16a5 5 0 0 1 5 5v8.4a5 5 0 0 1 -5 5H14.6l-5.8 4.6v-4.6H8a5 5 0 0 1 -5 -5v-8.4a5 5 0 0 1 5 -5Z"),
        sfStroke("M16 9.6v6.4", 2.8f),
        sfFill("M14.6 19.8a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0Z"),
    ),
    // Remove friend.
    "person.badge.minus" to listOf(
        sfStroke("M8.4 10a4.6 4.6 0 1 0 9.2 0a4.6 4.6 0 1 0 -9.2 0Z"),
        sfStroke("M3.4 27.6c0-5.3 4.3-9 9.6-9s9.6 3.7 9.6 9Z"),
        sfCutFill("M18.6 22.6a6.4 6.4 0 1 0 12.8 0a6.4 6.4 0 1 0 -12.8 0Z"),
        sfStroke("M21 22.6h8", 2.8f),
    ),
    // Message, on a friend's row: two filled bubbles, the left one in front
    // with a gap rubbed out round it where it overlaps the right — the pair
    // iOS draws there, not the single bubble with dots that the table chat
    // wears.
    "bubble.left.and.bubble.right.fill" to listOf(
        sfFill(SF_BUBBLE_RIGHT),
        sfCut(SF_BUBBLE_LEFT, 3.2f),
        sfFill(SF_BUBBLE_LEFT),
    ),
    // The notes bell: quiet, waiting, and empty.
    "bell.fill" to listOf(sfFill(SF_BELL), sfFill(SF_BELL_KNOB), sfFill(SF_BELL_CLAPPER)),
    "bell.badge.fill" to listOf(
        sfFill(SF_BELL), sfFill(SF_BELL_KNOB), sfFill(SF_BELL_CLAPPER),
        sfCutFill("M18.8 7.2a6.4 6.4 0 1 0 12.8 0a6.4 6.4 0 1 0 -12.8 0Z"),
        sfFill("M20.8 7.2a4.4 4.4 0 1 0 8.8 0a4.4 4.4 0 1 0 -8.8 0Z"),
    ),
    "bell.slash" to listOf(
        sfStroke(SF_BELL, 2.2f), sfFill(SF_BELL_KNOB), sfStroke(SF_BELL_CLAPPER, 2.2f),
        sfCut(SF_SLASH, 6f), sfStroke(SF_SLASH, 2.2f),
    ),

    // ── the table and the rest of the app ─────────────────────────────────
    // The same need elsewhere: marks iOS takes from its symbol set that the
    // drawn set has only in another shape. One place for all of them.

    // The sound switch, off: the speaker with a slash through it (the drawn
    // set crosses it with an X after it).
    "speaker.slash.fill" to listOf(
        sfFill(SF_SPEAKER), sfCut(SF_SLASH, 6.2f), sfStroke(SF_SLASH, 2.6f),
    ),
    // Your properties: four solid columns under a pediment, on a step.
    "building.columns.fill" to listOf(
        sfFill("M16 3.2 29 10.2v2.6H3v-2.6Z"),
        sfFill("M5.8 14.4h3.4v9.4H5.8zM11.4 14.4h3.4v9.4h-3.4zM17.2 14.4h3.4v9.4h-3.4zM22.8 14.4h3.4v9.4h-3.4z"),
        sfFill("M3 25.2h26v3.2H3z"),
    ),
    // The full turn clock: a dial open at twelve, the crown in the gap, and
    // the hand.
    "timer" to listOf(
        sfStroke("M18 5.7A11.5 11.5 0 1 1 14 5.7", 2.6f),
        sfStroke("M16 5.4v4.8", 2.6f),
        sfStroke("M16 17 11 12", 2.6f),
        sfFill("M14.2 17a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0Z"),
    ),
    // Copy and Share beside the friend code, in outline as iOS draws them.
    "doc.on.doc" to listOf(
        sfStroke("M12 8.8V6.5A2.5 2.5 0 0 1 14.5 4h9A2.5 2.5 0 0 1 26 6.5v12.5a2.5 2.5 0 0 1 -2.5 2.5h-2.2", 2.2f),
        sfStroke("M7.5 9h9a2.5 2.5 0 0 1 2.5 2.5v14a2.5 2.5 0 0 1 -2.5 2.5h-9A2.5 2.5 0 0 1 5 25.5v-14A2.5 2.5 0 0 1 7.5 9Z", 2.2f),
    ),
    "square.and.arrow.up" to listOf(
        sfStroke("M11.4 12.6H9.2a2.6 2.6 0 0 0 -2.6 2.6v10.2a2.6 2.6 0 0 0 2.6 2.6h13.6a2.6 2.6 0 0 0 2.6 -2.6V15.2a2.6 2.6 0 0 0 -2.6 -2.6h-2.2", 2.2f),
        sfStroke("M16 19.6V3.8", 2.4f),
        sfStroke("M11.4 8.2 16 3.6l4.6 4.6", 2.4f),
    ),
    // Menus: close, tick, and the flag rows.
    "xmark" to listOf(sfStroke("M8 8 24 24M24 8 8 24", 2.6f)),
    "checkmark" to listOf(sfStroke("M6.8 16.8 12.8 22.6 25.4 9.4", 3f)),
    "chevron.up.chevron.down" to listOf(sfStroke("M10.6 12.6 16 7.2l5.4 5.4M10.6 19.4 16 24.8l5.4-5.4", 2.8f)),
    "flag.slash" to listOf(
        sfStroke("M8.4 28V5.2", 2.4f),
        sfStroke("M8.4 6.4c3-1.8 5.8-1.8 8.4 0s5.6 1.8 8.6 0v10.8c-3 1.8-5.8 1.8-8.6 0s-5.4-1.8-8.4 0", 2.2f),
        sfCut(SF_SLASH, 6f), sfStroke(SF_SLASH, 2.2f),
    ),
    // The solid people, eye and shield iOS draws as one colour each, where
    // the drawn set fades half of the picture.
    "person.2.fill" to listOf(
        sfFill("M17.4 10.6a4.3 4.3 0 1 0 8.6 0a4.3 4.3 0 1 0 -8.6 0Z"),
        sfFill("M15.2 25.8c.2-4.2 3-7.2 6.5-7.2s6.4 3 6.6 7.2Z"),
        sfCut("M7 10.8a5.2 5.2 0 1 0 10.4 0a5.2 5.2 0 1 0 -10.4 0Z", 2.6f),
        sfCut("M2.8 27.4c0-5.3 4.2-9 9.4-9s9.4 3.7 9.4 9Z", 2.6f),
        sfFill("M7 10.8a5.2 5.2 0 1 0 10.4 0a5.2 5.2 0 1 0 -10.4 0Z"),
        sfFill("M2.8 27.4c0-5.3 4.2-9 9.4-9s9.4 3.7 9.4 9Z"),
    ),
    "eye.fill" to listOf(
        sfFill("M16 7c6.4 0 11.2 4.2 13.4 9-2.2 4.8-7 9-13.4 9S4.8 20.8 2.6 16C4.8 11.2 9.6 7 16 7Z"),
        sfCutFill("M10.4 16a5.6 5.6 0 1 0 11.2 0a5.6 5.6 0 1 0 -11.2 0Z"),
        sfFill("M12.4 16a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0 -7.2 0Z"),
    ),
    "shield.fill" to listOf(
        sfFill("M16 3.2 26.4 7.2v7.6c0 6.8-4.4 11.8-10.4 14.2-6-2.4-10.4-7.4-10.4-14.2V7.2Z"),
    ),
    // Appearance and karma: the plain solid sun, crescent and heart — the
    // drawn set adds stroked rays, craters and a highlight Apple's lack.
    "sun.max.fill" to listOf(
        sfFill("M9.4 16a6.6 6.6 0 1 0 13.2 0a6.6 6.6 0 1 0 -13.2 0Z"),
        sfStroke("M16 2.8v3.4M16 25.8v3.4M2.8 16h3.4M25.8 16h3.4M6.7 6.7l2.4 2.4M22.9 22.9l2.4 2.4M25.3 6.7l-2.4 2.4M9.1 22.9l-2.4 2.4", 2.6f),
    ),
    "moon.fill" to listOf(
        sfFill("M19.6 3.6A12.6 12.6 0 1 0 28.4 21.8 10.2 10.2 0 0 1 19.6 3.6Z"),
    ),
    // map.fill: three panels folded against each other.
    "map.fill" to listOf(
        sfFill("M3.4 8.4 11.2 5.2 20.8 8.8 28.6 5.6V23.6L20.8 26.8 11.2 23.2 3.4 26.4Z"),
        sfCut("M11.2 5.6V23M20.8 9.2V26.4", 1.6f),
    ),
    "heart.fill" to listOf(
        sfFill("M16 27.8C8.8 22.6 3.8 18.2 3.8 12.2 3.8 8.5 6.7 5.6 10.3 5.6c2.4 0 4.5 1.3 5.7 3.4 1.2-2.1 3.3-3.4 5.7-3.4 3.6 0 6.5 2.9 6.5 6.6 0 6-5 10.4-12.2 15.6Z"),
    ),
)

// The speaker of speaker.slash.fill: its box and its cone, a little right of
// centre so the slash crosses the middle of it.
private const val SF_SPEAKER =
    "M7.2 12.2h4.2l6.8-5.8c.9-.8 2.3-.2 2.3 1v17.2c0 1.2-1.4 1.8-2.3 1l-6.8-5.8H7.2" +
        "a2.2 2.2 0 0 1 -2.2 -2.2v-3.2a2.2 2.2 0 0 1 2.2 -2.2Z"

/**
 * One of iOS's system symbols, drawn — see [SF_MARKS] for the list. An
 * unknown name draws nothing, as [Icon] does.
 *
 * Drawn on a layer of its own so that a [CUT] rubs out only this drawing and
 * never the card behind it.
 */
@Composable
internal fun SfMark(name: String, size: Dp, tint: Color, modifier: Modifier = Modifier) {
    val parts = SF_MARKS[name] ?: return
    val paths = remember(name) { parts.map { it to PathParser().parsePathString(it.d).toPath() } }
    Canvas(
        modifier
            .size(size)
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen },
    ) {
        val k = this.size.minDimension / Art.GRID
        scale(k, k, pivot = Offset.Zero) {
            for ((part, path) in paths) {
                part.fill?.let { f ->
                    if (f == CUT) drawPath(path, Color.Black, blendMode = BlendMode.Clear)
                    else drawPath(path, tint, alpha = part.alpha)
                }
                part.stroke?.let { s ->
                    val line = Stroke(width = part.strokeWidth, cap = StrokeCap.Round, join = StrokeJoin.Round)
                    if (s == CUT) drawPath(path, Color.Black, style = line, blendMode = BlendMode.Clear)
                    else drawPath(path, tint, alpha = part.alpha, style = line)
                }
            }
        }
    }
}

/**
 * The iPhone's spinner — eight spokes, the newest brightest, stepping round
 * once a second — for the places iOS puts a ProgressView: inside Add while a
 * request goes, beside Delete account while it is being deleted.
 */
@Composable
internal fun SfSpinner(tint: Color, size: Dp = 18.dp) {
    val spin = rememberInfiniteTransition(label = "sf-spinner")
    val turn by spin.animateFloat(
        0f, 8f,
        infiniteRepeatable(tween(1_000, easing = LinearEasing)),
        label = "sf-turn",
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
