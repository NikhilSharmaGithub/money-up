package com.moneymove.game

import android.content.Context
import android.content.SharedPreferences
import kotlinx.serialization.builtins.ListSerializer
import java.util.UUID

/**
 * Everything the app remembers between launches, in one place.
 *
 * The keys are deliberately the same strings the iOS app keeps in
 * UserDefaults ("mm.theme", "mm.nickname", …). Nothing syncs between the two
 * — they are different devices — but a player who reads one and then the
 * other should find the same settings under the same names when we go looking
 * for a bug, and a key named twice is a setting that silently resets.
 */
class Prefs(context: Context) {
    private val sp: SharedPreferences =
        context.getSharedPreferences("moneymove", Context.MODE_PRIVATE)

    /**
     * This device's identity at the table.
     *
     * Minted once and kept forever: the server knows a player by their token,
     * and the friend code, the coin wallet, the daily reward and the seat a
     * reconnect walks back into all hang off it. Losing it loses the account,
     * which is why it is written before it is first returned rather than
     * regenerated on every read.
     */
    val token: String
        get() = sp.getString(KEY_TOKEN, null) ?: UUID.randomUUID().toString()
            .also { sp.edit().putString(KEY_TOKEN, it).apply() }

    var nickname: String
        get() = sp.getString(KEY_NICKNAME, "") ?: ""
        set(v) = sp.edit().putString(KEY_NICKNAME, v.take(20)).apply()

    var flag: String
        get() = sp.getString(KEY_FLAG, "") ?: ""
        set(v) = sp.edit().putString(KEY_FLAG, v).apply()

    var theme: MMTheme
        get() = MMTheme.from(sp.getString(KEY_THEME, null))
        set(v) = sp.edit().putString(KEY_THEME, v.id).apply()

    var appearance: MMAppearance
        get() = MMAppearance.from(sp.getString(KEY_APPEARANCE, null))
        set(v) = sp.edit().putString(KEY_APPEARANCE, v.id).apply()

    var soundOn: Boolean
        get() = sp.getBoolean(KEY_SOUND, true)
        set(v) = sp.edit().putBoolean(KEY_SOUND, v).apply()

    var tokenSkin: String
        get() = sp.getString(KEY_SKIN, "") ?: ""
        set(v) = sp.edit().putString(KEY_SKIN, v).apply()

    var avatar: String
        get() = sp.getString(KEY_AVATAR, "") ?: ""
        set(v) = sp.edit().putString(KEY_AVATAR, v).apply()

    /** The table this device walked away from, so the shelf can offer it back. */
    var lastRoom: String
        get() = sp.getString(KEY_LAST_ROOM, "") ?: ""
        set(v) = sp.edit().putString(KEY_LAST_ROOM, v).apply()

    /**
     * Pass & play seats this device also held at [lastRoom]. Their tokens are
     * derived from ours, so a count is all a resume needs to put every one of
     * them back in their chair.
     */
    var lastGuests: Int
        get() = sp.getInt(KEY_LAST_GUESTS, 0)
        set(v) = sp.edit().putInt(KEY_LAST_GUESTS, maxOf(0, v)).apply()

    /**
     * Tables this device walked away from mid-game, newest first.
     *
     * The single [lastRoom] string this replaces could only ever offer one
     * table, and never learned that the game had finished without us. A build
     * that still has only that string gets it back once as the first entry —
     * with no board name, because the old key never kept one — and the resume
     * check finds out whether the table is still there.
     */
    var unfinished: List<UnfinishedGame>
        get() {
            val raw = sp.getString(KEY_UNFINISHED, null)
            if (raw == null) {
                // Written either way, so the migration runs exactly once — a
                // lobby joined after the update must never be mistaken later
                // for a table the old build walked away from.
                val legacy = lastRoom
                val seed = if (legacy.isBlank()) emptyList()
                else listOf(UnfinishedGame(roomId = legacy, leftAt = System.currentTimeMillis()))
                unfinished = seed
                return seed
            }
            return runCatching { MMJson.decodeFromString(UNFINISHED, raw) }.getOrElse { emptyList() }
        }
        set(v) = sp.edit().putString(KEY_UNFINISHED, MMJson.encodeToString(UNFINISHED, v)).apply()

    /**
     * Finished games, newest first, for History. The same key the iOS app
     * files its match records under; like everything else here, the two never
     * meet — it only means a bug report reads the same on both.
     */
    var history: List<MatchRecord>
        get() = sp.getString(KEY_HISTORY, null)
            ?.let { raw -> runCatching { MMJson.decodeFromString(HISTORY, raw) }.getOrNull() }
            ?: emptyList()
        set(v) = sp.edit().putString(KEY_HISTORY, MMJson.encodeToString(HISTORY, v)).apply()

