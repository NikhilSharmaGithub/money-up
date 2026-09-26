// The material. One call — `mmGlass` — is how a surface becomes Liquid Glass,
// and it is the only thing in the app allowed to make one.
//
// Glass goes on navigation and on controls. It never goes on content: the forty
// tiles, a deed, the chat log, the leaderboard are the things the glass
// refracts, and a glass board is a misreading of what the material is for.
//
// Deployment target is 17.0 and the app is live, so this file carries two
// implementations of one surface. On iOS 26 the system's own API does the
// lensing, the adaptive tint, the rim and the morph. Below that we build the
// twin by hand, and the two have to be indistinguishable held side by side.
//
// The wall, stated plainly: no API on iOS 17 lets a shader read the pixels
// BEHIND a view. `.layerEffect` samples the view's own rasterised contents;
// `Material` blurs the real backdrop but is opaque to shaders; a private
// `CAFilter` on a live app is an App Store risk and is off the table. But
// MoneyMove draws its own backdrops. So the material does not fake a lens with
// a blur — it draws a private replica of the backdrop we know is there, inside
// the glass shape, and runs a real displacement on that. It is the view's own
// layer, so `.layerEffect` may sample it, and the refraction is genuine rather
// than painted. Where the backdrop is something we did not draw — a rewarded
// video, an ad creative, a player's photo — there is no replica to be made, and
// a half-built lens over live video looks broken where a clean frost does not.

import SwiftUI
import UIKit

// MARK: - The declared backdrop

/// What we put behind a piece of glass. There is no pixel reading anywhere in
/// this file: we own every pixel under every bar, so the backdrop is *declared*
/// and its luminance comes off the palette. That is what lets the same adaptive
/// flip run identically on iOS 17, on Android 24 and in a browser with no
/// `backdrop-filter` — and it costs nothing per frame.
enum BackdropKind {
    /// The app gradient. A linear ramp, and a Gaussian convolved with a linear
    /// ramp returns the same ramp, so here the replica is not an approximation.
    case page
    /// Scrolling content cards — `MMCard` over the page.
    case paper
    /// The live board.
    case felt
    /// A sheet platter.
    case sheet
    /// Ads, rewarded video, avatar photos. Pixels we did not choose.
    case media
    /// Over another bar. Rare, and a warning: glass never stacks on glass.
    case chrome

    /// WCAG relative luminance of the colour we *placed* behind this rect.
    func luminance(_ p: Palette) -> Double {
        switch self {
        case .page:
            // The ramp runs corner to corner, so a bar sees some slice of it.
            // The mean of the two ends is the honest expectation, and it is
            // safe to take a mean because no table's page family comes near the
            // crossover: the darkest light page measures 0.806 and the
            // brightest dark page 0.0069, either side of 0.07 by two orders.
            return (MMHex.luminance(p.hex.page) + MMHex.luminance(p.hex.page2)) / 2
        case .paper:  return MMHex.luminance(p.hex.card)
        case .felt:   return MMHex.luminance(p.hex.boardBG)
        case .sheet:  return MMHex.luminance(p.hex.sheet)
        case .media:
            // Unpredictable by definition, but not unbounded: glass over media
            // is Regular with a 35% dim under it, and a dimmed frame measured
            // 10.5–11.4:1 in the light appearance. This is the luminance of a
            // white frame behind that dim — the value the sweep actually
            // cleared. Pinning it dark is the case that failed, at 2.85:1.
            return 0.385
        case .chrome:
            // What is under a second bar is the first bar, and a bar's own
            // colour is the film composited over the page.
            return MMHex.luminance(p.hex.page)
        }
    }

    /// Whether the real, unpredicted pixels need recovering with a `Material`
    /// over the replica. Over the page the replica *is* the backdrop and there
    /// is nothing to recover; everywhere else something we did not draw can
    /// pass underneath.
    var needsLiveBackdrop: Bool {
        if case .page = self { return false }
        return true
    }
}

// MARK: - Quality

