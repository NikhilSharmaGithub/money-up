package com.moneymove.game

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.TimeUnit

/**
 * Push, Android half — the client end of POST /api/push/register, doing for
 * this phone what PushRegistrar (ios/MoneyMove/AskingNicely.swift) does for
 * an iPhone: collect a device token, hand it over, keep it fresh, and ask for
 * permission only when the player has earned the question.
 *
 * push.js sends through FCM as well as through Apple now, so a registered
 * phone hears about its turn at a table it walked away from, a friend's
 * invite, a note written to it, and every step of its cup. Where a push lands
 * when the app is on screen, and where a tapped one leads, is
 * MoneyMoveMessagingService and MainActivity.
 *
 * The server's answer says whether it can actually reach this phone —
 * `sends`, true only while it holds a Firebase credential — and that is
 * remembered ([serverSends]) because the cup depends on it. The server's cup
 * pushes and the phone's own cup alarms (CupReminders) say the same things
 * at the same moments; while the server can send, the alarms stand down, and
 * they stay as the fallback for as long as it cannot.
 *
 * google-services.json is not in this repo, which is public. A build without
 * it leaves the google-services plugin off, still links firebase-messaging,
 * and FirebaseApp simply never initialises — so everything here asks
 * [firebaseReady] before it goes near Firebase, and a clone is a quiet no-op:
 * no token, no registration, the cup's alarms exactly as before.
 */
object PushRegistration {

    private const val TAG = "MMPush"

    // The same keys the iOS app keeps in UserDefaults, for the reason Prefs.kt
    // gives: a setting worth finding twice should be findable under one name.
    private const val KEY_GAMES = "mm.gamesFinished"
    private const val KEY_ASKED = "mm.pushAsked"

    /** The server's last word on whether it can push to this phone. */
    private const val KEY_SENDS = "mm.push.sends"

    /**
     * A game this device saw through to its ending.
     *
     * Walking out of a table early is not one. The permission prompt is a
     * reward for staying to the end, not for leaving, and asking a stranger
     * who has seen half a game is how an app gets a "no" it can never undo.
     */
    fun noteFinishedGame(context: Context) {
        val prefs = Prefs(context)
        prefs.putInt(KEY_GAMES, prefs.int(KEY_GAMES) + 1)
    }

    /**
     * Whether now is the moment to show the system's notification prompt:
     * iOS's askAfterFirstGame, asked by MainActivity when the result of a
     * game this device played is on screen.
     *
     * Below Android 13 there is no prompt to show — notifications are on
     * unless the player turned them off — so this is only ever true on 33 and
     * up, and only once in this app's life on this device.
     */
    fun shouldAsk(context: Context): Boolean {
        if (Prefs(context).int(KEY_GAMES) < 1) return false
        return promptIsDue(context)
    }

    /**
     * [shouldAsk], for somebody who has just joined a cup.
     *
     * The finished-game rule is dropped here. A cup is a door that shuts on
     * whoever is not there, and a notification — the server's, or the
     * phone's own reminder while the server cannot send — is what tells an
     * entrant it has opened. Joining is the clearest moment there will ever
     * be for the prompt: they have just said they want to be somewhere at a
     * set time. Everything else holds — Android 13 and up, declared in the
     * manifest, not already granted, and the one ask not yet spent.
     */
    fun shouldAskForCup(context: Context): Boolean = promptIsDue(context)

    private fun promptIsDue(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
        // Android refuses a permission the manifest never asked for without
        // drawing anything at all — no dialog, an instant denial — and there
        // is exactly one prompt to spend per install. The manifest does ask;
        // this still looks rather than trusts, because a wrong guess here is
        // spent for good.
        if (!permissionIsDeclared(context)) return false
        if (Prefs(context).bool(KEY_ASKED)) return false
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
    }

    /**
     * The ask is spent whether or not it was granted.
     *
     * Android stops drawing the prompt after two refusals and denies silently
     * instead, so a client that asked again on the strength of "still not
     * granted" would be nagging into a void it cannot see. Settings is the
     * only way back, exactly as it should be.
     */
    fun markAsked(context: Context) {
        Prefs(context).putBool(KEY_ASKED, true)
    }

    private fun permissionIsDeclared(context: Context): Boolean = runCatching {
        @Suppress("DEPRECATION")
        val info = context.packageManager
            .getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
        info.requestedPermissions?.contains(Manifest.permission.POST_NOTIFICATIONS) == true
    }.getOrDefault(false)

    /**
     * Whether the server last said it can push to this phone.
     *
     * False until it has said so: a build without Firebase, a server too old
     * to answer `sends`, and a phone that has not registered yet all leave the
     * cup to the phone's own alarms, which is the side to be wrong on.
     */
    fun serverSends(context: Context): Boolean = Prefs(context).bool(KEY_SENDS)

