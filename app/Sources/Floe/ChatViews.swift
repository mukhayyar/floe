import SwiftUI

struct ChatView: View {
    @EnvironmentObject var store: IslandStore

    private let suggestions = [
        "What are my agents doing on every host?",
        "Which agent needs me, and what is it asking?",
        "What changed in my repos today?",
    ]

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("Talking to Orca").font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.dim)
                Spacer()
                if store.streaming {
                    SmallButton(title: "Stop", symbol: "stop.fill") { store.stopAsking() }
                }
                SmallButton(title: "Open in Orca", symbol: "arrow.up.forward.app") { store.openChatInOrca() }
                SmallButton(title: "New", symbol: "plus") { store.newChat() }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)

            if store.chat.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Ask about any host, project or agent, or tell Orca to start work.")
                        .font(.system(size: 12)).foregroundStyle(.white.opacity(0.75))
                    ForEach(suggestions, id: \.self) { s in
                        Button { store.ask(s) } label: {
                            Text(s).font(.system(size: 11.5)).padding(.horizontal, 10).padding(.vertical, 5)
                                .background(Capsule().fill(Color.faint))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                ScrollViewReader { reader in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            ForEach(store.chat) { m in MessageRow(message: m, live: store.streaming && m.id == store.chat.last?.id) }
                            Color.clear.frame(height: 1).id("bottom")
                        }
                        .padding(.horizontal, 14)
                        .padding(.bottom, 8)
                    }
                    .scrollIndicators(.never)
                    .onAppear { reader.scrollTo("bottom", anchor: .bottom) }
                    .onChange(of: store.chat) { _, _ in reader.scrollTo("bottom", anchor: .bottom) }
                }
            }
        }
    }
}

struct SmallButton: View {
    let title: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(.white.opacity(0.75))
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Capsule().fill(Color.faint))
        }
        .buttonStyle(.plain)
    }
}

struct MessageRow: View {
    let message: ChatMessage
    let live: Bool

    /// The brain's tool calls as timeline steps ("Bash: git log -1" → tool Bash, text git log -1).
    private var steps: [Step] {
        let tools = message.tools ?? []
        let times = message.toolAt ?? []
        let answering = live && !message.text.isEmpty
        return tools.enumerated().map { i, t in
            let parts = t.split(separator: ":", maxSplits: 1).map { String($0).trimmingCharacters(in: .whitespaces) }
            let last = i == tools.count - 1
            return Step(kind: "tool", tool: parts.first, text: parts.count > 1 ? parts[1] : "",
                        at: i < times.count ? times[i] : message.at, done: !(live && last && !answering))
        }
    }

    var body: some View {
        if message.role == "user" {
            HStack {
                Spacer(minLength: 50)
                Text(message.text)
                    .font(.system(size: 12.5))
                    .padding(.horizontal, 11)
                    .padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.13)))
                    .textSelection(.enabled)
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                if !steps.isEmpty {
                    StepTimeline(steps: steps, live: live, maxSteps: live ? 6 : 3)
                }
                if message.text.isEmpty && live {
                    HStack(spacing: 6) {
                        MoodIndicator(mood: .thinking, size: 12)
                        Text(steps.isEmpty ? "thinking…" : "working…").font(.system(size: 12)).foregroundStyle(Color.dim)
                    }
                } else {
                    Text(md(message.text) + (live ? AttributedString(" ▍") : AttributedString("")))
                        .font(.system(size: 12.5))
                        .foregroundStyle(.white.opacity(0.92))
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}
