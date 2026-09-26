package com.moneymove.game

import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.lerp
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * Which board, and whether you may have it.
 *
 * This used to be a two-column list of names, and a list of names was the
 * wrong shape for it: a board is a picture, not a word, and the one thing a
 * lobby has to answer at a glance is "what are we playing?". So it is three
 * boxes now, each with a drawing of the board itself.
 *
 * The three are always the same three things — the two boards the day is
 * giving away, and then whatever this table is actually on. That last slot is
 * the point. A host who bought Bharat sees Bharat sitting there; everyone
 * else sees Classic, which is free forever and always will be. Nobody has to
 * open anything to find out where they are.
 *
 * Everything else is behind "All boards": the ones already bought, and the
 * ones still carrying a price. A locked board is a door into the shop, never
 * a dead tap — the same manners the piece shelf keeps.
 *
 * [AllBoards] and [BoardShop] are the two big pages, iOS's BoardPickerSheet
 * and BoardBuySheet. They are content rather than sheets so whoever opens them
 * decides where they sit — the table's lobby puts them in a sheet of its own,
 * the Store puts the shop in one over the tab — and each starts with the same
 * bar iOS's navigation stack draws: the title in the middle, the way out on
 * the right, in the table's accent.
 */

// ─────────────────────────────────────────────────────────────── the drawing ──

/**
 * The board itself, small: one rounded chip per tile, walked round the rim in
 * the order the server laid them out. Drawn rather than laid out, because
 * forty composables for a thumbnail is forty composables too many — and this
 * row can be carrying three of them while a ModalBottomSheet is animating.
 *
 * The walk is the same one [BoardGeometry] makes on the big board: clockwise
 * from the top-left corner, the top run left to right and the bottom run
 * right to left. The server's `preview.colors` is in plain tile order, which
 * is that same walk, so the two agree tile for tile. Getting the bottom or
 * the left run backwards previews a board mirrored, and a mirrored board is
 * the sort of wrong that looks almost right.
 */
@Composable
fun MiniBoard(preview: BoardPreview, modifier: Modifier = Modifier, dim: Boolean = false) {
    // Nineteen boards × forty chips of "#rrggbb" parsed on every frame of a
    // scroll is work nobody asked for; the strings never change once fetched.
    val blank = P.current.rule
    val chips = remember(preview, blank, dim) {
        preview.colors.map {
            val c = cssColor(it, blank)
            if (dim) c.copy(alpha = 0.34f) else c
        }
    }
    Canvas(modifier.fillMaxWidth().aspectRatio(1f)) {
        val s = preview.sides
        val cols = maxOf(s.top, s.bottom) + 2
        val rows = maxOf(s.left, s.right) + 2
        if (cols <= 1 || rows <= 1) return@Canvas
        val cw = size.width / cols
        val ch = size.height / rows
        val pad = minOf(cw, ch) * 0.09f
        var i = 0

        fun put(r: Int, c: Int) {
            val colour = chips.getOrNull(i) ?: return
            drawRoundRect(
                color = colour,
                topLeft = Offset(c * cw + pad, r * ch + pad),
                size = Size(cw - pad * 2, ch - pad * 2),
                cornerRadius = CornerRadius(maxOf(0.7f, pad)),
            )
            i++
        }

        put(0, 0)
        for (k in 0 until s.top) put(0, k + 1)
        put(0, cols - 1)
        for (k in 0 until s.right) put(k + 1, cols - 1)
        put(rows - 1, cols - 1)
        for (k in 0 until s.bottom) put(rows - 1, cols - 2 - k)
        put(rows - 1, 0)
        for (k in 0 until s.left) put(rows - 2 - k, 0)
    }
}

/**
 * The same drawing, for a caller holding a whole board rather than its
 * preview — which is most of them.
 *
 * A board the server sent no preview for wears its own glyph, scaled to the
 * same square, rather than leaving a hole where a board goes. Every card in
 * the app would otherwise have to remember that, and the one that forgot
 * would be the one on the shop shelf.
 */