/// The one global quality switch. Geometry, rim, radii, ink and layout are
/// identical at every level — only the optics change — so a step down never
/// reflows anything and the crossfade between levels is invisible.
enum GlassLevel: Int, Comparable {
    /// `glassSolid`, no blur, no lens. Reduce Transparency lands here.
    case opaque = 0
    /// Film and rim, no blur and no lens. Low Power Mode, small phones.
    case flat
    /// Film, blur and rim, no lens. A hot phone, or too many lenses at once.
    case frost
    /// Everything.
    case full

    static func < (a: GlassLevel, b: GlassLevel) -> Bool { a.rawValue < b.rawValue }
}

/// Resolves the levels the *device* asks for. Low Power Mode and a hot phone
/// are deterministic and cheap to observe, so they live here and can be tested
/// today. The remaining trigger in the plan — a rolling mean of frame times
/// that steps the app down when a scene misses its budget — deliberately is
/// not here: it cannot be tuned against a screen with no glass on it yet, and
/// it belongs with the first chunk that puts a lens over the board.
///
/// Nothing starts this. The chunk that places the first glass surface holds it
/// at the root and feeds `level` into `\.mmGlassQuality`.
@MainActor
final class MMGlassGovernor: ObservableObject {
    static let shared = MMGlassGovernor()

    @Published private(set) var level: GlassLevel = .full

    private init() {
        let centre = NotificationCenter.default
        for name in [Notification.Name.NSProcessInfoPowerStateDidChange,
                     ProcessInfo.thermalStateDidChangeNotification] {
            centre.addObserver(forName: name, object: nil, queue: .main) { _ in
                Task { @MainActor in MMGlassGovernor.shared.recompute() }
            }
        }
        recompute()
    }

    func recompute() {
        let info = ProcessInfo.processInfo
        if info.isLowPowerModeEnabled || MMGlassGovernor.isSmallMemory {
            level = .flat
        } else if info.thermalState == .serious || info.thermalState == .critical {
            level = .frost
        } else {
            level = .full
        }
    }

    /// iOS has no `isLowRamDevice` to ask, so the line goes where Apple draws
    /// its own: under 3 GB is the old-phone tier, and the lens is the first
    /// thing those phones should stop paying for.
    private static let isSmallMemory =
        ProcessInfo.processInfo.physicalMemory < 3 * 1024 * 1024 * 1024
}

// MARK: - Environment

private struct GlassQualityKey: EnvironmentKey { static let defaultValue: GlassLevel = .full }
private struct GlassScrollOffsetKey: EnvironmentKey { static let defaultValue: CGFloat = 0 }
private struct GlassBoardBusyKey: EnvironmentKey { static let defaultValue = false }
private struct GlassPressedKey: EnvironmentKey { static let defaultValue = false }
private struct GlassContentUnderKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// What the governor has settled on. A surface may resolve lower than this
    /// — never higher.
    var mmGlassQuality: GlassLevel {
        get { self[GlassQualityKey.self] } set { self[GlassQualityKey.self] = newValue }
    }

    /// How far the content under this glass has scrolled. It swings the
    /// specular highlight ±22° and deepens the shadow. There is no gyroscope
    /// behind any of it: nobody can tell "the light moved because I scrolled"
    /// from "because I tilted", and this is a game people sit with for forty
    /// minutes — a 20 Hz sensor poll for an effect nobody can name is a bad
    /// trade.
    var mmScrollOffset: CGFloat {
        get { self[GlassScrollOffsetKey.self] } set { self[GlassScrollOffsetKey.self] = newValue }
    }

    /// Set while the board is mid-performance — a token walking, the dice
    /// tumbling, a card being read. Every glass surface drops to `flat` for the
    /// duration, which is the correct hierarchy and a free frame, and nobody
    /// sees it happen because they are watching the dice.
    var mmBoardBusy: Bool {
        get { self[GlassBoardBusyKey.self] } set { self[GlassBoardBusyKey.self] = newValue }
    }

    /// Published by whichever button style owns the gesture, so an interactive
    /// surface can answer a press without this file stealing the touch.
    var mmGlassPressed: Bool {
        get { self[GlassPressedKey.self] } set { self[GlassPressedKey.self] = newValue }
    }

    /// Forces the live-backdrop layer on over the page family, for a bar that
    /// really does have cards sliding underneath. Everywhere else it is already
    /// on and this changes nothing.
    var mmContentUnderneath: Bool {
        get { self[GlassContentUnderKey.self] } set { self[GlassContentUnderKey.self] = newValue }
    }
}

