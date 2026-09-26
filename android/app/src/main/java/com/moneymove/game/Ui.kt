package com.moneymove.game

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.os.Build
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/**
 * The handful of pieces every screen is built out of.
 *
 * Deliberately small and unclever. Material's own components would each need
 * a colour scheme mapped onto the seven table styles and would still not look
 * like the iOS app, so the shared vocabulary is defined here once instead: a
 * button, a panel, a hint, a chip. The same four things the web client's CSS
 * defines, wearing the same palette slots.
 *
 * Further down are the pieces more than one screen needs to say the same
 * thing the same way — a balance in the red, the tags on a seat, an unread
 * count, your flag, an "are you sure", a link sent somewhere. Each is iOS's
 * version of that thing, so a screen that uses it is already at parity on
 * that detail instead of being one more place to get it slightly wrong.
 */

enum class BtnKind { PRIMARY, GOLD, GHOST, GOOD, DANGER, PLAIN }

/**
 * iOS's MMButtonStyle, point for point: seventeen bold on a big button and
 * fourteen on a small one, fourteen- and ten-point corners, 14/22 and 9/14
 * padding, and a faint white rim on every coloured kind. GHOST is iOS's ghost
 * — a filled well in the sunken colour, no outline — so it and PLAIN draw the
 * same; both names stay because both are called.
 *
 * Disabled changes nothing about how it looks. iOS's style never reads the
 * disabled state and its labels carry explicit colours, so a disabled iPhone
 * button stays solid and simply stops answering; the one place iOS wants it
 * faded (the trade dock's Accept) adds its own opacity, and a caller here does
 * the same with Modifier.alpha. Pressing dims and shrinks it a touch, as the
 * iPhone's does, instead of a ripple.
 *
 * [iconSize] overrides the glyph's size where iOS sets the symbol's own font
 * (a 15-point share arrow on a big button). [fitScale] keeps the label on one
 * line and lets it shrink to that fraction first, iOS's
 * lineLimit(1).minimumScaleFactor.
 */
@Composable
fun MMButton(
    label: String,
    modifier: Modifier = Modifier,
    kind: BtnKind = BtnKind.PLAIN,
    big: Boolean = false,
    icon: String? = null,
    // The price this used to be, struck through in front of the label. It is a
    // parameter rather than part of the label because it is not the same text:
    // a different size, a different weight, and a line through it. Only the
    // buttons that actually charge somebody pass it, and only while the sale
    // is real — the shelves elsewhere draw their own.
    was: Int? = null,
    enabled: Boolean = true,
    iconSize: Dp? = null,
    fitScale: Float? = null,
    onClick: () -> Unit,
) {
    val p = P.current
    // GOLD is its own colour, not a second name for the accent. In Felt the
    // two happen to sit close, but in Crimson and the violet, pink and blue
    // themes p.red is a true red, and Negotiate painted with it read as a
    // second Decline right beside the real one. The ink stays accentInk for
    // both, as iOS's MMButtonStyle has it.
    val bg = when (kind) {
        BtnKind.PRIMARY -> p.red
        BtnKind.GOLD -> p.gold
        BtnKind.GOOD -> p.good
        BtnKind.DANGER -> p.bad
        BtnKind.GHOST, BtnKind.PLAIN -> p.sunken
    }
    val fg = when (kind) {
        BtnKind.PRIMARY, BtnKind.GOLD -> p.accentInk
        BtnKind.GOOD, BtnKind.DANGER -> Color.White
        else -> p.ink
    }
    val plain = kind == BtnKind.GHOST || kind == BtnKind.PLAIN
    val shape = RoundedCornerShape(if (big) 14.dp else 10.dp)
    val touches = remember { MutableInteractionSource() }
    val pressed by touches.collectIsPressedAsState()
    val press by animateFloatAsState(
        if (pressed) 1f else 0f,
        spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMedium),
        label = "press",
    )
    Row(
        modifier
            .graphicsLayer {
                val s = 1f - 0.02f * press
                scaleX = s
                scaleY = s
                alpha = 1f - 0.18f * press
            }
            .clip(shape)
            .background(bg)
            .then(if (plain) Modifier else Modifier.border(1.dp, Color.White.copy(alpha = 0.18f), shape))
            .clickable(
                interactionSource = touches,
                indication = null,
                enabled = enabled,
                role = Role.Button,
            ) { onClick() }
            .padding(horizontal = if (big) 22.dp else 14.dp, vertical = if (big) 14.dp else 9.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, size = iconSize ?: if (big) 19.dp else 15.dp, tint = fg)
            Spacer(Modifier.width(8.dp))
        }
        if (was != null) {
            Text(
                "$was",
                color = fg.copy(alpha = 0.55f),
                fontSize = if (big) 14.sp else 13.sp,
                fontWeight = FontWeight.Bold,
                textDecoration = TextDecoration.LineThrough,
            )
            Spacer(Modifier.width(7.dp))
        }
        if (fitScale != null) {
            FitText(
                label,
                Modifier.weight(1f, fill = false),
                color = fg,
                fontSize = if (big) 17.sp else 14.sp,
                fontWeight = FontWeight.Bold,
                minScale = fitScale,
                textAlign = TextAlign.Center,
            )
        } else {
            Text(
                label,
                color = fg,
                fontSize = if (big) 17.sp else 14.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * A panel: the card surface everything on a screen sits inside — iOS's MMCard,
 * with its sixteen-point corners, hairline, and the soft drop that lifts it
 * off the page. The shadow is the platform's default black at the landing
 * cards' elevation: Android multiplies a shadow colour's own alpha by the
 * theme's, so iOS's 0.10 black handed over as a colour would all but vanish.
 */
@Composable
fun Panel(
    modifier: Modifier = Modifier,
    padding: Dp = 16.dp,
    content: @Composable ColumnScopeAlias.() -> Unit,
) {
    val p = P.current
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier
            .fillMaxWidth()
            .shadow(6.dp, shape, clip = false)
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .padding(padding),
        content = content,
    )
}

typealias ColumnScopeAlias = androidx.compose.foundation.layout.ColumnScope

/** The one-line note under a control, in the quietest ink the table has. */
@Composable
fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier,
        color = P.current.ink3,
        fontSize = 12.5.sp,
        lineHeight = 17.sp,
        fontWeight = FontWeight.Medium,
    )
}

