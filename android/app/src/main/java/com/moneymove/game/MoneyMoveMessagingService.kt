package com.moneymove.game

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Where a push from the server lands when Android does not draw it itself.
 *
 * push.js sends every push with a notification and a small data block. With
 * the app off screen, Android draws the notification on its own, from the
 * channel and icon the server named, and none of this runs; a tap then opens
 * MainActivity with the data as its extras (see [PushAbout.from]). With the
 * app on screen, FCM hands the message here instead and draws nothing — which
 * is what an iPhone does too while its app is open. What the player is
 * looking at is already the news, so this only has the screen fetch whatever
 * the push was about ([heard]).
 */
class MoneyMoveMessagingService : FirebaseMessagingService() {

    /**
     * FCM issued a new token: a restore onto a new phone, app data cleared,
     * or simply a rotation. The old one on the server is a notification
     * nobody receives, so the new one is handed over now rather than at the
     * next launch.
     *
     * Waited for here, because FCM calls this on a thread of its own and the
     * service can be stopped the moment it returns. Bounded, because a phone
     * without a network would otherwise hold that thread for as long as the
     * request took to give up.
     */
    override fun onNewToken(token: String) {
        runBlocking { withTimeoutOrNull(25_000L) { PushRegistration.register(applicationContext, token) } }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val about = PushAbout.from(message.data)
        // The app's own word on whether it is on screen, which MainActivity
        // keeps at ON_START and ON_STOP for the cup's reminders.
        if (CupReminders.inFront) {
            about?.let { seen.tryEmit(it) }
            return
        }
        // Handed to us with the app off screen: a message with no
        // notification in it, or one that landed in the moment between the
        // app leaving the screen and Android noticing. Nothing has been drawn
        // for it, so this draws it.
        draw(message, about)
    }

