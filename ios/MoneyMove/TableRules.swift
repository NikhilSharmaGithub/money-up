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

/// settings.bankruptProperties (round 2, G5): where a bankrupt player's
/// properties go. Release is exactly the rule every older table plays.
enum EstateRule: String, CaseIterable, Identifiable {
    case release, auction

    var id: String { rawValue }

    /// The segment's word, as the lobby says it.
    var title: String {
        switch self {
        case .release: "Back to the bank"
        case .auction: "Auction them"
        }
    }

    var caption: String {
        switch self {
        case .release: "A bankrupt player’s properties go back to the bank, unowned."
        case .auction: "A bankrupt player’s properties are auctioned to everyone left, one at a time."
        }
    }

    /// An older server sends nothing, and releases them.
    static func of(_ settings: GameSettings?) -> EstateRule {
        EstateRule(rawValue: settings?.bankruptProperties ?? "") ?? .release
    }
}

extension GameState {
    /// The table has a host who chooses its bot skill and its length: not a
    /// Play-now table, not a cup table. The three round-2 rules (bankrupt
    /// properties, auction-only, the shuffled board) follow the same line.
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

/// The three round-2 rules as one card (1.0.6): what a bankrupt player's
/// properties do (G5), auction-only buying (G6) and the shuffled board (G7).
/// The host's, in the lobby and the settings sheet; disabled for everybody
/// else in the sheet, like every row there. Never at a Play-now or cup table,
/// which always play the defaults — the server refuses all three there.
///
/// Like the card above, nothing here holds a value of its own: a tap sends the
/// patch and the control moves when the state that confirms it arrives. That
/// matters for auction-only, which the server ties to auctions — switching it
/// on turns auctions on, and switching auctions off turns it off — so both
/// toggles always read what the table will really play.
struct TableTwistsCard: View {
    let editable: Bool

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        let settings = store.state?.settings
        let estate = EstateRule.of(settings)
        MMCard {
            VStack(alignment: .leading, spacing: 12) {
                PanelTitle("Auctions & board")

                VStack(alignment: .leading, spacing: 7) {
                    label(.skull, "Bankrupt properties", P)
                    TableSegments(options: EstateRule.allCases.map { ($0, $0.title) },
                                  selected: estate, enabled: editable) { pick in
                        store.updateSettings(["bankruptProperties": pick.rawValue])
                    }
                    caption(estate.caption, P)
                }

                Rectangle().fill(P.rule).frame(height: 1)

                toggle(.gavel, "Auction only",
                       caption: settings?.auctionOnly == true
                           ? "No Buy button: every unowned property goes straight to auction, with its price as the guide."
                           : "Land on an unowned property and you may buy it at its price.",
                       key: "auctionOnly", isOn: settings?.auctionOnly ?? false, P)

                Rectangle().fill(P.rule).frame(height: 1)

                toggle(.shuffle, "Shuffle the board",
                       caption: "At the start the colour sets swap places with sets of the same size, so pricey streets can sit right after START.",
                       key: "shuffleBoard", isOn: settings?.shuffleBoard ?? false, P)
            }
        }
    }

    private func label(_ glyph: Glyph, _ title: String, _ P: Palette) -> some View {
        HStack(spacing: 6) {
            Art.icon(glyph, size: 15, tint: P.ink2)
            Text(title)
                .font(.system(size: 14.5, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink)
        }
    }

    private func caption(_ text: String, _ P: Palette) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .medium, design: .rounded))
            .foregroundStyle(P.ink3)
            .fixedSize(horizontal: false, vertical: true)
            .animation(nil, value: text)
    }

    private func toggle(_ glyph: Glyph, _ title: String, caption text: String,
                        key: String, isOn: Bool, _ P: Palette) -> some View {
        Toggle(isOn: Binding(get: { isOn },
                             set: { store.updateSettings([key: $0]) })) {
            VStack(alignment: .leading, spacing: 3) {
                label(glyph, title, P)
                caption(text, P)
            }
        }
        .tint(P.red)
        .disabled(!editable)
        .opacity(editable ? 1 : 0.6)
    }
}