@Composable
fun MiniBoard(board: BoardListing, modifier: Modifier = Modifier, dim: Boolean = false) {
    val preview = board.preview
    if (preview != null) {
        MiniBoard(preview, modifier, dim)
        return
    }
    val ink = P.current.ink2.let { if (dim) it.copy(alpha = 0.34f) else it }
    val glyph = mapGlyph(board.icon)
    Canvas(modifier.fillMaxWidth().aspectRatio(1f)) {
        val side = size.minDimension * 0.42f
        translate((size.width - side) / 2f, (size.height - side) / 2f) {
            with(Art) { drawGlyph(glyph, side, ink) }
        }
    }
}

/**
 * A board's badge where there is no drawing to show instead.
 *
 * Ported from iOS's `mapGlyph`. Country boards carry their nation's flag,
 * which is exactly the mark that cannot be drawn everywhere — they all fall
 * through to the folded map.
 */
fun mapGlyph(mark: String?): String =
    // U+FE0F first, by number rather than as a character nothing renders: half
    // the marks on the wire carry the variation selector and half do not, and
    // "⚡" and "⚡️" are two different strings to a `when`.
    when (mark.orEmpty().filter { it.code != 0xFE0F }) {
        "🌐" -> "globe"
        "🌍" -> "plane"   // "Mr. Worldwide" — the board that travels
        "☠" -> "skull"
        "⚡" -> "bolt"
        "🍀" -> "sparkle"
        "🎲" -> "dice"
        else -> "map"
    }

/**
 * One line that shrinks to fit rather than ellipsising away.
 *
 * iOS writes this as `.lineLimit(1).minimumScaleFactor(0.8)` and leans on it
 * for every board name it draws. The names are why: "The Great White North"
 * is twenty-one characters going into a box a third of a phone wide, and cut
 * to "The Great Whi…" it identifies nothing — which is the same failure the
 * emoji-and-name row had, the one these boxes replaced. Four-fifths the size
 * still reads, and still says which board it is.
 *
 * Compose has no such modifier on this BOM: TextAutoSize landed in Foundation
 * 1.8 and this project is on 2024.10.01. So one measure, not a loop — a
 * single line's width tracks its font size closely enough that the ratio
 * between the width the text wants and the width it is being given IS the
 * scale. Floored at [minScale], because below that small is its own kind of
 * unreadable and the layout is what wants fixing.
 */
