package com.moneymove.game

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
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
 * uses submenus instead. The Android version of that trap is an AlertDialog
 * raised from inside a ModalBottomSheet, which fights the sheet for the
 * window and can end up behind it or dismissing it. So a confirmation here is
 * an inline row that replaces the button, or a second sheet. Never a dialog.
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
 * A name short enough to sit inside a button.
 *
 * MMButton draws one Text with no line limit, so a twenty-character nickname
 * does not clip — it wraps, and the button grows a second line in the middle
 * of a confirmation. This is the only place that can cut it.
 */
private fun shortName(name: String, limit: Int = 14): String {
    val clean = name.trim()
    if (clean.isBlank()) return "this player"
    return if (clean.length <= limit) clean else clean.take(limit - 1).trimEnd() + "…"
}

/**
 * The three safety calls, wrapped round whichever POST it was handed.
 *
 * It owns no state of its own on purpose: who is blocked lives on
 * GameStore.blockedCodes and nowhere else, and a second copy in here would be
 * the copy that goes stale the first time a block happens on another screen.
 */
class Safety(private val post: SafetyPost) {

    /** POST /api/block — `{ token, code }`, answered with the whole blocked list. */
    suspend fun block(code: String): SafetyReply = withCode(code) { send("/api/block", mapOf("code" to it)) }

