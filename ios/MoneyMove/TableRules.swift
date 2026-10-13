// Two lobby settings and the clock one of them starts (1.0.6): how hard the
// house players play, and how long a game may run.
//
// Both are the host's, in the lobby, and the server validates them like every
// other setting — a refused patch comes back as an error toast and nothing in
// it moves — so the controls here only ever send what was tapped and then
// draw what the next state says. Neither exists at a Play-now table (always
// normal, never a clock) or a cup table (set by the cup), so neither is shown
// there, whatever the field says. docs/API-1.0.6.md is the contract.

import SwiftUI

// MARK: - the two settings

/// settings.botLevel. Normal is exactly the house player 1.0.5 shipped.
enum BotSkill: String, CaseIterable, Identifiable {
    case easy, normal, hard

    var id: String { rawValue }
    var title: String { rawValue.capitalized }

    /// What the choice actually changes, in a line — the server's own table
    /// of buying, building, bidding and trading, said the way a player would.
    var caption: String {
        switch self {
        case .easy: "Careful buyers that build slowly, bid low and never start a trade."
        case .normal: "The house players you know."
        case .hard: "Buys almost anything, races sets to three houses, bids to the sticker."
        }
    }

    /// An older server sends nothing, and plays normal.
    static func of(_ settings: GameSettings?) -> BotSkill {
        BotSkill(rawValue: settings?.botLevel ?? "") ?? .normal
    }
}

/// settings.timeLimit, in minutes. 0 is no limit at all.
enum GameLength {
    static let options = [0, 20, 30, 45, 60]

    static func of(_ settings: GameSettings?) -> Int { settings?.timeLimit ?? 0 }

    /// The segment's own word: short, because five of them share a row.
    static func short(_ minutes: Int) -> String { minutes == 0 ? "Unlimited" : "\(minutes)" }

    /// The setting in a sentence's worth, for the summary and the sheet.
    static func label(_ minutes: Int) -> String { minutes == 0 ? "Unlimited" : "\(minutes)-minute game" }

    static func caption(_ minutes: Int) -> String {
        minutes == 0
            ? "Play until one player is left standing."
            : "When the clock runs out, the richest player still in wins."
    }
}

extension GameState {
    /// The table has a host who chooses its bot skill and its length: not a
    /// Play-now table, not a cup table.
    var hasTableRules: Bool { quick != true && cup != true }
}

// MARK: - the host's card

/// Bot skill and Game length as two segmented rows on one card: in the lobby
/// for the host, and in the settings sheet for everybody — disabled for those
/// who may not change them, exactly as every other row of that sheet is.
struct TableRulesCard: View {
    let editable: Bool

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        let skill = BotSkill.of(store.state?.settings)
        let minutes = GameLength.of(store.state?.settings)
        MMCard {
            VStack(alignment: .leading, spacing: 12) {
                PanelTitle("Opponents & clock")

                row(.robot, "Bot skill", P) {
                    TableSegments(options: BotSkill.allCases.map { ($0, $0.title) },
                                  selected: skill, enabled: editable) { pick in
                        store.updateSettings(["botLevel": pick.rawValue])
                    }
                } caption: { skill.caption }

                Rectangle().fill(P.rule).frame(height: 1)

                row(.clock, "Game length", P) {
                    TableSegments(options: GameLength.options.map { ($0, GameLength.short($0)) },
                                  selected: minutes, enabled: editable) { pick in
                        store.updateSettings(["timeLimit": pick])
                    }
                } caption: {
                    minutes == 0 ? GameLength.caption(0) : "Minutes. " + GameLength.caption(minutes)
                }
            }
        }
    }

    private func row<Control: View>(_ glyph: Glyph, _ title: String, _ P: Palette,
                                    @ViewBuilder control: () -> Control,
                                    caption: () -> String) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                Art.icon(glyph, size: 15, tint: P.ink2)
                Text(title)
                    .font(.system(size: 14.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink)
            }
            control()
            Text(caption())
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink3)
                .fixedSize(horizontal: false, vertical: true)
                .animation(nil, value: caption())
        }
    }
}

/// What everybody but the host reads in the lobby: the two settings, said
/// once, without controls that would only ever be greyed out.
struct TableRulesSummary: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        let skill = BotSkill.of(store.state?.settings)
        let minutes = GameLength.of(store.state?.settings)
        HStack(spacing: 8) {
            chip(.robot, "\(skill.title) bots", P)
            chip(.clock, minutes == 0 ? "No time limit" : GameLength.label(minutes), P)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private func chip(_ glyph: Glyph, _ text: String, _ P: Palette) -> some View {
        HStack(spacing: 5) {
            Art.icon(glyph, size: 13, tint: P.ink2)
            Text(text)
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(P.ink2)
                .lineLimit(1)
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 10)
        .background(P.card, in: Capsule())
        .overlay(Capsule().stroke(P.rule, lineWidth: 1))
    }
}

