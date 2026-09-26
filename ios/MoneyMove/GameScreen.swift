// The in-room screen: player strip on top, the board in the middle with a
// live centre well, and a context panel underneath that changes with the
// phase — lobby controls, turn actions, debt rescue, trade offers.
//
// The table is where the glass earns its keep and where it can cost the most,
// so the rule here is the whole rule: glass is the navigation layer and
// nothing else. The top bar, the rail the seats stand on, the dock, the chips
// that float over the felt and the iPad's corner pods are glass. The board,
// its forty tiles, the dice, the deeds and the log are content — the things
// the glass refracts — and stay paper.
//
// Glass never stacks. Whatever stands on one of these surfaces — a key on the
// bar, a seat on the rail, a button in the dock — is drawn on that surface's
// material, a well or a wash of its colour, and never as a pane of its own.
//
// Two of the surfaces bend light: the top bar and the dock. The frame budget on
// the oldest phone we support pays for three, and a lens on everything else
// would spend it on chips too small to show one; the rest stop at `frost`.
//
// And while the board performs — dice thrown, a piece walking, a card being
// read, the board dealing itself in — the glass stops refracting and leans on
// its shadow (see `mmBoardBusy`), which is how a live game keeps its frames.

import SwiftUI

enum ActiveSheet: Identifiable {
    case deed(Int)
    case properties
    case trade(from: String, to: String, give: Set<Int>, want: Set<Int>)  // proposing seat → target
    case tradePicker(from: String, give: Set<Int>)        // choose who to trade with first
    case counter(TradeOffer)                              // negotiate an incoming offer
    case tradeOffer(TradeOffer, seat: String)             // an offer, put in front of you
    case chatLog(Int)       // initial tab: 0 chat, 1 log
    case settings
    case gameOver

    var id: String {
        switch self {
        case .deed(let i): "deed-\(i)"
        case .properties: "properties"
        case .trade(let f, let t, _, _): "trade-\(f)-\(t)"
        case .tradePicker(let f, _): "tradepicker-\(f)"
        case .counter(let t): "counter-\(t.id)"
        case .tradeOffer(let t, _): "offer-\(t.id)"
        case .chatLog(let t): "chatlog-\(t)"
        case .settings: "settings"
        case .gameOver: "gameover"
        }
    }
}

