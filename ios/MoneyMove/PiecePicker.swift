// The piece you play as, chosen where the question actually gets asked: in the
// lobby, in the seconds before kick-off, right under the nickname and colour.
//
// The Store tab has sold token skins all along, but a shop two screens away
// isn't where anyone wonders "which one am I?" — the table is. So the shelf
// comes to the seat: the plain coloured disc first (that's the default, and
// taking a skin back off has to be a real choice), then every skin there is.
// What you own you wear with one tap; what you don't shows its price and opens
// a small shop, rather than bouncing an error back at a player who only wanted
// to look.

import SwiftUI

// MARK: - the shelf, fetched once

/// GET /api/store, held for the whole app run and remembered between launches.
///
/// The lobby can't afford a spinner where the chips go: the row has to be its
/// full height from the first frame or the seat list above it hops when the
/// catalogue lands. So the last shelf we saw is written to defaults and read
/// back instantly on the next launch — prices and emoji change about as often
/// as the app ships.
@MainActor
final class PieceCatalog: ObservableObject {
    static let shared = PieceCatalog()

    @Published private(set) var items: [StoreItem] = []
    /// The last fetch came back empty-handed and nothing was cached. The row
    /// reads this to offer a retry instead of holding four grey discs out
    /// forever, which is what "loading" looks like once it stops being true.
    @Published private(set) var failed = false
    private var fetching: Task<Void, Never>?
    private static let cacheKey = "mm.shelf"

    private init() {
        if let data = UserDefaults.standard.data(forKey: Self.cacheKey),
           let saved = try? JSONDecoder().decode([StoreItem].self, from: data) {
            items = saved
        }
    }

    /// Pieces only — the avatars on the same shelf belong to the player chip.
    var tokens: [StoreItem] { items.filter { $0.kind == "token" } }

    /// One fetch serves every lobby this run. A miss leaves the cached shelf
    /// standing, clears the flight so the next lobby — or a tap on the retry
    /// chip — can ask again, and says so.
    func load(_ store: GameStore) async {
        // Already asked and answered: a finished fetch is the answer, and
        // awaiting it again returns at once rather than re-flagging a load
        // nothing is going to finish.
        if let inFlight = fetching { return await inFlight.value }
        failed = false
        let task = Task { [weak self] in
            struct Catalog: Decodable { var items: [StoreItem] }
            let catalog: Catalog? = try? await store.fetchJSON("/api/store")
            guard let fresh = catalog?.items, !fresh.isEmpty else {
                self?.fetching = nil
                self?.failed = true
                return
            }
            self?.adopt(fresh)
        }
        fetching = task
        await task.value
    }

    /// The Store tab loads the same catalogue; whoever gets there first fills
    /// the shelf for both.
    func adopt(_ fresh: [StoreItem]) {
        guard !fresh.isEmpty else { return }
        items = fresh
        failed = false
        if let data = try? JSONEncoder().encode(fresh) {
            UserDefaults.standard.set(data, forKey: Self.cacheKey)
        }
    }
}

// MARK: - buying and wearing

/// The one path everything cosmetic goes down, whichever screen the tap came
/// from — the Store tab's grid and the lobby's piece row share it, so a change
/// of look means the same thing in both places.
@MainActor
enum Cosmetics {
    private struct Reply: Decodable { var ok: Bool?; var error: String?; var coins: Int? }

    /// POST /api/store/equip. A nil id takes the slot off again. The server
    /// restyles the piece live if you're already sitting at a table, so the
    /// board catches up on the next state push.
    @discardableResult
    static func wear(_ itemId: String?, slot: String, store: GameStore) async -> Bool {
        // Show it the instant it's tapped — and put the old one straight back
        // if the server never agreed. The wallet refresh below is the real
        // answer, but it gives up silently when the network is down, so a
        // failed equip must undo its own guess or the gold ring ends up on a
        // piece the board isn't wearing. Nil clears the slot, exactly as the
        // server's own unequip does, so the guess and the truth match.
        let previous = store.wallet?.equipped[slot]
        store.wallet?.equipped[slot] = itemId

        var body: [String: Any] = ["token": store.token, "slot": slot]
        if let itemId { body["itemId"] = itemId }
        let worn: Reply? = try? await store.fetchJSON("/api/store/equip", method: "POST", body: body)
        if worn?.ok != true {
            store.wallet?.equipped[slot] = previous
            store.showToast(worn?.error ?? "Couldn't change your look — try again.", isError: true)
        }
        store.refreshWallet()
        return worn?.ok == true
    }