/** A section label: small, wide-tracked, the same one the web client uses. */
@Composable
fun SectionLabel(text: String, icon: String? = null, modifier: Modifier = Modifier) {
    val p = P.current
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) {
            Icon(icon, size = 14.dp, tint = p.red)
            Spacer(Modifier.width(6.dp))
        }
        Text(
            text.uppercase(),
            color = p.ink3,
            fontSize = 11.sp,
            // iOS's PanelTitle kerns a single point.
            letterSpacing = 1.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

/** A small rounded chip — a tag, a count, a state. */
@Composable
fun Chip(
    label: String,
    modifier: Modifier = Modifier,
    icon: String? = null,
    tint: Color? = null,
) {
    val p = P.current
    val c = tint ?: p.ink2
    Row(
        modifier
            .clip(RoundedCornerShape(99.dp))
            .background(p.sunken)
            .padding(horizontal = 9.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, size = 12.dp, tint = c)
            if (label.isNotEmpty()) Spacer(Modifier.width(5.dp))
        }
        if (label.isNotEmpty()) {
            Text(label, color = c, fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
        }
    }
}

/** A hairline the width of its parent. */
@Composable
fun Rule(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(P.current.rule))
}

/**
 * Money, written the way every client writes it: no cents, thousands split —
 * and, now that an unpaid debt lives as a negative balance, "−$1,300" with a
 * real minus sign out front, exactly as iOS writes it (Theme.swift, money()).
 * A hyphen is narrower than the digits and reads as a dash beside them.
 */
fun money(v: Int): String {
    val sign = if (v < 0) "\u2212" else ""
    val digits = kotlin.math.abs(v.toLong()).toString()
    val grouped = digits.reversed().chunked(3).joinToString(",").reversed()
    return "$sign$$grouped"
}

