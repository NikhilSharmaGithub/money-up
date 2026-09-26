// The pre-game landing screen: brand, nickname, create or
// join a room, an advanced server override, and the friends panel.

import SwiftUI
import UIKit
import AuthenticationServices

struct LandingView: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    /// Increase Contrast promotes the secondary ink on every piece of glass
    /// here to the primary one, so the labels drawn on it have to hear it too.
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Which tab is up, and which one was up before it. The second is only
    /// for the hand-built bar below iOS 26: its selection travels from the
    /// tab you left to the tab you picked, and a page that has just come on
    /// screen has no other way of knowing where the player came from.
    @State private var tab: HubTab = .play
    @State private var lastTab: HubTab = .play
    /// Where the appearance control's lozenge started its latest trip. The
    /// stretch peaks halfway along the whole trip, so System to Dark bulges
    /// once rather than once per segment it crosses.
    @State private var appearanceOrigin: MMAppearance = .system
    /// Read for one number: how many boards the hero says there are. It was a
    /// "19" typed into the view, and the day six continents joined the shelf
    /// the hero went on saying nineteen to everybody who opened the app.
    @ObservedObject private var shelf = BoardShelf.shared

    @State private var joinCode = ""
    @State private var addCode = ""
    @State private var selectedFlag = ""
    @State private var profile: ProfileInfo?
    @State private var me: MeInfo?
    @State private var authConfig: AuthConfig?
    @State private var signingIn = false
    /// The raw nonce of the Apple sheet currently up. Its hash went to Apple;
    /// this is what the server hashes to check the token came from that sheet.
    @State private var appleNonce = ""
    @State private var friends: [FriendEntry] = []
    /// People waiting on an answer. The summary row leads with them, because
    /// a request is the one thing here that somebody else is waiting on.
    @State private var friendRequests: [FriendEntry] = []
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
    /// One cup poll for the whole screen — see CupWatch. It also does the
    /// walking-in, so a player waiting on the Play tab is seated too.
    @StateObject private var cupWatch = CupWatch()
    /// The friends room, opened from the summary row on the Social tab.
    @State private var friendsOpen = false
    /// Notes from whoever runs the game — the bell at the top of Social.
    @StateObject private var noticeWatch = NoticeWatch()
    @State private var noticesOpen = false

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
        // Before the bar exists, so UIKit builds it already dressed.
        let _: Void = HubTabBar.styled

        // The home is a proper tabbed hub, and it stays the system's own
        // TabView on every version. On iOS 26 the system floats this bar as
        // Liquid Glass by itself, and anything laid on it would kill that
        // glass. Below 26 the bar is made see-through and each page draws the
        // hand-built twin underneath it (HubPage) — the items, the
        // accessibility and the state are still UIKit's, only the material
        // under them is ours.
        TabView(selection: Binding(get: { tab }, set: { lastTab = tab; tab = $0 })) {
            tabPage(.play) { playTab(P) }
                .tabItem { Label("Play", systemImage: "dice.fill") }
                .tag(HubTab.play)

            tabPage(.store) { storeTab(P) }
                .tabItem { Label("Store", systemImage: "bag.fill") }
                .tag(HubTab.store)

            tabPage(.social) { socialTab(P) }
                .tabItem { Label("Social", systemImage: "person.2.fill") }
                .tag(HubTab.social)

            tabPage(.history) { historyTab(P) }
                .tabItem { Label("History", systemImage: "clock.fill") }
                .tag(HubTab.history)

            tabPage(.settings) { settingsTab(P) }
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                .tag(HubTab.settings)
        }
        .tint(P.red)
        .sheet(item: $dmFriend) { friend in
            DMSheet(friend: friend).environmentObject(store)
        }
        .sheet(isPresented: $friendsOpen) {
            FriendsSheet().environmentObject(store)
        }
        .sheet(isPresented: $noticesOpen) {
            NoticesSheet(watch: noticeWatch)
        }
        .onAppear {
            selectedFlag = store.flag
            store.refreshWallet()
        }
        .task {
            store.refreshAdsConfig()
            // The free-coins offer draws nothing until this lands, and a view
            // that draws nothing cannot run a task of its own — so the tab it
            // sits on does the asking. It costs one GET, and only until a
            // server has answered "ads are off" once.
            await AdDesk.shared.refresh(store)
            // Nothing reaches Google unless a break is due — see isDue.
            InterstitialAd.shared.preload(AdDesk.shared.config)
            await loadAuthConfig()
            await refreshMe()
            // Who this player has blocked, before any chat line can ping them.
            await store.refreshSafety()
            cupWatch.start(store)
            noticeWatch.start(store)
        }
        // A door can close while the app sits in a pocket, and a table can be
        // drawn in that time. Coming back asks straight away rather than
        // waiting out the poll.
        .onReceive(NotificationCenter.default.publisher(
            for: UIApplication.willEnterForegroundNotification)) { _ in
            cupWatch.reload()
            Task { await noticeWatch.load() }
        }
        // Signed out from outside this screen — Apple access removed in the
        // Settings app. The card would otherwise keep showing the old name.
        .onReceive(NotificationCenter.default.publisher(for: .mmAccountChanged)) { _ in
            Task { await refreshMe() }
        }
    }

    /// Shared page chrome: scrolling column of cards over the felt.
    private func tabPage<Content: View>(_ which: HubTab,
                                        @ViewBuilder content: () -> Content) -> some View {
        HubPage(tab: which, from: lastTab, content: content)
    }

    // MARK: - glass on the landing

    /// Ink for a label sitting on glass. Two ranks and no third: `ink3` on the
    /// material measures 1.53:1, so every quiet word that used it moves up to
    /// the lifted second rank, and Increase Contrast moves that up again.
    private func glassInk(on backdrop: BackdropKind, secondary: Bool = false,
                          _ P: Palette) -> Color {
        backdrop.settledGlass(P).label(secondary: secondary,
                                       increaseContrast: contrast == .increased)
    }

    // MARK: - tabs

    @ViewBuilder private func playTab(_ P: Palette) -> some View {
        // Quick Play does its own waiting — it must never grey out the other
        // ways into a game while it's looking.
        let busy = store.connection == .connecting && !store.quickSearching
        header(P)
        continueCard(P)
        accountCard(P)
        // Coins first, then the table: collecting is a two-second errand and
        // the reward reads as part of who you are, right under the account.
        // A sign-in button that cannot sign anyone in is a dead tap; until the
        // server has said Google is set up, the card offers none.
        DailyRewardCard(onSignIn: authConfig?.googleReady == true ? { Task { await googleSignInTapped() } } : nil,
                        signingIn: signingIn)
        // The other way to a couple of coins, and a much quieter one: it draws
        // nothing until the server turns ads on, and nothing again once the
        // day's views are spent. It never plays by itself.
        FreeCoinsOffer()
        quickPlayCard(P)
        playCard(P, busy: busy)
        // Below the ways in, where the browsing starts — who is winning, then
        // whose table you can walk into.
        LeaderboardCard(myCode: me?.code)
        publicRoomsCard(P)
    }

    @ViewBuilder private func storeTab(_ P: Palette) -> some View {
        HStack(alignment: .top) {
            pageTitle("Store", "Win games, earn coins, dress your piece.", P)
            Spacer()
            // The wallet is a readout that floats on the page rather than a
            // line printed on a card, so it is glass. The page runs straight
            // behind it — a ramp we drew and know to the pixel — and the gold
            // ring it used to wear is the rim's job now: a rim that stays
            // brass on all fourteen tables. The count is in the glass's own
            // ink, as the purse on Android and on the web prints it: the coin
            // beside it is brass by its own drawing, and the brass moved into
            // the light.
            HStack(spacing: 5) {
                Art.icon(.coin, size: 17)
                Text("\(store.wallet?.coins ?? 0)")
                    .font(.system(size: 17, weight: .heavy, design: .rounded))
                    .foregroundStyle(glassInk(on: .page, P))
            }
                .padding(.vertical, 6)
                .padding(.horizontal, 13)
                .mmGlass(.regular, backdrop: .page, in: Capsule())
                .padding(.top, 10)
        }
        .task { await loadStore() }

        // What the server actually pays: the daily ladder runs 1 coin to 7,
        // a win is worth 2 and a runner-up 1. Promising fifty a game would
        // make every price on this page read as a rip-off the first time
        // somebody won and counted.
        Text("Collect your daily coins, and take a couple more for every game you win. Everything here is pure style — never pay-to-win.")
            .font(.system(size: 12, weight: .medium, design: .rounded))
            .foregroundStyle(P.ink3)
            .frame(maxWidth: .infinity, alignment: .leading)

        coinPacksSection(P)

        if storeItems.isEmpty {
            shopPlaceholder(P)
        } else {
            storeSection(.dice, "Token skins", "Your piece on the board.", kind: "token", P: P)
            storeSection(.people, "Avatars", "Your face in the player chip.", kind: "avatar", P: P)
            // Boards are the one thing on this shelf that is not a costume,
            // so they get a shelf that shows the board rather than an emoji.
            BoardStoreShelf()
        }
        // The catalogue rows for boards are filtered out of the shelves above;
        // BoardStoreShelf reads /api/boards instead, which is the only place
        // that knows which two are free today.
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

    /// Paid top-ups. The packs are always listed — the app knows all three
    /// without asking the server — and whether they can be bought is the App
    /// Store's answer, shown honestly: checking, on sale, or a Try again.
    @ViewBuilder private func coinPacksSection(_ P: Palette) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Art.icon(.coin, size: 13)
                PanelTitle("Get coins")
            }
            if shop.failed && !shop.loading {
                HStack(spacing: 8) {
                    Text("Couldn't reach the App Store.")
                        .font(.system(size: 11.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink3)
                    Spacer(minLength: 6)
                    Button("Try again") { Task { await shop.load(store) } }
                        .buttonStyle(MMButtonStyle(kind: .ghost))
                        // The one control on this tab printed straight on the
                        // page rather than on a card, so the page is what it
                        // floats over — and the page stays put while it scrolls.
                        .mmControls(on: .page)
                }
            } else {
                Text(shop.onSale ? "Top up when the wins aren't coming fast enough."
                     : "Checking the App Store…")
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        VStack(spacing: 8) {
            ForEach(shop.packs) { pack in
                packRow(pack, P)
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
                if busy || (!live && shop.loading) {
                    ProgressView().tint(P.red)
                } else if let price = shop.priceLabel(for: pack) {
                    Text(price)
                        .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.accentInk)
                        .padding(.vertical, 7)
                        .padding(.horizontal, 13)
                        .background(P.red, in: Capsule())
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

    /// The cosmetics come from our own server, the coin packs from Apple. The
    /// App Store lookup can sit there for seconds on a cold launch, so fill the
    /// shelves first and let StoreKit catch up — otherwise the whole tab is
    /// blank while a purchase API nobody asked about finishes thinking.
    ///
    /// The shelf is shared with the lobby's piece picker: whichever screen
    /// fetched it last serves both, and the tab opens on it rather than on a
    /// placeholder.
    private func loadStore() async {
        store.refreshWallet()
        // The coin packs start at once, alongside the shelves rather than after
        // them — they don't depend on anything the shelves need.
        async let coins: Void = shop.load(store)
        if storeItems.isEmpty {
            storeItems = PieceCatalog.shared.items
            await PieceCatalog.shared.load(store)
            storeItems = PieceCatalog.shared.items
            storeFailed = storeItems.isEmpty
        }
        await coins
    }

    private func buyOrEquip(_ item: StoreItem, owned: Bool, equipped: Bool) async {
        await Cosmetics.buyOrEquip(item, owned: owned, equipped: equipped, store: store)
    }

    /// Everything that involves other people: who you are to them, the cup if
    /// one is running, and the people themselves. The account comes first
    /// because both of the things under it need one — a cup will not take an
    /// entry it cannot pay, and a friend code belongs to an account.
    @ViewBuilder private func socialTab(_ P: Palette) -> some View {
        // The title, with the bell beside it: a note about a round opening is
        // no use two taps deep.
        HStack(alignment: .top) {
            pageTitle("Social", "Your account, your friends, and whatever is being played for.", P)
            NoticeBell(watch: noticeWatch) {
                Haptics.tap()
                noticesOpen = true
            }
            .padding(.top, 8)
        }
        accountCard(P)
        // Draws nothing at all unless the owner has tournaments switched on.
        CupCard(signedIn: me?.signedIn == true, watch: cupWatch)
        friendsCard(P)
    }

    /// Two different things share this tab: tables still waiting for this
    /// device, and games already in the books. The unfinished ones come first
    /// — they are the only rows you can still do something about.
    @ViewBuilder private func historyTab(_ P: Palette) -> some View {
        pageTitle("History", "Games you can still finish, and the ones already played.", P)
        unfinishedSection(P)
        // A table still running is the only thing here worth acting on, so it
        // keeps the top; everything the player has ever won sits under it.
        AchievementsShelf()
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
        // Account and help straight after the profile it belongs to, not at the
        // bottom of the page where nobody looks for "Delete account".
        AccountHelpCard(onDeleted: { Task { await refreshMe() } })
        themeCard(P)
        appearanceCard(P)
        soundCard(P)
        // After the preferences, before the plumbing — the way back into the
        // six cards a new player is shown, then the same rules the web
        // client's help modal reads out.
        MMCard { IntroAgainRow() }
        HowToPlayCard()
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
            ? "Left before the end · \(match.players.count) player\(match.players.count == 1 ? "" : "s")"
            : "\(match.winner) · \(match.players.count) player\(match.players.count == 1 ? "" : "s")"
                + (match.turns > 0 ? " · \(match.turns) turn\(match.turns == 1 ? "" : "s")" : "")

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
                          prompt: Text("Your name").foregroundStyle(glassInk(on: .paper, secondary: true, P)))
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .onSubmit { Task { await loadProfile() } }
                    .padding(11)
                    .cardGlass(in: RoundedRectangle(cornerRadius: MMRadius.sm, style: .continuous), floats: false)

                flagPicker(P)
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

            // The numbers that sell the table, on one bar of glass. The mark,
            // the wordmark and the line under them stay printed on the page —
            // they are the brand, and the page is where a brand is printed —
            // but the three numbers are a readout, and a readout floats. It is
            // over the page and nothing else: it scrolls with the column, and
            // the replica under it slides to match, so the ramp it bends is the
            // one that is really there.
            HStack(spacing: 26) {
                stat(shelf.boards.isEmpty ? "25" : "\(shelf.boards.count)", "BOARDS", P)
                stat("8", "PLAYERS", P)
                stat("∞", "BANKRUPTCIES", P)
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 24)
            .mmGlass(.regular, backdrop: .page, in: Capsule())
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 6)
    }

    private func stat(_ value: String, _ label: String, _ P: Palette) -> some View {
        VStack(spacing: 1) {
            Text(value)
                .font(.system(size: 20, weight: .heavy, design: .rounded))
                .foregroundStyle(BackdropKind.page.settledGlass(P).goldInk)
            Text(label)
                .font(.system(size: 9, weight: .bold))
                .kerning(1)
                .foregroundStyle(glassInk(on: .page, secondary: true, P))
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
                    // The break goes at the START of the wait, not the end: an
                    // ad that lands in the last three seconds is one the
                    // player is still closing while their first turn runs. The
                    // search carries on behind it either way — nothing about
                    // the game waits on this line.
                    InterstitialAd.shared.showIfReady(AdDesk.shared.config)
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
                                  prompt: Text("Your nickname").foregroundStyle(glassInk(on: .paper, secondary: true, P)))
                            .font(.system(size: 16, weight: .semibold, design: .rounded))
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                            .padding(12)
                            // 10, the radius of the dice button beside it, so
                            // the two read as one row of controls.
                            .cardGlass(in: RoundedRectangle(cornerRadius: MMRadius.sm, style: .continuous), floats: false)

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
                    // The placeholder is spelled out as a prompt so it can wear
                    // the glass's second ink: the system's own placeholder grey
                    // is a third rank, and a third rank on glass is 1.53:1.
                    TextField("room code", text: Binding(
                        get: { joinCode },
                        set: { joinCode = $0.lowercased().filter { !$0.isWhitespace } }
                    ), prompt: Text("room code").foregroundStyle(glassInk(on: .paper, secondary: true, P)))
                        .font(.system(size: 16, weight: .bold, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.asciiCapable)
                        .onSubmit { joinTapped() }
                        .padding(12)
                        .cardGlass(in: RoundedRectangle(cornerRadius: MMRadius.sm, style: .continuous), floats: false)

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

    /// Your flag, as one row.
    ///
    /// This was a grid of fifty unlabelled flags taking up half the Settings
    /// screen, which asked the reader to recognise every one of them. It is a
    /// named list behind a tap now, with the one you picked on the right.
    private func flagPicker(_ P: Palette) -> some View {
        let current = MMStatic.countries.first { $0.flag == selectedFlag }
        return Menu {
            Button {
                selectedFlag = ""
                store.setAppearance(flag: "")
            } label: {
                Label("No flag", systemImage: selectedFlag.isEmpty ? "checkmark" : "flag.slash")
            }
            Divider()
            ForEach(MMStatic.countries, id: \.flag) { country in
                Button {
                    SoundKit.shared.click()
                    selectedFlag = country.flag
                    store.setAppearance(flag: country.flag)
                } label: {
                    Text(country.flag == selectedFlag
                         ? "\(country.flag)  \(country.name)  ✓"
                         : "\(country.flag)  \(country.name)")
                }
            }
        } label: {
            // A picker is a control, so the row is glass; the card under it
            // is paper and scrolls with it. With nothing flag-shaped chosen
            // yet it shows the same crossed-out flag as the menu's own "No
            // flag" row — a drawn mark, where a white-flag emoji sat in the
            // chrome before.
            HStack(spacing: 10) {
                if selectedFlag.isEmpty {
                    Image(systemName: "flag.slash")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(glassInk(on: .paper, secondary: true, P))
                        .frame(width: 24)
                } else {
                    Text(selectedFlag)
                        .font(.system(size: 19))
                }
                Text("Country flag")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(glassInk(on: .paper, secondary: true, P))
                Spacer(minLength: 6)
                Text(current?.name ?? "None")
                    .font(.system(size: 14, weight: .heavy, design: .rounded))
                    .foregroundStyle(glassInk(on: .paper, P))
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(glassInk(on: .paper, secondary: true, P))
            }
            .padding(.horizontal, 13)
            .frame(maxWidth: .infinity, minHeight: 46)
            // 14 off the ladder: the radius a big button of the same height
            // wears, so the row and the buttons in the card are one family.
            .cardGlass(in: RoundedRectangle(cornerRadius: MMRadius.md, style: .continuous))
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
    /// palettes the whole app wears. One segmented control of three.
    private func appearanceCard(_ P: Palette) -> some View {
        let current = MMAppearance(rawValue: appearanceID) ?? .system
        return MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                PanelTitle("Appearance")
                appearanceSegments(current, P)
                Text(current.caption)
                    .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
            .animation(.spring(duration: 0.25), value: appearanceID)
        }
    }

    /// Three chips were three controls that happened to sit in a row, each
    /// with its own ring; this is one control, the way the system draws a
    /// choice of three. One track of glass, and on it a lozenge that travels
    /// to the choice and stretches on the way — longest at the halfway mark
    /// of the whole trip, the way a drop drawn across a surface lengthens —
    /// instead of one ring fading out while another fades in.
    ///
    /// The lozenge is a well in the track, not a second pane: glass never
    /// stacks on glass. It is the track's own ink at a tenth, which is how the
    /// system fills a grouped control on a bar, and it flips when the glass
    /// under it does. Every size is concentric by arithmetic: an 18 pt track
    /// with 4 pt of padding holds a 14 pt lozenge.
    private func appearanceSegments(_ current: MMAppearance, _ P: Palette) -> some View {
        let modes = MMAppearance.allCases
        let at = CGFloat(modes.firstIndex(of: current) ?? 0)
        let origin = CGFloat(modes.firstIndex(of: appearanceOrigin) ?? 0)
        let well = BackdropKind.paper.settledGlass(P).ink.opacity(contrast == .increased ? 0.18 : 0.10)
        return HStack(spacing: 0) {
            ForEach(modes, id: \.rawValue) { mode in
                appearanceSegment(mode, on: mode == current, P)
            }
        }
        .background(alignment: .leading) {
            GeometryReader { g in
                let slot = g.size.width / CGFloat(modes.count)
                RoundedRectangle(cornerRadius: MMRadius.inner(MMRadius.lg, inset: 4), style: .continuous)
                    .fill(well)
                    .frame(width: slot, height: g.size.height)
                    .modifier(GlassLozenge(at: at, origin: origin, target: at, slot: slot))
                    // 320 ms and on the landing's ease. Under Reduce Motion
                    // the lozenge moves straight there: no travel, no stretch.
                    .animation(reduceMotion ? nil : HubTabBar.travel, value: at)
            }
        }
        .padding(4)
        .cardGlass(in: RoundedRectangle(cornerRadius: MMRadius.lg, style: .continuous))
    }

    private func appearanceSegment(_ mode: MMAppearance, on: Bool, _ P: Palette) -> some View {
        Button {
            // Where the lozenge is leaving from, set in the same breath as
            // where it is going, so the trip it draws is the one just asked for.
            appearanceOrigin = MMAppearance(rawValue: appearanceID) ?? .system
            appearanceID = mode.rawValue
            Haptics.tap()
            SoundKit.shared.click()
        } label: {
            // 6 inside the track's 4 is the 10 the chips had, so the control
            // stands exactly as tall as the row it replaces.
            VStack(spacing: 6) {
                appearanceGlyph(mode, on: on, P)
                Text(mode.title)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(glassInk(on: .paper, secondary: !on, P))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
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
                .foregroundStyle(on ? P.gold : glassInk(on: .paper, secondary: true, P))
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


    // MARK: - friends

    /// A summary, and a door.
    ///
    /// Everything friends-shaped used to be stacked on this card: your code,
    /// the add box, and the whole list. Fine for two friends, unreadable for
    /// twenty. This is the count and your code; the room is FriendsSheet.
    private func friendsCard(_ P: Palette) -> some View {
        Button {
            Haptics.tap()
            friendsOpen = true
        } label: {
            MMCard(padding: 16) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 13, style: .continuous).fill(P.sunken)
                        Art.icon(.people, size: 20, tint: P.ink2)
                    }
                    .frame(width: 42, height: 42)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Friends")
                            .font(.system(size: 15, weight: .heavy, design: .rounded))
                            .foregroundStyle(P.ink)
                        Text(friendsLine)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(!friendRequests.isEmpty ? P.gold
                                             : friendsOnline > 0 ? P.good : P.ink3)
                    }

                    Spacer(minLength: 6)

                    if let profile {
                        Text(profile.code)
                            .font(.system(size: 13, weight: .heavy, design: .monospaced))
                            .kerning(1.5)
                            .foregroundStyle(P.ink2)
                            .padding(.vertical, 5)
                            .padding(.horizontal, 10)
                            .background(P.sunken, in: Capsule())
                            .overlay(Capsule().stroke(P.rule, lineWidth: 1))
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(P.ink3)
                }
            }
        }
        .buttonStyle(.plain)
        .task {
            await loadProfile()
            while !Task.isCancelled {
                await loadFriends()
                try? await Task.sleep(for: .seconds(20))
            }
        }
    }

    private var friendsOnline: Int {
        friends.filter { ($0.status ?? "offline") != "offline" }.count
    }

    private var friendsLine: String {
        if !friendRequests.isEmpty {
            return "\(friendRequests.count) friend request\(friendRequests.count > 1 ? "s" : "") waiting"
        }
        if friends.isEmpty { return "Swap codes and play together" }
        if friendsOnline == 0 { return "\(friends.count) · nobody on right now" }
        return "\(friends.count) · \(friendsOnline) on right now"
    }

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
        } else {
            MMCard(padding: 12) {
                VStack(spacing: 8) {
                    Text("Sign in to collect your daily coins")
                        .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    // Google needs a client id from the server; Apple never
                    // does. Hiding Apple because Google is unconfigured used
                    // to leave a player with no way in at all.
                    if authConfig?.googleReady == true {
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
                    }

                    SignInWithAppleButton(.signIn) { request in
                        // Nothing but the stable user id is used, so nothing
                        // else is asked for. A fresh nonce per tap: its hash
                        // goes to Apple inside the request, the raw value
                        // waits here until the server needs to check it.
                        let nonce = AppleNonce.make()
                        appleNonce = nonce.raw
                        request.requestedScopes = []
                        request.nonce = nonce.hashed
                    } onCompletion: { result in
                        if case .success(let auth) = result,
                           let cred = auth.credential as? ASAuthorizationAppleIDCredential {
                            let rawNonce = appleNonce
                            Task { await appleLinked(cred, rawNonce: rawNonce) }
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
                // What this device already calls itself. The server never
                // takes the name off the Google account — see attachLogin.
                body: ["token": store.token, "credential": credential,
                       "nickname": store.nickname])
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

    /// The sheet said yes; the server still has to. linkApple does the asking
    /// and owns the failure toast, so this only reports the good news.
    private func appleLinked(_ cred: ASAuthorizationAppleIDCredential, rawNonce: String) async {
        guard await store.linkApple(cred, rawNonce: rawNonce) else { return }
        store.showToast("Signed in with Apple")
        await refreshMe()
    }

    private func signOut() async {
        struct Reply: Decodable { var ok: Bool? }
        let reply: Reply? = try? await store.fetchJSON(
            "/api/auth/logout", method: "POST", body: ["token": store.token])
        guard reply?.ok == true else {
            // The server never heard it, so nothing changed there: the Apple
            // sign-in (and the token kept to revoke it) still stands, and so
            // must the id the credential check watches. The card keeps showing
            // what is true rather than a signed-out state that is not — which
            // is also why there is no refreshMe here: offline, it would blank
            // the card and look exactly like a sign-out that worked.
            store.showToast("Couldn't sign out — check your connection and try again.", isError: true)
            return
        }
        // Signing out on purpose is not Apple taking access away, so the
        // credential check has nothing left to watch for. Only now, though: if
        // the reply was lost after the server did sign out, the id stays, and
        // when Apple later reports that sign-in revoked the check finds the
        // server already signed out and simply forgets it — no second logout,
        // no toast.
        UserDefaults.standard.removeObject(forKey: GameStore.appleUserKey)
        store.showToast("Signed out — coins and friends stay with this device")
        await refreshMe()
    }

    private func loadProfile() async {
        let body: [String: Any] = ["token": store.token, "name": store.nickname, "flag": store.flag]
        profile = try? await store.fetchJSON("/api/profile", method: "POST", body: body)
    }

    private func loadFriends() async {
        // A failed poll keeps whatever is on screen: blanking the list on a
        // blip tells the player their friends are gone, which they are not.
        struct Feed: Decodable {
            var friends: [FriendEntry] = []
            var requests: [FriendEntry] = []
        }
        guard let feed: Feed = try? await store.fetchJSON(
            "/api/social?token=\(store.token)", raw: true) else { return }
        // Anyone you can actually walk in on floats to the top — an offline
        // crowd should never bury a live table.
        friends = feed.friends.sorted {
            ($0.roomId != nil ? 0 : 1, $0.name.lowercased()) < ($1.roomId != nil ? 0 : 1, $1.name.lowercased())
        }
        friendRequests = feed.requests
    }
}

// MARK: - The hub's glass

/// The hub's five tabs, in the order the bar shows them. The raw value is the
/// slot, which is all the hand-built bar needs to know about a tab.
private enum HubTab: Int, CaseIterable, Hashable {
    case play, store, social, history, settings
}

private extension View {
    /// Glass for a control printed on a card: a field, a picker, a segmented
    /// choice. What is under it is the card, and the card scrolls with it, so
    /// nothing ever slides beneath — and a blur of a flat colour is that same
    /// flat colour. So it runs at `flat`, film and rim and shadow with no
    /// blur, exactly as the buttons on the same card do. That is also what
    /// lets glass sit inside a scrolling column without a backdrop pass per
    /// row, and it holds on iOS 26 too, so the two versions match side by side.
    ///
    /// A text field passes `floats: false`: it is somewhere to write, set into
    /// the card rather than lifted off it, and the web's fields cast nothing
    /// for the same reason.
    func cardGlass(in shape: some InsettableShape, floats: Bool = true) -> some View {
        mmGlass(.regular, backdrop: .paper, in: shape, floats: floats)
            .transformEnvironment(\.mmGlassQuality) { $0 = min($0, .flat) }
    }
}

/// Everything about the tab bar that is not SwiftUI's to decide.
///
/// On iOS 26 that is nothing. The system floats the TabView's bar as real
/// Liquid Glass by itself, and an appearance proxy, a background or anything
/// laid over it would be a custom surface sitting on top of the OS's own
/// glass and killing it. So none of this runs there.
///
/// Below 26 the bar stays UIKit's — its items, its accessibility, its state —
/// and only its background goes: a transparent appearance, and the hand-built
/// twin of the 26 bar drawn by each page underneath it. The items are pulled
/// into a centred group of known width so the twin can sit exactly behind
/// them; left to fill the width, the outermost labels land on the curve of
/// the capsule's ends and poke out of it.
@MainActor
private enum HubTabBar {
    /// Whether the system is drawing this bar as glass — the material's own
    /// test, so the bar and every pane on it agree: an SDK older than 26 runs
    /// even a 26 phone in the old design, and there the twin is wanted after
    /// all.
    static var isSystemGlass: Bool { MMSystemGlass.isOn }

    /// The shell's padding round its items, and the gap between items. One
    /// number all the way round, because the selection is a capsule inside a
    /// capsule and only a uniform inset keeps the two concentric. Nonisolated
    /// because they are plain constants the bar's geometry is worked out from
    /// outside any view.
    nonisolated static let pad: CGFloat = 4
    nonisolated static let spacing: CGFloat = 4

    /// How much of the column's foot is kept clear for the floating bar —
    /// at 32 the bottom row of the store grid sat half behind it.
    static let footRoom: CGFloat = 96

    /// The width UIKit gives each item. On a phone the five share what is
    /// left of the screen once the shell floats 16 pt in from either edge —
    /// the margin the Android bar floats at — and a phone is portrait-only, so
    /// the answer never changes. An iPad only gets this bar in a compact
    /// window, whose width it cannot know in advance, so it takes the
    /// narrowest a label fits in and centres.
    static let itemWidth: CGFloat = {
        if UIDevice.current.userInterfaceIdiom == .pad { return 56 }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let screen = scenes.first?.screen.bounds.size ?? CGSize(width: 390, height: 844)
        let count = CGFloat(HubTab.allCases.count)
        let room = min(screen.width, screen.height) - 2 * 16
            - 2 * HubTabBar.pad - (count - 1) * HubTabBar.spacing
        return min(max((room / count).rounded(.down), 56), 76)
    }()

    static var shellWidth: CGFloat {
        let count = CGFloat(HubTab.allCases.count)
        return itemWidth * count + spacing * (count - 1) + pad * 2
    }

    /// 320 ms, on the same ease the web's selection travels on.
    static let travel = Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.32)

    /// Dresses UIKit's bar, once, before the first one is built. Only a
    /// compact-width bar: that is the bottom bar, the one the twin is drawn
    /// for. A regular-width iPad keeps its system bar untouched.
    static let styled: Void = {
        guard !HubTabBar.isSystemGlass else { return }
        let look = UITabBarAppearance()
        look.configureWithTransparentBackground()
        look.stackedItemPositioning = .centered
        look.stackedItemWidth = HubTabBar.itemWidth
        look.stackedItemSpacing = HubTabBar.spacing
        // The selected item keeps the tint SwiftUI hands the bar. The rest
        // wear the glass's second ink — the system's unselected grey is a
        // third rank, and a third rank on glass is 1.53:1.
        let quiet = UIColor { traits in HubTabBar.quietInk(traits) }
        for item in [look.stackedLayoutAppearance, look.inlineLayoutAppearance,
                     look.compactInlineLayoutAppearance] {
            item.normal.iconColor = quiet
            item.normal.titleTextAttributes = [.foregroundColor: quiet]
        }
        let bar = UITabBar.appearance(for: UITraitCollection(horizontalSizeClass: .compact))
        bar.standardAppearance = look
        bar.scrollEdgeAppearance = look
    }()

    /// The bar's second ink, resolved the way the twin under it resolves its
    /// glass: off the page it floats over, for whichever scheme UIKit asks
    /// about. Increase Contrast promotes it to the first.
    nonisolated static func quietInk(_ traits: UITraitCollection) -> UIColor {
        let P = Palette.current(traits.userInterfaceStyle == .dark ? .dark : .light)
        return UIColor(BackdropKind.page.settledGlass(P)
            .label(secondary: true, increaseContrast: traits.accessibilityContrast == .high))
    }

    /// Where UIKit has put the bar, in the window. There is no SwiftUI safe
    /// area that says it without also moving when the keyboard comes up, so
    /// it is read off the window: the status bar above, the home indicator
    /// below, and the item band UIKit has used since iOS 12 between them.
    struct Metrics {
        let window: CGSize
        let safeTop: CGFloat
        let homeStrip: CGFloat
        let row: CGFloat

        var shellHeight: CGFloat { row + 2 * HubTabBar.pad }

        /// The shell's middle, in a space that runs to the window's bottom
        /// edge. Centred on the items — except on a phone with a home button,
        /// where the bar sits on the bottom edge and a centred shell would
        /// run off the screen; there it lifts until it just clears it.
        func shellMidY(in height: CGFloat) -> CGFloat {
            min(height - homeStrip - row / 2, height - 2 - shellHeight / 2)
        }

        func shellTop(in height: CGFloat) -> CGFloat {
            shellMidY(in: height) - shellHeight / 2
        }
    }

    static var metrics: Metrics {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        // The app's own window is the scene's first; the toast window comes
        // later and is never made key.
        let window = scene?.keyWindow ?? scene?.windows.first
        let insets = window?.safeAreaInsets ?? .zero
        return Metrics(window: window?.bounds.size ?? .zero,
                       safeTop: insets.top,
                       homeStrip: insets.bottom,
                       row: UIDevice.current.userInterfaceIdiom == .pad ? 50 : 49)
    }
}

/// How one page's column sits under the bar, kept outside the page's own
/// state on purpose: it changes on every frame of a scroll, and only the twin
/// needs to hear it. Held in the page's state it would ask every card on the
/// page to redraw sixty times a second.
@MainActor
private final class HubScroll: ObservableObject {
    /// How far the column has travelled up from rest. It swings the light on
    /// the bar's rim and deepens its shadow, and past 132 pt the light has
    /// swung its whole 22°, so it stops counting there and the bar stops
    /// redrawing.
    @Published private(set) var offset: CGFloat = 0
    /// Whether any card is under the bar right now. At the very foot of a page
    /// the last card has cleared it, and the page the replica draws is then
    /// exactly what is there.
    @Published private(set) var contentUnder = false

    func track(_ column: CGRect) {
        guard !HubTabBar.isSystemGlass else { return }
        let m = HubTabBar.metrics
        let travelled = min(max(m.safeTop - column.minY, 0), 132)
        if abs(travelled - offset) >= 0.5 { offset = travelled }
        let under = column.maxY - HubTabBar.footRoom > m.shellTop(in: m.window.height)
        if under != contentUnder {
            withAnimation(.easeInOut(duration: 0.16)) { contentUnder = under }
        }
    }
}

/// One tab's scrolling column of cards over the felt — and, below iOS 26, the
/// glass that floats over its foot.
private struct HubPage<Content: View>: View {
    let tab: HubTab
    let from: HubTab
    let content: Content

    @Environment(\.horizontalSizeClass) private var hSize
    @State private var scroll = HubScroll()

    init(tab: HubTab, from: HubTab, @ViewBuilder content: () -> Content) {
        self.tab = tab
        self.from = from
        self.content = content()
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                content
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            // The tab bar floats over the page rather than sitting under it,
            // so the last card needs room to clear it.
            .padding(.bottom, HubTabBar.footRoom)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { column in
                scroll.track(column)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        // Over the column and under UIKit's bar, which is the only layer the
        // twin can live in: the page's own view is below the bar and above
        // everything that scrolls.
        .overlay {
            if !HubTabBar.isSystemGlass && hSize == .compact {
                // Touches and VoiceOver both belong to UIKit's items above it;
                // this is only what they are standing on.
                HubTabBarTwin(tab: tab, from: from, scroll: scroll)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
    }
}

/// Below iOS 26: the twin of the system's floating bar, drawn under UIKit's
/// now-transparent one, and the two soft edges iOS 26 gives a scroll view for
/// nothing.
///
/// The edges are the page's own gradient laid back over the column, faded in
/// over 28 pt — the same trick as the material's replica, and exact for the
/// same reason: we drew the page, so painting it again over a card is the
/// card fading into what is really behind it. A mask would have had to reach
/// under the status bar and the bar to do the same, and a mask that falls one
/// point short of that cuts the column off in exactly the hard line it is
/// there to prevent. Each edge shows only while something is under it.
private struct HubTabBarTwin: View {
    /// This page's own tab — where the selection comes to rest.
    let tab: HubTab
    /// The tab the player just left — where the selection sets out from.
    let from: HubTab
    @ObservedObject var scroll: HubScroll

    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Whether the selection has finished its trip onto this tab. Each page
    /// draws its own bar, so the trip has to be made by the page arriving:
    /// it comes on screen with the selection still over the tab the player
    /// left, and slides it home.
    @State private var arrived = false

    var body: some View {
        let P = Palette.current(scheme)
        let m = HubTabBar.metrics
        GeometryReader { g in
            ZStack(alignment: .topLeading) {
                edge(P, g.size, stops: topStops(m, g.size.height))
                    .opacity(scroll.offset > 0 ? 1 : 0)
                edge(P, g.size, stops: footStops(m, g.size.height))
                    .opacity(scroll.contentUnder ? 1 : 0)
                shell(P, m)
                    .position(x: g.size.width / 2, y: m.shellMidY(in: g.size.height))
            }
            .animation(.easeInOut(duration: 0.16), value: scroll.offset > 0)
        }
        .ignoresSafeArea()
        .onAppear {
            guard from != tab, !reduceMotion else {
                arrived = true
                return
            }
            // One turn of the run loop, so the selection is drawn where it
            // set out from before it is asked to leave.
            DispatchQueue.main.async {
                withAnimation(HubTabBar.travel) { arrived = true }
            }
        }
        .onDisappear { arrived = false }
    }

    /// The bar itself. A capsule, because that is the shape the 26 bar it is
    /// standing in for floats as; Regular, because live labels sit on it and
    /// Clear does not adapt; over the page, with the cards that pass under it
    /// declared as they come and go. The selection is a well in the glass —
    /// never a second pane on it — in the glass's own ink, so it flips when
    /// the glass does.
    private func shell(_ P: Palette, _ m: HubTabBar.Metrics) -> some View {
        let well = BackdropKind.page.settledGlass(P).ink
            .opacity(contrast == .increased ? 0.18 : 0.10)
        return ZStack(alignment: .leading) {
            Color.clear
            Capsule()
                .fill(well)
                .frame(width: HubTabBar.itemWidth, height: m.row)
                .modifier(GlassLozenge(at: CGFloat((arrived ? tab : from).rawValue),
                                       origin: CGFloat(from.rawValue),
                                       target: CGFloat(tab.rawValue),
                                       slot: HubTabBar.itemWidth + HubTabBar.spacing))
                .padding(.leading, HubTabBar.pad)
        }
        .frame(width: HubTabBar.shellWidth, height: m.shellHeight)
        .mmGlass(.regular, backdrop: .page, in: Capsule())
        .environment(\.mmScrollOffset, scroll.offset)
        .environment(\.mmContentUnderneath, scroll.contentUnder)
    }

    /// The page, again, window-sized and window-aligned, so its ramp lands on
    /// the real one to the pixel, seen through a vertical fade.
    private func edge(_ P: Palette, _ size: CGSize, stops: [Gradient.Stop]) -> some View {
        LinearGradient(colors: [P.page, P.page2], startPoint: .topLeading, endPoint: .bottomTrailing)
            .frame(width: size.width, height: size.height)
            .mask(LinearGradient(stops: stops, startPoint: .top, endPoint: .bottom))
    }

    /// Under the status bar: the column fades out over the 28 pt above it.
    private func topStops(_ m: HubTabBar.Metrics, _ height: CGFloat) -> [Gradient.Stop] {
        let h = max(height, 1)
        return [.init(color: .black, location: 0),
                .init(color: .black, location: max(m.safeTop - 28, 0) / h),
                .init(color: .clear, location: min(m.safeTop / h, 1))]
    }

    /// Into the bar: 28 pt of fade down to its top edge, and softer from there
    /// to the foot of the screen. Not all the way to the page — the cards
    /// under the glass are what it has to refract.
    private func footStops(_ m: HubTabBar.Metrics, _ height: CGFloat) -> [Gradient.Stop] {
        let h = max(height, 1)
        let top = m.shellTop(in: height)
        return [.init(color: .clear, location: min(max(top - 28, 0) / h, 1)),
                .init(color: .black.opacity(0.55), location: min(max(top, 0) / h, 1)),
                .init(color: .black.opacity(0.85), location: 1)]
    }
}

/// A selection that travels instead of cutting, and stretches on the way.
///
/// Only the position animates; the stretch is worked out from how far along
/// its trip the selection is, peaking at 1.12 halfway — so a trip across
/// three slots bulges once, not three times, and one that goes nowhere does
/// not bulge at all. Where the trip started is handed in rather than
/// remembered, because it changes in the same breath as where it ends.
private struct GlassLozenge: ViewModifier, Animatable {
    /// Where the selection is now, in slots. The one number that animates.
    var at: CGFloat
    let origin: CGFloat
    let target: CGFloat
    /// One slot's width, gap included.
    let slot: CGFloat

    /// Nonisolated, because the animation system reads it from outside the
    /// main actor, and it is only ever one plain number.
    nonisolated var animatableData: CGFloat {
        get { at }
        set { at = newValue }
    }

    func body(content: Content) -> some View {
        let span = target - origin
        let progress = abs(span) < 0.001 ? 1 : min(max((at - origin) / span, 0), 1)
        content
            .scaleEffect(x: 1 + 0.48 * progress * (1 - progress), y: 1)
            .offset(x: at * slot)
    }
}