    /** POST /api/unblock — the same body, the same answer. */
    suspend fun unblock(code: String): SafetyReply = withCode(code) { send("/api/unblock", mapOf("code" to it)) }

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
     * and a train tunnel arrive here as the same null. The sentence below has
     * to be true of both, which is why it names no cause: telling somebody who
     * has hit the twenty-a-day report cap to check their connection sends them
     * to fix a thing that is not broken.
     */
    private suspend fun send(path: String, body: Map<String, Any?>): SafetyReply {
        val raw = post(path, body)
            ?: return SafetyReply(false, "That didn't go through, and nothing has changed. Try again.")
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
 * The same calls, made with the identity an [AccountStore] is already using.
 *
 * It reads the token out of Prefs rather than out of the store because the
 * store keeps its Api private, and prising it open for this would be a worse
 * trade than building a second one — Api is a URL and a string.
 */
fun AccountStore.safety(): Safety {
    val prefs = Prefs(getApplication<Application>())
    val api = Api(prefs.server, prefs.token)
    return Safety { path, body -> api.post(path, body) }
}

// ── report ─────────────────────────────────────────────────────────────────

/**
 * Report somebody, in one tap.
 *
 * A reason is the whole form. Asking for a written explanation as well would
 * turn a thirty-second job into homework, and the queue on the other end is
 * read by a person who mostly needs to know which line to look at.
 *
 * Nothing is promised afterwards that we cannot keep: the sheet says the
 * report arrived and that it will be read, and then points at blocking, which
 * is the part that takes effect while they are still standing there.
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
    onDismiss: () -> Unit,
) {
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val target = remember(code, name, place, quote) { SafetyTarget(code, name, place, quote) }

    var sending: ReportReason? by remember { mutableStateOf<ReportReason?>(null) }
    var sent: Boolean by remember { mutableStateOf(false) }
    var failure: String? by remember { mutableStateOf<String?>(null) }

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
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon("shield", size = 20.dp, tint = p.red)
                Spacer(Modifier.width(8.dp))
                // The title takes the slack and ellipsises. Left to size itself
                // it would push Cancel off the right edge on any nickname near
                // the twenty characters Prefs allows.
                Text(
                    if (sent) "Report sent" else "Report ${name.ifBlank { "this player" }}",
                    color = p.ink, fontSize = 19.sp, fontWeight = FontWeight.Black,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                MMButton(if (sent) "Done" else "Cancel", kind = BtnKind.GHOST) { onDismiss() }
            }

            // Seven reasons that all fail on whichever one is tapped is worse
            // than one line saying so now.
            if (!isFriendCode(normalisedCode(code))) {
                Spacer(Modifier.height(10.dp))
                Hint(NO_CODE)
                return@Column
            }

            if (sent) {
                Spacer(Modifier.height(10.dp))
                Hint(
                    "It's with us and a person reads every one. We won't write back about it, " +
                        "and ${name.ifBlank { "they" }} is never told who reported them."
                )
                Spacer(Modifier.height(16.dp))
                SectionLabel("The part that works now", icon = "bolt")
                Spacer(Modifier.height(8.dp))
                BlockRow(
                    code = code,
                    name = name,
                    safety = safety,
                    onBlocked = { onBlocked(it); onDismiss() },
                )
                return@Column
            }

            Spacer(Modifier.height(10.dp))
            Hint("Tell us what happened. Pick the closest one — it goes straight to whoever runs MoneyMove.")

            if (quote.isNotBlank()) {
                Spacer(Modifier.height(14.dp))
                SectionLabel("What you're reporting", icon = "chat")
                Spacer(Modifier.height(6.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(p.sunken)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                ) {
                    Text(
                        quote.take(400),
                        color = p.ink2, fontSize = 13.5.sp, lineHeight = 19.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            SectionLabel("Reason", icon = "gavel")
            Spacer(Modifier.height(6.dp))
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (reason in ReportReason.entries) {
                    ReasonRow(
                        reason = reason,
                        busy = sending == reason,
                        // One tap sends, so a second tap while the first is in
                        // flight would file the same thing twice against a
                        // daily cap of twenty.
                        enabled = sending == null,
                    ) {
                        SoundKit.click()
                        sending = reason
                        failure = null
                        scope.launch {
                            val reply = safety.report(target, reason)
                            sending = null
                            if (reply.ok) {
                                Haptics.tap()
                                sent = true
                            } else {
                                failure = reply.error
                            }
                        }
                    }
                }
            }

            failure?.let {
                Spacer(Modifier.height(10.dp))
                Text(it, color = p.bad, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun ReasonRow(
    reason: ReportReason,
    busy: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val p = P.current
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (busy) p.badSoft else p.sunken)
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 13.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            reason.label,
            color = if (enabled || busy) p.ink else p.ink3,
            fontSize = 14.5.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.weight(1f))
        if (busy) Text("Sending…", color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
    }
}

// ── block ──────────────────────────────────────────────────────────────────

/**
 * The Block control, wherever somebody's words or name appear.
 *
 * It is two states in one row rather than a button that opens something:
 * tapping Block swaps the row for [BlockConfirm] in place. Blocking also tears
 * down the friendship, both pending requests and any invite between the two
 * of you — that is worth a sentence before it happens, not a toast after.
 */
@Composable
fun BlockRow(
    code: String,
    name: String,
    modifier: Modifier = Modifier,
    safety: Safety = rememberSafety(),
    onBlocked: (String) -> Unit,
) {
    val p = P.current
    val scope = rememberCoroutineScope()
    var asking: Boolean by remember(code) { mutableStateOf(false) }
    var busy: Boolean by remember(code) { mutableStateOf(false) }
    var failure: String? by remember(code) { mutableStateOf<String?>(null) }

    Column(modifier.fillMaxWidth()) {
        if (!isFriendCode(normalisedCode(code))) {
            // A house player has no code, so there is nobody on the other end
            // of /api/block. Saying so beats a button that fails a second later.
            Hint("We don't have a player code for this one, so there's nobody to block.")
            return@Column
        }
        if (asking) {
            BlockConfirm(
                name = name,
                busy = busy,
                onCancel = { asking = false },
                onConfirm = {
                    busy = true
                    failure = null
                    scope.launch {
                        val reply = safety.block(code)
                        busy = false
                        if (reply.ok) {
                            Haptics.tap()
                            asking = false
                            // Uppercased, because whoever holds the blocked set
                            // matches it against the codes the server sends on
                            // chat lines, and those are always uppercase. A
                            // lowercase entry is an entry that never matches.
                            onBlocked(normalisedCode(code))
                        } else {
                            failure = reply.error
                        }
                    }
                },
            )
        } else {
            MMButton(
                "Block ${shortName(name)}",
                kind = BtnKind.DANGER,
                icon = "police",
                modifier = Modifier.fillMaxWidth(),
            ) {
                SoundKit.click()
                asking = true
            }
        }
        failure?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = p.bad, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/**
 * "Are you sure", as a row rather than a dialog.
 *
 * This is the piece that has to stay inline: every place Block is offered is
 * already inside a ModalBottomSheet, and a dialog raised from inside one is
 * the Android cousin of the confirmationDialog iOS could never get to present.
 * A row cannot fail to appear.
 */
@Composable
private fun BlockConfirm(
    name: String,
    busy: Boolean,
    modifier: Modifier = Modifier,
    onCancel: () -> Unit,
    onConfirm: () -> Unit,
) {
    val p = P.current
    // Shortened to fit and otherwise left alone: a nickname is theirs, and the
    // fallback is lower case because it lands mid-sentence — "Block This
    // player?" is how the placeholder gives itself away.
    val who = shortName(name)
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(p.badSoft)
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon("warning", size = 16.dp, tint = p.bad)
            Spacer(Modifier.width(7.dp))
            Text("Block $who?", color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Black)
        }
        Spacer(Modifier.height(6.dp))
        // The word "hidden" would be a lie: a blocked player's chat lines are
        // dropped on the way in, because the point of blocking somebody is not
        // to be shown a box where their words were.
        Hint(
            "Their messages stop arriving, they can't add you or message you, and " +
                "whatever friendship or invite you had between you goes. You can undo it in Settings."
        )
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MMButton(
                if (busy) "Blocking…" else "Block",
                kind = BtnKind.DANGER,
                modifier = Modifier.weight(1f),
                enabled = !busy,
            ) { onConfirm() }
            MMButton(
                "Keep them",
                kind = BtnKind.GHOST,
                modifier = Modifier.weight(1f),
                enabled = !busy,
            ) { onCancel() }
        }
    }
}

// ── the list ───────────────────────────────────────────────────────────────

/**
 * Everyone this player has blocked, with the way back.
 *
 * Only codes, because that is genuinely all the app has: the server answers
 * every block call with a list of friend codes and never sends a name or a
 * token with it. Showing a code is better than inventing a lookup that would
 * have to ask about people this player has deliberately cut off.
 *
 * [onUnblock] is where the new state actually lands. The list this app plays
 * against lives on GameStore.blockedCodes, which only GameStore may write, so
 * this sheet does the call and hands the code back rather than keeping a
 * second copy that would drift.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BlockedPlayersSheet(
    codes: Set<String>,
    onUnblock: (String) -> Unit,
    safety: Safety = rememberSafety(),
    onDismiss: () -> Unit,
) {
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var working: String? by remember { mutableStateOf<String?>(null) }
    var failure: String? by remember { mutableStateOf<String?>(null) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.sheet,
        dragHandle = null,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp)
                .padding(bottom = 28.dp),
        ) {
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon("police", size = 20.dp, tint = p.red)
                Spacer(Modifier.width(8.dp))
                Text("Blocked players", color = p.ink, fontSize = 19.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.weight(1f))
                MMButton("Done", kind = BtnKind.GHOST) { onDismiss() }
            }
            Spacer(Modifier.height(6.dp))
            Hint(
                if (codes.isEmpty()) "You haven't blocked anyone."
                else "Their table chat never reaches you, and they can't add you or message you."
            )

            if (codes.isNotEmpty()) {
                Spacer(Modifier.height(14.dp))
                Column(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    // Sorted, because a set has no order of its own and a list
                    // that reshuffles itself on every refresh is a list where
                    // Unblock lands on the wrong row.
                    for (blockedCode in codes.sorted()) {
                        BlockedRow(
                            code = blockedCode,
                            busy = working == blockedCode,
                            enabled = working == null,
                        ) {
                            SoundKit.click()
                            working = blockedCode
                            failure = null
                            scope.launch {
                                val reply = safety.unblock(blockedCode)
                                working = null
                                if (reply.ok) {
                                    Haptics.tap()
                                    onUnblock(blockedCode)
                                } else {
                                    failure = reply.error
                                }
                            }
                        }
                    }
                }
            }

            failure?.let {
                Spacer(Modifier.height(10.dp))
                Text(it, color = p.bad, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }

            Spacer(Modifier.height(14.dp))
            // Unblocking is not re-friending. Saying so here saves the one
            // message somebody sends to an empty friends list wondering why.
            Hint("Unblocking lets them find you again. It doesn't put back a friendship the block ended.")
        }
    }
}

@Composable
private fun BlockedRow(
    code: String,
    busy: Boolean,
    enabled: Boolean,
    onUnblock: () -> Unit,
) {
    val p = P.current
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(p.sunken)
            .padding(horizontal = 13.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            code,
            color = p.ink,
            fontSize = 14.5.sp,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.weight(1f))
        // While one row is in flight every row is dead, so two taps cannot
        // race and leave the list disagreeing with the server about who is on it.
        MMButton(
            if (busy) "Unblocking…" else "Unblock",
            kind = BtnKind.GHOST,
            enabled = enabled,
        ) { onUnblock() }
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
            Icon("shield", size = 15.dp, tint = p.gold)
            Spacer(Modifier.width(7.dp))
            Text(
                "Before you chat",
                color = p.ink, fontSize = 14.sp, fontWeight = FontWeight.Black,
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
        Spacer(Modifier.height(10.dp))
        MMButton("I agree", kind = BtnKind.PRIMARY, modifier = Modifier.fillMaxWidth()) {
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