/**
 * The locale the iPhone formats numbers and dates in: English, in the phone's
 * own region.
 *
 * The iOS app is written in English alone, and an English-only app's
 * Locale.current is English in the phone's region — "en_IN" on a phone set to
 * Hindi in India — so its numbers group the Indian way and its weekdays are
 * still English words. Android hands every app the phone's whole locale, so
 * taking Locale.getDefault() as it is would print Hindi weekday names, or
 * Arabic-Indic digits, in the middle of an English sentence. The region is
 * kept, so "1,26,000", "1.500" and "20:00" still come out as each phone
 * writes them.
 */
internal fun readerLocale(): java.util.Locale {
    val region = java.util.Locale.getDefault().country
    return if (region.isBlank()) java.util.Locale.ENGLISH else java.util.Locale("en", region)
}

/**
 * An instant as iOS's Date.formatted writes it: the fields a date [skeleton]
 * names, laid out in the order [readerLocale] lays them out. 'j' in the
 * skeleton is the hour, and [twentyFour] — the phone's own 24-hour switch,
 * which outranks the locale's habit on both platforms — decides whether it
 * becomes 'H' or 'h' before the locale sees it.
 */
internal fun clockText(epochMs: Double, skeleton: String, twentyFour: Boolean): String {
    val locale = readerLocale()
    val fields = skeleton.replace('j', if (twentyFour) 'H' else 'h')
    val pattern = android.text.format.DateFormat.getBestDateTimePattern(locale, fields)
    return java.text.SimpleDateFormat(pattern, locale).format(java.util.Date(epochMs.toLong()))
}

/** A player's colour, as the server writes it ("#e3a93c"). */
fun cssColor(raw: String?, fallback: Color): Color {
    val hex = raw?.trim()?.removePrefix("#") ?: return fallback
    return runCatching {
        when (hex.length) {
            6 -> Color(0xFF000000L.or(hex.toLong(16)).toInt())
            8 -> Color(hex.toLong(16).toInt())
            3 -> Color(0xFF000000L.or(hex.map { "$it$it" }.joinToString("").toLong(16)).toInt())
            else -> fallback
        }
    }.getOrDefault(fallback)
}

/**
 * A player's disc, from the seat they are sitting in. See [AvatarDisc], which
 * draws it: this only reads the three things a seat carries.
 */
@Composable
fun PlayerDisc(player: PlayerState, size: Dp = 28.dp, modifier: Modifier = Modifier) {
    AvatarDisc(
        name = player.name,
        color = player.color,
        modifier = modifier,
        size = size,
        flag = player.flag,
        avatar = player.avatar,
    )
}

/**
 * A round avatar disc: the player's colour, their bought face or else their
 * initial, and their country's flag tucked on the bottom-right shoulder.
 *
 * iOS's AvatarView (Theme.swift) at the same proportions — the face at 0.58
 * of the disc, the initial at 0.42, the flag at 0.36 pushed a little past the
 * rim — so a seat reads as the same person on both phones. The flag and the
 * face are the player's own picks and are drawn as they picked them; the
 * sizes go through the density rather than `.sp` so a large system font does
 * not push the initial out of its circle, which iOS's fixed sizes never do.
 *
 * For people who are not in a seat — a friend, a leaderboard row — pass the
 * fields directly.
 */
@Composable
fun AvatarDisc(
    name: String,
    color: String?,
    modifier: Modifier = Modifier,
    size: Dp = 36.dp,
    flag: String? = null,
    avatar: String? = null,
) {
    val p = P.current
    val density = LocalDensity.current
    fun at(k: Float) = with(density) { (size * k).toSp() }
    Box(modifier, contentAlignment = Alignment.BottomEnd) {
        Box(
            Modifier
                .size(size)
                .shadow(3.dp, CircleShape, clip = false, ambientColor = DISC_SHADOW, spotColor = DISC_SHADOW)
                .clip(CircleShape)
                .background(cssColor(color, p.red)),
            contentAlignment = Alignment.Center,
        ) {
            val face = avatar?.takeIf { it.isNotBlank() }
            if (face != null) {
                Text(face, fontSize = at(0.58f), maxLines = 1, softWrap = false)
            } else {
                Text(
                    (name.firstOrNull() ?: '?').uppercase(),
                    color = Color.White,
                    fontSize = at(0.42f),
                    fontWeight = FontWeight.Black,
                    maxLines = 1,
                    softWrap = false,
                )
            }
        }
        flag?.takeIf { it.isNotBlank() }?.let {
            Text(
                it,
                fontSize = at(0.36f),
                maxLines = 1,
                softWrap = false,
                modifier = Modifier.offset(x = size * 0.12f, y = size * 0.10f),
            )
        }
    }
}

