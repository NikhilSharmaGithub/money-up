// The lobby settings sheet: board picker, seats, teams, money and house
// rules. Only the host can change anything, and only while the game is
// still in the lobby — everyone else sees the same rows, disabled.

import SwiftUI

struct SettingsSheet: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var maps: [MapSummary] = []
    @State private var mapsFailed = false

    /// Server-side defaults (server/game.js DEFAULT_SETTINGS) used only when
    /// a field is missing from the broadcast state.
    private static let startingCashOptions = [500, 1000, 1500, 2000, 2500, 3000, 5000]

    private var canEdit: Bool { store.isHost && store.state?.isLobby == true }

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if !canEdit {
                        lockedNote(P)
                    }
                    boardSection(P)
                    playersSection(P)
                    teamsSection(P)
                    moneySection(P)
                    rulesSection(P)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .background(P.page.ignoresSafeArea())
            .navigationTitle("Game settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .tint(P.red)
                }
            }
            .task { await loadMaps() }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: - sections

    private func lockedNote(_ P: Palette) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.fill")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(P.ink3)
            Text(store.state?.isLobby == true
                 ? "Only the host can change the settings."
                 : "Settings are locked once the game starts.")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(P.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(P.rule, lineWidth: 1))
    }

    private func boardSection(_ P: Palette) -> some View {
        MMCard {
            VStack(alignment: .leading, spacing: 10) {
                PanelTitle("Board")
                if maps.isEmpty {
                    HStack(spacing: 8) {
                        if mapsFailed {
                            Image(systemName: "wifi.exclamationmark")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(P.bad)
                            Text("Could not load the map list.")
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundStyle(P.ink3)
                        } else {
                            ProgressView().tint(P.red).scaleEffect(0.8)
                            Text("Loading maps…")
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundStyle(P.ink3)
                        }
                    }
                    .padding(.vertical, 6)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(maps) { map in
                                mapCard(map, P)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
        }
        .disabled(!canEdit)
    }

    private func mapCard(_ map: MapSummary, _ P: Palette) -> some View {
        let selected = (store.state?.mapId ?? store.state?.settings.mapId) == map.id
        return Button {
            store.updateSettings(["mapId": map.id])
        } label: {
            VStack(spacing: 4) {
                Text(map.icon ?? "🌐")
                    .font(.system(size: 26))
                Text(map.name)
                    .font(.system(size: 12.5, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink)
                    .lineLimit(1)
                Text(mapCaption(map))
                    .font(.system(size: 10.5, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .lineLimit(1)
            }
            .frame(width: 108)
            .padding(.vertical, 10)
            .padding(.horizontal, 6)
            .background(selected ? P.redSoft : P.sunken,
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(selected ? P.red : P.rule, lineWidth: selected ? 2 : 1)
            )
            .opacity(canEdit ? 1 : 0.6)
        }
        .buttonStyle(.plain)
    }

    private func mapCaption(_ map: MapSummary) -> String {
        var bits = ["\(map.size) tiles"]
        if let streets = map.streets { bits.append("\(streets) streets") }
        return bits.joined(separator: " · ")
    }

    private func playersSection(_ P: Palette) -> some View {
        MMCard {
            VStack(alignment: .leading, spacing: 12) {
                PanelTitle("Players")

                menuRow(title: "Max players", value: "\(currentMaxPlayers)", P: P) {
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
                          binding: boolSetting("isPrivate", { $0.isPrivate }, default: true),
                          P: P)

                divider(P)

                toggleRow(title: "Allow bots",
                          caption: "Empty seats are filled with bots when the game starts.",
                          binding: boolSetting("allowBots", { $0.allowBots }, default: false),
                          P: P)
            }
        }
        .disabled(!canEdit)
    }

    private func teamsSection(_ P: Palette) -> some View {
        MMCard {
            VStack(alignment: .leading, spacing: 12) {
                PanelTitle("Teams")

                menuRow(title: "Teams",
                        value: currentTeams == 0 ? "Off" : "\(currentTeams) teams",
                        P: P) {
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
                }

                Text("Teammates never charge each other rent and win together")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(P.ink3)
            }
        }
        .disabled(!canEdit)
    }

    private func moneySection(_ P: Palette) -> some View {
        MMCard {
            VStack(alignment: .leading, spacing: 12) {
                PanelTitle("Money")

                menuRow(title: "Starting cash", value: money(currentStartingCash), P: P) {
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
        .disabled(!canEdit)
    }

    private func rulesSection(_ P: Palette) -> some View {
        MMCard {
            VStack(alignment: .leading, spacing: 12) {
                PanelTitle("Rules")

                toggleRow(title: "x2 rent on full sets",
                          caption: "Unimproved streets earn double once you own the whole set.",
                          binding: boolSetting("x2rent", { $0.x2rent }, default: false),
                          P: P)
                divider(P)
                toggleRow(title: "Vacation cash",
                          caption: "Taxes and fees pile up on Vacation for whoever lands there.",
                          binding: boolSetting("vacationCash", { $0.vacationCash }, default: false),
                          P: P)
                divider(P)
                toggleRow(title: "Auction",
                          caption: "Skipped properties go under the hammer instead of staying unsold.",
                          binding: boolSetting("auction", { $0.auction }, default: true),
                          P: P)
                divider(P)
                toggleRow(title: "No rent while jailed",
                          caption: "Owners collect nothing while they sit in prison.",
                          binding: boolSetting("noRentInPrison", { $0.noRentInPrison }, default: false),
                          P: P)
                divider(P)
                toggleRow(title: "Mortgage",
                          caption: "Properties can be mortgaged to the bank for quick cash.",
                          binding: boolSetting("mortgage", { $0.mortgage }, default: true),
                          P: P)
                divider(P)
                toggleRow(title: "Even build",
                          caption: "Houses must be spread evenly across a colour set.",
                          binding: boolSetting("evenBuild", { $0.evenBuild }, default: true),
                          P: P)
                divider(P)
                toggleRow(title: "Randomize order",
                          caption: "Shuffle the turn order when the game starts.",
                          binding: boolSetting("randomizeOrder", { $0.randomizeOrder }, default: true),
                          P: P)
            }
        }
        .disabled(!canEdit)
    }

    // MARK: - row builders

    private func toggleRow(title: String, caption: String, binding: Binding<Bool>, P: Palette) -> some View {
        Toggle(isOn: binding) {
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
        .opacity(canEdit ? 1 : 0.6)
    }

    private func menuRow<Items: View>(
        title: String,
        value: String,
        P: Palette,
        @ViewBuilder items: () -> Items
    ) -> some View {
        Menu {
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
            .opacity(canEdit ? 1 : 0.6)
        }
    }

    private func divider(_ P: Palette) -> some View {
        Rectangle().fill(P.rule).frame(height: 1)
    }

    // MARK: - live values & bindings

    private var currentMaxPlayers: Int { store.state?.settings.maxPlayers ?? 4 }
    private var currentStartingCash: Int { store.state?.settings.startingCash ?? 2500 }
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

    // MARK: - maps

    private func loadMaps() async {
        do {
            let fetched: [MapSummary] = try await store.fetchJSON("/api/maps")
            maps = fetched
            mapsFailed = false
        } catch {
            mapsFailed = true
        }
    }
}
