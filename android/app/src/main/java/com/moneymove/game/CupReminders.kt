package com.moneymove.game

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlin.math.roundToInt

/**
 * The cup's reminders, Android half — what the server's cup pushes do for an
 * iPhone, done on the phone.
 *
 * The server tells an iPhone when its draw is out, fifteen minutes before its
 * door opens, when its table is made, three minutes before the door shuts,
 * and how the cup ended for it (tournament.js remindersDue, index.js
 * seatCupMatches and sweepCupNoShows). Every one of those goes through
 * sendTurnPush, which sends to iOS devices only, and Android has no FCM sender
 * yet (see PushRegistration). A cup is "turn up inside your window or you are
 * out", so without this an Android entrant with the app closed was the player
 * most likely to be walked over.
 *
 * So the card's own poll, which already knows when this player's next door
 * opens and shuts, sets alarms for those moments. When one goes off it asks
 * the server once more, if it can, before saying anything: a player knocked
 * out in the meantime must not be told their next match is starting. It then
 * says what the server would have said, in the server's words, and sets the
 * next alarms from that answer. If the server cannot be reached, a reminder
 * that is still true by the clock (the door has not shut) is sent anyway.
 *
 * Limits, said plainly: nothing here is a server push. The draw and the
 * result are learnt only when one of these alarms goes off or the app is
 * opened, not the moment they happen. Alarms do not survive a reboot or a
 * force stop, so they come back the next time the app is opened. From Android
 * 12 on, an app without the exact-alarm permission gets alarms the system may
 * deliver a few minutes late, so the fifteen-minute warning is the dependable
 * one and the last call is the one that can miss.
 *
 * Nothing is posted while the app is on screen. iOS does not show its pushes
 * in the foreground either, and the card is there saying the same thing.
 */
object CupReminders {

    /** Whether the app is on screen. Set by MainActivity at ON_START and ON_STOP. */
    @Volatile
    var inFront: Boolean = false

    /** On the intent a tapped reminder opens the app with, so the cup is asked about at once. */
    const val EXTRA_OPEN = "mm.cup.open"

    private const val CHANNEL = "cup"
    private const val NOTE_ID = 7301
    private const val KEY_SEEN = "mm.cup.seen"

    // The four moments. Each has a fixed request code, so setting it again
    // replaces it instead of adding a second alarm.
    private const val SOON = 0   // fifteen minutes before the door opens
    private const val OPEN = 1   // the door has opened and the table is made
    private const val LAST = 2   // three minutes before the door shuts
    private const val CHECK = 3  // no message of its own: ask how things stand
    private val KINDS = intArrayOf(SOON, OPEN, LAST, CHECK)

    private const val MINUTE = 60_000L
    /** tournament.js REMIND_LEAD_MS. */
    private const val LEAD = 15 * MINUTE
    /** index.js CUP_LAST_CALL_MS. */
    private const val LAST_CALL = 3 * MINUTE

    private const val X_KIND = "kind"
    private const val X_CUP = "cup"
    private const val X_LABEL = "label"
    private const val X_OPENS = "opens"
    private const val X_CLOSES = "closes"

    /** What the server's "table is made" push says (index.js seatCupMatches). */
    private const val OPEN_TEXT = "Your cup match is open — go and play it now"

    /**
     * What this phone last knew about the one cup its player is in, kept
     * between launches. It is the baseline the next answer is compared with:
     * news the player already saw on the card is not sent again.
     */
    @Serializable
    private data class Seen(
        val cup: String = "",
        val name: String = "",
        val out: Boolean = false,
        val placed: String? = null,
        /** The round of the last match drawn for this player; nought before the draw. */
        val round: Int = 0,
        /** The cup table this device has sat down at. */
        val seated: String? = null,
        /** When each alarm is set for, by kind, nought for none. */
        val alarms: List<Long> = emptyList(),
    )

    private sealed interface Look {
        data class Live(val cup: CupView) : Look
        data class Over(val chart: CupBracketView?) : Look
        data object Unknown : Look
    }

