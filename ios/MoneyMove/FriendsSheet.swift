// Friends, given a screen of their own.
//
// This lived as a card on the Social tab: your code, a box to type somebody
// else's into, and the list all stacked under one another. That is fine for
// two friends and unreadable for twenty, and the two things people actually
// come here to do — hand out their code, and get into a friend's game — were
// the two hardest to find.
//
// So the tab keeps a summary row and this is the room behind it: your code
// big enough to read out, one place to add somebody, and the list with what
// each person is doing right now and the one button that matters for it.

import SwiftUI
import UIKit

struct FriendsSheet: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var friends: [FriendEntry] = []
    /// People who have asked to be friends, and people this player has asked.
    @State private var requests: [FriendEntry] = []
    @State private var sentAsks: [FriendEntry] = []
    @State private var inviting: Set<String> = []
    @State private var profile: ProfileInfo?
    @State private var addCode = ""
    @State private var adding = false
    @State private var dmFriend: FriendEntry?
    @State private var removing: FriendEntry?
    @State private var loaded = false

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    yourCode(P)
                    addBox(P)
                    if !requests.isEmpty || !sentAsks.isEmpty { pendingCard(P) }
                    list(P)
                }
                .padding(16)
            }
            .background(P.page.ignoresSafeArea())
            .navigationTitle("Friends")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .sheet(item: $dmFriend) { friend in
            DMSheet(friend: friend).environmentObject(store)
        }
        .confirmationDialog("Remove this friend?",
                            isPresented: Binding(get: { removing != nil },
                                                 set: { if !$0 { removing = nil } }),
                            titleVisibility: .visible) {
            Button("Remove \(removing?.name ?? "")", role: .destructive) {
                if let entry = removing { Task { await drop(entry) } }
            }
            Button("Keep", role: .cancel) { removing = nil }
        } message: {
            // Friendship is mutual here, and people are surprised by that.
            Text("You will both drop off each other's list.")
        }
        .task {
            await refresh()
            loaded = true
            // While this is open, keep it live: a friend who sits down at a
            // table should show up as joinable without a pull-to-refresh.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(8))
                await loadFriends()
            }
        }
    }

    // MARK: - your code

    private func yourCode(_ P: Palette) -> some View {
        MMCard(padding: 16) {
            VStack(spacing: 12) {
                Text("YOUR FRIEND CODE")
                    .font(.system(size: 10.5, weight: .heavy, design: .rounded))
                    .kerning(1)
                    .foregroundStyle(P.ink3)

                Text(profile?.code ?? "······")
                    .font(.system(size: 34, weight: .black, design: .monospaced))
                    .kerning(6)
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity)
                    .background(P.sunken, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(P.gold.opacity(0.5), lineWidth: 1))

                HStack(spacing: 8) {
                    Button {
                        UIPasteboard.general.string = profile?.code ?? ""
                        Haptics.tap()
                        store.showToast("Friend code copied")
                    } label: {
                        HStack(spacing: 7) {
                            Image(systemName: "doc.on.doc")
                            Text("Copy")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(MMButtonStyle(kind: .ghost))
                    .disabled(profile == nil)

                    ShareLink(item: shareText) {
                        HStack(spacing: 7) {
                            Image(systemName: "square.and.arrow.up")
                            Text("Share")
                        }
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 42)
                        .background(P.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(P.rule, lineWidth: 1))
                        .foregroundStyle(P.ink)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                    }
                    .disabled(profile == nil)
                }

                Text("Give this to somebody and they can ask to be friends. You decide — a request waits here until you accept it.")
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var shareText: String {
        let code = profile?.code ?? ""
        return "Add me on MoneyMove — my friend code is \(code). https://www.moneymove.live"
    }

    // MARK: - adding somebody

    private func addBox(_ P: Palette) -> some View {
        MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                PanelTitle("Add a friend")
                HStack(spacing: 8) {
                    // Sanitise on the way in, or fast typing loses characters
                    // to the write-back.
                    TextField("THEIR CODE", text: Binding(
                        get: { addCode },
                        set: { addCode = String($0.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(6)) }
                    ))
                    .font(.system(size: 16, weight: .heavy, design: .monospaced))
                    .kerning(2)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .keyboardType(.asciiCapable)
                    .submitLabel(.done)
                    .onSubmit { Task { await add() } }
                    .padding(.horizontal, 13)
                    .frame(height: 46)
                    .background(P.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(P.rule, lineWidth: 1))

                    Button {
                        Task { await add() }
                    } label: {
                        HStack(spacing: 6) {
                            if adding { ProgressView().tint(P.accentInk) }
                            else { Image(systemName: "plus") }
                            Text("Add")
                        }
                        .padding(.horizontal, 6)
                    }
                    .buttonStyle(MMButtonStyle(kind: .gold))
                    .disabled(addCode.count < 4 || adding)
                }
            }
        }
    }

    // MARK: - requests

    /// Adding somebody used to put you straight on their list, on the grounds
    /// that you had to know their code. But a code gets read over a shoulder
    /// or guessed at six characters, and being on a stranger's list means they
    /// can message you and see when you are online. They decide now.
    private func pendingCard(_ P: Palette) -> some View {
        MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                if !requests.isEmpty {
                    PanelTitle("Wants to be friends (\(requests.count))")
                    ForEach(requests) { r in
                        HStack(spacing: 11) {
                            face(r, tint: P.gold, P)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(r.name)
                                    .font(.system(size: 14.5, weight: .heavy, design: .rounded))
                                    .foregroundStyle(P.ink)
                                    .lineLimit(1)
                                Text("asked to be friends · \(r.code)")
                                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                                    .foregroundStyle(P.ink3)
                            }
                            Spacer(minLength: 4)
                            Button("Accept") { Task { await answer(r, yes: true) } }
                                .buttonStyle(MMButtonStyle(kind: .gold))
                            Button {
                                Task { await answer(r, yes: false) }
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(P.ink3)
                                    .frame(width: 28, height: 28)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(10)
                        .background(P.goldSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(P.gold.opacity(0.6), lineWidth: 1))
                    }
                }
                if !sentAsks.isEmpty {
                    PanelTitle("Asked (\(sentAsks.count))")
                    ForEach(sentAsks) { r in
                        HStack(spacing: 11) {
                            face(r, tint: P.rule, P)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(r.name)
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                    .foregroundStyle(P.ink2)
                                    .lineLimit(1)
                                Text("waiting for them to accept")
                                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                                    .foregroundStyle(P.ink3)
                            }
                            Spacer(minLength: 4)
                            Button("Cancel") { Task { await answer(r, yes: false) } }
                                .buttonStyle(MMButtonStyle(kind: .ghost))
                        }
                        .padding(10)
                        .background(P.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(P.rule, lineWidth: 1))
                    }
                }
            }
        }
    }

    private func face(_ entry: FriendEntry, tint: Color, _ P: Palette) -> some View {
        let glyph = [entry.avatar ?? "", entry.flag ?? ""].first { !$0.isEmpty } ?? ""
        return ZStack {
            Circle().fill(P.card)
            if glyph.isEmpty { Art.icon(.people, size: 17, tint: P.ink3) }
            else { Text(glyph).font(.system(size: 19)) }
        }
        .frame(width: 36, height: 36)
        .overlay(Circle().stroke(tint, lineWidth: 1))
    }

    // MARK: - the list

    @ViewBuilder private func list(_ P: Palette) -> some View {
        MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    PanelTitle(friends.isEmpty ? "Your friends" : "Your friends (\(friends.count))")
                    Spacer()
                    if !friends.isEmpty {
                        Text(onlineCount == 0 ? "nobody on right now" : "\(onlineCount) on right now")
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundStyle(onlineCount == 0 ? P.ink3 : P.good)
                    }
                }

                if friends.isEmpty {
                    VStack(spacing: 8) {
                        Art.icon(.people, size: 30, tint: P.ink3)
                        Text(loaded ? "Nobody yet" : "Looking…")
                            .font(.system(size: 14, weight: .heavy, design: .rounded))
                            .foregroundStyle(P.ink2)
                        Text("Send somebody your code, or type theirs in above. Once you are friends you can message them and drop straight into their table.")
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 18)
                } else {
                    VStack(spacing: 8) {
                        // Whoever is playing sorts to the top: that is the row
                        // with something to do on it.
                        ForEach(sorted) { entry in row(entry, P) }
                    }
                }
            }
        }
    }

    private var onlineCount: Int {
        friends.filter { ($0.status ?? "offline") != "offline" }.count
    }

    private var sorted: [FriendEntry] {
        let rank = { (e: FriendEntry) -> Int in
            switch e.status ?? "offline" {
            case "lobby": return 0        // a seat you can actually take
            case "playing": return 1
            default: return 2
            }
        }
        return friends.sorted { a, b in
            rank(a) == rank(b) ? a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
                : rank(a) < rank(b)
        }
    }

    private func row(_ entry: FriendEntry, _ P: Palette) -> some View {
        let status: (label: String, tint: Color) = switch entry.status ?? "offline" {
        case "lobby": ("waiting in a lobby", P.gold)
        case "playing": ("in a game", P.good)
        default: ("offline", P.ink3)
        }
        // Their equipped face if they have one, their flag otherwise.
        let face = [entry.avatar ?? "", entry.flag ?? ""].first { !$0.isEmpty } ?? ""
        // Their game is already under way, so the seats are shut: promising a
        // seat and delivering a spectator's view reads as a broken button.
        let started = entry.status != "lobby"

        return VStack(spacing: 9) {
            HStack(spacing: 11) {
                ZStack {
                    Circle().fill(P.sunken)
                    if face.isEmpty { Art.icon(.people, size: 18, tint: P.ink3) }
                    else { Text(face).font(.system(size: 20)) }
                }
                .frame(width: 40, height: 40)
                .overlay(Circle().stroke(status.tint.opacity(entry.status == nil ? 0 : 0.55), lineWidth: 1.5))

                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.name)
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Text(status.label)
                            .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                            .foregroundStyle(status.tint)
                        Text(entry.code)
                            .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                            .foregroundStyle(P.ink3)
                    }
                }
                Spacer(minLength: 4)

                Button {
                    removing = entry
                    Haptics.tap()
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(P.ink3)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove \(entry.name)")
            }

            HStack(spacing: 8) {
                Button {
                    dmFriend = entry
                    Haptics.tap()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "bubble.left.and.bubble.right.fill")
                        Text("Message")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(MMButtonStyle(kind: .ghost))

                if let roomId = entry.roomId {
                    Button {
                        Haptics.tap()
                        dismiss()
                        store.join(roomId: roomId)
                    } label: {
                        HStack(spacing: 6) {
                            Art.icon(started ? .eye : .dice, size: 14)
                            Text(started ? "Watch" : "Join their table")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(MMButtonStyle(kind: started ? .ghost : .primary))
                } else if store.roomId != nil {
                    // The other direction: ask them to come to yours.
                    Button {
                        Task { await invite(entry) }
                    } label: {
                        HStack(spacing: 6) {
                            Art.icon(.people, size: 14)
                            Text(inviting.contains(entry.code) ? "Invited" : "Invite")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(MMButtonStyle(kind: .ghost))
                    .disabled(inviting.contains(entry.code))
                }
            }
        }
        .padding(11)
        .background(P.sunken, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(P.rule, lineWidth: 1))
    }

    // MARK: - the wire

    private func refresh() async {
        await loadProfile()
        await loadFriends()
    }

    private func loadProfile() async {
        profile = try? await store.fetchJSON(
            "/api/profile", method: "POST",
            body: ["token": store.token, "name": store.nickname, "flag": store.flag])
    }

    private struct SocialFeed: Decodable {
        var friends: [FriendEntry] = []
        var requests: [FriendEntry] = []
        var sent: [FriendEntry] = []
    }

    private func loadFriends() async {
        // A dropped read must not blank a list somebody is looking at.
        guard let fresh: SocialFeed = try? await store.fetchJSON(
            "/api/social?token=\(store.token)", raw: true) else { return }
        friends = fresh.friends
        requests = fresh.requests
        sentAsks = fresh.sent
    }

    private func answer(_ entry: FriendEntry, yes: Bool) async {
        struct Reply: Decodable { var ok: Bool? }
        let _: Reply? = try? await store.fetchJSON(
            yes ? "/api/friends/accept" : "/api/friends/decline", method: "POST",
            body: ["token": store.token, "code": entry.code])
        if yes { Haptics.turn(); store.showToast("You are friends now") }
        await loadFriends()
    }

    private func invite(_ entry: FriendEntry) async {
        guard let room = store.roomId else { return }
        struct Reply: Decodable { var ok: Bool?; var error: String? }
        let reply: Reply? = try? await store.fetchJSON(
            "/api/invite", method: "POST",
            body: ["token": store.token, "code": entry.code, "roomId": room])
        if reply?.ok == true {
            inviting.insert(entry.code)
            Haptics.tap()
            store.showToast("Invited \(entry.name)")
        } else {
            store.showToast(reply?.error ?? "Could not invite them", isError: true)
        }
    }

    private func add() async {
        let code = addCode.trimmingCharacters(in: .whitespaces)
        guard code.count >= 4 else { return }
        adding = true
        defer { adding = false }
        struct Reply: Decodable { var ok: Bool?; var error: String? }
        let reply: Reply? = try? await store.fetchJSON(
            "/api/friends", method: "POST", body: ["token": store.token, "code": code])
        if reply?.ok == true {
            addCode = ""
            Haptics.turn()
            store.showToast("Request sent")
            await loadFriends()
        } else {
            store.showToast(reply?.error ?? "No player with that code", isError: true)
        }
    }

    private func drop(_ entry: FriendEntry) async {
        removing = nil
        friends.removeAll { $0.code == entry.code }
        struct Reply: Decodable { var ok: Bool? }
        let _: Reply? = try? await store.fetchJSON(
            "/api/friends/remove", method: "POST",
            body: ["token": store.token, "code": entry.code])
        await loadFriends()
    }
}
