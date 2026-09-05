// Which board, and whether you may have it.
//
// This used to be a dropdown, and a dropdown was the wrong shape for it: a
// board is a picture, not a word, and the one thing a lobby has to answer at a
// glance is "what are we playing?". So it is three boxes now, each with a
// drawing of the board itself.
//
// The three are always the same three things — the two boards the day is
// giving away, and then whatever this table is actually on. That last slot is
// the point. A host who bought Bharat sees Bharat sitting there; everyone else
// sees Classic, which is free forever and always will be. Nobody has to open
// anything to find out where they are.
//
// Everything else is behind "All boards": the ones already bought, and the
// ones still carrying a price. A locked board is a door into the shop, never a
// dead tap — the same manners the piece shelf keeps.

import SwiftUI

// MARK: - what the server says about a board

struct BoardSides: Codable, Hashable {
    var top: Int
    var right: Int
    var bottom: Int
    var left: Int
}

/// Enough to draw the board small: one colour per tile, and how many tiles sit
/// on each side so they can be walked back round the rim in order.
struct BoardPreview: Codable, Hashable {
    var colors: [String]
    var sides: BoardSides
}

struct BoardSummary: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var icon: String?
    var description: String?
    var size: Int
    var streets: Int?
    var countries: Int?
    var country: Bool?
    var preview: BoardPreview?

    /// Playable right now — free, free today, or bought.
    var playable: Bool = true
    /// Why: "house" | "today" | "owned" | "locked".
    var how: String = "house"
    var price: Int = 0

    var storeId: String { "brd-\(id)" }
}

struct BoardShelfFeed: Codable {
    var boards: [BoardSummary] = []
    var free: [String] = []
    /// Server-local midnight, in milliseconds — when the two free ones change.
    var until: Double = 0
    var perDay: Int = 2
    var cycleDays: Int = 9
    var house: String = "classic"
    var coins: Int = 0
}

// MARK: - the shelf, loaded once and kept

/// One loader for the whole app. The lobby and the shop both want the same
/// answer, and the answer moves once a day — so it is fetched, kept, and
/// re-fetched only when the wallet moves or the clock rolls over.
@MainActor
final class BoardShelf: ObservableObject {
    static let shared = BoardShelf()

    @Published private(set) var feed: BoardShelfFeed?
    private var loading = false

    var boards: [BoardSummary] { feed?.boards ?? [] }
    func board(_ id: String) -> BoardSummary? { boards.first { $0.id == id } }

    func load(_ store: GameStore, force: Bool = false) async {
        if feed != nil && !force { return }
        if loading { return }
        loading = true
        defer { loading = false }
        let fresh: BoardShelfFeed? = try? await store.fetchJSON(
            "/api/boards?token=\(store.token)", raw: true)
        if let fresh { feed = fresh }
    }

    /// Midnight came round while somebody was looking at it.
    func rolloverIfDue(_ store: GameStore) async {
        guard let until = feed?.until, until > 0 else { return }
        if Date().timeIntervalSince1970 * 1000 >= until { await load(store, force: true) }
    }

    /// The three: both free boards, then the one in play — falling back to the
    /// house board so the row never repeats itself.
    func trio(current: String) -> [BoardSummary] {
        guard let feed else { return [] }
        var out: [BoardSummary] = []
        func add(_ id: String) {
            guard let b = board(id), !out.contains(where: { $0.id == b.id }) else { return }
            out.append(b)
        }
        feed.free.forEach(add)
        add(current)
        add(feed.house)
        return Array(out.prefix(3))
    }
}

// MARK: - the drawing

/// The board itself, small: one rounded chip per tile, walked round the rim in
/// the order the server laid them out. Drawn rather than laid out, because
/// forty views for a thumbnail is forty views too many.
struct MiniBoard: View {
    let preview: BoardPreview
    var dim: Bool = false