    // ── from the app ────────────────────────────────────────────────────────

    /**
     * Brings the alarms into line with an answer from `/api/cup`. Called with
     * every answer the card's poll gets, so this only touches AlarmManager
     * when a time has actually moved.
     *
     * Only the cup this player is in may set or clear them. A player may be
     * in one cup and be reading another, and the card showing somebody
     * else's cup says nothing about their own.
     */
    fun sync(ctx: Context, feed: CupFeed) {
        val seen = read(ctx)
        if (!feed.enabled) {
            if (seen.cup.isNotEmpty()) forget(ctx, seen)
            return
        }
        val cup = feed.cup ?: return
        if (!cup.you.joined) {
            // Left it: the alarms were for this cup, and it is no longer theirs.
            if (cup.id == seen.cup) forget(ctx, seen)
            return
        }
        val base = if (cup.id == seen.cup) seen else Seen(cup = cup.id)
        arrange(
            ctx, cup,
            base.copy(
                name = cup.name,
                out = cup.you.out,
                placed = cup.you.placed,
                round = maxOf(base.round, cup.you.next?.round ?: 0),
            ),
        )
    }

    /**
     * This device has sat down at its cup table. The server's last call goes
     * only to somebody not yet in their seat, and "your match is open" has
     * nothing left to say, so both are stood down, and a note already showing
     * for this table is taken away.
     */
    fun seated(ctx: Context, cupId: String, room: String) {
        val seen = read(ctx)
        if (seen.cup != cupId || seen.seated == room) return
        val am = ctx.getSystemService(AlarmManager::class.java)
        if (am != null) {
            cancel(ctx, am, OPEN)
            cancel(ctx, am, LAST)
        }
        val alarms = seen.alarms.toMutableList()
        if (alarms.size > LAST) {
            alarms[OPEN] = 0L
            alarms[LAST] = 0L
        }
        write(ctx, seen.copy(seated = room, alarms = alarms))
        NotificationManagerCompat.from(ctx).cancel(NOTE_ID)
    }

    // ── from an alarm ───────────────────────────────────────────────────────

    /** Only the receiver's own coroutine asks: nine seconds, then the clock decides. */
    private val asking = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    internal suspend fun fire(ctx: Context, intent: Intent) {
        val kind = intent.getIntExtra(X_KIND, -1)
        val cupId = intent.getStringExtra(X_CUP) ?: return
        val seen = read(ctx)
        // An alarm for a cup this phone has moved on from: a leave, or a
        // later cup, got here first.
        if (seen.cup != cupId) return
        // A request that has not answered in nine seconds is left to finish on
        // its own. A receiver has only so long, and a reminder that is still
        // true by the clock is worth more than a late one.
        val pending = asking.async { look(ctx, cupId) }
        val look = withTimeoutOrNull(9_000L) { pending.await() } ?: Look.Unknown
        val now = System.currentTimeMillis()
        val text = when (look) {
            is Look.Live -> liveText(kind, look.cup, seen, now).also {
                sync(ctx, CupFeed(enabled = true, cup = look.cup))
            }
            is Look.Over -> overText(look.chart, seen).also { forget(ctx, read(ctx)) }
            Look.Unknown -> byTheClock(kind, intent, now)
        }
        if (text != null) post(ctx, text)
    }

    private suspend fun look(ctx: Context, cupId: String): Look {
        val prefs = Prefs(ctx)
        val api = Api(prefs.server, prefs.token)
        val body = api.get("/api/cup", mapOf("show" to cupId)) ?: return Look.Unknown
        val feed = runCatching { MMJson.decodeFromString(CupFeed.serializer(), body) }.getOrNull()
            ?: return Look.Unknown
        if (!feed.enabled) return Look.Over(null)
        feed.cup?.takeIf { it.id == cupId }?.let { return Look.Live(it) }
        // Not in the feed: finished more than ten minutes ago, or called off.
        // The chart still knows a finished cup, and how this player did in it.
        val raw = api.get("/api/cup/bracket", mapOf("cup" to cupId)) ?: return Look.Unknown
        val chart = runCatching { MMJson.decodeFromString(CupBracketFeed.serializer(), raw) }.getOrNull()
            ?: return Look.Unknown
        return Look.Over(chart.bracket?.takeIf { it.id == cupId })
    }

