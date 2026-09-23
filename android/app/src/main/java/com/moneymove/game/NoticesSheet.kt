package com.moneymove.game

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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

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
 * The bell, for a top bar. [count] is `messaging.unread`.
 *
 * There is no bell in the shared glyph set, and drawing one only for Android
 * would put a picture on this client that the browser and the iPhone do not
 * have. The ticket is the closest thing in the set that still takes the ink
 * it is given — which matters more than the shape does, because a glyph with
 * a colour of its own could not go quiet, and a bell that is gold whether or
 * not anything is waiting is a bell nobody looks at twice.
 */
@Composable
fun NoticeBell(count: Int, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val p = P.current
    val waiting = count > 0
    Box(
        modifier
            .size(40.dp)
            .clip(RoundedCornerShape(99.dp))
            .clickable {
                SoundKit.click()
                onClick()
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(38.dp)
                .clip(RoundedCornerShape(99.dp))
                .background(p.sunken)
                .border(1.dp, if (waiting) p.gold else p.rule, RoundedCornerShape(99.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon("ticket", size = 18.dp, tint = if (waiting) p.gold else p.ink3)
        }
        if (waiting) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = (-1).dp, y = 1.dp)
                    .size(17.dp)
                    .clip(RoundedCornerShape(99.dp))
                    .background(p.red),
                contentAlignment = Alignment.Center,
            ) {
                // Past nine the exact number stops being information and the
                // digits stop fitting.
                Text(
                    if (count > 9) "9+" else "$count",
                    color = p.accentInk, fontSize = 9.sp, fontWeight = FontWeight.Black,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoticesSheet(messaging: MessagingStore, onDismiss: () -> Unit) {
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    LaunchedEffect(Unit) {
        messaging.refreshNotices()
        // Opening the list is reading it — but the dots are the only thing
        // that says which notes were new, so they get a moment to be seen
        // before the count is given up.
        delay(1_200)
        messaging.markNoticesRead()
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
                Icon("ticket", size = 18.dp, tint = p.red)
                Spacer(Modifier.width(8.dp))
                Text("Notes", color = p.ink, fontSize = 18.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.weight(1f))
                MMButton("Close", kind = BtnKind.GHOST) { onDismiss() }
            }
            Spacer(Modifier.height(12.dp))

            val notices = messaging.notices
            if (notices.isEmpty()) {
                Box(
                    Modifier.fillMaxWidth().heightIn(min = 200.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(
                        Modifier.padding(horizontal = 24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon("ticket", size = 26.dp, tint = p.ink3)
                        Spacer(Modifier.height(9.dp))
                        Text(
                            "Nothing yet",
                            color = p.ink2, fontSize = 15.sp, fontWeight = FontWeight.Black,
                        )
                        Spacer(Modifier.height(5.dp))
                        Hint(
                            "Announcements about tournaments — when a round opens, when a prize " +
                                "is on its way — turn up here.",
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().heightIn(min = 200.dp, max = 460.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(notices.size) { i -> NoticeRow(notices[i]) }
                }
            }
        }
    }
}

@Composable
private fun NoticeRow(n: Notice) {
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
    ) {
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
                Text(n.title, color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.Black)
            }
            Spacer(Modifier.weight(1f))
            if (n.unread) {
                Box(Modifier.size(8.dp).clip(RoundedCornerShape(99.dp)).background(p.red))
            }
        }
        if (n.personal || n.title.isNotBlank()) Spacer(Modifier.height(6.dp))
        Text(
            n.text,
            color = p.ink2, fontSize = 13.5.sp, lineHeight = 19.sp,
            fontWeight = FontWeight.Medium,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            whenSaid(n.at),
            color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
        )
    }
}

/**
 * When it was written, in the shortest form that is still true.
 *
 * A note is usually read minutes after it lands, and "14:32" makes somebody
 * work out for themselves whether that was today. Anything older than a week
 * has stopped being news and gets a date instead.
 */
private fun whenSaid(at: Double): String {
    val ms = at.toLong()
    if (ms <= 0L) return ""
    val gap = System.currentTimeMillis() - ms
    return when {
        gap < 60_000L -> "just now"
        gap < 3_600_000L -> "${gap / 60_000L}m ago"
        gap < 86_400_000L -> "${gap / 3_600_000L}h ago"
        gap < 7L * 86_400_000L -> "${gap / 86_400_000L}d ago"
        else -> SimpleDateFormat("d MMM", Locale.getDefault()).format(Date(ms))
    }
}
