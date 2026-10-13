package com.moneymove.game

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Build
import android.text.TextPaint
import android.text.TextUtils
import android.util.Log
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.text.DateFormat
import java.util.Date
import android.graphics.Canvas as AndroidCanvas
import androidx.compose.ui.graphics.Canvas as ComposeCanvas

/**
 * Share your result (1.0.6): the game that just ended as a picture — the
 * wordmark, the board, who won, the podium with what each of them was worth,
 * where you finished, and the date — handed to Android's share sheet through
 * a FileProvider, so it lands in a chat or a story as an image and not as a
 * link somebody has to open to see anything.
 *
 * The text share stays beside it: a picture carries no link, and the link is
 * what seats a friend. The words ride along with the picture too, for the
 * apps that take both.
 *
 * Three parts, kept apart on purpose. [ResultCardData] is what the card says,
 * worked out from the final state with no Android in it, so it is tested on
 * the JVM. [ResultCardPainter] draws that onto a bitmap with the platform's
 * own canvas — no composition, no window, so it renders the same off screen
 * on any phone. [ResultShare] writes the file and opens the sheet.
 */
data class ResultCardData(
    val board: String,
    /** "Asha" or "Team Azure" — the result headline's own words. */
    val winner: String,
    val winnerColor: String,
    /** The top three of the standings, in order. */
    val podium: List<PodiumSeat>,
    /** This phone's best seat's place, one-based; null for somebody who only watched. */
    val place: Int?,
    val seats: Int,
    val won: Boolean,
    val teamGame: Boolean,
    val timeUp: Boolean,
    /** Epoch ms the card was made, for the date at its foot. */
    val date: Long,
) {
    data class PodiumSeat(
        val name: String,
        val flag: String,
        val color: String,
        val avatar: String,
        val worth: Int,
        /** "bankrupt", "left the game" … for a seat that did not finish standing. */
        val outcome: String?,
        /** One of this phone's seats — the row is lifted on the card. */
        val mine: Boolean,
    )

    /** The line under the podium: where you finished, in the first person, because it is yours to post. */
    val placeLine: String
        get() = when {
            place == null -> "Watched it live"
            won && teamGame -> "My team won"
            won -> "I won"
            else -> "I finished ${ordinal(place)} of $seats"
        }

    companion object {
        /**
         * The card for a finished table. The standings are [PlayerResult]'s
         * own order — the one the result sheet lists and History files — so
         * the picture and the sheet behind it never disagree about who came
         * second.
         */
        fun of(
            state: GameState,
            isLocal: (String) -> Boolean,
            won: Boolean,
            now: Long = System.currentTimeMillis(),
        ): ResultCardData {
            val results = PlayerResult.snapshot(state)
            val mine = results.indexOfFirst { isLocal(it.id) }.takeIf { it >= 0 }
            val team = state.winningTeamInfo
            return ResultCardData(
                board = state.map.name.ifBlank { "MoneyMove" },
                winner = state.winnerLabel,
                winnerColor = team?.color ?: state.winner?.color.orEmpty(),
                podium = results.take(3).map {
                    PodiumSeat(
                        name = it.name,
                        flag = it.flag.orEmpty(),
                        color = it.color,
                        avatar = it.avatar.orEmpty(),
                        worth = it.worth,
                        outcome = it.outcomeLabel,
                        mine = isLocal(it.id),
                    )
                },
                place = mine?.plus(1),
                seats = results.size,
                won = won && mine != null,
                teamGame = team != null,
                timeUp = state.endedOnClock,
                date = now,
            )
        }
    }
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
fun ordinal(n: Int): String {
    val suffix = if (n % 100 in 11..13) "th" else when (n % 10) {
        1 -> "st"
        2 -> "nd"
        3 -> "rd"
        else -> "th"
    }
    return "$n$suffix"
}

/**
 * The card itself, 1080 by 1350 — the 4:5 portrait the feeds show whole.
 *
 * It wears the brand rather than the player's table style: Midnight Felt's
 * night colours, the ivory die on its gold ring and the two-tone wordmark,
 * the way the app introduces itself. A picture that leaves the app is the
 * app's face to somebody who has never opened it, so it is the same face
 * whichever style the sender plays on.
 */
object ResultCardPainter {
    const val WIDTH = 1080
    const val HEIGHT = 1350

    private const val PAGE_TOP = 0xFF14251D.toInt()
    private const val PAGE_FOOT = 0xFF070B09.toInt()
    private const val CARD = 0xFF16211C.toInt()
    private const val LIFT = 0xFF223129.toInt()
    private const val RULE = 0xFF2B3D34.toInt()
    private const val INK = 0xFFEFEDE2.toInt()
    private const val INK2 = 0xFFADB6AC.toInt()
    private const val INK3 = 0xFF78827A.toInt()
    private const val GOLD = 0xFFD9A13A.toInt()
    private const val GOLD_SOFT = 0xFF2C2413.toInt()
    private const val ACCENT = 0xFFE3A93C.toInt()
    private const val IVORY = 0xFFFFFCF4.toInt()
    private const val IVORY2 = 0xFFEFE7D8.toInt()
    private const val PIP = 0xFF1B5E3F.toInt()

    private const val MARGIN = 60f
    private val MEDALS = listOf("medalGold", "medalSilver", "medalBronze")

    fun render(card: ResultCardData): Bitmap {
        val bmp = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888)
        val c = AndroidCanvas(bmp)
        val w = WIDTH.toFloat()
        val mid = w / 2

        // The page: the felt's night ramp, and a warm glow behind the trophy.
        val page = Paint().apply {
            shader = LinearGradient(0f, 0f, 0f, HEIGHT.toFloat(), PAGE_TOP, PAGE_FOOT, Shader.TileMode.CLAMP)
        }
        c.drawRect(0f, 0f, w, HEIGHT.toFloat(), page)
        val glow = Paint().apply {
            shader = RadialGradient(mid, 560f, 560f, (GOLD and 0x00FFFFFF) or 0x30000000, 0x00000000, Shader.TileMode.CLAMP)
        }
        c.drawRect(0f, 0f, w, HEIGHT.toFloat(), glow)

        drawLogo(c, mid, 150f, 110f)

        // MONEY in ivory, MOVE in the accent — the wordmark's two halves.
        val word = text(76f, 900, INK).apply { letterSpacing = 0.04f }
        val money = "MONEY"
        val move = "MOVE"
        val wordWidth = word.measureText(money) + word.measureText(move)
        var x = mid - wordWidth / 2
        c.drawText(money, x, 312f, word)
        x += word.measureText(money)
        c.drawText(move, x, 312f, word.apply { color = ACCENT })

        val boardLine = text(38f, 600, INK2)
        drawCentred(c, fit("Played on ${card.board}", boardLine, w - MARGIN * 2), mid, 372f, boardLine)

        var y = 408f
        if (card.timeUp) {
            val tag = text(28f, 800, GOLD).apply { letterSpacing = 0.08f }
            val label = "TIME'S UP"
            val tw = tag.measureText(label)
            val pill = RectF(mid - (tw + 92f) / 2, y, mid + (tw + 92f) / 2, y + 56f)
            c.drawRoundRect(pill, 28f, 28f, fill(GOLD_SOFT))
            c.drawRoundRect(pill, 28f, 28f, stroke(GOLD, 2f))
            glyph(c, "hourglass", pill.left + 26f, y + 12f, 32f, Color(GOLD))
            c.drawText(label, pill.left + 66f, y + 38f, tag)
            y += 72f
        }

        glyph(c, "trophy", mid - 60f, y + 6f, 120f, Color(INK))
        y += 140f

        // The headline, in the winner's own colour, shrunk to fit a long
        // team or player name rather than cut.
        val head = text(84f, 900, cssColor(card.winnerColor, Color(INK)).toArgb())
        val headline = "${card.winner} wins!"
        while (head.measureText(headline) > w - MARGIN * 2 && head.textSize > 48f) head.textSize -= 4f
        drawCentred(c, fit(headline, head, w - MARGIN * 2), mid, y + 72f, head)
        y += 112f

        // The podium, on a card of its own.
        val rows = card.podium.size.coerceAtLeast(1)
        val rowH = 124f
        val panel = RectF(MARGIN, y, w - MARGIN, y + 24f * 2 + rowH * rows)
        c.drawRoundRect(panel, 36f, 36f, fill(CARD))
        c.drawRoundRect(panel, 36f, 36f, stroke(RULE, 2f))
        card.podium.forEachIndexed { i, seat ->
            val top = panel.top + 24f + rowH * i
            drawSeat(c, seat, i, RectF(panel.left + 16f, top, panel.right - 16f, top + rowH), last = i == rows - 1)
        }
        y = panel.bottom

        val place = text(52f, 900, if (card.won) GOLD else INK)
        drawCentred(c, fit(card.placeLine, place, w - MARGIN * 2), mid, y + 86f, place)

        // The foot: when, and where to find the game.
        val foot = text(30f, 600, INK3)
        c.drawText(DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(card.date)), MARGIN, HEIGHT - 48f, foot)
        foot.textAlign = Paint.Align.RIGHT
        c.drawText("moneymove.live", w - MARGIN, HEIGHT - 48f, foot)
        return bmp
    }

    /** One podium row: medal, face, name and flag, and what they finished worth. */
    private fun drawSeat(c: AndroidCanvas, seat: ResultCardData.PodiumSeat, rank: Int, box: RectF, last: Boolean) {
        val cy = box.centerY()
        if (seat.mine) c.drawRoundRect(RectF(box.left, box.top + 6f, box.right, box.bottom - 6f), 24f, 24f, fill(LIFT))
        else if (!last) c.drawRect(box.left + 24f, box.bottom - 1f, box.right - 24f, box.bottom + 1f, fill(RULE))

        val medalX = box.left + 20f
        glyph(c, MEDALS[rank.coerceIn(0, 2)], medalX, cy - 32f, 64f, Color(INK))

        // The face: the player's own emoji on their colour, or their initial.
        val faceX = medalX + 64f + 26f + 40f
        c.drawCircle(faceX, cy, 40f, fill(cssColor(seat.color, Color(GOLD)).toArgb()))
        val face = seat.avatar.trim()
        if (face.isNotEmpty()) {
            val emoji = text(44f, 400, INK).apply { textAlign = Paint.Align.CENTER }
            c.drawText(face, faceX, cy + 16f, emoji)
        } else {
            val initial = text(40f, 900, 0xFFFFFFFF.toInt()).apply { textAlign = Paint.Align.CENTER }
            c.drawText((seat.name.firstOrNull() ?: '?').uppercase(), faceX, cy + 14f, initial)
        }

        val right = box.right - 24f
        val worthPaint = if (seat.outcome != null) text(32f, 700, INK3) else text(44f, 900, GOLD)
        worthPaint.textAlign = Paint.Align.RIGHT
        val worth = seat.outcome ?: money(seat.worth)
        c.drawText(worth, right, cy + 15f, worthPaint)

        val nameX = faceX + 40f + 24f
        val name = text(44f, 800, INK)
        val room = right - worthPaint.measureText(worth) - 24f - nameX
        val label = if (seat.flag.isBlank()) seat.name else "${seat.name} ${seat.flag}"
        c.drawText(fit(label, name, room), nameX, cy + 15f, name)
    }

    /** The brand mark: an ivory die showing five, tipped a little, on a gold ring. */
    private fun drawLogo(c: AndroidCanvas, cx: Float, cy: Float, d: Float) {
        c.drawCircle(cx, cy + d * 0.02f, d * 0.62f, stroke((GOLD and 0x00FFFFFF) or 0x8C000000.toInt(), d * 0.02f))
        c.save()
        c.rotate(-11f, cx, cy)
        val face = RectF(cx - d / 2, cy - d / 2, cx + d / 2, cy + d / 2)
        val ivory = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(face.left, face.top, face.right, face.bottom, IVORY, IVORY2, Shader.TileMode.CLAMP)
        }
        c.drawRoundRect(face, d * 0.19f, d * 0.19f, ivory)
        val pip = fill(PIP)
        val off = d * 0.27f
        for ((px, py) in listOf(-1f to -1f, 1f to -1f, 0f to 0f, -1f to 1f, 1f to 1f)) {
            c.drawCircle(cx + px * off, cy + py * off, d * 0.105f, pip)
        }
        c.restore()
    }

    /**
     * One of the app's own drawn glyphs at `size`, top-left at (x, y) — the
     * same drawing the screens use, through Compose's draw scope laid over
     * this canvas, so the medals on the card are the medals in the app.
     */
    private fun glyph(c: AndroidCanvas, name: String, x: Float, y: Float, size: Float, tint: Color) {
        CanvasDrawScope().draw(
            Density(1f), LayoutDirection.Ltr, ComposeCanvas(c),
            Size(WIDTH.toFloat(), HEIGHT.toFloat()),
        ) {
            translate(x, y) { with(Art) { drawGlyph(name, size, tint) } }
        }
    }

    private fun drawCentred(c: AndroidCanvas, s: String, cx: Float, baseline: Float, paint: Paint) {
        c.drawText(s, cx - paint.measureText(s) / 2, baseline, paint)
    }

    /** The text, ellipsised to `width` — a name is cut before it is allowed to run off the card. */
    private fun fit(s: String, paint: TextPaint, width: Float): String =
        TextUtils.ellipsize(s, paint, width.coerceAtLeast(0f), TextUtils.TruncateAt.END).toString()

    private fun text(size: Float, weight: Int, colour: Int): TextPaint =
        TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = size
            color = colour
            typeface = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                Typeface.create(Typeface.DEFAULT, weight, false)
            } else {
                if (weight >= 600) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            }
        }

    private fun fill(colour: Int) = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = colour; style = Paint.Style.FILL }

    private fun stroke(colour: Int, width: Float) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = colour
        style = Paint.Style.STROKE
        strokeWidth = width
    }
}

