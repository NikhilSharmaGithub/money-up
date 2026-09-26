package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Your look at this table — name, colour and piece — without getting up.
 *
 * Drawn as iOS draws "Your look" at the foot of its lobby panel, piece for
 * piece: the nickname field, the eight seat colours in one row, a hairline,
 * and the piece row with the purse beside its title. Three questions answered
 * by two different halves of the server. The piece is a cosmetic:
 * `/api/store/equip` writes it to the profile and, if that player is sitting
 * at a table, restyles the piece there and then — so it can be changed at any
 * point in a game. The name and the colour are the table's key to who is who,
 * and `updateAppearance` only accepts them while the room is still a lobby; a
 * swap once the dice are out would relabel every ownership pip and every log
 * line under the people reading them.
 *
 * So the name field and the swatches go grey and say why, rather than being
 * taken, sent, and silently ignored by a server that answers nothing. iOS
 * never has to say it — its panel is gone once the game starts — but this
 * sheet can be open over a game in progress, and a control that does nothing
 * is worse than one that is honestly shut.
 *
 * The piece row is iOS's PiecePicker whole: the plain disc first, then every
 * piece there is. What you own you wear with one tap; what you don't shows its
 * price and opens the little shop behind it, [PieceShopSheet], rather than
 * bouncing an error back at a player who only wanted to look.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PiecePicker(store: GameStore, account: AccountStore, onDismiss: () -> Unit) {
    val p = P.current
    val state = store.state
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // The name as it stands at the table, not as this phone last saved it —
    // the table's is the one everybody is reading.
    var nameDraft by remember { mutableStateOf(store.me?.name ?: store.nickname) }

    // Sent on the keyboard's Done, as on iOS, and also on the way out: a name
    // typed and then left by closing the sheet reads, to whoever typed it, as
    // a name they changed. Nothing goes if it has not actually changed.
    fun commitName() {
        val trimmed = nameDraft.trim()
        if (!store.canRename || trimmed.isEmpty() || trimmed == store.me?.name) return
        store.rename(trimmed)
    }

    fun close() {
        commitName()
        onDismiss()
    }

    ModalBottomSheet(
        onDismissRequest = { close() },
        sheetState = sheetState,
        containerColor = p.sheet,
        dragHandle = null,
    ) {
        Column(Modifier.fillMaxWidth()) {
            LookBar("Your look", "Done") { close() }
            Column(
                Modifier
                    .weight(1f, fill = false)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp)
                    .padding(top = 4.dp, bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                NicknameField(
                    value = nameDraft,
                    open = store.canRename,
                    onChange = { nameDraft = it.take(16) },
                    onDone = { commitName() },
                )

                Swatches(store, state)

                // The colour above is half of what a player sees of themselves
                // on the board; the piece sitting in it is the other half.
                Box(
                    Modifier
                        .padding(top = 2.dp)
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(p.rule),
                )

                PieceRow(store, account)
            }
        }
    }
}

/**
 * The bar iOS's navigation stack draws over a sheet: the title centred, the
 * way out on the right in the table's accent.
 */
@Composable
private fun LookBar(title: String, action: String, onAction: () -> Unit) {
    val p = P.current
    Box(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 16.dp)) {
        Text(
            title,
            modifier = Modifier.align(Alignment.Center),
            color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
        )
        Text(
            action,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .clip(RoundedCornerShape(8.dp))
                .clickable { onAction() }
                .padding(horizontal = 4.dp, vertical = 6.dp),
            color = p.red, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
        )
    }
}

/** iOS's PanelTitle: small capitals, one point apart, in the quietest ink. */
@Composable
private fun PanelTitle(text: String) {
    Text(
        text.uppercase(),
        color = P.current.ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
        maxLines = 1,
    )
}

/**
 * The name this player goes by at this table. Sixteen characters, because that
 * is all the server keeps of a name; anything longer would be cut at the table
 * without a word. Shut once the dice are out, and says so.
 */
@Composable
private fun NicknameField(value: String, open: Boolean, onChange: (String) -> Unit, onDone: () -> Unit) {
    val p = P.current
    val focus = LocalFocusManager.current
    val shape = RoundedCornerShape(10.dp)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        BasicTextField(
            value = value,
            onValueChange = onChange,
            enabled = open,
            singleLine = true,
            textStyle = TextStyle(
                color = if (open) p.ink else p.ink3,
                fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
            ),
            cursorBrush = SolidColor(p.red),
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Words,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = {
                onDone()
                focus.clearFocus()
            }),
            decorationBox = { inner ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(shape)
                        .background(p.sunken)
                        .padding(horizontal = 12.dp, vertical = 9.dp),
                ) {
                    if (value.isEmpty()) {
                        Text("Nickname", color = p.ink3, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    }
                    inner()
                }
            },
        )
        if (!open) Hint("Names are locked once the dice are out — the whole table is reading yours.")
    }
}