    /** The identity and token this process last handed over, and when, so a repeat is not sent. */
    @Volatile
    private var sent: String? = null
    @Volatile
    private var sentAt = 0L
    private val registering = Mutex()

    /**
     * How long the server's answer is trusted before the same token is handed
     * over again. `sends` is its word at the moment it answered, and that can
     * change under an app that stays alive for hours: a deploy that brings
     * the Firebase key in, or Google turning the key down. A phone still
     * holding the old answer would ring every cup moment twice — its own
     * alarm and the push — or not at all. A quarter of an hour of use costs
     * one small POST.
     */
    private const val FRESH_MS = 15 * 60_000L

    /**
     * Hand this device's token to the server.
     *
     * Called whenever the app comes to the front, and by
     * MoneyMoveMessagingService with a token FCM has just issued, because
     * that is where everything that matters turns up: a first launch, the
     * permission just granted in the system's dialog or in Settings, somebody
     * else signed in on this phone, a token rotated. Only a change is sent,
     * or an answer older than [FRESH_MS]. The first call in a process always
     * is, so the server hears from every launch and `sends` is read fresh —
     * and registerPushDevice moves a device it already knows to the back of
     * its list rather than growing it, so that costs nothing.
     */
    suspend fun register(context: Context, token: String? = null) {
        val app = context.applicationContext
        if (!firebaseReady(app)) {
            // Nothing can reach this phone but its own alarms.
            noteSends(app, false)
            return
        }
        if (!NotificationManagerCompat.from(app).areNotificationsEnabled()) {
            // Registering a device that cannot display anything would put a
            // row in the server's list that will never be delivered to, and
            // one more doomed send on every turn for as long as it sits
            // there. The player can turn them on later; this runs again then.
            return
        }
        // One at a time: the app coming to the front and a rotated token can
        // land together, and two posts would both be sent.
        registering.withLock {
            val device = token ?: fcmToken() ?: return
            val prefs = Prefs(app)
            val identity = prefs.token
            val key = "$identity|$device"
            if (key == sent && SystemClock.elapsedRealtime() - sentAt < FRESH_MS) return
            // `deviceToken` and `platform` are the names registerPushDevice()
            // reads, and "android" is one of the two strings PUSH_PLATFORMS
            // allows. Anything else comes back "Missing device token" or
            // "Unknown platform" — a 400 the shared Api reports as nothing at
            // all, which is the quietest way for this to be wrong. No answer
            // is tried again the next time the app comes to the front.
            val reply = Api(prefs.server, identity).post(
                "/api/push/register",
                mapOf("deviceToken" to device, "platform" to "android"),
            ) ?: return
            sent = key
            sentAt = SystemClock.elapsedRealtime()
            noteSends(app, sendsIn(reply))
        }
    }

    /**
     * Remembers what the server said, and acts on a change. When it has just
     * taken the cup over, the alarms already set go now, on the main thread
     * where every other change to them is made. When it has just let go, the
     * card's next poll sets them again ([CupReminders.sync]), which is the
     * next time the app is opened at the latest.
     */
    private suspend fun noteSends(app: Context, sends: Boolean) {
        val prefs = Prefs(app)
        if (prefs.bool(KEY_SENDS) == sends) return
        prefs.putBool(KEY_SENDS, sends)
        if (sends) withContext(Dispatchers.Main) { CupReminders.standDown(app) }
    }

    /** `{ ok, devices, sends }` — and a server too old to say `sends` does not send. */
    private fun sendsIn(reply: String): Boolean = runCatching {
        (MMJson.parseToJsonElement(reply) as? JsonObject)?.get("sends")?.jsonPrimitive?.booleanOrNull
    }.getOrNull() == true

    /** Whether FirebaseApp came up, which it does only in a build that had google-services.json. */
    private fun firebaseReady(context: Context): Boolean =
        runCatching { FirebaseApp.getApps(context).isNotEmpty() }.getOrDefault(false)

    /**
     * FCM's registration token, or nothing — and nothing is not worth a
     * message beyond the kind of failure, never the token itself.
     */
    private suspend fun fcmToken(): String? = withContext(Dispatchers.IO) {
        runCatching {
            // getToken() answers with a Task, and Tasks.await is the blocking
            // read of one — which is why this is on the IO dispatcher and not
            // wherever the caller happened to be.
            //
            // The timed await, never the untimed one. Getting a token is a
            // round trip to Google's servers, and on a phone that cannot
            // reach them the untimed version simply never returns: an IO
            // thread parked for the life of the process over a registration
            // nothing is waiting on.
            Tasks.await(FirebaseMessaging.getInstance().token, 20L, TimeUnit.SECONDS)
        }.onFailure {
            Log.i(TAG, "no FCM token this time (${it.javaClass.simpleName})")
        }.getOrNull()?.takeIf { it.isNotBlank() }
    }
}
