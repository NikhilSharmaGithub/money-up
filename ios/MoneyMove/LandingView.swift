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

            tabPage { friendsTab(P) }
                .tabItem { Label("Friends", systemImage: "person.2.fill") }

            tabPage { historyTab(P) }
                .tabItem { Label("History", systemImage: "clock.fill") }

            tabPage { settingsTab(P) }
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .tint(P.red)
        .onAppear { selectedFlag = store.flag }
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

    @ViewBuilder private func friendsTab(_ P: Palette) -> some View {
        pageTitle("Friends", "Swap codes, see who's online, jump into their room.", P)
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
                    TextField("Your nickname", text: $store.nickname)
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(P.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(P.rule, lineWidth: 1))
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