    var body: some View {
        Canvas { ctx, size in
            let s = preview.sides
            let cols = max(s.top, s.bottom) + 2
            let rows = max(s.left, s.right) + 2
            guard cols > 1, rows > 1 else { return }
            let cw = size.width / CGFloat(cols)
            let ch = size.height / CGFloat(rows)
            let pad = min(cw, ch) * 0.09
            var i = 0

            func put(_ r: Int, _ c: Int) {
                guard i < preview.colors.count else { return }
                let rect = CGRect(x: CGFloat(c) * cw + pad, y: CGFloat(r) * ch + pad,
                                  width: cw - pad * 2, height: ch - pad * 2)
                ctx.fill(Path(roundedRect: rect, cornerRadius: max(0.7, pad)),
                         with: .color(Color(css: preview.colors[i]).opacity(dim ? 0.34 : 1)))
                i += 1
            }

            put(0, 0)
            for k in 0..<s.top { put(0, k + 1) }
            put(0, cols - 1)
            for k in 0..<s.right { put(k + 1, cols - 1) }
            put(rows - 1, cols - 1)
            for k in 0..<s.bottom { put(rows - 1, cols - 2 - k) }
            put(rows - 1, 0)
            for k in 0..<s.left { put(rows - 2 - k, 0) }
        }
        .aspectRatio(1, contentMode: .fit)
        .drawingGroup()
    }
}

/// What a box says under its name — and it never says two things at once.
private struct BoardTag: View {
    let board: BoardSummary
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        let (text, fg, bg): (String, Color, Color) = {
            switch board.how {
            case "house": return ("ALWAYS FREE", P.ink3, P.sunken)
            case "today": return ("FREE TODAY", P.good, P.good.opacity(0.14))
            case "owned": return ("YOURS", P.gold, P.goldSoft)
            default:      return ("\(board.price)", P.gold, P.sunken)
            }
        }()
        HStack(spacing: 3) {
            if board.how == "locked" { Art.icon(.coin, size: 8.5) }
            Text(text)
                .font(.system(size: 8.5, weight: .black, design: .rounded))
                .kerning(0.3)
                .foregroundStyle(fg)
        }
        .padding(.vertical, 2.5)
        .padding(.horizontal, 6)
        .background(bg, in: Capsule())
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
}

// MARK: - the three boxes

/// The lobby's board row: three boxes, a way through to the rest, and a clock
/// counting down to the next two.
struct BoardBoxes: View {
    @EnvironmentObject var store: GameStore
    @ObservedObject private var shelf = BoardShelf.shared
    @Environment(\.colorScheme) private var scheme

    /// A cup fixes its own board, and a guest changes nothing.
    var canEdit: Bool

    @State private var showAll = false
    @State private var shopping: BoardToBuy?

    private var current: String {
        store.state?.mapId ?? store.state?.settings.mapId ?? "classic"
    }

    var body: some View {
        let P = Palette.current(scheme)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Art.icon(.map, size: 13, tint: P.ink2)
                PanelTitle("Board")
                Spacer(minLength: 6)
            }

            let trio = shelf.trio(current: current)
            if trio.isEmpty {
                // Same height before the shelf lands as after, so the panel
                // does not jump when it does.
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(P.sunken)
                    .frame(height: 126)
            } else {
                HStack(spacing: 8) {
                    ForEach(trio) { box($0, P) }
                }
            }

