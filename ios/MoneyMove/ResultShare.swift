// Share your result (1.0.6): the game-over sheet's picture of how it ended —
// the wordmark, the board, the winner, the podium with what each was worth,
// where this player finished, and the day — at 1080 × 1350, the portrait size
// every feed and chat shows whole. Rendered on the phone with ImageRenderer and
// handed to the system share sheet as a PNG; the text-and-link share beside it
// stays, because a link is what turns a friend into an opponent.
//
// Nothing private goes into it: names, faces and flags are what everybody at
// the table already saw, and there is no room code — a picture travels
// further than its sender meant it to, and a code in it would be an open door.

import SwiftUI
import UniformTypeIdentifiers

/// Everything the picture says, frozen at the moment it is drawn.
struct ResultShareData: Equatable {
    var mapName: String
    /// "Asha" or "Team Azure".
    var winner: String
    var winnerColor: String
    /// The first three of the standings, in order.
    var podium: [PlayerResult]
    /// Where this device's best seat finished, 1-based, and out of how many —
    /// nil for a table this device only watched.
    var placing: (rank: Int, of: Int)?
    var won: Bool
    var onTime: Bool
    var date: Date

    static func == (a: ResultShareData, b: ResultShareData) -> Bool {
        a.mapName == b.mapName && a.winner == b.winner && a.podium == b.podium
            && a.placing?.rank == b.placing?.rank && a.placing?.of == b.placing?.of
            && a.won == b.won && a.onTime == b.onTime
    }

    /// The finished game on screen, as the picture should tell it. The same
    /// standings the sheet shows, so the picture can never disagree with it.
    @MainActor
    static func from(_ store: GameStore) -> ResultShareData? {
        guard let state = store.state, state.isEnded else { return nil }
        let results = PlayerResult.snapshot(of: state)
        guard !results.isEmpty else { return nil }
        let winner: String
        let colour: String
        if let idx = state.winningTeam, let team = state.teamInfo?[safe: idx] {
            winner = "Team \(team.name)"
            colour = team.color
        } else {
            winner = state.winner?.name ?? results[0].name
            colour = state.winner?.color ?? results[0].color
        }
        let mine = results.firstIndex { store.localIds.contains($0.id) }
        return ResultShareData(
            mapName: state.map.name,
            winner: winner,
            winnerColor: colour,
            podium: Array(results.prefix(3)),
            placing: mine.map { (rank: $0 + 1, of: results.count) },
            won: store.localSeatWon(state),
            onTime: state.endedOnTime,
            date: Date())
    }
}

/// The PNG the share sheet is handed, with a file name that says what it is
/// when it lands in somebody's camera roll or downloads.
struct ResultImage: Transferable {
    let png: Data
    let preview: UIImage

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .png) { $0.png }
            .suggestedFileName("MoneyMove result.png")
    }
}

enum ResultShareRenderer {
    static let size = CGSize(width: 1080, height: 1350)

    /// Draws the card at exactly 1080 × 1350 pixels. Always the dark half of
    /// the player's own table style: the picture is seen on other people's
    /// phones, in other people's light, and the night palette is the one that
    /// reads as the game on every one of them.
    @MainActor
    static func render(_ data: ResultShareData) -> ResultImage? {
        let card = ResultShareCard(data: data)
            .frame(width: size.width, height: size.height)
            .environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: card)
        renderer.scale = 1
        renderer.isOpaque = true
        guard let image = renderer.uiImage, let png = image.pngData() else { return nil }
        return ResultImage(png: png, preview: image)
    }
}

// MARK: - the picture