private val DISC_SHADOW = Color.Black.copy(alpha = 0.3f)

/** Standard page padding, so every screen's gutter is the same gutter. */
val PagePadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)

// ── money that owes ────────────────────────────────────────────────────────

/**
 * A balance, in the colour of what it means.
 *
 * Positive money is the good green (or whatever `positive` a row prefers —
 * a lobby seat's cash, a muted list line); below zero it wears the danger
 * colour and breathes ([debtPulse]); a bankrupt seat's number goes quiet in
 * the faintest ink. iOS does these three cases at every balance it prints
 * (GameScreen.swift seat chips, TradeSheet.swift partners, ResultsViews.swift
 * standings), and a seat in the red has to read as one thing everywhere.
 *
 * The change itself rolls, up for a gain and down for a loss, which is the
 * nearest Compose has to iOS's `.contentTransition(.numericText())`.
 *
 * `text` is for the rows that say more than the number — the debt panel's
 * "$300 in the red" is `MoneyText(balance, text = "${money(-balance)} in the
 * red")` — and the colour and the pulse still follow `amount`.
 */
@Composable
fun MoneyText(
    amount: Int,
    modifier: Modifier = Modifier,
    fontSize: TextUnit = 13.sp,
    fontWeight: FontWeight = FontWeight.ExtraBold,
    positive: Color = P.current.good,
    bankrupt: Boolean = false,
    text: String = money(amount),
) {
    val p = P.current
    val inDebt = amount < 0 && !bankrupt
    val colour = when {
        bankrupt -> p.ink3
        inDebt -> p.bad
        else -> positive
    }
    AnimatedContent(
        targetState = amount to text,
        modifier = modifier.debtPulse(inDebt),
        transitionSpec = {
            val up = targetState.first >= initialState.first
            val roll = tween<IntOffset>(400, easing = FastOutSlowInEasing)
            (slideInVertically(roll) { h -> if (up) h / 2 else -h / 2 } + fadeIn(tween(400))) togetherWith
                (slideOutVertically(roll) { h -> if (up) -h / 2 else h / 2 } + fadeOut(tween(200))) using
                SizeTransform(clip = false)
        },
        label = "money",
    ) { (_, shown) ->
        Text(shown, color = colour, fontSize = fontSize, fontWeight = fontWeight, maxLines = 1, softWrap = false)
    }
}

/**
 * The soft heartbeat on a balance below zero. The colour already carries the
 * alarm — this just keeps the number breathing until the seat is back in the
 * black. iOS's DebtPulse, at its timing: down to 55% and back over 0.9s each
 * way while in debt, and a 0.2s settle when the debt clears.
 */
fun Modifier.debtPulse(active: Boolean): Modifier = composed {
    val breathing = if (active) {
        rememberInfiniteTransition(label = "debtPulse").animateFloat(
            initialValue = 1f,
            targetValue = 0.55f,
            animationSpec = infiniteRepeatable(tween(900, easing = EASE_IN_OUT), RepeatMode.Reverse),
            label = "debtPulse",
        ).value
    } else {
        1f
    }
    val shown by animateFloatAsState(
        breathing,
        animationSpec = if (active) snap<Float>() else tween<Float>(200, easing = LinearOutSlowInEasing),
        label = "debtSettle",
    )
    alpha(shown)
}

private val EASE_IN_OUT = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)

// ── who is who ─────────────────────────────────────────────────────────────

/**
 * One of the little words after a name: HOST, BOT, YOU. Black weight, tiny,
 * coloured and nothing else — iOS draws them bare, no capsule, so they sit on
 * the name's baseline rather than competing with it. (NEXT is the exception:
 * iOS gives it a capsule, so it is a [MiniPill].)
 */
@Composable
fun SeatTag(text: String, colour: Color, modifier: Modifier = Modifier, fontSize: TextUnit = 8.sp) {
    Text(
        text,
        modifier = modifier,
        color = colour,
        fontSize = fontSize,
        fontWeight = FontWeight.Black,
        maxLines = 1,
        softWrap = false,
    )
}

