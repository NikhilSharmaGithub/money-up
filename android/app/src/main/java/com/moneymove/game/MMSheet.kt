package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.dismiss
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import kotlinx.coroutines.launch

/**
 * The one sheet.
 *
 * A sheet here used to be a `ModalBottomSheet` painting its own flat paper —
 * the same five lines copied from file to file, each copy free to pick
 * `sheet` or `page` for itself. This is those lines once, and what a sheet
 * gets from them is the material: a sheet is navigation, the layer that
 * rises over the table, so its shell is glass. What it holds is not. The
 * deed, the chat log, the standings, the rows of settings are what the
 * player opened it to read, and they keep their own paper inside it — a
 * [Panel] in a sheet is still a panel. Glass is the platter they sit on,
 * never the thing on it.
 *
 * It is permanently tier 0, on every phone. `ModalBottomSheet` is a window of
 * its own, and the page's one blurred copy lives in the app's window, where
 * `positionInRoot()` from in here cannot reach it; a sheet that tried would
 * sample the wrong corner of the wrong window. So the handle to it is taken
 * away at the door ([LocalBackdrop] is null for everything inside), and
 * nothing in a sheet — the shell, a button, a field — can ever go looking for
 * it. That is the right answer on its own merits too: a sheet covers what is
 * behind it, and there is nothing under it worth refracting.
 *
 * Which means the film cannot go over the table. Without a blur, 38% of
 * whatever sits under a sheet would read straight through the words on it —
 * the board's tiles ghosting through a list of rules. So the shell lays the
 * sheet's own paper down first and declares exactly that as its backdrop
 * ([BackdropKind.Sheet]): the material over a flat colour it put there
 * itself, which is the flat level's own case and is not an approximation,
 * because a blur of one colour is that colour. `ConfirmDialog` in Ui.kt does
 * the same for the same reason; this is that, for a sheet. What the glass
 * adds over the old paper is the film and its warmth, the specular rim along
 * the top edge and the glow under it — and under Reduce Transparency the
 * whole thing becomes the table's designed solid, with not a pixel moved.
 * The face it wears is always the app's own, light by day and dark by night,
 * because the paper it declares is the app's own paper.
 *
 * The platter casts no shadow of its own. `ModalBottomSheet` clips whatever
 * it holds to the sheet's own bounds, and the material only ever draws its
 * shadow outside the silhouette, so there is nowhere for one to land; the
 * scrim was already the thing that lifts a sheet off the table, and it still
 * is.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MMSheet(
    onDismissRequest: () -> Unit,
    sheetState: SheetState = rememberModalBottomSheetState(),
    /**
     * A grabber, for the sheets that ask for one. It is drawn *on* the glass
     * rather than in Material's own slot, which sits outside the content and
     * would leave the top of the sheet bare where the glass should be.
     */
    dragHandle: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val p = P.current
    val scope = rememberCoroutineScope()
    ModalBottomSheet(
        onDismissRequest = onDismissRequest,
        sheetState = sheetState,
        // The sheet's own surface paints nothing and clips only to its
        // rectangle, which is also what trims the platter's overhang. The
        // corner is the glass's — see [SheetPlatter] — and a squircle handed
        // to the surface as a clip would not be anti-aliased on every phone
        // this runs on, where the glass's own fill always is.
        shape = RectangleShape,
        containerColor = Color.Transparent,
        dragHandle = null,
        // Material pads a sheet's content for the system bars and the
        // keyboard on a column of its own, outside the content, where the
        // glass cannot reach. The same insets are taken again below, inside
        // the glass, so the content sits exactly where it did and the glass
        // runs on under the navigation bar to the bottom edge of the screen,
        // as the paper did.
        contentWindowInsets = { WindowInsets(0, 0, 0, 0) },
    ) {
        val insets = BottomSheetDefaults.windowInsets
        CompositionLocalProvider(
            LocalBackdrop provides null,
            // Whatever opened this — a button on a glass bar, a row in a
            // panel — is somewhere else now. Inside a sheet the controls are
            // on a sheet: glass panes over its platter, as iOS's are, not
            // wells in a bar or panes on a card.
            LocalGlassHost provides null,
            LocalControlBackdrop provides BackdropKind.Sheet,
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(p.sheet, SheetPlatter)
                    .mmGlass(
                        backdrop = BackdropKind.Sheet,
                        shape = SheetPlatter,
                        // No blur to bend and no layer to bend it in: the
                        // lens needs the shared copy a sheet cannot reach.
                        lens = false,
                        shadow = GlassShadow.None,
                    )
                    // What the sheet holds is still cut to its corners, as the
                    // surface's own rounded clip used to cut it, so a line
                    // scrolled up to the top edge cannot poke out past the
                    // curve. Only the content: the glass is drawn outside
                    // this clip, so its own edge stays anti-aliased.
                    .clip(SheetPlatter)
                    .windowInsetsPadding(insets),
            ) {
                if (dragHandle != null) {
                    Box(
                        Modifier
                            .align(Alignment.CenterHorizontally)
                            // Material's slot gives a screen reader these
                            // three on the grabber, and moving the grabber
                            // onto the glass is not a reason to lose them.
                            .semantics(mergeDescendants = true) {
                                dismiss(DISMISS_LABEL) {
                                    scope.launch { sheetState.hide() }.invokeOnCompletion {
                                        if (!sheetState.isVisible) onDismissRequest()
                                    }
                                    true
                                }
                                if (sheetState.currentValue == SheetValue.PartiallyExpanded) {
                                    expand(EXPAND_LABEL) {
                                        scope.launch { sheetState.expand() }
                                        true
                                    }
                                } else if (sheetState.hasPartiallyExpandedState) {
                                    collapse(COLLAPSE_LABEL) {
                                        scope.launch { sheetState.partialExpand() }
                                        true
                                    }
                                }
                            },
                    ) {
                        dragHandle()
                    }
                }
                content()
            }
        }
    }
}

