package com.moneymove.game

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/**
 * Everything that involves other people: who you are to them, the cup if one
 * is running, and the people themselves.
 *
 * In iOS's order (LandingView.swift, socialTab): the title with the notes
 * bell beside it, then the account, because both things under it need one —
 * a cup will not take an entry it cannot pay, and a friend code belongs to an
 * account — then the cup, then Friends.
 *
 * Friends is a summary and a door, as it is on iOS: the count, who is on, any
 * request waiting, and your code, with the room itself one tap away. The list
 * used to be laid straight onto this page, which is fine for two friends and
 * unreadable for twenty, and it put the two things people come here for —
 * handing out their code and getting into a friend's game — under everything
 * else. A message thread opens over the friends room the way iOS stacks its
 * DM sheet on the Friends sheet: raised beside it, not inside it, which is
 * how the chat raises its report sheet too.
 */
@Composable
fun SocialTab(
    account: AccountStore,
    game: GameStore,
    messaging: MessagingStore,
    onNotices: () -> Unit = {},
) {
    // The account's POST, so a refusal ("You have sent a lot of reports
    // today") reaches the player in the server's words.
    val safety = remember(account) { account.safety() }
    var friendsOpen by remember { mutableStateOf(false) }
    var talkingTo by remember { mutableStateOf<Friend?>(null) }
    var cupOpen by remember { mutableStateOf(false) }
    val cups = rememberCupStore(game)

    // The blocked list and this player's own code both come back here, and
    // both are things the chat depends on having. Then, for as long as the
    // tab is up, the list stays live: a friend who sits down at a table
    // should turn up joinable without anybody pulling to refresh.
    LaunchedEffect(Unit) {
        account.refreshSocial(onBlocked = game::applyBlocked, onMyCode = game::applyMyCode)
        account.watchSocial(onBlocked = game::applyBlocked)
    }

    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // iOS's tabPage: eighteen between cards, twenty off the top, and no
        // wider than 560 so a tablet reads as a column.
        Column(
            Modifier
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            // The title, with the bell beside it: a note about a round opening
            // is no use two taps deep.
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PageTitle(
                    "Social", "Your account, your friends, and whatever is being played for.",
                    Modifier.weight(1f),
                )
                NoticeBell(messaging.unread, Modifier.padding(top = 8.dp)) {
                    Haptics.tap()
                    onNotices()
                }
            }

            AccountCard(account, game)

            // Draws nothing at all unless the owner has a cup running.
            cups.live?.let { cup -> CupCard(cup) { cupOpen = true } }

            FriendsCard(account) {
                Haptics.tap()
                friendsOpen = true
            }
        }
    }

    if (friendsOpen) {
        FriendsSheet(
            account = account,
            game = game,
            safety = safety,
            onMessage = { talkingTo = it },
        ) { friendsOpen = false }
    }
    // Raised beside the friends room rather than inside it, so it opens on
    // top of it and closes back onto it, as the DM sheet does on iOS.
    talkingTo?.let { friend ->
        DMSheet(
            friend, messaging, account,
            onBlocked = {
                game.applyBlocked(game.blockedCodes + it)
                account.noteBlocked(it, game::applyBlocked)
            },
            // The sheet closes on a block, so the room under it says it went.
            onToast = { game.showToast(it) },
        ) { talkingTo = null }
    }
    if (cupOpen) {
        CupDetailSheet(
            cups = cups,
            game = game,
            signedIn = account.me?.provider != null,
        ) { cupOpen = false }
    }
}

/** What a row calls somebody: their name, or their code if they never gave one. */
private val Friend.display: String get() = name.ifBlank { code }

// ── the page ───────────────────────────────────────────────────────────────

