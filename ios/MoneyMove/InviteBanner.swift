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
    /// The inviter's flag, shown with their name. Older servers never sent it.
    var flag: String?
    var roomId: String
    var at: Double

    /// Enough to tell one invite from the next, so the same one is not
    /// announced twice by two polls in a row.
    var key: String { "\(from):\(roomId):\(Int(at))" }
}

/// One poll for the whole app. It lives at the root because an invite has to
/// find the player in a game as readily as on the home screen — and it is one
/// shared object rather than the root's own, because a tapped notification
/// arrives through the app delegate, which has no way into a view's state.
@MainActor
final class InviteWatch: ObservableObject {
    static let shared = InviteWatch()

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

    /// The invite's notification was tapped, or arrived with the app open.
    /// Either way the banner goes up now rather than at the next poll; it is
    /// still the banner's Join that accepts, because a tap on a notification
    /// is the player looking, not the player saying yes to a table.
    ///
    /// On a cold start the root has not handed over the store yet, so this
    /// reads nothing — and needs to read nothing: the watch's first poll runs
    /// the moment it starts.
    func notificationArrived() {
        Task { await load() }
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

/// The banner gets a window of its own, above every sheet, for the reason the
/// toasts have one: hung on the root, it is drawn underneath whatever sheet is
/// up. A player who left the results or the friends list open when the phone
/// went into a pocket would tap the invite's notification and come back to a
/// banner they could not see. Unlike a toast the banner has buttons, so this
/// window does take touches — but only the ones that land on the banner.
/// Everything else falls through to the app underneath.
@MainActor
final class InviteWindow {
    static let shared = InviteWindow()
    private var window: BannerWindow?

    func install(_ store: GameStore) {
        guard window == nil else { return }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
        else { return }
        let w = BannerWindow(windowScene: scene)
        let host = UIHostingController(rootView: InviteLayer { [weak w] frame in w?.banner = frame }
            .environmentObject(store))
        host.view.backgroundColor = .clear
        w.rootViewController = host
        w.backgroundColor = .clear
        // Below the toasts, which take no touches and may well be saying
        // something about this very invite.
        w.windowLevel = .alert
        w.isHidden = false
        window = w
    }
}

/// A window that only answers for the banner's own rectangle. Which SwiftUI
/// view sits under a finger is not something UIKit's hit-testing reports the
/// same way on every iOS version, so the banner says where it is instead.
private final class BannerWindow: UIWindow {
    var banner: CGRect = .zero

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard InviteWatch.shared.invite != nil, banner.contains(point) else { return nil }
        return super.hitTest(point, with: event)
    }
}

private struct InviteLayer: View {
    let place: (CGRect) -> Void
    @ObservedObject private var watch = InviteWatch.shared
    /// A hosting controller of its own, like the toast window, so it hears
    /// the glass governor for itself.
    @ObservedObject private var governor = MMGlassGovernor.shared

    var body: some View {
        ZStack(alignment: .top) {
            Color.clear
            InviteBanner(watch: watch, place: place)
        }
        // On the view that contains the banner, or its transition never plays.
        .animation(.spring(duration: 0.35), value: watch.invite)
        .environment(\.mmGlassQuality, governor.level)
    }
}

/// The strip itself, in its own window so it sits over the board and over
/// any sheet.
struct InviteBanner: View {
    @ObservedObject var watch: InviteWatch
    /// Where the strip is, in its window, so the window knows which touches
    /// are the banner's.
    let place: (CGRect) -> Void
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
                    Text([inv.flag ?? "", inv.name].filter { !$0.isEmpty }.joined(separator: " "))
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
                    // The same act as typing the friend's code, so the same
                    // rule: a new table gets the break, and a game this
                    // device still has a seat in is only the way back.
                    let returning = store.unfinishedGames.contains { $0.roomId == inv.roomId }
                    store.join(roomId: inv.roomId)
                    if !returning { InterstitialAd.beforeGame() }
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
            // The card alone, not its margins or shadow: a touch beside the
            // banner belongs to whatever is underneath it.
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { place($0) }
            .shadow(color: .black.opacity(0.35), radius: 18, y: 8)
            .padding(.horizontal, 14)
            .padding(.top, 6)
            .transition(.move(edge: .top).combined(with: .opacity))
            // A table will have started by the time somebody looks up from
            // whatever else they were doing, so it shows itself out. The 45
            // seconds are counted only while the app is in front: a banner
            // that came up as the phone went into a pocket must still be
            // there when its notification brings the player back, and not
            // clear itself — and the invite on the server — the moment the
            // app wakes.
            .task(id: inv.key) {
                var shown = 0
                while shown < 45 {
                    try? await Task.sleep(for: .seconds(1))
                    if Task.isCancelled { return }
                    if UIApplication.shared.applicationState == .active { shown += 1 }
                }
                if watch.invite?.key == inv.key { watch.clear(inv) }
            }
        }
    }
}