// MARK: - The adaptive flip

extension GlassAppearance {
    /// Dark below 0.062, light above 0.078, 0.070 from cold. The hysteresis is
    /// what keeps a bar from strobing when a backdrop sits on the line.
    ///
    /// The threshold is the most load-bearing number in the material, and it is
    /// not the intuitive one. Reasoned from mid-grey it comes out at 0.42; but
    /// at film alpha 0.62 the light film dominates the composite, so light
    /// glass beats dark glass everywhere above L ≈ 0.068. Swept over 1,225
    /// backdrops, 0.42 floors at 4.38:1 and fails AA outright, where 0.07
    /// floors at 8.00:1 and clears AAA.
    static func resolve(luminance L: Double, previous: GlassAppearance?) -> GlassAppearance {
        switch previous {
        case .dark:  return L < 0.078 ? .dark : .light
        case .light: return L < 0.062 ? .dark : .light
        case nil:    return L < 0.070 ? .dark : .light
        }
    }
}

// MARK: - Shapes the lens can measure

/// The lens shader needs a corner radius for its distance field, and an
/// arbitrary `InsettableShape` cannot be asked for one. The four shapes the app
/// puts glass in answer for themselves; anything else is taken for a capsule,
/// which is what a caller reaching for something exotic most likely meant.
protocol MMGlassRadius {
    func mmCornerRadius(in size: CGSize) -> CGFloat
}

extension Capsule: MMGlassRadius {
    func mmCornerRadius(in size: CGSize) -> CGFloat { min(size.width, size.height) / 2 }
}

extension Circle: MMGlassRadius {
    func mmCornerRadius(in size: CGSize) -> CGFloat { min(size.width, size.height) / 2 }
}

extension Rectangle: MMGlassRadius {
    func mmCornerRadius(in size: CGSize) -> CGFloat { 0 }
}

extension RoundedRectangle: MMGlassRadius {
    func mmCornerRadius(in size: CGSize) -> CGFloat { min(cornerSize.width, cornerSize.height) }
}

// MARK: - The entry point

extension View {
    /// Puts glass on this surface. Every glass surface in the app comes through
    /// this one call, so there is one place to read and one place to fix.
    ///
    /// - Parameters:
    ///   - variant: `.regular` is the material. `.clear` is the thin one, and
    ///     it quietly becomes Regular over `.media`, where it does not adapt
    ///     and measures 2.85:1. `.opaque` is for a surface that must be solid
    ///     whatever the phone's settings say.
    ///   - backdrop: what we placed behind this rect. Declared, never sampled.
    ///   - shape: the silhouette. Radii come off `MMRadius`, and a child's off
    ///     `MMRadius.inner(_:inset:)`, so concentricity is arithmetic rather
    ///     than something to remember.
    ///   - tint: one semantic tint at most, per surface. Tint everything and
    ///     nothing is primary.
    ///   - cornerRadius: only for a shape the lens cannot measure itself.
    ///   - interactive: the rim answers a press — for a surface that is a
    ///     control rather than a container.
    func mmGlass(_ variant: GlassVariant = .regular,
                 backdrop: BackdropKind = .page,
                 in shape: some InsettableShape = Capsule(),
                 tint: Color? = nil,
                 cornerRadius: CGFloat? = nil,
                 interactive: Bool = false) -> some View {
        modifier(MMGlass(variant: variant, backdrop: backdrop, shape: shape,
                         tint: tint, cornerRadius: cornerRadius, interactive: interactive))
    }
}