/** iOS's pageTitle: thirty-point heavy, and the line under it in the quiet ink. */
@Composable
private fun PageTitle(title: String, sub: String, modifier: Modifier = Modifier) {
    val p = P.current
    Column(modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(title, color = p.ink, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold)
        Text(sub, color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

/**
 * A summary, and a door — iOS's friendsCard. The people mark on a well, the
 * word Friends and one line under it that leads with whatever somebody else
 * is waiting on, your code in a pill, and the chevron.
 */
@Composable
private fun FriendsCard(account: AccountStore, onOpen: () -> Unit) {
    val p = P.current
    val social = account.social
    val friends = social?.friends.orEmpty()
    val requests = social?.requests.orEmpty()
    val online = social?.onlineCount ?: 0
    // A request is the one thing here somebody else is waiting on, so it
    // takes the line when there is one.
    val line = when {
        requests.isNotEmpty() ->
            "${requests.size} friend request${if (requests.size > 1) "s" else ""} waiting"
        friends.isEmpty() -> "Swap codes and play together"
        online == 0 -> "${friends.size} · nobody on right now"
        else -> "${friends.size} · $online on right now"
    }
    val lineInk = when {
        requests.isNotEmpty() -> p.gold
        online > 0 -> p.good
        else -> p.ink3
    }
    // The code the server confirmed, as iOS shows it — nothing until then.
    val code = account.confirmedCode

    Card(padding = 16.dp, onClick = onOpen) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(42.dp).clip(RoundedCornerShape(13.dp)).background(p.sunken),
                contentAlignment = Alignment.Center,
            ) {
                // person.2.fill: both figures solid.
                SfMark("person.2.fill", 20.dp, p.ink2)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Friends", color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
                Text(line, color = lineInk, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            }
            // iOS's twelve either side of a spacer that never shrinks below
            // six: thirty at the least between the words and whatever comes
            // next, the code pill or, before it has loaded, the chevron.
            Spacer(Modifier.width(30.dp))
            if (code.isNotBlank()) {
                Text(
                    code,
                    color = p.ink2, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold,
                    fontFamily = FontFamily.Monospace, letterSpacing = 1.5.sp, maxLines = 1,
                    modifier = Modifier
                        .clip(RoundedCornerShape(99.dp))
                        .background(p.sunken)
                        .border(1.dp, p.rule, RoundedCornerShape(99.dp))
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                )
                Spacer(Modifier.width(12.dp))
            }
            RowChevron(p.ink3, 12.dp)
        }
    }
}

// ── the friends room ───────────────────────────────────────────────────────

/**
 * iOS's FriendsSheet: your code big enough to read out, one place to add
 * somebody, anyone waiting on an answer, and the list with what each person
 * is doing right now and the one button that matters for it. Full height on
 * the page colour, "Friends" in the middle of the bar and Done on the right.
 *
 * Toasts are drawn inside it as well as on the tab. iOS hangs its toasts in a
 * window above every sheet; here a sheet is a window of its own over the
 * app's, so "Friend code copied" said only on the tab would be said behind
 * the room the player is looking at.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FriendsSheet(
    account: AccountStore,
    game: GameStore,
    safety: Safety,
    onMessage: (Friend) -> Unit,
    onDismiss: () -> Unit,
) {
    val p = P.current
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var adding by remember { mutableStateOf(false) }

    fun close() {
        scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
    }

    // Opening the room asks again, as iOS's does — the profile first, so the
    // code on it is one the server can find, then the lists.
    LaunchedEffect(Unit) {
        account.refreshSocial(onBlocked = game::applyBlocked, onMyCode = game::applyMyCode)
    }

    val social = account.social
    // "······" and a shut Copy and Share until the profile call has answered,
    // as iOS's friends room waits for it.
    val mine = account.confirmedCode

    fun add() {
        if (code.length < 4 || adding) return
        adding = true
        account.addFriend(code, quiet = true) { error ->
            adding = false
            if (error == null) {
                code = ""
                Haptics.turn()
                game.showToast("Request sent")
            } else {
                game.showToast(error, isError = true)
            }
        }
    }

    // Report, from a row's menu: the reason is the whole form, so a tap files
    // it, as iOS's submenu does.
    fun report(who: Friend, place: String, reason: ReportReason) {
        scope.launch {
            val reply = safety.report(SafetyTarget(who.code, who.name, place), reason)
            if (reply.ok) {
                Haptics.tap()
                game.showToast(reportThanks(who.display))
            } else {
                game.showToast(reply.error ?: "Couldn't send that report — try again.", isError = true)
            }
        }
    }

    // Block, from a row's menu: one destructive item, as on iOS. Blocking
    // takes the friendship and any request with it on both sides, so the
    // person leaves every list here on the same tap.
    fun block(who: Friend) {
        scope.launch {
            val reply = safety.block(who.code)
            if (reply.ok) {
                Haptics.tap()
                reply.blocked?.let(game::applyBlocked)
                account.noteBlocked(who.code, game::applyBlocked)
                game.showToast(blockedLine(who.display))
            } else {
                game.showToast(reply.error ?: "Couldn't block them — try again.", isError = true)
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = p.page,
        dragHandle = null,
    ) {
        Box(Modifier.fillMaxWidth().fillMaxHeight()) {
            Column(Modifier.fillMaxSize()) {
                SheetBar("Friends") { close() }
                Column(
                    Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    YourCode(
                        mine,
                        onCopy = { copyText(context, mine) { game.showToast("Friend code copied") } },
                        onShare = {
                            shareText(context, account.friendCodeShareText) { game.showToast("Invite copied") }
                        },
                    )
                    AddBox(code, adding, onChange = { code = it }, onAdd = { add() })
                    Pending(
                        requests = social?.requests.orEmpty(),
                        asked = social?.sent.orEmpty(),
                        // iOS says "You are friends now" the moment yes is
                        // tapped, and answers a decline or a cancel with the
                        // list reloading and nothing else.
                        onAccept = { r ->
                            account.answerFriend(r.code, accept = true) { _ -> }
                            Haptics.turn()
                            game.showToast("You are friends now")
                        },
                        onDecline = { r ->
                            account.answerFriend(r.code, accept = false) { _ -> }
                        },
                        onCancel = { r ->
                            account.cancelRequest(r.code) { _ -> }
                        },
                        // The request row is a name somebody chose.
                        onReport = { r, reason -> report(r, "name", reason) },
                        onBlock = { block(it) },
                    )
                    FriendList(
                        social = social,
                        seatedAt = game.roomId,
                        invited = { account.wasInvited(it, game.roomId) },
                        onMessage = {
                            Haptics.tap()
                            onMessage(it)
                        },
                        onJoin = { room ->
                            Haptics.tap()
                            close()
                            game.connect(room)
                        },
                        // The other direction: ask them to come to yours.
                        onInvite = { f, room ->
                            account.invite(f, room) { error ->
                                if (error == null) {
                                    Haptics.tap()
                                    game.showToast("Invited ${f.display}")
                                } else {
                                    game.showToast(error, isError = true)
                                }
                            }
                        },
                        // Silent, as iOS's is: the list reloading is the answer.
                        onRemove = { f ->
                            account.removeFriend(f.code) { _ -> }
                        },
                        onReport = { f, reason -> report(f, "friend", reason) },
                        onBlock = { block(it) },
                    )
                }
            }
            // iOS's toast, drawn inside the sheet so it is seen over it: the
            // table's own ToastPill, iOS's pill point for point.
            ToastPill(game, Modifier.align(Alignment.BottomCenter))
        }
    }
}

/** YOUR FRIEND CODE, the code itself on a gold-rimmed well, Copy and Share, and the line under them. */
@Composable
private fun YourCode(mine: String, onCopy: () -> Unit, onShare: () -> Unit) {
    val p = P.current
    Card(padding = 16.dp) {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "YOUR FRIEND CODE",
                color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp,
            )
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(p.sunken)
                    .border(1.dp, p.gold.copy(alpha = 0.5f), RoundedCornerShape(14.dp))
                    .padding(vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    mine.ifBlank { "······" },
                    color = p.ink, fontSize = 34.sp, fontWeight = FontWeight.Black,
                    fontFamily = FontFamily.Monospace, letterSpacing = 6.sp,
                    maxLines = 1,
                )
            }
            // Two different buttons on iOS, and they look it: Copy is the
            // house ghost button, Share is the share link's own well — a
            // hairline round it, fifteen semibold and a little taller.
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PlainButton(
                    "Copy", FriendsButtonKind.GHOST, Modifier.weight(1f), enabled = mine.isNotBlank(),
                    // doc.on.doc, in outline, as iOS draws it.
                    lead = { SfMark("doc.on.doc", 15.dp, it) },
                    gap = 7.dp,
                ) { onCopy() }
                Row(
                    Modifier
                        .weight(1f)
                        .heightIn(min = 42.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(p.sunken)
                        .border(1.dp, p.rule, RoundedCornerShape(12.dp))
                        .clickable(enabled = mine.isNotBlank()) { onShare() },
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // square.and.arrow.up, the open tray in outline.
                    SfMark("square.and.arrow.up", 16.dp, p.ink)
                    Spacer(Modifier.width(7.dp))
                    Text("Share", color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            Text(
                "Give this to somebody and they can ask to be friends. You decide — a request " +
                    "waits here until you accept it.",
                color = p.ink3, fontSize = 11.5.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * Add a friend: THEIR CODE in the well and the gold Add beside it, with the
 * plus that becomes the spinner while the request is out.
 *
 * Four characters is enough to ask, as on iOS. A code that is too short for
 * the server comes back in the server's own words, which say more than a
 * button that stays grey without saying why.
 */
@Composable
private fun AddBox(code: String, adding: Boolean, onChange: (String) -> Unit, onAdd: () -> Unit) {
    val p = P.current
    Card(padding = 16.dp) {
        PanelTitle("Add a friend")
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                // Tidied inside the change rather than after it, or fast
                // typing loses characters to the write-back.
                BasicTextField(
                    value = code,
                    onValueChange = { onChange(it.uppercase().filter(Char::isLetterOrDigit).take(6)) },
                    singleLine = true,
                    textStyle = TextStyle(
                        color = p.ink, fontSize = 16.sp,
                        fontWeight = FontWeight.ExtraBold, letterSpacing = 2.sp,
                        fontFamily = FontFamily.Monospace,
                    ),
                    cursorBrush = SolidColor(p.red),
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Characters,
                        autoCorrectEnabled = false,
                        imeAction = ImeAction.Done,
                    ),
                    keyboardActions = KeyboardActions(onDone = { onAdd() }),
                    decorationBox = { inner ->
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(46.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(p.sunken)
                                .border(1.dp, p.rule, RoundedCornerShape(12.dp))
                                .padding(horizontal = 13.dp),
                            contentAlignment = Alignment.CenterStart,
                        ) {
                            if (code.isEmpty()) {
                                Text(
                                    "THEIR CODE", color = p.ink3, fontSize = 16.sp,
                                    fontWeight = FontWeight.ExtraBold, letterSpacing = 2.sp,
                                    fontFamily = FontFamily.Monospace,
                                )
                            }
                            inner()
                        }
                    },
                )
            }
            Spacer(Modifier.width(8.dp))
            PlainButton(
                "Add", FriendsButtonKind.GOLD, enabled = code.length >= 4 && !adding, pad = 20.dp, gap = 6.dp,
                // The drawn plus fills three-fifths of its square, so eighteen
                // here is the eleven-point cross iOS's fourteen-point bold
                // symbol actually draws.
                lead = { ink -> if (adding) SfSpinner(ink, 16.dp) else SfMark("plus", 18.dp, ink) },
            ) { onAdd() }
        }
    }
}

/**
 * Anyone waiting on an answer, both ways.
 *
 * Adding somebody used to put you straight on their list. A code gets read
 * over a shoulder, though, and being on a stranger's list means they can
 * message you — so they decide, and the way to stop a stranger is right
 * beside their request. Draws nothing when nobody is waiting.
 */
@Composable
private fun Pending(
    requests: List<Friend>,
    asked: List<Friend>,
    onAccept: (Friend) -> Unit,
    onDecline: (Friend) -> Unit,
    onCancel: (Friend) -> Unit,
    onReport: (Friend, ReportReason) -> Unit,
    onBlock: (Friend) -> Unit,
) {
    if (requests.isEmpty() && asked.isEmpty()) return
    val p = P.current
    Card(padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (requests.isNotEmpty()) {
                PanelTitle("Wants to be friends (${requests.size})")
                for (r in requests) {
                    PendingRow(r, tint = p.gold, fill = p.goldSoft, rim = p.gold.copy(alpha = 0.6f)) {
                        PlainButton("Accept", FriendsButtonKind.GOLD) { onAccept(r) }
                        Spacer(Modifier.width(11.dp))
                        PersonMenu(
                            name = r.display,
                            friend = false,
                            onFirst = { onDecline(r) },
                            onReport = { onReport(r, it) },
                            onBlock = { onBlock(r) },
                        )
                    }
                }
            }
            if (asked.isNotEmpty()) {
                PanelTitle("Asked (${asked.size})")
                for (r in asked) {
                    // A request with nowhere to be seen is indistinguishable
                    // from one that failed, which is how the same code gets
                    // added five times — and Cancel takes it back.
                    PendingRow(r, tint = p.rule, fill = p.sunken, rim = p.rule, asking = true) {
                        PlainButton("Cancel", FriendsButtonKind.GHOST) { onCancel(r) }
                    }
                }
            }
        }
    }
}

/** One waiting person: the face, the name, the line under it, and whatever answers it. */
@Composable
private fun PendingRow(
    r: Friend,
    tint: Color,
    fill: Color,
    rim: Color,
    asking: Boolean = false,
    trailing: @Composable () -> Unit,
) {
    val p = P.current
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(fill)
            .border(1.dp, rim, shape)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FriendFace(r.face, ring = tint, fill = p.card, size = 36.dp, emoji = 19, mark = 17.dp)
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(
                r.display,
                color = if (asking) p.ink2 else p.ink,
                fontSize = if (asking) 14.sp else 14.5.sp,
                fontWeight = if (asking) FontWeight.Bold else FontWeight.ExtraBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                if (asking) "waiting for them to accept" else "asked to be friends · ${r.code}",
                color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
            )
        }
        // iOS's row spacing either side of its flexible gap.
        Spacer(Modifier.width(26.dp))
        trailing()
    }
}