    /**
     * The deadlock rule's stamp, so rejoining a table does not re-teach a rule
     * this device has already read.
     */
    var reliefSeenAt: Double
        get() = java.lang.Double.longBitsToDouble(sp.getLong(KEY_RELIEF, 0L))
        set(v) = sp.edit().putLong(KEY_RELIEF, java.lang.Double.doubleToRawLongBits(v)).apply()

    /**
     * Whether this player has agreed to the community rules.
     *
     * The chat composer stays shut until they have. Asked once per device, on
     * whichever chat surface they reach first.
     */
    var rulesAgreed: Boolean
        get() = sp.getBoolean(KEY_RULES, false)
        set(v) = sp.edit().putBoolean(KEY_RULES, v).apply()

    /**
     * The newest version of the welcome cards this device has been through.
     *
     * A number rather than a yes, so that rewriting the cards can show them
     * again by bumping the version the intro declares — the same gate, under
     * the same key, as iOS. A device that only ever wrote the old yes/no has
     * seen version one, and is written up to it once so it is not greeted
     * with the cards a second time after the update.
     */
    var introSeen: Int
        get() {
            if (sp.contains(KEY_INTRO)) return sp.getInt(KEY_INTRO, 0)
            if (sp.getBoolean(KEY_WELCOME, false)) {
                sp.edit().putInt(KEY_INTRO, 1).remove(KEY_WELCOME).apply()
                return 1
            }
            return 0
        }
        set(v) = sp.edit().putInt(KEY_INTRO, v).remove(KEY_WELCOME).apply()

    /**
     * Whether any version of the welcome cards has been through. Kept for the
     * callers that predate [introSeen]; saying yes records version one, and
     * never lowers a newer version that is already on file.
     */
    var seenWelcome: Boolean
        get() = introSeen > 0
        set(v) { introSeen = if (v) maxOf(introSeen, 1) else 0 }

    /**
     * Where the game lives. The real server on every build, exactly as on
     * iOS: a debug phone pointing at a laptop is a deliberate act, not the
     * default, because a client with nothing to talk to looks like a broken
     * app rather than a missing server.
     */
    var server: String
        get() = sp.getString(KEY_SERVER, null)?.takeIf { it.isNotBlank() } ?: DEFAULT_SERVER
        set(v) = sp.edit().putString(KEY_SERVER, v.trim()).apply()

    fun string(key: String, fallback: String = ""): String = sp.getString(key, fallback) ?: fallback
    fun putString(key: String, value: String) = sp.edit().putString(key, value).apply()
    fun bool(key: String, fallback: Boolean = false): Boolean = sp.getBoolean(key, fallback)
    fun putBool(key: String, value: Boolean) = sp.edit().putBoolean(key, value).apply()
    fun int(key: String, fallback: Int = 0): Int = sp.getInt(key, fallback)
    fun putInt(key: String, value: Int) = sp.edit().putInt(key, value).apply()

    companion object {
        const val DEFAULT_SERVER = "https://moneymove-csk9.onrender.com"
        const val SITE = "https://www.moneymove.live"

        /** The three help links iOS carries on its account card, word for word. */
        const val PRIVACY_URL = "$SITE/privacy"
        const val SUPPORT_URL = "$SITE/support"
        const val CONTACT_EMAIL = "usernamenikhilsharma@gmail.com"

        /**
         * The link that seats a friend at a table. The web client reads
         * `?room=` on load, so it works from a browser with nothing installed,
         * and MainActivity reads the same query off an incoming link.
         */
        fun roomLink(roomId: String): String = "$SITE/?room=$roomId"

        private val UNFINISHED = ListSerializer(UnfinishedGame.serializer())
        private val HISTORY = ListSerializer(MatchRecord.serializer())

        private const val KEY_TOKEN = "mm.token"
        private const val KEY_NICKNAME = "mm.nickname"
        private const val KEY_FLAG = "mm.flag"
        private const val KEY_THEME = "mm.theme"
        private const val KEY_APPEARANCE = "mm.appearance"
        private const val KEY_SOUND = "mm.sound"
        private const val KEY_SKIN = "mm.tokenSkin"
        private const val KEY_AVATAR = "mm.avatar"
        private const val KEY_LAST_ROOM = "mm.lastRoom"
        private const val KEY_LAST_GUESTS = "mm.lastGuests"
        private const val KEY_UNFINISHED = "mm.unfinished"
        private const val KEY_HISTORY = "mm.history"
        private const val KEY_WELCOME = "mm.seenWelcome"
        private const val KEY_INTRO = "mm.intro.seen"
        private const val KEY_SERVER = "mm.server"
        private const val KEY_RELIEF = "mm.reliefSeen"
        private const val KEY_RULES = "mm.rulesAgreed"
    }
}
