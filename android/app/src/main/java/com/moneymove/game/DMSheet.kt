package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * A conversation with one friend.
 *
 * Friends only, and the screen says so before anybody types rather than after.
 * The server refuses a message to anyone who is not on your friends list, and
 * it refuses it with a 400 whose sentence this client never gets to read — so
 * the gate is the friends list itself, which is the same list the server
 * checks. Somebody who has been unfriended, or blocked in either direction,
 * gets a line explaining it where the box would have been, instead of typing
 * a paragraph into something that was never going to send it.
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
    onDismiss: () -> Unit,
) {
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val listState = rememberLazyListState()
    var draft by remember { mutableStateOf("") }
    var reporting by remember { mutableStateOf(false) }

    LaunchedEffect(friend.code) { messaging.openThread(friend.code) }
    // The gate below is only as fresh as this list, and a thread is usually
    // opened minutes after the tab that loaded it.
    LaunchedEffect(Unit) { account.refreshSocial() }
    DisposableEffect(Unit) { onDispose { messaging.closeThread() } }

    val friends = account.social?.friends
    // A list that has not arrived yet is not evidence of anything. Locking the
    // box on a null would mean every cold open of this sheet accusing two
    // friends of not being friends.
    val canMessage = friends == null || friends.any { it.code == friend.code }

    val thread = messaging.thread
    LaunchedEffect(thread.size) {
        if (thread.isNotEmpty()) listState.animateScrollToItem(thread.lastIndex)
    }

    val mine = messaging.myCode.ifBlank { account.me?.code.orEmpty() }
    val lastFromThem = thread.lastOrNull { it.from != mine && it.from.isNotBlank() }?.text.orEmpty()

    // The Send button and the keyboard's own send key are the same act, so
    // they are the same lambda; two copies of this drift apart on the first
    // change to either of them.
    val send: () -> Unit = {
        val text = draft.trim()
        if (text.isNotEmpty() && !messaging.sending) {
            draft = ""
            SoundKit.click()
            Haptics.tap()
            messaging.send(friend.code, text) { ok ->
                if (!ok) {
                    // A refused message goes back in the box rather than being
                    // swallowed, unless something has been typed since — losing
                    // a sentence somebody wrote is worse than the flicker.
                    if (draft.isEmpty()) draft = text
                    // And the reason is in the friends list: the server's own
                    // "You can only message friends" comes back on a 400 whose
                    // body never reaches this client.
                    account.refreshSocial()
                }
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.sheet,
        dragHandle = null,
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 18.dp)) {
            Spacer(Modifier.height(14.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                FriendDisc(friend.name)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        listOfNotNull(friend.flag.takeIf { it.isNotBlank() }, friend.name.ifBlank { friend.code })
                            .joinToString(" "),
                        color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.Black,
                    )
                    Hint(
                        when {
                            friend.room != null -> "At a table right now"
                            friend.online -> "Online"
                            else -> friend.code
                        },
                    )
                }
                MMButton("Close", kind = BtnKind.GHOST) { onDismiss() }
            }
            Spacer(Modifier.height(12.dp))

            if (thread.isEmpty()) {
                Box(
                    Modifier.fillMaxWidth().heightIn(min = 180.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon("chat", size = 26.dp, tint = p.ink3)
                        Spacer(Modifier.height(7.dp))
                        Hint("Say hi.")
                    }
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 180.dp, max = 380.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    items(thread.size) { i -> Bubble(thread[i], isMine = thread[i].from == mine) }
                }
            }

            // Report and block are one flow and it lives in SafetySheets.kt.
            // A second copy in here would be a second place to keep the
            // server's list of reasons in step with the server's list.
            //
            // Offered only once they have actually said something: there is
            // nothing to report until then, and getting rid of somebody who
            // has never written a word is a job for the friends list.
            if (lastFromThem.isNotBlank()) {
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                    MMButton("Report or block", kind = BtnKind.GHOST) { reporting = true }
                }
            }

            Spacer(Modifier.height(10.dp))

            if (!canMessage) {
                Panel(padding = 12.dp) {
                    SectionLabel("Friends only", icon = "people")
                    Spacer(Modifier.height(7.dp))
                    Hint(
                        "You can only message friends. ${friend.name.ifBlank { friend.code }} is not on " +
                            "your friends list any more — add them back from Social and everything said " +
                            "here is still here.",
                    )
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) {
                        BasicTextField(
                            value = draft,
                            // The server slices at 300 and the end of a longer
                            // sentence would just vanish on the way.
                            onValueChange = { draft = it.take(300) },
                            singleLine = true,
                            textStyle = TextStyle(color = p.ink, fontSize = 15.sp),
                            cursorBrush = SolidColor(p.red),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                            keyboardActions = KeyboardActions(onSend = { send() }),
                            decorationBox = { inner ->
                                Box(
                                    Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(p.sunken)
                                        .padding(horizontal = 13.dp, vertical = 12.dp),
                                ) {
                                    if (draft.isEmpty()) {
                                        Text(
                                            "Message ${friend.name.ifBlank { "them" }}…",
                                            color = p.ink3, fontSize = 15.sp,
                                        )
                                    }
                                    inner()
                                }
                            },
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                    MMButton(
                        "Send",
                        kind = BtnKind.PRIMARY,
                        enabled = draft.isNotBlank() && !messaging.sending,
                    ) {
                        send()
                    }
                }
                messaging.sendError?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, color = p.bad, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }

    // Raised beside this sheet rather than inside its content: a sheet
    // composed within another sheet's window is a window fighting the one it
    // is drawn in, which is the trap SafetySheets.kt was written around.
    if (reporting) {
        ReportSheet(
            code = friend.code,
            name = friend.name.ifBlank { friend.code },
            // One of the four places the server files a report under; it
            // records anything else as "other".
            place = "dm",
            quote = lastFromThem,
            onBlocked = {
                // Blocking takes the friendship apart on both sides, so there
                // is no thread left to sit in.
                reporting = false
                onDismiss()
            },
            onDismiss = { reporting = false },
        )
    }
}

/** One line, on its own side of the screen. */
@Composable
private fun Bubble(msg: DMessage, isMine: Boolean) {
    val p = P.current
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start,
    ) {
        Text(
            msg.text,
            color = if (isMine) p.accentInk else p.ink,
            fontSize = 14.5.sp,
            lineHeight = 20.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier
                // A bubble that runs the full width is a bubble that no longer
                // says which side it is on.
                .widthIn(max = 260.dp)
                .clip(RoundedCornerShape(15.dp))
                .background(if (isMine) p.red else p.card)
                .padding(horizontal = 13.dp, vertical = 8.dp),
        )
    }
}

/** A disc with an initial, for somebody who is not at this table. */
@Composable
private fun FriendDisc(name: String) {
    val p = P.current
    Box(
        Modifier.size(34.dp).clip(RoundedCornerShape(99.dp)).background(p.sunken)
            .border(1.dp, p.rule, RoundedCornerShape(99.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            (name.firstOrNull() ?: '?').uppercase(),
            color = p.ink2, fontSize = 15.sp, fontWeight = FontWeight.Black,
        )
    }
}
