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
    @State private var friends: [FriendEntry] = []
    @State private var publicRooms: [PublicRoom] = []
    @State private var storeItems: [StoreItem] = []
    @State private var dmFriend: FriendEntry?
    @State private var rollingName = false
    @ObservedObject private var shop = CoinShop.shared
    @AppStorage("mm.phone") private var phone = ""

    struct PublicRoom: Codable, Identifiable {
        var id: String
        var players: Int
        var maxPlayers: Int
        var map: String
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
        let busy = store.connection == .connecting
        header(P)
        continueCard(P)
        playCard(P, busy: busy)
        publicRoomsCard(P)
    }

    @ViewBuilder private func storeTab(_ P: Palette) -> some View {
        HStack(alignment: .top) {
            pageTitle("Store", "Win games, earn coins, dress your piece.", P)
            Spacer()
            Text("🪙 \(store.wallet?.coins ?? 0)")
                .font(.system(size: 17, weight: .heavy, design: .rounded))
                .foregroundStyle(P.gold)
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

        storeSection("🎲 Token skins", "Your piece on the board.", kind: "token", P: P)
        storeSection("🙂 Avatars", "Your face in the player chip.", kind: "avatar", P: P)
    }

    /// Paid top-ups. The server describes the packs; whether they can actually
    /// be bought is StoreKit's call, and until the products exist in App Store
    /// Connect the section says so quietly rather than throwing an error.
    @ViewBuilder private func coinPacksSection(_ P: Palette) -> some View {
        if !shop.packs.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                PanelTitle("🪙 Get coins")
                Text(shop.checked && !shop.onSale
                     ? "Coin packs aren't available yet."
                     : "Top up when the wins aren't coming fast enough.")
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
                Text(pack.emoji).font(.system(size: 30))
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
                    Text("🪙 \(pack.coins) coins")
                        .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
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

    @ViewBuilder private func storeSection(_ title: String, _ sub: String, kind: String, P: Palette) -> some View {
        let items = storeItems.filter { $0.kind == kind }
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                PanelTitle(title)
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

        return Button {
            Task { await buyOrEquip(item, owned: owned, equipped: equipped) }
        } label: {
            VStack(spacing: 5) {
                Text(item.emoji).font(.system(size: 34))
                Text(item.name)
                    .font(.system(size: 12.5, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                Text(equipped ? "✓ Equipped" : owned ? "Tap to equip" : "🪙 \(item.price)")
                    .font(.system(size: 10.5, weight: .heavy, design: .rounded))
                    .foregroundStyle(equipped ? P.good : owned ? P.ink3 : P.gold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(equipped ? P.goldSoft : P.card,
                        in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .stroke(equipped ? P.gold : P.rule, lineWidth: equipped ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
    }

    private struct StoreReply: Decodable { var ok: Bool?; var error: String?; var coins: Int? }

    private func loadStore() async {
        store.refreshWallet()
        await shop.load(store)
        guard storeItems.isEmpty else { return }
        struct Catalog: Decodable { var items: [StoreItem] }
        let catalog: Catalog? = try? await store.fetchJSON("/api/store")
        storeItems = catalog?.items ?? []
    }

    private func buyOrEquip(_ item: StoreItem, owned: Bool, equipped: Bool) async {
        SoundKit.shared.click()
        if !owned {
            let reply: StoreReply? = try? await store.fetchJSON(
                "/api/store/buy", method: "POST",
                body: ["token": store.token, "itemId": item.id])
            if let error = reply?.error {
                store.showToast(error, isError: true)
                return
            }
            SoundKit.shared.buy()
            store.showToast("\(item.emoji) \(item.name) is yours!")
        }
        // buying auto-equips; tapping an equipped item takes it off
        var body: [String: Any] = ["token": store.token, "slot": item.kind]
        if !equipped { body["itemId"] = item.id }
        let _: StoreReply? = try? await store.fetchJSON("/api/store/equip", method: "POST", body: body)
        store.refreshWallet()
    }

    @ViewBuilder private func friendsTab(_ P: Palette) -> some View {
        pageTitle("Friends", "Swap codes, chat, jump into their room.", P)
        friendsCard(P)
    }

    @ViewBuilder private func historyTab(_ P: Palette) -> some View {
        pageTitle("History", "Every game this device has finished.", P)
        if store.matchHistory.isEmpty {
            MMCard(padding: 22) {
                VStack(spacing: 8) {
                    Text("🎲").font(.system(size: 36))
                    Text("No games finished yet")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(P.ink)
                    Text("Play a match — your wins (and your bankruptcies) land here.")
                        .font(.system(size: 12.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
            }
        } else {
            ForEach(store.matchHistory) { match in
                matchRow(match, P)
            }
        }
    }

    @ViewBuilder private func settingsTab(_ P: Palette) -> some View {
        pageTitle("Settings", "Make the table yours.", P)
        profileCard(P)
        themeCard(P)
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
        MMCard(padding: 13) {
            HStack(spacing: 12) {
                Text(match.mapIcon).font(.system(size: 26))
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(match.mapName)
                            .font(.system(size: 14.5, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink)
                            .lineLimit(1)
                        Text(match.won ? "WON" : "LOST")
                            .font(.system(size: 8, weight: .black))
                            .kerning(0.8)
                            .foregroundStyle(match.won ? P.accentInk : P.ink3)
                            .padding(.vertical, 2.5)
                            .padding(.horizontal, 6)
                            .background(match.won ? AnyShapeStyle(P.gold) : AnyShapeStyle(P.sunken), in: Capsule())
                    }
                    Text("🏆 \(match.winner) · \(match.players.count) players · \(match.turns) turns")
                        .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink2)
                        .lineLimit(1)
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

    /// Who you are at every table: name, flag, equipped look, and a phone
    /// number that stays on this device only.
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

                TextField("Your name", text: $store.nickname)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .onSubmit { Task { await loadProfile() } }
                    .padding(11)
                    .background(P.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                TextField("Phone (stays on this device)", text: $phone)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .keyboardType(.phonePad)
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
            Text("🤝 \(karma) karma")
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .foregroundStyle(tint)
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
                Toggle("", isOn: Binding(
                    get: { SoundKit.shared.enabled },
                    set: { on in
                        SoundKit.shared.enabled = on
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

    // MARK: - create / join

    private func playCard(_ P: Palette, busy: Bool) -> some View {
        MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    PanelTitle("Nickname")
                    HStack(spacing: 8) {
                        TextField("Your nickname", text: $store.nickname)
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

                Button("🎲  Create a private game") { store.createRoom() }
                    .buttonStyle(MMButtonStyle(kind: .primary, big: true))
                    .disabled(busy)

                orDivider(P)

                HStack(spacing: 8) {
                    TextField("room code", text: $joinCode)
                        .font(.system(size: 16, weight: .bold, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.asciiCapable)
                        .onSubmit { joinTapped() }
                        .onChange(of: joinCode) { _, new in
                            let cleaned = new.lowercased().filter { !$0.isWhitespace }
                            if cleaned != new { joinCode = cleaned }
                        }
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
        if !store.lastRoom.isEmpty {
            Button {
                store.continueGame()
            } label: {
                HStack(spacing: 12) {
                    Text("▶️").font(.system(size: 22))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Continue game")
                            .font(.system(size: 16, weight: .heavy, design: .rounded))
                            .foregroundStyle(P.ink)
                        Text("Room \(store.lastRoom)\(store.lastGuests > 0 ? " · \(store.lastGuests + 1) players on this device" : "")")
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

    // MARK: - public rooms

    /// Open lobbies anyone can hop into — same list the web landing shows.
    @ViewBuilder
    private func publicRoomsCard(_ P: Palette) -> some View {
        Group {
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
                                        Text("🌐").font(.system(size: 18))
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(room.map)
                                                .font(.system(size: 14, weight: .bold, design: .rounded))
                                                .foregroundStyle(P.ink)
                                            Text("\(room.players) of \(room.maxPlayers) players · \(room.id)")
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
                    TextField("FRIEND CODE", text: $addCode)
                        .font(.system(size: 15, weight: .bold, design: .monospaced))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .keyboardType(.asciiCapable)
                        .onChange(of: addCode) { _, new in
                            let cleaned = String(new.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(6))
                            if cleaned != new { addCode = cleaned }
                        }
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
        let flag = entry.flag ?? ""

        return HStack(spacing: 10) {
            Text(flag.isEmpty ? "🌍" : flag)
                .font(.system(size: 20))

            VStack(alignment: .leading, spacing: 1) {
                Text(entry.name)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                Text(status.label)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(status.tint)
            }

            Spacer()

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

            if let roomId = entry.roomId {
                Button("Join") { store.join(roomId: roomId) }
                    .buttonStyle(MMButtonStyle(kind: .primary))
            }
        }
        .padding(10)
        .background(P.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: - friends REST

    private func loadProfile() async {
        let body: [String: Any] = ["token": store.token, "name": store.nickname, "flag": store.flag]
        profile = try? await store.fetchJSON("/api/profile", method: "POST", body: body)
    }

    private func loadFriends() async {
        // GameStore.fetchJSON builds its URL with appending(path:), which
        // percent-encodes "?", so this query-string GET is issued directly.
        guard let base = store.serverURL,
              var comps = URLComponents(url: base.appending(path: "/api/friends"),
                                        resolvingAgainstBaseURL: false) else {
            friends = []
            return
        }
        comps.queryItems = [URLQueryItem(name: "token", value: store.token)]
        guard let url = comps.url else {
            friends = []
            return
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            friends = try JSONDecoder().decode([FriendEntry].self, from: data)
        } catch {
            friends = []
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
                await loadFriends()
            }
        } catch {
            store.showToast("Could not add that code", isError: true)
        }
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
                                Text("Say hi 👋")
                                    .font(.system(size: 13, weight: .medium, design: .rounded))
                                    .foregroundStyle(P.ink3)
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

                    Button {
                        Task { await send() }
                    } label: {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Palette.current(scheme).accentInk)
                            .frame(width: 36, height: 36)
                            .background(P.red, in: Circle())
                    }
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