/** YOUR FRIENDS, who is on, and a row for each — or the empty state that says what to do. */
@Composable
private fun FriendList(
    social: SocialView?,
    seatedAt: String?,
    invited: (String) -> Boolean,
    onMessage: (Friend) -> Unit,
    onJoin: (String) -> Unit,
    onInvite: (Friend, String) -> Unit,
    onRemove: (Friend) -> Unit,
    onReport: (Friend, ReportReason) -> Unit,
    onBlock: (Friend) -> Unit,
) {
    val p = P.current
    val friends = social?.friendsByPresence.orEmpty()
    val online = social?.onlineCount ?: 0
    Card(padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            PanelTitle(
                if (friends.isEmpty()) "Your friends" else "Your friends (${friends.size})",
                Modifier.weight(1f),
            )
            if (friends.isNotEmpty()) {
                Text(
                    if (online == 0) "nobody on right now" else "$online on right now",
                    color = if (online == 0) p.ink3 else p.good,
                    fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        if (friends.isEmpty()) {
            Column(
                Modifier.fillMaxWidth().padding(vertical = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SfMark("person.2.fill", 30.dp, p.ink3)
                Text(
                    if (social != null) "Nobody yet" else "Looking…",
                    color = p.ink2, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold,
                )
                Text(
                    "Send somebody your code, or type theirs in above. Once you are friends you " +
                        "can message them and drop straight into their table.",
                    color = p.ink3, fontSize = 12.sp, lineHeight = 17.sp,
                    fontWeight = FontWeight.Medium, textAlign = TextAlign.Center,
                )
            }
        } else {
            // Whoever is playing sorts to the top: that is the row with
            // something to do on it.
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (f in friends) {
                    FriendRow(
                        f,
                        seatedAt = seatedAt,
                        invited = invited(f.code),
                        onMessage = { onMessage(f) },
                        onJoin = onJoin,
                        onInvite = { onInvite(f, it) },
                    ) {
                        PersonMenu(
                            name = f.display,
                            friend = true,
                            onFirst = { onRemove(f) },
                            onReport = { onReport(f, it) },
                            onBlock = { onBlock(f) },
                        )
                    }
                }
            }
        }
    }
}

/**
 * A friend: what they are doing right now, and the one button that matters
 * for it. A seat in a lobby is Join; a game already under way is Watch,
 * because its seats are shut and a button that promises a seat and delivers
 * a spectator's view reads as broken. Sitting at a table of your own, a
 * friend who is not at one gets Invite instead.
 */
@Composable
private fun FriendRow(
    f: Friend,
    seatedAt: String?,
    invited: Boolean,
    onMessage: () -> Unit,
    onJoin: (String) -> Unit,
    onInvite: (String) -> Unit,
    menu: @Composable () -> Unit,
) {
    val p = P.current
    val (label, tint) = when (f.status) {
        "lobby" -> "waiting in a lobby" to p.gold
        "playing" -> "in a game" to p.good
        else -> "offline" to p.ink3
    }
    val shape = RoundedCornerShape(13.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.sunken)
            .border(1.dp, p.rule, shape)
            .padding(11.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FriendFace(
                f.face,
                ring = tint.copy(alpha = if (f.status == null) 0f else 0.55f),
                fill = p.sunken,
                size = 40.dp,
                emoji = 20,
                mark = 18.dp,
                ringWidth = 1.5.dp,
            )
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    f.display,
                    color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(label, color = tint, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.width(6.dp))
                    Text(
                        f.code,
                        color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }
            Spacer(Modifier.width(26.dp))
            menu()
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PlainButton(
                "Message", FriendsButtonKind.GHOST, Modifier.weight(1f), gap = 6.dp,
                // iOS's pair at the button's fourteen bold is wider than tall,
                // about twenty by sixteen: the drawn pair at twenty-two.
                lead = { SfMark("bubble.left.and.bubble.right.fill", 22.dp, it) },
            ) { onMessage() }
            val room = f.room
            // The drawn marks on these two are iOS's Art.icon with no tint
            // handed to it, which paints in the page's ink whatever the
            // button underneath is — so on the red Join the dice is the
            // page's ink, not the button's.
            when {
                room != null -> PlainButton(
                    if (f.started) "Watch" else "Join their table",
                    if (f.started) FriendsButtonKind.GHOST else FriendsButtonKind.PRIMARY,
                    Modifier.weight(1f), gap = 6.dp,
                    lead = {
                        if (f.started) SfMark("eye.fill", 14.dp, p.ink) else Icon("dice", size = 14.dp, tint = p.ink)
                    },
                ) { onJoin(room) }

                seatedAt != null -> PlainButton(
                    if (invited) "Invited" else "Invite",
                    FriendsButtonKind.GHOST, Modifier.weight(1f), enabled = !invited, gap = 6.dp,
                    lead = { SfMark("person.2.fill", 14.dp, p.ink) },
                ) { onInvite(seatedAt) }
            }
        }
    }
}

/**
 * A person's face, as iOS draws one off the table: their equipped store face
 * if they wear one, their flag if not, and the people mark when they have
 * neither — a friend is not a seat, so there is no colour to paint.
 */
@Composable
private fun FriendFace(
    face: String,
    ring: Color,
    fill: Color,
    size: Dp,
    emoji: Int,
    mark: Dp,
    ringWidth: Dp = 1.dp,
) {
    val p = P.current
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(fill)
            .border(ringWidth, ring, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (face.isBlank()) {
            SfMark("person.2.fill", mark, p.ink3)
        } else {
            Text(face, fontSize = emoji.sp, maxLines = 1, softWrap = false)
        }
    }
}

// ── the menu on a row ──────────────────────────────────────────────────────

private enum class PersonMenuPage { ROOT, REPORT, REMOVE }

/**
 * The "…" on a request or a friend: decline or remove, report, block.
 *
 * iOS's Menu with its submenus, as pages of one dropdown, with the same
 * words and the same pictures — the raised hand on Block, the bubble with
 * the mark in it on Report. The reasons are a page rather than a sheet so a
 * report is filed where it was started, and removing a friend is a page of
 * its own because the second tap IS the confirmation — two deliberate taps,
 * and nothing that can fail to appear.
 */
@Composable
private fun PersonMenu(
    name: String,
    friend: Boolean,
    onFirst: () -> Unit,
    onReport: (ReportReason) -> Unit,
    onBlock: () -> Unit,
) {
    val p = P.current
    var open by remember { mutableStateOf(false) }
    var page by remember { mutableStateOf(PersonMenuPage.ROOT) }
    fun close() {
        open = false
    }
    // A request's dots sit in a smaller box than a friend's, as on iOS.
    val box = if (friend) 32.dp else 28.dp
    Box {
        Box(
            Modifier
                .size(box)
                .clip(CircleShape)
                .clickable {
                    page = PersonMenuPage.ROOT
                    open = true
                }
                .semantics {
                    contentDescription = if (friend) "More for $name" else "Decline, report or block $name"
                },
            contentAlignment = Alignment.Center,
        ) {
            MoreDots(p.ink3)
        }
        // iOS's context menus are a fixed, wider panel, about 250 points,
        // rather than one that hugs its longest label.
        DropdownMenu(
            expanded = open,
            onDismissRequest = { close() },
            modifier = Modifier.widthIn(min = 250.dp),
            shape = RoundedCornerShape(14.dp),
            containerColor = p.card,
            border = BorderStroke(1.dp, p.rule),
        ) {
            when (page) {
                PersonMenuPage.ROOT -> {
                    if (friend) {
                        MenuRow("Remove friend", symbol = "person.badge.minus", more = true) {
                            page = PersonMenuPage.REMOVE
                        }
                    } else {
                        MenuRow("Decline", symbol = "xmark") {
                            close()
                            onFirst()
                        }
                    }
                    MenuRow("Report $name…", symbol = "exclamationmark.bubble", more = true) {
                        page = PersonMenuPage.REPORT
                    }
                    MenuRow("Block $name", symbol = "hand.raised", danger = true) {
                        close()
                        onBlock()
                    }
                }

                PersonMenuPage.REPORT -> {
                    MenuHeading("Report $name…")
                    for (reason in ReportReason.entries) {
                        MenuRow(reason.label) {
                            close()
                            onReport(reason)
                        }
                    }
                }

                PersonMenuPage.REMOVE -> {
                    MenuHeading("Remove friend")
                    MenuRow(
                        "Remove $name — you both drop off each other's list",
                        symbol = "person.badge.minus", danger = true,
                    ) {
                        close()
                        onFirst()
                    }
                }
            }
        }
    }
}

/**
 * One item of the row menu, laid out as iOS lays a menu item out: the words
 * on the left in the menu's regular weight, and the picture after them on the
 * right, in the same ink as the words — red, both of them, on the destructive
 * one. A submenu adds its chevron after the picture.
 */
@Composable
private fun MenuRow(
    label: String,
    glyph: String? = null,
    symbol: String? = null,
    danger: Boolean = false,
    more: Boolean = false,
    onClick: () -> Unit,
) {
    val p = P.current
    val ink = if (danger) p.bad else p.ink
    val hasMark = symbol != null || glyph != null
    DropdownMenuItem(
        text = {
            Text(
                label,
                color = ink, fontSize = 16.sp, fontWeight = FontWeight.Normal,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        },
        trailingIcon = if (hasMark || more) {
            {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    when {
                        symbol != null -> SfMark(symbol, 18.dp, ink)
                        glyph != null -> Icon(glyph, size = 16.dp, tint = ink)
                    }
                    if (more) RowChevron(p.ink3, 10.dp)
                }
            }
        } else {
            null
        },
        onClick = onClick,
    )
}

/** The name of the page a menu has stepped into, where iOS's submenu shows its parent. */
@Composable
private fun MenuHeading(text: String) {
    Text(
        text,
        // The size and weight iOS heads an opened submenu with, and the same
        // the chat's report menu uses, so the two menus read as one kind.
        color = P.current.ink3, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
        maxLines = 1, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
    )
}

/** Three dots, drawn: iOS's ellipsis, which the glyph set has no drawing for. */
@Composable
private fun MoreDots(tint: Color) {
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
        repeat(3) { Box(Modifier.size(4.dp).clip(CircleShape).background(tint)) }
    }
}

