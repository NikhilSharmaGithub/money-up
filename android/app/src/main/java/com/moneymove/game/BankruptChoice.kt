package com.moneymove.game

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * "You're bankrupt — what happens to your streets?" (1.0.7, H2).
 *
 * At a "player decides" table the server holds the whole game still while a
 * bankrupt player answers, and gives them twenty seconds to do it. On their
 * own phone that is this: the table out of focus behind a question, their
 * deeds listed so they can see what they are giving away, the two answers as
 * big tiles, and a ring running down to the moment the house answers for
 * them. Everybody else at the table sees who is deciding instead — the
 * centre well's [DecidingCard] and the dock's [DecidingRow].
 *
 * It answers on the bankrupt seat's own connection (a pass & play guest's
 * too), and it goes the moment the server clears the question — the next
 * push after the answer lands, or the house's answer at the buzzer. A
 * refused answer leaves the question open, so after a beat the tiles take a
 * second tap again.
 *
 * Nothing else may sit over it: the store closes any sheet or question that
 * was open when it arrived (GameStore.noteEstates), and the back gesture is
 * swallowed while it is up, so a stray swipe does not ask about leaving in
 * the middle of a twenty-second answer.
 */
@Composable
fun BankruptChoiceOverlay(store: GameStore, modifier: Modifier = Modifier) {
    val shown = store.myBankruptChoice
    // Held for the way out, so the card fades with its words still on it.
    var last by remember { mutableStateOf<BankruptChoice?>(null) }
    SideEffect { if (shown != null) last = shown }
    val choice = shown ?: last
    AnimatedVisibility(visible = shown != null, modifier = modifier, enter = fadeIn(), exit = fadeOut()) {
        choice?.let { BankruptPrompt(store, it, live = shown != null) }
    }
}

@Composable
private fun BankruptPrompt(store: GameStore, choice: BankruptChoice, live: Boolean) {
    val p = P.current
    val shape = MMShapes.r22
    val surface = rememberGlassSurface(BackdropKind.Sheet)
    BackHandler(enabled = live) {}

    // The answer on its way. A refusal leaves the question standing, so the
    // tiles come back after a moment rather than staying dead.
    var sent by remember(choice.playerId, choice.endsAt) { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(sent) {
        if (sent != null) {
            delay(2_500)
            sent = null
        }
    }

    // The card arrives as the app's other full-screen questions do, from a
    // little small on a firm spring, while the scrim only fades.
    val reduceMotion = rememberReduceMotion()
    val grow = remember { Animatable(if (reduceMotion) 1f else 0.9f) }
    LaunchedEffect(Unit) { grow.animateTo(1f, spring(dampingRatio = 0.85f, stiffness = 340f)) }

    val mine = choice.playerId == store.meId
    val left = secondsLeftOf(choice.endsAt)

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = promptScrim()))
            // The scrim keeps the table out of reach, not just out of sight.
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp, vertical = 24.dp)
                .widthIn(max = 420.dp)
                .fillMaxWidth()
                .graphicsLayer {
                    scaleX = grow.value
                    scaleY = grow.value
                }
                .background(p.sheet, shape)
                .mmGlass(backdrop = BackdropKind.Sheet, shape = shape, lens = false)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OnGlass(surface) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    val g = P.current
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f).padding(start = 4.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                OctagonCross(13.dp, p.bad)
                                Text(
                                    if (mine) "YOU'RE BANKRUPT" else "${choice.name.uppercase()} IS BANKRUPT",
                                    color = p.bad, fontSize = 11.sp, fontWeight = FontWeight.Black, letterSpacing = 1.4.sp,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Text(
                                "What happens to ${if (mine) choice.yourStreets else choice.theirStreets}?",
                                modifier = Modifier.semantics { heading() },
                                color = g.ink, fontSize = 20.sp, lineHeight = 24.sp, fontWeight = FontWeight.Black,
                            )
                        }
                        Spacer(Modifier.size(10.dp))
                        CountdownRing(
                            choice.endsAt, BANKRUPT_CHOICE_SECONDS, size = 50.dp, stroke = 4.5.dp,
                            track = LocalGlassHost.current?.well() ?: g.sunken,
                        )
                    }
                    OnPaper {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            EstateList(store, choice.properties, maxHeight = 200.dp)
                            EstateAnswerTiles(enabled = live && sent == null) { auction ->
                                sent = auction
                                store.answerBankruptChoice(auction)
                            }
                        }
                    }
                    Text(
                        when {
                            sent == true -> "Putting them up for auction…"
                            sent == false -> "Giving them back to the bank…"
                            left == null || left > 0 ->
                                "Answer${left?.let { " in ${it}s" } ?: ""}, or the house decides for ${if (mine) "you" else "them"}."
                            else -> "The house is deciding…"
                        },
                        modifier = Modifier.fillMaxWidth(),
                        color = g.ink2, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

/** How long the server gives a bankrupt player to answer (BANKRUPT_CHOICE in server/game.js). */
internal const val BANKRUPT_CHOICE_SECONDS = 20.0

/** Whole seconds left before [endsAt], ticking, or null when there is no clock. */
@Composable
private fun secondsLeftOf(endsAt: Double?): Int? = endsAt?.let { rememberSecondsLeft(it) }

/**
 * The prompt's scrim. With the table blurred behind it (API 31 on, and the
 * glass not turned down) half the black is enough to say it is out of
 * reach; with no blur the black does the whole job.
 */
@Composable
private fun promptScrim(): Float {
    val blurred = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S &&
        LocalGlassLevel.current != GlassLevel.Opaque
    return if (blurred) 0.3f else 0.6f
}

// ── what everybody else sees ───────────────────────────────────────────────

/**
 * Somebody else is deciding, in the middle of the board: their face inside
 * the ring that runs down to the house's answer, the sentence the contract
 * gives everyone else — "Ravi is deciding what happens to their streets…" —
 * and the deeds in question as a row of their marks, so the table can see
 * what is about to go under the hammer or back to the bank.
 */
@Composable
internal fun DecidingCard(store: GameStore, choice: BankruptChoice, compact: Boolean, modifier: Modifier = Modifier) {
    val p = P.current
    val who = store.state?.player(choice.playerId)
    val shape = MMShapes.r18
    val left = secondsLeftOf(choice.endsAt)
    Column(
        modifier
            .widthIn(max = 340.dp)
            .fillMaxWidth()
            .padding(horizontal = 6.dp)
            .shadow(12.dp, shape, clip = false)
            .background(p.card, shape)
            .border(1.dp, p.rule, shape)
            .padding(horizontal = 14.dp, vertical = if (compact) 10.dp else 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 8.dp),
    ) {
        val ring = if (compact) 46.dp else 56.dp
        CountdownRing(choice.endsAt, BANKRUPT_CHOICE_SECONDS, size = ring, stroke = 4.dp) {
            if (who != null) {
                AvatarDisc(who.name, who.color, size = ring - 14.dp, avatar = who.avatar)
            } else {
                AvatarDisc(choice.name, null, size = ring - 14.dp)
            }
        }
        Text(
            choice.decidingLine,
            color = p.ink, fontSize = if (compact) 13.sp else 14.sp, fontWeight = FontWeight.ExtraBold,
            textAlign = TextAlign.Center, lineHeight = if (compact) 17.sp else 18.sp,
        )
        Text(
            buildString {
                append(if (choice.properties.size == 1) "1 property" else "${choice.properties.size} properties")
                append(" · bank or auction")
                if (left != null) append(" · ${left}s")
            },
            color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center, maxLines = 1,
        )
        LotMarks(store, choice.properties, if (compact) 5 else 8)
    }
}

/** A row of deed marks, as many as fit the [room], then "+N". */
@Composable
private fun LotMarks(store: GameStore, tiles: List<Int>, room: Int) {
    val p = P.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (i in tiles.take(room)) {
            val tile = store.tile(i)
            LotBadge(tile, tile?.let { store.groupInfo(it) }, 18.dp)
        }
        if (tiles.size > room) {
            Text("+${tiles.size - room}", color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold)
        }
    }
}