// ─────────────────────────────────────────────────────────── the piece row ──

/**
 * A horizontal shelf of pieces for the seat you are about to play — iOS's
 * PiecePicker. The plain coloured disc first (the look every player starts
 * with, and the thing to tap to take a skin back off), then every piece there
 * is. Owned ones wear on a tap and ring gold; the rest wear their price and
 * open the shop.
 *
 * Forty-six-point discs on a sixty-point pitch, a caption under each, and the
 * row its full seventy-eight from the first frame — blank discs hold the shape
 * while the shelf is still in the post, so nothing above it hops when it
 * lands. A shelf that never comes gets a chip to ask again: AccountStore
 * keeps no note of a failed fetch, so "never" is a fair wait with nothing
 * arrived.
 */
@Composable
private fun PieceRow(store: GameStore, account: AccountStore) {
    val p = P.current
    val scope = rememberCoroutineScope()
    val tokens = account.store?.items.orEmpty().filter { it.kind == "token" }
    val wallet = account.wallet
    // Bought here and not yet back from the wallet: the shelf redraws it as
    // owned at once rather than a round trip later, as iOS's does.
    var bought by remember { mutableStateOf(emptySet<String>()) }
    val owned = wallet?.owned.orEmpty().toSet() + bought
    val worn = wallet?.equipped?.get("token").orEmpty()

    // What the row shows while an equip is in the post. The wallet is the
    // truth and takes back over the moment it agrees; a refusal drops the
    // guess there and then, so the gold ring never sits on a piece the board
    // is not wearing.
    var guess by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(worn) { if (guess == worn) guess = null }
    val showing = guess ?: worn

    var busy by remember { mutableStateOf<String?>(null) }
    var buying by remember { mutableStateOf<String?>(null) }
    var shopping by remember { mutableStateOf<StoreItem?>(null) }
    var asks by remember { mutableIntStateOf(0) }

    // iOS's .task: the wallet and the shelf, asked for together — a piece
    // bought on the home screen two minutes ago is exactly the piece somebody
    // came here to put on. A failed fetch with nothing cached says so at once.
    LaunchedEffect(asks) { account.refreshStore() }
    val failed = account.storeFailed && account.store == null

    // iOS's Cosmetics.wear. No `itemId` at all is how the server spells
    // taking a piece off: the post drops a null before it builds the body.
    suspend fun wear(item: StoreItem?) {
        guess = item?.id.orEmpty()
        val reply = store.api.postOrError("/api/store/equip", mapOf("slot" to "token", "itemId" to item?.id))
        if (reply.ok) {
            // The same note the Store tab writes when it equips, so the two
            // screens agree about what this device is wearing.
            store.prefs.tokenSkin = item?.emoji.orEmpty()
        } else {
            guess = null
            store.showToast(reply.error ?: "Couldn't change your look — try again.", isError = true)
        }
        account.refreshStore()
    }

    fun equip(item: StoreItem?) {
        // One at a time: an impatient second tap must not race the first.
        if (busy != null) return
        busy = item?.id.orEmpty()
        SoundKit.click()
        scope.launch {
            wear(item)
            busy = null
        }
    }

    // iOS's Cosmetics.buyOrEquip: buy it if it is not yours yet, then wear it
    // — or take it off, if it is the one already on. Buying always ends with
    // the piece worn: somebody came here to change their piece, not to shop.
    fun shop(item: StoreItem) {
        if (buying != null) return
        val have = item.id in owned
        val on = showing == item.id
        buying = item.id
        SoundKit.click()
        scope.launch {
            var ours = have
            if (!have) {
                val reply = store.api.postOrError("/api/store/buy", mapOf("itemId" to item.id, "expect" to item.price))
                if (reply.ok) {
                    SoundKit.buy()
                    // The purse the reply states, at once, as iOS writes it.
                    account.noteBuyReply(reply.body)
                    store.showToast("${item.emoji} ${item.name} is yours!")
                    bought = bought + item.id
                    ours = true
                } else {
                    // A request that never landed must not read as a
                    // purchase: the coins only moved if the server said so.
                    store.showToast(reply.error ?: "Couldn't reach the shop — try again.", isError = true)
                }
            }
            if (ours) wear(if (on) null else item)
            buying = null
        }
    }

    val disc = cssColor(store.me?.color ?: SEAT_COLOURS.first(), p.red)
    val initial = (store.me?.name ?: store.nickname).take(1).uppercase()
    val coins = wallet?.coins ?: 0

    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            PanelTitle("Your piece")
            Spacer(Modifier.weight(1f))
            Icon("coin", size = 11.dp)
            Spacer(Modifier.width(4.dp))
            Text("$coins", color = p.gold, fontSize = 11.5.sp, fontWeight = FontWeight.ExtraBold)
        }
        Row(
            Modifier
                .fillMaxWidth()
                .height(78.dp)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 2.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            PieceChip(
                emoji = "", initial = initial, label = "Classic", price = null, disc = disc,
                selected = showing.isEmpty(), working = busy == "",
            ) { equip(null) }
            for (item in tokens) {
                key(item.id) {
                    val have = item.id in owned
                    PieceChip(
                        emoji = item.emoji, initial = initial, label = item.name,
                        price = if (have) null else item.price, disc = disc,
                        selected = showing == item.id, working = busy == item.id,
                    ) {
                        if (have) {
                            equip(item)
                        } else {
                            // Not yours yet — that is a shop trip, not a failed tap.
                            SoundKit.click()
                            shopping = item
                        }
                    }
                }
            }
            // Nothing in yet: hold the shape of the shelf rather than leaving
            // a gap that fills in with a jolt — and once the fetch has really
            // failed, say so with something to tap, because grey discs that
            // never resolve are the one thing worse than a slow shelf.
            if (tokens.isEmpty()) {
                if (failed) {
                    RetryChip {
                        SoundKit.click()
                        asks++
                    }
                } else {
                    repeat(4) { GhostChip() }
                }
            }
        }
    }

    shopping?.let { first ->
        PieceShopSheet(
            first = first, tokens = tokens, coins = coins, owned = owned, worn = showing, buying = buying,
            onBuy = { shop(it) },
            onDismiss = { shopping = null },
        )
    }
}