struct GameScreen: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var sheet: ActiveSheet?
    @State private var confirmLeave = false
    @State private var confirmConcede = false
    /// Every offer is put in front of its reader exactly once. Answering it,
    /// or closing the sheet, retires the id — a state push a second later must
    /// not throw the same deal back up, and neither must a reconnect.
    @State private var offersShown: Set<Int> = []
    /// Which of the table's controls each sheet was opened from, by the
    /// sheet's id, so that on 26 a sheet can grow out of its control and close
    /// back into it. No entry for a sheet that arrived on its own or from
    /// somewhere with nothing to grow out of. See `open(_:from:)`.
    ///
    /// Kept per sheet rather than as one value for whichever is up, because
    /// one sheet hands over to the next — the trade picker to the trade it
    /// picked — and the outgoing sheet is still on screen while it goes. One
    /// value rewritten for the newcomer would take the zoom off the sheet
    /// already leaving, and taking it off swaps that sheet's whole view for
    /// another mid-dismissal.
    @State private var morphFrom: [String: String] = [:]
    @Namespace private var morphSpace
    /// The board is dealing itself in, or the dice are tumbling. These are the
    /// two performances the store holds no curtain for — a prison roll that
    /// misses its double throws dice and walks nobody — so the screen keeps
    /// their time itself.
    @State private var dealing = false
    @State private var tumbling = false

    /// Every sheet the table opens goes through here, saying which control
    /// opened it — or nobody, for an offer that arrives by itself, a result,
    /// a deed tapped on the board.
    private func open(_ which: ActiveSheet, from source: String? = nil) {
        // Nil clears the entry, so a sheet opened this time from nowhere does
        // not zoom out of a control it grew from the last time.
        morphFrom[which.id] = source
        sheet = which
    }

    /// The board is mid-performance: the dice have been thrown and a piece is
    /// on its way — the store's curtain, which also covers a card being read
    /// before it is obeyed — or the dice are still landing, or the board is
    /// dealing itself in. For the length of it the glass stops refracting and
    /// leans on its shadow.
    private var boardBusy: Bool { store.holdUntil != nil || tumbling || dealing }

    /// An offer lands while you are looking at the board, and the person who
    /// sent it is waiting on an answer — so it comes to the front once, on its
    /// own. One at a time, oldest first: a sheet already open (a deed, the
    /// composer, the result) is not something an offer gets to interrupt.
    private func presentNewOffer() {
        guard store.state?.isPlaying == true, sheet == nil else { return }
        let live = Set((store.state?.trades ?? []).map(\.id))
        offersShown = offersShown.intersection(live)
        guard let next = (store.state?.trades ?? [])
            .filter({ store.isLocal($0.to) && $0.ignored != true && !offersShown.contains($0.id) })
            .min(by: { $0.id < $1.id }) else { return }
        offersShown.insert(next.id)
        SoundKit.shared.trade()
        open(.tradeOffer(next, seat: next.to))
    }

    /// Seats on this device still in the game. More than one means "give up"
    /// is ambiguous — a pass & play phone has to say WHICH player is done."""
    private var aliveLocalSeats: [PlayerState] {
        (store.state?.players ?? []).filter { store.isLocal($0.id) && !$0.isBankrupt }
    }

    var body: some View {
        let P = Palette.current(scheme)
        VStack(spacing: 10) {
            topBar(P)

            if store.state != nil {
                if hSize == .regular, store.state?.isLobby == true {
                    // iPad lobby: the board previews left, setup lives right.
                    HStack(alignment: .top, spacing: 14) {
                        VStack(spacing: 0) {
                            BoardView(onTapTile: { open(.deed($0)) }) {
                                CenterWell()
                            }
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                        VStack(spacing: 10) {
                            bottomPanel
                        }
                        .frame(width: 380)
                    }
                    .padding(.horizontal, 12)
                } else if hSize == .regular {
                    // iPad in play is a tabletop: the board sits huge in the
                    // middle with the whole dock INSIDE its centre well — the
                    // dice and buttons live where everyone around the table can
                    // see them — plus a roll control pinned to each corner of
                    // the screen so whoever sits on that side can reach one.
                    ZStack {
                        VStack(spacing: 10) {
                            // The strip stays out of the corners — those belong
                            // to the players' own pods.
                            PlayerStrip(sideInset: 196, onTapPlayer: { p in
                                if store.state?.isPlaying == true, p.id != store.meId, !p.isBankrupt,
                                   store.me?.isBankrupt != true {
                                    open(.trade(from: store.activeId, to: p.id, give: [], want: []))
                                }
                            })
                            .padding(.horizontal, 196)

                            AwaitingSeatsCard()
                                .padding(.horizontal, 196)

                            BoardView(onTapTile: { open(.deed($0)) }) {
                                CenterWell(actionsInWell: true,
                                           openProperties: { open(.properties) },
                                           openTrade: { open(.tradePicker(from: store.activeId, give: [])) },
                                           openHistory: { open(.chatLog(1), from: "history") },
                                           openCounter: { open(.counter($0)) },
                                           openResults: { open(.gameOver) },
                                           morphSpace: morphSpace)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .padding(.horizontal, 12)

                            Spacer(minLength: 6)
                        }

                        CornerPods(openTrade: { from in
                            open(.tradePicker(from: from, give: []))
                        })
                    }
                } else if store.state?.isLobby == true {
                    PlayerStrip(onTapPlayer: { _ in })
                    BoardView(onTapTile: { open(.deed($0)) }) {
                        CenterWell()
                    }
                    .padding(.horizontal, 6)
                    bottomPanel
                } else {
                    // Two zones: the board high, and one control cluster at the
                    // bottom — player strip directly above the action dock, no
                    // orphaned bands floating in between. The chat bubble
                    // floats over the seam, thumb-height, always reachable.
                    ZStack(alignment: .bottomTrailing) {
                        VStack(spacing: 0) {
                            BoardView(onTapTile: { open(.deed($0)) }) {
                                CenterWell(openHistory: { open(.chatLog(1), from: "history") },
                                           morphSpace: morphSpace)
                            }
                            .padding(.horizontal, 6)
                            .padding(.top, 2)

                            Spacer(minLength: 10)

                            // One cluster, and it moves as one: when the dock
                            // stretches into a new phase the rail above it
                            // rides up on the same curve, instead of jumping
                            // to its new place while the shell below glides.
                            VStack(spacing: 0) {
                                PlayerStrip(onTapPlayer: { p in
                                    if store.state?.isPlaying == true, p.id != store.meId, !p.isBankrupt,
                                       store.me?.isBankrupt != true {
                                        open(.trade(from: store.activeId, to: p.id, give: [], want: []))
                                    }
                                })
                                // The rail and the dock are two pieces of
                                // glass now, and butted edge to edge they
                                // read as one slab stacked on another, the
                                // rail's shadow lying across the dock's rim.
                                // Eight apart they are two panes floating
                                // together — still one cluster, on 17 as on
                                // 26, where separate containers never fuse.
                                // A held chair's card below keeps sitting
                                // flush on the dock, as the dock's first line.
                                .padding(.bottom, 8)

                                bottomPanel
                            }
                            .animation(.mmMorph(reduceMotion: reduceMotion),
                                       value: ActionPanel.stage(of: store))
                        }

                        chatBubble(P)
                    }
                }
            } else {
                Spacer()
                ProgressView().tint(P.red)
                Text(connectionLabel)
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                if let err = store.joinError {
                    Text(err).font(.system(size: 13)).foregroundStyle(P.bad)
                }
                Spacer()
            }
        }
        .padding(.top, 4)
        // Before the sheets, so it reaches the table's glass and none of
        // theirs: a sheet is not hanging over the board.
        .environment(\.mmBoardBusy, boardBusy)
        // The deal-in runs for the three seconds the deck intro gives it.
        .task(id: store.boardIntroAt) {
            let left = store.boardIntroAt.map { 3 - Date().timeIntervalSince($0) } ?? 0
            dealing = left > 0
            guard left > 0 else { return }
            try? await Task.sleep(for: .seconds(left))
            if !Task.isCancelled { dealing = false }
        }
        // The dice spring for the beat the walk waits on them.
        .task(id: store.state?.turn?.dice) {
            tumbling = store.state?.turn?.dice != nil
            guard tumbling else { return }
            try? await Task.sleep(for: .seconds(Choreography.diceLead))
            if !Task.isCancelled { tumbling = false }
        }
        // The frame budget is watched only while a game is being played,
        // which is the only time there is glass over a live board.
        .onChange(of: store.state?.isPlaying == true, initial: true) { _, playing in
            MMGlassGovernor.shared.watchFrames(playing)
        }
        .onDisappear { MMGlassGovernor.shared.watchFrames(false) }
        .sheet(item: $sheet) { which in
            Group {
                switch which {
                case .deed(let i): DeedSheet(tileIndex: i)
                case .properties: PropertiesSheet(
                    openTrade: { give in
                        open(.tradePicker(from: store.activeId, give: give))
                    },
                    askFor: { target, want in
                        open(.trade(from: store.activeId, to: target, give: [], want: want))
                    })
                case .trade(let from, let target, let give, let want):
                    TradeSheet(fromId: from, targetId: target, preselectedGive: give, preselectedGet: want)
                case .counter(let trade):
                    TradeSheet(countering: trade)
                case .tradeOffer(let trade, let seat):
                    TradeOfferSheet(trade: trade, seat: seat, onNegotiate: { open(.counter($0)) })
                case .tradePicker(let from, let give):
                    TradePickerSheet(fromId: from, give: give,
                                     pick: { open(.trade(from: from, to: $0, give: give, want: [])) })
                case .chatLog(let tab): ChatLogSheet(initialTab: tab)
                case .settings: SettingsSheet()
                case .gameOver: GameOverSheet()
                }
            }
            .environmentObject(store)
            .modifier(MorphTarget(id: morphFrom[which.id], space: morphSpace))
        }
        .onChange(of: store.state?.trades.map(\.id) ?? []) { _, _ in presentNewOffer() }
        .onChange(of: store.state?.trades.map { $0.ignored ?? false } ?? []) { _, _ in presentNewOffer() }
        .onChange(of: store.showGameOver) { _, over in
            if over {
                // Whatever sheet was open when the last player fell, the result
                // is the thing to look at — and SwiftUI will not swap one sheet
                // for another in the same frame, so close first, present after.
                if sheet != nil {
                    sheet = nil
                    Task {
                        try? await Task.sleep(for: .milliseconds(350))
                        if store.showGameOver { open(.gameOver) }
                    }
                } else {
                    open(.gameOver)
                }
            } else if sheet?.id == ActiveSheet.gameOver.id {
                // A rematch puts the room back in the lobby; the old result
                // must not stay up over the new table.
                sheet = nil
            }
        }
        .onChange(of: store.timedOut) { _, out in
            // The overlay lives under presented sheets, so a deed sheet left
            // open would bury the only two buttons it offers.
            if out { sheet = nil }
        }
        .animateOverlays(store)
        .overlay {
            if store.timedOut {
                TimedOutOverlay(onHome: { store.leaveRoom() },
                                onStay: { store.timedOut = false })
            }
        }
        .animation(.spring(duration: 0.35), value: store.timedOut)
    }

    private var connectionLabel: String {
        switch store.connection {
        case .connected: "Joining room…"
        case .connecting: "Connecting to the server…"
        case .disconnected: "Reconnecting…"
        }
    }

    /// How many lines have been said since anyone looked. A number rather than
    /// a dot: "3" is an invitation to go and read three things, a dot is just
    /// a smudge on a button.
    ///
    /// A plate in the accent with the accent's own ink — white on brass was
    /// 3.3:1 — lifted off whatever it overhangs by a ring of that thing's
    /// colour. What it overhangs now is glass, so the ring is the colour the
    /// glass composites to, not the page's.
    @ViewBuilder private func unreadBadge(_ P: Palette) -> some View {
        if store.unreadChat > 0 {
            Text(store.unreadChat > 99 ? "99+" : "\(store.unreadChat)")
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .foregroundStyle(P.accentInk)
                .padding(.horizontal, store.unreadChat > 9 ? 5 : 0)
                .frame(minWidth: 19, minHeight: 19)
                .background(P.red, in: Capsule())
                .overlay(Capsule().stroke(BackdropKind.page.settledGlass(P).solid, lineWidth: 2))
                .transition(.scale.combined(with: .opacity))
                .animation(.spring(duration: 0.28, bounce: 0.5), value: store.unreadChat)
        }
    }

    // MARK: - chat bubble

    /// The round chat button, floated bottom-right at thumb height — the
    /// table talk is one tap away without giving up any board room.
    ///
    /// A coloured button, so a plate in the accent with the accent's own ink,
    /// taking from the glass only its shadow, its press and the light under
    /// the thumb. Where it floats depends on how tall the dock has grown — over
    /// the board, over the seats' rail, over the dock's own top edge — and a
    /// pane of glass there would be glass on glass half the time. A plate over
    /// glass is not. On 26 the chat sheet grows out of it.
    private func chatBubble(_ P: Palette) -> some View {
        Button {
            open(.chatLog(0), from: "chat.fab")
            Haptics.tap()
        } label: {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 19, weight: .semibold))
                .frame(width: 50, height: 50)
        }
        .buttonStyle(MMButtonStyle(kind: .primary, form: .disc))
        // What it hangs over moves on its own, so its shadow deepens while
        // the board performs, the way a bar's does.
        .mmControls(on: .page)
        .modifier(MorphSource(id: "chat.fab", space: morphSpace))
        .overlay(alignment: .topTrailing) { unreadBadge(P).offset(x: 4, y: -3) }
        .padding(.trailing, 14)
        .padding(.bottom, 128)
        .accessibilityLabel("Open chat")
    }

    // MARK: - top bar

    /// The table's toolbar: one bar of glass, where there used to be six discs
    /// of card. Six panes in a row are a string of beads and six blurs; one bar
    /// is one of each, and it is what the web's toolbar and 26's own toolbars
    /// are. r22 at 8 of padding hands the keys 14, so the row sits concentric
    /// in the bar and the gap at its corners does not pinch.
    ///
    /// One of the table's two lensing surfaces. It hangs over the page, which
    /// nothing scrolls under, so it declares the page and runs no live layer.
    private func topBar(_ P: Palette) -> some View {
        let glass = BackdropKind.page.settledGlass(P)
        return MMGlassContainer(spacing: 10) {
            HStack(spacing: 8) {
                topBarKeys(P, glass)
            }
            .padding(8)
            .mmControls(on: .chrome)
            .mmGlass(.regular, backdrop: .page,
                     in: RoundedRectangle(cornerRadius: MMRadius.xl, style: .continuous))
        }
        .padding(.horizontal, 12)
    }

    @ViewBuilder
    private func topBarKeys(_ P: Palette, _ glass: GlassTokens) -> some View {
        Button {
            // Mid-game, leaving deserves a second thought — and a way back.
            // Once you've been removed there is no game left to leave, and
            // the dialog's two answers are both meaningless, so a player
            // watching from the sidelines just goes home.
            let removed = store.me?.wasRemoved == true || store.me == nil
            if store.state?.isPlaying == true && !removed {
                confirmLeave = true
            } else {
                store.leaveRoom()
            }
        } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(keyInk(glass))
                .frame(width: 34, height: 34)
                .keyTarget()
        }
        .buttonStyle(MMButtonStyle(kind: .ghost, form: .key))
        .confirmationDialog("Leave the game?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave — I'll come back") {
                // Keep lastRoom so the landing screen offers Continue.
                let room = store.roomId ?? ""
                let guestCount = store.guests.count
                store.leaveRoom()
                store.lastRoom = room
                store.lastGuests = guestCount
            }
            Button("Give up — declare bankruptcy", role: .destructive) {
                // Conceding hands the streets to the bank and keeps the
                // seat as a spectator — the table plays on. On a pass &
                // play phone the flag belongs to ONE of its players, so
                // ask which — SwiftUI won't swap one dialog for another
                // in the same frame, hence the beat in between.
                if aliveLocalSeats.count > 1 {
                    Task {
                        try? await Task.sleep(for: .milliseconds(350))
                        confirmConcede = true
                    }
                } else {
                    store.concede()
                }
            }
            Button("Leave for good", role: .destructive) {
                // The quit has to reach the server before the socket goes
                // away — it's what hands the streets back to the bank.
                store.quitGame()
                Task {
                    try? await Task.sleep(for: .milliseconds(350))
                    store.leaveRoom()
                }
            }
        } message: {
            Text("A bot holds your seat while you're away, so you can continue from the home screen. Leaving for good returns your streets to the bank and costs 1 karma.")
        }
        .confirmationDialog("Who gives up?", isPresented: $confirmConcede, titleVisibility: .visible) {
            // Named per seat: several people share this phone, and the
            // white flag must land on the right one.
            ForEach(aliveLocalSeats) { p in
                Button("\(p.name) gives up", role: .destructive) {
                    store.concede(as: p.id)
                }
            }
        } message: {
            Text("That player declares bankruptcy and stays as a spectator. Everyone else on this phone plays on.")
        }

        // The room code is something the bar says, not something to press,
        // so it is printed straight on the glass: the capsule of card it sat
        // in was a pane on the bar.
        HStack(spacing: 6) {
            Circle()
                .fill(store.connection == .connected ? P.good : P.gold)
                .frame(width: 7, height: 7)
            Text(store.roomId ?? "")
                .font(.system(size: 14, weight: .heavy, design: .monospaced))
                .foregroundStyle(glass.ink)
                .kerning(1)
                .lineLimit(1)
                .fixedSize()
        }
        .padding(.horizontal, 4)

        Spacer(minLength: 4)

        SoundToggle()
        iconButton("bubble.left.and.bubble.right.fill", glass) { open(.chatLog(0), from: "chat.bar") }
            .modifier(MorphSource(id: "chat.bar", space: morphSpace))
            .overlay(alignment: .topTrailing) { unreadBadge(P).offset(x: 5, y: -4) }
        if store.state?.isPlaying == true {
            iconButton("arrow.left.arrow.right", glass) {
                open(.tradePicker(from: store.activeId, give: []), from: "trade")
            }
            .modifier(MorphSource(id: "trade", space: morphSpace))
            iconButton("building.columns.fill", glass) { open(.properties) }
        }
        // The bar's one coloured key: inviting somebody to the table is
        // the thing the bar is most for, so it keeps its plate in the
        // accent, with the accent's own ink.
        ShareLink(item: shareURL) {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 14, weight: .bold))
                .frame(width: 34, height: 34)
        }
        .buttonStyle(MMButtonStyle(kind: .primary, form: .key))
    }

    /// The web client reads ?room= on load, so this link seats a friend at the
    /// same table straight from a browser — no app install in the way.
    private var shareURL: URL {
        // The custom domain, not the deploy host it happens to sit behind: a
        // link somebody sends a friend should say what the game is called.
        let home = "https://www.moneymove.live/"
        return URL(string: "\(home)?room=\(store.roomId ?? "")") ?? URL(string: home)!
    }

    /// The glyphs on the bar are in the glass's second ink, the rank the
    /// discs printed them in, so the room code beside them reads first.
    private func keyInk(_ glass: GlassTokens) -> Color {
        glass.label(secondary: true, increaseContrast: contrast == .increased)
    }

    private func iconButton(_ system: String, _ glass: GlassTokens,
                            action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(keyInk(glass))
                .frame(width: 34, height: 34)
                .keyTarget()
        }
        .buttonStyle(MMButtonStyle(kind: .ghost, form: .key))
    }

    // MARK: - bottom context panel

    @ViewBuilder private var bottomPanel: some View {
        if let state = store.state {
            // Held chairs sit right above the dock: the decision belongs with
            // the buttons, not off in a corner of the board.
            AwaitingSeatsCard()
                .padding(.horizontal, 12)

            if state.isLobby {
                if state.isQuickWaiting {
                    QuickMatchPanel()
                        .frame(maxHeight: .infinity)
                } else {
                    LobbyPanel(openSettings: { open(.settings) })
                        .frame(maxHeight: .infinity)
                }
            } else {
                // The live feed lives inside the board's centre well now, so the
                // board itself takes the full width and the dock stays at thumbs.
                // No spacer here on purpose: the one above the player strip owns
                // all the slack, so the strip and the dock stay a single cluster
                // instead of drifting apart with a dead band between them.
                ActionPanel(openProperties: { open(.properties) },
                            openTrade: { open(.tradePicker(from: store.activeId, give: [])) },
                            openCounter: { open(.counter($0)) },
                            openResults: { open(.gameOver) })
                    .padding(.bottom, 4)
            }
        }
    }
}

