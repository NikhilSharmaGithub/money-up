// The pre-game landing screen: brand, nickname, create or
// join a room, an advanced server override, and the friends panel.

import SwiftUI
import UIKit
import AuthenticationServices

struct LandingView: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    @State private var joinCode = ""
    @State private var addCode = ""
    @State private var serverOpen = false
    @State private var selectedFlag = ""
    @State private var profile: ProfileInfo?
    @State private var me: MeInfo?
    @State private var authConfig: AuthConfig?
    @State private var signingIn = false
    @State private var friends: [FriendEntry] = []
    @State private var publicRooms: [PublicRoom] = []
    @State private var storeItems: [StoreItem] = []
    @State private var dmFriend: FriendEntry?
    @State private var rollingName = false
    /// The shop catalogue came back empty — offer a retry instead of an
    /// empty page that looks like there is nothing for sale.
    @State private var storeFailed = false
    /// SoundKit's own switch, mirrored so the toggle repaints the moment it
    /// is flipped rather than whenever the next redraw happens along.
    @AppStorage("mm.sound") private var soundOn = true
    /// Same key RootView reads — flipping a chip here recolours the whole
    /// app (open sheets included) on the spot.
    @AppStorage("mm.appearance") private var appearanceID = "system"
    @ObservedObject private var shop = CoinShop.shared

    struct PublicRoom: Codable, Identifiable {
        var id: String
        var players: Int
        var maxPlayers: Int
        var map: String
        /// "lobby" | "playing" — the list now carries tables already under way.
        var status: String?
        /// A lobby with a seat still free. Anything else you can only watch.
        var joinable: Bool?

        var canSit: Bool { joinable ?? (status != "playing" && players < maxPlayers) }
        var isPlaying: Bool { status == "playing" }
    }

    private struct AddFriendReply: Decodable {
        var ok: Bool?
        var error: String?
    }

    var body: some View {
        let P = Palette.current(scheme)

        // The home is a proper tabbed hub — on modern iOS the system renders
        // this bar as floating liquid glass over the felt.
        TabView {
            tabPage { playTab(P) }
                .tabItem { Label("Play", systemImage: "dice.fill") }

            tabPage { storeTab(P) }
                .tabItem { Label("Store", systemImage: "bag.fill") }

            tabPage { friendsTab(P) }
                .tabItem { Label("Friends", systemImage: "person.2.fill") }

            tabPage { historyTab(P) }
                .tabItem { Label("History", systemImage: "clock.fill") }

            tabPage { settingsTab(P) }
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .tint(P.red)
        .sheet(item: $dmFriend) { friend in
            DMSheet(friend: friend).environmentObject(store)
        }
        .onAppear {
            selectedFlag = store.flag
            store.refreshWallet()
        }
        .task {
            store.refreshAdsConfig()
            await loadAuthConfig()
            await refreshMe()
        }
    }

    /// Shared page chrome: scrolling column of cards over the felt.
    private func tabPage<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ScrollView {
            VStack(spacing: 18) {
                content()
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 32)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - tabs

    @ViewBuilder private func playTab(_ P: Palette) -> some View {
        // Quick Play does its own waiting — it must never grey out the other
        // ways into a game while it's looking.
        let busy = store.connection == .connecting && !store.quickSearching
        header(P)
        continueCard(P)
        accountCard(P)
        quickPlayCard(P)
        playCard(P, busy: busy)
        publicRoomsCard(P)
    }

    @ViewBuilder private func storeTab(_ P: Palette) -> some View {
        HStack(alignment: .top) {
            pageTitle("Store", "Win games, earn coins, dress your piece.", P)
            Spacer()
            HStack(spacing: 5) {
                Art.icon(.coin, size: 17)
                Text("\(store.wallet?.coins ?? 0)")
                    .font(.system(size: 17, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.gold)
            }
                .padding(.vertical, 6)
                .padding(.horizontal, 13)
                .background(P.goldSoft, in: Capsule())
                .overlay(Capsule().stroke(P.gold.opacity(0.6), lineWidth: 1))
                .padding(.top, 10)
        }
        .task { await loadStore() }

        Text("50 coins for winning a quick game, 100 when it goes long. Everything here is pure style — never pay-to-win.")
            .font(.system(size: 12, weight: .medium, design: .rounded))
            .foregroundStyle(P.ink3)
            .frame(maxWidth: .infinity, alignment: .leading)

        coinPacksSection(P)

        if storeItems.isEmpty {
            shopPlaceholder(P)
        } else {
            storeSection(.dice, "Token skins", "Your piece on the board.", kind: "token", P: P)
            storeSection(.people, "Avatars", "Your face in the player chip.", kind: "avatar", P: P)
        }
    }

    /// The shelves take a moment to arrive, and they can fail. Either way the
    /// tab has to say so — an empty Store reads as "nothing for sale".
    private func shopPlaceholder(_ P: Palette) -> some View {
        MMCard(padding: 18) {
            HStack(spacing: 10) {
                if storeFailed {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(P.bad)
                    Text("Couldn't load the shop.")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink2)
                    Spacer(minLength: 6)
                    Button("Try again") { Task { await loadStore() } }
                        .buttonStyle(MMButtonStyle(kind: .ghost))
                } else {
                    ProgressView().tint(P.red)
                    Text("Loading the shop…")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
                    Spacer(minLength: 6)
                }
            }
        }
    }

    /// Paid top-ups. The server describes the packs; whether they can actually
    /// be bought is StoreKit's call, and until the products exist in App Store
    /// Connect the section says so quietly rather than throwing an error.
    @ViewBuilder private func coinPacksSection(_ P: Palette) -> some View {
        if !shop.packs.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Art.icon(.coin, size: 13)
                    PanelTitle("Get coins")
                }
                // Until the App Store answers the rows are dead, so promising a
                // top-up would be a lie — say what is actually happening.
                Text(!shop.checked ? "Checking the App Store…"
                     : shop.onSale ? "Top up when the wins aren't coming fast enough."
                     : "Coin packs aren't available yet.")
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(spacing: 8) {
                ForEach(shop.packs) { pack in
                    packRow(pack, P)
                }
            }
        }
    }

    private func packRow(_ pack: CoinPack, _ P: Palette) -> some View {
        let live = shop.products[pack.productId] != nil
        let busy = shop.buying == pack.id

        return Button {
            Task { await shop.buy(pack, with: store) }
        } label: {
            HStack(spacing: 12) {
                Art.icon(packGlyph(pack.emoji), size: 32)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(pack.name)
                            .font(.system(size: 14.5, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
                            .lineLimit(1)
                        if pack.bonus > 0 {
                            Text("+\(pack.bonus)%")
                                .font(.system(size: 9, weight: .black))
                                .kerning(0.4)
                                .foregroundStyle(P.accentInk)
                                .padding(.vertical, 2.5)
                                .padding(.horizontal, 6)
                                .background(P.gold, in: Capsule())
                        }
                    }
                    HStack(spacing: 4) {
                        Art.icon(.coin, size: 13)
                        Text("\(pack.coins) coins")
                            .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink3)
                    }
                }
                Spacer(minLength: 6)
                if busy {
                    ProgressView().tint(P.red)
                } else {
                    Text(shop.priceLabel(for: pack))
                        .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(live ? P.accentInk : P.ink3)
                        .padding(.vertical, 7)
                        .padding(.horizontal, 13)
                        .background(live ? AnyShapeStyle(P.red) : AnyShapeStyle(P.sunken), in: Capsule())
                }
            }
            .padding(.vertical, 11)
            .padding(.horizontal, 13)
            .background(P.card, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).stroke(P.rule, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(!live || busy)
        .opacity(live ? 1 : 0.55)
    }

    @ViewBuilder private func storeSection(_ glyph: Glyph, _ title: String, _ sub: String,
                                           kind: String, P: Palette) -> some View {
        let items = storeItems.filter { $0.kind == kind }
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Art.icon(glyph, size: 13, tint: P.ink3)
                    PanelTitle(title)
                }
                Text(sub)
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                ForEach(items) { item in
                    storeCard(item, P)
                }
            }
        }
    }

    private func storeCard(_ item: StoreItem, _ P: Palette) -> some View {
        let owned = store.wallet?.owned.contains(item.id) ?? false
        let equipped = store.wallet?.equipped[item.kind] == item.id
        // What you can't afford yet reads as out of reach rather than looking
        // identical to everything else until the tap bounces back an error.
        let affordable = owned || (store.wallet?.coins ?? 0) >= item.price

        return Button {
            Task { await buyOrEquip(item, owned: owned, equipped: equipped) }
        } label: {
            VStack(spacing: 5) {
                Text(item.emoji).font(.system(size: 34))
                Text(item.name)
                    .font(.system(size: 12.5, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    if !owned { Art.icon(.coin, size: 12) }
                    Text(equipped ? "✓ Equipped" : owned ? "Tap to equip" : "\(item.price)")
                        .font(.system(size: 10.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(equipped ? P.good : owned ? P.ink3 : affordable ? P.gold : P.ink3)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
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

    private struct StoreReply: Decodable { var ok: Bool?; var error: String?; var coins: Int? }

    /// The cosmetics come from our own server, the coin packs from Apple. The
    /// App Store lookup can sit there for seconds on a cold launch, so fill the
    /// shelves first and let StoreKit catch up — otherwise the whole tab is
    /// blank while a purchase API nobody asked about finishes thinking.
    private func loadStore() async {
        store.refreshWallet()
        if storeItems.isEmpty {
            struct Catalog: Decodable { var items: [StoreItem] }
            let catalog: Catalog? = try? await store.fetchJSON("/api/store")
            storeItems = catalog?.items ?? []
            storeFailed = storeItems.isEmpty
        }
        await shop.load(store)
    }

    private func buyOrEquip(_ item: StoreItem, owned: Bool, equipped: Bool) async {
        SoundKit.shared.click()
        if !owned {
            let reply: StoreReply? = try? await store.fetchJSON(
                "/api/store/buy", method: "POST",
                body: ["token": store.token, "itemId": item.id])
            // A request that never landed must not read as a purchase: the
            // coins only moved if the server said so.
            guard reply?.ok == true else {
                store.showToast(reply?.error ?? "Couldn't reach the shop — try again.", isError: true)
                return
            }
            SoundKit.shared.buy()
            store.showToast("\(item.emoji) \(item.name) is yours!")
        }
        // buying auto-equips; tapping an equipped item takes it off
        var body: [String: Any] = ["token": store.token, "slot": item.kind]
        if !equipped { body["itemId"] = item.id }
        let worn: StoreReply? = try? await store.fetchJSON("/api/store/equip", method: "POST", body: body)
        if worn?.ok != true {
            store.showToast(worn?.error ?? "Couldn't change your look — try again.", isError: true)
        }
        store.refreshWallet()
    }

    @ViewBuilder private func friendsTab(_ P: Palette) -> some View {
        pageTitle("Friends", "Swap codes, chat, jump into their room.", P)
        friendsCard(P)
    }

    /// Two different things share this tab: tables still waiting for this
    /// device, and games already in the books. The unfinished ones come first
    /// — they are the only rows you can still do something about.
    @ViewBuilder private func historyTab(_ P: Palette) -> some View {
        pageTitle("History", "Games you can still finish, and the ones already played.", P)
        unfinishedSection(P)
        if store.matchHistory.isEmpty {
            if store.unfinishedGames.isEmpty {
                MMCard(padding: 22) {
                    VStack(spacing: 8) {
                        Art.icon(.dice, size: 38, tint: P.ink3)
                        Text("No games yet")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
                        Text("Play a match — your wins (and your bankruptcies) land here.")
                            .font(.system(size: 12.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        } else {
            sectionHeading(.trophy, "Played out", P)
            ForEach(store.matchHistory) { match in
                matchRow(match, P)
            }
        }
    }

    /// Every table this device left with a game still running on it. The
    /// server keeps the seat warm — a bot plays it — so each of these is a
    /// game to walk back into rather than a result to read.
    @ViewBuilder private func unfinishedSection(_ P: Palette) -> some View {
        if !store.unfinishedGames.isEmpty {
            sectionHeading(.door, "Still going without you", P)
            ForEach(store.unfinishedGames) { game in
                Button {
                    store.resume(game)
                } label: {
                    unfinishedRow(game, P)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func unfinishedRow(_ game: GameStore.UnfinishedGame, _ P: Palette) -> some View {
        MMCard(padding: 13) {
            HStack(spacing: 12) {
                Art.icon(mapGlyph(game.mapIcon), size: 26, tint: P.gold)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(game.mapName)
                            .font(.system(size: 14.5, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
                            .lineLimit(1)
                        Text(game.roomId.uppercased())
                            .font(.system(size: 9, weight: .black, design: .monospaced))
                            .kerning(0.8)
                            .foregroundStyle(P.ink2)
                            .padding(.vertical, 2.5)
                            .padding(.horizontal, 6)
                            .background(P.sunken, in: Capsule())
                    }
                    Text(game.players.joined(separator: ", "))
                        .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink2)
                        .lineLimit(1)
                    Text("Left \(game.leftAt.formatted(.relative(presentation: .named)))"
                         + (game.guests > 0 ? " · \(game.guests + 1) players on this device" : ""))
                        .font(.system(size: 10.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .lineLimit(1)
                }
                Spacer(minLength: 6)
                Text("Rejoin")
                    .font(.system(size: 12, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.accentInk)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 11)
                    .background(P.gold, in: Capsule())
            }
        }
    }

    private func sectionHeading(_ glyph: Glyph, _ text: String, _ P: Palette) -> some View {
        HStack(spacing: 6) {
            Art.icon(glyph, size: 13, tint: P.ink3)
            PanelTitle(text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 2)
    }

    @ViewBuilder private func settingsTab(_ P: Palette) -> some View {
        pageTitle("Settings", "Make the table yours.", P)
        profileCard(P)
        themeCard(P)
        appearanceCard(P)
        soundCard(P)
        serverCard(P)
        MMCard {
            Text("An original implementation of the classic property-trading board game. Not affiliated with any trademark holder.")
                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink3)
        }
    }

    private func pageTitle(_ title: String, _ sub: String, _ P: Palette) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 30, weight: .heavy, design: .rounded))
                .foregroundStyle(P.ink)
            Text(sub)
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 6)
    }

    private func matchRow(_ match: GameStore.MatchRecord, _ P: Palette) -> some View {
        // Records saved before the outcome was tracked only have the win flag.
        let unfinished = (match.outcome ?? (match.won ? "won" : "lost")) == "left"
        // A table nobody finished has no winner and no turn count to quote —
        // printing "Nobody · 0 turns" invents a result that never happened.
        let line = unfinished
            ? "Left before the end · \(match.players.count) players"
            : "\(match.winner) · \(match.players.count) players"
                + (match.turns > 0 ? " · \(match.turns) turns" : "")

        return MMCard(padding: 13) {
            HStack(spacing: 12) {
                Art.icon(mapGlyph(match.mapIcon), size: 26, tint: P.ink2)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(match.mapName)
                            .font(.system(size: 14.5, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
                            .lineLimit(1)
                        Text(unfinished ? "LEFT" : match.won ? "WON" : "LOST")
                            .font(.system(size: 8, weight: .black))
                            .kerning(0.8)
                            .foregroundStyle(match.won ? P.accentInk : P.ink3)
                            .padding(.vertical, 2.5)
                            .padding(.horizontal, 6)
                            .background(match.won ? AnyShapeStyle(P.gold) : AnyShapeStyle(P.sunken), in: Capsule())
                    }
                    HStack(spacing: 4) {
                        if !unfinished { Art.icon(.trophy, size: 12) }
                        Text(line)
                            .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink2)
                            .lineLimit(1)
                    }
                    Text(match.date.formatted(.relative(presentation: .named)))
                        .font(.system(size: 10.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                }
                Spacer()
                if !match.won {
                    Text(money(match.myWorth))
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundStyle(match.myWorth > 0 ? P.good : P.bad)
                }
            }
        }
    }

    /// Who you are at every table: name, flag and equipped look.
    private func profileCard(_ P: Palette) -> some View {
        MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    AvatarView(name: store.nickname.isEmpty ? "P" : store.nickname,
                               colorCSS: "#4ade80", flag: store.flag, size: 46,
                               emoji: equippedAvatarEmoji)
                        .task { await loadStore() }
                    VStack(alignment: .leading, spacing: 2) {
                        PanelTitle("Profile")
                        if let profile {
                            Text("Friend code \(profile.code)")
                                .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                                .foregroundStyle(P.ink3)
                        }
                    }
                    Spacer()
                    karmaBadge(P)
                }

                TextField("", text: $store.nickname,
                          prompt: Text("Your name").foregroundStyle(P.ink3))
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .onSubmit { Task { await loadProfile() } }
                    .padding(11)
                    .background(P.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                VStack(alignment: .leading, spacing: 6) {
                    Text("Country flag")
                        .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
                    flagGrid(P)
                }
            }
        }
    }

    /// Karma starts full and is only ever docked for walking out on a table
    /// that's still playing — so the number is really a promise to finish.
    private func karmaBadge(_ P: Palette) -> some View {
        let karma = store.wallet?.karma ?? 100
        let tint: Color = karma >= 80 ? P.good : karma >= 50 ? P.gold : P.bad
        return VStack(alignment: .trailing, spacing: 3) {
            HStack(spacing: 5) {
                Art.icon(.heart, size: 12)
                Text("\(karma) karma")
                    .font(.system(size: 12, weight: .heavy, design: .rounded))
                    .foregroundStyle(tint)
            }
                .padding(.vertical, 5)
                .padding(.horizontal, 10)
                .background(P.sunken, in: Capsule())
                .overlay(Capsule().stroke(tint.opacity(0.45), lineWidth: 1))
            Text("play to the end to keep it")
                .font(.system(size: 9.5, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink3)
        }
    }

    /// The avatar emoji currently equipped from the store, if any.
    private var equippedAvatarEmoji: String {
        guard let id = store.wallet?.equipped["avatar"],
              let item = storeItems.first(where: { $0.id == id }) else { return "" }
        return item.emoji
    }

    private func soundCard(_ P: Palette) -> some View {
        MMCard(padding: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    PanelTitle("Sound")
                    Text("Dice, coins and the little \"ishh\" when you pay rent.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                }
                Spacer()
                // Bound through @AppStorage on the same key SoundKit reads:
                // a plain get/set on the singleton leaves nothing for SwiftUI
                // to watch, so the switch only slid over on the next unrelated
                // redraw.
                Toggle("", isOn: Binding(
                    get: { soundOn },
                    set: { on in
                        soundOn = on
                        if on { SoundKit.shared.warmUp(); SoundKit.shared.click() }
                    }
                ))
                .labelsHidden()
                .tint(P.red)
            }
        }
    }

    // MARK: - brand header

    private func header(_ P: Palette) -> some View {
        VStack(spacing: 14) {
            LogoMark(size: 84)
                .padding(.top, 4)
                .padding(.bottom, 6)

            Wordmark(fontSize: 40)

            Text("Buy streets. Build hotels. Bankrupt your friends.")
                .font(.system(size: 14, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink2)
                .multilineTextAlignment(.center)

            // the numbers that sell the table
            HStack(spacing: 26) {
                stat("19", "BOARDS", P)
                stat("8", "PLAYERS", P)
                stat("∞", "BANKRUPTCIES", P)
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 6)
    }

    private func stat(_ value: String, _ label: String, _ P: Palette) -> some View {
        VStack(spacing: 1) {
            Text(value)
                .font(.system(size: 20, weight: .heavy, design: .rounded))
                .foregroundStyle(P.gold)
            Text(label)
                .font(.system(size: 9, weight: .bold))
                .kerning(1)
                .foregroundStyle(P.ink3)
        }
    }

    // MARK: - quick play

    /// The shortest path to a table: one tap and the server seats you wherever
    /// people are already waiting. It never traps anyone — while the request is
    /// in flight only this button waits, create and join stay live below.
    private func quickPlayCard(_ P: Palette) -> some View {
        let searching = store.quickSearching
        return MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 9) {
                Button {
                    Haptics.tap()
                    SoundKit.shared.click()
                    store.quickPlay()
                } label: {
                    HStack(spacing: 9) {
                        if searching {
                            ProgressView().tint(P.accentInk)
                        } else {
                            // "whoever else is playing right now" — and an ink
                            // glyph, because a yellow bolt on the gold button
                            // was the same colour as the button.
                            Art.icon(.people, size: 19, tint: P.accentInk)
                        }
                        Text(searching ? "Finding a table…" : "Play now")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(MMButtonStyle(kind: .primary, big: true))
                .disabled(searching)

                Text(searching
                     ? "Looking for a table with room…"
                     : "Straight into a game with whoever else is playing right now.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
        }
    }

    // MARK: - create / join

    private func playCard(_ P: Palette, busy: Bool) -> some View {
        MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    PanelTitle("Nickname")
                    HStack(spacing: 8) {
                        // Empty until the player types or taps the dice — a name
                        // we picked for them reads as their name, and they carry
                        // it to the table without ever choosing it.
                        TextField("", text: $store.nickname,
                                  prompt: Text("Your nickname").foregroundStyle(P.ink3))
                            .font(.system(size: 16, weight: .semibold, design: .rounded))
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                            .padding(12)
                            .background(P.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(P.rule, lineWidth: 1))

                        Button {
                            Task { await rollNickname() }
                        } label: {
                            Image(systemName: "die.face.5.fill")
                                .font(.system(size: 17, weight: .bold))
                                .frame(width: 24, height: 26)
                        }
                        .buttonStyle(MMButtonStyle(kind: .gold))
                        .disabled(rollingName)
                        .accessibilityLabel("Pick a random nickname")
                    }
                }

                MMIconButton(.dice, "Create a private game", kind: .ghost, big: true) {
                    store.createRoom()
                }
                    .disabled(busy)

                orDivider(P)

                HStack(spacing: 8) {
                    // Tidying the text inside the binding rather than in an
                    // onChange matters: writing the field back a frame later
                    // swallows whatever was typed in between, so a pasted or
                    // quickly typed code used to arrive with letters missing.
                    TextField("room code", text: Binding(
                        get: { joinCode },
                        set: { joinCode = $0.lowercased().filter { !$0.isWhitespace } }
                    ))
                        .font(.system(size: 16, weight: .bold, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.asciiCapable)
                        .onSubmit { joinTapped() }
                        .padding(12)
                        .background(P.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(P.rule, lineWidth: 1))

                    Button("Join") { joinTapped() }
                        .buttonStyle(MMButtonStyle(kind: .primary))
                        .disabled(busy || joinCode.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                if let err = store.joinError {
                    Text(err)
                        .font(.system(size: 12.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.bad)
                }
            }
        }
    }

    private func flagGrid(_ P: Palette) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 8), spacing: 6) {
            ForEach(MMStatic.flags, id: \.self) { f in
                let selected = selectedFlag == f
                Text(f)
                    .font(.system(size: 20))
                    .frame(maxWidth: .infinity)
                    .frame(height: 34)
                    .background(
                        selected ? P.redSoft : P.sunken,
                        in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .stroke(selected ? P.red : Color.clear, lineWidth: 1.5)
                    )
                    .contentShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .onTapGesture {
                        let next = selected ? "" : f
                        selectedFlag = next
                        store.setAppearance(flag: next)
                    }
            }
        }
    }

    private func orDivider(_ P: Palette) -> some View {
        HStack(spacing: 10) {
            Rectangle().fill(P.rule).frame(height: 1)
            Text("or join with a code")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink3)
                .fixedSize()
            Rectangle().fill(P.rule).frame(height: 1)
        }
    }

    /// A name for anyone who'd rather not think of one. The server owns the
    /// word lists; if it can't be reached, this device still has something to
    /// put in the field.
    private func rollNickname() async {
        rollingName = true
        defer { rollingName = false }
        SoundKit.shared.click()
        Haptics.tap()
        struct NameReply: Decodable { var name: String? }
        let reply: NameReply? = try? await store.fetchJSON("/api/name")
        let picked = (reply?.name ?? "").trimmingCharacters(in: .whitespaces)
        store.nickname = picked.isEmpty ? Self.offlineName() : picked
    }

    /// Same shape as server/names.js — two short words that fit a player chip.
    private static func offlineName() -> String {
        let adjectives = ["Lucky", "Bold", "Sneaky", "Royal", "Swift", "Golden",
                          "Silent", "Cheeky", "Grand", "Wild", "Clever", "Turbo"]
        let nouns = ["Tycoon", "Baron", "Mogul", "Trader", "Broker", "Hustler",
                     "Duke", "Tiger", "Rocket", "Ninja", "Seth", "Boss"]
        return "\(adjectives.randomElement() ?? "Lucky") \(nouns.randomElement() ?? "Seth")"
    }

    private func joinTapped() {
        let code = joinCode.trimmingCharacters(in: .whitespaces).lowercased()
        guard !code.isEmpty else { return }
        store.join(roomId: code)
    }

    // MARK: - continue last game

    /// The way back into the table you stepped away from — the server has been
    /// holding the seats (bots fill in while people are gone).
    @ViewBuilder
    private func continueCard(_ P: Palette) -> some View {
        // The shortcut is to the newest table still going — the same entry
        // that heads History's "still going without you" list, so the two can
        // never disagree about which game that is.
        if let latest = store.unfinishedGames.first {
            Button {
                store.resume(latest)
            } label: {
                HStack(spacing: 12) {
                    // The way back into the room you stepped out of.
                    Art.icon(.door, size: 24, tint: P.gold)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Continue game")
                            .font(.system(size: 16, weight: .heavy, design: .rounded))
                            .foregroundStyle(P.ink)
                        Text("Room \(latest.roomId) · \(latest.mapName)\(latest.guests > 0 ? " · \(latest.guests + 1) players on this device" : "")")
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink3)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(P.gold)
                }
                .padding(14)
                .background(P.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(P.gold.opacity(0.55), lineWidth: 1.5))
                .shadow(color: .black.opacity(scheme == .light ? 0.1 : 0.35), radius: 8, y: 3)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - table style

    private func themeCard(_ P: Palette) -> some View {
        MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                PanelTitle("Table style")
                ThemePicker()
            }
        }
    }

    // MARK: - appearance

    /// Light, dark, or follow the phone — which of the table style's two
    /// palettes the whole app wears. Three chips; the current one rings gold.
    private func appearanceCard(_ P: Palette) -> some View {
        let current = MMAppearance(rawValue: appearanceID) ?? .system
        return MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                PanelTitle("Appearance")
                HStack(spacing: 8) {
                    ForEach(MMAppearance.allCases, id: \.rawValue) { mode in
                        appearanceChip(mode, on: mode == current, P)
                    }
                }
                Text(current.caption)
                    .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
            .animation(.spring(duration: 0.25), value: appearanceID)
        }
    }

    private func appearanceChip(_ mode: MMAppearance, on: Bool, _ P: Palette) -> some View {
        Button {
            appearanceID = mode.rawValue
            Haptics.tap()
            SoundKit.shared.click()
        } label: {
            VStack(spacing: 6) {
                appearanceGlyph(mode, on: on, P)
                Text(mode.title)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(on ? P.ink : P.ink2)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(on ? AnyShapeStyle(P.goldSoft) : AnyShapeStyle(P.sunken),
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(on ? P.gold : P.rule, lineWidth: on ? 1.8 : 1)
            )
            .scaleEffect(on ? 1.03 : 1)
        }
        .buttonStyle(.plain)
    }

    /// Sun and moon keep their own colours (they are the app's drawn set);
    /// System wears a half-and-half disc — whatever the phone says goes.
    @ViewBuilder
    private func appearanceGlyph(_ mode: MMAppearance, on: Bool, _ P: Palette) -> some View {
        switch mode {
        case .light: Art.icon(.sun, size: 18)
        case .dark: Art.icon(.moon, size: 18)
        case .system:
            Image(systemName: "circle.lefthalf.filled")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(on ? P.gold : P.ink3)
                .frame(width: 18, height: 18)
        }
    }

    // MARK: - public rooms

    /// Open lobbies anyone can hop into — same list the web landing shows.
    ///
    /// The poller hangs off a VStack rather than a bare conditional: while the
    /// list is empty a Group collapses to nothing, an empty view never runs its
    /// task, and the card could then never appear at all.
    private func publicRoomsCard(_ P: Palette) -> some View {
        VStack(spacing: 0) {
            if !publicRooms.isEmpty {
                MMCard(padding: 16) {
                    VStack(alignment: .leading, spacing: 10) {
                        PanelTitle("Public rooms")
                        VStack(spacing: 8) {
                            ForEach(publicRooms) { room in
                                Button {
                                    store.join(roomId: room.id)
                                } label: {
                                    HStack(spacing: 10) {
                                        // The list carries games already under
                                        // way now, and those are a different
                                        // offer: a seat to sit in, or a table
                                        // to watch. Say which before the tap.
                                        Art.icon(room.canSit ? .globe : .eye, size: 20, tint: P.ink2)
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(room.map)
                                                .font(.system(size: 14, weight: .bold, design: .rounded))
                                                .foregroundStyle(P.ink)
                                            Text("\(room.players) of \(room.maxPlayers) players · \(room.id)"
                                                 + (room.canSit ? "" : room.isPlaying ? " · in play, watch only" : " · full"))
                                                .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                                                .foregroundStyle(P.ink3)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 12, weight: .bold))
                                            .foregroundStyle(P.ink3)
                                    }
                                    .padding(10)
                                    .background(P.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
        }
        .task {
            while !Task.isCancelled {
                let rooms: [PublicRoom]? = try? await store.fetchJSON("/api/rooms")
                publicRooms = rooms ?? []
                try? await Task.sleep(for: .seconds(8))
            }
        }
    }

    // MARK: - server override

    private func serverCard(_ P: Palette) -> some View {
        MMCard {
            DisclosureGroup(isExpanded: $serverOpen) {
                VStack(alignment: .leading, spacing: 10) {
                    // Nobody stumbling in here should have to guess what it
                    // does, or why their friends suddenly can't see them.
                    Text("Where this app looks for games. Leave it alone unless you are running your own server — pointing somewhere else hides your friends, coins and history.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .fixedSize(horizontal: false, vertical: true)

                    TextField("https://…", text: $store.serverURLString)
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .padding(11)
                        .background(P.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(P.rule, lineWidth: 1))

                    Button("Reset") { store.serverURLString = GameStore.defaultServer }
                        .buttonStyle(MMButtonStyle(kind: .ghost))
                }
                .padding(.top, 10)
            } label: {
                PanelTitle("Server")
            }
            .tint(P.ink3)
        }
    }

    // MARK: - friends

    private func friendsCard(_ P: Palette) -> some View {
        MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                PanelTitle("Friends")

                // Signing in ties your name + friend code to your Apple ID, so
                // a reinstall or a second device keeps the same identity.
                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = [.fullName]
                } onCompletion: { result in
                    switch result {
                    case .success(let auth):
                        guard let cred = auth.credential as? ASAuthorizationAppleIDCredential else { return }
                        let name = [cred.fullName?.givenName, cred.fullName?.familyName]
                            .compactMap { $0 }.joined(separator: " ")
                        Task {
                            struct Reply: Decodable { var ok: Bool?; var name: String?; var code: String? }
                            let reply: Reply? = try? await store.fetchJSON(
                                "/api/auth/apple", method: "POST",
                                body: ["token": store.token, "userId": cred.user, "name": name])
                            if reply?.ok == true {
                                if let n = reply?.name, !n.isEmpty { store.nickname = n }
                                store.showToast("Signed in with Apple")
                                await loadProfile()
                            } else {
                                store.showToast("Could not reach the server", isError: true)
                            }
                        }
                    case .failure:
                        store.showToast("Apple Sign-In was cancelled", isError: true)
                    }
                }
                .signInWithAppleButtonStyle(scheme == .light ? .black : .white)
                .frame(height: 44)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                if let profile {
                    HStack {
                        Text("Your code")
                            .font(.system(size: 13, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink2)
                        Spacer()
                        Button {
                            UIPasteboard.general.string = profile.code
                            store.showToast("Friend code copied")
                        } label: {
                            HStack(spacing: 6) {
                                Text(profile.code)
                                    .font(.system(size: 15, weight: .heavy, design: .monospaced))
                                    .kerning(2)
                                    .foregroundStyle(P.ink)
                                Image(systemName: "doc.on.doc")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(P.ink3)
                            }
                            .padding(.vertical, 7)
                            .padding(.horizontal, 12)
                            .background(P.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(P.rule, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }

                HStack(spacing: 8) {
                    // Same reason as the room code: sanitise on the way in, or
                    // fast typing loses characters to the write-back.
                    TextField("FRIEND CODE", text: Binding(
                        get: { addCode },
                        set: { addCode = String($0.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(6)) }
                    ))
                        .font(.system(size: 15, weight: .bold, design: .monospaced))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .keyboardType(.asciiCapable)
                        .onSubmit { Task { await addFriend() } }
                        .padding(11)
                        .background(P.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(P.rule, lineWidth: 1))

                    Button("Add") { Task { await addFriend() } }
                        .buttonStyle(MMButtonStyle(kind: .ghost))
                        .disabled(addCode.isEmpty)
                }

                if friends.isEmpty {
                    Text("No friends yet — share your code to play together.")
                        .font(.system(size: 12.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                } else {
                    VStack(spacing: 8) {
                        ForEach(friends) { entry in
                            friendRow(entry, P)
                        }
                    }
                }
            }
        }
        .task {
            await loadProfile()
            while !Task.isCancelled {
                await loadFriends()
                try? await Task.sleep(for: .seconds(10))
            }
        }
    }

    private func friendRow(_ entry: FriendEntry, _ P: Palette) -> some View {
        let status: (label: String, tint: Color) = switch entry.status ?? "offline" {
        case "lobby": ("in a lobby", P.gold)
        case "playing": ("in a game", P.good)
        default: ("offline", P.ink3)
        }
        // Their equipped face if they have one, their flag otherwise — the
        // same fallback chain the web friend list uses.
        let face = [entry.avatar ?? "", entry.flag ?? ""].first { !$0.isEmpty } ?? ""
        // Their game is already under way, so the seats are shut: promising a
        // seat and delivering a spectator's view reads as a broken button.
        let started = entry.status != "lobby"

        return HStack(spacing: 10) {
            // Their own face or flag if they picked one; a drawn stand-in if not.
            if face.isEmpty {
                Art.icon(.people, size: 20, tint: P.ink3)
            } else {
                Text(face).font(.system(size: 20))
            }

            VStack(alignment: .leading, spacing: 1) {
                Text(entry.name)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                Text(status.label)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(status.tint)
            }

            Spacer(minLength: 4)

            Button {
                dmFriend = entry
                Haptics.tap()
            } label: {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(P.ink2)
                    .frame(width: 32, height: 32)
                    .background(P.card, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Message \(entry.name)")

            if let roomId = entry.roomId {
                Button(started ? "Watch" : "Join") { store.join(roomId: roomId) }
                    .buttonStyle(MMButtonStyle(kind: started ? .ghost : .primary))
            }

            Button {
                Task { await dropFriend(entry) }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(P.ink3)
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(entry.name)")
        }
        .padding(10)
        .background(P.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: - friends REST

    // MARK: - signed-in identity

    /// Above Play now: sign-in buttons until an account is linked, then the
    /// account itself — photo, name and the numbers that follow it around.
    /// Signing in used to change nothing visible, which read as broken.
    @ViewBuilder private func accountCard(_ P: Palette) -> some View {
        if let me, me.signedIn {
            MMCard(padding: 12) {
                HStack(spacing: 11) {
                    profilePhoto(me, size: 44, P: P)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(me.name?.isEmpty == false ? me.name! : "Player")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
                            .lineLimit(1)
                        Text(me.email?.isEmpty == false ? me.email! : "Signed in with \(me.provider == "apple" ? "Apple" : "Google")")
                            .font(.system(size: 11.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .lineLimit(1)
                        HStack(spacing: 10) {
                            HStack(spacing: 3) {
                                Art.icon(.coin, size: 11)
                                Text("\(me.coins ?? 0)")
                            }
                            HStack(spacing: 3) {
                                Art.icon(.heart, size: 11)
                                Text("\(me.karma ?? 0)")
                            }
                            Text(me.code ?? "")
                        }
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(P.ink2)
                    }
                    Spacer()
                    Button("Sign out") { Task { await signOut() } }
                        .buttonStyle(MMButtonStyle(kind: .ghost))
                }
            }
        } else if authConfig?.googleReady == true {
            MMCard(padding: 12) {
                VStack(spacing: 8) {
                    Text("Keep your name, coins and friends on every device")
                        .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        Task { await googleSignInTapped() }
                    } label: {
                        HStack(spacing: 8) {
                            if signingIn { ProgressView().scaleEffect(0.8).tint(.black) }
                            else { GoogleG(size: 17) }
                            Text(signingIn ? "Signing in…" : "Sign in with Google")
                                .font(.system(size: 15.5, weight: .semibold, design: .rounded))
                                .foregroundStyle(Color.black.opacity(0.84))
                        }
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Color.black.opacity(0.12), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(signingIn)

                    SignInWithAppleButton(.signIn) { request in
                        request.requestedScopes = [.fullName]
                    } onCompletion: { result in
                        if case .success(let auth) = result,
                           let cred = auth.credential as? ASAuthorizationAppleIDCredential {
                            let name = [cred.fullName?.givenName, cred.fullName?.familyName]
                                .compactMap { $0 }.joined(separator: " ")
                            Task { await appleLinked(userId: cred.user, name: name) }
                        }
                    }
                    .signInWithAppleButtonStyle(scheme == .light ? .black : .white)
                    .frame(maxWidth: .infinity, minHeight: 46, maxHeight: 46)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        }
    }

    @ViewBuilder private func profilePhoto(_ me: MeInfo, size: CGFloat, P: Palette) -> some View {
        let initial = String((me.name ?? "?").trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
        ZStack {
            Circle().fill(P.sunken)
            if let pic = me.picture, let url = URL(string: pic) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Text(initial).font(.system(size: size * 0.42, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                }
            } else {
                Text(initial).font(.system(size: size * 0.42, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.ink)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(P.gold, lineWidth: 2))
    }

    private func refreshMe() async {
        me = try? await store.fetchJSON("/api/me?token=\(store.token)", raw: true)
    }

    private func loadAuthConfig() async {
        authConfig = try? await store.fetchJSON("/api/auth/config", raw: true)
    }

    private func googleSignInTapped() async {
        guard let clientId = authConfig?.appClientId else { return }
        signingIn = true
        defer { signingIn = false }
        do {
            let credential = try await GoogleSignInFlow.shared.signIn(clientId: clientId)
            struct Reply: Decodable { var ok: Bool?; var name: String?; var code: String? }
            let reply: Reply? = try? await store.fetchJSON(
                "/api/auth/google", method: "POST",
                body: ["token": store.token, "credential": credential])
            if reply?.ok == true {
                if let n = reply?.name, !n.isEmpty { store.nickname = n }
                store.showToast("Signed in with Google")
                await refreshMe()
            } else {
                store.showToast("The server could not verify the sign-in", isError: true)
            }
        } catch GoogleSignInFlow.Failure.cancelled {
            // Closing the sheet is an answer, not an error.
        } catch {
            store.showToast("Google sign-in did not complete", isError: true)
        }
    }

    private func appleLinked(userId: String, name: String) async {
        struct Reply: Decodable { var ok: Bool?; var name: String? }
        let reply: Reply? = try? await store.fetchJSON(
            "/api/auth/apple", method: "POST",
            body: ["token": store.token, "userId": userId, "name": name])
        if reply?.ok == true {
            if let n = reply?.name, !n.isEmpty { store.nickname = n }
            store.showToast("Signed in with Apple")
            await refreshMe()
        }
    }

    private func signOut() async {
        struct Reply: Decodable { var ok: Bool? }
        let _: Reply? = try? await store.fetchJSON(
            "/api/auth/logout", method: "POST", body: ["token": store.token])
        store.showToast("Signed out — coins and friends stay with this device")
        await refreshMe()
    }

    private func loadProfile() async {
        let body: [String: Any] = ["token": store.token, "name": store.nickname, "flag": store.flag]
        profile = try? await store.fetchJSON("/api/profile", method: "POST", body: body)
    }

    private func loadFriends() async {
        // GameStore.fetchJSON builds its URL with appending(path:), which
        // percent-encodes "?", so this query-string GET is issued directly.
        // A failed poll keeps whatever is on screen: blanking the list on a
        // blip tells the player their friends are gone, which they are not.
        guard let base = store.serverURL,
              var comps = URLComponents(url: base.appending(path: "/api/friends"),
                                        resolvingAgainstBaseURL: false) else { return }
        comps.queryItems = [URLQueryItem(name: "token", value: store.token)]
        guard let url = comps.url,
              let (data, _) = try? await URLSession.shared.data(from: url),
              let fresh = try? JSONDecoder().decode([FriendEntry].self, from: data) else { return }
        // Anyone you can actually walk in on floats to the top, exactly like
        // the web list — an offline crowd should never bury a live table.
        friends = fresh.sorted {
            ($0.roomId != nil ? 0 : 1, $0.name.lowercased()) < ($1.roomId != nil ? 0 : 1, $1.name.lowercased())
        }
    }

    private func addFriend() async {
        let code = addCode.trimmingCharacters(in: .whitespaces).uppercased()
        guard !code.isEmpty else { return }
        do {
            let reply: AddFriendReply = try await store.fetchJSON(
                "/api/friends", method: "POST",
                body: ["token": store.token, "code": code])
            if let error = reply.error {
                store.showToast(error, isError: true)
            } else {
                addCode = ""
                store.showToast("Friend added")
                await loadFriends()
            }
        } catch {
            store.showToast("Could not add that code", isError: true)
        }
    }

    /// Friendship is mutual, so dropping someone is the only way out of a code
    /// you gave away by mistake — the web list has always had this.
    private func dropFriend(_ entry: FriendEntry) async {
        Haptics.warn()
        friends.removeAll { $0.code == entry.code }
        let _: AddFriendReply? = try? await store.fetchJSON(
            "/api/friends/remove", method: "POST",
            body: ["token": store.token, "code": entry.code])
        await loadFriends()
    }
}

// MARK: - friend chat

/// A lightweight DM thread with one friend, polled over REST — the same chat
/// the web landing offers, so the conversation is shared across devices.
struct DMSheet: View {
    let friend: FriendEntry

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    @State private var messages: [DMessage] = []
    @State private var myCode = ""
    @State private var draft = ""

    private struct DMReply: Decodable {
        var messages: [DMessage]?
        var me: String?
        var error: String?
    }
    private struct SendReply: Decodable { var ok: Bool?; var error: String? }

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 6) {
                            if messages.isEmpty {
                                VStack(spacing: 6) {
                                    Art.icon(.chat, size: 26, tint: P.ink3)
                                    Text("Say hi")
                                        .font(.system(size: 13, weight: .medium, design: .rounded))
                                        .foregroundStyle(P.ink3)
                                }
                                .padding(.top, 30)
                            }
                            ForEach(messages) { msg in
                                bubble(msg, P)
                                    .id(msg.id)
                            }
                        }
                        .padding(12)
                    }
                    .onChange(of: messages.last?.id) { _, new in
                        guard let new else { return }
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(new, anchor: .bottom)
                        }
                    }
                }

                HStack(spacing: 8) {
                    TextField("Message \(friend.name)…", text: $draft)
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink)
                        .padding(.vertical, 9)
                        .padding(.horizontal, 14)
                        .background(P.sunken, in: Capsule())
                        .submitLabel(.send)
                        .onSubmit { Task { await send() } }

                    // Nothing to send is a dead tap, so let the button say so.
                    let sendable = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    Button {
                        Task { await send() }
                    } label: {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(sendable ? P.accentInk : P.ink3)
                            .frame(width: 36, height: 36)
                            .background(sendable ? AnyShapeStyle(P.red) : AnyShapeStyle(P.sunken), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!sendable)
                    .accessibilityLabel("Send")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
            .background(P.sheet.ignoresSafeArea())
            .navigationTitle("\(friend.flag?.isEmpty == false ? "\(friend.flag!) " : "")\(friend.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task {
            // poll while the sheet is up; the task dies with the sheet
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(2.5))
            }
        }
    }

    private func bubble(_ msg: DMessage, _ P: Palette) -> some View {
        let mine = msg.from == myCode
        return HStack {
            if mine { Spacer(minLength: 50) }
            Text(msg.text)
                .font(.system(size: 14.5, weight: .medium, design: .rounded))
                .foregroundStyle(mine ? P.accentInk : P.ink)
                .padding(.vertical, 8)
                .padding(.horizontal, 13)
                .background(mine ? AnyShapeStyle(P.red) : AnyShapeStyle(P.card),
                            in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            if !mine { Spacer(minLength: 50) }
        }
    }

    private func load() async {
        guard let base = store.serverURL,
              var comps = URLComponents(url: base.appending(path: "/api/dm"),
                                        resolvingAgainstBaseURL: false) else { return }
        comps.queryItems = [
            URLQueryItem(name: "token", value: store.token),
            URLQueryItem(name: "code", value: friend.code),
        ]
        guard let url = comps.url,
              let (data, _) = try? await URLSession.shared.data(from: url),
              let reply = try? JSONDecoder().decode(DMReply.self, from: data) else { return }
        if let me = reply.me { myCode = me }
        if let msgs = reply.messages { messages = msgs }
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        SoundKit.shared.click()
        let reply: SendReply? = try? await store.fetchJSON(
            "/api/dm", method: "POST",
            body: ["token": store.token, "code": friend.code, "text": text])
        if let error = reply?.error {
            store.showToast(error, isError: true)
        }
        await load()
    }
}
