package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Where a game starts.
 *
 * Three doors, in the order people actually use them: straight into a table
 * with whoever else is playing, a private table of your own, or a code
 * somebody sent you. Everything else on this screen is there to make the
 * first of those feel like the obvious one.
 */
@Composable
fun PlayTab(store: GameStore) {
    val p = P.current
    val scope = rememberCoroutineScopeCompat()
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Wordmark()
        Spacer(Modifier.height(4.dp))
        Text(
            "Buy streets. Build hotels. Bankrupt your friends.",
            color = p.ink2, fontSize = 13.5.sp, fontWeight = FontWeight.Medium,
        )
        Spacer(Modifier.height(18.dp))

        Panel {
            SectionLabel("Your nickname")
            Spacer(Modifier.height(8.dp))
            NameField(store)
        }

        Spacer(Modifier.height(12.dp))

        Panel {
            MMButton(
                "Play now",
                kind = BtnKind.PRIMARY, big = true, icon = "people",
                modifier = Modifier.fillMaxWidth(), enabled = !busy,
            ) {
                busy = true
                scope.launch {
                    val room = store.quickplay()
                    busy = false
                    if (room != null) store.connect(room)
                    else store.showToast("Could not reach the game server", isError = true)
                }
            }
            Spacer(Modifier.height(8.dp))
            Hint("Straight into a game with whoever else is playing right now.")
        }

        Spacer(Modifier.height(12.dp))

        Panel {
            MMButton(
                "Create a private game",
                kind = BtnKind.GHOST, big = true, icon = "dice",
                modifier = Modifier.fillMaxWidth(), enabled = !busy,
            ) {
                busy = true
                scope.launch {
                    val room = store.createRoom()
                    busy = false
                    if (room != null) store.connect(room)
                    else store.showToast("Could not reach the game server", isError = true)
                }
            }
            Spacer(Modifier.height(14.dp))
            SectionLabel("or join with a code")
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { CodeField(code) { code = it } }
                Spacer(Modifier.width(8.dp))
                MMButton("Join", kind = BtnKind.GOLD, enabled = code.isNotBlank()) {
                    store.connect(code.trim())
                }
            }
        }

        if (store.prefs.lastRoom.isNotBlank()) {
            Spacer(Modifier.height(12.dp))
            Panel {
                SectionLabel("Continue", icon = "door")
                Spacer(Modifier.height(8.dp))
                Text(
                    "Room ${store.prefs.lastRoom}",
                    color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(4.dp))
                Hint("The table held your seat — a bot played it while you were away.")
                Spacer(Modifier.height(10.dp))
                MMButton("Back to the table", kind = BtnKind.GHOST, modifier = Modifier.fillMaxWidth()) {
                    store.connect(store.prefs.lastRoom)
                }
            }
        }

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun Wordmark() {
    val p = P.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon("dice", size = 26.dp, tint = p.red)
        Spacer(Modifier.width(8.dp))
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = p.ink)) { append("MONEY") }
                withStyle(SpanStyle(color = p.red)) { append("MOVE") }
            },
            fontSize = 27.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = (-0.5).sp,
        )
    }
}

@Composable
private fun NameField(store: GameStore) {
    val p = P.current
    BasicTextField(
        value = store.nickname,
        onValueChange = { store.nickname = it.take(20); store.prefs.nickname = store.nickname },
        singleLine = true,
        textStyle = TextStyle(color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
        cursorBrush = androidx.compose.ui.graphics.SolidColor(p.red),
        decorationBox = { inner ->
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(p.sunken)
                    .padding(horizontal = 14.dp, vertical = 13.dp),
            ) {
                if (store.nickname.isEmpty()) {
                    Text("Player", color = p.ink3, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
                inner()
            }
        },
    )
}

@Composable
private fun CodeField(value: String, onChange: (String) -> Unit) {
    val p = P.current
    BasicTextField(
        value = value,
        onValueChange = { onChange(it.lowercase().filter(Char::isLetterOrDigit).take(12)) },
        singleLine = true,
        textStyle = TextStyle(
            color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.Bold,
            letterSpacing = 2.sp,
        ),
        cursorBrush = androidx.compose.ui.graphics.SolidColor(p.red),
        decorationBox = { inner ->
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(p.sunken)
                    .padding(horizontal = 14.dp, vertical = 13.dp),
            ) {
                if (value.isEmpty()) {
                    Text("room code", color = p.ink3, fontSize = 15.sp, letterSpacing = 2.sp)
                }
                inner()
            }
        },
    )
}

@Composable
private fun rememberCoroutineScopeCompat() = androidx.compose.runtime.rememberCoroutineScope()