// MARK: - live activity feed

/// The last few game-log lines, ticking live under the board — the game keeps
/// talking even when it isn't your turn.
struct ActivityFeed: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    /// Embedded = inside the board's centre well: transparent, tighter type.
    var embedded = false

    private static let icons: [String: (String, Color)] = [
        "dice": ("die.face.5.fill", Color(hex: 0x8B5CF6)),
        "money": ("dollarsign.circle.fill", Color(hex: 0x4ADE80)),
        "rent": ("house.fill", Color(hex: 0xFB7185)),
        "buy": ("cart.fill", Color(hex: 0x60A5FA)),
        "turn": ("play.fill", Color(hex: 0xFBBF24)),
        "jail": ("exclamationmark.triangle.fill", Color(hex: 0xFB923C)),
        "warn": ("exclamationmark.triangle.fill", Color(hex: 0xFB923C)),
        "bankrupt": ("xmark.octagon.fill", Color(hex: 0xFB7185)),
        "auction": ("hammer.fill", Color(hex: 0xFBBF24)),
        "trade": ("arrow.left.arrow.right", Color(hex: 0xFBBF24)),
        "system": ("sparkles", Color(hex: 0xF04156)),
        "treasure": ("gift.fill", Color(hex: 0xFB923C)),
        "surprise": ("questionmark.circle.fill", Color(hex: 0xF472B6)),
        "build": ("hammer.circle.fill", Color(hex: 0x60A5FA)),
        "mortgage": ("building.columns.fill", Color(hex: 0x94A3B8)),
        "join": ("person.fill.badge.plus", Color(hex: 0x94A3B8)),
        "leave": ("person.fill.badge.minus", Color(hex: 0x94A3B8)),
    ]

    var body: some View {
        let P = Palette.current(scheme)
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: embedded ? 4 : 5) {
                    // Only what the table has said since kick-off (logFloor):
                    // the feed starts the game silent and fills as it goes,
                    // instead of dumping the lobby's backlog all at once. The
                    // History sheet is where the whole record lives.
                    ForEach((store.state?.log ?? []).filter { $0.at > store.logFloor }.suffix(12)) { line in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            let style = Self.icons[line.kind] ?? ("circle.fill", P.ink3)
                            Image(systemName: style.0)
                                .font(.system(size: embedded ? 8 : 9))
                                .foregroundStyle(style.1)
                                .frame(width: 12)
                            Text(line.text)
                                .font(.system(size: embedded ? 11.5 : 12.5,
                                              weight: line.kind == "turn" ? .bold : .medium, design: .rounded))
                                .foregroundStyle(line.kind == "turn" ? P.ink : P.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .id(line.id)
                    }
                }
                .padding(embedded ? 8 : 12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: store.state?.log.last?.at) {
                if let last = store.state?.log.last {
                    withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
            .onAppear {
                if let last = store.state?.log.last { proxy.scrollTo(last.id, anchor: .bottom) }
            }
        }
        .background(
            embedded ? Color.clear : P.card.opacity(scheme == .light ? 0.9 : 0.55),
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(embedded ? Color.clear : P.rule, lineWidth: 1)
        )
    }
}

// MARK: - sound toggle

/// A key on the table's toolbar, like the glyphs beside it. Off used to drop
/// to the third ink, which the glass cannot carry — 1.53:1 — so the two
/// states share the second and the slash through the speaker says which.
struct SoundToggle: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.mmControlBackdrop) private var backdrop
    @State private var on = SoundKit.shared.enabled

    var body: some View {
        let glass = backdrop.settledGlass(Palette.current(scheme))
        Button {
            on.toggle()
            SoundKit.shared.enabled = on
            if on { SoundKit.shared.warmUp(); SoundKit.shared.click() }
        } label: {
            Image(systemName: on ? "speaker.wave.2.fill" : "speaker.slash.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(glass.label(secondary: true, increaseContrast: contrast == .increased))
                .frame(width: 34, height: 34)
                .keyTarget()
        }
        .buttonStyle(MMButtonStyle(kind: .ghost, form: .key))
    }
}

private extension View {
    /// A key on the table's toolbar is bare at rest — no well under it until a
    /// thumb lands (see `MMButtonStyle.Form.key`) — and a button only answers
    /// where something is drawn. A frame draws nothing and a see-through well
    /// counts as nothing, so a bare key would take a tap on its glyph alone:
    /// a fifteen-point target where the disc it replaced gave thirty-four. So
    /// it claims its whole outline, the r14 the well comes up in.
    func keyTarget() -> some View {
        contentShape(RoundedRectangle(cornerRadius: MMRadius.md, style: .continuous))
    }
}

// MARK: - player strip

