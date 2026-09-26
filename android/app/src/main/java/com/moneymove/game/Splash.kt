package com.moneymove.game

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseInOut
import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The cold-launch flourish — iOS's SplashView (LogoView.swift), beat for beat,
 * so the two phones open the same way.
 *
 * The felt table in the style's own page colours; the die rolls in and lands
 * its pips; the wordmark rises at 0.65s; the tagline fades in at 0.97s; at
 * 1.92s the whole thing fades into the app underneath, and at 2.38s it is
 * gone. [SoundKit.launch] plays from its first frame and is scored to the same
 * clock: the tumble while the die spins, a knock as it lands, a warm G then C
 * as the name rises, a shimmer with the tagline.
 *
 * The system's own splash hands straight to this: its icon is transparent and
 * its background is the default style's page, so the first thing drawn here
 * is the page that was already on screen, and the die appears once, rolling.
 *
 * Under Reduce Motion nothing rolls, grows or rises: the settled mark and the
 * wordmark fade in together over 0.3s, the tagline at the same 0.97s, and the
 * same fade out. The sound still plays — sound is not motion.
 *
 * It takes no taps, but nothing under it gets any while it is up either, as
 * iOS's full-screen view swallows them.
 */
@Composable
fun SplashView(onDone: () -> Unit) {
    val p = P.current
    val dark = LocalAppearanceDark.current
    val still = rememberReduceMotion()

    var showWord by remember { mutableStateOf(false) }
    var showTag by remember { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    // Reduce Motion's one movement: the settled mark and the name, faded up.
    val settle = remember { Animatable(0f) }

    // The wordmark on iOS's spring(duration 0.5, bounce 0.25).
    val word by animateFloatAsState(
        if (showWord) 1f else 0f,
        spring(dampingRatio = 0.75f, stiffness = 157.9f),
        label = "splashWord",
    )
    val tag by animateFloatAsState(if (showTag) 1f else 0f, tween(400, easing = EaseOut), label = "splashTag")
    val fade by animateFloatAsState(if (leaving) 0f else 1f, tween(450, easing = EaseInOut), label = "splashFade")

    LaunchedEffect(Unit) {
        SoundKit.warmUp()
        SoundKit.launch()
        if (still) launch { settle.animateTo(1f, tween(300)) }
        delay(650)
        showWord = true
        delay(320)
        showTag = true
        delay(950)
        leaving = true
        delay(460)
        onDone()
    }

    val sheen = p.card.copy(alpha = if (dark) 0.14f else 0.7f)
    Box(
        Modifier
            .fillMaxSize()
            .graphicsLayer { alpha = fade }
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) awaitPointerEvent().changes.forEach { it.consume() }
                }
            }
            .background(Brush.verticalGradient(listOf(p.page, p.page2)))
            .drawBehind {
                // The soft table sheen, as iOS lays it: from 10pt out to 340
                // around a point a little above the middle.
                val reach = 340.dp.toPx()
                drawRect(
                    Brush.radialGradient(
                        0f to sheen,
                        (10.dp.toPx() / reach) to sheen,
                        1f to sheen.copy(alpha = 0f),
                        center = Offset(size.width * 0.5f, size.height * 0.36f),
                        radius = reach,
                    ),
                )
            },
    ) {
        Column(
            Modifier
                .align(Alignment.Center)
                .offset(y = (-20).dp)
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(26.dp),
        ) {
            // The ring spills past the die's box, so the still fade is laid
            // on each stroke rather than through a layer cut to that box.
            LogoMark(
                118.dp,
                Modifier
                    .padding(bottom = 8.dp)
                    .graphicsLayer {
                        if (still) {
                            alpha = settle.value
                            compositingStrategy = CompositingStrategy.ModulateAlpha
                        }
                    },
                animated = !still,
            )
            Box(
                Modifier.graphicsLayer {
                    if (still) {
                        alpha = settle.value
                    } else {
                        alpha = word.coerceIn(0f, 1f)
                        translationY = 16.dp.toPx() * (1f - word)
                    }
                },
            ) {
                Wordmark(38.sp)
            }
            Text(
                "Buy streets. Build hotels. Bankrupt your friends.",
                modifier = Modifier.graphicsLayer { alpha = tag },
                color = p.ink2,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center,
            )
        }
    }
}