    /**
     * What to say, given a fresh answer. A table waiting for this player comes
     * first, because it is the one with a door about to shut; then how the cup
     * ended for them, then a new draw, then the fifteen-minute warning.
     */
    private fun liveText(kind: Int, cup: CupView, seen: Seen, now: Long): String? {
        val you = cup.you
        if (!you.joined) return null
        val next = you.next
        val closes = next?.closesAt?.toLong()
        val room = next?.roomId
        val waiting = room != null && room != seen.seated && (closes == null || now < closes)
        if (waiting && kind != SOON) {
            return if (kind == LAST && closes != null) lastCallText(closes - now) else OPEN_TEXT
        }
        you.placed?.takeIf { seen.placed == null }?.let { return placedText(cup.name, it) }
        if (you.out && !seen.out) return outText(cup.name)
        if (next != null && next.round > seen.round) return drawText(next, now)
        if (kind == SOON && next != null && !next.open) {
            val opens = next.opensAt?.toLong() ?: return null
            if (now < opens) return soonText(next.label, opens - now, (closes ?: 0L) - opens)
        }
        return null
    }

    /** The cup has left the feed. The chart says how it ended for this player, if it can. */
    private fun overText(chart: CupBracketView?, seen: Seen): String? {
        if (chart == null) return null
        val you = chart.you ?: return null
        val name = chart.name.ifBlank { seen.name }
        you.placed?.takeIf { seen.placed == null }?.let { return placedText(name, it) }
        if (you.out && !seen.out) return outText(name)
        return null
    }

    /**
     * No answer from the server. What the alarm was set for is still true by
     * the clock alone — a drawn match cannot be taken away before its door
     * opens — so it is said while the door is still open, and not after.
     */
    private fun byTheClock(kind: Int, intent: Intent, now: Long): String? {
        val opens = intent.getLongExtra(X_OPENS, 0L)
        val closes = intent.getLongExtra(X_CLOSES, 0L)
        val label = intent.getStringExtra(X_LABEL).orEmpty()
        return when (kind) {
            SOON -> if (opens > now) soonText(label, opens - now, closes - opens) else null
            OPEN -> if (closes == 0L || now < closes) OPEN_TEXT else null
            LAST -> if (closes > now) lastCallText(closes - now) else null
            else -> null
        }
    }

    // ── the server's words ──────────────────────────────────────────────────

    /** tournament.js, the quarter of an hour's warning. */
    private fun soonText(label: String, ms: Long, windowMs: Long): String {
        val mins = maxOf(1, (ms / 60_000.0).roundToInt())
        val shut = (windowMs / 60_000.0).roundToInt()
        return "Your ${label.ifBlank { "match" }} starts in $mins minutes." +
            if (shut > 0) " The door is open $shut minutes — be in the app." else ""
    }

    /** index.js, three minutes before a door shuts on somebody not yet seated. */
    private fun lastCallText(ms: Long): String {
        val mins = maxOf(1, (ms / 60_000.0).roundToInt())
        return "$mins minute${if (mins == 1) "" else "s"} left to take your seat — miss it and you are out of the cup."
    }

    /** tournament.js, the draw: the first round's words, or "through" for every one after. */
    private fun drawText(next: CupNext, now: Long): String {
        val label = next.label.ifBlank { "match" }
        val away = awayText((next.opensAt?.toLong() ?: now) - now)
        val other = next.opponent ?: "your opponent"
        return if (next.round <= 1) {
            "The draw is out — your $label is $away, against $other. Miss the window and you are out."
        } else {
            "You are through! $label $away, against $other."
        }
    }

    private fun placedText(name: String, placed: String): String =
        if (placed == "first") "You won $name. The prize is paid by hand — keep your friend code."
        else "You finished $placed in $name. The prize is paid by hand — keep your friend code."

