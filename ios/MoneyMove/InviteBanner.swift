// "Come and play" — from a friend, wherever you are.
//
// Being able to walk into a friend's lobby only ever worked one way round.
// This is the other direction: a friend asks you to their table and it turns
// up on your screen whether you are on the home screen or in the middle of a
// game. It is a strip at the top rather than a sheet, because taking the
// board away from somebody mid-turn to ask them a question is rude.

import SwiftUI

struct Invite: Decodable, Equatable {
    var from: String
    var name: String
    var roomId: String
    var at: Double

    /// Enough to tell one invite from the next, so the same one is not
    /// announced twice by two polls in a row.
    var key: String { "\(from):\(roomId):\(Int(at))" }
}

/// One poll for the whole app. It lives at the root because an invite has to
/// find the player in a game as readily as on the home screen.
@MainActor
final class InviteWatch: ObservableObject {
    @Published private(set) var invite: Invite?

    private weak var store: GameStore?
    private var task: Task<Void, Never>?
    /// Invites this device has already shown and had answered or waved away.
    private var done: Set<String> = []

    func start(_ store: GameStore) {
        self.store = store
        guard task == nil else { return }
        task = Task { [weak self] in await self?.watch() }
    }

    private func watch() async {
        while !Task.isCancelled {
            await load()
            try? await Task.sleep(for: .seconds(10))
        }
    }

    func load() async {
        guard let store else { return }
        struct Feed: Decodable { var invite: Invite? }
        guard let feed: Feed = try? await store.fetchJSON(
            "/api/invite?token=\(store.token)", raw: true) else { return }
        guard let fresh = feed.invite else { invite = nil; return }
        // Already sitting at the table they are asking about, or already
        // answered this one: nothing to announce.
        if store.roomId == fresh.roomId || done.contains(fresh.key) { invite = nil; return }
        if invite?.key != fresh.key { Haptics.tap() }
        invite = fresh
    }

    /// Accepted or waved away — either way it is finished with.
    func clear(_ inv: Invite) {
        done.insert(inv.key)
        invite = nil
        guard let store else { return }
        Task {
            struct Reply: Decodable { var ok: Bool? }
            let _: Reply? = try? await store.fetchJSON(
                "/api/invite/clear", method: "POST", body: ["token": store.token])
        }
    }
}

/// The strip itself, hung from the root so it sits over the board.
struct InviteBanner: View {
    @ObservedObject var watch: InviteWatch
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        if let inv = watch.invite {
            HStack(spacing: 11) {
                ZStack {
                    RoundedRectangle(cornerRadius: 11, style: .continuous).fill(P.goldSoft)
                    RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(P.gold, lineWidth: 1)
                    Art.icon(.people, size: 17)
                }
                .frame(width: 34, height: 34)

                VStack(alignment: .leading, spacing: 1) {
                    Text(inv.name)
                        .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                        .lineLimit(1)
                    Text("wants you at their table")
                        .font(.system(size: 11.5, weight: .medium, design: .rounded))
                        .foregroundStyle(P.ink2)
                }
                Spacer(minLength: 4)

                Button("Join") {
                    Haptics.turn()
                    watch.clear(inv)
                    store.join(roomId: inv.roomId)
                }
                .buttonStyle(MMButtonStyle(kind: .primary))

                Button {
                    watch.clear(inv)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(P.ink3)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(11)
            .background(P.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(P.gold, lineWidth: 1))
            .shadow(color: .black.opacity(0.35), radius: 18, y: 8)
            .padding(.horizontal, 14)
            .padding(.top, 6)
            .transition(.move(edge: .top).combined(with: .opacity))
            // A table will have started by the time somebody looks up from
            // whatever else they were doing, so it shows itself out.
            .task(id: inv.key) {
                try? await Task.sleep(for: .seconds(45))
                if watch.invite?.key == inv.key { watch.clear(inv) }
            }
        }
    }
}