// ── house pieces, in iOS's measurements ────────────────────────────────────

/** iOS's PanelTitle: small capitals one point apart, in the quietest ink. */
@Composable
private fun PanelTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        modifier = modifier,
        color = P.current.ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
        maxLines = 1,
    )
}

/**
 * iOS's MMCard: sixteen-point corners, the card fill, a hairline and the
 * soft shadow under it. Handed [onClick] it is the whole button, as iOS's
 * friends summary is.
 */
@Composable
private fun Card(
    padding: Dp = 14.dp,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val p = P.current
    val shape = RoundedCornerShape(16.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .shadow(6.dp, shape, clip = false)
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .then(if (onClick != null) Modifier.clickable { onClick() } else Modifier)
            .padding(padding),
        content = content,
    )
}

private enum class FriendsButtonKind { PRIMARY, GOLD, GHOST }

/**
 * iOS's MMButtonStyle, small: fourteen bold on a ten-point corner, the ghost
 * a filled well rather than an outline, and a faint white rim on the
 * coloured kinds. Disabled only stops it answering, as iOS's style never
 * reads the disabled state.
 */
@Composable
private fun PlainButton(
    label: String,
    kind: FriendsButtonKind,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    pad: Dp = 14.dp,
    gap: Dp = 8.dp,
    lead: (@Composable (ink: Color) -> Unit)? = null,
    onClick: () -> Unit,
) {
    val p = P.current
    val bg = when (kind) {
        FriendsButtonKind.PRIMARY -> p.red
        FriendsButtonKind.GOLD -> p.gold
        FriendsButtonKind.GHOST -> p.sunken
    }
    val ink = if (kind == FriendsButtonKind.GHOST) p.ink else p.accentInk
    val shape = RoundedCornerShape(10.dp)
    Row(
        modifier
            .clip(shape)
            .background(bg)
            .then(if (kind == FriendsButtonKind.GHOST) Modifier else Modifier.border(1.dp, Color.White.copy(alpha = 0.18f), shape))
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = pad, vertical = 9.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (lead != null) {
            lead(ink)
            Spacer(Modifier.width(gap))
        }
        Text(
            label,
            color = ink, fontSize = 14.sp, fontWeight = FontWeight.Bold,
            maxLines = 1, textAlign = TextAlign.Center,
        )
    }
}

/**
 * iOS's inline navigation bar: the title in the middle and Done on the
 * right, in the accent and regular weight — iOS's trailing toolbar button,
 * which is not the bold confirming kind.
 */
@Composable
private fun SheetBar(title: String, onDone: () -> Unit) {
    val p = P.current
    Box(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 16.dp)) {
        Text(
            title,
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