    private fun outText(name: String): String =
        "You are out of $name. Thanks for playing — there will be another."

    /** tournament.js awayText, word for word. */
    private fun awayText(ms: Long): String {
        if (ms <= 60_000L) return "now"
        val mins = (ms / 60_000.0).roundToInt()
        if (mins < 60) return "in $mins minute${if (mins == 1) "" else "s"}"
        val hours = (ms / 3_600_000.0).roundToInt()
        if (hours < 20) return "in about $hours hour${if (hours == 1) "" else "s"}"
        val days = (ms / 86_400_000.0).roundToInt()
        return if (days <= 1) "tomorrow" else "in $days days"
    }

    // ── the alarms ──────────────────────────────────────────────────────────

    /**
     * Works out when each alarm should go off for [cup], sets the ones that
     * moved and clears the ones no longer wanted.
     */
    private fun arrange(ctx: Context, cup: CupView, seen: Seen) {
        val now = System.currentTimeMillis()
        val prev = seen.alarms
        // An alarm counted from now is kept while it is still ahead, or every
        // poll would push it three seconds further off and it would never go.
        fun held(kind: Int, fresh: Long): Long = prev.getOrNull(kind)?.takeIf { it > now } ?: fresh

        val at = LongArray(KINDS.size)
        val you = cup.you
        val stillIn = you.joined && !you.out && you.placed == null && cup.state != "done"
        val next = you.next
        if (stillIn && next != null) {
            val opens = next.opensAt?.toLong()
            val closes = next.closesAt?.toLong()
            val sitting = next.roomId != null && next.roomId == seen.seated
            if (!next.open && opens != null) {
                at[SOON] = opens - LEAD
                // The server makes the table on its next sweep after the door
                // opens, so this looks a little after, not on the second.
                at[OPEN] = opens + 20_000L
            } else if (next.open && next.roomId == null) {
                // The door is open and the table is still being made.
                at[OPEN] = held(OPEN, now + 45_000L)
            }
            if (closes != null && !sitting) at[LAST] = closes - LAST_CALL
            // The whistle: a minute after it, find out how the game went.
            next.endsAt?.let { at[CHECK] = it.toLong() + MINUTE }
        } else if (stillIn) {
            // Nothing drawn for this player yet: look again when there will be.
            at[CHECK] = when (cup.state) {
                // The draw is made the moment joining shuts.
                "scheduled", "joining" -> cup.closesAt?.toLong()?.plus(30_000L) ?: 0L
                else -> {
                    val due = cup.plan.firstOrNull { !it.done && (it.opensAt ?: 0.0) > now }?.opensAt?.toLong()
                    // A cup without a clock draws its next round whenever the
                    // last one finishes, so this looks in every quarter hour.
                    when {
                        due == null -> held(CHECK, now + LEAD)
                        due - LEAD > now -> due - LEAD
                        else -> held(CHECK, now + MINUTE)
                    }
                }
            }
        }

        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        for (kind in KINDS) {
            val time = at[kind].takeIf { it > now } ?: 0L
            at[kind] = time
            val before = prev.getOrNull(kind) ?: 0L
            if (time == 0L) {
                if (before != 0L) cancel(ctx, am, kind)
                continue
            }
            // Already set for this moment, and still there. A reboot or a
            // force stop clears alarms without telling anybody, and both end
            // the process too, so a note this process wrote itself is trusted
            // and one read from disk is checked with the system first.
            if (time == before &&
                (prev == confirmed || pendingFor(ctx, kind, PendingIntent.FLAG_NO_CREATE) != null)
            ) continue
            set(ctx, am, kind, time, cup)
        }
        write(ctx, seen.copy(alarms = at.toList()))
    }

    private fun intentFor(ctx: Context, kind: Int): Intent =
        // One action per kind, because extras play no part in telling two
        // PendingIntents apart and the four must not replace each other.
        Intent(ctx, CupReminderReceiver::class.java).setAction("com.moneymove.game.CUP_REMINDER_$kind")