/// The seats, on a rail of glass.
///
/// The rail is the glass and the seats are not: a pane per seat would be glass
/// on glass the moment the rail existed, and glass inside a scroll view pays
/// for a backdrop pass per seat per frame of every scroll. So each seat is
/// drawn on the rail's material — a shallow well, the light catching its edge
/// — and the seat on the clock wears a ring of the rim's own brass.
///
/// The rail stops at `frost`. Lensing is for the bar and the dock; a lens here
/// would spend the budget of a third surface on a rail nobody reads edges on.
struct PlayerStrip: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    /// Horizontal space the parent has shaved off each side (iPad corner pods).
    var sideInset: CGFloat = 0
    let onTapPlayer: (PlayerState) -> Void

    /// How far the floating +/- badge rides above a chip's top edge, and the
    /// headroom the strip has to keep clear for it.
    private static let badgeLift: CGFloat = 15
    private static let badgeRoom: CGFloat = 22
    /// The rail's own margin from the screen's edges.
    private static let margin: CGFloat = 12
    /// How far the seats stand in from the rail's ends. It is also how deep
    /// the fade there runs, so at rest the fade lies over empty rail.
    private static let edge: CGFloat = 8
    /// The seats stand about four in from the rail's top and bottom, and a
    /// 22 rail hands a child four in the 18 that keeps it concentric.
    private static let seatRadius = MMRadius.inner(MMRadius.xl, inset: 4)

    var body: some View {
        let P = Palette.current(scheme)
        let glass = BackdropKind.page.settledGlass(P)
        // Both fall straight out of the freshest state, so the standings and
        // the heads-up re-read themselves on every push.
        let ranks = store.liveRanks
        let nextUp = store.nextUpId
        // The chip on the clock is the one worth reading, so the strip drives
        // itself there; a four-player table is wider than any phone and the
        // seat that matters used to end up off the right edge.
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(store.state?.players ?? []) { p in
                        seat(p, ranks: ranks, nextUp: nextUp, glass: glass, P: P)
                    }
                }
                .padding(.horizontal, Self.edge)
                .frame(minWidth: max(0, contentWidth - sideInset * 2 - Self.margin * 2))
            }
            .onAppear { scroll(proxy, animated: false) }
            .onChange(of: store.state?.turn?.playerId) { _, _ in scroll(proxy, animated: true) }
            .onChange(of: store.state?.players.count) { _, _ in scroll(proxy, animated: true) }
            // A scroll view clips to its own bounds, which is what was slicing
            // the top off every money badge. Turning that clip off and masking
            // our own keeps the sides tight — seats must still scroll away
            // cleanly under the rail's ends, and on iPad the corner pods sit
            // just outside them — while leaving the badge room to hang over
            // the board.
            .scrollClipDisabled()
        }
        .frame(height: 54)
        .mask {
            // Seats leaving either end fade out under the rail's rounded ends
            // instead of being sliced off at its edge. The top stays open for
            // the badges.
            HStack(spacing: 0) {
                LinearGradient(colors: [.clear, .black], startPoint: .leading, endPoint: .trailing)
                    .frame(width: Self.edge)
                Rectangle()
                LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing)
                    .frame(width: Self.edge)
            }
            .padding(.top, -Self.badgeRoom)
        }
        // The clock and the deadlock count ride a seat, and the seat is the
        // rail's glass: they are drawn into it rather than on panes of their
        // own.
        .mmControls(on: .chrome)
        .background {
            // Its own layer under the seats rather than a modifier on the
            // scroll view, so the glass neither clips the badges riding above
            // the rail nor touches the seats' own drawing.
            MMGlassContainer(spacing: 8) {
                Color.clear
                    .mmGlass(.regular, backdrop: .page,
                             in: RoundedRectangle(cornerRadius: MMRadius.xl, style: .continuous))
                    .transformEnvironment(\.mmGlassQuality) { $0 = min($0, .frost) }
            }
        }
        .padding(.horizontal, Self.margin)
    }

    /// One seat on the rail.
    private func seat(_ p: PlayerState, ranks: [String: Int], nextUp: String?,
                      glass: GlassTokens, P: Palette) -> some View {
        let isTurn = store.state?.isPlaying == true && store.state?.turn?.playerId == p.id
        let team = p.team.flatMap { store.state?.teamInfo?[safe: $0] }
        let ic = contrast == .increased
        let second = glass.label(secondary: true, increaseContrast: ic)
        return HStack(spacing: 7) {
            AvatarView(name: p.name, colorCSS: p.color, flag: p.flag ?? "", size: 32, emoji: p.avatar ?? "")
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(p.name)
                        .font(.system(size: 13.5, weight: .bold, design: .rounded))
                        .foregroundStyle(glass.ink)
                        .lineLimit(1)
                        .frame(maxWidth: 118, alignment: .leading)
                    if p.id == store.state?.hostId {
                        Text("HOST").font(.system(size: 7, weight: .black))
                            .foregroundStyle(glass.goldInk)
                    }
                    if p.isBot == true {
                        Text("BOT").font(.system(size: 7, weight: .black))
                            .foregroundStyle(second)
                    }
                    if let rank = ranks[p.id] {
                        rankBadge(rank, glass, P)
                    }
                    if nextUp == p.id, !isTurn {
                        nextTag(store.isLocal(p.id), glass, P)
                    }
                }
                HStack(spacing: 4) {
                    // In the red the number wears the bad
                    // colour and breathes — the balance itself
                    // is the debt, climbing back toward zero.
                    Text(standingLabel(p))
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundStyle(p.isBankrupt ? second
                                         : (p.inDebt ? glass.bad(increaseContrast: ic)
                                                     : glass.good(increaseContrast: ic)))
                        .contentTransition(.numericText())
                        .animation(.snappy(duration: 0.4), value: p.money)
                        .debtPulse(p.inDebt)
                    let owned = store.state?.ownership.values.filter { $0.owner == p.id }.count ?? 0
                    if owned > 0, !p.isBankrupt {
                        Text("·  \(owned)")
                            .font(.system(size: 9.5, weight: .bold, design: .rounded))
                            .foregroundStyle(second)
                        Art.icon(.houses, size: 10, tint: second)
                    }
                    if p.lapsBlocked > 0, !p.isBankrupt {
                        DeadlockLaps(left: p.lapsToRelief)
                    }
                    if isTurn {
                        TurnClock(endsAt: store.state?.turn?.endsAt, compact: true)
                    }
                }
            }
        }
        // Badges and the clock get their natural width — squeezed
        // into a screen-wide row they used to truncate to "NE…".
        .fixedSize(horizontal: true, vertical: false)
        .padding(.vertical, 6)
        .padding(.horizontal, 10)
        // A shallow well, shallower than a button's in the dock: the balance
        // printed on it is the one number everybody reads, in red as often as
        // in green.
        .background(glass.ink.opacity(ic ? 0.12 : 0.06),
                    in: RoundedRectangle(cornerRadius: Self.seatRadius, style: .continuous))
        .overlay {
            SeatEdge(onClock: isTurn,
                     team: team.map { Color(css: $0.color) },
                     radius: Self.seatRadius)
        }
        // The floating +/- rides the chip's right shoulder,
        // clear of the name and the money underneath it. Hung
        // from the trailing edge rather than centred, a long
        // amount grows back across the chip's own top instead
        // of out over the seats either side of it.
        .overlay(alignment: .topTrailing) {
            MoneyDeltaBadge(playerId: p.id)
                .offset(x: 6, y: -Self.badgeLift)
        }
        .opacity(p.isBankrupt ? 0.5 : 1)
        .id(p.id)
        .onTapGesture { onTapPlayer(p) }
    }

    /// The width the strip should try to fill. Taken from the window rather
    /// than the screen so a Split View iPad doesn't get a phantom scroll run.
    private var contentWidth: CGFloat {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive } ?? UIApplication.shared.connectedScenes.first as? UIWindowScene
        return scene?.keyWindow?.bounds.width ?? UIScreen.main.bounds.width
    }

    /// "bankrupt" is only true for players the game actually beat — a seat the
    /// clock took, or one that walked out, reads as what really happened.
    private func standingLabel(_ p: PlayerState) -> String {
        guard p.isBankrupt else { return money(p.money) }
        if p.wasRemoved { return p.removedFor == "quit" ? "left" : "timed out" }
        return "bankrupt"
    }

    /// Keep the seat on the clock — or this device's own seat between turns —
    /// inside the visible run of the strip.
    private func scroll(_ proxy: ScrollViewProxy, animated: Bool) {
        guard let state = store.state else { return }
        let target = (state.isPlaying ? state.turn?.playerId : nil) ?? store.meId
        guard state.players.contains(where: { $0.id == target }) else { return }
        if animated {
            withAnimation(.easeOut(duration: 0.3)) { proxy.scrollTo(target, anchor: .center) }
        } else {
            proxy.scrollTo(target, anchor: .center)
        }
    }

    /// Live position by net worth, crown on whoever is actually ahead. The
    /// crown is a drawn glyph in a fixed frame, so unlike the emoji it can't
    /// measure narrower than it paints and squeeze the "#1" out to "…".
    ///
    /// Drawn into the seat's glass: the leader's in a wash of brass with the
    /// glass's brass ink, the rest in a well with its second ink.
    private func rankBadge(_ rank: Int, _ glass: GlassTokens, _ P: Palette) -> some View {
        let ic = contrast == .increased
        return HStack(spacing: 3) {
            if rank == 1 { Art.icon(.crown, size: 10) }
            Text("#\(rank)")
                .font(.system(size: 8.5, weight: .black, design: .rounded))
                .fixedSize()
                .foregroundStyle(rank == 1 ? glass.goldInk : glass.label(secondary: true, increaseContrast: ic))
        }
        .padding(.vertical, 1.5)
        .padding(.horizontal, 5)
        .background(rank == 1 ? P.gold.opacity(ic ? 0.26 : 0.14) : glass.ink.opacity(ic ? 0.18 : 0.10),
                    in: Capsule())
    }

    /// Enough warning to look up before the turn lands — no more than that.
    private func nextTag(_ mine: Bool, _ glass: GlassTokens, _ P: Palette) -> some View {
        let ic = contrast == .increased
        return Text(mine ? "YOU'RE NEXT" : "NEXT")
            .font(.system(size: 7, weight: .black))
            .kerning(0.5)
            // Kerning adds a trailing gap that Text does not count in its own
            // ideal width, so without this the tag truncates itself to "NE…".
            .fixedSize()
            .foregroundStyle(mine ? glass.goldInk : glass.label(secondary: true, increaseContrast: ic))
            .padding(.vertical, 1.5)
            .padding(.horizontal, 5)
            .background(mine ? P.gold.opacity(ic ? 0.26 : 0.14) : glass.ink.opacity(ic ? 0.18 : 0.10),
                        in: Capsule())
    }
}

