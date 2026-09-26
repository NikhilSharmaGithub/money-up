package com.moneymove.game

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URL

/**
 * Who this device is, high on the Play tab.
 *
 * Until an account is linked it is the way to link one, and afterwards it is
 * the account itself — the face, the name and the numbers that follow it
 * from phone to phone. Signing in used to change nothing anybody could see
 * on the first screen, which reads as a sign-in that did not work; and the
 * only place that offered one was four tabs away, where a player can go for
 * weeks without learning their coins live on one phone.
 *
 * iOS's accountCard (LandingView.swift), drawn on iOS's own card and
 * button (see [LandingCard]) because it sits on the Play tab between cards
 * that are. One thing it cannot have: there is no Sign in with Apple on
 * Android, so a server with Google switched off leaves this card with
 * nothing to offer but the reason, where the iPhone would still offer Apple.
 */
@Composable
fun AccountCard(account: AccountStore, store: GameStore, modifier: Modifier = Modifier) {
    val p = P.current
    val context = LocalContext.current
    val me = account.me

    LandingCard(modifier, padding = 12.dp) {
        if (me != null && me.provider != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ProfilePhoto(me, size = 44.dp)
                Spacer(Modifier.width(11.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        me.name.ifBlank { "Player" },
                        color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        me.email.ifBlank { "Signed in with ${if (me.provider == "apple") "Apple" else "Google"}" },
                        color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.Medium,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        // The wallet's count rather than the profile's: it is
                        // the one every other coin on this screen reads, and
                        // the two disagreeing for a poll would look like a
                        // coin went missing.
                        AccountFigure("coin", "${account.coins}")
                        AccountFigure("heart", "${me.karma}")
                        Text(me.code, color = p.ink2, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                }
                // iOS's eleven either side of a Spacer that never shrinks
                // below eight: the name truncates where the iPhone's does.
                Spacer(Modifier.width(30.dp))
                LandingButton("Sign out", LandingKind.GHOST) {
                    account.signOut { error ->
                        if (error != null) store.showToast(error, isError = true)
                        else store.showToast("Signed out — coins and friends stay with this device")
                    }
                }
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "Sign in to collect your daily coins",
                    color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold,
                )
                // A sign-in button that cannot sign anyone in is a dead tap,
                // so until the server has said Google is set up there is none.
                // iOS still has Apple's to fall back on; this phone has only
                // the sentence — AccountStore's own for the same refusal —
                // and only once the server has actually answered.
                when (account.auth?.google) {
                    true -> GoogleButton(signingIn = account.signingIn) {
                        signInWithGoogleTapped(context, account, store)
                    }
                    false -> Hint("This server has Google sign-in switched off.")
                    null -> Unit
                }
            }
        }
    }
}

/**
 * The sign-in every card that offers one starts — this one, on Play and
 * Social, and the daily reward's locked face — so they all report its
 * outcome in the same words.
 *
 * iOS reports it as a toast rather than a line under the button, and takes
 * the play name the server settled on as the device's own: the server never
 * takes the name off the Google account, it keeps the one this device sent.
 * Closing Google's own sheet is an answer, not an error, and says nothing.
 */
internal fun signInWithGoogleTapped(context: Context, account: AccountStore, store: GameStore) {
    if (account.signingIn) return
    account.signInWithGoogle(context, store.nickname, quiet = true) { outcome ->
        if (outcome.signedIn) {
            outcome.name?.let { store.nickname = it }
            store.showToast("Signed in with Google")
        } else {
            outcome.error?.let { store.showToast(it, isError = true) }
        }
    }
}

@Composable
private fun AccountFigure(glyph: String, value: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        // iOS's heart.fill is the plain solid heart; the drawn one adds a
        // highlight Apple's does not have.
        if (glyph == "heart") SfMark("heart.fill", 11.dp, Color(0xFFE0435C)) else Icon(glyph, size = 11.dp)
        Spacer(Modifier.width(3.dp))
        Text(value, color = P.current.ink2, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    }
}

/**
 * The account's face: the photo the account carries, as iOS loads it, and
 * the initial in the gold ring that marks a signed-in face until it has
 * arrived — or for good, when there is no photo or it cannot be fetched.
 */
