package com.moneymove.game

import android.text.format.DateFormat
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Notes from whoever runs the game.
 *
 * One way only: the owner writes, players read, nobody replies. It is here for
 * the two things a tournament needs a voice for — telling the field when the
 * next round opens, and telling a winner their prize is on its way — and being
 * one-way is the point, because somebody who is sent a note cannot be dragged
 * into a conversation they never asked for.
 *
 * A note written to one player is marked as such. "You won" reads very
 * differently from "everybody won", and the list must never blur the two.
 *
 * The bell and the list are separate composables on purpose: the count has to
 * be visible from a top bar long before anybody taps it, so it comes from
 * [MessagingStore]'s own poll rather than from this sheet having been opened.
 */

/**
 * The bell, for the top of the Social tab — iOS's NoticeBell. [count] is
 * `messaging.unread`.
 *
 * iOS draws its own bell here, the filled one, and the bell with a dot on it
 * once something is waiting; icons.js has no bell, so SafetySheets.kt draws
 * both on the glyph grid. Quiet ink with nothing waiting, gold with
 * something, and the count in a red coin off the top corner that stops at
 * nine, as iOS's does.
 *
 * No sound of its own: iOS's bell knocks through whoever hosts it, and the
 * Social tab does that.
 */
@Composable
fun NoticeBell(count: Int, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val p = P.current
    val waiting = count > 0
    Box(
        modifier
            .size(38.dp)
            .semantics { contentDescription = if (waiting) "$count unread notes" else "Notes" },
    ) {
        Box(
            Modifier
                .size(38.dp)
                .clip(CircleShape)
                .background(p.sunken)
                .border(1.dp, if (waiting) p.gold else p.rule, CircleShape)
                .clickable { onClick() },
            contentAlignment = Alignment.Center,
        ) {
            SfMark(if (waiting) "bell.badge.fill" else "bell.fill", 20.dp, if (waiting) p.gold else p.ink3)
        }
        if (waiting) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = 3.dp, y = (-2).dp)
                    .size(17.dp)
                    .clip(CircleShape)
                    .background(p.red),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "${count.coerceAtMost(9)}",
                    color = p.accentInk, fontSize = 10.sp, fontWeight = FontWeight.Black,
                )
            }
        }
    }
}

/**
 * The list — iOS's NoticesSheet: the full height of the screen on the
 * sheet's glass ([MMSheet]; iOS painted this one the page colour, and on
 * iOS 26 it is the system's glass too), "Notes" in the middle of the bar and
 * Done on the right, a card per note, and a bell with a line through it when
 * there are none.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoticesSheet(messaging: MessagingStore, onDismiss: () -> Unit) {
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val notices = messaging.notices

    fun close() {
        scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
    }

    // Reading it is reading it — but the dots stay up for a beat so somebody
    // can see which ones were new, then go, as iOS's do. The server is told
    // at the same moment; until the next poll brings the notes back unmarked
    // it is this that keeps the dots down.
    var read by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        // Waited on rather than fired and forgotten: marking a list read
        // before it has arrived says "seen" about notes nobody has been shown
        // yet, and the server stamps the moment it is told rather than
        // anything this app sends, so there is no taking it back.
        messaging.refreshNotices().join()
        delay(1_200)
        messaging.markNoticesRead()
        read = true
    }

    MMSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight()) {
            NotesBar { close() }
            if (notices.isEmpty()) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 30.dp)
                        .padding(top = 70.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(9.dp),
                ) {
                    // The empty state stands straight on the sheet's glass,
                    // so it takes the glass's quiet ink rather than ink3.
                    SfMark("bell.slash", 32.dp, quietInk())
                    Text(
                        "Nothing yet",
                        color = p.ink2, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold,
                    )
                    Text(
                        "Announcements about tournaments — when a round opens, when a prize " +
                            "is on its way — turn up here.",
                        color = quietInk(), fontSize = 12.5.sp, lineHeight = 17.sp,
                        fontWeight = FontWeight.Medium, textAlign = TextAlign.Center,
                    )
                }
            } else {
                val list = rememberLazyListState()
                LazyColumn(
                    state = list,
                    // The notes fade out under the bar rather than slicing off.
                    modifier = Modifier.fillMaxWidth().weight(1f).scrollEdge(list),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(notices) { n ->
                        NoticeRow(n, isNew = n.unread && !read)
                    }
                }
            }
        }
    }
}

/**
 * iOS's inline bar: "Notes" in the middle, Done on the right in the accent —
 * regular weight, as iOS's trailing toolbar button is.
 */
@Composable
private fun NotesBar(onDone: () -> Unit) {
    val p = P.current
    Box(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 16.dp)) {
        Text(
            "Notes",
            color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.align(Alignment.Center),
        )
        Text(
            "Done",
            color = p.red, fontSize = 17.sp, fontWeight = FontWeight.Normal,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .clip(RoundedCornerShape(8.dp))
                .clickable { onDone() }
                .padding(horizontal = 4.dp, vertical = 6.dp),
        )
    }
}

@Composable
private fun NoticeRow(n: Notice, isNew: Boolean) {
    val p = P.current
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            // Gold for a note written to this player alone. Whoever reads it
            // should be able to tell, at a glance and from across the room,
            // that it is about them.
            .background(if (n.personal) p.goldSoft else p.sunken)
            .border(1.dp, if (n.personal) p.gold else p.rule, shape)
            .padding(13.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // The heading line is always there, as iOS's is, even when it holds
        // nothing but the space before the words.
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (n.personal) {
                Text(
                    "FOR YOU",
                    color = p.accentInk,
                    fontSize = 8.5.sp,
                    letterSpacing = 0.6.sp,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier
                        .clip(RoundedCornerShape(99.dp))
                        .background(p.gold)
                        .padding(horizontal = 7.dp, vertical = 2.dp),
                )
                Spacer(Modifier.width(7.dp))
            }
            if (n.title.isNotBlank()) {
                Text(
                    n.title,
                    color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier.weight(1f),
                )
            } else {
                Spacer(Modifier.weight(1f))
            }
            Spacer(Modifier.width(4.dp))
            if (isNew) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(p.red))
            }
        }
        Text(
            n.text,
            color = p.ink2, fontSize = 13.5.sp, lineHeight = 19.sp,
            fontWeight = FontWeight.Medium,
        )
        Text(
            whenWritten(n.at),
            color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
        )
    }
}

/**
 * When it was written, the way iOS writes it: the short weekday, the day and
 * the short month, and the time — "Thu, 25 Sep, 14:32" in the reader's own
 * locale's order, which is what `.dateTime` with those fields asks of the
 * phone. The clock is the one the phone's 24-hour switch picks, not the
 * locale's habit, as on iOS — the same rule the cup's times follow (see
 * [clockText]).
 */
@Composable
private fun whenWritten(at: Double): String {
    val twentyFour = DateFormat.is24HourFormat(LocalContext.current)
    if (at.toLong() <= 0L) return ""
    return clockText(at, "EEEdMMMjmm", twentyFour)
}