/** Material's own words for the grabber's actions, so TalkBack says what it always said. */
private const val DISMISS_LABEL = "Dismiss bottom sheet"
private const val EXPAND_LABEL = "Expand bottom sheet"
private const val COLLAPSE_LABEL = "Collapse bottom sheet"

/** The ladder's top rung. A sheet is the largest piece of glass there is. */
private val PLATTER_RADIUS: Dp = MMShapes.ladder.last()

/**
 * How far the platter's outline runs on past the foot of the sheet: this
 * share of its height, and a corner more. Twice the widest gap predictive
 * back can open — see [SheetPlatter].
 */
private const val PLATTER_OVERHANG = 0.25f

/**
 * The platter's outline: the top rung's continuous corner across the top, and
 * no corners at the bottom at all.
 *
 * A sheet's bottom edge is the bottom of the screen, so rather than a second
 * shape that knows how to leave two corners square, this is the ordinary
 * squircle drawn taller than the sheet, with its bottom corners — and the
 * bottom run of the rim — out past the edge, where the sheet's own clip
 * takes them away. The overhang is generous on purpose. On a phone with
 * predictive back, dragging back shrinks the sheet towards the bottom of the
 * screen and squeezes what it holds, glass included, up towards its top, to
 * keep the words in proportion — which opens a gap at the foot of up to an
 * eighth of the sheet's height, on the narrowest phone with the tallest
 * sheet, for as long as the finger is down. The overhang is what fills it, so
 * the table never shows through underneath.
 */
private object SheetPlatter : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val radius = with(density) { PLATTER_RADIUS.toPx() }
        val overhang = size.height * PLATTER_OVERHANG + radius
        return Outline.Generic(continuousCornerPath(Size(size.width, size.height + overhang), radius))
    }

    override fun toString(): String = "MMSheet.platter"
}