@Composable
fun FitText(
    text: String,
    modifier: Modifier = Modifier,
    color: Color,
    fontSize: TextUnit,
    fontWeight: FontWeight = FontWeight.Bold,
    minScale: Float = 0.8f,
    textAlign: TextAlign? = null,
) {
    val measurer = rememberTextMeasurer()
    // Measured in the style it will actually be drawn in — Text merges these
    // two over whatever style the tree is providing, so the measurement has
    // to start from the same place or it is measuring a different font.
    val style = LocalTextStyle.current.merge(
        TextStyle(fontSize = fontSize, fontWeight = fontWeight),
    )
    // The box wraps the line, so a centred caller is centred by whatever column
    // it sits in, exactly as the plain Text it replaced was. This is for the
    // caller who hands it a width instead: inside a box wider than the line,
    // [textAlign] is what says where in that width the line goes.
    BoxWithConstraints(
        modifier,
        contentAlignment = when (textAlign) {
            TextAlign.Center -> Alignment.Center
            TextAlign.End, TextAlign.Right -> Alignment.CenterEnd
            else -> Alignment.CenterStart
        },
    ) {
        val room = constraints.maxWidth
        // A parent that offers infinite width — a horizontal scroll, an
        // intrinsic pass — is not asking for anything to fit inside it.
        val scale = if (!constraints.hasBoundedWidth || room <= 0) {
            1f
        } else {
            val wanted = measurer.measure(
                text = text,
                style = style,
                softWrap = false,
                maxLines = 1,
            ).size.width
            // A shade under the ratio the two widths give, rather than the
            // ratio itself. Letter spacing is set in sp and does not shrink
            // with the glyphs it separates, and a measured width is a whole
            // number of pixels — so a line scaled to exactly the room it has
            // can still come back a pixel over, and a pixel over is an
            // ellipsis eating the last letter of the name.
            if (wanted <= room) 1f else (room * 0.98f / wanted).coerceAtLeast(minScale)
        }
        Text(
            text,
            color = color,
            fontSize = fontSize * scale,
            fontWeight = fontWeight,
            textAlign = textAlign,
            maxLines = 1,
            // Only reachable once the floor has stopped the shrinking, and
            // then an ellipsis says so rather than a glyph sliced down the
            // middle.
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** What a box says under its name — and it never says two things at once. */
@Composable
fun BoardTag(board: BoardListing, modifier: Modifier = Modifier) {
    val p = P.current
    val locked = board.how == "locked"
    val text: String
    val fg: Color
    val bg: Color
    when (board.how) {
        "house" -> { text = "ALWAYS FREE"; fg = p.ink3; bg = p.sunken }
        "today" -> { text = "FREE TODAY"; fg = p.good; bg = p.good.copy(alpha = 0.14f) }
        "owned" -> { text = "YOURS"; fg = p.gold; bg = p.goldSoft }
        // Paid for, and good for this table only. It says how long it lasts,
        // because that is the whole difference from the one above.
        "rented" -> { text = "ONE GAME"; fg = p.gold; bg = p.goldSoft }
        else -> { text = "${board.price}"; fg = p.gold; bg = if (board.was == null) p.sunken else p.goldSoft }
    }
    Row(
        modifier
            .clip(RoundedCornerShape(99.dp))
            .background(bg)
            .padding(horizontal = 6.dp, vertical = 2.5.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (locked) Icon("coin", size = 8.5.dp)
        // The old price, struck through, only while there really is an old
        // price — a "was" that matches the price is the oldest lie in retail,
        // which is why the server sends it only when it is true.
        if (locked) board.was?.let {
            Text(
                "$it",
                color = p.ink3, fontSize = 8.5.sp, fontWeight = FontWeight.Bold,
                textDecoration = TextDecoration.LineThrough, maxLines = 1,
            )
        }
        // The tracking is handed down rather than passed in: [FitText] takes
        // a size and a weight and nothing else — every caller in the app
        // agrees on that signature — and it measures in whatever style the
        // tree is providing. So this is the one place that can say "0.3sp of
        // air between these letters" and have the measurement and the drawing
        // agree about it.
        CompositionLocalProvider(
            LocalTextStyle provides LocalTextStyle.current.copy(letterSpacing = 0.3.sp),
        ) {
            FitText(text, color = fg, fontSize = 8.5.sp, fontWeight = FontWeight.Black)
        }
    }
}

// ────────────────────────────────────────────────────────────── three boxes ──

/**
 * The lobby's board row: three boxes, a way through to the rest, and a clock
 * counting down to the next two.
 *
 * The section label above it belongs to the lobby, which already draws one for
 * every other group of settings — this starts at the boxes so the board does
 * not get a heading in a different hand from Money and Rules.
 *
 * [editable] is the lobby's own host-and-not-a-quick-table gate. A guest still
 * sees the boards, and can still open the shop to read a price; they simply
 * cannot deal one.
 */
@Composable
fun BoardBoxes(
    store: AccountStore,
    game: GameStore,
    editable: Boolean,
    onOpenAll: () -> Unit,
    onShop: (String) -> Unit,
) {
    val p = P.current
    val current = game.state?.mapId ?: game.state?.settings?.mapId ?: "classic"

    // Asked with this table in hand, because a rented board only reads as
    // playable when the server is told which table is asking. Keyed on the
    // room: the same wallet gets a different answer in a different lobby.
    LaunchedEffect(game.roomId) {
        store.loadBoards(game.roomId)
        store.rolloverIfDue()
    }

    val shelf = store.boards
    val trio = store.trio(current)

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (trio.isEmpty()) {
            // The same height before the shelf lands as after, so the sheet
            // does not jump under the reader's thumb when it does.
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(126.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(p.sunken),
            )
        } else {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (board in trio) {
                    BoardBox(board, board.id == current, editable, Modifier.weight(1f)) {
                        if (board.playable) game.updateSettings(mapOf("mapId" to board.id))
                        else onShop(board.id)
                    }
                }
                repeat(3 - trio.size) { Spacer(Modifier.weight(1f)) }
            }
        }

        val all = shelf?.boards.orEmpty()
        Row(
            Modifier
                .fillMaxWidth()
                .height(42.dp)
                .clip(RoundedCornerShape(13.dp))
                .background(p.sunken)
                .border(1.dp, p.rule, RoundedCornerShape(13.dp))
                .clickable { SoundKit.click(); onOpenAll() }
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("All boards", color = p.ink, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold)
            Spacer(Modifier.weight(1f))
            Text(
                "${all.size} boards · ${all.count { !it.playable }} locked",
                color = p.ink3, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
            )
            // iOS's chevron.right: the row goes somewhere, and says so.
            Spacer(Modifier.width(6.dp))
            RowChevron(p.ink3, size = 10.dp)
        }

        shelf?.until?.takeIf { it > 0 }?.let { BoardClock(store, it) }
    }
}

/** One of the three: the board, its name, and the one line under it. */
@Composable
private fun BoardBox(
    board: BoardListing,
    selected: Boolean,
    editable: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val p = P.current
    Column(
        modifier
            .alpha(if (editable) 1f else 0.62f)
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) p.goldSoft else p.card)
            .border(
                if (selected) 2.dp else 1.dp,
                if (selected) p.gold else p.rule,
                RoundedCornerShape(14.dp),
            )
            .clickable(enabled = editable) { SoundKit.click(); onClick() }
            .padding(horizontal = 6.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        val preview = board.preview
        if (preview != null) {
            MiniBoard(
                preview,
                Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(p.page)
                    .padding(3.dp),
                dim = !board.playable,
            )
        } else {
            // No drawing to show: the board's own mark, at iOS's twenty-six,
            // in a square the size the drawing would have had.
            Box(Modifier.fillMaxWidth().aspectRatio(1f), contentAlignment = Alignment.Center) {
                Icon(mapGlyph(board.icon), size = 26.dp, tint = p.ink2)
            }
        }
        // Floored lower than anywhere else the name is drawn, because this is
        // the narrowest place it has to fit: a third of a phone, and the shelf
        // is carrying "The Great White North".
        FitText(
            board.name,
            color = p.ink, fontSize = 11.5.sp, fontWeight = FontWeight.ExtraBold,
            minScale = 0.75f, textAlign = TextAlign.Center,
        )
        BoardTag(board)
    }
}

/**
 * "Two new free boards in 6h 12m" — and the trigger as well as the line.
 *
 * Nobody should have to close and reopen the lobby to be given the new pair,
 * so when it runs out it asks for the shelf again. It asks through
 * [AccountStore.rolloverIfDue], which already remembers which table the kept
 * shelf was fetched for; a forced reload from here would have to guess.
 */
@Composable
fun BoardClock(store: AccountStore, until: Double, modifier: Modifier = Modifier) {
    val now = boardTick(1_000L)
    val left = until.toLong() - now
    LaunchedEffect(left > 0) { if (left <= 0) store.rolloverIfDue() }
    Text(
        if (left > 0) "Two new free boards in ${freeBoardCountdown(left)}" else "New boards…",
        modifier = modifier.fillMaxWidth(),
        color = P.current.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold,
        textAlign = TextAlign.Center,
    )
}

// ───────────────────────────────────────────────────────────────── all of them ──

/**
 * Every board there is, on three shelves, in the order somebody shops: what
 * is free right now, what they already own, and what still has a price.
 *
 * Drawn into its caller's own scroll, which is why the grid is chunked rows
 * rather than a LazyVGrid — a lazy grid inside a scrolling column is an
 * unbounded height, and Compose says so by crashing.
 */
@Composable
fun AllBoards(
    store: AccountStore,
    game: GameStore,
    editable: Boolean,
    onPick: (String) -> Unit,
    onShop: (String) -> Unit,
    onBack: () -> Unit,
    /**
     * False when the sheet around this lays [AllBoardsBar] out itself, above
     * its scroll, so the bar stays put while the list moves under it as
     * iOS's navigation bar does.
     */
    showBar: Boolean = true,
) {
    val p = P.current
    val current = game.state?.mapId ?: game.state?.settings?.mapId ?: "classic"

    // Opening the full list is somebody asking what there is, so it asks the
    // server rather than answering from whatever the row had in hand.
    LaunchedEffect(Unit) { store.loadBoards(game.roomId, force = true) }

    val shelf = store.boards
    val all = shelf?.boards.orEmpty()
    val free = all.filter { it.how == "house" || it.how == "today" || it.how == "rented" }
    val mine = all.filter { it.how == "owned" }
    val locked = all.filter { it.how == "locked" }
    val coins = store.wallet?.coins ?: shelf?.coins ?: 0

    Column {
        if (showBar) {
            AllBoardsBar(store, onBack)
            Spacer(Modifier.height(8.dp))
        }

        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            shelf?.until?.takeIf { it > 0 }?.let { BoardClock(store, it, Modifier.padding(top = 2.dp)) }

            BoardShelfGroup(
                free, "Playable now",
                "Classic is free forever. Two more rotate every day — every board " +
                    "comes round once every ${shelf?.cycleDays ?: 12} days.",
                current, editable, onPick, onShop,
            )
            BoardShelfGroup(
                mine, "Yours", "Bought and kept. Play them whenever you like.",
                current, editable, onPick, onShop,
            )
            BoardShelfGroup(
                locked, "In the store",
                "Buy one and it is yours for good — or pay ${shelf?.rent?.price ?: 1} coin to play " +
                    "it once at this table. Only the host needs it; everyone plays it with you.",
                current, editable, onPick, onShop,
            )
        }
    }
}

