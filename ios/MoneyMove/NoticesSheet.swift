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
///
/// A control floating on the page, so it is a disc of glass rather than a
/// paper circle with a ring drawn round it. News is the brass bell and the
/// count; the gold outline the paper circle wore for it is gone, because the
/// rim is already brass and a second gold line beside it would be a sticker's
/// border. Nor does the glass take a tint for it — on 26 a tinted pane is a
/// slab of the colour, and a gold slab behind a gold bell hides the bell.
struct NoticeBell: View {
    @ObservedObject var watch: NoticeWatch
    var action: () -> Void

    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.mmControlBackdrop) private var declared

    /// It stands beside the Social tab's title, on the page itself and not on
    /// a card, so that is its backdrop — unless whatever holds it has declared
    /// itself glass, in which case it is drawn on that glass instead of as a
    /// second pane over it.
    private var backdrop: BackdropKind { declared == .chrome ? .chrome : .page }

    var body: some View {
        let P = Palette.current(scheme)
        let news = watch.unread > 0
        Button(action: action) {
            Image(systemName: news ? "bell.badge.fill" : "bell.fill")
                .font(.system(size: 16, weight: .semibold))
                // Quiet, it is the glass's second ink: the third rank the
                // paper circle used measures 1.53:1 on glass.
                .foregroundStyle(news ? P.gold : backdrop.settledGlass(P)
                    .label(secondary: true, increaseContrast: contrast == .increased))
                .frame(width: 38, height: 38)
        }
        .buttonStyle(MMButtonStyle(kind: .ghost, form: .disc))
        .mmControls(on: backdrop)
        .accessibilityLabel(news ? "\(watch.unread) unread notes" : "Notes")
        // The count rides outside the glass, over its shoulder: the material
        // is free to clip what it holds to its own circle, and a badge is
        // meant to break the edge.
        .overlay(alignment: .topTrailing) {
            if news {
                Text("\(min(watch.unread, 9))")
                    .font(.system(size: 10, weight: .black, design: .rounded))
                    .foregroundStyle(P.accentInk)
                    .frame(width: 17, height: 17)
                    .background(P.red, in: Circle())
                    .offset(x: 3, y: -2)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
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
            .navigationTitle("Notes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .sheetBarItem(on: .page)
                }
            }
        }
        .mmControls(on: .platter(.page))
        .sheetPaper(P.page)
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