/**
 * The tags a seat wears, in iOS's order: HOST in gold, BOT in the faint ink,
 * YOU in the accent (LobbyPanel.swift). Emits them side by side, so call it
 * inside the Row that holds the name and let that Row's spacing part them.
 *
 * The lobby shows all three at 8sp. The seat chip at the table shows HOST and
 * BOT at 7sp and no YOU (GameScreen.swift) — pass `fontSize = 7.sp,
 * showYou = false` there.
 */
@Composable
fun SeatTags(
    player: PlayerState,
    hostId: String?,
    meId: String?,
    fontSize: TextUnit = 8.sp,
    showYou: Boolean = true,
) {
    val p = P.current
    if (hostId != null && player.id == hostId) SeatTag("HOST", p.gold, fontSize = fontSize)
    if (player.isBot == true) SeatTag("BOT", p.ink3, fontSize = fontSize)
    if (showYou && meId != null && player.id == meId) SeatTag("YOU", p.red, fontSize = fontSize)
}

/**
 * A capsule small enough to ride a seat chip: the live rank with its crown,
 * NEXT / YOU'RE NEXT, the deadlock laps. iOS's rankBadge, nextTag and
 * DeadlockLaps are all this one shape — black type on a soft fill, 1.5 by 5
 * of padding — differing only in words and colour. The rank and the laps are
 * 8.5pt; NEXT is 7pt with half a point of tracking (`fontSize = 7.sp,
 * letterSpacing = 0.5.sp`).
 *
 * An inherent-colour glyph (the crown) keeps its own colour whatever
 * `iconTint` says, which is what iOS's crown does too.
 */
@Composable
fun MiniPill(
    text: String,
    colour: Color,
    background: Color,
    modifier: Modifier = Modifier,
    icon: String? = null,
    iconSize: Dp = 10.dp,
    iconTint: Color = colour,
    fontSize: TextUnit = 8.5.sp,
    letterSpacing: TextUnit = TextUnit.Unspecified,
) {
    Row(
        modifier
            .clip(RoundedCornerShape(99.dp))
            .background(background)
            .padding(horizontal = 5.dp, vertical = 1.5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        if (icon != null) Icon(icon, size = iconSize, tint = iconTint)
        Text(
            text,
            color = colour,
            fontSize = fontSize,
            fontWeight = FontWeight.Black,
            letterSpacing = letterSpacing,
            maxLines = 1,
            softWrap = false,
        )
    }
}

/**
 * How many things are waiting, as a number rather than a dot: "3" is an
 * invitation to go and read three things, a dot is a smudge on a button.
 *
 * iOS's unreadBadge (GameScreen.swift): up to "99+", a pill that widens for
 * two digits, a ring in the page colour so it reads over the board, and a
 * spring on the way in and on every new message. It draws nothing at zero,
 * so a caller can always place it; while it fades out it keeps showing the
 * last count rather than flashing a "0".
 *
 * Hang it off the corner of whatever it counts — `Modifier.align(TopEnd)`
 * and a small offset, as iOS does (x 5, y −4 on the chat button).
 */
@Composable
fun UnreadBadge(count: Int, modifier: Modifier = Modifier) {
    val p = P.current
    var lastShown by remember { mutableIntStateOf(count) }
    val bump = remember { Animatable(1f) }
    LaunchedEffect(count) {
        if (count > 0) {
            lastShown = count
            bump.snapTo(1.2f)
            bump.animateTo(1f, spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessMediumLow))
        }
    }
    val n = if (count > 0) count else lastShown
    AnimatedVisibility(
        visible = count > 0,
        modifier = modifier,
        enter = scaleIn(spring(dampingRatio = 0.5f)) + fadeIn(),
        exit = scaleOut() + fadeOut(),
    ) {
        Box(
            Modifier
                .graphicsLayer { scaleX = bump.value; scaleY = bump.value }
                .defaultMinSize(minWidth = 19.dp, minHeight = 19.dp)
                .clip(RoundedCornerShape(99.dp))
                .background(p.red)
                .border(2.dp, p.page, RoundedCornerShape(99.dp))
                .padding(horizontal = if (n > 9) 5.dp else 0.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (n > 99) "99+" else "$n",
                color = Color.White,
                fontSize = 11.sp,
                fontWeight = FontWeight.ExtraBold,
                maxLines = 1,
                softWrap = false,
            )
        }
    }
}

