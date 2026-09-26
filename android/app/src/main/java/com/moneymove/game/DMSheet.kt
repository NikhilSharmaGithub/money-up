package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * A conversation with one friend — iOS's DMSheet, laid out the way it is
 * there: a grabber, an inline navigation bar with Close at the leading edge,
 * the friend's flag and name in the middle and the ellipsis menu at the
 * trailing one, the thread, and the box to write in.
 *
 * Report and Block sit in that menu whether or not they have said anything
 * yet. Getting rid of somebody should never wait on them writing a word first.
 * Report is a submenu of reasons, filed from the menu itself, as iOS files it.
 *
 * The box is always there. The server refuses a message to anyone who is
 * not on your friends list, and when it does, its reason comes back as a
 * toast over the thread — the way iOS says it — and the sentence goes back
 * in the box rather than being lost.
 *
 * Nothing here is pushed: the thread is polled while the sheet is up, by
 * [MessagingStore], and the poll dies with the sheet.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DMSheet(
    friend: Friend,
    messaging: MessagingStore,
    account: AccountStore,
    /**
     * A block made from here has to reach GameStore, or it holds for this
     * sheet and nowhere else — the table chat would keep showing the lines of
     * somebody the player has just blocked.
     */
    onBlocked: (String) -> Unit = {},
    /**
     * Somewhere to say a block worked. The sheet closes on it, so the sentence
     * has to be said by whoever is still on screen afterwards.
     */
    onToast: (String) -> Unit = {},
    onDismiss: () -> Unit,
) {
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var blocking by remember { mutableStateOf(false) }
    // iOS answers a report, a failed block and a refused message with its
    // toast, drawn over the sheet. This is that toast, for this sheet.
    var toast by remember { mutableStateOf<Pair<String, Boolean>?>(null) }

    // Close, and a block that worked, let the sheet slide down before it
    // goes, as iOS's dismiss() does, rather than vanishing in one frame.
    val close: () -> Unit = {
        scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
    }

    // The account's own identity, and a refusal's reason kept rather than
    // flattened into "that didn't go through".
    val safety = remember(account) { Safety { path, body -> account.postForReason(path, body) } }

    LaunchedEffect(friend.code) { messaging.openThread(friend.code) }
    // The name in the bar is only as fresh as this list, and a thread is
    // usually opened minutes after the tab that loaded it.
    LaunchedEffect(Unit) { account.refreshSocial() }
    DisposableEffect(Unit) { onDispose { messaging.closeThread() } }
    LaunchedEffect(toast) {
        if (toast != null) {
            // iOS's 2.6 seconds.
            delay(2_600)
            toast = null
        }
    }
    // The server's reason for refusing a message, said the way iOS says it.
    LaunchedEffect(messaging.sendError) {
        messaging.sendError?.let { toast = it to true }
    }

    // Whoever they are right now: the row this was opened from is as old as
    // the tab that drew it.
    val live = account.social?.friends?.firstOrNull { it.code == friend.code } ?: friend
    val name = live.name.ifBlank { live.code }

    val storedAgree = rememberRulesAgreed()
    var agreedHere by remember { mutableStateOf(false) }
    val agreed = storedAgree || agreedHere

    val thread = messaging.thread
    LaunchedEffect(thread.size) {
        if (thread.isNotEmpty()) listState.animateScrollToItem(thread.lastIndex)
    }

    val mine = messaging.myCode.ifBlank { account.me?.code.orEmpty() }
    val lastFromThem = thread.lastOrNull { it.from != mine && it.from.isNotBlank() }?.text.orEmpty()

    // The send circle and the keyboard's own send key are the same act, so
    // they are the same lambda; two copies of this drift apart on the first
    // change to either of them.
    val send: () -> Unit = {
        val text = draft.trim()
        if (text.isNotEmpty() && agreed && !messaging.sending) {
            draft = ""
            SoundKit.click()
            messaging.send(friend.code, text) { ok ->
                // As on iOS the box stays empty and the server's reason is
                // the toast; a refusal is usually a friendship that has
                // ended, and the friends list is where that shows for good.
                if (!ok) account.refreshSocial()
            }
        }
    }

    val report: (SafetyTarget, ReportReason) -> Unit = { who, reason ->
        scope.launch {
            val reply = safety.report(who, reason)
            toast = if (reply.ok) {
                Haptics.tap()
                "Thanks — we'll look into it. You can also block ${who.name}." to false
            } else {
                (reply.error ?: "Couldn't send that report — try again.") to true
            }
        }
    }
    // Blocked means no longer friends, so there is no thread left to sit in.
    val block: (SafetyTarget) -> Unit = block@{ who ->
        if (blocking) return@block
        blocking = true
        scope.launch {
            val reply = safety.block(who.code)
            blocking = false
            if (reply.ok) {
                Haptics.tap()
                onBlocked(who.code.trim().uppercase())
                onToast("Blocked ${who.name}. Their messages are hidden and they can't friend or message you.")
                close()
            } else {
                toast = (reply.error ?: "Couldn't block them — try again.") to true
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.sheet,
        dragHandle = null,
    ) {
        // iOS's medium detent: half the screen, whatever the thread holds,
        // with the thread taking what the bar and the box leave.
        val half = (LocalConfiguration.current.screenHeightDp * 0.5f).dp
        Box(Modifier.fillMaxWidth()) {
            Column(Modifier.fillMaxWidth().height(half)) {
                ChatNavBar(
                    title = listOfNotNull(live.flag.takeIf { it.isNotBlank() }, name).joinToString(" "),
                    leading = { ChatNavCapsule("Close") { close() } },
                    trailing = {
                        Box {
                            ChatNavCircle("ellipsis.circle", description = "Report or block") { menu = true }
                            ChatSafetyMenu(
                                expanded = menu,
                                onDismiss = { menu = false },
                                targets = listOf(SafetyTarget(friend.code, name, place = "dm", quote = lastFromThem)),
                                onReport = report,
                                onBlock = block,
                                blockingCode = if (blocking) friend.code else null,
                            )
                        }
                    },
                )

                if (thread.isEmpty()) {
                    Column(
                        Modifier.fillMaxWidth().weight(1f).padding(top = 42.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon("chat", size = 26.dp, tint = p.ink3)
                        Spacer(Modifier.height(6.dp))
                        Text("Say hi", color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    }
                } else {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        contentPadding = PaddingValues(12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(thread.size) { i ->
                            val msg = thread[i]
                            Bubble(
                                msg,
                                isMine = msg.from == mine,
                                // Anything they said can be reported as they said it.
                                target = SafetyTarget(friend.code, name, place = "dm", quote = msg.text),
                                onReport = report,
                            )
                        }
                    }
                }

                if (!agreed) {
                    Box(Modifier.padding(horizontal = 12.dp).padding(top = 6.dp)) {
                        CommunityRulesCard(onAgree = { agreedHere = true })
                    }
                }
                // Shown, dimmed, until the rules are agreed to — the box being
                // unlocked sits right under the card that unlocks it. Nothing
                // to send is a dead tap, so the circle greys out to say so.
                val sendable = draft.isNotBlank()
                ChatComposer(
                    draft = draft,
                    // No cap while typing, as iOS's field has none; the
                    // server slices at 300.
                    onDraft = { draft = it },
                    placeholder = "Message $name…",
                    enabled = agreed,
                    sendFill = if (sendable) p.red else p.sunken,
                    sendInk = if (sendable) p.accentInk else p.ink3,
                    sendEnabled = sendable && !messaging.sending,
                    onSend = send,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                )
            }
            ChatGrabber(Modifier.align(Alignment.TopCenter))
            // Seventy-eight up, where iOS's toast window puts it away from a
            // table — clear of the message box, not on top of it.
            ChatToastPill(
                text = toast?.first,
                isError = toast?.second == true,
                modifier = Modifier.align(Alignment.BottomCenter),
                bottom = 78.dp,
            )
        }
    }
}

/**
 * One line, on its own side of the screen, with fifty points kept clear on
 * the other so a long one still says whose it is. A long-press on one of
 * theirs reports it as it was written — the quote is the line pressed, not
 * the last.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun Bubble(
    msg: DMessage,
    isMine: Boolean,
    target: SafetyTarget,
    onReport: (SafetyTarget, ReportReason) -> Unit,
) {
    val p = P.current
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = if (isMine) 50.dp else 0.dp, end = if (isMine) 0.dp else 50.dp),
        horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start,
    ) {
        Box {
            Text(
                msg.text,
                color = if (isMine) p.accentInk else p.ink,
                fontSize = 14.5.sp,
                // The rounded face's own leading, about 1.2 of the size.
                lineHeight = 17.5.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .clip(RoundedCornerShape(15.dp))
                    .background(if (isMine) p.red else p.card)
                    .combinedClickable(
                        enabled = !isMine,
                        onClick = {},
                        onLongClick = { Haptics.tap(); menu = true },
                    )
                    .padding(horizontal = 13.dp, vertical = 8.dp),
            )
            if (!isMine) {
                ChatSafetyMenu(
                    expanded = menu,
                    onDismiss = { menu = false },
                    targets = listOf(target),
                    onReport = onReport,
                )
            }
        }
    }
}