            Button {
                SoundKit.shared.click()
                showAll = true
            } label: {
                HStack(spacing: 6) {
                    Text("All boards")
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                    Spacer(minLength: 4)
                    Text("\(shelf.boards.count) boards · \(shelf.boards.filter { !$0.playable }.count) locked")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(P.ink3)
                }
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 42)
                .background(P.sunken, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(P.rule, lineWidth: 1))
            }
            .buttonStyle(.plain)

            if let until = shelf.feed?.until, until > 0 {
                BoardClock(until: until)
            }
        }
        .task { await shelf.load(store) }
        .sheet(isPresented: $showAll) {
            BoardPickerSheet(canEdit: canEdit)
                .environmentObject(store)
        }
        .sheet(item: $shopping) { pick in
            if let b = shelf.board(pick.id) {
                BoardBuySheet(board: b) { bought in
                    // Bought from the lobby: play it straight away. That is
                    // what they were reaching for when they tapped it.
                    if canEdit { store.updateSettings(["mapId": bought]) }
                }
                .environmentObject(store)
            }
        }
    }

    @ViewBuilder private func box(_ b: BoardSummary, _ P: Palette) -> some View {
        let selected = b.id == current
        Button {
            SoundKit.shared.click()
            if b.playable { store.updateSettings(["mapId": b.id]) } else { shopping = BoardToBuy(id: b.id) }
        } label: {
            VStack(spacing: 5) {
                if let p = b.preview {
                    MiniBoard(preview: p, dim: !b.playable)
                        .padding(3)
                        .background(P.page, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                } else {
                    Art.icon(mapGlyph(b.icon), size: 26, tint: P.ink2)
                        .frame(maxWidth: .infinity)
                        .aspectRatio(1, contentMode: .fit)
                }
                Text(b.name)
                    .font(.system(size: 11.5, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                BoardTag(board: b)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background(selected ? P.goldSoft : P.card,
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(selected ? P.gold : P.rule, lineWidth: selected ? 2 : 1))
            .opacity(canEdit ? 1 : 0.62)
        }
        .buttonStyle(.plain)
        .disabled(!canEdit)
    }
}

/// "Two new free boards in 6h 12m" — its own view so the tick redraws the line
/// and not the three boxes above it.
struct BoardClock: View {
    let until: Double
    @EnvironmentObject var store: GameStore
    @ObservedObject private var shelf = BoardShelf.shared
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let left = until / 1000 - ctx.date.timeIntervalSince1970
            Text(left > 0 ? "Two new free boards in \(freeBoardCountdown(left))" : "New boards…")
                .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink3)
                .frame(maxWidth: .infinity)
                .task(id: left > 0) {
                    // The clock is also the trigger: nobody has to close and
                    // reopen the lobby to be given the new pair.
                    if left <= 0 { await shelf.load(store, force: true) }
                }
        }
    }
}

// MARK: - all of them

/// Every board there is, on three shelves, in the order somebody shops: what
/// is free right now, what they already own, and what still has a price.
struct BoardPickerSheet: View {
    var canEdit: Bool

    @EnvironmentObject var store: GameStore
    @ObservedObject private var shelf = BoardShelf.shared
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var shopping: BoardToBuy?

    private var current: String {
        store.state?.mapId ?? store.state?.settings.mapId ?? "classic"
    }

