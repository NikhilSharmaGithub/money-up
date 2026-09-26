// The lobby settings sheet: board picker, seats, teams, money and house
// rules. Only the host can change anything, and only while the game is
// still in the lobby — everyone else sees the same rows, disabled.
//
// At a Play-now table the host may change only what the server lists in
// quickLobby.editable — the bankroll, the five rolled house rules and the
// board. The seats, privacy and house players are what matchmaking stands
// on; the turn clock costs strangers karma; mortgage off turns ordinary rent
// into bankruptcy; a fixed order would always put the host first. Those rows
// stay on screen, locked, so everybody can still read what they are.

import SwiftUI

struct SettingsSheet: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme


    /// Server-side defaults (server/game.js DEFAULT_SETTINGS) used only when
    /// a field is missing from the broadcast state.
    private static let startingCashOptions = [500, 1000, 1500, 2000, 2500, 3000, 5000]
    /// Seconds on the turn clock; 0 hands the table all the time in the world.
    private static let turnClockOptions = [0, 30, 60, 90, 120, 180]

    /// The host, in the lobby — the whole of the rule at a private table.
    private var isHostInLobby: Bool { store.isHost && store.state?.isLobby == true }

    /// A Play-now table, where the host's hand is limited to a list.
    private var isQuick: Bool { store.state?.quick == true }

    /// What a Play-now table never hands its host, whatever list arrives —
    /// the reasons are in the header above. The server refuses them too; this
    /// is so nobody is shown a switch that only ever answers with a toast.
    private static let quickLocked: Set<String> = [
        "maxPlayers", "isPrivate", "allowBots", "teams", "turnSeconds", "mortgage", "randomizeOrder",
    ]

    /// Whether this one setting can be changed from here. At a Play-now table
    /// only the keys the server names are open; a server that names none —
    /// one from before the Ready lobby — has opened none.
    private func canEdit(_ key: String) -> Bool {
        guard isHostInLobby else { return false }
        guard isQuick else { return true }
        guard !Self.quickLocked.contains(key) else { return false }
        return store.state?.quickLobby?.editable?.contains(key) ?? false
    }

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if isHostInLobby, isQuick, store.state?.quickLobby != nil {
                        quickHostNote(P)
                    } else if !isHostInLobby || isQuick {
                        lockedNote(P)
                    }
                    boardSection(P)
                    playersSection(P)
                    // Strangers cannot pick teams, so a Play-now table has none
                    // to show.
                    if !isQuick { teamsSection(P) }
                    styleSection(P)
                    moneySection(P)
                    rulesSection(P)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .navigationTitle("Game settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .tint(P.red)
                        .sheetBarItem(on: .sheet)
                }
            }
        }
        // Every row here is on a card, and every card declares its own paper;
        // this is for anything that ever lands on the sheet between them.
        .mmControls(on: .platter(.sheet))
        .sheetPaper(P.sheet)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: - sections

    private func lockedNote(_ P: Palette) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.fill")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(P.ink3)
            Text(lockedText)
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(P.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(P.rule, lineWidth: 1))
    }

    private var lockedText: String {
        guard store.state?.isLobby == true else { return "Settings are locked once the game starts." }
        // A host at a Play-now table on a server from before the Ready lobby:
        // that server lets nobody change anything.
        if isQuick && store.isHost { return "A Play-now table plays the rules it rolled." }
        return "Only the host can change the settings."
    }

    /// What a Play-now host is told before they touch anything: a change
    /// costs everybody their Ready, because a rule changed under somebody
    /// who already agreed to the old one is a rule they never agreed to.
    private func quickHostNote(_ P: Palette) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "info.circle.fill")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(P.gold)
            VStack(alignment: .leading, spacing: 3) {
                Text("Changing a rule un-readies everyone so they can read it.")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink)
                Text("Seats, privacy, house players, the turn clock, mortgage and turn order stay as Play now set them.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(P.goldSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(P.gold.opacity(0.5), lineWidth: 1))
    }

    /// The same three boxes the lobby shows, so there is exactly one board
    /// picker in the app. This used to be a second, independent list of every
    /// board — which meant the lobby could hide a locked board and this
    /// sheet would offer it one tap away.
    private func boardSection(_ P: Palette) -> some View {
        MMCard { BoardBoxes(canEdit: canEdit("mapId")) }
    }


    private func playersSection(_ P: Palette) -> some View {
        MMCard {
            VStack(alignment: .leading, spacing: 12) {
                PanelTitle("Players")

                menuRow(title: "Max players", value: "\(currentMaxPlayers)", key: "maxPlayers", P: P) {
                    ForEach(2...8, id: \.self) { n in
                        Button {
                            store.updateSettings(["maxPlayers": n])
                        } label: {
                            if n == currentMaxPlayers {
                                Label("\(n) players", systemImage: "checkmark")
                            } else {
                                Text("\(n) players")
                            }
                        }
                    }
                }

                divider(P)

                toggleRow(title: "Private room",
                          caption: "Hidden from the public room list — invite link only.",
                          key: "isPrivate",
                          binding: boolSetting("isPrivate", { $0.isPrivate }, default: true),
                          P: P)

                divider(P)

                toggleRow(title: "Allow bots",
                          caption: "Empty seats are filled with bots when the game starts.",
                          key: "allowBots",
                          binding: boolSetting("allowBots", { $0.allowBots }, default: false),
                          P: P)
            }
        }
    }

    /// Personal, not a room setting — every player can pick their own table.
    private func styleSection(_ P: Palette) -> some View {
        MMCard(padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                PanelTitle("Table style")
                ThemePicker()
            }
        }
    }

    private func teamsSection(_ P: Palette) -> some View {
        MMCard {
            VStack(alignment: .leading, spacing: 12) {
                PanelTitle("Teams")

                menuRow(title: "Teams",
                        value: currentTeams == 0 ? "Off" : "\(currentTeams) teams",
                        key: "teams", P: P) {
                    ForEach([0, 2, 3, 4], id: \.self) { n in
                        Button {
                            store.updateSettings(["teams": n])
                        } label: {
                            let name = n == 0 ? "Off" : "\(n) teams"
                            if n == currentTeams {
                                Label(name, systemImage: "checkmark")
                            } else {
                                Text(name)
                            }
                        }
                    }
                }

                if currentTeams > 0 {
                    Button("⇄  Balance teams") { store.balanceTeams() }
                        .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                        .disabled(!canEdit("teams"))
                }

                Text("Teammates never charge each other rent and win together")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
        }
    }

    private func moneySection(_ P: Palette) -> some View {
        MMCard {
            VStack(alignment: .leading, spacing: 12) {
                PanelTitle("Money")

                menuRow(title: "Starting cash", value: money(currentStartingCash), key: "startingCash", P: P) {
                    ForEach(Self.startingCashOptions, id: \.self) { n in
                        Button {
                            store.updateSettings(["startingCash": n])
                        } label: {
                            if n == currentStartingCash {
                                Label(money(n), systemImage: "checkmark")
                            } else {
                                Text(money(n))
                            }
                        }
                    }
                }
            }
        }
    }

    private func rulesSection(_ P: Palette) -> some View {
        MMCard {
            VStack(alignment: .leading, spacing: 12) {
                PanelTitle("Rules")

                menuRow(title: "Turn clock",
                        value: currentTurnSeconds == 0 ? "Off" : "\(currentTurnSeconds)s",
                        key: "turnSeconds", P: P) {
                    ForEach(Self.turnClockOptions, id: \.self) { n in
                        Button {
                            store.updateSettings(["turnSeconds": n])
                        } label: {
                            let label = n == 0 ? "Off" : "\(n) seconds"
                            if n == currentTurnSeconds {
                                Label(label, systemImage: "checkmark")
                            } else {
                                Text(label)
                            }
                        }
                    }
                }
                Text("Run out of time and the table moves on without you.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                divider(P)
                toggleRow(title: "x2 rent on full sets",
                          caption: "Unimproved streets earn double once you own the whole set.",
                          key: "x2rent",
                          binding: boolSetting("x2rent", { $0.x2rent }, default: false),
                          P: P)
                divider(P)
                toggleRow(title: "Vacation cash",
                          caption: "Taxes and fees pile up on Vacation for whoever lands there.",
                          key: "vacationCash",
                          binding: boolSetting("vacationCash", { $0.vacationCash }, default: false),
                          P: P)
                divider(P)
                toggleRow(title: "Auction",
                          caption: "Skipped properties go under the hammer instead of staying unsold.",
                          key: "auction",
                          binding: boolSetting("auction", { $0.auction }, default: true),
                          P: P)
                divider(P)
                toggleRow(title: "No rent while jailed",
                          caption: "Owners collect nothing while they sit in prison.",
                          key: "noRentInPrison",
                          binding: boolSetting("noRentInPrison", { $0.noRentInPrison }, default: false),
                          P: P)
                divider(P)
                toggleRow(title: "Mortgage",
                          caption: "Properties can be mortgaged to the bank for quick cash.",
                          key: "mortgage",
                          binding: boolSetting("mortgage", { $0.mortgage }, default: true),
                          P: P)
                divider(P)
                toggleRow(title: "Even build",
                          caption: "Houses must be spread evenly across a colour set.",
                          key: "evenBuild",
                          binding: boolSetting("evenBuild", { $0.evenBuild }, default: true),
                          P: P)
                divider(P)
                toggleRow(title: "Randomize order",
                          caption: "Shuffle the turn order when the game starts.",
                          key: "randomizeOrder",
                          binding: boolSetting("randomizeOrder", { $0.randomizeOrder }, default: true),
                          P: P)
            }
        }
    }

    // MARK: - row builders

    /// Each row answers for its own setting, because at a Play-now table one
    /// card holds rows the host may change beside rows nobody may.
    private func toggleRow(title: String, caption: String, key: String,
                           binding: Binding<Bool>, P: Palette) -> some View {
        let open = canEdit(key)
        return Toggle(isOn: binding) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink)
                Text(caption)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(P.red)
        .opacity(open ? 1 : 0.6)
        .disabled(!open)
    }

    private func menuRow<Items: View>(
        title: String,
        value: String,
        key: String,
        P: Palette,
        @ViewBuilder items: () -> Items
    ) -> some View {
        let open = canEdit(key)
        return Menu {
            items()
        } label: {
            HStack {
                Text(title)
                    .font(.system(size: 14.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(P.ink)
                Spacer()
                Text(value)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(P.red)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(P.ink3)
            }
            .contentShape(Rectangle())
            .opacity(open ? 1 : 0.6)
        }
        .disabled(!open)
    }

    private func divider(_ P: Palette) -> some View {
        Rectangle().fill(P.rule).frame(height: 1)
    }

    // MARK: - live values & bindings

    private var currentMaxPlayers: Int { store.state?.settings.maxPlayers ?? 4 }
    private var currentStartingCash: Int { store.state?.settings.startingCash ?? 2500 }
    private var currentTurnSeconds: Int { store.state?.settings.turnSeconds ?? 90 }
    private var currentTeams: Int { store.state?.settings.teams ?? 0 }

    /// Binds a toggle straight to the broadcast settings — flipping it emits
    /// an `updateSettings` patch, and the row only moves when the server's
    /// next state push confirms it. No local state that can drift.
    private func boolSetting(
        _ key: String,
        _ read: @escaping (GameSettings) -> Bool?,
        default def: Bool
    ) -> Binding<Bool> {
        Binding(
            get: { [weak store] in
                guard let settings = store?.state?.settings else { return def }
                return read(settings) ?? def
            },
            set: { [weak store] newValue in
                store?.updateSettings([key: newValue])
            }
        )
    }
}