    private fun draw(message: RemoteMessage, about: PushAbout?) {
        val note = message.notification
        val body = note?.body ?: message.data["body"] ?: return
        val title = note?.title ?: message.data["title"] ?: "MoneyMove"
        val manager = NotificationManagerCompat.from(this)
        if (!manager.areNotificationsEnabled()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return
        PushChannels.ensure(this)
        val channel = note?.channelId?.takeIf { it in PushChannels.ALL } ?: PushChannels.of(about)
        // The server's collapse id, as on iOS: a newer push about the same
        // thing replaces the one before rather than stacking under it.
        val tag = about?.tag ?: message.collapseKey ?: PushChannels.TURNS
        val open = PendingIntent.getActivity(
            this, tag.hashCode(),
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtras(about?.extras() ?: Bundle()),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val built = NotificationCompat.Builder(this, channel)
            .setSmallIcon(if (about?.kind == PushAbout.Kind.CUP) R.drawable.ic_stat_cup else R.drawable.ic_stat_turn)
            .setColor(ContextCompat.getColor(this, R.color.gold))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            // Below Android 8 there are no channels to carry this.
            .setPriority(
                if (channel == PushChannels.SOCIAL) NotificationCompat.PRIORITY_DEFAULT
                else NotificationCompat.PRIORITY_HIGH,
            )
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        try {
            manager.notify(tag, NOTE_ID, built)
        } catch (e: SecurityException) {
            // The permission was taken away between the check and the post.
        }
    }

    companion object {
        /**
         * Nought, because that is the id FCM posts its own under, beside the
         * server's tag. A notification is its tag and its id together, so on
         * any other number a turn Android drew while the app was away and the
         * next one for the same table, drawn here, would sit side by side
         * instead of the newer replacing the older.
         */
        private const val NOTE_ID = 0

        private val seen = MutableSharedFlow<PushAbout>(
            extraBufferCapacity = 8,
            onBufferOverflow = BufferOverflow.DROP_OLDEST,
        )

        /**
         * Pushes that arrived while the app was on screen, for MainActivity to
         * act on. Nothing is replayed: a push nobody was collecting for came
         * in while the app was away, and Android drew that one itself.
         */
        val heard: SharedFlow<PushAbout> = seen.asSharedFlow()
    }
}

/**
 * What a push was about, read off its data block — the same keys whether they
 * arrive in [RemoteMessage.getData] or as the extras of the intent a tapped
 * notification opens the app with. push.js (fcmMessage) sends, all strings:
 *
 *  - `kind`: "turn", "invite", "notice" or "cup". The server also knows
 *    "dm" and "friend", which nothing sends yet; for those, and for anything
 *    newer than this build, a tap opens the app and goes nowhere in
 *    particular.
 *  - `roomId`: the table — the one whose turn it is, the one a friend is
 *    asking the player to, or the cup table whose door has opened.
 *  - `cupId`: the cup, for a cup push that is not about a table yet — the
 *    draw, the quarter of an hour's warning, how it ended.
 *  - `collapseId`: what Apple gets as apns-collapse-id, and the tag the
 *    notification is drawn under, so a newer one replaces the one before.
 */
data class PushAbout(
    val kind: Kind,
    val room: String? = null,
    val cup: String? = null,
    val tag: String? = null,
) {
    enum class Kind(val wire: String) { TURN("turn"), INVITE("invite"), NOTICE("notice"), CUP("cup") }

    /** The same keys again, for a notification this app draws itself. */
    fun extras(): Bundle = Bundle().apply {
        putString(KIND, kind.wire)
        room?.let { putString(ROOM, it) }
        cup?.let { putString(CUP, it) }
        tag?.let { putString(COLLAPSE, it) }
    }

    companion object {
        const val KIND = "kind"
        const val ROOM = "roomId"
        const val CUP = "cupId"
        const val COLLAPSE = "collapseId"
        private val KEYS = listOf(KIND, ROOM, CUP, COLLAPSE)

        fun from(data: Map<String, String?>): PushAbout? {
            val named = data[KIND]?.trim()?.lowercase()
            val kind = Kind.entries.firstOrNull { it.wire == named } ?: return null
            return PushAbout(kind, idOf(data[ROOM]), idOf(data[CUP]), data[COLLAPSE]?.trim()?.ifEmpty { null })
        }

        /**
         * The push a tapped notification opened the app with, or null for a
         * launch that was not one. Android puts a push's data in the intent
         * as string extras, which is all this reads.
         */
        fun from(intent: Intent?): PushAbout? {
            // MainActivity is exported, so these extras can come from anybody;
            // a bundle that will not even unpack is simply not a push.
            val extras = runCatching { intent?.extras }.getOrNull() ?: return null
            if (!extras.containsKey(KIND)) return null
            return from(KEYS.associateWith { extras.getString(it) })
        }

        /**
         * A room or cup id, cut the way the server cuts one when it is joined
         * (lower case, twelve characters) and the way GameStore.connect does.
         */
        private fun idOf(raw: String?): String? =
            raw?.trim()?.lowercase()?.take(12)?.ifEmpty { null }
    }
}

/**
 * The app's three notification channels — the switches a player gets in
 * Android's settings, so each is one thing somebody might want to turn off
 * on its own.
 *
 * Made at launch rather than on first use, because the server names the
 * channel in every push and Android draws those without asking the app: a
 * channel that does not exist yet is a push that lands in a "Miscellaneous"
 * one Firebase makes up. Creating one that exists changes nothing but its
 * name and description, so this is safe to call as often as anything likes.
 */
object PushChannels {
    const val TURNS = "turns"
    const val CUP = "cup"
    const val SOCIAL = "social"
    val ALL = setOf(TURNS, CUP, SOCIAL)

    fun of(about: PushAbout?): String = when (about?.kind) {
        PushAbout.Kind.CUP -> CUP
        PushAbout.Kind.INVITE, PushAbout.Kind.NOTICE -> SOCIAL
        else -> TURNS
    }

    fun ensure(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = ctx.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannels(
            listOf(
                // A clock is running on both of these — the turn timer, the
                // cup's door — so they come down over the screen.
                NotificationChannel(TURNS, "Your turn", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "When it is your move at a table you stepped away from."
                },
                NotificationChannel(CUP, "Cup matches", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "The draw, your cup match opening, the last call before its door shuts, " +
                        "and how you got on."
                },
                // A friend asking, or a note from MoneyMove: worth a sound,
                // never worth covering what somebody is doing.
                NotificationChannel(SOCIAL, "Invites and notes", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "A friend asking you to their table, and notes written to you."
                },
            ),
        )
    }
}