    /// Buy it if it isn't yours yet, then wear it — or take it off, if you
    /// tapped the thing you're already wearing.
    @discardableResult
    static func buyOrEquip(_ item: StoreItem, owned: Bool, equipped: Bool,
                           store: GameStore) async -> Bool {
        SoundKit.shared.click()
        if !owned {
            let reply: Reply? = try? await store.fetchJSON(
                "/api/store/buy", method: "POST",
                body: ["token": store.token, "itemId": item.id])
            // A request that never landed must not read as a purchase: the
            // coins only moved if the server said so.
            guard reply?.ok == true else {
                store.showToast(reply?.error ?? "Couldn't reach the shop — try again.", isError: true)
                return false
            }
            SoundKit.shared.buy()
            store.showToast("\(item.emoji) \(item.name) is yours!")
            // The shelf redraws as owned before the wallet round-trip returns.
            if store.wallet?.owned.contains(item.id) == false {
                store.wallet?.owned.append(item.id)
            }
            if let coins = reply?.coins { store.wallet?.coins = coins }
        }
        // Buying auto-equips; tapping an equipped item takes it off. A board
        // is worn by the table rather than by the player, so it has no slot to
        // go in — and asking the server to put one in a slot that does not
        // exist is a round trip that can only ever come back an error.
        guard item.kind == "token" || item.kind == "avatar" else { return true }
        return await wear(equipped ? nil : item.id, slot: item.kind, store: store)
    }
}

// MARK: - the row in the lobby

