package com.moneymove.game

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/**
 * The table's chat, and the game's log behind the second tab — iOS's
 * ChatLogSheet, drawn the way it is drawn there: a grabber, an inline
 * navigation bar with the title in the middle and Report at the trailing
 * edge, and a Chat | Log segmented control under it.
 *
 * Four people round a board talk, and a game where nobody notices the chat is
 * a game where nobody uses it — which is why the button that opens this keeps
 * a count of what has been said since it was last looked at. Opening the Chat
 * tab is what clears that count. Opening the Log does not: somebody checking
 * what they paid last turn has not read the three lines that arrived since,
 * and the badge should still be there when they come back.
 *
 * The log is the table's own window of it, the same sixty lines iOS lists,
 * so the two phones side by side scroll back to the same first line.
 *
 * Lines from a blocked player are dropped rather than greyed: the point of
 * blocking somebody is not to be shown a box where their words were. And
 * blocking does not wait on a report — the person in front of an unpleasant
 * message needs them gone now, and filing a complaint first is homework.
 *
 * `initialTab` is [TableSheet.ChatLog.CHAT] or [TableSheet.ChatLog.LOG], so
 * the centre well's History chip can open straight onto the log.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatSheet(
    store: GameStore,
    initialTab: Int = TableSheet.ChatLog.CHAT,
    onDismiss: () -> Unit,
) {
    val state = store.state
    if (state == null) {
        // Nothing to read without a table. Closing from an effect rather than
        // mid-composition keeps the caller's state change out of the frame
        // being drawn.
        LaunchedEffect(Unit) { onDismiss() }
        return
    }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    // Keyed on the tab asked for, so a second "open the log" while the chat is
    // up turns the page instead of being ignored.
    var tab by remember(initialTab) { mutableIntStateOf(initialTab) }
    val onChat = tab == TableSheet.ChatLog.CHAT

    val safety = rememberTableSafety(store)
    val scope = rememberCoroutineScope()
    var blocking by remember { mutableStateOf<String?>(null) }

    // Open on the chat and it is read; open on the log and it is not. Lines
    // arriving while the chat is up are read as they land.
    LaunchedEffect(tab, store.unreadChat) {
        if (tab == TableSheet.ChatLog.CHAT) store.markChatRead()
    }
    // Who is blocked, and which code is ours, are only as fresh as the last
    // screen that asked — and a player who went straight to a table never
    // opened the one that does. iOS asks every time the chat appears.
    LaunchedEffect(Unit) { refreshSafety(store) }

    // Names this device speaks with — its own seat and any pass & play guests.
    val ownVoices = state.players.filter { store.isLocal(it.id) }.mapTo(HashSet()) { it.name }
    fun reportable(line: ChatMessage): Boolean {
        val code = line.code
        return !code.isNullOrBlank() && code != store.myCode && line.name !in ownVoices
    }
    // Everyone else who has said something here, most recent first, with the
    // last thing they said. Reporting should not depend on knowing to
    // long-press, so these are one tap away from the navigation bar too.
    val senders = buildList {
        val seen = HashSet<String>()
        for (line in store.chatFeed.asReversed()) {
            val code = line.code ?: continue
            if (!reportable(line) || !seen.add(code)) continue
            add(SafetyTarget(code, line.name, place = "chat", quote = line.text))
        }
    }

    // Both answers are the store's toast, as iOS's store.block and
    // store.report give them — and the toast is drawn again inside this sheet
    // below, since the table's own copy lands underneath it.
    val block: (SafetyTarget) -> Unit = block@{ who ->
        if (blocking != null) return@block
        blocking = who.code
        scope.launch {
            val reply = safety.block(who.code)
            blocking = null
            if (reply.ok) {
                store.applyBlocked((reply.blocked ?: store.blockedCodes) + who.code.trim().uppercase())
                Haptics.tap()
                store.showToast("Blocked ${who.name}. Their messages are hidden and they can't friend or message you.")
            } else {
                store.showToast(reply.error ?: "Couldn't block them — try again.", isError = true)
            }
        }
    }
    val report: (SafetyTarget, ReportReason) -> Unit = { who, reason ->
        scope.launch {
            val reply = safety.report(who, reason)
            if (reply.ok) {
                Haptics.tap()
                store.showToast("Thanks — we'll look into it. You can also block ${who.name}.")
            } else {
                store.showToast(reply.error ?: "Couldn't send that report — try again.", isError = true)
            }
        }
    }

    MMSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        // iOS opens this at its medium detent, half the screen, and it stays
        // that height: it does not grow as lines arrive or change height
        // between Chat and Log. The lists take whatever the chrome leaves,
        // so the composer stays pinned at the foot.
        val half = (LocalConfiguration.current.screenHeightDp * 0.5f).dp
        Box(Modifier.fillMaxWidth()) {
            Column(Modifier.fillMaxWidth().height(half)) {
                ChatNavBar(
                    title = if (onChat) "Chat" else "Game log",
                    trailing = if (onChat && senders.isNotEmpty()) {
                        { HeaderReport(senders, blocking, onReport = report, onBlock = block) }
                    } else {
                        null
                    },
                )
                SectionPicker(
                    tab,
                    modifier = Modifier.padding(horizontal = 14.dp).padding(top = 10.dp, bottom = 6.dp),
                ) { tab = it }

                if (onChat) {
                    ChatTab(
                        store = store,
                        state = state,
                        blocking = blocking,
                        reportable = ::reportable,
                        onReport = report,
                        onBlock = block,
                    )
                } else {
                    LogTab(state)
                }
            }
            ChatGrabber(Modifier.align(Alignment.TopCenter))
            val toast = store.toast
            ChatToastPill(
                text = toast?.text,
                isError = toast?.isError == true,
                glyph = toast?.glyph,
                modifier = Modifier.align(Alignment.BottomCenter),
            )
        }
    }
}

// ── chat ───────────────────────────────────────────────────────────────────

@Composable
private fun ColumnScope.ChatTab(
    store: GameStore,
    state: GameState,
    blocking: String?,
    reportable: (ChatMessage) -> Boolean,
    onReport: (SafetyTarget, ReportReason) -> Unit,
    onBlock: (SafetyTarget) -> Unit,
) {
    val p = P.current
    var draft by remember { mutableStateOf("") }
    var channel by remember { mutableStateOf("all") }
    // Whoever picked up the composer by hand. Ignored the moment that seat
    // leaves the game, so a line can never go out wearing a ghost's name.
    var chosenSeat by remember { mutableStateOf<String?>(null) }
    val seat = store.speakingSeat(chosenSeat)
    val teamChat = store.hasTeamChat(seat)
    val lines = store.chatFor(channel, seat)
    val myTeam = state.team(state.player(seat)?.team)
    val teamColour = cssColor(myTeam?.color, p.gold)

    val storedAgree = rememberRulesAgreed()
    var agreedHere by remember { mutableStateOf(false) }
    val agreed = storedAgree || agreedHere

    // A pick can't outlive its team channel: handing the composer to a seat
    // with no team while "Team only" is up would show an empty room.
    LaunchedEffect(seat, teamChat) {
        if (channel == "team" && !teamChat) channel = "all"
    }

    val send: () -> Unit = {
        val text = draft.trim()
        if (text.isNotEmpty() && agreed) {
            store.sendChat(text, channel, seat)
            draft = ""
        }
    }

    if (teamChat) {
        Row(
            Modifier.padding(horizontal = 12.dp).padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            ChannelChip("globe", "Everyone", on = channel == "all", tint = p.ink2) { channel = "all" }
            // The team's own colour carries which side you're on.
            ChannelChip("shield", "Team only", on = channel == "team", tint = teamColour) { channel = "team" }
        }
    }

    val listState = rememberLazyListState()
    FollowNewest(listState, lines.size, lines.lastOrNull()?.id)
    LazyColumn(
        state = listState,
        // The thread keeps to its newest line, so lines are forever leaving
        // under the bar; they fade out there rather than slicing off.
        modifier = Modifier.fillMaxWidth().weight(1f).scrollEdge(listState),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        items(lines.size, key = { i -> lines[i].id.ifBlank { "at:${lines[i].at}:$i" } }) { i ->
            val line = lines[i]
            val who = if (reportable(line)) {
                SafetyTarget(line.code.orEmpty(), line.name, place = "chat", quote = line.text)
            } else {
                null
            }
            ChatRow(
                line = line,
                teamColour = line.team?.let { state.team(it) }?.let { cssColor(it.color, p.gold) },
                who = who,
                blocking = blocking,
                onReport = onReport,
                onBlock = onBlock,
            )
        }
        if (lines.isEmpty()) {
            item(key = "chat:empty") {
                // An empty column of nothing reads as broken; say what the
                // channel is for instead, near the top where a line would be.
                Text(
                    if (channel == "team") "Only your team can read this channel. Plan away."
                    else "Nothing said yet — tap a reaction below or type to start.",
                    // Straight on the sheet's glass, where ink3 is too faint
                    // to read at night; see quietInk.
                    color = quietInk(), fontSize = 12.5.sp, fontWeight = FontWeight.Medium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(top = 26.dp),
                )
            }
        }
    }

    if (!agreed) {
        Box(Modifier.padding(horizontal = 12.dp).padding(top = 6.dp)) {
            CommunityRulesCard(onAgree = { agreedHere = true })
        }
    }

    // Reactions are live before the rules are agreed to: a fixed set of
    // faces is nothing anybody can be abusive with, and it lets a newcomer
    // answer the table while they are still reading.
    EmoteRow { emote ->
        store.sendChat(emote, channel, seat)
        Haptics.tap()
    }

    // One chip per seat on this device, shown only when it holds more than
    // one — everything below it speaks as whoever is picked.
    val speakers = store.localSpeakers
    if (speakers.size > 1) {
        Row(
            Modifier.padding(horizontal = 12.dp).padding(top = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for (speaker in speakers) {
                SpeakerChip(speaker, selected = speaker.id == seat) {
                    chosenSeat = speaker.id
                    Haptics.tap()
                }
            }
        }
    }

    // Free text waits until the rules have been read and agreed to. It is
    // shown, dimmed, rather than hidden, so the thing being unlocked is
    // right there under the card that unlocks it. The send circle stays red
    // with an empty box, as iOS's does: an empty send is simply not sent.
    ChatComposer(
        draft = draft,
        // No cap while typing, as iOS's field has none: the server keeps two
        // hundred characters and cuts the rest.
        onDraft = { draft = it },
        placeholder = "Say something…",
        enabled = agreed,
        sendFill = p.red,
        sendInk = Color.White,
        onSend = send,
        modifier = Modifier.padding(horizontal = 12.dp).padding(top = 4.dp, bottom = 10.dp),
    )
    if (agreed) {
        Text(
            "Long-press a message, or tap Report, to report or block someone.",
            color = quietInk(), fontSize = 10.5.sp, fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
        )
    }
}

/**
 * One line, as a card: flag, name in the speaker's colour, a TEAM tag in the
 * team's colour when it was said on the team channel, then what they said.
 *
 * A long-press on anybody real who is not this device opens Report and Block
 * right there — the thing you want to act on is the thing you touch.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun ChatRow(
    line: ChatMessage,
    teamColour: Color?,
    who: SafetyTarget?,
    blocking: String?,
    onReport: (SafetyTarget, ReportReason) -> Unit,
    onBlock: (SafetyTarget) -> Unit,
) {
    val p = P.current
    var menu by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(12.dp)
    Box {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(shape)
                .background(p.card)
                .border(1.dp, p.rule, shape)
                .combinedClickable(
                    enabled = who != null,
                    onClick = {},
                    onLongClick = { Haptics.tap(); menu = true },
                )
                .padding(horizontal = 11.dp, vertical = 8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                line.flag?.takeIf { it.isNotBlank() }?.let {
                    Text(it, fontSize = 12.sp, maxLines = 1)
                    Spacer(Modifier.width(5.dp))
                }
                Text(
                    line.name,
                    color = cssColor(line.color, p.ink),
                    fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (line.isTeam) {
                    val tint = teamColour ?: p.gold
                    Spacer(Modifier.width(5.dp))
                    Text(
                        "TEAM",
                        color = tint,
                        fontSize = 7.5.sp, fontWeight = FontWeight.Black, letterSpacing = 0.5.sp,
                        maxLines = 1, softWrap = false,
                        modifier = Modifier
                            .clip(RoundedCornerShape(99.dp))
                            .background(tint.copy(alpha = 0.15f))
                            .padding(horizontal = 5.dp, vertical = 2.dp),
                    )
                }
            }
            Spacer(Modifier.height(3.dp))
            Text(
                // The rounded system face's own leading, about 1.2 of the size.
                line.text,
                color = p.ink, fontSize = 14.5.sp, lineHeight = 17.5.sp,
                fontWeight = FontWeight.Medium,
            )
        }
        if (who != null) {
            ChatSafetyMenu(
                expanded = menu,
                onDismiss = { menu = false },
                targets = listOf(who),
                onReport = onReport,
                onBlock = onBlock,
                blockingCode = blocking,
            )
        }
    }
}

/**
 * The navigation bar's Report: iOS's toolbar Label, the bubble with the
 * exclamation mark and the word beside it, opening a menu of everybody who
 * has spoken. Each name opens onto Report and Block, as iOS nests them.
 */