struct MMGlass<S: InsettableShape>: ViewModifier {
    let variant: GlassVariant
    let backdrop: BackdropKind
    let shape: S
    let tint: Color?
    let cornerRadius: CGFloat?
    let interactive: Bool

    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.mmGlassQuality) private var quality
    @Environment(\.mmBoardBusy) private var boardBusy
    @Environment(\.mmScrollOffset) private var scrollOffset
    @Environment(\.mmGlassPressed) private var pressed
    @Environment(\.mmContentUnderneath) private var contentUnderneath

    /// This rect in window space. The size drives the shadow and the lens; the
    /// origin is what lets the page replica line its gradient up with the real
    /// one, instead of squeezing a whole screen's ramp into a 44 pt bar.
    @State private var frame: CGRect = .zero

    /// This surface's own settled appearance, kept so the crossover can have
    /// hysteresis. Per surface, because that is what adaptive means here: two
    /// bars on one screen may sit over different things and disagree.
    @State private var settled: GlassAppearance?

    func body(content: Content) -> some View {
        let appearance = settled ?? GlassAppearance.resolve(luminance: luminance, previous: nil)
        let level = resolvedLevel
        return assembled(content.background { measurer },
                         level: level, appearance: appearance)
            // 280 ms, and it stays 280 ms under Reduce Motion, because a tint
            // that flips is telling the reader what is underneath it.
            .animation(.easeInOut(duration: 0.28), value: settled)
            // The shadow changes state under Reduce Motion too, for the same
            // reason: it is information, not decoration. Only slower.
            .animation(.linear(duration: reduceMotion ? 0.3 : 0.2), value: busy)
            // The governor is allowed to step the optics down mid-scroll, and
            // it has to be able to do that without anyone noticing the moment
            // it happened.
            .animation(.easeInOut(duration: reduceMotion ? 0 : 0.24), value: level)
            .onAppear { settled = GlassAppearance.resolve(luminance: luminance, previous: nil) }
            .onChange(of: luminance) { _, now in
                settled = GlassAppearance.resolve(luminance: now, previous: settled)
            }
    }

    // MARK: the three paths

    @ViewBuilder
    private func assembled(_ body: some View,
                           level: GlassLevel,
                           appearance: GlassAppearance) -> some View {
        if level == .opaque {
            opaque(body, appearance)
        } else if level >= .frost {
            modern(body, level: level, appearance: appearance)
        } else {
            handBuilt(body, level: level, appearance: appearance)
        }
    }

    /// Reduce Transparency: fully opaque, and opaque means the colour the glass
    /// actually composites to — not 0.62 nudged up to 0.80. Identical geometry,
    /// radius, shadow and layout, so nothing on screen shifts by a pixel when
    /// the setting is turned on. The rim survives at 0.30 because on an opaque
    /// surface it has become a legitimate border.
    private func opaque(_ body: some View, _ appearance: GlassAppearance) -> some View {
        let t = tokens(appearance)
        let sh = shadow(appearance)
        return body.background {
            ZStack {
                shape.fill(t.solid)
                shape.strokeBorder(t.rimWarm.opacity(0.30), lineWidth: 1)
            }
            .compositingGroup()
            .shadow(color: sh.color, radius: sh.radius, y: sh.y)
        }
    }

    // `Glass` and `glassEffect` are iOS 26 SDK names. `#available` guards the
    // run, not the compile, so on an older toolchain the whole branch has to
    // disappear — Xcode 26 is the first Swift 6.2.
    #if compiler(>=6.2)
    @ViewBuilder
    private func modern(_ body: some View, level: GlassLevel,
                        appearance: GlassAppearance) -> some View {
        if #available(iOS 26.0, *) {
            let sh = shadow(appearance)
            // The system does the lensing, the tint, the rim, the morph and the
            // scroll edge. The only thing added is the shadow, because ours has
            // two states and has to move between them.
            body.glassEffect(nativeGlass, in: shape)
                .shadow(color: sh.color, radius: sh.radius, y: sh.y)
        } else {
            handBuilt(body, level: level, appearance: appearance)
        }
    }

    @available(iOS 26.0, *)
    private var nativeGlass: Glass {
        var g: Glass = (variant == .clear && backdrop != .media) ? .clear : .regular
        if let tint { g = g.tint(tint) }
        if interactive { g = g.interactive() }
        return g
    }
    #else
    private func modern(_ body: some View, level: GlassLevel,
                        appearance: GlassAppearance) -> some View {
        handBuilt(body, level: level, appearance: appearance)
    }
    #endif

    /// iOS 17–25, and 26 at a reduced quality level. The shadow goes on the
    /// pane and never on `content`: the pane is translucent, so a shadow over
    /// the pair would find the labels and drop-shadow every one of them.
    private func handBuilt(_ body: some View, level: GlassLevel,
                           appearance: GlassAppearance) -> some View {
        let sh = shadow(appearance)
        return body.background {
            MMGlassPane(backdrop: backdrop, shape: shape, tint: tint, level: level,
                        appearance: appearance, palette: palette,
                        tokens: tokens(appearance), scalars: scalars(appearance),
                        frame: frame, radius: lensRadius, theta: theta,
                        increaseContrast: increaseContrast, liveBackdrop: liveBackdrop)
                .compositingGroup()
                .shadow(color: sh.color, radius: sh.radius, y: sh.y)
        }
    }

    // MARK: resolved state

    private var palette: Palette { Palette.current(scheme) }

    private func tokens(_ a: GlassAppearance) -> GlassTokens { Palette.currentTheme.glass(a) }

    private func scalars(_ a: GlassAppearance) -> GlassScalars {
        GlassScalars.of(variant, a,
                        increaseContrast: increaseContrast,
                        overLiveBoard: backdrop == .felt)
    }

    /// Increase Contrast is *not* the opaque level, whatever the summary table
    /// reads like. It has its own alphas, a heavier rim and a hairline at 0.30,
    /// and it keeps the lens on, because displacement helps the silhouette. It
    /// was measured separately too — 8.10:1 against the opaque path's 11.16:1 —
    /// so the two are plainly meant to be two different states.
    private var increaseContrast: Bool { contrast == .increased }

    private var luminance: Double { backdrop.luminance(palette) }

    private var resolvedLevel: GlassLevel {
        if variant == .opaque || reduceTransparency { return .opaque }
        if boardBusy { return min(quality, .flat) }
        return quality
    }

    /// Relaxed until something moves under the glass. Driven by the content and
    /// never by a timer — a shadow that does not deepen as the board scrolls
    /// beneath the dock says the bar is pasted on rather than floating.
    private var busy: Bool { boardBusy || abs(scrollOffset) > 8 }

    private func shadow(_ a: GlassAppearance) -> GlassShadow {
        let h = max(frame.height, 1)
        return busy ? .busy(height: h, a) : .relaxed(height: h, a)
    }

    /// The light direction. It tracks scroll, and swings a further 40° while a
    /// control is held down — which is the whole of the press response the
    /// material owns. The touch-point bloom needs the touch location, and that
    /// belongs to the button style that already has the gesture.
    private var theta: Angle {
        let scrolled = max(-22, min(22, scrollOffset / 6))
        return .degrees(135 + scrolled + (interactive && pressed ? 40 : 0))
    }

    private var lensRadius: CGFloat {
        if let cornerRadius { return cornerRadius }
        if let measurable = shape as? MMGlassRadius {
            return measurable.mmCornerRadius(in: frame.size)
        }
        return min(frame.width, frame.height) / 2
    }

    private var liveBackdrop: Bool { backdrop.needsLiveBackdrop || contentUnderneath }

    private var measurer: some View {
        GeometryReader { g in
            Color.clear
                .onAppear { frame = g.frame(in: .global) }
                .onChange(of: g.frame(in: .global)) { _, now in frame = now }
        }
    }
}