/**
 * The dock's line while somebody else decides: their face in the running
 * ring, and the same sentence the well says. It stands where "Asha is
 * playing…" would — that turn is waiting on this answer.
 */
@Composable
internal fun DecidingRow(store: GameStore, choice: BankruptChoice) {
    val p = P.current
    val who = store.state?.player(choice.playerId)
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        CountdownRing(choice.endsAt, BANKRUPT_CHOICE_SECONDS, size = 32.dp, stroke = 3.dp) {
            AvatarDisc(choice.name, who?.color, size = 24.dp, avatar = who?.avatar)
        }
        Text(
            choice.decidingLine,
            modifier = Modifier.weight(1f),
            color = p.ink2, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold,
        )
    }
}

// ── the copy the dialogs share ─────────────────────────────────────────────

/**
 * What going out does with a seat's streets at this table, as the second
 * half of a "Declare bankruptcy?" or "Give up?" sentence. The creditor of a
 * bankruptcy only ever keeps the cash already paid — the deeds never go to
 * them — so no sentence here says otherwise.
 */
internal fun streetsGoLine(rule: EstateRule): String = when (rule) {
    EstateRule.RELEASE -> "Your properties go back to the bank."
    EstateRule.AUCTION -> "Your properties are auctioned to everyone, one at a time."
    EstateRule.CHOOSE -> "You'll be asked what happens to your properties."
}

/**
 * The plain "Declare bankruptcy?" sentence: where the streets go, then that
 * the player is out. A seat holding no deeds has no streets to send anywhere
 * — and at a "player decides" table is never asked, the server only asks
 * when there is a lot to decide about — so it is told only that it is out.
 */
internal fun bankruptOutLine(rule: EstateRule, owned: Int): String =
    if (owned > 0) "${streetsGoLine(rule)} You are out of the game." else "You are out of the game."

/**
 * The body of a bankruptcy question at a "player decides" table: the deeds
 * going, then the two answers, which are the confirmation — there is no
 * separate "Go bankrupt" to press first. Paper on the dialog's glass.
 */
@Composable
internal fun EstateChoiceBody(store: GameStore, deeds: List<Int>, onAnswer: (auction: Boolean) -> Unit) {
    OnPaper {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (deeds.isNotEmpty()) EstateList(store, deeds, maxHeight = 164.dp)
            EstateAnswerTiles(onAnswer = onAnswer)
        }
    }
}

/** "your 3 properties" / "their property", for the dialogs. */
internal fun propertiesPhrase(count: Int, yours: Boolean): String {
    val whose = if (yours) "your" else "their"
    return if (count == 1) "$whose property" else "$whose $count properties"
}
