package com.moneymove.game

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The six cards somebody who has never been here reads once.
 *
 * Six, and skippable from the first one, because the alternative — dropping a
 * stranger onto a board with eight buttons on it — is how a game loses the
 * people who would have liked it. It is not a tutorial: nothing here teaches
 * a rule, because the rules are learned by playing. It says what the game is,
 * what the app is for, and then gets out of the way.
 */
private data class Card(val icon: String, val title: String, val body: String)

private val CARDS = listOf(
    Card(
        "globe", "Welcome to MoneyMove",
        "Buy streets. Build hotels. Bankrupt your friends. Two to eight players, on one screen or across the world.",
    ),
    Card(
        "people", "Play with anyone",
        "One tap drops you at a table with whoever else is playing. Or make a private room and send the code to your friends.",
    ),
    Card(
        "map", "Nineteen boards",
        "A world tour, single countries, and a few odd ones. Two are free every day, and any of them can be rented for a coin.",
    ),
    Card(
        "dice", "A game runs about half an hour",
        "Everybody gets ninety seconds a turn. Miss one and the house plays it for you — miss two in a row and the table moves on.",
    ),
    Card(
        "coin", "Coins are style, never advantage",
        "Win games and collect the daily reward. Spend it on a piece to push round the board, never on a better position.",
    ),
    Card(
        "chat", "Say something",
        "Every table has a chat, and the house players answer. Anybody can be blocked or reported, from the line they wrote.",
    ),
)

@Composable
fun WelcomeIntro(onDone: () -> Unit) {
    val p = P.current
    var page by remember { mutableIntStateOf(0) }
    val card = CARDS[page]

    Box(
        Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.72f)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .padding(horizontal = 26.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(p.sheet)
                .border(1.dp, p.rule2, RoundedCornerShape(22.dp))
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(Modifier.fillMaxWidth()) {
                Spacer(Modifier.weight(1f))
                // Skippable from the first card: somebody who already knows
                // the game should not have to tap through six of these.
                Text(
                    "Skip",
                    color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.clickable { onDone() }.padding(4.dp),
                )
            }
            Spacer(Modifier.height(6.dp))
            Box(
                Modifier.size(64.dp).clip(RoundedCornerShape(99.dp)).background(p.sunken),
                contentAlignment = Alignment.Center,
            ) {
                Icon(card.icon, size = 30.dp, tint = p.red)
            }
            Spacer(Modifier.height(16.dp))
            Text(
                card.title,
                color = p.ink, fontSize = 20.sp, fontWeight = FontWeight.Black,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                card.body,
                color = p.ink2, fontSize = 14.sp, lineHeight = 21.sp,
                fontWeight = FontWeight.Medium, textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (i in CARDS.indices) {
                    Box(
                        Modifier
                            .size(if (i == page) 20.dp else 7.dp, 7.dp)
                            .clip(RoundedCornerShape(99.dp))
                            .background(if (i == page) p.red else p.rule2),
                    )
                }
            }
            Spacer(Modifier.height(18.dp))
            MMButton(
                if (page == CARDS.lastIndex) "Let's play" else "Next",
                kind = BtnKind.PRIMARY, big = true,
                modifier = Modifier.fillMaxWidth(),
            ) {
                SoundKit.click()
                if (page == CARDS.lastIndex) onDone() else page++
            }
        }
    }
}

/**
 * The rules, for somebody in the middle of a game who has just met one.
 *
 * Written as answers to the questions people actually ask at a table, in the
 * order they ask them — not as a rulebook, which nobody opens twice.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HowToPlaySheet(onDismiss: () -> Unit) {
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val sections = listOf(
        "How do I win?" to
            "Everybody else goes bankrupt. Your net worth is cash plus what your streets and buildings are worth.",
        "When can I build?" to
            "Once you own every street of one colour. Houses go up across the country together — four on one street and none on the others is not allowed unless even build is switched off.",
        "What does a full country do?" to
            "Bare rent doubles the moment you hold all of it, before you build anything.",
        "How do I get out of prison?" to
            "Roll a double, use a card, or pay $50 — but the fine buys the door and nothing else. You do not roll that turn.",
        "What happens if nobody buys a street?" to
            "It goes to auction, and anybody can bid. The winner pays whatever they bid, which can be less than the price.",
        "What is a mortgage?" to
            "Half the price of a street, in cash, now. Buying it back costs ten percent more, and a mortgaged street collects no rent.",
        "Why can I not trade this street?" to
            "Streets with buildings on them cannot be traded. Sell the buildings first.",
        "What is the clock for?" to
            "Ninety seconds a turn, so nobody waits on an empty chair. Miss one and the house plays that turn for you; miss two in a row and your seat goes.",
    )

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
                Icon("bulb", size = 20.dp)
                Spacer(Modifier.width(8.dp))
                Text("How to play", color = p.ink, fontSize = 19.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.weight(1f))
                MMButton("Done", kind = BtnKind.GHOST) { onDismiss() }
            }
            Spacer(Modifier.height(14.dp))
            for ((q, a) in sections) {
                Column(Modifier.fillMaxWidth().padding(vertical = 9.dp)) {
                    Text(q, color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        a,
                        color = p.ink2, fontSize = 13.5.sp, lineHeight = 20.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
                Rule()
            }
        }
    }
}