/// A horizontal shelf of pieces for the seat you're about to play. Owned ones
/// equip on tap and ring gold; the rest wear their price and open the shop.
struct PiecePicker: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @ObservedObject private var catalog = PieceCatalog.shared

    /// The piece someone tapped but doesn't own yet — the shop opens on it.
    @State private var shopping: StoreItem?
    /// The piece mid-flight, so an impatient second tap can't race the first.
    @State private var busy: String?

    private static let disc: CGFloat = 46
    /// Chip and caption are both fixed, so the row is exactly as tall before
    /// the catalogue arrives as after it.
    private static let rowHeight: CGFloat = 78

    var body: some View {
        let P = Palette.current(scheme)
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                PanelTitle("Your piece")
                Spacer(minLength: 6)
                HStack(spacing: 4) {
                    Art.icon(.coin, size: 11)
                    Text("\(store.wallet?.coins ?? 0)")
                        .font(.system(size: 11.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.gold)
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 9) {
                    plainChip(P)
                    ForEach(catalog.tokens) { item in
                        skinChip(item, P)
                    }
                    // Nothing cached yet: hold the shape of the shelf rather
                    // than leaving a gap that fills in with a jolt — and once
                    // the fetch has actually failed, say so with something to
                    // tap, because grey discs that never resolve are the one
                    // thing worse than a slow shelf.
                    if catalog.tokens.isEmpty {
                        if catalog.failed {
                            retryChip(P)
                        } else {
                            ForEach(0..<4, id: \.self) { _ in ghostChip(P) }
                        }
                    }
                }
                .padding(.vertical, 4)
                .padding(.horizontal, 2)
            }
            .frame(height: Self.rowHeight)
            .scrollBounceBehavior(.basedOnSize)
        }
        .task {
            store.refreshWallet()
            await catalog.load(store)
        }
        .sheet(item: $shopping) { item in
            PieceShopSheet(focus: item).environmentObject(store)
        }
    }

    // MARK: chips

    /// What the wallet says is on the board right now. Empty means the plain
    /// disc — the look every player starts the game with.
    private var equippedId: String { store.wallet?.equipped["token"] ?? "" }

    private var myColour: String { store.me?.color ?? MMStatic.playerColors[0] }

    private var initial: String {
        let name = store.me?.name ?? store.nickname
        return String(name.prefix(1)).uppercased()
    }

    /// The coloured disc with your initial: no skin, and the thing a player
    /// taps to go back to plain after wearing one.
    private func plainChip(_ P: Palette) -> some View {
        chip(emoji: "", label: "Classic", price: nil,
             selected: equippedId.isEmpty, id: "", P: P) {
            Task { await equip(nil, id: "") }
        }
    }

    private func skinChip(_ item: StoreItem, _ P: Palette) -> some View {
        let owned = store.wallet?.owned.contains(item.id) ?? false
        return chip(emoji: item.emoji, label: item.name, price: owned ? nil : item.price,
                    selected: equippedId == item.id, id: item.id, P: P) {
            guard owned else {
                // Not yours yet — that's a shop trip, not a failed tap.
                SoundKit.shared.click()
                shopping = item
                return
            }
            Task { await equip(item.id, id: item.id) }
        }
    }

    /// The shelf never arrived and there was none saved from last time. One
    /// tap asks again — the lobby is no place to be stuck with no pieces.
    private func retryChip(_ P: Palette) -> some View {
        Button {
            SoundKit.shared.click()
            Task { await catalog.load(store) }
        } label: {
            VStack(spacing: 5) {
                Art.icon(.replay, size: 19, tint: P.ink2)
                    .frame(width: Self.disc, height: Self.disc)
                    .background(P.sunken, in: Circle())
                    .overlay(Circle().stroke(P.rule, lineWidth: 1))
                Text("Try again")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink2)
                    .lineLimit(1)
                    .frame(height: 13)
            }
            .frame(width: 60)
        }
        .buttonStyle(.plain)
    }

    /// A placeholder while the shelf is still in the post.
    private func ghostChip(_ P: Palette) -> some View {
        VStack(spacing: 5) {
            Circle()
                .fill(P.sunken)
                .frame(width: Self.disc, height: Self.disc)
            Color.clear.frame(height: 13)
        }
        .frame(width: 60)
        .opacity(0.6)
    }

    private func chip(emoji: String, label: String, price: Int?, selected: Bool,
                      id: String, P: Palette, action: @escaping () -> Void) -> some View {
        let owned = price == nil
        return Button(action: action) {
            VStack(spacing: 5) {
                ZStack {
                    if emoji.isEmpty {
                        Text(initial)
                            .font(.system(size: 18, weight: .black, design: .rounded))
                            .foregroundStyle(.white)
                    } else {
                        // Store skins are the player's own chosen emoji — the
                        // one place in the chrome where emoji is the content.
                        Text(emoji)
                            .font(.system(size: 25))
                            .opacity(owned ? 1 : 0.55)
                            .grayscale(owned ? 0 : 0.8)
                    }
                    if busy == id {
                        Circle().fill(.black.opacity(0.35))
                        ProgressView().tint(.white).scaleEffect(0.7)
                    }
                }
                .frame(width: Self.disc, height: Self.disc)
                .background(owned ? AnyShapeStyle(Color(css: myColour)) : AnyShapeStyle(P.sunken),
                            in: Circle())
                .overlay(
                    Circle().stroke(selected ? P.gold : P.rule,
                                    lineWidth: selected ? 2.5 : 1)
                )
                .shadow(color: .black.opacity(owned ? 0.28 : 0), radius: 3, y: 2)

                caption(label: label, price: price, selected: selected, P)
            }
            .frame(width: 60)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private func caption(label: String, price: Int?, selected: Bool,
                                      _ P: Palette) -> some View {
        HStack(spacing: 2.5) {
            if let price {
                Art.icon(.coin, size: 10)
                Text("\(price)")
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.ink3)
            } else {
                Text(label)
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(selected ? P.gold : P.ink2)
                    .lineLimit(1)
            }
        }
        .frame(height: 13)
    }

    // MARK: acting

    private func equip(_ itemId: String?, id: String) async {
        guard busy == nil else { return }
        busy = id
        SoundKit.shared.click()
        await Cosmetics.wear(itemId, slot: "token", store: store)
        busy = nil
    }
}

// MARK: - the little shop behind an unowned piece

/// Opened by tapping a piece you don't own. It leads with the one you tapped —
/// that's the piece you came for — and lays the rest of the shelf out under it,
/// so the lobby never has to send anyone back to the home screen mid-lobby.
struct PieceShopSheet: View {
    /// Which piece the sheet is about. It moves: tapping something below that
    /// costs more than you have brings it up here, where the price has room to
    /// explain itself, instead of firing a purchase that can only bounce.
    @State private var focus: StoreItem
    init(focus: StoreItem) { _focus = State(initialValue: focus) }

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var catalog = PieceCatalog.shared