@Composable
private fun HeaderReport(
    senders: List<SafetyTarget>,
    blocking: String?,
    onReport: (SafetyTarget, ReportReason) -> Unit,
    onBlock: (SafetyTarget) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        ChatNavCapsule(
            "Report",
            symbol = "exclamationmark.bubble",
            description = "Report or block a player",
        ) { open = true }
        ChatSafetyMenu(
            expanded = open,
            onDismiss = { open = false },
            targets = senders,
            namesFirst = true,
            onReport = onReport,
            onBlock = onBlock,
            blockingCode = blocking,
        )
    }
}

// ── the safety menu ────────────────────────────────────────────────────────

/**
 * Report and Block as iOS offers them: a menu, and inside it Report as a
 * submenu of the reasons, so a report is filed from the menu itself in two
 * taps rather than from a second sheet. iOS went this way because a dialog
 * raised from a menu inside a detented sheet was never presented at all.
 *
 * Material has no nested menus, so a submenu opens in place — its title at
 * the top with the chevron turned down, which is also the way back — the
 * way an iOS menu expands one of its own.
 *
 * `namesFirst` is the navigation bar's version: everybody who has spoken,
 * each name opening onto their Report and Block. Otherwise the menu is about
 * the one person in `targets`. A null `onBlock` is a menu of Report alone,
 * which is all a message thread's bubble offers.
 */
