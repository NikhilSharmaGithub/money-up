// The panel under the board while the room sits in the lobby: start/settings
// controls, the seat list with team + kick actions, empty seats the host can
// fill with bots, and the player's own appearance (name + colour).

import SwiftUI

struct LobbyPanel: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    let openSettings: () -> Void

    @State private var nameDraft = ""

    var body: some View {
        let P = Palette.current(scheme)
        ScrollView {
            VStack(spacing: 10) {
                if store.isHost {
                    Button("▶  Start Game") { store.start() }
                        .buttonStyle(MMButtonStyle(kind: .primary, big: true))
                } else {
                    HStack(spacing: 8) {
                        ProgressView().tint(P.red).scaleEffect(0.8)
                        Text("waiting for the host…")
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .foregroundStyle(P.ink3)
                    }
                    .padding(.top, 2)
                }

                Button("⚙️  Game settings") { openSettings() }
                    .buttonStyle(MMButtonStyle(kind: .ghost, big: true))

                seatList(P)

                if store.isHost, teamCount > 0 {
                    Button("⇄  Balance teams") { store.balanceTeams() }
                        .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
                }

                appearanceSection(P)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
        .scrollBounceBehavior(.basedOnSize)
        .onAppear { nameDraft = store.me?.name ?? store.nickname }
    }

    private var teamCount: Int { store.state?.settings.teams ?? 0 }

    private var emptySeats: Int {
        guard let state = store.state else { return 0 }
        return max(0, state.settings.maxPlayers - state.players.count)
    }

    // MARK: - seats

    @ViewBuilder private func seatList(_ P: Palette) -> some View {
        VStack(spacing: 8) {
            ForEach(store.state?.players ?? []) { p in
                playerRow(p, P)
            }
            ForEach(0..<emptySeats, id: \.self) { _ in
                emptySeatRow(P)
            }
        }
    }

    private func playerRow(_ p: PlayerState, _ P: Palette) -> some View {
        let team = p.team.flatMap { store.state?.teamInfo?[safe: $0] }
        let canCycleTeam = teamCount > 0 && (p.id == store.meId || (store.isHost && p.isBot == true))
        let canKick = store.isHost && p.id != store.meId

        return HStack(spacing: 10) {
            AvatarView(name: p.name, colorCSS: p.color, flag: p.flag ?? "", size: 34)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text(p.name)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(P.ink)
                        .lineLimit(1)
                    if p.id == store.state?.hostId { tag("HOST", P.gold) }
                    if p.isBot == true { tag("BOT", P.ink3) }
                    if p.id == store.meId { tag("YOU", P.red) }
                }
                HStack(spacing: 6) {
                    Text(money(p.money))
                        .font(.system(size: 12.5, weight: .heavy, design: .rounded))
                        .foregroundStyle(P.good)
                    if teamCount > 0, let team {
                        Text(team.name)
                            .font(.system(size: 10, weight: .black, design: .rounded))
                            .foregroundStyle(Color(css: team.color))
                            .padding(.vertical, 2)
                            .padding(.horizontal, 7)
                            .background(Color(css: team.color).opacity(0.16), in: Capsule())
                    }
                }
            }

            Spacer(minLength: 6)

            if canCycleTeam {
                Button("⇄") { store.setTeam(((p.team ?? -1) + 1) % teamCount, for: p.id) }
                    .buttonStyle(MMButtonStyle(kind: .ghost))
            }
            if canKick {
                Button("✕") { store.kick(p.id) }
                    .buttonStyle(MMButtonStyle(kind: .ghost))
            }
        }
        .padding(10)
        .background(P.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(P.rule, lineWidth: 1))
    }

    private func emptySeatRow(_ P: Palette) -> some View {
        HStack {
            Text("Empty seat")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(P.ink3)
            Spacer()
            if store.isHost {
                Button("Add bot") { store.addBot() }
                    .buttonStyle(MMButtonStyle(kind: .ghost))
            }
        }
        .padding(10)
        .frame(minHeight: 44)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(P.rule2, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        )
    }

    private func tag(_ text: String, _ color: Color) -> some View {
        Text(text)
            .font(.system(size: 8, weight: .black))
            .foregroundStyle(color)
    }

    // MARK: - your look

    private func appearanceSection(_ P: Palette) -> some View {
        let taken = Set(
            (store.state?.players ?? [])
                .filter { $0.id != store.meId }
                .map { $0.color.lowercased() }
        )
        let myColor = store.me?.color.lowercased()
        let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 8)

        return VStack(alignment: .leading, spacing: 10) {
            PanelTitle("Your look")

            TextField("Nickname", text: $nameDraft)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(P.ink)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit {
                    let trimmed = nameDraft.trimmingCharacters(in: .whitespaces)
                    guard !trimmed.isEmpty else { return }
                    store.setAppearance(name: trimmed)
                }
                .padding(.vertical, 9)
                .padding(.horizontal, 12)
                .background(P.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(MMStatic.playerColors, id: \.self) { css in
                    let isTaken = taken.contains(css.lowercased())
                    let isMine = css.lowercased() == myColor
                    Button {
                        store.setAppearance(color: css)
                    } label: {
                        Circle()
                            .fill(Color(css: css))
                            .frame(width: 26, height: 26)
                            .overlay(
                                Circle()
                                    .stroke(isMine ? P.ink : .clear, lineWidth: 2)
                                    .padding(-3.5)
                            )
                            .opacity(isTaken ? 0.25 : 1)
                    }
                    .disabled(isTaken)
                }
            }
            .padding(.top, 2)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(P.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(P.rule, lineWidth: 1))
    }
}