    private fun pendingFor(ctx: Context, kind: Int, flags: Int, intent: Intent = intentFor(ctx, kind)): PendingIntent? =
        PendingIntent.getBroadcast(ctx, kind, intent, flags or PendingIntent.FLAG_IMMUTABLE)

    private fun set(ctx: Context, am: AlarmManager, kind: Int, at: Long, cup: CupView) {
        val next = cup.you.next
        val intent = intentFor(ctx, kind)
            .putExtra(X_KIND, kind)
            .putExtra(X_CUP, cup.id)
            .putExtra(X_LABEL, next?.label.orEmpty())
            .putExtra(X_OPENS, next?.opensAt?.toLong() ?: 0L)
            .putExtra(X_CLOSES, next?.closesAt?.toLong() ?: 0L)
        val pi = pendingFor(ctx, kind, PendingIntent.FLAG_UPDATE_CURRENT, intent) ?: return
        // On the second where the phone allows it. From Android 12 that needs
        // a permission this app does not ask for, and the fallback is an
        // alarm Doze may hold back by a few minutes — still allowed to wake
        // the phone, which is the part that matters.
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
    }

    private fun cancel(ctx: Context, am: AlarmManager, kind: Int) {
        val pi = pendingFor(ctx, kind, PendingIntent.FLAG_NO_CREATE) ?: return
        am.cancel(pi)
        pi.cancel()
    }

    /** The cup is over for this phone: every alarm off, and nothing kept. */
    private fun forget(ctx: Context, seen: Seen) {
        ctx.getSystemService(AlarmManager::class.java)?.let { am ->
            for (kind in KINDS) cancel(ctx, am, kind)
        }
        if (seen != Seen()) write(ctx, Seen())
    }

    // ── the note ────────────────────────────────────────────────────────────

    /**
     * One note, in the words iOS's push would carry and under the same title.
     * Each newer one replaces the last: a last call makes "your match is open"
     * old news. Tapping it opens the app, and the app asks about the cup the
     * moment it is in front, which is what walks the player to their table.
     */
    private fun post(ctx: Context, text: String) {
        if (inFront) return
        val manager = NotificationManagerCompat.from(ctx)
        if (!manager.areNotificationsEnabled()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return
        channel(ctx)
        val open = PendingIntent.getActivity(
            ctx, NOTE_ID,
            Intent(ctx, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_OPEN, true),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val note = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_cup)
            .setContentTitle("MoneyMove")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            // Below Android 8 there are no channels, and this is what makes it
            // come down over the screen the way iOS's "active" push does.
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        try {
            manager.notify(NOTE_ID, note)
        } catch (e: SecurityException) {
            // The permission was taken away between the check and the post.
        }
    }

    private fun channel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Cup matches", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Your cup match opening, the last call before its door shuts, and how you got on."
            },
        )
    }

    // ── the baseline ────────────────────────────────────────────────────────

    private fun read(ctx: Context): Seen =
        Prefs(ctx).string(KEY_SEEN).takeIf { it.isNotBlank() }?.let {
            runCatching { MMJson.decodeFromString(Seen.serializer(), it) }.getOrNull()
        } ?: Seen()

    /**
     * The alarm times this process has itself set and written down. The card
     * polls every few seconds, and asking the system each time whether four
     * alarms still exist is four trips across processes for an answer that
     * cannot have changed while this process was alive.
     */
    private var confirmed: List<Long>? = null

    private fun write(ctx: Context, seen: Seen) {
        val prefs = Prefs(ctx)
        val raw = MMJson.encodeToString(Seen.serializer(), seen)
        if (prefs.string(KEY_SEEN) != raw) prefs.putString(KEY_SEEN, raw)
        confirmed = seen.alarms
    }
}

/**
 * Where a cup alarm lands. The work is [CupReminders.fire]; this only keeps
 * the process alive for it, on the main thread like every other change to
 * the reminders, so an alarm and the card's poll never write over each other.
 */
class CupReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate).launch {
            try {
                CupReminders.fire(app, intent)
            } finally {
                pending.finish()
            }
        }
    }
}
