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

/// The one global quality switch. Three of its four triggers are the device's:
/// Low Power Mode and a small phone take the material to `flat`, a hot phone
/// to `frost`. The fourth is the frame budget — a table that has started
/// dropping frames steps down one level for five seconds — and it is only
/// watched while a game is on screen, which is where the only glass over a
/// live board is. (The board being busy is not a level at all: it travels
/// down the tree as `mmBoardBusy`, because it is a property of one screen.)
///
/// `RootView` holds this and feeds `level` into `\.mmGlassQuality`.
@MainActor
final class MMGlassGovernor: ObservableObject {
    static let shared = MMGlassGovernor()

    @Published private(set) var level: GlassLevel = .full

    /// What the phone itself asks for, before the frame budget has a say.
    private var device: GlassLevel = .full
    /// Set for five seconds each time the table misses its budget.
    private var strained = false
    private var relief: Task<Void, Never>?
    private var frames: FrameWatch?
    /// Whether a game has asked for the watch; whether it runs also depends on
    /// there being a level left to step down to (see `syncWatch`).
    private var wantsWatch = false

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
            device = .flat
        } else if info.thermalState == .serious || info.thermalState == .critical {
            device = .frost
        } else {
            device = .full
        }
        syncWatch()
        settle()
    }

    /// One level under the device's while the table is strained, never under
    /// `flat`: opaque is an accessibility state, not a saving. Published only
    /// when it actually moves, because every glass surface in the app hears it.
    private func settle() {
        var now = device
        if strained, now > .flat, let down = GlassLevel(rawValue: now.rawValue - 1) {
            now = down
        }
        if now != level { level = now }
    }

    /// Starts or stops watching the frame budget. `GameScreen` turns it on
    /// while a game is being played and off when it goes.
    ///
    /// Never on 26. There the glass over the board is the system's, drawn by
    /// the compositor and paid for there, and `full` and `frost` are the same
    /// native glass — the one step this trigger takes would change nothing on
    /// screen, and the next would swap the system's glass for our twin mid-
    /// game. So the watch would cost a display link and buy nothing.
    func watchFrames(_ on: Bool) {
        wantsWatch = on && !MMSystemGlass.isOn
        syncWatch()
    }

    /// The watch runs only while it can buy something. At `flat` — Low Power
    /// Mode, an old phone — strain has no lower level to reach, and a display
    /// link held at 60 Hz for a whole game would only stop the screen from
    /// dropping its refresh rate while nothing moves.
    private func syncWatch() {
        if wantsWatch && device > .flat {
            guard frames == nil else { return }
            let watch = FrameWatch { MMGlassGovernor.shared.strain() }
            watch.start()
            frames = watch
        } else {
            frames?.stop()
            frames = nil
            relief?.cancel()
            if strained { strained = false; settle() }
        }
    }

    /// The table missed its budget: step down, and come back up five seconds
    /// after the last miss rather than the first, so a scene that stays heavy
    /// stays down instead of bouncing between levels.
    private func strain() {
        strained = true
        settle()
        relief?.cancel()
        relief = Task { @MainActor in
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            MMGlassGovernor.shared.strained = false
            MMGlassGovernor.shared.settle()
        }
    }

    /// iOS has no `isLowRamDevice` to ask, so the line goes where Apple draws
    /// its own: under 3 GB is the old-phone tier, and the lens is the first
    /// thing those phones should stop paying for.
    private static let isSmallMemory =
        ProcessInfo.processInfo.physicalMemory < 3 * 1024 * 1024 * 1024
}

/// The governor's eye on the frame budget: a rolling mean over the last
/// twenty frames.
///
/// The plan states the line as 14 ms of work inside a 16.7 ms frame, and that
/// is not something the app can time — the glass is drawn by the render
/// server, and nothing on the main thread sees how long it took. What the main
/// thread does see is the consequence: a frame whose moment came and went, so
/// that the next callback arrives two frames after the last instead of one.
/// So the mean is of the gaps between callbacks, measured in the display's
/// own frames, and the line is 1.2 — four frames missed in every twenty,
/// which is where a table spending 14 ms of every 16.7 has started spilling
/// over. Capped at 60 Hz: the lens is priced against a 60 Hz phone, and a
/// watch left at a ProMotion display's 120 would hold it there for the length
/// of the game.
@MainActor
private final class FrameWatch: NSObject {
    private let strained: () -> Void
    private var link: CADisplayLink?
    private var last: CFTimeInterval = 0
    private var gaps: [Double] = []