// MARK: - The hand-built pane

private struct MMGlassPane<S: InsettableShape>: View {
    let backdrop: BackdropKind
    let shape: S
    let tint: Color?
    let level: GlassLevel
    let appearance: GlassAppearance
    let palette: Palette
    let tokens: GlassTokens
    let scalars: GlassScalars
    let frame: CGRect
    let radius: CGFloat
    let theta: Angle
    let increaseContrast: Bool
    let liveBackdrop: Bool

    var body: some View {
        ZStack {
            refracted
            film
            rim
        }
        // One per assembly. Never one per chip: a compositing group around each
        // little disc on the game's top bar is six offscreen passes, where the
        // container was supposed to make it one.
        .compositingGroup()
    }

    /// Layers one and two — what the glass is looking at. Saturation and
    /// brightness belong here and nowhere else. They are properties of looking
    /// *through* the material, and running them over the rim as well would turn
    /// a specular line into a glow, which is a different thing entirely.
    private var refracted: some View {
        ZStack {
            if backdrop != .media {
                BackdropReplica(kind: backdrop, palette: palette, tokens: tokens, frame: frame)
                    .layerEffect(
                        ShaderLibrary.mmLens(.float2(band, peak),
                                             .float2(frame.size),
                                             .float(radius)),
                        maxSampleOffset: CGSize(width: 20, height: 20),
                        isEnabled: lensing
                    )
                    // A third of the stated blur, because the replica is our own
                    // clean drawing and not a photograph of the screen: the full
                    // 20 turns a gradient into featureless mush, which is its
                    // own way of looking cheap.
                    .blur(radius: level == .flat ? 0 : scalars.blur * 0.3)
                    .clipShape(shape)
            }
            if level != .flat && liveBackdrop {
                // Everything we did not predict — a card halfway under the bar,
                // a token mid-walk — recovered the one way iOS 17 offers.
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .opacity(backdrop == .media ? 1 : 0.55)
                    .clipShape(shape)
            }
            if backdrop == .media {
                // Regular plus a 35% dim is what keeps a close button legible on
                // a white video frame. It is also why Clear is banned here.
                shape.fill(.black).opacity(0.35)
            }
        }
        .saturation(scalars.saturation)
        .brightness(scalars.brightnessShift)
    }