@Composable
private fun ProfilePhoto(me: MeView, size: Dp) {
    val p = P.current
    val density = LocalDensity.current
    val initial = me.name.trim().take(1).uppercase().ifEmpty { "?" }
    val photo = rememberPhoto(me.picture)
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(p.sunken)
            .border(2.dp, p.gold, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (photo != null) {
            Image(
                photo, contentDescription = null,
                modifier = Modifier.matchParentSize(),
                contentScale = ContentScale.Crop,
            )
        } else {
            Text(
                initial,
                color = p.ink,
                fontSize = with(density) { (size * 0.42f).toSp() },
                fontWeight = FontWeight.ExtraBold,
                maxLines = 1,
            )
        }
    }
}

/**
 * Photos already fetched this session, by address. The card is drawn on two
 * tabs and redrawn every time either is opened; asking Google for the same
 * small square each time would make the face blink back to its initial.
 */
private val photos = HashMap<String, ImageBitmap>()

/**
 * The account photo, fetched and decoded off the main thread. There is no
 * image library in this app and one small square does not need one: a plain
 * GET and the platform's own decoder. A photo that will not come is simply
 * not shown — the initial is already there.
 */
@Composable
private fun rememberPhoto(url: String): ImageBitmap? {
    val photo by produceState(photos[url], url) {
        if (value != null) return@produceState
        if (!url.startsWith("https://") && !url.startsWith("http://")) return@produceState
        val fetched = withContext(Dispatchers.IO) {
            runCatching {
                val link = URL(url).openConnection().apply {
                    connectTimeout = 10_000
                    readTimeout = 10_000
                }
                link.getInputStream().use { BitmapFactory.decodeStream(it) }?.asImageBitmap()
            }.getOrNull()
        }
        if (fetched != null) {
            photos[url] = fetched
            value = fetched
        }
    }
    return photo
}

/**
 * Google's button the way Google asks for it to look: white, dark text, its
 * own four-colour G. The one control in the app that wears somebody else's
 * colours, because that is how people recognise it as the real one.
 */
@Composable
private fun GoogleButton(signingIn: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 46.dp)
            .clip(shape)
            .background(Color.White)
            .border(1.dp, Color.Black.copy(alpha = 0.12f), shape)
            .clickable(enabled = !signingIn) { onClick() },
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // iOS's spinner at four-fifths size, in the button's black, while
        // Google's sheet is up and the server is being asked.
        if (signingIn) LandingSpinner(Color.Black, 16.dp) else GoogleG(17.dp)
        Spacer(Modifier.width(8.dp))
        Text(
            if (signingIn) "Signing in…" else "Sign in with Google",
            color = Color.Black.copy(alpha = 0.84f),
            fontSize = 15.5.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

/**
 * The G, drawn as iOS draws it (Art.swift, GoogleG): four quarter-arcs in
 * Google's colours and the crossbar that makes it a G rather than an O.
 * Angles start at three o'clock and run clockwise on both platforms, so the
 * quarters are iOS's fractions of a turn as they stand.
 */
@Composable
private fun GoogleG(size: Dp) {
    Canvas(Modifier.size(size)) {
        val d = this.size.minDimension
        val stroke = d * 0.21f
        val inset = d * 0.105f
        val box = Size(d - inset * 2, d - inset * 2)
        fun seg(from: Float, to: Float, colour: Color) = drawArc(
            color = colour,
            startAngle = from * 360f,
            sweepAngle = (to - from) * 360f,
            useCenter = false,
            topLeft = Offset(inset, inset),
            size = box,
            style = Stroke(width = stroke),
        )
        seg(0.03f, 0.25f, G_BLUE)
        seg(0.25f, 0.50f, G_GREEN)
        seg(0.50f, 0.75f, G_YELLOW)
        seg(0.75f, 0.97f, G_RED)
        drawRect(
            color = G_BLUE,
            topLeft = Offset(center.x + d * 0.19f - d * 0.21f, center.y - d * 0.105f),
            size = Size(d * 0.42f, d * 0.21f),
        )
    }
}

private val G_BLUE = Color(0.26f, 0.52f, 0.96f)
private val G_GREEN = Color(0.20f, 0.66f, 0.33f)
private val G_YELLOW = Color(0.98f, 0.74f, 0.02f)
private val G_RED = Color(0.92f, 0.26f, 0.21f)
