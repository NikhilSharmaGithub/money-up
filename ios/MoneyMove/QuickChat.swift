// Quick chat (1.0.6): eight things people say at a table, one tap each.
//
// A phrase goes out as an ordinary chat line — the server's chat is unchanged,
// and the table reads it exactly as if it had been typed. The same eight, in
// the same order, on the web and on Android, so a "GG" means the same thing
// from every client.
//
// Like the reactions, these are a fixed set nobody can turn into abuse, so
// they do not wait for the community rules to be agreed to the way free text
// does. They do wait for each other: the chat has no rate limit of its own on
// the server, so a row of one-tap buttons is the one place a thumb could
// flood a table, and the pause below is what stops it.

import SwiftUI

enum QuickChat {
    static let phrases = [
        "Good luck!", "Nice move!", "Want to trade?", "Ouch!",
        "So close!", "Hurry up!", "Thanks!", "GG",
    ]

    /// The gap between two quick lines, wherever they are sent from — the
    /// chat sheet and the Play-now lobby share it, so switching rows is no
    /// way around it.
    static let cooldown: TimeInterval = 2.5

    @MainActor static var lastSent = Date.distantPast

    /// Sends one if the pause allows it, and says whether it did.
    @MainActor
    static func send(_ phrase: String, with send: (String) -> Void) -> Bool {
        guard Date().timeIntervalSince(lastSent) >= cooldown else { return false }
        lastSent = Date()
        send(phrase)
        return true
    }
}

/// The phrases as a scrolling row of chips. It draws the chips only; whoever
/// places it decides what they stand on — a strip of the chat sheet's glass,
/// or the lobby's page — and hands over the ink and the well to match.
struct QuickChatRow: View {
    /// Each chip's fill, and the ink its words are printed in.
    let well: Color
    let ink: Color
    let send: (String) -> Void

    /// Until when the chips rest after a send. Started from the shared stamp,
    /// so a row that has just appeared knows a line went out a moment ago.
    @State private var coolUntil: Date?

    var body: some View {
        let resting = coolUntil.map { $0 > Date() } ?? false
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(QuickChat.phrases, id: \.self) { phrase in
                    Button {
                        if QuickChat.send(phrase, with: send) {
                            Haptics.tap()
                            rest()
                        } else {
                            Haptics.warn()
                        }
                    } label: {
                        Text(phrase)
                            .font(.system(size: 13, weight: .bold, design: .rounded))
                            .foregroundStyle(ink)
                            .lineLimit(1)
                            .fixedSize()
                            .padding(.vertical, 8)
                            .padding(.horizontal, 12)
                            .background(well, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Sends it to the table")
                }
            }
            .padding(4)
        }
        // Resting, the chips step back rather than vanish — the row stays
        // where the thumb expects it, and says it will be back in a moment.
        .opacity(resting ? 0.45 : 1)
        .animation(.easeOut(duration: 0.2), value: resting)
        .onAppear {
            let until = QuickChat.lastSent.addingTimeInterval(QuickChat.cooldown)
            if until > Date() { rest(until: until) }
        }
    }

    private func rest(until: Date = Date().addingTimeInterval(QuickChat.cooldown)) {
        coolUntil = until
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(max(0, until.timeIntervalSinceNow)))
            if coolUntil == until { coolUntil = nil }
        }
    }
}