/**
 * A dashed outline — an empty chair, a slot waiting to be filled. iOS's
 * empty seat row strokes its rounded rectangle 1pt in `rule2` with a 5-on,
 * 4-off dash (LobbyPanel.swift); those are the defaults. It is drawn over
 * the content, as iOS's overlay is, and inset by half the stroke so none of
 * it is clipped.
 */
fun Modifier.dashedBorder(
    color: Color,
    width: Dp = 1.dp,
    cornerRadius: Dp = 14.dp,
    dash: Dp = 5.dp,
    gap: Dp = 4.dp,
): Modifier = drawWithContent {
    drawContent()
    val w = width.toPx()
    drawRoundRect(
        color = color,
        topLeft = Offset(w / 2, w / 2),
        size = Size(size.width - w, size.height - w),
        cornerRadius = CornerRadius(cornerRadius.toPx()),
        style = Stroke(width = w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash.toPx(), gap.toPx()))),
    )
}

// ── your flag ──────────────────────────────────────────────────────────────

/**
 * Your flag, as one row.
 *
 * iOS's flagPicker (LandingView.swift, in the profile card under the
 * nickname): a row showing the flag you wear, "Country flag", the country's
 * name on the right and an up-down mark; tap it for a named list with "No
 * flag" first and a tick on the one you picked. A grid of fifty unlabelled
 * flags asks the reader to recognise every one of them; a named list can be
 * read.
 *
 * `selected` is the flag string ("" for none). `onPick` gets the new one —
 * the caller sends it (GameStore.setAppearance(flagCode = …)) and keeps it.
 * Picking a country clicks, as on iOS; clearing the flag does not.
 *
 * The flags are the emoji themselves, as iOS draws them: a player's own flag
 * is theirs, and only fourteen of the fifty have drawn art. With no flag the
 * row shows iOS's white flag, which is the answer to "which flag" rather than
 * a piece of chrome. The up-down mark and the menu's tick and struck flag are
 * iOS's own symbols (SafetySheets.kt's SfMark).
 */
@Composable
fun FlagPicker(selected: String, onPick: (String) -> Unit, modifier: Modifier = Modifier) {
    val p = P.current
    val density = LocalDensity.current
    var open by remember { mutableStateOf(false) }
    val current = countryName(selected)
    val shape = RoundedCornerShape(13.dp)
    Box(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 46.dp)
                .clip(shape)
                .background(p.sunken)
                .border(1.dp, p.rule, shape)
                .clickable { open = true }
                .padding(horizontal = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                selected.ifBlank { "\uD83C\uDFF3\uFE0F" },
                fontSize = with(density) { 19.dp.toSp() }, maxLines = 1, softWrap = false,
            )
            Text(
                "Country flag",
                color = p.ink2,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                softWrap = false,
            )
            // The name takes whatever width is left and sits flush right in
            // it, so a long one ("United Arab Emirates") ellipsizes instead of
            // pushing the up-down mark off the row.
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                Text(
                    current ?: "None",
                    color = p.ink,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.ExtraBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            // iOS's chevron.up.chevron.down at eleven bold: two small stacked
            // chevrons, no stems.
            SfMark("chevron.up.chevron.down", 20.dp, p.ink3)
        }
        DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            modifier = Modifier.heightIn(max = 440.dp),
            shape = RoundedCornerShape(14.dp),
            containerColor = p.card,
            border = BorderStroke(1.dp, p.rule),
        ) {
            // iOS's Label: the words, then a tick when it is the choice and a
            // struck-through flag when it is not.
            DropdownMenuItem(
                text = {
                    Text("No flag", color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.Normal, maxLines = 1)
                },
                trailingIcon = {
                    SfMark(if (selected.isBlank()) "checkmark" else "flag.slash", 18.dp, p.ink)
                },
                onClick = {
                    open = false
                    if (selected.isNotBlank()) onPick("")
                },
            )
            Rule(Modifier.padding(vertical = 4.dp))
            MMStatic.countries.forEach { (flag, name) ->
                FlagMenuItem("$flag  $name", ticked = flag == selected) {
                    open = false
                    SoundKit.click()
                    onPick(flag)
                }
            }
        }
    }
}