/** One piece on the shelf: the disc, then its name — or, not yours yet, its price. */
@Composable
private fun PieceChip(
    emoji: String,
    initial: String,
    label: String,
    price: Int?,
    disc: Color,
    selected: Boolean,
    working: Boolean,
    onTap: () -> Unit,
) {
    val p = P.current
    val have = price == null
    Column(
        Modifier
            .width(60.dp)
            .clickable { onTap() },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            Modifier
                .size(46.dp)
                .shadow(if (have) 3.dp else 0.dp, CircleShape, clip = false, ambientColor = CHIP_SHADOW, spotColor = CHIP_SHADOW)
                .clip(CircleShape)
                .background(if (have) disc else p.sunken)
                .border(if (selected) 2.5.dp else 1.dp, if (selected) p.gold else p.rule, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (emoji.isEmpty()) {
                Text(initial, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Black)
            } else {
                // A bought skin is the player's own chosen emoji — the one
                // place in this app's chrome where an emoji is the content
                // rather than a drawing standing in for one. One not yet owned
                // is shown faded and mostly grey, as iOS shows it.
                Text(
                    emoji,
                    fontSize = 25.sp,
                    modifier = if (have) Modifier else Modifier.alpha(0.55f).grey(0.8f),
                )
            }
            if (working) {
                Box(
                    Modifier
                        .matchParentSize()
                        .background(Color.Black.copy(alpha = 0.35f)),
                )
                LandingSpinner(Color.White, size = 14.dp)
            }
        }
        Row(
            Modifier.height(13.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(2.5.dp),
        ) {
            if (price != null) {
                Icon("coin", size = 10.dp)
                Text("$price", color = p.ink3, fontSize = 10.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1)
            } else {
                Text(
                    label,
                    color = if (selected) p.gold else p.ink2,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/** The shelf never came. One tap asks again — the lobby is no place to be stuck with no pieces. */
@Composable
private fun RetryChip(onTap: () -> Unit) {
    val p = P.current
    Column(
        Modifier
            .width(60.dp)
            .clickable { onTap() },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            Modifier
                .size(46.dp)
                .clip(CircleShape)
                .background(p.sunken)
                .border(1.dp, p.rule, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon("replay", size = 19.dp, tint = p.ink2)
        }
        Box(Modifier.height(13.dp), contentAlignment = Alignment.Center) {
            Text("Try again", color = p.ink2, fontSize = 10.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        }
    }
}

/** A blank disc holding a place on the shelf while it is still in the post. */
@Composable
private fun GhostChip() {
    val p = P.current
    Column(
        Modifier.width(60.dp).alpha(0.6f),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(Modifier.size(46.dp).clip(CircleShape).background(p.sunken))
        Spacer(Modifier.height(13.dp))
    }
}

// ───────────────────────────────────────── the little shop behind a piece ──

/**
 * Opened by tapping a piece you do not own — iOS's PieceShopSheet. It leads
 * with the one you tapped, because that is the piece you came for, and lays
 * the rest of the shelf out under it, so nobody is sent back to the home
 * screen mid-lobby to spend a coin.
 *
 * The piece up top moves: tapping one below that costs more than you have
 * brings it up here, where the price has room to explain itself, instead of
 * firing a purchase that can only bounce. Half height to start and pulled to
 * full, with the grabber showing, as iOS's medium and large detents are.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PieceShopSheet(
    first: StoreItem,
    tokens: List<StoreItem>,
    coins: Int,
    owned: Set<String>,
    worn: String,
    buying: String?,
    onBuy: (StoreItem) -> Unit,
    onDismiss: () -> Unit,
    /**
     * The table's store, whose toast this sheet draws over itself. A bottom
     * sheet is a window of its own above the one the app's toast lives in,
     * and iOS floats its toasts over every sheet — so "is yours!" and the
     * shop's refusals would otherwise play out unseen underneath.
     */
    game: GameStore? = null,
) {
    val p = P.current
    var focus by remember { mutableStateOf(first) }
    val scroll = rememberScrollState()
    // A piece promoted from three rows down is no use announced off-screen —
    // the tapped card leaves the grid, so carry the eye up to where it went.
    LaunchedEffect(focus.id) { scroll.animateScrollTo(0) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
        containerColor = p.sheet,
        dragHandle = {
            // iOS's grabber: a short capsule just under the top edge, in the
            // system's fixed grey rather than the table's ink.
            Box(
                Modifier
                    .padding(top = 5.dp)
                    .size(width = 36.dp, height = 5.dp)
                    .clip(CircleShape)
                    .background(if (p.sheet.luminance() < 0.5f) Color(0x4DEBEBF5) else Color(0x4D3C3C43)),
            )
        },
    ) {
        Box(Modifier.fillMaxWidth()) {
            Column(Modifier.fillMaxWidth()) {
                LookBar("Pick your piece", "Done") { onDismiss() }
                Column(
                    Modifier
                        .weight(1f, fill = false)
                        .fillMaxWidth()
                        .verticalScroll(scroll)
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    ShopHero(
                        item = focus, coins = coins, have = focus.id in owned, on = worn == focus.id,
                        busy = buying == focus.id,
                    ) { onBuy(focus) }

                    if (tokens.size > 1) {
                        PanelTitle("The rest of the shelf")
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            for (row in tokens.filter { it.id != focus.id }.chunked(3)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    for (item in row) {
                                        key(item.id) {
                                            val have = item.id in owned
                                            val affordable = have || coins >= item.price
                                            ShopCard(
                                                item, have = have, on = worn == item.id, affordable = affordable,
                                                modifier = Modifier.weight(1f),
                                            ) {
                                                if (affordable) {
                                                    onBuy(item)
                                                } else {
                                                    // Out of reach today — up to the top, which says
                                                    // how many coins short it is. A tap that only ever
                                                    // answers "Not enough coins" is a door slammed.
                                                    SoundKit.click()
                                                    focus = item
                                                }
                                            }
                                        }
                                    }
                                    repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                                }
                            }
                        }
                    }

                    Text(
                        "Coins come from your daily pick-up on the Play tab, and from winning. " +
                            "Every piece here is pure style — never pay-to-win.",
                        color = p.ink3, fontSize = 11.5.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium,
                    )
                }
            }
            game?.let { ToastPill(it, Modifier.align(Alignment.BottomCenter)) }
        }
    }
}

/** The piece that was tapped, large, with the one thing there is to do about it. */
@Composable
private fun ShopHero(item: StoreItem, coins: Int, have: Boolean, on: Boolean, busy: Boolean, onAct: () -> Unit) {
    val p = P.current
    val short = maxOf(0, item.price - coins)
    LandingCard(padding = 16.dp) {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(item.emoji, fontSize = 58.sp)
            Text(item.name, color = p.ink, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
            if (have) {
                Text("Yours — wear it whenever you like.", color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
            } else if (short > 0) {
                // Nothing to press yet, so say the number plainly instead of
                // offering a button that can only fail.
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Icon("coin", size = 14.dp)
                    Text(
                        "$short more coin${if (short == 1) "" else "s"} to go — you have $coins",
                        color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
                    )
                }
            }
            when {
                busy -> Box(Modifier.height(44.dp), contentAlignment = Alignment.Center) { LandingSpinner(p.red) }
                have -> LandingButton(
                    if (on) "✓  Wearing it" else "Wear this piece",
                    if (on) LandingKind.GHOST else LandingKind.GOLD,
                    big = true,
                    enabled = !on,
                ) { onAct() }
                // iOS's MMIconButton: the coin at nineteen on a big button,
                // eight points ahead of the words.
                short == 0 -> LandingButton(
                    "Buy for ${item.price}",
                    LandingKind.GOLD,
                    big = true,
                    lead = { Icon("coin", size = 19.dp) },
                ) { onAct() }
            }
        }
    }
}

/** Everything else on the shelf, three to a row. */
@Composable
private fun ShopCard(
    item: StoreItem,
    have: Boolean,
    on: Boolean,
    affordable: Boolean,
    modifier: Modifier = Modifier,
    onTap: () -> Unit,
) {
    val p = P.current
    val shape = RoundedCornerShape(15.dp)
    Column(
        modifier
            .alpha(if (affordable) 1f else 0.55f)
            .clip(shape)
            .background(if (on) p.goldSoft else p.card)
            .border(if (on) 1.5.dp else 1.dp, if (on) p.gold else p.rule, shape)
            .clickable { onTap() }
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Text(item.emoji, fontSize = 32.sp)
        Text(
            item.name,
            color = p.ink, fontSize = 12.sp, fontWeight = FontWeight.Bold,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (!have) Icon("coin", size = 11.dp)
            Text(
                when {
                    on -> "✓ Worn"
                    have -> "Tap to wear"
                    else -> "${item.price}"
                },
                color = when {
                    on -> p.good
                    have -> p.ink3
                    affordable -> p.gold
                    else -> p.ink3
                },
                fontSize = 10.sp, fontWeight = FontWeight.ExtraBold,
            )
        }
    }
}

// ────────────────────────────────────────────────────────────── the colours ──

/**
 * The eight seat colours, all in one row as iOS's grid lays them, and which
 * of them are going spare.
 *
 * A colour somebody else is wearing is refused by `updateAppearance` — two
 * identical discs on one board is a table nobody can read — so it is shown
 * faded and cannot be pressed, rather than offered and then bounced. Yours
 * wears a ring in the table's ink, standing clear of the swatch.
 */
@Composable
private fun Swatches(store: GameStore, state: GameState?) {
    val p = P.current
    val lobby = state?.isLobby == true
    val mine = store.me?.color?.lowercase()
    val taken = state?.players.orEmpty()
        .filter { it.id != store.meId }
        .map { it.color.lowercase() }
        .toSet()

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(top = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (hex in SEAT_COLOURS) {
                val used = hex in taken
                val on = hex == mine
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    Box(
                        Modifier
                            .size(26.dp)
                            // The ring sits outside the swatch's own bounds,
                            // so the row does not grow for it.
                            .drawBehind {
                                if (on) {
                                    drawCircle(p.ink, radius = 16.5.dp.toPx(), style = Stroke(width = 2.dp.toPx()))
                                }
                            }
                            .alpha(if (used) 0.25f else if (lobby) 1f else 0.5f)
                            .clip(CircleShape)
                            .background(cssColor(hex, p.red))
                            // Silent, as iOS's swatch is: the ring moving is
                            // the whole answer.
                            .clickable(enabled = lobby && !used && !on) {
                                store.setAppearance(color = hex)
                            },
                    )
                }
            }
        }
        if (!lobby) Hint("Colours are locked once the dice are out — half the board is reading yours.")
    }
}

/**
 * An image drawn at [amount] grey — 0 is untouched, 1 is no colour at all.
 * iOS's grayscale modifier, for the emoji of a piece not yet owned: a colour
 * matrix on a layer of its own.
 */
private fun Modifier.grey(amount: Float): Modifier = drawWithContent {
    val paint = Paint().apply {
        colorFilter = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(1f - amount) })
    }
    drawIntoCanvas { canvas ->
        canvas.saveLayer(Rect(Offset.Zero, size), paint)
        drawContent()
        canvas.restore()
    }
}

/**
 * The seat colours, exactly as `COLORS` in server/game.js lists them.
 *
 * `updateAppearance` checks the incoming colour against this list and drops
 * anything else on the floor, so a ninth colour invented here would be a
 * swatch that quietly never applies.
 */
private val SEAT_COLOURS = listOf(
    "#4ade80", "#60a5fa", "#f472b6", "#fbbf24",
    "#a78bfa", "#fb7185", "#22d3ee", "#f97316",
)

private val CHIP_SHADOW = Color.Black.copy(alpha = 0.28f)
