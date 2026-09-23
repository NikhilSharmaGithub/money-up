package com.moneymove.game

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Turn notifications, Android half — the client end of POST /api/push/register.
 *
 * This is the same groundwork ios/MoneyMove/AskingNicely.swift lays: collect
 * a device token, hand it over, keep it fresh, and wait. Nothing sends to an
 * Android phone yet and nothing here pretends otherwise.
 *
 * WHAT THE OWNER MUST ADD before this does anything at all:
 *
 *  1. android/app/google-services.json, from a Firebase project registered
 *     for com.moneymove.game. It is not in this repo and cannot be invented.
 *  2. The plugin, in both gradle files:
 *       id("com.google.gms.google-services") version "4.4.2" apply false  // project
 *       id("com.google.gms.google-services")                              // app
 *  3. implementation("com.google.firebase:firebase-messaging:24.0.3")
 *  4. <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
 *     in the manifest — and, to catch a rotated token without waiting for the
 *     next launch, a FirebaseMessagingService subclass declared there too.
 *  5. The server end. server/push.js speaks HTTP/2 to Apple and nothing else,
 *     and sendTurnPush filters the device list down to platform === 'ios'
 *     before it sends. So a device registered today is stored, kept fresh,
 *     and skipped. FCM is a second sender to write, not a second key to
 *     paste — which is what that file's own closing line already says.
 *
 * Why the FCM token is fetched by reflection rather than imported: adding
 * firebase-messaging without google-services.json does not degrade, it breaks
 * the build outright — the google-services plugin fails when the file is
 * missing, so there is no half-way state to compile against. Looking the
 * class up at runtime means this file needs no new gradle line, is a quiet
 * no-op today, and starts working the day the five things above land without
 * a line changing here. (Release builds do not minify — see build.gradle.kts
 * — so there is no keep rule to write either. If minification is ever turned
 * on, this lookup is the thing that will go silently missing.)
 */
object PushRegistration {

    private const val TAG = "MMPush"

    // The same keys the iOS app keeps in UserDefaults, for the reason Prefs.kt
    // gives: a setting worth finding twice should be findable under one name.
    private const val KEY_GAMES = "mm.gamesFinished"
    private const val KEY_ASKED = "mm.pushAsked"

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
     * Whether now is the moment to show the system's notification prompt.
     *
     * Below Android 13 there is no prompt to show — notifications are on
     * unless the player turned them off — so this is only ever true on 33 and
     * up, and only once in this app's life on this device.
     */
    fun shouldAsk(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
        // Android refuses a permission the manifest never asked for without
        // drawing anything at all — no dialog, an instant denial — and there
        // is exactly one prompt to spend per install. Asking before
        // POST_NOTIFICATIONS is declared would burn it on something the player
        // never saw and leave Settings as the only way back, so this stays as
        // dark as the rest of the file until that line is in the manifest.
        if (!permissionIsDeclared(context)) return false
        val prefs = Prefs(context)
        if (prefs.bool(KEY_ASKED)) return false
        if (prefs.int(KEY_GAMES) < 1) return false
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

    /**
     * Whether this build's manifest actually asks for POST_NOTIFICATIONS.
     *
     * Looked up rather than assumed, because the manifest is not this file's
     * to edit and a wrong guess here is spent permanently.
     */
    private fun permissionIsDeclared(context: Context): Boolean = runCatching {
        @Suppress("DEPRECATION")
        val info = context.packageManager
            .getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
        info.requestedPermissions?.contains(Manifest.permission.POST_NOTIFICATIONS) == true
    }.getOrDefault(false)

    /**
     * Hand this device's token to the server.
     *
     * Safe — and meant — to be called on every launch. FCM rotates a token
     * whenever it likes: app data cleared, a restore onto a new phone, a
     * reinstall. A stale one on the server is a notification nobody receives,
     * and registerPushDevice moves a device it already knows to the back of
     * its list rather than growing it, so asking twice costs nothing.
     */
    suspend fun register(context: Context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            // Registering a device that cannot display anything would put a
            // row in the server's list that will never be delivered to, and
            // one more doomed send on every turn for as long as it sits
            // there. The player can turn them on later; this runs again then.
            return
        }
        val device = fcmToken() ?: return
        val prefs = Prefs(context)
        // `deviceToken` and `platform` are the names registerPushDevice()
        // reads, and "android" is one of the two strings PUSH_PLATFORMS
        // allows. Anything else comes back "Missing device token" or
        // "Unknown platform" — a 400 the shared Api reports as nothing at
        // all, which is the quietest way for this to be wrong.
        Api(prefs.server, prefs.token).post(
            "/api/push/register",
            mapOf("deviceToken" to device, "platform" to "android"),
        )
    }

    /**
     * FCM's registration token, if this build has an FCM to ask.
     *
     * Every way this can fail is the same answer — no token, no registration,
     * no noise: the class is absent because firebase-messaging is not a
     * dependency, or it is present but FirebaseApp never initialised because
     * google-services.json is not there. Neither is a fault the player can do
     * anything about, and neither is worth a message.
     */
    private suspend fun fcmToken(): String? = withContext(Dispatchers.IO) {
        runCatching {
            val messaging = Class.forName("com.google.firebase.messaging.FirebaseMessaging")
            val instance = messaging.getMethod("getInstance").invoke(null)
            val pending = messaging.getMethod("getToken").invoke(instance)
            // FirebaseMessaging.getToken() answers with a Task, and Tasks.await
            // is the blocking read of one — which is why this is on the IO
            // dispatcher and not wherever the caller happened to be.
            //
            // The three-argument await, never the one-argument one. Getting a
            // token is a round trip to Google's servers, and on a phone that
            // cannot reach them the untimed version simply never returns:
            // an IO thread parked for the life of the process, and a launch
            // that never completes, over a registration nothing is waiting on.
            val tasks = Class.forName("com.google.android.gms.tasks.Tasks")
            val await = tasks.getMethod(
                "await",
                Class.forName("com.google.android.gms.tasks.Task"),
                java.lang.Long.TYPE,
                TimeUnit::class.java,
            )
            await.invoke(null, pending, 20L, TimeUnit.SECONDS) as? String
        }.onFailure {
            Log.i(TAG, "no FCM token — push stays dark (${it.javaClass.simpleName})")
        }.getOrNull()?.takeIf { it.isNotBlank() }
    }
}