/// The edge of a seat on the rail.
///
/// A seat is not a pane, so it has no rim of its own; the rail's light catches
/// its edge instead — a hot corner and a far-edge bounce, the way the rail's own
/// rim runs, at about half its strength, over the half-point contour that keeps
/// the edge drawn where the light finds nothing. A team seat keeps its team's
/// colour for an edge, as it always has.
///
/// The seat on the clock gets the ring, and the ring is the rim's own brass —
/// bright where the light lands and falling away round the far side, so it
/// reads as light on an edge rather than a gold outline. It never glows:
/// nothing blurs it and nothing spills past it, which is what keeps it from
/// being mistaken for the lit tile's ring on the board. When the turn arrives
/// the light runs once around it.
private struct SeatEdge: View {
    let onClock: Bool
    let team: Color?
    let radius: CGFloat

    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// How far the light has travelled round the ring, in degrees. It only
    /// ever grows, by a full turn at a time, so each sweep animates from
    /// wherever the last one stopped — the same angle, as far as the ring is
    /// concerned.
    @State private var sweep: Double = 0

    var body: some View {
        let P = Palette.current(scheme)
        let glass = BackdropKind.page.settledGlass(P)
        let dark = BackdropKind.page.settledAppearance(P) == .dark
        let ic = contrast == .increased
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        ZStack {
            if onClock {
                SweptRing(shape: shape, light: glass.rimWarm, floor: ic ? 1 : 0.45, sweep: sweep)
            } else if let team {
                shape.strokeBorder(team, lineWidth: 1)
            } else {
                shape.strokeBorder(glint(glass, dark: dark), lineWidth: 1)
                    .blendMode(.plusLighter)
                shape.strokeBorder(dark ? Color.white.opacity(ic ? 0.30 : 0.08)
                                        : Color.black.opacity(ic ? 0.30 : 0.10),
                                   lineWidth: ic ? 1 : 0.5)
            }
        }
        .allowsHitTesting(false)
        // The rim sweep: once round, 900 ms, as the turn lands on this seat.
        // Off under Reduce Motion, where the ring simply appears.
        .onChange(of: onClock) { _, now in
            guard now, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9)) { sweep += 360 }
        }
    }

    /// The rail's light on the seat's edge: white by day and brass by night
    /// at the hot corner, brass at the far bounce, at half the rail's rim.
    private func glint(_ glass: GlassTokens, dark: Bool) -> AngularGradient {
        let hot: Color = dark ? glass.rimWarm : .white
        return AngularGradient(stops: [
            .init(color: hot.opacity(0.45), location: 0.00),
            .init(color: hot.opacity(0.06), location: 0.25),
            .init(color: glass.rimWarm.opacity(dark ? 0.26 : 0.15), location: 0.50),
            .init(color: hot.opacity(0.06), location: 0.75),
            .init(color: hot.opacity(0.45), location: 1.00),
        ], center: .center, angle: .degrees(135))
    }
}

/// The ring on the seat on the clock, with the light at `sweep` degrees past
/// the room's own. Animatable, so a sweep is the light travelling round the
/// ring rather than the ring being redrawn in its new place.
///
/// On the rail the light is the rim's brass. On an iPad's corner pod it is
/// the seat's own colour, because four pods face four people and each has to
/// say whose turn it is from across the table.
private struct SweptRing: View, Animatable {
    let shape: RoundedRectangle
    let light: Color
    /// The dimmest the far side of the ring falls to. Under Increase Contrast
    /// it does not fall at all.
    let floor: Double
    var sweep: Double

    /// Nonisolated, because the animation system reads it from outside the
    /// main actor, and it is only ever one plain number.
    nonisolated var animatableData: Double {
        get { sweep }
        set { sweep = newValue }
    }

    var body: some View {
        shape.strokeBorder(AngularGradient(stops: [
            .init(color: light, location: 0.00),
            .init(color: light.opacity(floor), location: 0.25),
            .init(color: light.opacity(max(floor, 0.8)), location: 0.50),
            .init(color: light.opacity(floor), location: 0.75),
            .init(color: light, location: 1.00),
        ], center: .center, angle: .degrees(135 + sweep)), lineWidth: 2)
    }
}

/// How many laps this seat has left before the deadlock rule moves the street
/// they are missing. It states the number and nothing else — the rule already
/// explained itself once, and the way out is a trade, not a warning.
///
/// It rides a seat on the rail or a corner pod, both glass, so it is a wash of
/// brass drawn into that glass with the glass's own brass ink; the glyph keeps
/// the raw gold, as glyphs on glass do.
struct DeadlockLaps: View {
    let left: Int
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.mmControlBackdrop) private var backdrop

    var body: some View {
        let P = Palette.current(scheme)
        let glass = backdrop.settledGlass(P)
        HStack(spacing: 3) {
            Art.icon(.scales, size: 9, tint: P.gold)
            Text("\(left) lap\(left == 1 ? "" : "s")")
                .font(.system(size: 8.5, weight: .black, design: .rounded))
                .fixedSize()
                .foregroundStyle(glass.goldInk)
        }
        .padding(.vertical, 1.5)
        .padding(.horizontal, 5)
        .background(P.gold.opacity(contrast == .increased ? 0.26 : 0.14), in: Capsule())
    }
}

// MARK: - centre well

