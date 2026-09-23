package com.moneymove.game

import android.content.Context
import android.content.SharedPreferences
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
     * The deadlock rule's stamp, so rejoining a table does not re-teach a rule
     * this device has already read.
     */
    var reliefSeenAt: Double
        get() = java.lang.Double.longBitsToDouble(sp.getLong(KEY_RELIEF, 0L))
        set(v) = sp.edit().putLong(KEY_RELIEF, java.lang.Double.doubleToRawLongBits(v)).apply()

    /** Whether the six welcome cards have been through once. */
    var seenWelcome: Boolean
        get() = sp.getBoolean(KEY_WELCOME, false)
        set(v) = sp.edit().putBoolean(KEY_WELCOME, v).apply()

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

        private const val KEY_TOKEN = "mm.token"
        private const val KEY_NICKNAME = "mm.nickname"
        private const val KEY_FLAG = "mm.flag"
        private const val KEY_THEME = "mm.theme"
        private const val KEY_APPEARANCE = "mm.appearance"
        private const val KEY_SOUND = "mm.sound"
        private const val KEY_SKIN = "mm.tokenSkin"
        private const val KEY_AVATAR = "mm.avatar"
        private const val KEY_LAST_ROOM = "mm.lastRoom"
        private const val KEY_WELCOME = "mm.seenWelcome"
        private const val KEY_SERVER = "mm.server"
        private const val KEY_RELIEF = "mm.reliefSeen"
    }
}
