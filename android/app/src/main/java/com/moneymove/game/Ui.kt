package com.moneymove.game

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The handful of pieces every screen is built out of.
 *
 * Deliberately small and unclever. Material's own components would each need
 * a colour scheme mapped onto the seven table styles and would still not look
 * like the iOS app, so the shared vocabulary is defined here once instead: a
 * button, a panel, a hint, a chip. The same four things the web client's CSS
 * defines, wearing the same palette slots.
 */

enum class BtnKind { PRIMARY, GOLD, GHOST, GOOD, DANGER, PLAIN }

@Composable
fun MMButton(
    label: String,
    modifier: Modifier = Modifier,
    kind: BtnKind = BtnKind.PLAIN,
    big: Boolean = false,
    icon: String? = null,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val p = P.current
    val bg = when (kind) {
        BtnKind.PRIMARY, BtnKind.GOLD -> p.red
        BtnKind.GOOD -> p.good
        BtnKind.DANGER -> p.bad
        BtnKind.GHOST -> Color.Transparent
        BtnKind.PLAIN -> p.sunken
    }
    val fg = when (kind) {
        BtnKind.PRIMARY, BtnKind.GOLD -> p.accentInk
        BtnKind.GOOD, BtnKind.DANGER -> Color.White
        else -> p.ink
    }
    val shape = RoundedCornerShape(if (big) 16.dp else 12.dp)
    Row(
        modifier
            .heightIn(min = if (big) 52.dp else 42.dp)
            .clip(shape)
            .background(if (enabled) bg else bg.copy(alpha = 0.35f))
            .then(if (kind == BtnKind.GHOST) Modifier.border(1.dp, p.rule2, shape) else Modifier)
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = if (big) 18.dp else 14.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, size = if (big) 20.dp else 17.dp, tint = fg)
            Spacer(Modifier.width(8.dp))
        }
        Text(
            label,
            color = if (enabled) fg else fg.copy(alpha = 0.6f),
            fontSize = if (big) 16.sp else 14.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
    }
}

/** A panel: the card surface everything on a screen sits inside. */
@Composable
fun Panel(
    modifier: Modifier = Modifier,
    padding: Dp = 16.dp,
    content: @Composable ColumnScopeAlias.() -> Unit,
) {
    val p = P.current
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(p.card)
            .border(1.dp, p.rule, RoundedCornerShape(18.dp))
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
            letterSpacing = 1.6.sp,
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

/** Money, written the way every client writes it: no cents, thousands split. */
fun money(v: Int): String {
    val sign = if (v < 0) "-" else ""
    val digits = kotlin.math.abs(v).toString()
    val grouped = digits.reversed().chunked(3).joinToString(",").reversed()
    return "$sign$$grouped"
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

/** A round avatar disc carrying either a bought face or the player's initial. */
@Composable
fun PlayerDisc(player: PlayerState, size: Dp = 28.dp, modifier: Modifier = Modifier) {
    val p = P.current
    val colour = cssColor(player.color, p.red)
    Box(
        modifier.size(size).clip(RoundedCornerShape(99.dp)).background(colour),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            (player.name.firstOrNull() ?: '?').uppercase(),
            color = Color.White,
            fontSize = (size.value * 0.44f).sp,
            fontWeight = FontWeight.Black,
        )
    }
}

/** Standard page padding, so every screen's gutter is the same gutter. */
val PagePadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)