    init(strained: @escaping () -> Void) {
        self.strained = strained
    }

    func start() {
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    /// The link holds its target, so it has to be let go of by hand.
    func stop() {
        link?.invalidate()
        link = nil
        gaps.removeAll()
        last = 0
    }

    @objc private func tick(_ link: CADisplayLink) {
        let now = link.timestamp
        let frame = link.targetTimestamp - link.timestamp
        defer { last = now }
        guard last > 0, frame > 0 else { return }
        // A quarter of a second with no frame at all is not a slow scene. It
        // is the app coming back from the background, or a sheet being put up
        // — so the window starts again rather than counting it.
        guard now - last < 0.25 else {
            gaps.removeAll()
            return
        }
        gaps.append((now - last) / frame)
        if gaps.count > 20 { gaps.removeFirst() }
        guard gaps.count == 20, gaps.reduce(0, +) / 20 > 1.2 else { return }
        gaps.removeAll()
        strained()
    }
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
    /// tumbling, a card being read, the board dealing itself in. The glass
    /// stops refracting for the duration and leans on its shadow, which
    /// deepens: the correct hierarchy, and a free frame on the one screen that
    /// needs it. It freezes what the material refracts and never the material
    /// itself — the film, the rim and the geometry do not move by a pixel, and
    /// nobody sees it happen because they are watching the dice.
    ///
    /// By hand that is a drop to `flat`: the lens, the blur and the live
    /// backdrop layer are everything that re-renders as the board moves, and
    /// over our own backdrops they are the part nobody can see go. On 26 the
    /// refraction is the system's, and the only lever this side of it would
    /// be to swap its glass for our twin for the length of every walk — a
    /// material that changes several times a turn, which is the flicker a
    /// governor exists to prevent. So there the flag deepens the shadow and
    /// leaves the glass alone. `GameScreen` sets it.
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

extension BackdropKind {
    /// The way glass on this backdrop leans, resolved the way the material
    /// resolves its own: off the luminance we declared. Most glass cannot
    /// change backdrops while it is on screen, so the cold-start answer is the
    /// one it keeps — and a label printed on the glass can ask for it without
    /// being inside the modifier that draws it.
    func settledAppearance(_ P: Palette) -> GlassAppearance {
        GlassAppearance.resolve(luminance: luminance(P), previous: nil)
    }

    /// The glass colours a surface on this backdrop settles on. The one
    /// resolver every label, well and placeholder printed on glass goes
    /// through, so the ink on a pane and the pane itself cannot disagree.
    func settledGlass(_ P: Palette) -> GlassTokens {
        Palette.currentTheme.glass(settledAppearance(P))
    }

    /// What a control standing straight on a sheet — not on a card inside it —
    /// is sitting on.
    ///
    /// Below 26 that is the sheet's own paper, and the control travels with
    /// it: `.sheet` for a sheet laid in `P.sheet`, `.page` for one laid in the
    /// page colour. On 26 the platter is the system's glass and not our paper
    /// at all, and a pane that drew our paper inside itself there would be an
    /// opaque sticker on a translucent sheet. So on 26 it declares the page —
    /// what the sheet's glass is itself looking at, and a backdrop a control
    /// does not travel with — which is what hands the control to the system's
    /// own glass, the way 26 draws a button on a sheet.
    static func platter(_ paper: BackdropKind) -> BackdropKind {
        MMSystemGlass.isOn ? .page : paper
    }
}

/// Whether the system is drawing Liquid Glass on this phone. That takes an
/// iOS 26 phone AND an app built against the 26 SDK — an older toolchain runs
/// even a 26 phone in the old design — so it is the same two-part test the
/// material routes by, asked in one place so that nothing that leaves itself
/// to the system can disagree with the material about whether there is one.
enum MMSystemGlass {
    static var isOn: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) { return true }
        #endif
        return false
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
    /// Clamped the way SwiftUI clamps the corner it draws, to half the short
    /// side — a radius past that describes a curve that is not on screen, and
    /// the lens would bend a rim that is not there.
    func mmCornerRadius(in size: CGSize) -> CGFloat {
        min(cornerSize.width, cornerSize.height, min(size.width, size.height) / 2)
    }
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
    ///   - floats: whether it casts a shadow. Everything glass floats except
    ///     a field: a field is a place to write, set into what it sits on,
    ///     and the web draws its fields with the contour and no drop for the
    ///     same reason. A parameter and not an environment value, so a field
    ///     that holds a control does not hand its stillness down to it.
    func mmGlass(_ variant: GlassVariant = .regular,
                 backdrop: BackdropKind = .page,
                 in shape: some InsettableShape = Capsule(),
                 tint: Color? = nil,
                 cornerRadius: CGFloat? = nil,
                 interactive: Bool = false,
                 floats: Bool = true) -> some View {
        modifier(MMGlass(variant: variant, backdrop: backdrop, shape: shape,
                         tint: tint, cornerRadius: cornerRadius, interactive: interactive,
                         floats: floats))
    }
}

struct MMGlass<S: InsettableShape>: ViewModifier {
    let variant: GlassVariant
    let backdrop: BackdropKind
    let shape: S
    let tint: Color?
    let cornerRadius: CGFloat?
    let interactive: Bool
    let floats: Bool

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
        // Busy freezes the hand-built optics and never trades the system's
        // glass for ours — see `mmBoardBusy`.
        if boardBusy && !MMSystemGlass.isOn { return min(quality, .flat) }
        return quality
    }

