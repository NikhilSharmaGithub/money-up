// Keeping people safe from each other, and letting them leave.
//
// Anywhere a player can read something a stranger wrote — table chat, a
// message thread, a friends row — they can report that person to whoever runs
// the game, and they can block them. Blocking takes effect at once: no
// friendship, no requests, no messages, and their lines hidden on this screen.
//
// And anybody who has an account can delete it from inside the app, which
// removes the person rather than just the sign-in.

import SwiftUI

/// Somebody the player wants to report or block, and where they saw them.
struct SafetyTarget: Identifiable, Equatable {
    var code: String
    var name: String
    /// "chat", "dm", "friend" or "name" — tells the owner where to look.
    var place: String
    /// What they said, as the reporter saw it.
    var quote: String = ""

    var id: String { "\(code)|\(place)|\(quote)" }
}

enum ReportReason: String, CaseIterable, Identifiable {
    case abuse, hate, sexual, spam, cheating, name, other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .abuse: return "Harassment or bullying"
        case .hate: return "Hate speech"
        case .sexual: return "Sexual content"
        case .spam: return "Spam or scams"
        case .cheating: return "Cheating"
        case .name: return "Offensive name"
        case .other: return "Something else"
        }
    }
}

// MARK: - the calls

extension GameStore {
    /// Who this player has blocked, and their own code. Cheap, and asked for
    /// whenever a screen that shows other people's words appears.
    func refreshSafety() async {
        struct Social: Decodable { var blocked: [String]? }
        struct Me: Decodable { var code: String? }
        if let social: Social = try? await fetchJSON("/api/social?token=\(token)", raw: true) {
            blockedCodes = Set(social.blocked ?? [])
        }
        if myCode.isEmpty, let me: Me = try? await fetchJSON("/api/me?token=\(token)", raw: true) {
            myCode = me.code ?? ""
        }
    }

    @discardableResult
    func block(_ target: SafetyTarget) async -> Bool {
        struct Reply: Decodable { var ok: Bool?; var error: String?; var blocked: [String]? }
        let reply: Reply? = try? await fetchJSON(
            "/api/block", method: "POST", body: ["token": token, "code": target.code])
        guard reply?.ok == true else {
            showToast(reply?.error ?? "Couldn't block them — try again.", isError: true)
            return false
        }
        blockedCodes = Set(reply?.blocked ?? []).union([target.code])
        Haptics.tap()
        showToast("Blocked \(target.name). Their messages are hidden and they can't friend or message you.")
        return true
    }

    func unblock(_ code: String) async {
        struct Reply: Decodable { var ok: Bool?; var blocked: [String]? }
        let reply: Reply? = try? await fetchJSON(
            "/api/unblock", method: "POST", body: ["token": token, "code": code])
        if reply?.ok == true { blockedCodes = Set(reply?.blocked ?? []) }
    }

    func report(_ target: SafetyTarget, reason: ReportReason) async {
        struct Reply: Decodable { var ok: Bool?; var error: String? }
        let reply: Reply? = try? await fetchJSON(
            "/api/report", method: "POST",
            body: ["token": token, "code": target.code, "reason": reason.rawValue,
                   "where": target.place, "text": target.quote])
        if reply?.ok == true {
            Haptics.tap()
            showToast("Thanks — we'll look into it. You can also block \(target.name).")
        } else {
            showToast(reply?.error ?? "Couldn't send that report — try again.", isError: true)
        }
    }

    /// Delete the account on the server, then become somebody new here.
    func deleteAccount() async -> Bool {
        struct Reply: Decodable { var ok: Bool? }
        let reply: Reply? = try? await fetchJSON(
            "/api/account/delete", method: "POST", body: ["token": token])
        guard reply?.ok == true else {
            showToast("Couldn't delete your account — check your connection and try again.", isError: true)
            return false
        }
        startFresh()
        showToast("Your account and everything in it has been deleted.")
        return true
    }
}

// MARK: - the dialogs

/// Report and block, from anywhere.
///
/// `choose` asks what to do about somebody; `report` goes straight to the
/// reasons — a long-press menu that already offered "Report" should not ask
/// twice.
struct SafetyDialogs: ViewModifier {
    @Binding var choose: SafetyTarget?
    @Binding var report: SafetyTarget?
    var onBlocked: (SafetyTarget) -> Void = { _ in }

    @EnvironmentObject var store: GameStore

    func body(content: Content) -> some View {
        content
            .confirmationDialog(
                choose.map { "\($0.name)" } ?? "",
                isPresented: Binding(get: { choose != nil }, set: { if !$0 { choose = nil } }),
                titleVisibility: .visible,
                presenting: choose
            ) { target in
                Button("Report \(target.name)…") {
                    // One dialog has to finish leaving before the next arrives.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { report = target }
                }
                Button("Block \(target.name)", role: .destructive) {
                    Task { if await store.block(target) { onBlocked(target) } }
                }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text("Blocking hides their messages, removes them from your friends and stops them contacting you.")
            }
            .confirmationDialog(
                "Why are you reporting \(report?.name ?? "them")?",
                isPresented: Binding(get: { report != nil }, set: { if !$0 { report = nil } }),
                titleVisibility: .visible,
                presenting: report
            ) { target in
                ForEach(ReportReason.allCases) { reason in
                    Button(reason.label) { Task { await store.report(target, reason: reason) } }
                }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text("Reports go to the MoneyMove team. We review every one and remove players who abuse others.")
            }
    }
}

