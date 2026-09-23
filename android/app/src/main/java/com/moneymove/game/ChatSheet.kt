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
 * The table's chat.
 *
 * Four people round a board talk, and a game where nobody notices the chat is
 * a game where nobody uses it — which is why the button that opens this keeps
 * a count of what has been said since it was last looked at, and why opening
 * it clears that count rather than some later scroll.
 *
 * Lines from a blocked player are dropped here rather than greyed: the point
 * of blocking somebody is not to be shown a box where their words were.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatSheet(store: GameStore, onDismiss: () -> Unit) {
    val p = P.current
    val state = store.state ?: return onDismiss()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val listState = rememberLazyListState()
    var draft by remember { mutableStateOf("") }

    val lines = remember(state.chat, store.blockedCodes) {
        state.chat.filter { it.code == null || it.code !in store.blockedCodes }
    }

    // Opening it is what "I have read this" means.
    LaunchedEffect(Unit) { store.markChatRead() }
    LaunchedEffect(lines.size) {
        if (lines.isNotEmpty()) listState.animateScrollToItem(lines.lastIndex)
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
                Icon("chat", size = 18.dp, tint = p.red)
                Spacer(Modifier.width(8.dp))
                Text("Table chat", color = p.ink, fontSize = 18.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.weight(1f))
                MMButton("Close", kind = BtnKind.GHOST) { onDismiss() }
            }
            Spacer(Modifier.height(10.dp))

            if (lines.isEmpty()) {
                Box(
                    Modifier.fillMaxWidth().heightIn(min = 160.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Hint("Nobody has said anything yet.")
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp, max = 380.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(lines.size) { i -> ChatLine(lines[i], store) }
                }
            }

            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    BasicTextField(
                        value = draft,
                        onValueChange = { draft = it.take(140) },
                        singleLine = true,
                        textStyle = TextStyle(color = p.ink, fontSize = 15.sp),
                        cursorBrush = SolidColor(p.red),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = {
                            if (draft.isNotBlank()) { store.sendChat(draft.trim()); draft = "" }
                        }),
                        decorationBox = { inner ->
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(p.sunken)
                                    .padding(horizontal = 13.dp, vertical = 12.dp),
                            ) {
                                if (draft.isEmpty()) {
                                    Text("Say something…", color = p.ink3, fontSize = 15.sp)
                                }
                                inner()
                            }
                        },
                    )
                }
                Spacer(Modifier.width(8.dp))
                MMButton("Send", kind = BtnKind.PRIMARY, enabled = draft.isNotBlank()) {
                    store.sendChat(draft.trim())
                    draft = ""
                }
            }
        }
    }
}

@Composable
private fun ChatLine(line: ChatMessage, store: GameStore) {
    val p = P.current
    val mine = line.name == store.nickname.ifBlank { "Player" }
    Row(verticalAlignment = Alignment.Top) {
        Box(
            Modifier
                .size(26.dp)
                .clip(RoundedCornerShape(99.dp))
                .background(cssColor(line.color, p.red)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                (line.name.firstOrNull() ?: '?').uppercase(),
                color = androidx.compose.ui.graphics.Color.White,
                fontSize = 12.sp, fontWeight = FontWeight.Black,
            )
        }
        Spacer(Modifier.width(9.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (mine) "You" else line.name,
                    color = cssColor(line.color, p.ink),
                    fontSize = 12.5.sp, fontWeight = FontWeight.Bold,
                )
                if (line.isTeam) {
                    Spacer(Modifier.width(6.dp))
                    Chip("team", tint = p.ink3)
                }
            }
            Text(
                line.text,
                color = p.ink, fontSize = 14.5.sp, lineHeight = 20.sp,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}
