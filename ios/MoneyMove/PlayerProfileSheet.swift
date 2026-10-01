// Somebody else, opened from a result: what they have won, how long they have
// been at it, and the one thing to do about them — ask to be friends.
//
// A seat's id is no use for this. Every other player's id reaches this phone
// as an alias good for one table only, so the friend code the standings used
// to compute from it named nobody, and its add button answered "No player with
// that code" for every person it was ever pressed on. The state carries each
// seat's public code now — the same code its chat lines already carry — and a
// profile is read by that. House players have one too, and a profile like
// anybody else's: nothing on this sheet says who is a person.

import SwiftUI

/// GET /api/player. Optional throughout, so a field a server leaves out never
/// sinks the read; `error` arrives instead of the rest when there is nobody
/// to show.
struct PlayerProfile: Decodable {
    struct Title: Decodable {
        var title: String
        var count: Int?
    }

    var code: String?
    var name: String?
    var flag: String?
    /// Their equipped store face, as an emoji; empty when they wear none.
    var avatar: String?
    var wins: Int?
    var games: Int?
    /// Coins won, all-time.
    var winnings: Int?
    /// Up to three, most earned first.
    var titles: [Title]?
    /// Epoch ms of their first game, for "Playing since".
    var since: Double?
    /// "self" | "friend" | "sent" | "asked" | "none" — where the viewer stands.
    var relation: String?
    var error: String?
}