/**
 * The Boards page's bar: the purse on the left, where the back button would
 * sit, because it is the one number a player reads before a price; the title;
 * and Done.
 */
@Composable
fun AllBoardsBar(store: AccountStore, onBack: () -> Unit) {
    val p = P.current
    val coins = store.wallet?.coins ?: store.boards?.coins ?: 0
    NavBar("Boards", "Done", onBack) {
        BarCapsule {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon("coin", size = 12.dp)
                Spacer(Modifier.width(4.dp))
                Text("$coins", color = p.gold, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold)
            }
        }
    }
}

/** The shop page's bar: its title, and Close. */
@Composable
fun ShopBar(onBack: () -> Unit) {
    NavBar("Unlock a board", "Close", onBack)
}

/**
 * The bar iOS's navigation stack draws over a sheet: the title centred, and
 * its toolbar items as the system draws them — the same pale 44-point capsule
 * the settings' Done wears, the word in the system's label colour (nothing
 * tints these; only the settings sheet tints its own Done), and no sound of
 * their own. Forty-four high, as the iPhone's is.
 */
@Composable
private fun NavBar(
    title: String,
    action: String,
    onAction: () -> Unit,
    leading: (@Composable () -> Unit)? = null,
) {
    val p = P.current
    val label = if (p.sheet.luminance() < 0.5f) Color.White else Color.Black
    Box(Modifier.fillMaxWidth().height(44.dp)) {
        if (leading != null) {
            Box(Modifier.align(Alignment.CenterStart)) { leading() }
        }
        Text(
            title,
            modifier = Modifier.align(Alignment.Center).padding(horizontal = 72.dp),
            color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        BarCapsule(Modifier.align(Alignment.CenterEnd), onClick = onAction) {
            Text(action, color = label, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

/**
 * One toolbar item's capsule: 44 high, the card a shade toward the sunken
 * fill, with the faint lighter rim the iPhone draws round it.
 */
@Composable
private fun BarCapsule(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val p = P.current
    Box(
        modifier
            .height(44.dp)
            .clip(CircleShape)
            .background(lerp(p.card, p.sunken, 0.5f))
            .border(1.dp, p.rule2, CircleShape)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button) { onClick() } else Modifier)
            .padding(horizontal = 15.dp),
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}

/** iOS's PanelTitle: small capitals, one point apart, in the quietest ink. */
@Composable
private fun PanelTitle(text: String) {
    Text(
        text.uppercase(),
        color = P.current.ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
    )
}

/** One shelf, and nothing at all when the shelf is empty. */
@Composable
private fun BoardShelfGroup(
    list: List<BoardListing>,
    title: String,
    sub: String,
    current: String,
    editable: Boolean,
    onPick: (String) -> Unit,
    onShop: (String) -> Unit,
) {
    if (list.isEmpty()) return
    val p = P.current
    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
        PanelTitle(title)
        Text(sub, color = p.ink3, fontSize = 11.5.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (row in list.chunked(2)) {
                // Centred against each other, as a grid row on the iPhone
                // centres a shorter card beside a taller one.
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    for (board in row) {
                        PickerCard(board, board.id == current, editable, Modifier.weight(1f)) {
                            if (!board.playable) onShop(board.id) else onPick(board.id)
                        }
                    }
                    repeat(2 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** A board on the full list: the drawing, what it is, and what it costs. */
@Composable
private fun PickerCard(
    board: BoardListing,
    selected: Boolean,
    editable: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val p = P.current
    // A locked card is still live even for a guest — it is the way into the
    // shop, and reading a price is not changing the table.
    val live = !board.playable || editable
    Column(
        modifier
            .alpha(if (live) 1f else 0.62f)
            .clip(RoundedCornerShape(16.dp))
            .background(if (selected) p.goldSoft else p.card)
            .border(
                if (selected) 2.dp else 1.dp,
                if (selected) p.gold else p.rule,
                RoundedCornerShape(16.dp),
            )
            .clickable(enabled = live) { SoundKit.click(); onClick() }
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        board.preview?.let {
            MiniBoard(
                it,
                Modifier.clip(RoundedCornerShape(10.dp)).background(p.page).padding(4.dp),
                dim = !board.playable,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(mapGlyph(board.icon), size = 13.dp, tint = p.ink2)
            Spacer(Modifier.width(5.dp))
            FitText(
                board.name,
                color = p.ink, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold,
            )
        }
        Text(
            board.description,
            color = p.ink3, fontSize = 11.sp, lineHeight = 14.sp,
            fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
        // Three of the places on it. A description tells you what a board is
        // about; the names tell you whether it is yours.
        if (board.teaser.isNotEmpty()) {
            Text(
                board.teaser,
                color = p.ink2, fontSize = 10.5.sp, lineHeight = 13.sp,
                fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "${board.size} tiles",
                color = p.ink3, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.weight(1f))
            BoardTag(board)
        }
    }
}

// ────────────────────────────────────────────────────────────── unlocking one ──

/**
 * Buying a board where you found it — or borrowing it for one game.
 *
 * The shop is a whole tab away, and bouncing somebody out of the lobby, into
 * a tab, down a page and back again to spend six hundred coins is four steps
 * too many. So the price is paid here, next to the board it buys, with the
 * board itself as the thing being looked at.
 *
 * The second button is the one-coin door: one game, at this table. It is
 * offered only from a lobby this player is hosting, because a pass is good at
 * one table and the board is only ever read against the host's wallet —
 * anywhere else the coin would buy nothing. [game] is null where there is no
 * table at all — the Store — and the door is simply not there.
 *
 * A refusal is iOS's error toast. Both sheets this page is drawn in at a
 * table (the lobby's list, and the settings' stacked pages) draw the table's
 * toast over themselves, so it is seen there. With no table in hand — the
 * Store — there is no toast to raise from here, and the refusal is said in
 * the body of the page instead. A purchase that worked closes the page, and
 * its sentence goes up as a toast as iOS's does.
 */
@Composable
fun BoardShop(
    store: AccountStore,
    game: GameStore?,
    board: BoardListing,
    onBought: (String) -> Unit,
    onBack: () -> Unit,
    /** False when the sheet around this lays [ShopBar] out above its scroll. */
    showBar: Boolean = true,
) {
    val p = P.current
    var busy by remember { mutableStateOf(false) }
    var renting by remember { mutableStateOf(false) }
    var refused by remember(board.id) { mutableStateOf<String?>(null) }
    // A refusal the server gave no words for is iOS's own sentence, not the
    // account store's general one.
    fun refusal(error: String): String =
        if (error == NOTHING_CHANGED) "Couldn't reach the shop — try again." else error
    val say: (String) -> Unit = { error ->
        val words = refusal(error)
        if (game != null) game.showToast(words, isError = true) else refused = words
    }

    // The balance matters more here than anywhere else in the app.
    LaunchedEffect(board.id) { store.refreshStore() }

    val shelf = store.boards
    // A wallet fetch that quietly failed used to leave this reading zero, so a
    // player with nine hundred coins was told they needed five hundred more.
    val coins = store.wallet?.coins ?: shelf?.coins ?: 0
    val short = maxOf(0, board.price - coins)
    val rentPrice = shelf?.rent?.price ?: 1

    // The table a rent would be good at — a lobby, with this player hosting.
    // A cup table is set by the cup and refuses every board change for as long
    // as it exists, and a quick table deals its own; a pass bought at either
    // could never be spent there. The server turns those rents down for the
    // same reason — this is so nobody is invited to reach for a coin button
    // that cannot work.
    val state = game?.state
    val spendable = state != null && state.isLobby && state.cup != true && state.quick != true
    val rentRoom = game?.roomId?.takeIf { it.isNotBlank() && spendable && game?.isHost == true }

    // A game already paid for and never played. It moves rather than being
    // charged for twice — the server decides that; this only reads it.
    val holding = shelf?.rent?.holding
    val movingHere = holding != null && !(holding.mapId == board.id && holding.roomId == rentRoom.orEmpty())
    val rentLabel = when {
        holding == null -> "Play one game — $rentPrice coin"
        movingHere -> "Move your unplayed game here"
        else -> "Play this game — already paid"
    }
    val rentLine = when {
        holding == null ->
            "$rentPrice coin plays one game here, on this table. Unplayed, it keeps: rent a " +
                "different board and the same game moves with you."
        movingHere ->
            "You have a game you paid for and never played. It moves to this table and this " +
                "board — nothing more to pay."
        else -> "Paid for and waiting. It is spent when this table deals, and only then."
    }

    Column {
        if (showBar) {
            ShopBar(onBack)
            Spacer(Modifier.height(8.dp))
        }

        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            board.preview?.let {
                MiniBoard(
                    it,
                    Modifier
                        .widthIn(max = 260.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(p.page)
                        .border(1.dp, p.rule, RoundedCornerShape(16.dp))
                        .padding(8.dp),
                )
            }

            Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Text(board.name, color = p.ink, fontSize = 21.sp, fontWeight = FontWeight.Black)
                Text(
                    board.description,
                    color = p.ink2, fontSize = 13.sp, lineHeight = 18.sp,
                    fontWeight = FontWeight.Medium, textAlign = TextAlign.Center,
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                BoardStat("${board.size}", "tiles")
                if (board.streets > 0) { Spacer(Modifier.width(14.dp)); BoardStat("${board.streets}", "streets") }
                if (board.countries > 0) { Spacer(Modifier.width(14.dp)); BoardStat("${board.countries}", "sets") }
            }

            // The board itself, in words. A rim of coloured chips says a board
            // exists; this says whether you want it — and it is the only thing
            // on this page anybody reads twice.
            if (board.sets.isNotEmpty()) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(p.sunken)
                        .border(1.dp, p.rule, RoundedCornerShape(14.dp))
                        .padding(13.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        "WHAT'S ON IT",
                        color = p.ink3, fontSize = 10.sp, letterSpacing = 0.7.sp, fontWeight = FontWeight.Black,
                    )
                    for (set in board.sets) {
                        Row {
                            Box(
                                Modifier
                                    .padding(top = 3.dp)
                                    .size(9.dp)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(cssColor(set.color, p.red)),
                            )
                            Spacer(Modifier.width(8.dp))
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                                Text(
                                    set.name,
                                    color = p.ink, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold,
                                )
                                Text(
                                    set.cities.joinToString(", "),
                                    color = p.ink2, fontSize = 11.5.sp, lineHeight = 15.sp,
                                    fontWeight = FontWeight.Medium,
                                )
                            }
                        }
                    }
                }
            }

            Text(
                "Buy it once and it is yours for good. Only the host needs to own a board — " +
                    "everyone at your table plays it with you.",
                modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp),
                color = p.ink3, fontSize = 12.sp, lineHeight = 16.sp,
                fontWeight = FontWeight.Medium, textAlign = TextAlign.Center,
            )

            // The price on a button, and the old one struck through in front of
            // it while there really is a sale. While the call is out the coin
            // gives way to a spinner, as iOS's does — the button itself stays
            // solid and simply stops answering.
            val buyKind = if (short > 0) LandingKind.GHOST else LandingKind.PRIMARY
            LandingButton(
                "",
                buyKind,
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy && short == 0,
                lead = { ink ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (busy) LandingSpinner(ink, size = 16.dp) else Icon("coin", size = 16.dp)
                        Spacer(Modifier.width(7.dp))
                        if (board.was != null && short == 0) {
                            Text(
                                "${board.was}",
                                color = ink.copy(alpha = 0.55f), fontSize = 14.sp, fontWeight = FontWeight.Bold,
                                textDecoration = TextDecoration.LineThrough,
                            )
                            Spacer(Modifier.width(7.dp))
                        }
                        Text(
                            if (short > 0) "$short more coins needed" else "Unlock for ${board.price}",
                            color = ink, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold,
                        )
                    }
                },
            ) {
                busy = true
                refused = null
                SoundKit.click()
                store.buyBoard(board, quiet = true) { error ->
                    busy = false
                    error?.let(say)
                    if (error == null) {
                        SoundKit.buy()
                        game?.showToast("${board.name} is yours!")
                        onBought(board.id)
                    }
                }
            }

            Text(
                when {
                    short > 0 ->
                        "You have $coins. Win a game, collect the daily reward, or top up in the Store tab."
                    board.was != null -> "You have $coins coins. On sale today — three boards are, every day."
                    else -> "You have $coins coins."
                },
                color = p.ink3, fontSize = 11.5.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold,
            )

            // One coin, one game. Offered under the price rather than beside it:
            // buying the board is still the thing this page is for, and this is
            // the cheaper way in.
            if (board.rentable && rentRoom != null && (coins >= rentPrice || holding != null)) {
                LandingButton(
                    "",
                    LandingKind.GHOST,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !busy && !renting,
                    lead = { ink ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (renting) LandingSpinner(ink, size = 15.dp) else Icon("coin", size = 15.dp)
                            Spacer(Modifier.width(7.dp))
                            Text(rentLabel, color = ink, fontSize = 14.5.sp, fontWeight = FontWeight.ExtraBold)
                        }
                    },
                ) {
                    renting = true
                    refused = null
                    SoundKit.click()
                    // What was charged says which of iOS's two sentences this
                    // is: a game sold, or an unplayed one moved here for
                    // nothing.
                    store.rentBoard(board.id, rentRoom, quiet = true) { error, charged ->
                        renting = false
                        error?.let(say)
                        if (error == null) {
                            SoundKit.buy()
                            game?.showToast(
                                if (charged > 0) "${board.name} for one game — good at this table"
                                else "Your unplayed game moved to ${board.name}",
                            )
                            onBought(board.id)
                        }
                    }
                }
                Text(
                    rentLine,
                    color = p.ink3, fontSize = 11.5.sp, lineHeight = 16.sp,
                    fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                )
            }

            refused?.let {
                Text(
                    it,
                    modifier = Modifier.fillMaxWidth(),
                    color = p.bad, fontSize = 12.5.sp, lineHeight = 17.sp,
                    fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/** AccountStore's words for a refusal that came with none of the server's own. */
private const val NOTHING_CHANGED = "That didn't go through, and nothing has changed. Try again."

/** One number with its word under it, three of them across. */
@Composable
private fun BoardStat(n: String, label: String) {
    val p = P.current
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(n, color = p.ink, fontSize = 16.sp, fontWeight = FontWeight.Black)
        Text(label, color = p.ink3, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
    }
}

// ────────────────────────────────────────────────────────────────── the clock ──

/**
 * The wall clock, ticking into a recomposition. A private copy of the one
 * CupSheets keeps to itself — one shared clock helper is a bigger change to
 * make than four lines are to write twice.
 */
@Composable
private fun boardTick(everyMs: Long): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(everyMs) {
        while (true) {
            delay(everyMs)
            now = System.currentTimeMillis()
        }
    }
    return now
}

/**
 * The countdown to the next pair. Its own function rather than the one in
 * CupSheets, which is private to it and counts to a different kind of
 * deadline — a cup door shuts once, this comes round every night.
 */
private fun freeBoardCountdown(ms: Long): String {
    // To the nearest second, as iOS rounds it, so both phones say the same.
    val left = ((ms.coerceAtLeast(0L) + 500L) / 1000L).toInt()
    if (left >= 86400) return "${left / 86400}d ${left % 86400 / 3600}h"
    if (left >= 3600) return "${left / 3600}h ${left % 3600 / 60}m"
    return "%d:%02d".format(left / 60, left % 60)
}