@Composable
internal fun ChatSafetyMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    targets: List<SafetyTarget>,
    onReport: (SafetyTarget, ReportReason) -> Unit,
    onBlock: ((SafetyTarget) -> Unit)? = null,
    blockingCode: String? = null,
    namesFirst: Boolean = false,
) {
    var picked by remember { mutableStateOf<SafetyTarget?>(null) }
    var reasons by remember { mutableStateOf(false) }
    val close: () -> Unit = {
        picked = null
        reasons = false
        onDismiss()
    }
    val who = picked ?: if (namesFirst) null else targets.firstOrNull()
    ChatMenu(expanded = expanded, onDismiss = close) {
        when {
            who == null -> targets.forEachIndexed { i, t ->
                if (i > 0) MenuHairline()
                ChatMenuItem(t.name, chevron = true) { picked = t }
            }
            !reasons -> {
                if (namesFirst) {
                    MenuHeader(who.name) { picked = null }
                    MenuHairline()
                }
                ChatMenuItem("Report ${who.name}…", symbol = "exclamationmark.bubble") { reasons = true }
                if (onBlock != null) {
                    MenuHairline()
                    ChatMenuItem(
                        "Block ${who.name}",
                        symbol = "hand.raised",
                        danger = true,
                        enabled = blockingCode != who.code,
                    ) {
                        close()
                        onBlock(who)
                    }
                }
            }
            else -> {
                MenuHeader("Report ${who.name}…") { reasons = false }
                for (reason in ReportReason.entries) {
                    MenuHairline()
                    ChatMenuItem(reason.label) {
                        close()
                        onReport(who, reason)
                    }
                }
            }
        }
    }
}

/**
 * The dropdown every safety menu in the chat and the message thread hangs
 * from. A popup, not a dialog: a dialog raised from inside a bottom sheet is
 * the trap SafetySheets.kt was written around, and a dropdown is not one.
 * No outline, as iOS's menu has none — its shadow is what lifts it.
 */
@Composable
internal fun ChatMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    content: @Composable ColumnScopeAlias.() -> Unit,
) {
    val p = P.current
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        modifier = Modifier.heightIn(max = 460.dp).widthIn(min = 220.dp),
        shape = RoundedCornerShape(14.dp),
        containerColor = p.card,
        content = content,
    )
}

/**
 * One choice in a [ChatMenu], laid out as an iOS menu row: the words at the
 * leading edge in the body size, the symbol at the trailing one. `danger` is
 * iOS's destructive role, Block in red; `chevron` marks a row that opens a
 * submenu.
 */