struct PlayerProfileSheet: View {
    /// The seat that was tapped, as the result remembers it — enough to draw
    /// the top of the sheet while the profile is still on its way.
    let seat: PlayerResult

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss
    @State private var profile: PlayerProfile?
    @State private var failure: String?
    /// Moves on its own once a request is sent or accepted, without another
    /// read of the whole profile.
    @State private var relation = "none"
    @State private var busy = false

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    header(P)
                    if let profile {
                        record(profile, P)
                        action(P)
                    } else if let failure {
                        failed(failure, P)
                    } else {
                        ProgressView()
                            .tint(P.ink3)
                            .frame(maxWidth: .infinity, minHeight: 120)
                    }
                }
                .padding(16)
            }
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .sheetBarItem(on: .sheet)
                }
            }
        }
        // The action stands straight on the sheet; the record declares its
        // own paper.
        .mmControls(on: .platter(.sheet))
        .sheetPaper(P.sheet)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await load() }
    }

    // MARK: - who

    /// Fresh from the profile once it lands — a name or a face may have
    /// changed since that game — and the seat's own until then.
    private var name: String { filled(profile?.name) ?? seat.name }
    private var flag: String { filled(profile?.flag) ?? seat.flag ?? "" }
    private var face: String { filled(profile?.avatar) ?? seat.avatar ?? "" }

    private func filled(_ text: String?) -> String? {
        guard let text, !text.isEmpty else { return nil }
        return text
    }

    private func header(_ P: Palette) -> some View {
        VStack(spacing: 10) {
            // The seat's own colour behind the initial, the one they played
            // in; the flag stands beside the name rather than on the disc.
            AvatarView(name: name, colorCSS: seat.color, flag: "", size: 72, emoji: face)
            HStack(spacing: 7) {
                if !flag.isEmpty {
                    Text(flag).font(.system(size: 20))
                }
                Text(name)
                    .font(.system(size: 21, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
    }

    // MARK: - what they have done

    private func record(_ p: PlayerProfile, _ P: Palette) -> some View {
        let wins = p.wins ?? 0
        // Nobody has won a game they did not play, so the wins are the floor.
        let games = max(p.games ?? 0, wins)
        let titles = Array((p.titles ?? []).prefix(3))
        return MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                PanelTitle("Record")
                HStack(alignment: .top, spacing: 0) {
                    TallyCell(value: "\(wins)", label: "WINS")
                    TallyCell(value: "\(games)", label: "GAMES")
                    TallyCell(value: games > 0 ? "\(Int((Double(wins) / Double(games) * 100).rounded()))%" : "–",
                              label: "WIN RATE")
                    TallyCell(value: (p.winnings ?? 0).formatted(), label: "COINS WON")
                }
                if let since = p.since, since > 0 {
                    Text("Playing since \(Date(timeIntervalSince1970: since / 1000).formatted(.dateTime.month(.abbreviated).year()))")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink3)
                        .frame(maxWidth: .infinity)
                }
                if !titles.isEmpty {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 8)],
                              alignment: .leading, spacing: 8) {
                        ForEach(titles, id: \.title) { badge in
                            TitleChip(title: badge.title, count: badge.count ?? 1)
                        }
                    }
                }
            }
        }
    }

    private func failed(_ message: String, _ P: Palette) -> some View {
        VStack(spacing: 10) {
            Text(message)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Try again") {
                failure = nil
                Task { await load() }
            }
            .buttonStyle(MMButtonStyle(kind: .ghost))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
    }

    // MARK: - the one thing to do

    @ViewBuilder private func action(_ P: Palette) -> some View {
        switch relation {
        case "self":
            EmptyView()
        case "friend":
            settled("Friends", symbol: "checkmark")
        case "sent":
            // Waiting on them — and on a house player, waiting for good. It
            // reads exactly the same either way.
            settled("Request sent", symbol: "clock")
        case "asked":
            button("Accept request", symbol: "person.crop.circle.badge.checkmark") {
                await answer(accept: true)
            }
        default:
            button("Add friend", symbol: "person.badge.plus") {
                await answer(accept: false)
            }
        }
    }

    /// Gold, as Add and Accept are on the friends list.
    private func button(_ title: String, symbol: String,
                        _ act: @escaping () async -> Void) -> some View {
        Button {
            Task { await act() }
        } label: {
            HStack(spacing: 7) {
                if busy { ProgressView().tint(Palette.current(scheme).accentInk) }
                else { Image(systemName: symbol) }
                Text(title)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(MMButtonStyle(kind: .gold, big: true))
        .disabled(busy)
    }

    /// A state rather than a button: there is nothing left to press.
    private func settled(_ title: String, symbol: String) -> some View {
        Button {} label: {
            HStack(spacing: 7) {
                Image(systemName: symbol)
                Text(title)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
        .disabled(true)
    }

    // MARK: - the wire

    private func load() async {
        guard let code = seat.code, !code.isEmpty else {
            failure = "This player has no profile."
            return
        }
        let query = code.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? code
        // The query string means raw mode — fetchJSON's normal path builder
        // percent-encodes the "?".
        guard let fresh: PlayerProfile = try? await store.fetchJSON(
            "/api/player?code=\(query)&token=\(store.token)", raw: true) else {
            failure = "Couldn't reach the server — try again."
            return
        }
        if let error = fresh.error {
            failure = error
            return
        }
        relation = fresh.relation ?? "none"
        profile = fresh
    }

    /// Asking, or answering somebody who already asked. A request to someone
    /// who had asked first is a yes on the server's side too, so either way
    /// the reply says which it came to.
    private func answer(accept: Bool) async {
        guard let code = seat.code, !busy else { return }
        busy = true
        defer { busy = false }
        Haptics.tap()
        struct Reply: Decodable {
            var ok: Bool?
            var sent: Bool?
            var accepted: Bool?
            var already: Bool?
            var error: String?
        }
        let reply: Reply? = try? await store.fetchJSON(
            accept ? "/api/friends/accept" : "/api/friends", method: "POST",
            body: ["token": store.token, "code": code])
        if reply?.accepted == true {
            relation = "friend"
            Haptics.turn()
            store.showToast("You and \(name) are friends now")
        } else if reply?.already == true {
            // Friends since the profile was read — from another device, or
            // the friends list. Nothing went wrong, so nothing to say.
            relation = "friend"
        } else if reply?.ok == true {
            relation = "sent"
            store.showToast("Request sent")
        } else {
            store.showToast(reply?.error ?? "Couldn't reach the server — try again.", isError: true)
        }
    }
}