struct CenterWell: View {
    /// iPad tabletop: the action dock renders inside the well, dead-centre.
    var actionsInWell = false
    var openProperties: (() -> Void)? = nil
    var openTrade: (() -> Void)? = nil
    /// Opens the full game log — the ghosted feed behind the dice is a teaser,
    /// this is the whole story.
    var openHistory: (() -> Void)? = nil
    var openCounter: ((TradeOffer) -> Void)? = nil
    /// Reopens the final standings once the game has ended.
    var openResults: (() -> Void)? = nil
    /// Where the history chip's sheet grows out of it, on 26.
    var morphSpace: Namespace.ID? = nil

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        let P = Palette.current(scheme)
        VStack(spacing: 10) {
            if let state = store.state {
                // An auction born of a landing waits behind the curtain until
                // that walk finishes — every viewer watches the same piece
                // arrive first, and the well shows the dice until it does.
                if let auction = state.auction, !store.auctionCurtained {
                    AuctionBox(auction: auction)
                        // Room for the turn clock, which now rides above every
                        // phase of the well rather than vanishing under a bid.
                        .padding(.top, state.turn?.endsAt == nil ? 0 : 26)
                } else if state.isLobby {
                    VStack(spacing: 8) {
                        // A matchmade table waits undealt (TileView keeps every
                        // card in the deck), so the deck itself sits here on
                        // the table, idly riffling until kick-off deals it out.
                        if state.quick == true {
                            DeckIntro(at: nil, idle: true)
                                .scaleEffect(0.72)
                                .frame(height: 92)
                                .padding(.bottom, 4)
                        }
                        Art.icon(mapGlyph(state.map.icon), size: 28)
                        Text(state.map.name)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
                        // one dot per seat, filled with each player's colour
                        HStack(spacing: 6) {
                            ForEach(0..<state.settings.maxPlayers, id: \.self) { i in
                                if let p = state.players[safe: i] {
                                    Circle().fill(Color(css: p.color)).frame(width: 11, height: 11)
                                        .overlay(Circle().stroke(.white.opacity(0.6), lineWidth: 1))
                                } else {
                                    Circle().stroke(P.rule2, style: StrokeStyle(lineWidth: 1.5, dash: [3]))
                                        .frame(width: 11, height: 11)
                                }
                            }
                        }
                        Text("\(state.players.count) of \(state.settings.maxPlayers) seats")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(P.ink3)
                    }
                } else if state.isEnded {
                    VStack(spacing: 6) {
                        Art.icon(.trophy, size: 36)
                        Text("\(store.state?.winner?.name ?? "Nobody") wins!")
                            .font(.system(size: 15, weight: .heavy, design: .rounded))
                            .foregroundStyle(P.ink)
                        // The result sheet is dismissable, so the well keeps a
                        // way back to it — otherwise the standings are gone.
                        if let openResults {
                            MMIconButton(.trophy, "Final standings", kind: .ghost) {
                                openResults()
                                Haptics.tap()
                            }
                            .padding(.top, 2)
                        }
                    }
                } else {
                    // The log runs quietly across the whole well; the dice sit
                    // on top, dead-centre of the board, the way a table reads.
                    // The feed is deliberately ghosted — background murmur, not
                    // a wall of text competing with the board.
                    GeometryReader { geo in
                        ZStack {
                            ActivityFeed(embedded: true)
                                .opacity(0.5)
                                .mask(
                                    LinearGradient(
                                        stops: [
                                            .init(color: .clear, location: 0),
                                            .init(color: .black.opacity(0.55), location: 0.3),
                                            .init(color: .black, location: 1),
                                        ],
                                        startPoint: .top, endPoint: .bottom
                                    )
                                )
                                .frame(maxWidth: .infinity, maxHeight: .infinity)

                            VStack(spacing: 12) {
                                Group {
                                    if let dice = state.turn?.dice, dice.count == 2 {
                                        let dieSize = min(max(geo.size.width * 0.17, 44), 76)
                                        DiceView(values: dice, size: dieSize)
                                            .padding(.vertical, dieSize * 0.30)
                                            .padding(.horizontal, dieSize * 0.42)
                                            .background(
                                                P.boardBG.opacity(0.92),
                                                in: RoundedRectangle(cornerRadius: 24, style: .continuous)
                                            )
                                            .shadow(color: .black.opacity(0.35), radius: 18, y: 8)
                                    }
                                    if state.settings.vacationCash == true, let pot = state.vacationPot, pot > 0 {
                                        // The pot floats over the felt beside
                                        // the dice, so it is a chip of glass,
                                        // its sum in the glass's own brass.
                                        HStack(spacing: 4) {
                                            Art.icon(.island, size: 13)
                                            Text(money(pot))
                                                .font(.system(size: 12, weight: .heavy, design: .rounded))
                                                .foregroundStyle(BackdropKind.felt.settledGlass(P).goldInk)
                                        }
                                        .padding(.vertical, 4)
                                        .padding(.horizontal, 10)
                                        .mmGlass(.regular, backdrop: .felt, in: Capsule())
                                    }
                                }
                                .allowsHitTesting(false)

                                // iPad tabletop: roll/buy/end-turn live right
                                // here, in the middle of the table.
                                if actionsInWell {
                                    ActionPanel(openProperties: { openProperties?() },
                                                openTrade: openTrade,
                                                openCounter: openCounter,
                                                openResults: openResults)
                                        .frame(maxWidth: min(geo.size.width * 0.74, 470))
                                }
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                        .overlay(alignment: .bottomTrailing) {
                            if let openHistory {
                                historyChip(openHistory, P)
                            }
                        }
                        .overlay { DeckIntro(at: store.boardIntroAt) }
                    }
                }
            }
        }
        // The server puts a deadline on every turn now — the house's seats
        // included — so the well's clock is a fixture of the table. It hangs
        // off the whole well rather than the dice layer, because an auction
        // replaces that layer and the clock must not blink out with it.
        .overlay(alignment: .top) {
            if store.state?.isPlaying == true {
                TurnClock(endsAt: store.state?.turn?.endsAt)
                    .padding(.top, 6)
            }
        }
        .padding(8)
        .minimumScaleFactor(0.7)
        // What the well's own controls float over is the felt, which moves
        // under them — the log drifting, the dice landing. The iPad's dock
        // declares its own glass for the buttons inside it.
        .mmControls(on: .felt)
    }

    /// The way into the whole log, floated in the well's corner over the
    /// ghosted feed. A glass pill, and Regular, never Clear: there is text
    /// sliding under it, and Clear over text is how a label gets lost. On 26
    /// the log's sheet grows out of it.
    private func historyChip(_ open: @escaping () -> Void, _ P: Palette) -> some View {
        Button {
            open()
            Haptics.tap()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 11, weight: .bold))
                Text("History")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
            }
            .foregroundStyle(BackdropKind.felt.settledGlass(P)
                .label(secondary: true, increaseContrast: contrast == .increased))
        }
        .buttonStyle(MMButtonStyle(kind: .ghost, form: .pill))
        .modifier(MorphSource(id: "history", space: morphSpace))
        .padding(10)
    }
}

// MARK: - deck-shuffle intro

/// The opening flourish: a deck of face-down cards sits in the middle of the
/// table, riffle-shuffles in two halves, then sinks away as the board deals
/// itself out of it (each tile flies from the centre — see TileView).
///
/// In `idle` mode it is the quick-match waiting deck instead: it sits on the
/// table holding the undealt board, riffling gently every few seconds and
/// never sinking away — kick-off is what finally deals it out.
struct DeckIntro: View {
    let at: Date?
    /// Loop the riffle forever instead of playing once and vanishing.
    var idle = false

    @Environment(\.colorScheme) private var scheme
    @State private var split = false      // halves apart
    @State private var merged = false     // riffled back together
    @State private var gone = false       // deck sinks as tiles fly

    var body: some View {
        let P = Palette.current(scheme)
        if idle {
            deck(P)
                .task {
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(4.5))
                        guard !Task.isCancelled else { return }
                        await riffle()
                        // The resting pose reads the same either way, so this
                        // reset never shows — it just re-arms the next pass.
                        merged = false
                    }
                }
        } else if let at, Date().timeIntervalSince(at) < 3, !gone {
            deck(P)
                .scaleEffect(gone ? 0.4 : 1)
                .opacity(gone ? 0 : 1)
                .task {
                    // Matches SoundKit.shuffleDeal: riffle ~0.55s, then the deal.
                    await riffle()
                    withAnimation(.easeIn(duration: 0.45)) { gone = true }
                }
        }
    }

    /// The card stack itself, mid-riffle or at rest — shared by both modes.
    private func deck(_ P: Palette) -> some View {
        ZStack {
            ForEach(0..<10, id: \.self) { i in
                let half: CGFloat = i.isMultiple(of: 2) ? -1 : 1
                cardBack(P)
                    .offset(x: split ? half * 46 : 0,
                            y: CGFloat(i) * -2.4 + (merged ? 0 : (split ? CGFloat(i % 3) * 5 : 0)))
                    .rotationEffect(.degrees(split ? Double(half) * 9 : Double(i) * 1.4 - 6))
            }
        }
        .allowsHitTesting(false)
    }

    /// One split-and-merge pass, ~0.85s all told.
    private func riffle() async {
        withAnimation(.spring(duration: 0.28, bounce: 0.4)) { split = true }
        try? await Task.sleep(for: .milliseconds(330))
        withAnimation(.spring(duration: 0.3, bounce: 0.5)) { split = false; merged = true }
        try? await Task.sleep(for: .milliseconds(520))
    }

    private func cardBack(_ P: Palette) -> some View {
        RoundedRectangle(cornerRadius: 9, style: .continuous)
            .fill(LinearGradient(colors: [P.red, P.redDeep], startPoint: .topLeading, endPoint: .bottomTrailing))
            .frame(width: 74, height: 104)
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(P.accentInk.opacity(0.4), lineWidth: 1.5)
                    .padding(6)
            )
            .overlay(
                Text("MM")
                    .font(.system(size: 20, weight: .black, design: .rounded))
                    .foregroundStyle(P.accentInk.opacity(0.75))
            )
            .shadow(color: .black.opacity(0.3), radius: 6, y: 3)
    }
}

// MARK: - floating money delta

/// "+$200" / "−$150" floating up beside a player's money for a beat.
///
/// Glass in its opaque form: the film's own composite colour, the brass rim
/// and the glass's shadow, with nothing seen through it. It rides the top
/// edge of the seats' rail and of a corner pod, and a translucent pane there
/// would be glass on glass; it lives inside the strip's scroll view, where a
/// live pane would pay for a backdrop pass on every frame of a scroll; and it
/// is gone again in a second and a half. Opaque, it is all of the material
/// that can be seen at that size and none of what costs.
struct MoneyDeltaBadge: View {
    let playerId: String
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        let glass = BackdropKind.page.settledGlass(Palette.current(scheme))
        let ic = contrast == .increased
        ZStack {
            if let d = store.moneyDeltas[playerId] {
                // Grouped like every other figure on screen: a rent bill reads
                // "−$1,450", never "−$1450".
                Text("\(d.amount > 0 ? "+" : "−")\(money(abs(d.amount)))")
                    .font(.system(size: 12, weight: .black, design: .rounded))
                    .foregroundStyle(d.amount > 0 ? glass.good(increaseContrast: ic)
                                                  : glass.bad(increaseContrast: ic))
                    // The badge floats in an overlay that proposes the tiny
                    // size of the money label — never let the amount truncate
                    // into "−$…".
                    .fixedSize()
                    .padding(.vertical, 2)
                    .padding(.horizontal, 7)
                    .mmGlass(.opaque, backdrop: .page, in: Capsule())
                    .id(d.id)
                    .transition(.asymmetric(
                        insertion: .offset(y: 8).combined(with: .opacity).combined(with: .scale(scale: 0.7)),
                        removal: .offset(y: -12).combined(with: .opacity)
                    ))
            }
        }
        .animation(.spring(duration: 0.4, bounce: 0.4), value: store.moneyDeltas[playerId])
        .allowsHitTesting(false)
    }
}

