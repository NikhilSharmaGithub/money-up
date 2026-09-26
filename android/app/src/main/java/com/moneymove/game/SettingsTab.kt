package com.moneymove.game

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.IndicationNodeFactory
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.node.DelegatableNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlin.math.abs

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
 * Every card is a [Panel], so everything inside knows it is on paper: the
 * controls on it — the name field, the flag, the appearance track — are glass
 * over a card, drawn at the flat level iOS's `cardGlass` holds them to, and
 * everything else is the card's own ink. Every row a thumb goes to is at least
 * [ROW_MIN] tall and says what it is to a screen reader.
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

            // The style in use is the one the app is wearing, not a copy of
            // it kept here: the dot rings when the table has actually changed.
            TableStylePanel(LocalTheme.current) { t ->
                Haptics.tap()
                SoundKit.click()
                onTheme(t)
            }

            AppearancePanel(appearance) { a ->
                Haptics.tap()
                SoundKit.click()
                appearance = a
                onAppearance(a)
            }

            SoundPanel(sound) { on ->
                sound = on
                store.prefs.soundOn = on
                SoundKit.enabled = on
                // The knock iOS's own switch gives as it flips, with the sound
                // on or off: the haptics are not the sound's to take down.
                Haptics.tap()
                if (on) {
                    SoundKit.warmUp()
                    SoundKit.click()
                }
            }

            // After the preferences, before the fine print — the way back into
            // the six cards a new player is shown, then the rules themselves.
            // The row is Welcome.kt's and presses with the default indication,
            // so it is handed the one the help rows use: the same rounded wash
            // on every row on this page that goes somewhere.
            Panel(padding = 14.dp) {
                val wash = rememberRowWash()
                CompositionLocalProvider(LocalIndication provides wash) {
                    IntroAgainRow(Modifier.heightIn(min = ROW_MIN).semantics { role = Role.Button })
                }
            }

            HowToPlayPanel()

            Panel(padding = 14.dp) {
                Text(
                    "An original implementation of the classic property-trading board game. " +
                        "Not affiliated with any trademark holder.",
                    color = p.ink3, fontSize = 11.5.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium,
                )
            }
        }
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
 * iOS's twelve between the three.
 */
