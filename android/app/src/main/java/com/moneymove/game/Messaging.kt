package com.moneymove.game

import kotlinx.serialization.Serializable

/**
 * What the server hands over when the subject is a conversation: the messages
 * two friends have sent each other, and the notes whoever runs the game sends
 * out.
 *
 * These belong to the same REST half of the protocol as [MeView] and the rest
 * of Account.kt, and they are shaped exactly as `server/social.js` writes them
 * — `dmsWith` answers `{ messages, me }`, `noticesFor` answers
 * `{ notices, unread }`. They sit in their own file because messaging is the
 * one part of that half with screens and a poll of its own.
 */

/**
 * One line in a thread.
 *
 * `from` is a friend code, not a name: the server stores `me.code` and never
 * the display name, because a name can change between one message and the
 * next and the thread would then be a conversation between two strangers.
 * Compare it with [DMThread.me] to know which side of the screen it goes on.
 */
@Serializable
data class DMessage(
    val from: String = "",
    val text: String = "",
    /** Epoch milliseconds, as `Date.now()` wrote it. */
    val at: Double = 0.0,
)

@Serializable
data class DMThread(
    /** Oldest first, capped at the last 200 the two of you have exchanged. */
    val messages: List<DMessage> = emptyList(),
    /** This player's own friend code, so a thread can tell whose words are whose. */
    val me: String = "",
)

/**
 * A note from the owner, to one player or to the whole field.
 *
 * `personal` is the field worth reading twice: "you won" and "everybody won"
 * are different sentences, and a list that draws them the same way turns the
 * first into the second.
 */
@Serializable
data class Notice(
    val id: String = "",
    val text: String = "",
    val title: String = "",
    /** Epoch milliseconds. */
    val at: Double = 0.0,
    val personal: Boolean = false,
    /** Written since this player last opened the list. */
    val unread: Boolean = false,
)

@Serializable
data class NoticeFeed(
    /** Newest first, the most recent fifty. */
    val notices: List<Notice> = emptyList(),
    val unread: Int = 0,
)
