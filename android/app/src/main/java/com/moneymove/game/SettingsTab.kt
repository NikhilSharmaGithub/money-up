package com.moneymove.game

import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.graphics.luminance
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.Dialog
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Who this player is, the way out, and how the table looks and sounds.
 *
 * In iOS's order (LandingView.swift, settingsTab): the profile first, then
 * account and help straight after it — not at the bottom of the page where
 * nobody looks for "Delete account" — then the preferences, then the way
 * back into the intro and the rules. Signing in is not here: it is the
 * account card at the top of Play and Social, where the coins it protects
 * are counted.
 *
 * `messaging` is only for deleting the account, which has to forget the
 * message thread and the invites along with everything else.
 */
@Composable
fun SettingsTab(
    store: GameStore,
    account: AccountStore,
    onTheme: (MMTheme) -> Unit,
    onAppearance: (MMAppearance) -> Unit,
    messaging: MessagingStore? = null,
) {
    val p = P.current
    var theme by remember { mutableStateOf(store.prefs.theme) }
    var appearance by remember { mutableStateOf(store.prefs.appearance) }
    var sound by remember { mutableStateOf(store.prefs.soundOn) }
    LaunchedEffect(Unit) {
        account.refresh()
        // Posting the profile is what makes the friend code under the name
        // one somebody can actually add, and the blocked list is the count on
        // the Blocked players row — iOS's profile card and help card each ask
        // for theirs as they appear.
        account.refreshSocial(onBlocked = store::applyBlocked, onMyCode = store::applyMyCode)
    }

    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // iOS's tabPage: eighteen between cards, twenty off the top, and no
        // wider than 560 so a tablet reads as a column.
        Column(
            Modifier
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("Settings", color = p.ink, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold)
                Text("Make the table yours.", color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            }

            ProfilePanel(store, account)

            AccountHelpPanel(store, account, messaging)

            // iOS's ThemePicker: the seven tables as a row of dots, the one in
            // use ringed and a touch bigger, and its name underneath.
            Card(padding = 16.dp) {
                PanelTitle("Table style")
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    for (t in MMTheme.entries) {
                        val on = t == theme
                        val grow by animateFloatAsState(if (on) 1.08f else 1f, label = "theme-dot")
                        Box(
                            Modifier
                                .size(30.dp)
                                .graphicsLayer {
                                    scaleX = grow
                                    scaleY = grow
                                }
                                .drawBehind {
                                    if (on) {
                                        // The ring stands three points off the dot, as
                                        // iOS pads its stroke out by three.
                                        val ring = 2.5.dp.toPx()
                                        drawCircle(
                                            p.ink,
                                            radius = size.minDimension / 2 + 3.dp.toPx(),
                                            style = Stroke(width = ring),
                                        )
                                    }
                                }
                                .clip(CircleShape)
                                .background(t.dot)
                                .clickable {
                                    Haptics.tap()
                                    SoundKit.click()
                                    theme = t
                                    onTheme(t)
                                },
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text(theme.title, color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
            }

            // Light, dark, or follow the phone: three chips, the current one
            // on a gold wash with a gold rim, and what it means underneath.
            Card(padding = 16.dp) {
                PanelTitle("Appearance")
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (a in MMAppearance.entries) {
                        AppearanceChip(a, on = a == appearance, Modifier.weight(1f)) {
                            Haptics.tap()
                            SoundKit.click()
                            appearance = a
                            onAppearance(a)
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                Text(appearance.caption, color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
            }

            Card(padding = 16.dp) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        PanelTitle("Sound")
                        Text(
                            "Dice, coins and the little \"ishh\" when you pay rent.",
                            color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    // Sound only. The knocks are a separate thing on iOS — they
                    // follow the phone's own touch-feedback setting and keep
                    // going with the sound off — and this switch used to take
                    // them down with it, until the next launch quietly put them
                    // back.
                    Switch(
                        checked = sound,
                        onCheckedChange = {
                            sound = it
                            store.prefs.soundOn = it
                            SoundKit.enabled = it
                            if (it) {
                                SoundKit.warmUp()
                                SoundKit.click()
                            }
                        },
                        // iOS's switch: the accent when on, a grey well when
                        // off, and a white knob the same size either way —
                        // the empty thumb content is what stops Material
                        // shrinking the knob while it is off.
                        thumbContent = { Box(Modifier.size(SwitchDefaults.IconSize)) },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Color.White,
                            checkedTrackColor = p.red,
                            checkedBorderColor = Color.Transparent,
                            uncheckedThumbColor = Color.White,
                            uncheckedTrackColor = p.ink3.copy(alpha = 0.32f),
                            uncheckedBorderColor = Color.Transparent,
                        ),
                    )
                }
            }

            // After the preferences, before the fine print — the way back into
            // the six cards a new player is shown, then the rules themselves.
            Card { IntroAgainRow() }

            HowToPlayPanel()

            Card {
                Text(
                    "An original implementation of the classic property-trading board game. " +
                        "Not affiliated with any trademark holder.",
                    color = p.ink3, fontSize = 11.5.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

/**
 * One appearance chip, iOS's: the sun, the moon, or a half-filled disc for
 * System, the word under it, and a gold wash and rim on the one in use.
 */
@Composable
private fun AppearanceChip(mode: MMAppearance, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val p = P.current
    val shape = RoundedCornerShape(12.dp)
    val grow by animateFloatAsState(if (on) 1.03f else 1f, label = "appearance-chip")
    Column(
        modifier
            .graphicsLayer {
                scaleX = grow
                scaleY = grow
            }
            .clip(shape)
            .background(if (on) p.goldSoft else p.sunken)
            .border(if (on) 1.8.dp else 1.dp, if (on) p.gold else p.rule, shape)
            .clickable { onClick() }
            .padding(vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // Sun and moon keep their own colours — iOS's sun.max.fill and
        // moon.fill, each one solid colour; System wears the half-and-half
        // disc in the chip's ink.
        when (mode) {
            MMAppearance.LIGHT -> SfMark("sun.max.fill", 18.dp, Color(0xFFF5C542))
            MMAppearance.DARK -> SfMark("moon.fill", 18.dp, Color(0xFF6F7FD4))
            // iOS sets a fifteen-point symbol in the sun and moon's
            // eighteen-point frame; the drawn disc fills about four-fifths of
            // its square, so eighteen here is that same fifteen-point disc.
            MMAppearance.SYSTEM -> SfMark("circle.lefthalf.filled", 18.dp, if (on) p.gold else p.ink3)
        }
        Text(
            mode.title,
            color = if (on) p.ink else p.ink2, fontSize = 12.sp, fontWeight = FontWeight.Bold,
        )
    }
}

// ── profile ────────────────────────────────────────────────────────────────

/**
 * Who this player is at every table: the face, the name, the flag, and the
 * karma they are keeping by finishing games.
 *
 * The name is saved to the profile when the keyboard's Done is pressed, as
 * iOS saves it on return; the flag the moment it is picked, because the cup
 * converts its prize by the flag on the profile and not the one on the phone.
 */
@Composable
private fun ProfilePanel(store: GameStore, account: AccountStore) {
    val p = P.current
    Card(padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AvatarDisc(
                name = store.nickname.ifEmpty { "P" },
                color = "#4ade80",
                size = 46.dp,
                flag = store.flag,
                avatar = wornAvatar(store, account),
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                PanelTitle("Profile")
                // Only once the server has confirmed a code, as iOS waits for
                // its profile call: "Friend code" and a blank is a line that
                // says less than no line at all, and a code worked out on the
                // phone may be one nobody can add yet.
                val code = account.confirmedCode
                if (code.isNotBlank()) {
                    Text(
                        "Friend code $code",
                        color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold,
                    )
                }
            }
            Spacer(Modifier.width(12.dp))
            KarmaBadge(account.wallet?.karma ?: account.me?.karma ?: 100)
        }
        Spacer(Modifier.height(12.dp))
        ProfileNameField(store) { account.saveProfile(name = store.nickname) }
        Spacer(Modifier.height(12.dp))
        FlagPicker(store.flag, onPick = { flag ->
            store.setAppearance(flagCode = flag)
            account.saveProfile(flag = flag)
        })
    }
}

/**
 * The store face this player wears. The wallet says which item is on; the
 * shelf says what it looks like. Until both have answered, the one this phone
 * remembers from the last time it was equipped here.
 */
private fun wornAvatar(store: GameStore, account: AccountStore): String {
    val wallet = account.wallet ?: return store.prefs.avatar
    val worn = wallet.equipped["avatar"] ?: return ""
    return account.store?.items?.firstOrNull { it.id == worn }?.emoji ?: store.prefs.avatar
}

/**
 * Karma starts full and is only ever docked for walking out on a table that
 * is still playing — so the number is really a promise to finish, and the
 * line under it says so.
 */
@Composable
private fun KarmaBadge(karma: Int) {
    val p = P.current
    val tint = when {
        karma >= 80 -> p.good
        karma >= 50 -> p.gold
        else -> p.bad
    }
    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(
            Modifier
                .clip(RoundedCornerShape(99.dp))
                .background(p.sunken)
                .border(1.dp, tint.copy(alpha = 0.45f), RoundedCornerShape(99.dp))
                .padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // heart.fill: the plain solid heart in its own red.
            SfMark("heart.fill", 12.dp, Color(0xFFE0435C))
            Spacer(Modifier.width(5.dp))
            Text("$karma karma", color = tint, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold)
        }
        Text(
            "play to the end to keep it",
            color = p.ink3, fontSize = 9.5.sp, fontWeight = FontWeight.SemiBold,
        )
    }
}

/**
 * The name, written through to this phone as it is typed (GameStore does
 * that) and to the profile on Done. Sixteen characters, which is what the
 * server keeps of a name.
 */
@Composable
private fun ProfileNameField(store: GameStore, onDone: () -> Unit) {
    val p = P.current
    val focus = LocalFocusManager.current
    val shape = RoundedCornerShape(10.dp)
    BasicTextField(
        value = store.nickname,
        onValueChange = { store.nickname = it.take(16) },
        singleLine = true,
        textStyle = TextStyle(color = p.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
        cursorBrush = SolidColor(p.red),
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.Words,
            autoCorrectEnabled = false,
            imeAction = ImeAction.Done,
        ),
        keyboardActions = KeyboardActions(onDone = {
            focus.clearFocus()
            onDone()
        }),
        decorationBox = { inner ->
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(shape)
                    .background(p.sunken)
                    .padding(11.dp),
            ) {
                if (store.nickname.isEmpty()) {
                    Text("Your name", color = p.ink3, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                }
                inner()
            }
        },
    )
}

// ── account & help ─────────────────────────────────────────────────────────

/**
 * Where to read the rules, who to write to, who you have blocked, and the way
 * out — iOS's AccountHelpCard (Safety.swift), row for row and picture for
 * picture: the raised hand, the question in a ring, the envelope, the hand
 * with a line through it, and the bin.
 *
 * Deleting is the one irreversible thing in the app, so it asks first, in a
 * dialog: this is a screen, not a sheet, which is the one place a dialog is
 * safe to raise. The row stops answering while the request is in the air,
 * with the iPhone's spinner where the bin was, because the only thing worse
 * than deleting an account by accident is sending the request twice.
 */
@Composable
private fun AccountHelpPanel(store: GameStore, account: AccountStore, messaging: MessagingStore?) {
    val p = P.current
    val context = LocalContext.current
    val uri = LocalUriHandler.current
    var confirmDelete by remember { mutableStateOf(false) }
    var blocked by remember { mutableStateOf(false) }

    // A phone with no browser or no mail app throws rather than opening
    // nothing, so the address goes on the clipboard instead and says so.
    fun open(target: String, copy: String, copied: String) {
        runCatching { uri.openUri(target) }
            .onFailure { copyText(context, copy) { store.showToast(copied) } }
    }

    Card {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            PanelTitle("Account & help", Modifier.padding(bottom = 4.dp))
            HelpRow("Privacy Policy", "hand.raised") {
                open(Prefs.PRIVACY_URL, Prefs.PRIVACY_URL, "Link copied")
            }
            HelpRow("Support & community rules", "questionmark.circle") {
                open(Prefs.SUPPORT_URL, Prefs.SUPPORT_URL, "Link copied")
            }
            HelpRow("Contact us", "envelope") {
                open("mailto:${Prefs.CONTACT_EMAIL}", Prefs.CONTACT_EMAIL, "Email address copied")
            }
            HelpRow(
                "Blocked players", "hand.raised.slash",
                detail = store.blockedCodes.size.let { if (it == 0) "None" else "$it" },
            ) { blocked = true }

            Rule(Modifier.padding(vertical = 6.dp))

            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable(enabled = !account.deleting) { confirmDelete = true }
                    .padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (account.deleting) SfSpinner(p.bad, 16.dp) else SfMark("trash", 16.dp, p.bad)
                Spacer(Modifier.width(10.dp))
                Text("Delete account", color = p.bad, fontSize = 14.5.sp, fontWeight = FontWeight.Bold)
            }

            Text(
                "Permanently removes your profile, coins, purchases, friends and messages. This can't be undone.",
                color = p.ink3, fontSize = 11.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium,
            )
        }
    }

    if (confirmDelete) {
        DeleteActionSheet(
            onDelete = {
                account.deleteAccount(
                    // A new token first, then everything that knew the old
                    // one: the table side, then the messages and invites.
                    startFresh = {
                        store.startFresh()
                        messaging?.forgetIdentity()
                    },
                ) { error ->
                    if (error == null) store.showToast("Your account and everything in it has been deleted.")
                    else store.showToast(error, isError = true)
                }
            },
            onDismiss = { confirmDelete = false },
        )
    }

    if (blocked) {
        val safety = remember(account) { account.safety() }
        BlockedPlayersSheet(
            codes = store.blockedCodes,
            safety = safety,
            // The answer carries the whole list, so the screen never has to
            // guess what the server now thinks — and when it somehow does
            // not, the one code that just went is all that changes.
            onUnblock = { code, now -> store.applyBlocked(now ?: (store.blockedCodes - code)) },
            onDismiss = { blocked = false },
        )
    }
}

/**
 * iOS's confirmationDialog for Delete account: the system action sheet, up
 * from the bottom — the small grey title and the message centred in the
 * first group over a hairline and the red "Delete account", and Cancel in a
 * group of its own under it. A centred card with buttons in it is a different
 * kind of question. Raised from the Settings screen, never from a sheet.
 */
@Composable
private fun DeleteActionSheet(onDelete: () -> Unit, onDismiss: () -> Unit) {
    val p = P.current
    val dark = p.page.luminance() < 0.5f
    val group = if (dark) Color(0xFF2C2C2E) else Color(0xFFF2F2F7)
    val hairline = if (dark) Color(0x5C545458) else Color(0x4A3C3C43)
    val cancelBlue = if (dark) Color(0xFF0A84FF) else Color(0xFF007AFF)
    val shape = RoundedCornerShape(14.dp)
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onDismiss() },
            contentAlignment = Alignment.BottomCenter,
        ) {
            Column(
                Modifier
                    .navigationBarsPadding()
                    .padding(horizontal = 8.dp)
                    .padding(bottom = 8.dp)
                    .widthIn(max = 500.dp)
                    .fillMaxWidth()
                    // Taps inside the groups are theirs, not the scrim's.
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Column(Modifier.fillMaxWidth().clip(shape).background(group)) {
                    Column(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            "Delete your account?",
                            color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                            textAlign = TextAlign.Center,
                        )
                        Text(
                            "Your profile, coins, anything you bought, your friends and your messages will be deleted for good.",
                            color = p.ink3, fontSize = 13.sp, fontWeight = FontWeight.Normal,
                            textAlign = TextAlign.Center,
                        )
                    }
                    Box(Modifier.fillMaxWidth().height(0.5.dp).background(hairline))
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(57.dp)
                            .clickable {
                                onDismiss()
                                onDelete()
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("Delete account", color = p.bad, fontSize = 20.sp, fontWeight = FontWeight.Normal)
                    }
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(57.dp)
                        .clip(shape)
                        .background(group)
                        .clickable { onDismiss() },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("Cancel", color = cancelBlue, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

/**
 * One row of Account & help: iOS's system picture in a column of its own,
 * the name, what it holds, and the chevron.
 */
@Composable
private fun HelpRow(title: String, symbol: String, detail: String? = null, onClick: () -> Unit) {
    val p = P.current
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(22.dp), contentAlignment = Alignment.Center) {
            SfMark(symbol, 16.dp, p.ink2)
        }
        Spacer(Modifier.width(10.dp))
        Text(
            title,
            color = p.ink, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f),
        )
        detail?.let {
            Text(it, color = p.ink3, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.width(10.dp))
        }
        RowChevron(p.ink3, 11.dp)
    }
}

// ── the rules ──────────────────────────────────────────────────────────────

/**
 * The classic rules in one screen — iOS's HowToPlayCard, which reads out the
 * web's RULES_HELP in the same order. The Play tab's bulb opens the
 * questions people ask mid-game; this is the rulebook they can scroll to.
 */
@Composable
private fun HowToPlayPanel() {
    val p = P.current
    Card(padding = 16.dp) {
        PanelTitle("How to play")
        Spacer(Modifier.height(3.dp))
        Text(
            "The classic property-trading rules, in one screen.",
            color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium,
        )
        Spacer(Modifier.height(12.dp))
        Column(verticalArrangement = Arrangement.spacedBy(11.dp)) {
            for ((glyph, title, body) in RULES) {
                Row {
                    Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) {
                        // iOS draws two of these from its symbol set: an
                        // upright key.fill and the solid building.columns.fill.
                        when (glyph) {
                            "bank" -> SfMark("building.columns.fill", 20.dp, p.ink2)
                            "key" -> Icon(glyph, size = 20.dp, tint = p.ink2, modifier = Modifier.graphicsLayer { rotationZ = 45f })
                            else -> Icon(glyph, size = 20.dp, tint = p.ink2)
                        }
                    }
                    Spacer(Modifier.width(11.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(title, color = p.ink, fontSize = 13.5.sp, fontWeight = FontWeight.ExtraBold)
                        Text(
                            body,
                            color = p.ink3, fontSize = 12.sp, lineHeight = 16.5.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(14.dp))
        Text(
            "Tap any tile for its full deed — price, rent ladder and who owns it.",
            color = p.ink3, fontSize = 11.5.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium,
        )
    }
}

/** HowToPlay.swift's eight, word for word — the same rules on every client. */
private val RULES = listOf(
    Triple(
        "dice", "Rolling",
        "Roll two dice and move. A double lets you roll again — but three doubles in a row sends you straight to prison.",
    ),
    Triple(
        "key", "Buying",
        "Land on an unowned street, airport or utility and you may buy it. Turn it down and it goes to auction, where everyone can bid.",
    ),
    Triple(
        "crane", "Building",
        "Own every street of one country and you can build houses, then a hotel. Rent climbs steeply with each one.",
    ),
    Triple(
        "payment", "Rent",
        "Land on someone else’s property and you pay their rent. Airports scale 25 / 50 / 100 / 200; utilities charge 4× or 10× your roll.",
    ),
    Triple(
        "bank", "Mortgage",
        "Short of cash? Mortgage a property for half its price. Mortgaged streets collect no rent until you buy them back at 10% interest.",
    ),
    Triple(
        "trade", "Trading",
        "Offer any mix of cash, properties and prison cards to any player, at any time. Streets with buildings can’t be traded.",
    ),
    Triple(
        "police", "Prison",
        "Roll a double to walk out, pay the \$50 fine, or use a card. After three failed attempts you pay anyway.",
    ),
    Triple(
        "skull", "Bankruptcy",
        "Owe more than you can raise and you must sell, mortgage or trade. Give up and everything goes to your creditor. Last player standing wins.",
    ),
)

// ── house pieces, in iOS's measurements ────────────────────────────────────

/** iOS's PanelTitle: small capitals one point apart, in the quietest ink. */
@Composable
private fun PanelTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        modifier = modifier,
        color = P.current.ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
        maxLines = 1,
    )
}

/**
 * iOS's MMCard: sixteen-point corners, the card fill, a hairline and the soft
 * shadow under it, with iOS's fourteen points inside unless a card asks for
 * more.
 */
@Composable
private fun Card(padding: Dp = 14.dp, content: @Composable ColumnScope.() -> Unit) {
    val p = P.current
    val shape = RoundedCornerShape(16.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .shadow(6.dp, shape, clip = false)
            .clip(shape)
            .background(p.card)
            .border(1.dp, p.rule, shape)
            .padding(padding),
        content = content,
    )
}
