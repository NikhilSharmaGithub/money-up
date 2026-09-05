// Notes from whoever runs the game.
//
// One way only: the owner writes, players read, nobody replies. It exists for
// the two things a tournament needs a voice for — telling the field when the
// next round is, and telling a winner their prize is on its way — and being
// one-way is the point. A player who is sent a note cannot be dragged into a
// conversation they did not ask for.
//
// A note written to one person is marked as such. "You won" reads very
// differently from "everybody won", and the app should never blur the two.

import SwiftUI

struct Notice: Decodable, Equatable, Identifiable {
    var id: String
    var text: String
    var title: String?
    var at: Double
    /// Written to this player alone, rather than to the whole field.
    var personal: Bool = false
    var unread: Bool = false

    var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

/// One poll for the tab: the bell needs a count whether or not the sheet is
/// open, so the count lives out here.
@MainActor
final class NoticeWatch: ObservableObject {
    @Published private(set) var notices: [Notice] = []
    @Published private(set) var unread = 0

    private weak var store: GameStore?
    private var task: Task<Void, Never>?

    func start(_ store: GameStore) {
        self.store = store
        guard task == nil else { return }
        task = Task { [weak self] in
            while !Task.isCancelled {
                await self?.load()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    func load() async {
        guard let store else { return }
        struct Feed: Decodable { var notices: [Notice] = []; var unread = 0 }
        guard let feed: Feed = try? await store.fetchJSON(
            "/api/notices?token=\(store.token)", raw: true) else { return }
        notices = feed.notices
        unread = feed.unread
    }

    /// Opening the list is reading it.
    func markRead() {
        guard unread > 0, let store else { return }
        unread = 0
        notices = notices.map { var n = $0; n.unread = false; return n }
        Task {
            struct Reply: Decodable { var ok: Bool? }
            let _: Reply? = try? await store.fetchJSON(
                "/api/notices/read", method: "POST", body: ["token": store.token])
        }
    }
}

/// The bell itself, for the top of the Social tab.
struct NoticeBell: View {
    @ObservedObject var watch: NoticeWatch
    var action: () -> Void

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        Button(action: action) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: watch.unread > 0 ? "bell.badge.fill" : "bell.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(watch.unread > 0 ? P.gold : P.ink3)
                    .frame(width: 38, height: 38)
                    .background(P.sunken, in: Circle())
                    .overlay(Circle().stroke(watch.unread > 0 ? P.gold : P.rule, lineWidth: 1))
                if watch.unread > 0 {
                    Text("\(min(watch.unread, 9))")
                        .font(.system(size: 10, weight: .black, design: .rounded))
                        .foregroundStyle(P.accentInk)
                        .frame(width: 17, height: 17)
                        .background(P.red, in: Circle())
                        .offset(x: 3, y: -2)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(watch.unread > 0 ? "\(watch.unread) unread notes" : "Notes")
    }
}

struct NoticesSheet: View {
    @ObservedObject var watch: NoticeWatch

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                if watch.notices.isEmpty {
                    VStack(spacing: 9) {
                        Image(systemName: "bell.slash")
                            .font(.system(size: 26))
                            .foregroundStyle(P.ink3)
                        Text("Nothing yet")
                            .font(.system(size: 15, weight: .heavy, design: .rounded))
                            .foregroundStyle(P.ink2)
                        Text("Announcements about tournaments — when a round opens, when a prize is on its way — turn up here.")
                            .font(.system(size: 12.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 30)
                    .padding(.top, 70)
                } else {
                    VStack(spacing: 10) {
                        ForEach(watch.notices) { n in row(n, P) }
                    }
                    .padding(16)
                }
            }
            .background(P.page.ignoresSafeArea())
            .navigationTitle("Notes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
        .task {
            await watch.load()
            // Reading it is reading it — but leave the dots up for a beat so
            // somebody can see which ones were new.
            try? await Task.sleep(for: .seconds(1.2))
            watch.markRead()
        }
    }

    private func row(_ n: Notice, _ P: Palette) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                if n.personal {
                    Text("FOR YOU")
                        .font(.system(size: 8.5, weight: .black, design: .rounded))
                        .kerning(0.6)
                        .foregroundStyle(P.accentInk)
                        .padding(.vertical, 2).padding(.horizontal, 7)
                        .background(P.gold, in: Capsule())
                }
                if let t = n.title, !t.isEmpty {
                    Text(t)
                        .font(.system(size: 14.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                }
                Spacer(minLength: 4)
                if n.unread { Circle().fill(P.red).frame(width: 8, height: 8) }
            }
            Text(n.text)
                .font(.system(size: 13.5, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink2)
                .fixedSize(horizontal: false, vertical: true)
            Text(n.date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute()))
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(13)
        .background(n.personal ? P.goldSoft : P.sunken,
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .stroke(n.personal ? P.gold : P.rule, lineWidth: 1))
    }
}