    var body: some View {
        let P = Palette.current(scheme)
        let free = shelf.boards.filter { $0.how == "house" || $0.how == "today" }
        let mine = shelf.boards.filter { $0.how == "owned" }
        let locked = shelf.boards.filter { $0.how == "locked" }

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let until = shelf.feed?.until, until > 0 {
                        BoardClock(until: until)
                            .padding(.top, 2)
                    }
                    shelfOf(free, "Free to play",
                            "Classic is free forever. Two more rotate every day — every board comes round once every \(shelf.feed?.cycleDays ?? 9) days.", P)
                    shelfOf(mine, "Yours", "Bought and kept. Play them whenever you like.", P)
                    shelfOf(locked, "In the store",
                            "Buy one and it is yours for good. Only the host needs to own a board — everyone at the table plays it.", P)
                }
                .padding(16)
            }
            .background(P.page.ignoresSafeArea())
            .navigationTitle("Boards")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    HStack(spacing: 4) {
                        Art.icon(.coin, size: 12)
                        Text("\(store.wallet?.coins ?? shelf.feed?.coins ?? 0)")
                            .font(.system(size: 13, weight: .heavy, design: .rounded))
                            .foregroundStyle(P.gold)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
        .task { await shelf.load(store, force: true) }
        .sheet(item: $shopping) { pick in
            if let b = shelf.board(pick.id) {
                BoardBuySheet(board: b) { bought in
                    if canEdit {
                        store.updateSettings(["mapId": bought])
                        dismiss()
                    }
                }
                .environmentObject(store)
            }
        }
    }

    @ViewBuilder
    private func shelfOf(_ list: [BoardSummary], _ title: String, _ sub: String, _ P: Palette) -> some View {
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: 9) {
                PanelTitle(title)
                Text(sub)
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2), spacing: 10) {
                    ForEach(list) { card($0, P) }
                }
            }
        }
    }

    @ViewBuilder private func card(_ b: BoardSummary, _ P: Palette) -> some View {
        let selected = b.id == current
        Button {
            SoundKit.shared.click()
            guard b.playable else { shopping = BoardToBuy(id: b.id); return }
            guard canEdit else { return }
            store.updateSettings(["mapId": b.id])
            dismiss()
        } label: {
            VStack(alignment: .leading, spacing: 7) {
                if let p = b.preview {
                    MiniBoard(preview: p, dim: !b.playable)
                        .padding(4)
                        .background(P.page, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                HStack(spacing: 5) {
                    Art.icon(mapGlyph(b.icon), size: 13, tint: P.ink2)
                    Text(b.name)
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                Text(b.description ?? "")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    Text("\(b.size) tiles")
                        .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
                    Spacer(minLength: 2)
                    BoardTag(board: b)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? P.goldSoft : P.card,
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(selected ? P.gold : P.rule, lineWidth: selected ? 2 : 1))
        }
        .buttonStyle(.plain)
        // A locked card is still live — it is the way into the shop.
        .disabled(!canEdit && b.playable)
        .opacity(!canEdit && b.playable ? 0.62 : 1)
    }
}

/// `sheet(item:)` wants something identifiable, and a board id is only a
/// string — teaching every String in the app to be Identifiable to get one
/// sheet open is too big a favour to ask of the language.
struct BoardToBuy: Identifiable {
    let id: String
}

/// The countdown to the next pair. Its own function rather than the one on
/// CupCard, which is private to it and counts to a different kind of deadline.
func freeBoardCountdown(_ seconds: TimeInterval) -> String {
    let left = Int(max(0, seconds).rounded())
    if left >= 86400 { return "\(left / 86400)d \(left % 86400 / 3600)h" }
    if left >= 3600 { return "\(left / 3600)h \(left % 3600 / 60)m" }
    return String(format: "%d:%02d", left / 60, left % 60)
}

// MARK: - unlocking one

/// Buying a board where you found it.
///
/// The shop is a whole tab away, and bouncing somebody out of the lobby, into
/// a tab, down a page and back again to spend six hundred coins is four steps
/// too many. So the price is paid here, next to the board it buys, with the
/// board itself as the thing being looked at.
struct BoardBuySheet: View {
    let board: BoardSummary
    /// Called once the wallet has actually moved, so the lobby can play it.
    var onBought: (String) -> Void

    @EnvironmentObject var store: GameStore
    @ObservedObject private var shelf = BoardShelf.shared
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var busy = false

    private struct Reply: Decodable {
        var ok: Bool?
        var error: String?
        var coins: Int?
        var owned: [String]?
    }

    var body: some View {
        let P = Palette.current(scheme)
        let coins = store.wallet?.coins ?? 0
        let short = max(0, board.price - coins)

        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let p = board.preview {
                        MiniBoard(preview: p)
                            .padding(8)
                            .background(P.page, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(P.rule, lineWidth: 1))
                            .frame(maxWidth: 260)
                    }
                    VStack(spacing: 5) {
                        Text(board.name)
                            .font(.system(size: 21, weight: .black, design: .rounded))
                            .foregroundStyle(P.ink)
                        Text(board.description ?? "")
                            .font(.system(size: 13, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink2)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    HStack(spacing: 14) {
                        stat("\(board.size)", "tiles", P)
                        if let st = board.streets { stat("\(st)", "streets", P) }
                        if let c = board.countries { stat("\(c)", "sets", P) }
                    }

                    Text("Buy it once and it is yours for good. Only the host needs to own a board — everyone at your table plays it with you.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 6)

                    Button {
                        Task { await buy() }
                    } label: {
                        HStack(spacing: 7) {
                            if busy { ProgressView().tint(P.accentInk) }
                            else { Art.icon(.coin, size: 16) }
                            Text(short > 0 ? "\(short) more coins needed" : "Unlock for \(board.price)")
                                .font(.system(size: 15, weight: .heavy, design: .rounded))
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(MMButtonStyle(kind: short > 0 ? .ghost : .primary))
                    .disabled(busy || short > 0)

                    Text(short > 0
                         ? "You have \(coins). Win a game, collect the daily reward, or top up in the Store tab."
                         : "You have \(coins) coins.")
                        .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
                }
                .padding(18)
                .frame(maxWidth: .infinity)
            }
            .background(P.page.ignoresSafeArea())
            .navigationTitle("Unlock a board")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Close") { dismiss() } }
            }
        }
    }

    private func stat(_ n: String, _ label: String, _ P: Palette) -> some View {
        VStack(spacing: 1) {
            Text(n).font(.system(size: 16, weight: .black, design: .rounded)).foregroundStyle(P.ink)
            Text(label).font(.system(size: 10, weight: .semibold, design: .rounded)).foregroundStyle(P.ink3)
        }
    }

    private func buy() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        SoundKit.shared.click()
        let reply: Reply? = try? await store.fetchJSON(
            "/api/store/buy", method: "POST",
            body: ["token": store.token, "itemId": board.storeId])
        guard reply?.ok == true else {
            store.showToast(reply?.error ?? "Couldn't reach the shop — try again.", isError: true)
            return
        }
        SoundKit.shared.buy()
        store.showToast("\(board.name) is yours!")
        if let c = reply?.coins { store.wallet?.coins = c }
        if store.wallet?.owned.contains(board.storeId) == false {
            store.wallet?.owned.append(board.storeId)
        }
        store.refreshWallet()
        await shelf.load(store, force: true)
        onBought(board.id)
        dismiss()
    }
}

// MARK: - the shelf inside the shop

/// Boards on the Store tab, alongside the pieces and the faces.
///
/// It is a shelf of its own rather than another `storeSection(kind:)` because
/// a board is not a piece: it is bought on the strength of the drawing, so the
/// card carries the board rather than an emoji — and it says out loud when one
/// is free today. The shop's job is to sell a board, not to sell somebody a
/// board they could have had for nothing this afternoon.
struct BoardStoreShelf: View {
    @EnvironmentObject var store: GameStore
    @ObservedObject private var shelf = BoardShelf.shared
    @Environment(\.colorScheme) private var scheme

    @State private var shopping: BoardToBuy?

    var body: some View {
        let P = Palette.current(scheme)
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 7) {
                Art.icon(.map, size: 15, tint: P.ink2)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Boards")
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                    Text("Classic is free forever, two more every day — buy one to keep it.")
                        .font(.system(size: 11.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2), spacing: 10) {
                ForEach(shelf.boards) { card($0, P) }
            }
        }
        .task { await shelf.load(store) }
        .sheet(item: $shopping) { pick in
            if let b = shelf.board(pick.id) {
                BoardBuySheet(board: b) { _ in }.environmentObject(store)
            }
        }
    }

    @ViewBuilder private func card(_ b: BoardSummary, _ P: Palette) -> some View {
        let owned = b.how == "owned" || b.how == "house"
        Button {
            guard !owned else { return }
            SoundKit.shared.click()
            shopping = BoardToBuy(id: b.id)
        } label: {
            VStack(spacing: 7) {
                ZStack(alignment: .topTrailing) {
                    if let p = b.preview {
                        MiniBoard(preview: p, dim: b.how == "locked")
                            .padding(4)
                            .background(P.page, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    if b.how == "today" {
                        Text("FREE TODAY")
                            .font(.system(size: 8, weight: .black, design: .rounded))
                            .foregroundStyle(.white)
                            .padding(.vertical, 2.5).padding(.horizontal, 6)
                            .background(P.good, in: Capsule())
                            .padding(5)
                    }
                }
                Text(b.name)
                    .font(.system(size: 12.5, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                HStack(spacing: 4) {
                    if !owned { Art.icon(.coin, size: 12) }
                    Text(b.how == "house" ? "Always free" : owned ? "✓ Yours" : "\(b.price)")
                        .font(.system(size: 10.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(owned ? P.ink3 : P.gold)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(10)
            .background(P.card, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).stroke(P.rule, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
