// A direct message thread with one friend.
//
// Lifted out of LandingView when friends got a screen of their own — it was
// only ever there because that is where the list used to live.

import SwiftUI

// MARK: - friend chat

/// A lightweight DM thread with one friend, polled over REST — the same chat
/// the web landing offers, so the conversation is shared across devices.
struct DMSheet: View {
    let friend: FriendEntry

    @EnvironmentObject var store: GameStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.dismiss) private var dismiss

    @State private var messages: [DMessage] = []
    @State private var myCode = ""
    @State private var draft = ""
    @AppStorage("mm.rulesAgreed") private var rulesAgreed = false

    private struct DMReply: Decodable {
        var messages: [DMessage]?
        var me: String?
        var error: String?
    }
    private struct SendReply: Decodable { var ok: Bool?; var error: String? }

    var body: some View {
        let P = Palette.current(scheme)
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 6) {
                            if messages.isEmpty {
                                VStack(spacing: 6) {
                                    Art.icon(.chat, size: 26, tint: P.ink3)
                                    Text("Say hi")
                                        .font(.system(size: 13, weight: .medium, design: .rounded))
                                        .foregroundStyle(P.ink3)
                                }
                                .padding(.top, 30)
                            }
                            ForEach(messages) { msg in
                                bubble(msg, P)
                                    .id(msg.id)
                            }
                        }
                        .padding(12)
                    }
                    .onChange(of: messages.last?.id) { _, new in
                        guard let new else { return }
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(new, anchor: .bottom)
                        }
                    }
                }

                if !rulesAgreed {
                    CommunityRulesCard()
                        .padding(.horizontal, 12)
                        .padding(.top, 6)
                }

                composer(P)
                    .disabled(!rulesAgreed)
                    .opacity(rulesAgreed ? 1 : 0.45)
            }
            .navigationTitle("\(friend.flag?.isEmpty == false ? "\(friend.flag!) " : "")\(friend.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .sheetBarItem(on: .sheet)
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        reportMenu(SafetyTarget(code: friend.code, name: friend.name, place: "dm",
                                                quote: messages.last(where: { $0.from != myCode })?.text ?? ""),
                                   store: store)
                        Button(role: .destructive) {
                            Task {
                                // Blocked means no longer friends, so there is
                                // no thread left to sit in.
                                if await store.block(SafetyTarget(code: friend.code, name: friend.name, place: "dm")) {
                                    dismiss()
                                }
                            }
                        } label: {
                            Label("Block \(friend.name)", systemImage: "hand.raised")
                        }
                    } label: {
                        // The plain glyph and not the circled one: the button
                        // around it is already the circle, on 26 and below.
                        Image(systemName: "ellipsis")
                    }
                    .accessibilityLabel("Report or block")
                    .sheetBarItem(on: .sheet)
                }
            }
        }
        .mmControls(on: .platter(.sheet))
        .sheetPaper(P.sheet)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task {
            // poll while the sheet is up; the task dies with the sheet
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(2.5))
            }
        }
    }

    /// The field and its send button as one capsule of glass — the same
    /// composer the table chat has, so a message is written the same way
    /// wherever it is going. The capsule is the field; the send disc sits in
    /// its trailing end.
    private func composer(_ P: Palette) -> some View {
        let glass = BackdropKind.sheet.settledGlass(P)
        // Nothing to send is a dead tap, so let the button say so: the accent
        // plate only once there is something to send, and until then a well
        // in the glass with its glyph in the second ink.
        let sendable = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return HStack(spacing: 8) {
            // Spelled out so the placeholder wears the glass's second ink
            // rather than the system's third-rank grey, which is 1.53:1 here.
            TextField("Message \(friend.name)…", text: $draft,
                      prompt: Text("Message \(friend.name)…").foregroundStyle(
                        glass.label(secondary: true, increaseContrast: contrast == .increased)))
                .font(.system(size: 15, weight: .medium, design: .rounded))
                .foregroundStyle(glass.ink)
                .padding(.leading, 12)
                .submitLabel(.send)
                .onSubmit { Task { await send() } }

            Button {
                Task { await send() }
            } label: {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(sendable
                                     ? P.accentInk
                                     : glass.label(secondary: true, increaseContrast: contrast == .increased))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(MMButtonStyle(kind: sendable ? .primary : .ghost, form: .disc))
            .disabled(!sendable)
            .accessibilityLabel("Send")
        }
        // A 36-point disc 4 in from a 44-point capsule: concentric. A field,
        // so it is set into the sheet and casts nothing.
        .padding(4)
        .mmControls(on: .chrome)
        .sheetGlass(on: .sheet, in: Capsule(), floats: false)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private func bubble(_ msg: DMessage, _ P: Palette) -> some View {
        let mine = msg.from == myCode
        return HStack {
            if mine { Spacer(minLength: 50) }
            Text(msg.text)
                .font(.system(size: 14.5, weight: .medium, design: .rounded))
                .foregroundStyle(mine ? P.accentInk : P.ink)
                .padding(.vertical, 8)
                .padding(.horizontal, 13)
                .background(mine ? AnyShapeStyle(P.red) : AnyShapeStyle(P.card),
                            in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            if !mine { Spacer(minLength: 50) }
        }
        .contextMenu {
            if !mine {
                reportMenu(SafetyTarget(code: friend.code, name: friend.name, place: "dm", quote: msg.text),
                           store: store)
            }
        }
    }

    private func load() async {
        guard let base = store.serverURL,
              var comps = URLComponents(url: base.appending(path: "/api/dm"),
                                        resolvingAgainstBaseURL: false) else { return }
        comps.queryItems = [
            URLQueryItem(name: "token", value: store.token),
            URLQueryItem(name: "code", value: friend.code),
        ]
        guard let url = comps.url,
              let (data, _) = try? await URLSession.shared.data(from: url),
              let reply = try? JSONDecoder().decode(DMReply.self, from: data) else { return }
        if let me = reply.me { myCode = me }
        if let msgs = reply.messages { messages = msgs }
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        SoundKit.shared.click()
        let reply: SendReply? = try? await store.fetchJSON(
            "/api/dm", method: "POST",
            body: ["token": store.token, "code": friend.code, "text": text])
        if let error = reply?.error {
            store.showToast(error, isError: true)
        }
        await load()
    }
}