    /// Layer three — the adaptive tint, chosen from the backdrop's known
    /// luminance rather than from anything read back off the screen.
    @ViewBuilder private var film: some View {
        shape.fill(tokens.film).opacity(scalars.alpha)
        if let tint {
            shape.fill(tint).opacity(increaseContrast ? 0.26 : 0.14)
        }
    }

    /// Layer four — the specular rim, and the three things under it that are
    /// the difference between a rim and a sticker outline.
    @ViewBuilder private var rim: some View {
        // Additive, because brighter-than-white is what makes a highlight read
        // as light falling on a surface rather than as a drawn border.
        shape.strokeBorder(rimGradient, lineWidth: rimWidth)
            .blendMode(.plusLighter)
        // The inner stroke is what reads as THICKNESS. Leaving it out is the
        // commonest way a hand-built glass comes out flat.
        shape.inset(by: 1).strokeBorder(rimGradient.opacity(0.35), lineWidth: 1)
            .blendMode(.plusLighter)
        // For the angles where film and backdrop land on the same colour and
        // the edge would otherwise disappear altogether.
        shape.strokeBorder(hairline, lineWidth: increaseContrast ? 1 : 0.5)
        innerGlow
    }

    private var rimWidth: CGFloat {
        if increaseContrast { return 1.5 }
        return appearance == .dark ? 1.25 : 1.0
    }

    /// Hue 39° on all fourteen tables. The brass is the light in the room and
    /// not a property of the surface, so it does not adapt when the tint does —
    /// which is exactly why this app's glass looks like this app's glass.
    ///
    /// On the night tables brass takes the hot corner. In daylight a literal
    /// gold line is mush — measured 3.22–4.36 against 5.73–8.40 — so white
    /// takes the hot corner there and the brass moves to the far-edge bounce
    /// and to the inner glow.
    private var rimGradient: AngularGradient {
        let dark = appearance == .dark
        let hot: Color = dark ? tokens.rimWarm : .white
        let far = tokens.rimWarm
        return AngularGradient(stops: [
            .init(color: hot.opacity(0.85), location: 0.00),
            .init(color: hot.opacity(0.10), location: 0.25),
            .init(color: far.opacity(dark ? 0.53 : 0.30), location: 0.50),
            .init(color: hot.opacity(0.10), location: 0.75),
            .init(color: hot.opacity(0.85), location: 1.00),
        ], center: .center, angle: theta)
    }