/** A country in the menu: iOS's plain Text, seventeen regular, with the tick typed after the chosen one. */
@Composable
private fun FlagMenuItem(label: String, ticked: Boolean, onClick: () -> Unit) {
    val p = P.current
    DropdownMenuItem(
        text = {
            Text(
                if (ticked) "$label  ✓" else label,
                color = p.ink,
                fontSize = 17.sp,
                fontWeight = FontWeight.Normal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        onClick = onClick,
    )
}

// ── are you sure ───────────────────────────────────────────────────────────

/** One answer in a [ConfirmDialog]. DANGER is the destructive one, as iOS's role. */
class ConfirmAction(
    val label: String,
    val kind: BtnKind = BtnKind.GHOST,
    val icon: String? = null,
    val onClick: () -> Unit,
)

/**
 * "Are you sure", over the whole screen: iOS's confirmationDialog in the
 * house style. A title, the sentence that says what is at stake, the answers
 * one per line in the order given, and Cancel last — iOS adds its Cancel
 * itself, so this does too unless `cancelLabel` is null.
 *
 * Choosing any answer dismisses first and acts second, so an answer that
 * raises something else is not closed by its own dismissal.
 *
 * Only from a screen, never from inside a ModalBottomSheet: a dialog raised
 * there fights the sheet for the window (see SafetySheets.kt). Inside a sheet
 * use [ConfirmRow].
 */
@Composable
fun ConfirmDialog(
    title: String,
    actions: List<ConfirmAction>,
    onDismiss: () -> Unit,
    message: String? = null,
    icon: String? = null,
    cancelLabel: String? = "Cancel",
) {
    val p = P.current
    val shape = RoundedCornerShape(22.dp)
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .padding(horizontal = 24.dp)
                .widthIn(max = 420.dp)
                .fillMaxWidth()
                .clip(shape)
                .background(p.sheet)
                .border(1.dp, p.rule, shape)
                .padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (icon != null) {
                    val danger = actions.any { it.kind == BtnKind.DANGER }
                    Icon(icon, size = 18.dp, tint = if (danger) p.bad else p.red)
                    Spacer(Modifier.width(8.dp))
                }
                Text(title, color = p.ink, fontSize = 17.sp, fontWeight = FontWeight.Black)
            }
            if (message != null) {
                Spacer(Modifier.height(6.dp))
                Text(message, color = p.ink2, fontSize = 13.5.sp, lineHeight = 19.sp, fontWeight = FontWeight.Medium)
            }
            Spacer(Modifier.height(16.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (a in actions) {
                    MMButton(a.label, Modifier.fillMaxWidth(), kind = a.kind, icon = a.icon) {
                        onDismiss()
                        a.onClick()
                    }
                }
                if (cancelLabel != null) {
                    MMButton(cancelLabel, Modifier.fillMaxWidth(), kind = BtnKind.GHOST) { onDismiss() }
                }
            }
        }
    }
}

/**
 * "Are you sure", as a row that replaces the button it guards — the form a
 * confirmation takes inside a sheet, where a dialog cannot be trusted to
 * appear. SafetySheets' Block confirm, made general: a soft danger panel, the
 * warning glyph and the question, the sentence that says what is at stake,
 * and the two answers side by side with the irreversible one first.
 *
 * `busy` greys both answers and swaps in `busyLabel` while the request is out,
 * so a second tap cannot send it twice.
 */
@Composable
fun ConfirmRow(
    title: String,
    message: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    cancelLabel: String = "Cancel",
    busy: Boolean = false,
    busyLabel: String? = null,
    icon: String = "warning",
    destructive: Boolean = true,
) {
    val p = P.current
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (destructive) p.badSoft else p.goldSoft)
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, size = 16.dp, tint = if (destructive) p.bad else p.gold)
            Spacer(Modifier.width(7.dp))
            Text(title, color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Black)
        }
        Spacer(Modifier.height(6.dp))
        Hint(message)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // MMButton keeps its colours when disabled, as iOS's style does, so
            // the wait is shown here the way iOS shows one: by fading the pair.
            MMButton(
                if (busy && busyLabel != null) busyLabel else confirmLabel,
                kind = if (destructive) BtnKind.DANGER else BtnKind.PRIMARY,
                modifier = Modifier.weight(1f).alpha(if (busy) 0.45f else 1f),
                enabled = !busy,
            ) { onConfirm() }
            MMButton(
                cancelLabel,
                kind = BtnKind.GHOST,
                modifier = Modifier.weight(1f).alpha(if (busy) 0.45f else 1f),
                enabled = !busy,
            ) { onCancel() }
        }
    }
}