// MARK: - corner player pods (iPad tabletop)

/// Every player seated at THIS device gets their own little dashboard pinned
/// to a corner of the screen — name, live cash with the +/- flash, and their
/// dice / end-turn / trade controls. The top pair renders upside down, facing
/// the people sitting across the table.
struct CornerPods: View {
    let openTrade: (String) -> Void

    @EnvironmentObject var store: GameStore

    /// Local seats dealt to corners: first two at the bottom, next two across
    /// the table. This device's own player always leads, so the person holding
    /// the iPad never finds their own pod printed upside down — the server is
    /// free to shuffle turn order, and it does.
    private var seats: [PlayerState] {
        let mine = (store.state?.players ?? []).filter { store.isLocal($0.id) && !$0.isBankrupt }
        guard let i = mine.firstIndex(where: { $0.id == store.meId }) else { return mine }
        var ordered = mine
        ordered.insert(ordered.remove(at: i), at: 0)
        return ordered
    }

    var body: some View {
        let s = seats
        // No container out here. The pods sit a table's width apart, too far
        // for any two to ever run together, and a container drawn corner to
        // corner would be a layer laid over the whole board — the tiles and
        // the dock underneath it — to hold four panes that never meet. Each
        // pod carries its own instead.
        VStack {
            HStack(alignment: .top) {
                pod(s[safe: 2], flipped: true)
                Spacer()
                pod(s[safe: 3], flipped: true)
            }
            Spacer()
            HStack(alignment: .bottom) {
                pod(s[safe: 0], flipped: false)
                Spacer()
                pod(s[safe: 1], flipped: false)
            }
        }
        .padding(12)
    }

    @ViewBuilder private func pod(_ p: PlayerState?, flipped: Bool) -> some View {
        if let p {
            PlayerPod(player: p, flipped: flipped, openTrade: openTrade)
        } else {
            Color.clear.frame(width: 1, height: 1)
        }
    }
}

/// One corner dashboard: identity, cash, and this seat's controls.
///
/// A pod of glass floating in the screen's corner, over the page. Its buttons
/// are drawn into it — the Roll a plate, the trade a well — and it stops at
/// `frost`: four lensing pods would spend the whole frame budget on the
/// corners of the screen. The seat on the clock says so with its own colour
/// as the pod's edge — laid on as light, the rail's ring in this seat's
/// colour, rather than as a painted outline over the rim. The coloured glow
/// it used to cast is gone, because a rim never glows.
private struct PlayerPod: View {
    let player: PlayerState
    let flipped: Bool
    let openTrade: (String) -> Void

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// How far the light has run round the edge — see `SeatEdge`, whose ring
    /// this is.
    @State private var sweep: Double = 0

    private var isTurn: Bool {
        store.state?.isPlaying == true && store.state?.turn?.playerId == player.id
    }

    var body: some View {
        let P = Palette.current(scheme)
        let glass = BackdropKind.page.settledGlass(P)
        let ic = contrast == .increased
        let color = Color(css: player.color)
        // r22 over 12 of padding hands the buttons the 10 they wear.
        let shape = RoundedRectangle(cornerRadius: MMRadius.xl, style: .continuous)

        MMGlassContainer(spacing: 10) {
            face(glass, ic)
                .padding(12)
                .frame(width: 172)
                .mmControls(on: .chrome, corner: MMRadius.inner(MMRadius.xl, inset: 12))
                .mmGlass(.regular, backdrop: .page, in: shape)
                .transformEnvironment(\.mmGlassQuality) { $0 = min($0, .frost) }
        }
        .overlay {
            if isTurn {
                // A constant line of paint over the pod's rim would bury the
                // one edge on the material that is meant to vary. So the
                // seat's colour takes the rim's shape instead — hottest where
                // the room's light lands, falling away round the far side —
                // and runs once around as the turn arrives.
                SweptRing(shape: shape, light: color, floor: ic ? 1 : 0.45, sweep: sweep)
                    .allowsHitTesting(false)
            }
        }
        // Off under Reduce Motion, where the ring simply appears.
        .onChange(of: isTurn) { _, now in
            guard now, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9)) { sweep += 360 }
        }
        // The +/- floats on the pod's own top edge. Inside the card it used to
        // land on the name and the turn clock as soon as the amount ran long.
        .overlay(alignment: .topTrailing) {
            MoneyDeltaBadge(playerId: player.id)
                .offset(x: 4, y: -13)
        }
        .rotationEffect(.degrees(flipped ? 180 : 0))
        .animation(.spring(duration: 0.35), value: isTurn)
    }

    /// Who is sitting here and what they can do: the name and cash on top,
    /// this seat's controls under it.
    private func face(_ glass: GlassTokens, _ ic: Bool) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                AvatarView(name: player.name, colorCSS: player.color, flag: player.flag ?? "", size: 28, emoji: player.avatar ?? "")
                VStack(alignment: .leading, spacing: 0) {
                    Text(player.name)
                        .font(.system(size: 12.5, weight: .bold, design: .rounded))
                        .foregroundStyle(glass.ink)
                        .lineLimit(1)
                    HStack(spacing: 5) {
                        Text(money(player.money))
                            .font(.system(size: 15, weight: .heavy, design: .rounded))
                            .foregroundStyle(player.inDebt ? glass.bad(increaseContrast: ic)
                                                           : glass.good(increaseContrast: ic))
                            .contentTransition(.numericText())
                            .animation(.snappy(duration: 0.4), value: player.money)
                            .debtPulse(player.inDebt)
                        if player.lapsBlocked > 0, !player.isBankrupt {
                            DeadlockLaps(left: player.lapsToRelief)
                        }
                    }
                }
                Spacer(minLength: 0)
                if isTurn {
                    TurnClock(endsAt: store.state?.turn?.endsAt, compact: true)
                }
            }

            HStack(spacing: 6) {
                if isTurn, let phase = store.state?.turn?.phase {
                    switch phase {
                    case "roll":
                        podButton("Roll", glyph: .dice, prominent: true) { store.roll() }
                    case "end":
                        podButton("End ➜", prominent: true) { store.endTurn() }
                    default:
                        Text(phase == "action" ? "your call…" : "…")
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundStyle(glass.label(secondary: true, increaseContrast: ic))
                            .frame(maxWidth: .infinity)
                    }
                }
                podButton("⇄", prominent: false) { openTrade(player.id) }
                    .frame(width: 44)
            }
        }
    }

    /// The pod's own buttons, the app's own button: Roll and End a plate in the
    /// accent, the trade a well in the pod's glass.
    private func podButton(_ label: String, glyph: Glyph? = nil,
                           prominent: Bool, action: @escaping () -> Void) -> some View {
        let P = Palette.current(scheme)
        let kind: MMButtonStyle.Kind = prominent ? .primary : .ghost
        return Button {
            action()
            Haptics.tap()
        } label: {
            HStack(spacing: 5) {
                if let glyph {
                    Art.icon(glyph, size: 14, tint: kind.ink(P, on: .chrome))
                }
                Text(label)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(MMButtonStyle(kind: kind))
    }
}

// MARK: - turn clock

/// The seconds left on the current turn, counted down on this device from the
/// server's deadline. It leans on TimelineView rather than a Timer so every
/// copy on screen — well, chip, corner pod — ticks off the same clock.
///
/// Every copy is on glass or is glass. The compact one rides a seat on the
/// rail, a corner pod or the dock, so it is drawn into whichever glass that
/// is — a well, or a wash of red once the time is nearly up. The well's own
/// clock hangs over the felt by itself, so it is a chip of glass of its own.
struct TurnClock: View {
    /// Epoch milliseconds the turn expires (turn.endsAt). Nil when the table
    /// has no clock at all — nobody is waiting on a game you are playing on
    /// your own against bots you added — and then there is simply no clock to
    /// show. Every caller hands the field straight over so that decision is
    /// made in one place instead of five.
    let endsAt: Double?
    /// Compact = the small countdown riding a player chip or pod.
    var compact = false

    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.mmControlBackdrop) private var backdrop

    @ViewBuilder var body: some View {
        let P = Palette.current(scheme)
        let glass = (compact ? backdrop : .felt).settledGlass(P)
        if let endsAt {
            // Driven entirely on this device: the state push only ever hands
            // over a new deadline, so a quiet turn still counts down second by
            // second.
            TimelineView(.periodic(from: .now, by: 0.2)) { context in
                let left = Self.secondsLeft(endsAt, at: context.date)
                let urgent = left <= 10
                face(left: left, urgent: urgent, glass: glass, P: P)
                    // The last ten seconds get a heartbeat, once a second.
                    .scaleEffect(urgent && !left.isMultiple(of: 2) ? 1.07 : 1)
                    .animation(.snappy(duration: 0.18), value: left)
            }
            .fixedSize()
            // A fresh deadline restarts the tick schedule, so the number can
            // never be left frozen on the last turn's final second.
            .id(endsAt)
        }
    }

    @ViewBuilder
    private func face(left: Int, urgent: Bool, glass: GlassTokens, P: Palette) -> some View {
        let ic = contrast == .increased
        let digits = HStack(spacing: 4) {
            if !compact {
                Image(systemName: "timer")
                    .font(.system(size: 11, weight: .bold))
            }
            Text("\(left)s")
                .font(.system(size: compact ? 10.5 : 13, weight: .heavy, design: .rounded))
                .monospacedDigit()
        }
        .foregroundStyle(urgent ? glass.bad(increaseContrast: ic)
                                : glass.label(secondary: true, increaseContrast: ic))
        .padding(.vertical, compact ? 2.5 : 5)
        .padding(.horizontal, compact ? 6 : 11)
        if compact {
            digits
                .background(urgent ? P.bad.opacity(ic ? 0.26 : 0.14) : glass.ink.opacity(ic ? 0.18 : 0.10),
                            in: Capsule())
                .overlay(Capsule().stroke(urgent ? P.bad.opacity(0.55) : .clear, lineWidth: 1))
        } else {
            // No tint when the time runs short: red words on a red-washed
            // pane lose the contrast the words need. The red is in the words
            // and the heartbeat.
            digits.mmGlass(.regular, backdrop: .felt, in: Capsule())
        }
    }

    static func secondsLeft(_ endsAt: Double, at now: Date) -> Int {
        max(0, Int(ceil(endsAt / 1000 - now.timeIntervalSince1970)))
    }
}