@Composable
internal fun ChatMenuItem(
    label: String,
    symbol: String? = null,
    danger: Boolean = false,
    enabled: Boolean = true,
    chevron: Boolean = false,
    onClick: () -> Unit,
) {
    val p = P.current
    val ink = if (danger) p.bad else p.ink
    val shown = if (enabled) ink else ink.copy(alpha = 0.45f)
    DropdownMenuItem(
        text = {
            Text(
                label,
                color = shown,
                fontSize = 17.sp, fontWeight = FontWeight.Normal,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        },
        trailingIcon = when {
            symbol != null -> { { ChatSymbol(symbol, size = 18.dp, tint = shown) } }
            chevron -> { { RowChevron(tint = p.ink3, size = 12.dp) } }
            else -> null
        },
        enabled = enabled,
        contentPadding = PaddingValues(horizontal = 16.dp),
        onClick = onClick,
    )
}

/** An opened submenu's title: the chevron turned down, and a tap on it goes back. */
@Composable
private fun MenuHeader(title: String, onBack: () -> Unit) {
    val p = P.current
    DropdownMenuItem(
        text = {
            Text(
                title,
                color = p.ink,
                fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        },
        trailingIcon = { Box(Modifier.rotate(90f)) { RowChevron(tint = p.ink3, size = 12.dp) } },
        contentPadding = PaddingValues(horizontal = 16.dp),
        onClick = onBack,
    )
}

/** The hairline iOS draws between the rows of a menu. */
@Composable
private fun MenuHairline() {
    Box(Modifier.fillMaxWidth().height(0.5.dp).background(P.current.rule))
}

// ── pieces of the chat ─────────────────────────────────────────────────────

/** Everyone ↔ Team only, the chosen one filled in its own colour. */
@Composable
private fun ChannelChip(glyph: String, label: String, on: Boolean, tint: Color, onClick: () -> Unit) {
    val p = P.current
    val shape = RoundedCornerShape(99.dp)
    Row(
        Modifier
            .clip(shape)
            .background(if (on) tint.copy(alpha = 0.16f) else p.sunken)
            .border(1.dp, if (on) tint.copy(alpha = 0.55f) else Color.Transparent, shape)
            .clickable {
                onClick()
                Haptics.tap()
            }
            .padding(horizontal = 11.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(glyph, size = 13.dp, tint = if (on) tint else p.ink3)
        Spacer(Modifier.width(5.dp))
        Text(label, color = if (on) tint else p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

/**
 * Quick reactions first — one tap sends the emoji as an ordinary line, so the
 * table can be answered without the keyboard — then the rest of the palette
 * in the same scroll. The emoji is the message here, not a picture standing
 * in for a control.
 */
@Composable
private fun EmoteRow(onSend: (String) -> Unit) {
    val p = P.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (reaction in MMStatic.reactions) EmoteButton(reaction, 20.dp, p.goldSoft) { onSend(reaction) }
        Box(
            Modifier
                .padding(horizontal = 2.dp)
                .width(1.dp)
                .height(20.dp)
                .background(p.rule),
        )
        for (emote in MMStatic.emotes.drop(MMStatic.reactions.size)) {
            EmoteButton(emote, 18.dp, p.sunken) { onSend(emote) }
        }
    }
}

@Composable
private fun EmoteButton(emote: String, glyphSize: Dp, fill: Color, onClick: () -> Unit) {
    // Sized through the density, as AvatarDisc does, so a large system font
    // does not push the face out of its circle.
    val size = with(LocalDensity.current) { glyphSize.toSp() }
    Box(
        Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(fill)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(emote, fontSize = size, maxLines = 1, softWrap = false)
    }
}

/** A pass & play seat the composer can speak for — the same chip the auction paddle wears. */
@Composable
private fun SpeakerChip(player: PlayerState, selected: Boolean, onClick: () -> Unit) {
    val p = P.current
    val shape = RoundedCornerShape(99.dp)
    val colour = cssColor(player.color, p.red)
    val density = LocalDensity.current
    Row(
        Modifier
            .clip(shape)
            .background(if (selected) p.sunken else Color.Transparent)
            .border(if (selected) 1.5.dp else 1.dp, if (selected) colour else p.rule, shape)
            .clickable { onClick() }
            .padding(horizontal = 6.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(13.dp).clip(CircleShape).background(colour), contentAlignment = Alignment.Center) {
            Text(
                (player.name.firstOrNull() ?: '?').uppercase(),
                color = Color.White,
                fontSize = with(density) { 8.dp.toSp() },
                // iOS's .heavy.
                fontWeight = FontWeight.ExtraBold,
                maxLines = 1, softWrap = false,
            )
        }
        Spacer(Modifier.width(3.dp))
        Text(
            player.name,
            color = if (selected) p.ink else quietInk(),
            fontSize = 9.5.sp, fontWeight = FontWeight.Bold,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * The line you type into and the circle that sends it, as iOS draws both in
 * the table chat and a message thread: a capsule of the sunken ink with the
 * words in it, and a paper plane in a 36-point disc beside it. The thread
 * greys its disc out while there is nothing to send; the table chat keeps
 * its red, so each passes the fill and ink it wants.
 */
@Composable
internal fun ChatComposer(
    draft: String,
    onDraft: (String) -> Unit,
    placeholder: String,
    enabled: Boolean,
    sendFill: Color,
    sendInk: Color,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
    sendEnabled: Boolean = true,
) {
    val p = P.current
    val focus = LocalFocusManager.current
    Row(
        modifier.alpha(if (enabled) 1f else 0.45f),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicTextField(
            value = draft,
            onValueChange = onDraft,
            enabled = enabled,
            singleLine = true,
            textStyle = TextStyle(color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium),
            cursorBrush = SolidColor(p.red),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
            // The keyboard's own Send ends editing, as SwiftUI's onSubmit
            // does; the paper plane beside it leaves the keyboard up.
            keyboardActions = KeyboardActions(onSend = {
                onSend()
                focus.clearFocus()
            }),
            modifier = Modifier.weight(1f),
            decorationBox = { inner ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(CircleShape)
                        .background(p.sunken)
                        .padding(horizontal = 14.dp, vertical = 9.dp),
                ) {
                    if (draft.isEmpty()) {
                        Text(
                            placeholder,
                            color = p.ink3, fontSize = 15.sp, fontWeight = FontWeight.Medium,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    inner()
                }
            },
        )
        Box(
            Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(sendFill)
                .clickable(enabled = enabled && sendEnabled) { onSend() }
                .semantics { contentDescription = "Send" },
            contentAlignment = Alignment.Center,
        ) {
            ChatSymbol("paperplane", size = 16.dp, tint = sendInk)
        }
    }
}

// ── log ────────────────────────────────────────────────────────────────────

/**
 * Everything the table still holds, oldest at the top, opening on the newest
 * line and following new ones in. Each kind of line wears its own glyph and
 * colour, so a scroll back through thirty turns can be read by shape before
 * it is read by word.
 */
@Composable
private fun ColumnScope.LogTab(state: GameState) {
    val p = P.current
    val log = state.log
    // LogLine.key is a time and a hash, and two identical lines in the same
    // millisecond would share one. A LazyColumn throws on a repeated key, so
    // a repeat gets a count on the end.
    val keys = remember(log) {
        val seen = HashMap<String, Int>()
        log.map { line ->
            val n = (seen[line.key] ?: 0) + 1
            seen[line.key] = n
            if (n == 1) line.key else "${line.key}#$n"
        }
    }
    val listState = rememberLazyListState()
    FollowNewest(listState, log.size, keys.lastOrNull())
    LazyColumn(
        state = listState,
        // The thread keeps to its newest line, so lines are forever leaving
        // under the bar; they fade out there rather than slicing off.
        modifier = Modifier.fillMaxWidth().weight(1f).scrollEdge(listState),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        items(log.size, key = { i -> keys[i] }) { i ->
            val line = log[i]
            val look = logLook(line.kind)
            Row(verticalAlignment = Alignment.Top) {
                Box(Modifier.width(18.dp).height(18.dp), contentAlignment = Alignment.Center) {
                    when {
                        look.symbol != null -> ChatSymbol(look.symbol, size = 13.dp, tint = look.tint)
                        look.glyph != null -> Icon(look.glyph, size = 13.dp, tint = look.tint)
                        else -> Box(Modifier.size(6.dp).clip(CircleShape).background(look.tint))
                    }
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    line.text,
                    color = p.ink2, fontSize = 13.sp, lineHeight = 15.5.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/**
 * A log line's mark and colour. `symbol` is one of iOS's own shapes redrawn
 * below; `glyph` is the drawn set's nearest; neither is the plain dot for a
 * kind nobody styled.
 */
private data class LogLook(val tint: Color, val glyph: String? = null, val symbol: String? = null)

/**
 * iOS's logStyle, kind for kind. Where iOS reaches for a system colour
 * (purple dice, blue buys, orange warnings, pink surprises) this takes the
 * same system colour in the same mode. Where the drawn set's nearest glyph
 * keeps a colour of its own that is not iOS's — a green house for rent paid
 * out, a green GO arrow for a turn, gold sparkles for a red system line — the
 * SF shape is redrawn here instead, so it can take iOS's tint.
 */
@Composable
private fun logLook(kind: String): LogLook {
    val p = P.current
    val night = p.page.luminance() < 0.5f
    fun system(day: Long, dark: Long) = Color(if (night) dark else day)
    val purple = system(0xFFAF52DE, 0xFFBF5AF2)
    val blue = system(0xFF007AFF, 0xFF0A84FF)
    val orange = system(0xFFFF9500, 0xFFFF9F0A)
    val pink = system(0xFFFF2D55, 0xFFFF375F)
    // Every kind in iOS's own outline symbol, redrawn below so it takes iOS's
    // tint: the drawn set's nearest glyphs were filled or two-tone, and half of
    // them kept colours of their own that no tint reaches.
    return when (kind) {
        "dice" -> LogLook(purple, symbol = "die.face.5")
        "money" -> LogLook(p.good, symbol = "dollarsign.circle")
        "rent" -> LogLook(p.bad, symbol = "house")
        "buy" -> LogLook(blue, symbol = "cart")
        "turn" -> LogLook(p.gold, symbol = "play.fill")
        "jail", "warn" -> LogLook(orange, symbol = "exclamationmark.triangle")
        "bankrupt" -> LogLook(p.bad, symbol = "xmark.octagon")
        "auction", "trade" -> LogLook(p.gold, symbol = "hammer")
        "system" -> LogLook(p.red, symbol = "sparkles")
        "treasure" -> LogLook(orange, symbol = "gift")
        "surprise" -> LogLook(pink, symbol = "questionmark.circle")
        "build" -> LogLook(blue, symbol = "hammer.circle")
        // The log is printed straight on the sheet's glass, so its quiet
        // marks take the glass's quiet ink rather than ink3.
        "mortgage" -> LogLook(quietInk(), symbol = "building.columns")
        "join", "leave" -> LogLook(quietInk(), symbol = "person")
        else -> LogLook(quietInk())
    }
}

// ── the sheet's chrome ─────────────────────────────────────────────────────

/**
 * iOS's inline navigation bar on a sheet: the title centred in the bar's own
 * weight, an answer at either edge. The title takes its width first and the
 * two sides share what is left equally, which is what keeps it centred on
 * the sheet rather than between two buttons of different widths.
 */
@Composable
internal fun ChatNavBar(
    title: String,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val p = P.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(top = 16.dp, bottom = 11.dp)
            .heightIn(min = 44.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) { leading?.invoke() }
        Text(
            title,
            color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
            // The room iOS's inline title has between a Close capsule and a
            // menu circle.
            modifier = Modifier.widthIn(max = 196.dp),
        )
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) { trailing?.invoke() }
    }
}

/**
 * One of the navigation bar's answers: a 44-point capsule with the word in
 * it, the way iOS draws a toolbar button on a sheet — the symbol first when
 * the item is a Label, as Report is.
 */
@Composable
internal fun ChatNavCapsule(
    label: String,
    symbol: String? = null,
    description: String? = null,
    onClick: () -> Unit,
) {
    val p = P.current
    Row(
        Modifier
            .height(44.dp)
            .clip(CircleShape)
            .background(p.card)
            .clickable { onClick() }
            .then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier)
            .padding(horizontal = 15.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (symbol != null) {
            ChatSymbol(symbol, size = 19.dp, tint = p.ink)
            Spacer(Modifier.width(6.dp))
        }
        Text(label, color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.Normal, maxLines = 1)
    }
}

/** A toolbar button that is a symbol alone: the same surface, round. */
@Composable
internal fun ChatNavCircle(symbol: String, description: String, onClick: () -> Unit) {
    val p = P.current
    Box(
        Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(p.card)
            .clickable { onClick() }
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        ChatSymbol(symbol, size = 22.dp, tint = p.ink)
    }
}

/**
 * iOS's sheet grabber: 36 by 5, five points down from the top edge, in the
 * system's faint label grey rather than a table ink, so it is the same on
 * every table style, as it is there.
 */
@Composable
internal fun ChatGrabber(modifier: Modifier = Modifier) {
    val dark = P.current.sheet.luminance() < 0.5f
    Box(
        modifier
            .padding(top = 5.dp)
            .size(width = 36.dp, height = 5.dp)
            .clip(CircleShape)
            .background(if (dark) Color(0x4DEBEBF5) else Color(0x4D3C3C43)),
    )
}

/**
 * Chat | Log, as iOS's segmented control: a capsule track with the chosen
 * half raised out of it on a white-ish thumb, both labels in the full ink,
 * the chosen one semibold.
 */
@Composable
private fun SectionPicker(tab: Int, modifier: Modifier = Modifier, onPick: (Int) -> Unit) {
    val p = P.current
    // At night iOS's segmented control is system grey: the track #767680 at
    // 24% and a lighter thumb (#636366) raised out of it. The card colour
    // there is darker than the sunken track, which made the chosen half
    // look pressed in.
    val night = p.sheet.luminance() < 0.5f
    val track = if (night) Color(0x3D767680) else p.sunken
    val thumb = if (night) Color(0xFF636366) else p.card
    Row(
        modifier
            .fillMaxWidth()
            .height(32.dp)
            .clip(CircleShape)
            .background(track)
            .padding(2.dp),
    ) {
        for ((i, label) in listOf("Chat", "Log").withIndex()) {
            val on = tab == i
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .then(
                        if (on) Modifier.shadow(1.5.dp, CircleShape).background(thumb, CircleShape)
                        else Modifier,
                    )
                    .clip(CircleShape)
                    .clickable(enabled = !on) { onPick(i) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    color = p.ink,
                    fontSize = 13.sp,
                    fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
        }
    }
}

/**
 * iOS's toast, drawn inside a sheet. iOS gives its toasts a window above
 * every sheet, so the answer to a report or a block is read over the chat
 * that asked for it; a bottom sheet here is a window of its own over the
 * app's, and the app's toast would land underneath it.
 *
 * It is the same pill as every other toast in the app (TableOverlays.kt's
 * ToastPill, the shell's own): glass, with its words in the glass's ink, and
 * an error a solid plate of the palette's bad with white words — not the
 * accent's deep shade, which is brass on half the tables and does not read
 * as an error. It used to be an ink pill of its own, so the one toast in the
 * chat looked like a different app's. In a sheet there is no blurred copy to
 * sample, and a film over nothing would show the chat's own lines through
 * the words, so the pill lays the sheet's paper down under the film first
 * and declares exactly that, as the sheet's platter does.
 *
 * Led by the toast's own glyph, or iOS's info circle, or its warning triangle
 * for an error. Two lines at most, 24 above the bottom edge, rising in from
 * below.
 */
@Composable
internal fun ChatToastPill(
    text: String?,
    isError: Boolean,
    modifier: Modifier = Modifier,
    glyph: String? = null,
    /** 24 at a table; iOS lifts it to 78 away from one, clear of what is below. */
    bottom: Dp = 24.dp,
) {
    val p = P.current
    // Held for the way out, so the pill leaves with its words still on it.
    var last by remember { mutableStateOf<Triple<String, Boolean, String?>?>(null) }
    SideEffect { if (text != null) last = Triple(text, isError, glyph) }
    val shown = if (text != null) Triple(text, isError, glyph) else last
    AnimatedVisibility(
        visible = text != null,
        // Less the room the pill keeps inside itself for its shadow, so its
        // edge lands where it always did.
        modifier = modifier.padding(bottom = (bottom - CHAT_TOAST_SHADOW_ROOM).coerceAtLeast(0.dp)),
        enter = slideInVertically { it } + fadeIn(),
        exit = slideOutVertically { it } + fadeOut(),
    ) {
        val (words, error, mark) = shown ?: return@AnimatedVisibility
        val surface = rememberGlassSurface(BackdropKind.Sheet)
        val ink = if (error) Color.White else surface.labelInk()
        val pane = Modifier
            .background(p.sheet, MMShapes.pill)
            .mmGlass(backdrop = BackdropKind.Sheet, shape = MMShapes.pill, lens = false)
        Row(
            Modifier
                // The fade draws through a layer the size of this node, so
                // the shadow gets its room inside it.
                .padding(horizontal = CHAT_TOAST_SHADOW_ROOM, vertical = CHAT_TOAST_SHADOW_ROOM)
                .then(if (error) pane.background(p.bad, MMShapes.pill) else pane)
                .padding(horizontal = 17.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (mark != null) {
                Icon(mark, size = 17.dp, tint = ink)
            } else {
                ChatSymbol(
                    if (error) "exclamationmark.triangle.fill" else "info.circle.fill",
                    size = 17.dp, tint = ink,
                )
            }
            Text(
                words,
                color = ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Room for the pill's shadow inside its own fade, as the other toasts keep. */
private val CHAT_TOAST_SHADOW_ROOM = 24.dp

/**
 * Keeps a list on its newest line: a jump there when it first appears, and a
 * glide down each time a new one lands. The first move is a jump because
 * gliding through sixty lines of history on open is a scroll nobody asked for.
 */
@Composable
private fun FollowNewest(state: LazyListState, count: Int, newest: Any?) {
    var settled by remember { mutableStateOf(false) }
    LaunchedEffect(newest) {
        if (count == 0) return@LaunchedEffect
        if (settled) state.animateScrollToItem(count - 1) else state.scrollToItem(count - 1)
        settled = true
    }
}

// ── iOS's own symbols ──────────────────────────────────────────────────────
//
// The chat and the message thread wear a handful of SF Symbols that the drawn
// set has no match for: the paper plane on Send, the bubble with an
// exclamation mark on Report, the raised hand on Block, the ellipsis in a
// circle on a thread's menu, the toast's two marks, and the shapes the log
// tints — a house, a play triangle, an octagon with a cross, sparkles, a
// person. Glyphs.kt is generated from icons.js and has none of them, so they
// are drawn here on the same 32-point grid with the same parts the generated
// set uses, every part in the tint. Private to the chat, and meant to give way
// the day icons.js draws its own.

private val SYMBOLS: Map<String, List<GlyphPart>> = mapOf(
    // paperplane.fill: two wings meeting at the nose, the crease between them
    // left as a hairline of whatever the plane sits on.
    "paperplane" to listOf(
        GlyphPart("M28.4 3.6 3.9 13.5c-1 .4-1 1.8 0 2.2l8.2 3.2z"),
        GlyphPart("M28.4 3.6 18.5 28.1c-.4 1-1.8 1-2.2 0l-3.2-8.2z"),
    ),
    "ellipsis.circle" to listOf(
        GlyphPart("M3.6 16a12.4 12.4 0 1 0 24.8 0a12.4 12.4 0 1 0 -24.8 0Z", fill = null, stroke = INK, strokeWidth = 2.2f),
        GlyphPart("M8.3 16a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0 -3.8 0ZM14.1 16a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0 -3.8 0ZM19.9 16a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0 -3.8 0Z"),
    ),
    "exclamationmark.bubble" to listOf(
        GlyphPart(
            "M9.4 5H22.6A6 6 0 0 1 28.6 11V17A6 6 0 0 1 22.6 23H14.8L9.2 27.8V23A6 6 0 0 1 3.4 17V11A6 6 0 0 1 9.4 5Z",
            fill = null, stroke = INK, strokeWidth = 2.2f, cap = 1, join = 1,
        ),
        GlyphPart("M16 9.4V15.2", fill = null, stroke = INK, strokeWidth = 2.6f, cap = 1),
        GlyphPart("M14.5 18.9a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z"),
    ),
    // hand.raised, in outline as iOS draws it (not .fill): four fingers and
    // a thumb round at the tips, closed off at the wrist, one line all round.
    "hand.raised" to listOf(
        GlyphPart(
            "M11.2 28.8C9.6 27.6 8.4 26 7.6 24.2L4.6 17.8A2 2 0 0 1 8 16L8.6 17.6V9.6A2 2 0 0 1 12.6 9.6V15.5" +
                "V6.6A2 2 0 0 1 16.6 6.6V15.5V8A2 2 0 0 1 20.6 8V15.5V11.6A2 2 0 0 1 24.6 11.6V21" +
                "C24.6 25.4 21.6 28.8 17.4 28.8Z",
            fill = null, stroke = INK, strokeWidth = 2.2f, cap = 1, join = 1,
        ),
    ),
    // The log's outline symbols, iOS's logStyle: each one line at the
    // semibold weight iOS draws them, every part in the tint.
    "die.face.5" to listOf(
        GlyphPart("M9.4 4.4h13.2a5 5 0 0 1 5 5v13.2a5 5 0 0 1 -5 5H9.4a5 5 0 0 1 -5 -5V9.4a5 5 0 0 1 5 -5Z", fill = null, stroke = INK, strokeWidth = 2.2f, join = 1),
        GlyphPart(
            "M9.6 11a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0 -3.8 0ZM18.6 11a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0 -3.8 0Z" +
                "M14.1 16a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0 -3.8 0ZM9.6 21a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0 -3.8 0Z" +
                "M18.6 21a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0 -3.8 0Z",
        ),
    ),
    "dollarsign.circle" to listOf(
        GlyphPart("M3.6 16a12.4 12.4 0 1 0 24.8 0a12.4 12.4 0 1 0 -24.8 0Z", fill = null, stroke = INK, strokeWidth = 2.2f),
        GlyphPart("M16 8.4v15.2", fill = null, stroke = INK, strokeWidth = 2f, cap = 1),
        GlyphPart(
            "M19.8 12.4c-.9-1.3-2.2-2-3.9-2-2.2 0-3.7 1.2-3.7 2.9 0 4 7.8 1.9 7.8 5.9 0 1.8-1.6 3-3.9 3-1.8 0-3.3-.8-4.2-2.1",
            fill = null, stroke = INK, strokeWidth = 2f, cap = 1, join = 1,
        ),
    ),
    "cart" to listOf(
        GlyphPart("M2.6 5.4h3.8l3.4 15.4h15.4", fill = null, stroke = INK, strokeWidth = 2.2f, cap = 1, join = 1),
        GlyphPart("M7.4 9h20.4l-2.4 8.4H9.2", fill = null, stroke = INK, strokeWidth = 2.2f, cap = 1, join = 1),
        GlyphPart("M9.6 26a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0 -4.2 0ZM21.4 26a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0 -4.2 0Z"),
    ),
    "exclamationmark.triangle" to listOf(
        GlyphPart("M14.1 5 3.2 23.9a2.2 2.2 0 0 0 1.9 3.3h21.8a2.2 2.2 0 0 0 1.9-3.3L17.9 5a2.2 2.2 0 0 0-3.8 0Z", fill = null, stroke = INK, strokeWidth = 2.2f, join = 1),
        GlyphPart("M16 11.4v7", fill = null, stroke = INK, strokeWidth = 2.4f, cap = 1),
        GlyphPart("M14.5 22.4a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z"),
    ),
    "hammer" to listOf(
        // The head across the top, its claw curling back, and the handle
        // running down and to the right.
        GlyphPart("M6.4 10.6 12.6 4.4c2.6-1.6 6-1.2 8.2 1l-3.4 1.6 2.2 2.2-5.8 5.8-2.2-2.2-2.6 2.6Z", fill = null, stroke = INK, strokeWidth = 2f, join = 1),
        GlyphPart("M16.6 13.4 27 23.8a2 2 0 0 1 0 2.8l-.4.4a2 2 0 0 1 -2.8 0L13.4 16.6", fill = null, stroke = INK, strokeWidth = 2f, cap = 1, join = 1),
    ),
    "hammer.circle" to listOf(
        GlyphPart("M3.6 16a12.4 12.4 0 1 0 24.8 0a12.4 12.4 0 1 0 -24.8 0Z", fill = null, stroke = INK, strokeWidth = 2.2f),
        GlyphPart("M10.4 13.2 14 9.6c1.6-1 3.6-.8 5 .6l-2 1 1.4 1.4-3.4 3.4-1.4-1.4-1.6 1.6Z"),
        GlyphPart("M16.2 15.2 21.8 20.8", fill = null, stroke = INK, strokeWidth = 2.2f, cap = 1),
    ),
    "gift" to listOf(
        GlyphPart("M5 11.2h22a1.4 1.4 0 0 1 1.4 1.4v3a1.4 1.4 0 0 1 -1.4 1.4H5a1.4 1.4 0 0 1 -1.4 -1.4v-3A1.4 1.4 0 0 1 5 11.2Z", fill = null, stroke = INK, strokeWidth = 2f, join = 1),
        GlyphPart("M6 17v9.4a1.6 1.6 0 0 0 1.6 1.6h16.8a1.6 1.6 0 0 0 1.6 -1.6V17", fill = null, stroke = INK, strokeWidth = 2f, join = 1),
        GlyphPart("M16 11.2V28", fill = null, stroke = INK, strokeWidth = 2f),
        GlyphPart(
            "M16 11.2c-1.4-4.2-7.4-5.6-7.4-2.2 0 2.2 4 2.2 7.4 2.2zM16 11.2c1.4-4.2 7.4-5.6 7.4-2.2 0 2.2-4 2.2-7.4 2.2z",
            fill = null, stroke = INK, strokeWidth = 2f, join = 1,
        ),
    ),
    "questionmark.circle" to listOf(
        GlyphPart("M3.6 16a12.4 12.4 0 1 0 24.8 0a12.4 12.4 0 1 0 -24.8 0Z", fill = null, stroke = INK, strokeWidth = 2.2f),
        GlyphPart("M12.4 12.6c0-2.2 1.6-3.8 3.8-3.8 2.1 0 3.7 1.4 3.7 3.4 0 1.6-.9 2.4-2.1 3.2-1.1.7-1.6 1.3-1.6 2.5v.5", fill = null, stroke = INK, strokeWidth = 2.4f, cap = 1),
        GlyphPart("M14.5 22.4a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0Z"),
    ),
    "building.columns" to listOf(
        GlyphPart("M16 3.6 28.6 10.4v2H3.4v-2Z", fill = null, stroke = INK, strokeWidth = 2f, join = 1),
        GlyphPart("M7.2 14.6v9.4M12.4 14.6v9.4M19.6 14.6v9.4M24.8 14.6v9.4", fill = null, stroke = INK, strokeWidth = 2.2f, cap = 1),
        GlyphPart("M3.4 27.4h25.2", fill = null, stroke = INK, strokeWidth = 2.4f, cap = 1),
    ),
    "house" to listOf(
        GlyphPart("M3.8 15.6 16 5.2l12.2 10.4", fill = null, stroke = INK, strokeWidth = 2.3f, cap = 1, join = 1),
        GlyphPart(
            "M7.6 12.6V26.2a1.6 1.6 0 0 0 1.6 1.6h13.6a1.6 1.6 0 0 0 1.6-1.6V12.6",
            fill = null, stroke = INK, strokeWidth = 2.3f, cap = 1, join = 1,
        ),
        GlyphPart("M13.3 27.8v-6.9h5.4v6.9", fill = null, stroke = INK, strokeWidth = 2.1f, cap = 1, join = 1),
    ),
    "play.fill" to listOf(
        GlyphPart("M9.6 6.3c0-1.4 1.5-2.3 2.7-1.5l14.4 9.5c1.1.7 1.1 2.3 0 3.1L12.3 26.9c-1.2.8-2.7-.1-2.7-1.5z"),
    ),
    "xmark.octagon" to listOf(
        GlyphPart("M11.2 3.8H20.8L28.2 11.2V20.8L20.8 28.2H11.2L3.8 20.8V11.2Z", fill = null, stroke = INK, strokeWidth = 2.2f, join = 1),
        GlyphPart("M11.8 11.8 20.2 20.2M20.2 11.8 11.8 20.2", fill = null, stroke = INK, strokeWidth = 2.4f, cap = 1),
    ),
    // The drawn set's sparkle, taking the tint, with the third small star
    // Apple's sparkles has.
    "sparkles" to listOf(
        GlyphPart("M14.4 2.4c1 6.4 3.1 8.5 9.5 9.5-6.4 1-8.5 3.1-9.5 9.5-1-6.4-3.1-8.5-9.5-9.5 6.4-1 8.5-3.1 9.5-9.5z"),
        GlyphPart("M24.2 19.2c.5 3.3 1.6 4.4 4.9 4.9-3.3.5-4.4 1.6-4.9 4.9-.5-3.3-1.6-4.4-4.9-4.9 3.3-.5 4.4-1.6 4.9-4.9z"),
        GlyphPart("M25.4 2.6c.3 2 1 2.7 3 3-2 .3-2.7 1-3 3-.3-2-1-2.7-3-3 2-.3 2.7-1 3-3z"),
    ),
    "person" to listOf(
        GlyphPart("M10.8 10.2a5.2 5.2 0 1 0 10.4 0a5.2 5.2 0 1 0 -10.4 0Z", fill = null, stroke = INK, strokeWidth = 2.2f),
        GlyphPart(
            "M6.2 27.6c0-5.4 4.4-9.2 9.8-9.2s9.8 3.8 9.8 9.2c0 .7-.5 1.2-1.2 1.2H7.4c-.7 0-1.2-.5-1.2-1.2z",
            fill = null, stroke = INK, strokeWidth = 2.2f, join = 1,
        ),
    ),
    // The toast's two marks, filled, with the letter cut out of them so the
    // pill's own colour shows through it, as Apple's .fill symbols do.
    "info.circle.fill" to listOf(
        GlyphPart(
            "M3 16a13 13 0 1 0 26 0a13 13 0 1 0 -26 0ZM14.6 13.4h2.8v9.6h-2.8ZM14.3 9.4a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0 -3.4 0Z",
            evenOdd = true,
        ),
    ),
    "exclamationmark.triangle.fill" to listOf(
        GlyphPart(
            "M14.1 4.5 2.5 24.3a2.2 2.2 0 0 0 1.9 3.3h23.2a2.2 2.2 0 0 0 1.9-3.3L17.9 4.5a2.2 2.2 0 0 0-3.8 0zM14.6 11h2.8v8h-2.8ZM14.3 23a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0 -3.4 0Z",
            evenOdd = true,
        ),
    ),
)

/** Parsed once per symbol, the way Art keeps the generated set. */
private val symbolPaths = HashMap<String, List<Pair<GlyphPart, Path>>>()

private fun symbolParts(name: String): List<Pair<GlyphPart, Path>> = symbolPaths.getOrPut(name) {
    SYMBOLS[name].orEmpty().map { part ->
        part to PathParser().parsePathString(part.d).toPath().apply {
            fillType = if (part.evenOdd) PathFillType.EvenOdd else PathFillType.NonZero
        }
    }
}

/** One of the symbols above, every part in `tint`. */
@Composable
internal fun ChatSymbol(name: String, size: Dp, tint: Color, modifier: Modifier = Modifier) {
    val parts = remember(name) { symbolParts(name) }
    Canvas(modifier.size(size)) {
        val k = this.size.minDimension / 32f
        scale(k, k, pivot = Offset.Zero) {
            for ((part, path) in parts) {
                if (part.fill != null) drawPath(path, tint, alpha = part.alpha, style = Fill)
                if (part.stroke != null) {
                    drawPath(
                        path, tint, alpha = part.alpha,
                        style = Stroke(
                            width = part.strokeWidth,
                            cap = if (part.cap == 1) StrokeCap.Round else StrokeCap.Butt,
                            join = if (part.join == 1) StrokeJoin.Round else StrokeJoin.Miter,
                        ),
                    )
                }
            }
        }
    }
}

// ── the calls ──────────────────────────────────────────────────────────────

/**
 * Safety calls from the table, with the server's reason kept.
 *
 * The plain post throws a refusal's body away, so "You have sent a lot of
 * reports today" would reach the player as a sentence guessing at the
 * network. This keeps the body of any refusal that says why, and still
 * answers null for one that says nothing — a proxy's error page parsed as
 * no error at all would read as success.
 */
@Composable
private fun rememberTableSafety(store: GameStore): Safety = remember(store) {
    Safety { path, body ->
        val reply = store.api.postOrError(path, body)
        when {
            reply.ok -> reply.body
            reply.error != null -> reply.body
            else -> null
        }
    }
}

/**
 * Who this player has blocked, and their own code, fetched fresh — iOS's
 * refreshSafety. Both are cheap, and both are wrong until something asks:
 * a stale blocked list shows lines that should be gone, and a missing own
 * code offers a Report button pointed at yourself.
 */
private suspend fun refreshSafety(store: GameStore) {
    store.api.get("/api/social")?.let { raw ->
        runCatching { MMJson.decodeFromString(SocialView.serializer(), raw) }.getOrNull()?.let { social ->
            store.applyBlocked(social.blocked.mapTo(HashSet()) { it.trim().uppercase() })
        }
    }
    if (store.myCode.isBlank()) {
        store.api.get("/api/me")?.let { raw ->
            runCatching { MMJson.decodeFromString(MeView.serializer(), raw) }.getOrNull()
                ?.code?.takeIf { it.isNotBlank() }?.let(store::applyMyCode)
        }
    }
}