struct ResultShareCard: View {
    let data: ResultShareData

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let P = Palette.current(scheme)
        ZStack {
            LinearGradient(colors: [P.page, P.page2], startPoint: .top, endPoint: .bottom)
            RadialGradient(colors: [P.card.opacity(0.55), .clear],
                           center: .init(x: 0.5, y: 0.38), startRadius: 20, endRadius: 720)
            // The board's brass, as a frame — the picture is a table's edge.
            RoundedRectangle(cornerRadius: 54, style: .continuous)
                .stroke(P.gold.opacity(0.45), lineWidth: 4)
                .padding(34)

            VStack(spacing: 0) {
                HStack(spacing: 26) {
                    LogoMark(size: 92)
                    Wordmark(fontSize: 70)
                }
                .padding(.top, 96)

                HStack(spacing: 12) {
                    Art.icon(.map, size: 30, tint: P.ink2)
                    Text("\(data.mapName) · \(data.date.formatted(date: .long, time: .omitted))")
                        .font(.system(size: 32, weight: .semibold, design: .rounded))
                        .foregroundStyle(P.ink2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                .padding(.top, 26)
                .padding(.horizontal, 90)

                Spacer(minLength: 30)

                Art.icon(.trophy, size: 132)
                Text("\(data.winner) wins!")
                    .font(.system(size: 86, weight: .black, design: .rounded))
                    .foregroundStyle(Color(css: data.winnerColor))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.5)
                    .padding(.horizontal, 90)
                    .padding(.top, 14)
                if data.onTime {
                    HStack(spacing: 12) {
                        Art.icon(.clock, size: 32, tint: P.gold)
                        Text("Time's up — the richest player won")
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .foregroundStyle(P.ink2)
                    }
                    .padding(.top, 14)
                }

                podium(P)
                    .padding(.top, 44)
                    .padding(.horizontal, 90)

                if let placing = data.placing {
                    Text(placingLine(placing))
                        .font(.system(size: 44, weight: .heavy, design: .rounded))
                        .foregroundStyle(data.won ? P.accentInk : P.ink)
                        .padding(.vertical, 18)
                        .padding(.horizontal, 44)
                        .background(data.won ? P.gold : P.card, in: Capsule())
                        .overlay(Capsule().stroke(P.gold, lineWidth: 3))
                        .padding(.top, 40)
                }

                Spacer(minLength: 30)

                Text("Play free at moneymove.live")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundStyle(P.ink3)
                    .padding(.bottom, 92)
            }
        }
    }

    private func podium(_ P: Palette) -> some View {
        VStack(spacing: 18) {
            ForEach(Array(data.podium.enumerated()), id: \.element.id) { rank, r in
                HStack(spacing: 24) {
                    Art.icon(rank == 0 ? .medalGold : rank == 1 ? .medalSilver : .medalBronze, size: 70)
                    AvatarView(name: r.name, colorCSS: r.color, flag: r.flag ?? "",
                               size: 78, emoji: r.avatar ?? "")
                    // Never shrunk to fit: beside a spacer, a name allowed to
                    // scale came out at three fifths of its size with the
                    // row half empty. A seat's name is twelve characters at
                    // most, which fits whole; anything longer is cut short.
                    Text(r.name)
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .foregroundStyle(P.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .layoutPriority(1)
                    Spacer(minLength: 16)
                    Text(r.outcomeLabel ?? money(r.worth))
                        .font(.system(size: 42, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(r.bankrupt ? P.ink3 : (r.worth < 0 ? P.bad : P.good))
                        .lineLimit(1)
                        .fixedSize()
                }
                .opacity(r.bankrupt ? 0.6 : 1)
            }
        }
        .padding(.vertical, 34)
        .padding(.horizontal, 38)
        .background(P.card, in: RoundedRectangle(cornerRadius: 44, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 44, style: .continuous).stroke(P.rule, lineWidth: 2))
    }

    private func placingLine(_ placing: (rank: Int, of: Int)) -> String {
        if data.won { return placing.rank == 1 ? "I won!" : "My team won!" }
        return "I finished \(Self.ordinal(placing.rank)) of \(placing.of)"
    }

    static func ordinal(_ n: Int) -> String {
        let tens = n % 100
        let suffix: String
        if (11...13).contains(tens) {
            suffix = "th"
        } else {
            switch n % 10 {
            case 1: suffix = "st"
            case 2: suffix = "nd"
            case 3: suffix = "rd"
            default: suffix = "th"
            }
        }
        return "\(n)\(suffix)"
    }
}

// MARK: - the button

/// "Share result" on the game-over sheet. The picture is drawn once the sheet
/// has finished arriving — a render in the middle of its entrance would stall
/// it — and drawn again only if the result itself changes. Until it is ready
/// the button says so rather than opening an empty share sheet.
struct ShareResultButton: View {
    @EnvironmentObject var store: GameStore
    @State private var image: ResultImage?
    @State private var drawn: ResultShareData?

    var body: some View {
        Group {
            if let image {
                ShareLink(item: image,
                          preview: SharePreview("My MoneyMove result", image: Image(uiImage: image.preview))) {
                    label
                }
            } else {
                Button {} label: { label }
                    .disabled(true)
                    .opacity(0.6)
            }
        }
        .buttonStyle(MMButtonStyle(kind: .ghost, big: true))
        .task(id: store.state?.version) {
            guard let data = ResultShareData.from(store), data != drawn else { return }
            try? await Task.sleep(for: .milliseconds(image == nil ? 650 : 150))
            guard !Task.isCancelled else { return }
            drawn = data
            image = ResultShareRenderer.render(data)
        }
    }

    private var label: some View {
        HStack(spacing: 8) {
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 15, weight: .bold))
            Text("Share result")
        }
        .frame(maxWidth: .infinity)
    }
}