    private var hairline: Color {
        let a: Double = increaseContrast ? 0.30 : (appearance == .dark ? 0.08 : 0.10)
        return appearance == .dark ? Color.white.opacity(a) : Color.black.opacity(a)
    }

    /// Four points of top-weighted glow. It is what makes the surface read as
    /// convex instead of as a flat pane of colour, and on a light table it is
    /// where the brass goes.
    private var innerGlow: some View {
        let stop = min(4 / max(frame.height, 1), 0.5)
        let dark = appearance == .dark
        let tone: Color = dark ? .white : tokens.rimWarm
        return shape.fill(LinearGradient(
            stops: [.init(color: tone.opacity(dark ? 0.10 : 0.12), location: 0),
                    .init(color: .clear, location: stop)],
            startPoint: .top, endPoint: .bottom))
            .blur(radius: 4)
            .clipShape(shape)
            .blendMode(.plusLighter)
    }

    // MARK: lens geometry

    /// Displacement is zero outside this band, and the shader returns early
    /// inside it — the lens is a perimeter cost and not an area one, which is
    /// the whole reason it fits in the frame budget.
    private var band: CGFloat { min(max(0.50 * radius, 8), 20) }

    /// Thicker glass bends more. A dock comes out at 6.6 pt, the game's top bar
    /// at 4.2 and a sheet platter at 8.2.
    private var peak: CGFloat {
        let base = min(max(0.55 * band, 4), 14)
        let thickness = min(max(min(frame.width, frame.height) / 88, 0.70), 1.35)
        return base * thickness
    }

    /// Below 20×44 the displacement is invisible and costs exactly the same per
    /// pixel, so it is skipped outright.
    private var lensing: Bool {
        level == .full && frame.width >= 20 && frame.height >= 44
    }
}

// MARK: - The replica

/// Our own backdrop, drawn again inside the glass shape so the lens has
/// something real to bend. This is the whole trick that makes a genuine
/// refraction possible nine major versions below the API for it.
private struct BackdropReplica: View {
    let kind: BackdropKind
    let palette: Palette
    let tokens: GlassTokens
    let frame: CGRect

    var body: some View {
        switch kind {
        case .page:
            // The page gradient runs corner to corner across the whole window,
            // so a copy stretched into a 44 pt bar would be a completely
            // different ramp. Draw it at window size and slide this rect's own
            // window of it into place; what the lens then bends is the ramp
            // that is genuinely there, to the pixel.
            ZStack(alignment: .topLeading) {
                Color.clear
                LinearGradient(colors: [palette.page, palette.page2],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                    .frame(width: window.width, height: window.height)
                    .offset(x: -frame.minX, y: -frame.minY)
            }
            .clipped()
        case .paper:  palette.card
        case .felt:   palette.boardBG
        case .sheet:  palette.sheet
        case .chrome: tokens.solid
        case .media:  Color.clear
        }
    }

    /// Taken from the window rather than the screen, for the same reason the
    /// player strip takes its width from there: a Split View iPad is not the
    /// size of its display.
    private var window: CGSize {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        return scene?.keyWindow?.bounds.size ?? UIScreen.main.bounds.size
    }
}

// MARK: - Morph

/// Glass cannot sample glass, and on iOS 26 the container is also what lets two
/// surfaces morph into one another rather than cross-fade. More than one glass
/// element on a screen belongs inside one of these.
///
/// It cannot be called `GlassEffectContainer`: that is the iOS 26 SDK's own
/// type, and the name will not compile at a 17.0 target.
struct MMGlassContainer<Content: View>: View {
    /// Game top bar 10, ActionPanel dock 12, PlayerStrip 8, sheet chrome 6.
    var spacing: CGFloat = 10
    @ViewBuilder var content: () -> Content

    var body: some View {
        #if compiler(>=6.2)
        modern
        #else
        ZStack { content() }
        #endif
    }

    #if compiler(>=6.2)
    @ViewBuilder private var modern: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content() }
        } else {
            // Below 26 the hand-built pieces morph with `matchedGeometryEffect`,
            // so the container has nothing to do but hold them.
            ZStack { content() }
        }
    }
    #endif
}