// MARK: - waiting on a dropped seat

/// Somebody's connection went away and the table is holding their chair. The
/// card carries the only two things the room needs: how long is left, and the
/// button that buys them another minute. Never shown to the seat being waited
/// on — that player is not the one who gets to vote themselves back in.
struct AwaitingSeatsCard: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    @ViewBuilder var body: some View {
        let seats = store.awaitingSeats
        if !seats.isEmpty {
            VStack(spacing: 8) {
                ForEach(seats) { seat in
                    row(seat, Palette.current(scheme))
                }
            }
            .transition(.move(edge: .top).combined(with: .opacity))
            .animation(.spring(duration: 0.35), value: seats.map(\.id))
        }
    }

    private func row(_ seat: AwaitingSeat, _ P: Palette) -> some View {
        let player = store.state?.player(seat.id)
        let agreed = store.hasGrantedTime(seat)
        let count = seat.grantedIds.count
        // A vote can't need fewer seats than have already clicked.
        let voters = max(seat.voterCount, count)

        return VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 9) {
                if let player {
                    AvatarView(name: player.name, colorCSS: player.color,
                               flag: player.flag ?? "", size: 30, emoji: player.avatar ?? "")
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(player?.name ?? "A player") dropped out")
                        .font(.system(size: 14, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                        .lineLimit(1)
                    Text(seat.isVote
                         ? "Everyone still at the table has to agree now."
                         : "Any one of you can hand them another minute.")
                        .font(.system(size: 11.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 6)
                if let until = seat.until {
                    SeatCountdown(until: until)
                }
            }

            if seat.isVote {
                voteBar(count: count, voters: voters, P)
            }

            Button {
                store.grantTime(seat.id)
            } label: {
                HStack(spacing: 8) {
                    if let glyph = buttonGlyph(seat, agreed: agreed) {
                        Art.icon(glyph, size: 18,
                                 tint: (agreed ? MMButtonStyle.Kind.ghost : .gold).ink(P))
                    }
                    Text(buttonLabel(seat, agreed: agreed, count: count, voters: voters))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
            }
            .buttonStyle(MMButtonStyle(kind: agreed ? .ghost : .gold, big: true))
            .disabled(agreed)
            .opacity(agreed ? 0.75 : 1)
        }
        .padding(11)
        .background(P.goldSoft.opacity(0.7), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(P.gold.opacity(0.6), lineWidth: 1)
        )
    }

    /// After the free favours the button stops being a favour and starts being
    /// a vote, so it says so and carries the tally with it.
    private func buttonLabel(_ seat: AwaitingSeat, agreed: Bool, count: Int, voters: Int) -> String {
        guard seat.isVote else {
            return agreed ? "✓  Minute granted" : "Grant a minute"
        }
        let tally = "\(count) of \(voters) agreed"
        return agreed
            ? "✓  You agreed — waiting on the rest (\(tally))"
            : "Everyone must agree — \(tally)"
    }

    /// Only the two live states carry a mark: one player can hold the chair,
    /// or the whole table has to. Once you've clicked, the ✓ in the label says
    /// so and a second symbol would only crowd the line.
    private func buttonGlyph(_ seat: AwaitingSeat, agreed: Bool) -> Glyph? {
        agreed ? nil : (seat.isVote ? .people : .shield)
    }

    /// One pip per player who still has to click, filled as they do.
    private func voteBar(count: Int, voters: Int, _ P: Palette) -> some View {
        HStack(spacing: 4) {
            ForEach(0..<max(voters, 1), id: \.self) { i in
                Capsule()
                    .fill(i < count ? AnyShapeStyle(P.gold) : AnyShapeStyle(P.rule2))
                    .frame(height: 5)
            }
        }
        .animation(.snappy(duration: 0.25), value: count)
    }
}

/// Seconds until a held chair goes back to the board, ticked on this device so
/// it keeps moving between state pushes.
private struct SeatCountdown: View {
    let until: Double

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        TimelineView(.periodic(from: .now, by: 0.2)) { context in
            let left = TurnClock.secondsLeft(until, at: context.date)
            VStack(spacing: 0) {
                Text("\(left)s")
                    .font(.system(size: 15, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(left <= 15 ? P.bad : P.ink)
                Text("left")
                    .font(.system(size: 8.5, weight: .bold))
                    .kerning(0.5)
                    .foregroundStyle(P.ink3)
            }
            .padding(.vertical, 5)
            .padding(.horizontal, 9)
            .background(P.card.opacity(0.85), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .fixedSize()
        .id(until)
    }
}

// MARK: - timed-out overlay

/// The clock ran out on this device's seat. It takes over the screen because
/// it changes what the player can do next — but the game is still worth
/// watching, so staying is offered as loudly as leaving.
///
/// Its shell is glass in the opaque form: the film's own composite colour, the
/// brass rim and the glass's shadow, with nothing seen through it. There is
/// nothing to see through it to — it stands on a scrim that has already put
/// the game at 40% — and on 26 the system's glass takes its lean from what is
/// really under it, which here is that scrim, while the words on it are
/// chosen for the page we declare. The solid form is the material with that
/// disagreement taken away.
struct TimedOutOverlay: View {
    let onHome: () -> Void
    let onStay: () -> Void

    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        let P = Palette.current(scheme)
        let glass = BackdropKind.page.settledGlass(P)
        let second = glass.label(secondary: true, increaseContrast: contrast == .increased)
        ZStack {
            Color.black.opacity(0.6).ignoresSafeArea()

            VStack(spacing: 12) {
                // The same mark the dock gives a seat the clock took — drawn,
                // where this used to be an hourglass emoji.
                Art.icon(.snooze, size: 44, tint: glass.ink)
                Text("Your time ran out")
                    .font(.system(size: 22, weight: .heavy, design: .rounded))
                    .foregroundStyle(glass.ink)
                Text("You were removed to keep the game moving. You can head back or stay and watch how it ends.")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(second)
                    .multilineTextAlignment(.center)

                VStack(spacing: 8) {
                    Button("Back to home") {
                        onHome()
                        Haptics.tap()
                    }
                    .buttonStyle(MMButtonStyle(kind: .primary, big: true))

                    Button("Stay and watch") {
                        onStay()
                        Haptics.tap()
                    }
                    .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                }
                .padding(.top, 4)

                Text("Leaving or timing out costs 1 karma.")
                    .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(second)
            }
            .padding(24)
            .frame(maxWidth: 340)
            // The buttons stand on the shell, so they are drawn into it.
            .mmControls(on: .chrome)
            .mmGlass(.opaque, backdrop: .page,
                     in: RoundedRectangle(cornerRadius: MMRadius.xl, style: .continuous))
            .padding(.horizontal, 26)
            .transition(.scale(scale: 0.86).combined(with: .opacity))
        }
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

// MARK: - control → sheet morph

/// A control a sheet grows out of. On 26 a sheet opened from a piece of glass
/// morphs out of it and closes back into it — the system's zoom, which from a
/// glass control is the Liquid Glass morph — and the chat and trade sheets are
/// the ones the plan says earn it. Below 26 a sheet is UIKit's own
/// presentation, with nothing a `matchedGeometryEffect` could hold on to, so
/// it rises the way it always has; the zoom that exists on 18 is left alone
/// there, being a different animation from 26's and not the one being matched.
private struct MorphSource: ViewModifier {
    let id: String
    let space: Namespace.ID?

    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            if let space, MMSystemGlass.isOn {
                content.matchedTransitionSource(id: id, in: space)
            } else {
                content
            }
        } else {
            content
        }
    }
}

/// The sheet end of the same morph. Under Reduce Motion there is no morph at
/// all: the sheet slides, as the motion table asks.
private struct MorphTarget: ViewModifier {
    let id: String?
    let space: Namespace.ID

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            if let id, MMSystemGlass.isOn, !reduceMotion {
                content.navigationTransition(.zoom(sourceID: id, in: space))
            } else {
                content
            }
        } else {
            content
        }
    }
}
