// The pre-game landing screen: brand, nickname, create or
// join a room, an advanced server override, and the friends panel.

import SwiftUI
import UIKit

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
        let busy = store.connection == .connecting

        ScrollView {
            VStack(spacing: 18) {
                header(P)
                playCard(P, busy: busy)
                publicRoomsCard(P)
                serverCard(P)
                friendsCard(P)

                Text("An original implementation of the classic property-trading board game.")
                    .font(.system(size: 11))
                    .foregroundStyle(P.ink3)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 2)
            }
            .padding(.horizontal, 16)
            .padding(.top, 28)
            .padding(.bottom, 32)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear { selectedFlag = store.flag }
    }

    // MARK: - brand header

    private func header(_ P: Palette) -> some View {
        VStack(spacing: 6) {
            HStack(spacing: 0) {
                Text("MONEY").foregroundStyle(P.ink)
                Text("MOVE").foregroundStyle(P.red)
            }
            .font(.system(size: 44, weight: .heavy, design: .rounded))
            .kerning(1)

            Text("Buy streets. Build hotels. Bankrupt your friends.")
                .font(.system(size: 14, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink2)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 6)
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