extension View {
    func safetyDialogs(choose: Binding<SafetyTarget?>, report: Binding<SafetyTarget?>,
                       onBlocked: @escaping (SafetyTarget) -> Void = { _ in }) -> some View {
        modifier(SafetyDialogs(choose: choose, report: report, onBlocked: onBlocked))
    }
}

// MARK: - community rules

/// Shown once, before a player first writes anything other people will read.
///
/// Talking to strangers comes with rules, and the place to say so is the
/// moment somebody is about to start — not a page they will never open.
struct CommunityRulesCard: View {
    @AppStorage("mm.rulesAgreed") private var agreed = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        if !agreed {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 7) {
                    Art.icon(.shield, size: 15, tint: P.gold)
                    Text("Before you chat")
                        .font(.system(size: 14, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.ink)
                }
                Text("Be kind. There is zero tolerance for harassment, hate, sexual content or threats — players who break this are removed. Long-press any message to report or block someone.")
                    .font(.system(size: 12.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                Button("I agree") {
                    Haptics.tap()
                    withAnimation(.snappy(duration: 0.2)) { agreed = true }
                }
                .buttonStyle(MMButtonStyle(kind: .primary))
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(P.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(P.gold.opacity(0.6), lineWidth: 1))
        }
    }

    /// Whether writing is allowed yet — the input stays disabled until then.
    static var hasAgreed: Bool { UserDefaults.standard.bool(forKey: "mm.rulesAgreed") }
}

// MARK: - account & help

/// The bottom of Settings: where to read the rules, who to write to, who you
/// have blocked, and the way out.
struct AccountHelpCard: View {
    var onDeleted: () -> Void = {}

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @State private var confirmDelete = false
    @State private var deleting = false
    @State private var showBlocked = false

    private static let site = "https://www.moneymove.live"
    private static let contact = "usernamenikhilsharma@gmail.com"

    var body: some View {
        let P = Palette.current(scheme)
        MMCard {
            VStack(alignment: .leading, spacing: 4) {
                PanelTitle("Account & help")
                    .padding(.bottom, 4)

                linkRow("Privacy Policy", systemImage: "hand.raised", url: "\(Self.site)/privacy", P)
                linkRow("Support & community rules", systemImage: "questionmark.circle", url: "\(Self.site)/support", P)
                linkRow("Contact us", systemImage: "envelope", url: "mailto:\(Self.contact)", P)

                Button {
                    showBlocked = true
                } label: {
                    row("Blocked players", systemImage: "hand.raised.slash",
                        detail: store.blockedCodes.isEmpty ? "None" : "\(store.blockedCodes.count)", P)
                }
                .buttonStyle(.plain)

                Divider().overlay(P.rule).padding(.vertical, 6)

                Button {
                    confirmDelete = true
                } label: {
                    HStack(spacing: 10) {
                        if deleting { ProgressView().tint(P.bad) }
                        else { Image(systemName: "trash").font(.system(size: 14, weight: .semibold)) }
                        Text("Delete account")
                            .font(.system(size: 14.5, weight: .bold, design: .rounded))
                        Spacer()
                    }
                    .foregroundStyle(P.bad)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(deleting)

                Text("Permanently removes your profile, coins, purchases, friends and messages. This can't be undone.")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete account", role: .destructive) {
                Task {
                    deleting = true
                    let done = await store.deleteAccount()
                    deleting = false
                    if done { onDeleted() }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your profile, coins, anything you bought, your friends and your messages will be deleted for good.")
        }
        .sheet(isPresented: $showBlocked) {
            BlockedPlayersSheet().environmentObject(store)
        }
        .task { await store.refreshSafety() }
    }

    private func linkRow(_ title: String, systemImage: String, url: String, _ P: Palette) -> some View {
        Link(destination: URL(string: url)!) {
            row(title, systemImage: systemImage, detail: nil, P)
        }
    }

    private func row(_ title: String, systemImage: String, detail: String?, _ P: Palette) -> some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(P.ink2)
                .frame(width: 22)
            Text(title)
                .font(.system(size: 14.5, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink)
            Spacer()
            if let detail {
                Text(detail)
                    .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(P.ink3)
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}

/// Everyone this player has blocked, with a way back.
struct BlockedPlayersSheet: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                VStack(spacing: 8) {
                    if store.blockedCodes.isEmpty {
                        Text("You haven't blocked anyone.")
                            .font(.system(size: 13.5, weight: .medium, design: .rounded))
                            .foregroundStyle(P.ink3)
                            .padding(.top, 40)
                    }
                    ForEach(store.blockedCodes.sorted(), id: \.self) { code in
                        HStack {
                            Text(code)
                                .font(.system(size: 14, weight: .bold, design: .monospaced))
                                .foregroundStyle(P.ink)
                            Spacer()
                            Button("Unblock") { Task { await store.unblock(code) } }
                                .buttonStyle(MMButtonStyle(kind: .ghost))
                        }
                        .padding(12)
                        .background(P.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
                .padding(16)
            }
            .background(P.sheet.ignoresSafeArea())
            .navigationTitle("Blocked players")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