    @State private var buying: String?

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        hero(P).id("hero")
                        if catalog.tokens.count > 1 {
                            PanelTitle("The rest of the shelf")
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10),
                                                     count: 3), spacing: 10) {
                                ForEach(catalog.tokens.filter { $0.id != focus.id }) { item in
                                    card(item, P)
                                }
                            }
                        }
                        Text("Coins come from your daily pick-up on the Play tab, and from winning. Every piece here is pure style — never pay-to-win.")
                            .font(.system(size: 11.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                    }
                    .padding(16)
                }
                // A piece promoted from three rows down is no use announced
                // off-screen — the tapped card leaves the grid, so carry the
                // eye up to where it went.
                .onChange(of: focus.id) { _, _ in
                    withAnimation(.easeOut(duration: 0.22)) { proxy.scrollTo("hero", anchor: .top) }
                }
                .background(P.sheet)
                .navigationTitle("Pick your piece")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    // MARK: the piece they tapped

    private func hero(_ P: Palette) -> some View {
        let owned = store.wallet?.owned.contains(focus.id) ?? false
        let coins = store.wallet?.coins ?? 0
        let short = max(0, focus.price - coins)

        return MMCard(padding: 16) {
            VStack(spacing: 10) {
                Text(focus.emoji).font(.system(size: 58))
                Text(focus.name)
                    .font(.system(size: 19, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.ink)

                if owned {
                    Text("Yours — wear it whenever you like.")
                        .font(.system(size: 12.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                } else if short > 0 {
                    // Nothing to tap yet, so say the number plainly instead of
                    // offering a button that can only fail.
                    HStack(spacing: 5) {
                        Art.icon(.coin, size: 14)
                        Text("\(short) more coin\(short == 1 ? "" : "s") to go — you have \(coins)")
                            .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink3)
                    }
                }

                if buying == focus.id {
                    ProgressView().tint(P.red).frame(height: 44)
                } else if owned {
                    let worn = store.wallet?.equipped["token"] == focus.id
                    Button(worn ? "✓  Wearing it" : "Wear this piece") {
                        Task { await buy(focus, owned: true) }
                    }
                    .buttonStyle(MMButtonStyle(kind: worn ? .ghost : .gold, big: true))
                    .disabled(worn)
                } else if short == 0 {
                    MMIconButton(.coin, "Buy for \(focus.price)", kind: .gold, big: true) {
                        Task { await buy(focus, owned: false) }
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: everything else on the shelf

    private func card(_ item: StoreItem, _ P: Palette) -> some View {
        let owned = store.wallet?.owned.contains(item.id) ?? false
        let equipped = store.wallet?.equipped["token"] == item.id
        let affordable = owned || (store.wallet?.coins ?? 0) >= item.price

        return Button {
            guard owned || affordable else {
                // Out of reach today — promote it to the hero, which says how
                // many coins short you are. A tap that only ever returns
                // "Not enough coins" isn't an answer, it's a door slammed.
                SoundKit.shared.click()
                withAnimation(.easeOut(duration: 0.18)) { focus = item }
                return
            }
            Task { await buy(item, owned: owned) }
        } label: {
            VStack(spacing: 5) {
                Text(item.emoji).font(.system(size: 32))
                Text(item.name)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    if !owned { Art.icon(.coin, size: 11) }
                    Text(equipped ? "✓ Worn" : owned ? "Tap to wear" : "\(item.price)")
                        .font(.system(size: 10, weight: .heavy, design: .rounded))
                        .foregroundStyle(equipped ? P.good : owned ? P.ink3 : affordable ? P.gold : P.ink3)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(equipped ? P.goldSoft : P.card,
                        in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .stroke(equipped ? P.gold : P.rule, lineWidth: equipped ? 1.5 : 1)
            )
            .opacity(affordable ? 1 : 0.55)
        }
        .buttonStyle(.plain)
    }

    /// Buying here always ends with the piece worn — you came to change your
    /// piece, not to shop. Only an already-worn tap takes it back off.
    private func buy(_ item: StoreItem, owned: Bool) async {
        guard buying == nil else { return }
        buying = item.id
        let equipped = store.wallet?.equipped["token"] == item.id
        await Cosmetics.buyOrEquip(item, owned: owned, equipped: equipped, store: store)
        buying = nil
    }
}