/// What everybody but the host reads in the lobby: the settings, said once,
/// without controls that would only ever be greyed out. The round-2 rules
/// only say anything when they are on — a table playing the printed board
/// and the usual buying has nothing there to warn anybody about.
struct TableRulesSummary: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        let settings = store.state?.settings
        let skill = BotSkill.of(settings)
        let minutes = GameLength.of(settings)
        FlowRow(spacing: 8) {
            chip(.robot, "\(skill.title) bots", P)
            chip(.clock, minutes == 0 ? "No time limit" : GameLength.label(minutes), P)
            if settings?.auctionOnly == true { chip(.gavel, "Auction only", P) }
            if settings?.shuffleBoard == true { chip(.shuffle, "Shuffled board", P) }
            if EstateRule.of(settings) == .auction { chip(.skull, "Bankrupt estates auctioned", P) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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

// MARK: - this table's rules

/// "This table's rules", from the info key beside the sound on the table's
/// bar (1.0.6): every rule the table is playing, said in plain words, for a
/// player who sat down after the lobby, a stranger matchmaking dealt in, and
/// anybody watching from the rail. Read-only, and read straight off
/// `state.settings`, so it can never describe a table other than the one on
/// screen. The rules a Play-now or cup table cannot have (house-player skill,
/// a game clock, the three round-2 rules) read as the defaults it plays,
/// whatever the fields say — the server plays them that way too. The one
/// exception is a cup table's length: it has no game clock, but the cup's
/// whistle ends it all the same, and the sheet says so.
struct TableRulesSheet: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    /// One line of the sheet: what the rule is called, where this table has
    /// it, and what that means at the table.
    private struct Rule: Identifiable {
        let glyph: Glyph
        let title: String
        let value: String?
        /// Off reads quieter than on, so the rules in play stand out.
        var dim = false
        let caption: String
        var id: String { title }
    }

    /// A card of the sheet: a heading and its rules.
    private struct Section: Identifiable {
        let title: String
        let rules: [Rule]
        var id: String { title }
    }

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if let state = store.state {
                        ForEach(sections(state)) { section in
                            MMCard(padding: 16) {
                                VStack(alignment: .leading, spacing: 12) {
                                    PanelTitle(section.title)
                                    ForEach(Array(section.rules.enumerated()), id: \.element.id) { k, rule in
                                        if k > 0 { Rectangle().fill(P.rule).frame(height: 1) }
                                        row(rule, P)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .navigationTitle("This table's rules")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .sheetBarItem(on: .sheet)
                }
            }
        }
        .mmControls(on: .platter(.sheet))
        .sheetPaper(P.sheet)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func row(_ rule: Rule, _ P: Palette) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Art.icon(rule.glyph, size: 18, tint: P.ink2)
                .frame(width: 22, height: 22)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(rule.title)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                    if let value = rule.value {
                        Text(value)
                            .font(.system(size: 13.5, weight: .heavy, design: .rounded))
                            .foregroundStyle(rule.dim ? P.ink3 : P.ink)
                            .multilineTextAlignment(.trailing)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
                Text(rule.caption)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: - the rules, in words

    private func sections(_ state: GameState) -> [Section] {
        let s = state.settings
        // A Play-now or a cup table plays the defaults of everything its host
        // cannot set, whatever the field says (ruleOn in server/game.js).
        let hosted = state.hasTableRules

        func on(_ value: Bool?, _ fallback: Bool) -> Bool { value ?? fallback }
        func flag(_ isOn: Bool) -> String { isOn ? "On" : "Off" }

        // The board, and what the round-2 shuffle did to it.
        let shuffle = hosted && on(s.shuffleBoard, false)
        let shuffled = state.map.shuffled == true
        let board = Rule(glyph: mapGlyph(state.map.icon), title: "Board", value: state.map.name,
                         caption: shuffled ? "Shuffled for this game: the colour sets sit in new places."
                                           : "Played as it is printed.")
        let shuffleRule = Rule(
            glyph: .shuffle, title: "Shuffled board", value: flag(shuffle), dim: !shuffle,
            caption: !shuffle ? "Every street stays where the board prints it."
                : state.isLobby ? "When the game starts the colour sets trade places with sets of the same size. Each keeps its streets, prices and rents; corners, cards, taxes, airports and utilities stay put."
                : "The colour sets traded places with sets of the same size when the game started. Each kept its streets, prices and rents.")
        let cash = Rule(glyph: .cash, title: "Starting cash", value: money(s.startingCash),
                        caption: "What every player starts the game with.")

        // Rent and money.
        let x2 = on(s.x2rent, true)
        let double = Rule(glyph: .payment, title: "Double rent on full sets", value: flag(x2), dim: !x2,
                          caption: x2 ? "A street with no houses charges double once one player owns its whole set."
                                      : "A full set charges the printed rent until it is built on.")
        let pot = on(s.vacationCash, true)
        let potNow = (state.isPlaying ? state.vacationPot : nil) ?? 0
        let vacation = Rule(glyph: .island, title: "Vacation cash pot", value: flag(pot), dim: !pot,
                            caption: pot ? "Taxes and fees pile up on Vacation, and whoever lands there takes the pot."
                                + (potNow > 0 ? " \(money(potNow)) in it now." : "")
                                : "Taxes and fees go to the bank. Vacation is just a rest.")
        let jailRent = on(s.noRentInPrison, true)
        let noRent = Rule(glyph: .police, title: "No rent while in prison", value: flag(jailRent), dim: !jailRent,
                          caption: jailRent ? "An owner sitting in prison collects no rent until they are out."
                                            : "Owners still collect rent from inside prison.")
        let mort = on(s.mortgage, true)
        let mortgages = Rule(glyph: .bank, title: "Mortgages", value: flag(mort), dim: !mort,
                             caption: mort ? "Mortgage a property for half its price, and buy it back for that plus 10%."
                                           : "No mortgages here: raise cash by selling buildings or trading.")

        // Buying and building. The server keeps auctions on whenever
        // auction-only is, so the two never disagree on the sheet.
        let only = hosted && on(s.auctionOnly, false)
        let auctionsOn = on(s.auction, true) || only
        let auctions = Rule(glyph: .gavel, title: "Auctions", value: flag(auctionsOn), dim: !auctionsOn,
                            caption: only ? "Every unowned property is sold at auction, and everyone can bid."
                                : auctionsOn ? "A property nobody buys goes to auction, and everyone can bid."
                                : "A property nobody buys stays with the bank.")
        let auctionOnly = Rule(glyph: .gavel, title: "Auction-only", value: flag(only), dim: !only,
                               caption: only ? "Land on an unowned property and it goes straight to auction. Nobody buys at the printed price, which is only a guide for the bidding."
                                             : "Land on an unowned property and you may buy it at its price.")
        let even = on(s.evenBuild, true)
        let evenBuild = Rule(glyph: .house, title: "Even building", value: flag(even), dim: !even,
                             caption: even ? "Houses go up evenly across a set: a second on any street only once each has one."
                                           : "Build on any street of a full set, in any order.")

        // Prison (round 2's rule, G1) and going broke (G5).
        let prison = Rule(glyph: .police, title: "Getting out of prison", value: nil,
                          caption: "Roll a double to walk out and move by that roll. You can pay the $50 fine before rolling, which opens the door but ends that turn, or use a get-out card. If your third roll still isn’t a double, you walk out free and move by that roll anyway.")
        let sale = hosted && s.bankruptProperties == "auction"
        let bankrupt = Rule(glyph: .skull, title: "Bankrupt properties",
                            value: sale ? "Auctioned" : "Back to the bank",
                            caption: sale ? "A bankrupt player’s properties are auctioned to everyone left, one at a time. Buildings go back to the bank and mortgages are lifted first."
                                          : "A bankrupt player’s properties go back to the bank, unowned, for whoever lands on them next.")

        // Time and the people at the table.
        let turn = s.turnSeconds ?? 90
        let clock = Rule(glyph: .clock, title: "Turn clock", value: turn == 0 ? "Off" : "\(turn) seconds", dim: turn == 0,
                         caption: turn == 0 ? "Take as long as you need on your turn."
                                            : "Run out of time and the table moves on without you.")
        let minutes = hosted ? GameLength.of(s) : 0
        let length: Rule
        if state.cup == true {
            // A cup game has no clock of its own (`endsAt` stays null) but it
            // is not unlimited: the cup blows a whistle on it — its match
            // length, or the next round's slot if that comes first — and the
            // game is decided on net worth there (endReason "time"). The
            // whistle's time is the cup's, not the room's, so it is named
            // rather than counted down.
            length = Rule(glyph: .clock, title: "Game length", value: "Cup whistle",
                          caption: "Set by the cup. When its whistle blows the game ends, and whoever is worth the most goes through.")
        } else {
            length = Rule(glyph: .clock, title: "Game length",
                          value: minutes == 0 ? "Unlimited" : "\(minutes) minutes",
                          caption: GameLength.caption(minutes))
        }
        let skill = hosted ? BotSkill.of(s) : .normal
        let bots = Rule(glyph: .robot, title: "Bot skill", value: skill.title, caption: skill.caption)
        let teamCount = s.teams ?? 0
        let teams = Rule(glyph: .people, title: "Teams", value: teamCount == 0 ? "Off" : "\(teamCount) teams",
                         dim: teamCount == 0,
                         caption: teamCount == 0 ? "Everyone plays for themselves."
                                                 : "Teammates never charge each other rent, and win together.")
        let table: Rule
        if state.cup == true {
            table = Rule(glyph: .trophy, title: "Table", value: "Cup match",
                         caption: "Set by the cup: two players, and the winner goes through.")
        } else if state.quick == true {
            table = Rule(glyph: .dice, title: "Table", value: "Play now",
                         caption: "Matchmaking dealt this table and rolled its house rules.")
        } else if on(s.isPrivate, true) {
            table = Rule(glyph: .key, title: "Table", value: "Private",
                         caption: "Off the open games list: people join with the invite link or the code.")
        } else {
            table = Rule(glyph: .globe, title: "Table", value: "Public",
                         caption: "On the open games list, for anybody to join.")
        }

        return [
            Section(title: "The board", rules: [board, shuffleRule, cash]),
            Section(title: "Rent & money", rules: [double, vacation, noRent, mortgages]),
            Section(title: "Buying & building", rules: [auctions, auctionOnly, evenBuild]),
            Section(title: "Prison & going broke", rules: [prison, bankrupt]),
            Section(title: "Time & players", rules: [clock, length, bots, teams, table]),
        ]
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
    /// How much of the chip the bar has room for, widest first: the whole
    /// chip, a tighter one, and the digits alone without the stopwatch. The
    /// bar steps down through them as its keys take the width (see topBar).
    enum Fit { case full, tight, digits }
    var fit: Fit = .full

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
            HStack(spacing: fit == .full ? 4 : 3) {
                if fit != .digits { Art.icon(.clock, size: fit == .full ? 14 : 12, tint: ink) }
                Text(last ? (fit == .full ? "Last turn" : "Last") : Self.mmss(left))
                    .font(.system(size: fit == .full ? 13 : 12.5, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(ink)
                    .contentTransition(.numericText(countsDown: true))
            }
            .padding(.vertical, 5)
            .padding(.horizontal, fit == .full ? 9 : 6)
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