/**
 * The card onto the share sheet: drawn, written to disk off the main thread,
 * then the chooser, with read access granted to whichever app is picked and
 * no other. One file, overwritten each time, in the cache — so the phone
 * never fills up with old results, and the system may clear it whenever it
 * likes.
 *
 * The drawing itself stays on the caller's thread — the main one. It borrows
 * the screens' own glyph cache ([Art]), which is only ever touched from
 * there, and one card is a few dozen milliseconds of drawing; the PNG, which
 * is the slow part, is what goes to the background.
 */
object ResultShare {
    private const val TAG = "MMShare"

    /** The FileProvider's authority, as the manifest declares it. */
    fun authority(context: Context): String = "${context.packageName}.files"

    /** False when the picture could not be made or nothing would take it — the caller falls back to text. */
    suspend fun share(context: Context, card: ResultCardData, text: String): Boolean {
        val bitmap = runCatching { ResultCardPainter.render(card) }
            .onFailure { Log.w(TAG, "result card: ${it.message}") }
            .getOrNull() ?: return false
        val file = withContext(Dispatchers.IO) {
            runCatching {
                val dir = File(context.cacheDir, "shared").apply { mkdirs() }
                val out = File(dir, "moneymove-result.png")
                out.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()
                out
            }.onFailure { Log.w(TAG, "result card: ${it.message}") }.getOrNull()
        } ?: return false
        return runCatching {
            val uri = FileProvider.getUriForFile(context, authority(context), file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TEXT, text)
                // The grant rides the ClipData as well as the flag: from
                // Android 10 the chooser's own preview reads the picture
                // through it.
                clipData = ClipData.newRawUri("MoneyMove result", uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(send, "Share your result")
            if (context.findActivity() == null) chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(chooser)
        }.onFailure { Log.w(TAG, "share: ${it.message}") }.isSuccess
    }
}