// ── sending it somewhere ───────────────────────────────────────────────────

/**
 * The iOS symbols the drawn set has no drawing for, and the glyph that stands
 * in for each.
 *
 * iOS leans on SF Symbols for these; public/js/icons.js — the one source of
 * art for all three clients — never drew them, and Glyphs.kt is generated
 * from it. Where the web client already had to choose a stand-in, this makes
 * the same choice, so the three clients at least agree with each other. Name
 * the stand-in through here rather than by its glyph, so that the day
 * icons.js draws a real share arrow it is one line to change.
 */
object GlyphFor {
    /** square.and.arrow.up for an invite, drawn in Art.kt since icons.js has none. */
    const val SHARE = "share"
    /** square.and.arrow.up for a result — the same mark iOS puts on its result sheet. */
    const val SHARE_RESULT = "share"
    /** doc.on.doc, drawn in Art.kt beside the share mark. */
    const val COPY = "copy"
    /** clock.arrow.circlepath, the game log's history. */
    const val HISTORY = "replay"
    /** timer, on the full-size turn clock. A sweep round a dial is the nearest. */
    const val TIMER = "replay"
}

/**
 * The result sheet's share button: a win is bragged about, a loss still
 * shares the table. What it sends is [GameStore.shareText]; the link in it is
 * [Prefs.roomLink], and a friend code's invite is
 * [AccountStore.friendCodeShareText] — one copy of each sentence.
 */
fun resultShareLabel(iWon: Boolean): String = if (iWon) "Brag about it" else "Share the table"

/**
 * Hands `text` to Android's share sheet — iOS's ShareLink. No sound and no
 * knock, as on iOS: the sheet opening is the feedback.
 *
 * A phone with nothing that can take text (rare, but a locked-down device
 * exists) gets it on the clipboard instead, and `onCopiedInstead` is where
 * the caller says so — the web's words for it are "Invite copied".
 */
fun shareText(context: Context, text: String, onCopiedInstead: () -> Unit = {}) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    val chooser = Intent.createChooser(send, null)
    if (context.findActivity() == null) chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val opened = runCatching { context.startActivity(chooser) }.isSuccess
    if (!opened && putOnClipboard(context, text)) onCopiedInstead()
}

/**
 * Copies `text` with iOS's feedback: a light knock, then the confirmation.
 *
 * `confirm` is the caller's toast in iOS's words ("Friend code copied"). It
 * runs below Android 13 only: from 13 on the system shows its own copied
 * confirmation for every clipboard write, and Android's guidance is that an
 * app does not add a second one. That is the one place this differs from
 * iOS, and it is the platform's difference, not the app's.
 */
fun copyText(context: Context, text: String, confirm: () -> Unit) {
    if (!putOnClipboard(context, text)) return
    Haptics.tap()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) confirm()
}

private fun putOnClipboard(context: Context, text: String): Boolean {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
    return runCatching { clipboard.setPrimaryClip(ClipData.newPlainText("MoneyMove", text)) }.isSuccess
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/**
 * The small arrow on a row that goes somewhere — iOS's chevron.right. The
 * drawn set has no arrow in it, so this is two strokes in whatever ink the
 * row asks for rather than a character standing in for one. `size` is its
 * height; it is a little over half as wide.
 */
@Composable
fun RowChevron(tint: Color, size: Dp = 12.dp) {
    Canvas(Modifier.size(width = size * 0.62f, height = size)) {
        val w = this.size.width
        val h = this.size.height
        val stroke = h * 0.17f
        val half = stroke / 2
        val path = Path().apply {
            moveTo(half, half)
            lineTo(w - half, h / 2)
            lineTo(half, h - half)
        }
        drawPath(path, tint, style = Stroke(width = stroke, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}