    /// Relaxed until something moves under the glass. Driven by the content and
    /// never by a timer — a shadow that does not deepen as the board scrolls
    /// beneath the dock says the bar is pasted on rather than floating.
    private var busy: Bool { boardBusy || abs(scrollOffset) > 8 }

    private func shadow(_ a: GlassAppearance) -> GlassShadow {
        // A field sits in its card rather than over it. Zero in every path,
        // opaque included, so turning Reduce Transparency on lifts nothing.
        if !floats { return GlassShadow(y: 0, blur: 0, alpha: 0) }
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

extension Animation {
    /// `mm.morph` — a piece of glass changing shape: the dock growing a row, a
    /// control stretching into what it opens. A spring, because glass that
    /// changes shape should look held together by surface tension rather than
    /// slid; about 380 ms, which lands inside a card's hold and outlasts the
    /// board's settle, so a morph never races the board.
    ///
    /// The plan writes it as "damping .38 / response .78" beside "~380 ms".
    /// Only one reading of those numbers is 380 ms long: a response of 0.38
    /// at a damping of 0.78, which overshoots by about 2%. Taken the other way
    /// round it is a 780 ms spring that overshoots by more than a quarter — a
    /// dock that wobbles every time a phase changes.
    ///
    /// Reduce Motion gets 160 ms, eased, with no spring in it; the rows that
    /// swap inside the shape cross-fade over the same time.
    static func mmMorph(reduceMotion: Bool) -> Animation {
        reduceMotion ? .easeInOut(duration: 0.16) : .spring(response: 0.38, dampingFraction: 0.78)
    }
}

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

// MARK: - Sheet chrome
//
// What every sheet in the app wears around its content. The body of a sheet
// is paper — a deed, a chat log, a bracket — and it stays paper. What turns to
// glass is the chrome: the items in its bar, a footer that floats over the
// page, the composer, a segmented switch, a close button of our own drawing.
//
// iOS 26 builds most of that for nothing. A sheet that no longer paints over
// itself (see `sheetPaper`) is the system's own glass, and so is every item in
// its navigation bar — so on 26 the bar is left entirely alone. That is the
// call the tab bar got, for the same reason: a custom background there does
// not join the system's material, it kills it. Below 26 the bar stays the
// system's bar, with its own scroll edge, and its items become the hand-built
// twin of what 26 draws in it: glass controls, in the capsule 26 cuts them to.
//
// Glass never stacks on glass, so a piece of chrome that is itself glass — the
// pager, the composer — declares `.chrome` for the controls standing on it,
// and they are drawn on that material instead of as panes of their own.

extension View {
    /// Glass for a piece of chrome standing on a sheet — a footer, the
    /// composer, a switch. Regular and never Clear: every one of them carries
    /// words or a glyph somebody has to read.
    ///
    /// Below 26 what is behind it is our own paper, and the pane draws a copy
    /// of that paper inside itself, so a blur or a lens has nothing to work on
    /// — a flat colour blurred, or bent, is the same flat colour. It runs at
    /// `flat` there: film, rim, glow and shadow. That is not a saving passed
    /// off as a look; it is the exact picture. On 26 it is the system's glass.
    /// `floats` is false for a composer, which is a field.
    func sheetGlass(on paper: BackdropKind, in shape: some InsettableShape,
                    floats: Bool = true) -> some View {
        modifier(SheetGlass(paper: paper, shape: shape, floats: floats))
    }

    /// An item in a sheet's navigation bar — Done, Close, a menu. On 26 the
    /// system already draws it in glass and this does nothing at all. Below
    /// 26 it becomes the glass ghost every other secondary button in the app
    /// is, on the sheet's own paper, so the bar reads as the same material on
    /// both. `enabled` is for a disabled item: a custom style has no greyed
    /// state of its own, and a bar item that looks live and does nothing is
    /// worse than the plain one it replaced.
    func sheetBarItem(on paper: BackdropKind, enabled: Bool = true) -> some View {
        modifier(SheetBarItem(paper: paper, enabled: enabled))
    }

    /// Something the bar tells you rather than something you press — the coin
    /// count over the board shelf. The same glass as the items beside it, and
    /// the same hands-off on 26.
    func sheetBarChip(on paper: BackdropKind) -> some View {
        modifier(SheetBarChip(paper: paper))
    }

    /// Lines leaving the top of a scroll view fade out instead of slicing off
    /// at a hard edge — the scroll edge, drawn by hand where there is no bar
    /// to draw it. The band is exactly as deep as the content's own top
    /// padding, so at rest it lies over empty space and touches nothing; only
    /// a line on its way out ever passes through it. A mask reads alpha alone,
    /// so the two colours below are opacities, not paint.
    func sheetScrollEdge(top: CGFloat) -> some View {
        mask {
            VStack(spacing: 0) {
                LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
                    .frame(height: top)
                Rectangle()
            }
            // A scroll view that meets a safe-area edge draws its content on
            // past it — under the home indicator, under a bar — and a mask cut
            // to its layout frame would clip that off. So the mask reaches as
            // far as the content does, and only the band is ever see-through.
            .ignoresSafeArea()
        }
    }
}

private struct SheetGlass<S: InsettableShape>: ViewModifier {
    let paper: BackdropKind
    let shape: S
    let floats: Bool

    @Environment(\.mmGlassQuality) private var quality

    func body(content: Content) -> some View {
        // No tint: a tint belongs to the whole pane, and on 26 it turns a bar
        // into a slab of the colour with everything on it lost inside.
        content
            .mmGlass(.regular, backdrop: paper, in: shape, floats: floats)
            // Environment flows inward, so this reaches the `mmGlass` above
            // and nothing outside it.
            .environment(\.mmGlassQuality, level)
    }

    private var level: GlassLevel {
        MMSystemGlass.isOn ? quality : min(quality, .flat)
    }
}

private struct SheetBarItem: ViewModifier {
    let paper: BackdropKind
    let enabled: Bool

    @ViewBuilder func body(content: Content) -> some View {
        if MMSystemGlass.isOn {
            content
        } else {
            content
                // A capsule, the shape 26 cuts a bar item to, so the two bars
                // hold up side by side.
                .buttonStyle(MMButtonStyle(kind: .ghost, form: .pill))
                // A menu in the bar is pressed like a button, so it wears the
                // button: the button menu style hands its label to the style
                // above instead of drawing a bare glyph.
                .menuStyle(.button)
                .mmControls(on: paper)
                .opacity(enabled ? 1 : 0.45)
        }
    }
}

private struct SheetBarChip: ViewModifier {
    let paper: BackdropKind

    @ViewBuilder func body(content: Content) -> some View {
        if MMSystemGlass.isOn {
            content
        } else {
            content
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .sheetGlass(on: paper, in: Capsule())
        }
    }
}