@Composable
private fun ProfilePanel(store: GameStore, account: AccountStore) {
    val p = P.current
    Panel(padding = 16.dp) {
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
                SectionLabel("Profile")
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
        GlassField(
            value = store.nickname,
            // Sixteen characters, which is what the server keeps of a name.
            // GameStore writes it through to this phone as it is typed.
            onValueChange = { store.nickname = it.take(16) },
            placeholder = "Your name",
            onDone = { account.saveProfile(name = store.nickname) },
        )
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
 * line under it says so. Something to read, not to press, so a screen reader
 * hears it as the one sentence it is.
 */
@Composable
private fun KarmaBadge(karma: Int) {
    val p = P.current
    val tint = when {
        karma >= 80 -> p.good
        karma >= 50 -> p.gold
        else -> p.bad
    }
    Column(
        Modifier.semantics(mergeDescendants = true) {},
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Row(
            Modifier
                .clip(MMShapes.pill)
                .background(p.sunken)
                .border(1.dp, tint.copy(alpha = 0.45f), MMShapes.pill)
                .padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // heart.fill: the plain solid heart in its own red.
            SfMark("heart.fill", 12.dp, HEART_RED)
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
 * A place to write, as iOS's profile field is: glass set into the card —
 * `cardGlass(floats: false)` — rather than lifted off it, so it casts no
 * shadow, and at the flat level, because what is under it is the card and a
 * blur of one colour is that colour. The words take the glass's ink and the
 * prompt its lifted second ink, since the card's ink3 cannot be read on the
 * material. Forty-eight tall, the least a thumb is promised.
 */
@Composable
private fun GlassField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    onDone: () -> Unit,
) {
    val p = P.current
    val focus = LocalFocusManager.current
    val backdrop = LocalControlBackdrop.current
    val glass = rememberGlassSurface(backdrop)
    Embedded(LocalGlassLightAngle.current) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(color = glass.labelInk(), fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
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
                        .heightIn(min = ROW_MIN)
                        .mmGlass(backdrop = backdrop, shape = MMShapes.r10, lens = false, shadow = GlassShadow.None)
                        .padding(horizontal = 11.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    if (value.isEmpty()) {
                        Text(
                            placeholder,
                            color = glass.labelInk(quiet = true),
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    inner()
                }
            },
        )
    }
}

// ── account & help ─────────────────────────────────────────────────────────

/**
 * Where to read the rules, who to write to, who you have blocked, and the way
 * out — iOS's AccountHelpCard (Safety.swift), row for row and picture for
 * picture: the raised hand, the question in a ring, the envelope, the hand
 * with a line through it, and the bin.
 *
 * Each row is [ROW_MIN] tall where iOS's are about 34, and presses with the
 * rounded wash ([rememberRowWash]) rather than the flat grey block a row gets
 * by default, reaching a little into the card's margin so the words are not
 * pressed against its edge.
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

    Panel(padding = 14.dp) {
        SectionLabel("Account & help", modifier = Modifier.padding(bottom = 4.dp))
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

        val deleting = account.deleting
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = rememberRowWash(),
                    enabled = !deleting,
                    role = Role.Button,
                ) { confirmDelete = true }
                .semantics { if (deleting) stateDescription = "Deleting" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (deleting) SfSpinner(p.bad, 16.dp) else SfMark("trash", 16.dp, p.bad)
            Spacer(Modifier.width(10.dp))
            Text("Delete account", color = p.bad, fontSize = 14.5.sp, fontWeight = FontWeight.Bold)
        }

        Text(
            "Permanently removes your profile, coins, purchases, friends and messages. This can't be undone.",
            color = p.ink3, fontSize = 11.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium,
        )
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
                            .clickable(role = Role.Button) {
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
                        .clickable(role = Role.Button) { onDismiss() },
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
 * the name, what it holds, and the chevron. A button to a screen reader,
 * read as its name and then what it holds — "Blocked players, None".
 */
@Composable
private fun HelpRow(title: String, symbol: String, detail: String? = null, onClick: () -> Unit) {
    val p = P.current
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = ROW_MIN)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = rememberRowWash(),
                role = Role.Button,
            ) { onClick() },
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

// ── the rows' press ────────────────────────────────────────────────────────

/**
 * The press on a row that goes somewhere: a rounded wash of the card's own
 * recess colour under the words, iOS's r10 on the ladder, reaching
 * [ROW_BLEED] past either end of the row into the card's margin so the glyph
 * and the chevron are not pressed against its edge. It is there the moment
 * the finger lands and fades as it lifts, which is a change of shade rather
 * than a movement, so Reduce Motion keeps it.
 *
 * Without it a row presses with the default indication, a grey block the
 * size of the row laid over the words, square in a rounded card. The rows
 * that choose something — a style, an appearance, the sound — show the new
 * choice instead, and have no wash.
 */
@Composable
private fun rememberRowWash(): RowWash {
    val colour = P.current.sunken
    return remember(colour) { RowWash(colour) }
}

private class RowWash(private val colour: Color) : IndicationNodeFactory {
    override fun create(interactionSource: InteractionSource): DelegatableNode =
        RowWashNode(interactionSource, colour)

    override fun equals(other: Any?): Boolean = other is RowWash && other.colour == colour

    override fun hashCode(): Int = colour.hashCode()
}

private class RowWashNode(
    private val touches: InteractionSource,
    private val colour: Color,
) : Modifier.Node(), DrawModifierNode {
    private val shown = Animatable(0f)

    override fun onAttach() {
        coroutineScope.launch {
            touches.interactions.collectLatest { interaction ->
                when (interaction) {
                    is PressInteraction.Press -> shown.snapTo(1f)
                    is PressInteraction.Release, is PressInteraction.Cancel ->
                        shown.animateTo(0f, tween(ROW_WASH_FADE_MS))
                }
            }
        }
    }

    override fun ContentDrawScope.draw() {
        val a = shown.value
        if (a > 0f) {
            val bleed = ROW_BLEED.toPx()
            val outline = MMShapes.r10.createOutline(Size(size.width + bleed * 2, size.height), layoutDirection, this)
            translate(left = -bleed) { drawOutline(outline, colour, alpha = a) }
        }
        drawContent()
    }
}

// ── table style ────────────────────────────────────────────────────────────

/**
 * iOS's ThemePicker: the seven tables as a row of 30 dots, the one in use
 * ringed three out and a touch bigger, and its name underneath.
 *
 * Each dot stands in a seventh of the row and a slot [ROW_MIN] tall, so what
 * a thumb aims at is the slot and not the 30 in its middle. The slot has nine
 * above and below the dot, so the spaces either side of the row give those
 * nine back and the dots sit where iOS's do. A seventh of a 320 phone is 36
 * wide, short of 48; seven tables in one row cannot all have it, and one row
 * is what iOS shows. To a screen reader they are a group of radio buttons,
 * each named for its table.
 */
@Composable
private fun TableStylePanel(current: MMTheme, onPick: (MMTheme) -> Unit) {
    val p = P.current
    Panel(padding = 16.dp) {
        SectionLabel("Table style")
        Spacer(Modifier.height(1.dp))
        Row(Modifier.fillMaxWidth().selectableGroup()) {
            for (t in MMTheme.entries) {
                ThemeDot(t, on = t == current, Modifier.weight(1f)) { onPick(t) }
            }
        }
        Text(current.title, color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun ThemeDot(style: MMTheme, on: Boolean, modifier: Modifier, onPick: () -> Unit) {
    val p = P.current
    // iOS's spring(duration: 0.25): no bounce, a quarter-second settle. Under
    // Reduce Motion the ring and the size are simply where they end up.
    val settle: AnimationSpec<Float> =
        if (rememberReduceMotion()) snap() else spring(dampingRatio = 1f, stiffness = 630f)
    val grow by animateFloatAsState(if (on) 1.08f else 1f, settle, label = "theme-dot")
    val ring by animateFloatAsState(if (on) 1f else 0f, settle, label = "theme-ring")
    Box(
        modifier
            .height(ROW_MIN)
            .selectable(
                selected = on,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.RadioButton,
            ) { onPick() }
            .semantics { contentDescription = style.title },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(30.dp)
                .graphicsLayer {
                    scaleX = grow
                    scaleY = grow
                }
                // The ring stands three off the dot, as iOS pads its stroke
                // out by three, so it is drawn past the dot's own edge.
                .drawBehind {
                    drawCircle(style.dot)
                    if (ring > 0f) {
                        drawCircle(
                            p.ink.copy(alpha = p.ink.alpha * ring),
                            radius = size.minDimension / 2 + 3.dp.toPx(),
                            style = Stroke(width = 2.5.dp.toPx()),
                        )
                    }
                },
        )
    }
}

// ── appearance ─────────────────────────────────────────────────────────────

/**
 * Light, dark, or follow the phone — which of the table style's two palettes
 * the whole app wears — and what the choice means underneath: iOS's
 * appearanceCard, ten between the three.
 */
@Composable
private fun AppearancePanel(current: MMAppearance, onPick: (MMAppearance) -> Unit) {
    val p = P.current
    Panel(padding = 16.dp) {
        SectionLabel("Appearance")
        Spacer(Modifier.height(10.dp))
        AppearanceSegments(current, onPick)
        Spacer(Modifier.height(10.dp))
        Text(current.caption, color = p.ink3, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * Three chips were three controls that happened to sit in a row, each with
 * its own gold wash; this is one control, the way the system draws a choice
 * of three, and iOS's appearanceSegments. One track of glass on the card, and
 * on it a lozenge that travels to the choice and stretches on the way —
 * longest at the halfway mark of the whole trip — the same travel, curve and
 * stretch as the tab bar's selection (AppScaffold.kt), rather than one ring
 * fading out while another fades in. Under Reduce Motion it is simply there.
 *
 * The lozenge is a well in the track, not a second pane: glass never stacks
 * on glass. It is the track's own ink at a tenth ([well]), so it flips when
 * the glass under it does and deepens under Increase Contrast. An 18 track
 * with 4 of padding holds a 14 lozenge, concentric by arithmetic.
 */
@Composable
private fun AppearanceSegments(current: MMAppearance, onPick: (MMAppearance) -> Unit) {
    val modes = MMAppearance.entries
    val backdrop = LocalControlBackdrop.current
    val glass = rememberGlassSurface(backdrop)
    val reduceMotion = rememberReduceMotion()
    val lozenge = MMShapes.innerShape(18.dp, SEGMENT_INSET)

    // Where the lozenge is, in slots, and where this trip began and ends, so
    // the stretch peaks halfway along whatever distance was asked for. The
    // two ends are set together, by the trip itself, so a frame drawn between
    // a new choice and its trip starting never measures one trip against the
    // other's start.
    val index = modes.indexOf(current).toFloat()
    val travel = remember { Animatable(index) }
    var origin by remember { mutableFloatStateOf(index) }
    var target by remember { mutableFloatStateOf(index) }
    LaunchedEffect(index, reduceMotion) {
        origin = travel.value
        target = index
        if (reduceMotion) {
            travel.snapTo(index)
        } else {
            travel.animateTo(index, tween(GlassMotion.INDICATOR_MS, easing = FastOutSlowInEasing))
        }
    }

    Embedded(LocalGlassLightAngle.current) {
        val well = glass.well()
        Row(
            Modifier
                .fillMaxWidth()
                .mmGlass(backdrop = backdrop, shape = MMShapes.r18, lens = false, shadow = GlassShadow.Relaxed)
                .padding(SEGMENT_INSET)
                // Drawn rather than laid out, so the travel redraws the track
                // and recomposes nothing.
                .drawBehind {
                    val slot = size.width / modes.size
                    val span = target - origin
                    val progress =
                        if (abs(span) < 0.001f) 0f
                        else ((travel.value - origin) / span).coerceIn(0f, 1f)
                    val stretch = 1f + 0.48f * progress * (1f - progress)
                    val left = slot * travel.value
                    val outline = lozenge.createOutline(Size(slot, size.height), layoutDirection, this)
                    translate(left = left) {
                        scale(scaleX = stretch, scaleY = 1f, pivot = Offset(slot / 2, size.height / 2)) {
                            drawOutline(outline, well)
                        }
                    }
                }
                .selectableGroup(),
        ) {
            for (mode in modes) {
                AppearanceSegment(mode, on = mode == current, glass, Modifier.weight(1f)) { onPick(mode) }
            }
        }
    }
}

/**
 * One of the three: its picture over its name, the name in the glass's own
 * ink when chosen and its lifted second ink when not. Six inside the track's
 * four is the ten the chips had, so the control stands as tall as the row it
 * replaced, and every segment is well past [ROW_MIN].
 */
@Composable
private fun AppearanceSegment(
    mode: MMAppearance,
    on: Boolean,
    glass: GlassSurface,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    Column(
        modifier
            .heightIn(min = ROW_MIN)
            .selectable(
                selected = on,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.RadioButton,
            ) { onClick() }
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
    ) {
        AppearanceGlyph(mode, on, glass)
        Text(
            mode.title,
            color = glass.labelInk(quiet = !on),
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
    }
}

/**
 * Sun and moon keep their own colours — iOS's sun.max.fill and moon.fill,
 * each one solid colour, the same whatever the glass is doing; System wears
 * the half-and-half disc, in brass when it is the choice and in the glass's
 * quiet ink when not.
 */
@Composable
private fun AppearanceGlyph(mode: MMAppearance, on: Boolean, glass: GlassSurface) {
    val p = P.current
    when (mode) {
        MMAppearance.LIGHT -> SfMark("sun.max.fill", 18.dp, SUN_GOLD)
        MMAppearance.DARK -> SfMark("moon.fill", 18.dp, MOON_BLUE)
        // iOS sets a fifteen-point symbol in the sun and moon's eighteen-point
        // frame; the drawn disc fills about four-fifths of its square, so
        // eighteen here is that same fifteen-point disc.
        MMAppearance.SYSTEM -> SfMark(
            "circle.lefthalf.filled", 18.dp,
            if (on) p.gold else glass.labelInk(quiet = true),
        )
    }
}

// ── sound ──────────────────────────────────────────────────────────────────

/**
 * Sound only. The knocks are a separate thing on iOS — they follow the
 * phone's own touch-feedback setting and keep going with the sound off — and
 * this switch used to take them down with it, until the next launch quietly
 * put them back.
 *
 * The whole row is the switch, as iOS's Toggle is, so the words are as good
 * a place to tap as the knob, and a screen reader hears one switch with its
 * name and its caption rather than a stray control beside a paragraph. It is
 * the same drawn switch the game-settings sheet shows ([MMSwitch]), forty
 * clear of a caption that wraps where the iPhone's does.
 */
@Composable
private fun SoundPanel(on: Boolean, onChange: (Boolean) -> Unit) {
    val p = P.current
    Panel(padding = 16.dp) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN)
                .toggleable(
                    value = on,
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    role = Role.Switch,
                    onValueChange = onChange,
                ),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                SectionLabel("Sound")
                Text(
                    "Dice, coins and the little \"ishh\" when you pay rent.",
                    color = p.ink3, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                )
            }
            Spacer(Modifier.width(40.dp))
            MMSwitch(on)
        }
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
    Panel(padding = 16.dp) {
        SectionLabel("How to play")
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

// ── measurements ───────────────────────────────────────────────────────────

/** The least a row a thumb goes to is ever given — Android's own minimum target. */
private val ROW_MIN: Dp = 48.dp

/** How far a row's press wash reaches past the row into the card's margin. */
private val ROW_BLEED: Dp = 8.dp

/** How long a row's wash takes to go once the finger lifts. */
private const val ROW_WASH_FADE_MS = 160

/** The appearance track's padding round its segments: 18 outside, 14 inside. */
private val SEGMENT_INSET: Dp = 4.dp

/**
 * The colours of three of iOS's symbols, which are the symbols' own and not a
 * table's: the sun is gold and the moon is dusk-blue on every style, as they
 * are on the iPhone (Art.swift), and the karma heart is its own red.
 */
private val SUN_GOLD = Color(0xFFF5C542)
private val MOON_BLUE = Color(0xFF6F7FD4)
private val HEART_RED = Color(0xFFE0435C)