/// A row of choices with a well that travels to the one the table is on —
/// the leaderboard's switch, for any set of values. The lit segment is the
/// server's value: a tap sends the patch and the well moves when the state
/// that confirms it arrives, so it can never show a setting the table is not
/// actually playing.
struct TableSegments<Value: Hashable>: View {
    let options: [(Value, String)]
    let selected: Value
    var enabled = true
    let pick: (Value) -> Void

    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var lit

    var body: some View {
        let P = Palette.current(scheme)
        let glass = BackdropKind.paper.settledGlass(P)
        let well = glass.ink.opacity(contrast == .increased ? 0.18 : 0.10)
        HStack(spacing: 0) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                let on = option.0 == selected
                Button {
                    guard !on else { return }
                    pick(option.0)
                    Haptics.tap()
                } label: {
                    Text(option.1)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(glass.label(secondary: !on, increaseContrast: contrast == .increased))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .background {
                            if on {
                                RoundedRectangle(cornerRadius: MMRadius.inner(MMRadius.sm + 4, inset: 3),
                                                 style: .continuous)
                                    .fill(well)
                                    .matchedGeometryEffect(id: "lit", in: lit)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .mmGlass(.regular, backdrop: .paper,
                 in: RoundedRectangle(cornerRadius: MMRadius.sm + 4, style: .continuous))
        .transformEnvironment(\.mmGlassQuality) { $0 = min($0, .flat) }
        // 320 ms, the travel every segmented indicator in the app makes;
        // none at all under Reduce Motion.
        .animation(reduceMotion ? nil : .snappy(duration: 0.32), value: selected)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.6)
    }
}

// MARK: - the game clock

/// The whole game's countdown, on the table's top bar: mm:ss of what is left,
/// red for the last two minutes, and "Last turn" once it has run out — the
/// server is the clock, and the game ends when it says so, whatever this
/// reads. Drawn into the bar's glass as a well, the way the turn clock rides
/// a seat: the bar is one pane, and nothing on it is a pane of its own.
struct GameClockChip: View {
    let endsAt: Double
    /// The server says the clock has run out; the turn on the board is the
    /// last one even if this phone's clock disagrees by a second.
    var timeUp = false
    /// The glass this chip is printed on.
    let glass: GlassTokens

    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        let P = Palette.current(scheme)
        let ic = contrast == .increased
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let left = TurnClock.secondsLeft(endsAt, at: context.date)
            let last = timeUp || left == 0
            let urgent = last || left <= 120
            let ink = urgent ? glass.bad(increaseContrast: ic) : glass.label(secondary: true, increaseContrast: ic)
            HStack(spacing: 4) {
                Art.icon(.clock, size: 14, tint: ink)
                Text(last ? "Last turn" : Self.mmss(left))
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(ink)
                    .contentTransition(.numericText(countsDown: true))
            }
            .padding(.vertical, 5)
            .padding(.horizontal, 9)
            .background(urgent ? P.bad.opacity(ic ? 0.26 : 0.14) : glass.ink.opacity(ic ? 0.18 : 0.10),
                        in: Capsule())
            .overlay(Capsule().stroke(urgent ? P.bad.opacity(0.55) : .clear, lineWidth: 1))
            .animation(.snappy(duration: 0.2), value: urgent)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(last ? "Game clock: time's up, last turn"
                                     : "Game clock: \(left / 60) minutes \(left % 60) seconds left")
        }
        .fixedSize()
        .id(endsAt)
    }

    static func mmss(_ seconds: Int) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

/// The result sheet's word on a game the clock decided: nobody was knocked
/// out, so the standings read as the board did at the whistle, and the line
/// says why the richest player is the winner.
struct TimeUpNote: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        HStack(spacing: 8) {
            Art.icon(.clock, size: 17, tint: P.gold)
            VStack(alignment: .leading, spacing: 1) {
                Text("Time's up")
                    .font(.system(size: 14, weight: .heavy, design: .rounded))
                    .foregroundStyle(P.ink)
                Text("The clock ran out, so the richest player still in won.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(P.goldSoft, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(P.gold.opacity(0.6), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}
