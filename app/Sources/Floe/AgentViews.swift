import SwiftUI

/// What's happening now across every host: needs-you first, then working, then recently done.
struct LiveView: View {
    @EnvironmentObject var store: IslandStore

    var body: some View {
        let live = store.liveAgents
        if live.isEmpty {
            VStack(spacing: 8) {
                OrcaGlyph().foregroundStyle(Color.dim).frame(width: 26, height: 26)
                Text(store.snapshot?.online == false ? (store.snapshot?.headline ?? "Orca is offline") : "All quiet across your hosts")
                    .font(.system(size: 12.5, weight: .medium)).foregroundStyle(.white.opacity(0.8))
                Text("\(store.agents.count) agents idle on \(store.hosts.filter { $0.counts.agents > 0 }.count) hosts. Browse them in Hosts, or ask Orca to start something.")
                    .font(.system(size: 11)).foregroundStyle(Color.dim).multilineTextAlignment(.center)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(live) { a in AgentCard(agent: a) }
                }
                .padding(12)
            }
            .scrollIndicators(.never)
        }
    }
}

struct AgentCard: View {
    @EnvironmentObject var store: IslandStore
    let agent: Agent
    var showPlace = true

    private var open: Bool { agent.attention != nil || store.expandedAgent == agent.id }
    private var targeted: Bool { store.target == .agent(agent.id) }

    var body: some View {
        let mood = agentMood(agent)
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                MoodIndicator(mood: mood, size: 12)
                if showPlace {
                    if agent.isRemote {
                        Text(agent.hostName).font(.system(size: 10.5, weight: .semibold)).foregroundStyle(Color.orcaBlue.opacity(0.9)).lineLimit(1)
                    }
                    Text(agent.workspace).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                }
                Text(agent.kindName).font(.system(size: 10.5, weight: .medium)).foregroundStyle(Color.dim)
                Spacer(minLength: 4)
                    .contentShape(Rectangle())
                    .onTapGesture { store.select(agent: agent) }
                Text(ago(agent.since)).font(.system(size: 10.5)).foregroundStyle(Color.dim)
                Button { store.focusInOrca(agent) } label: {
                    Image(systemName: "arrow.up.forward.app").font(.system(size: 11)).foregroundStyle(Color.dim)
                }
                .buttonStyle(.plain)
                .help("Show in Orca")
            }
            Text(agent.title).font(.system(size: 12)).foregroundStyle(.white.opacity(0.85)).lineLimit(open ? 3 : 1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture { store.select(agent: agent) }

            if let detail = agent.detail, agent.attention != nil {
                Text(detail)
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(Color.orcaOrange)
                    .lineLimit(4)
            }
            if !agent.steps.isEmpty && (agent.state == "working" || agent.attention != nil || open) {
                StepTimeline(steps: agent.steps, live: agent.state == "working" || agent.attention != nil,
                             attention: agent.attention != nil, maxSteps: open ? 8 : 4)
                    .padding(.top, 2)
            } else if agent.state == "working", let detail = agent.detail {
                Text(detail).font(.system(size: 11, design: .monospaced)).foregroundStyle(Color.dim).lineLimit(1)
            }
            if let p = agent.progress {
                ProgressView(value: p, total: 100).tint(.orcaBlue).controlSize(.mini)
            }
            if !open, agent.state != "working", agent.attention == nil, let last = agent.lastMessage {
                Text(md(last)).font(.system(size: 11.5)).foregroundStyle(Color.dim).lineLimit(2)
            }
            if open { detailBody }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(agent.attention != nil ? Color.orcaOrange.opacity(0.10) : Color.white.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(targeted ? Color.white.opacity(0.35) : Color.clear, lineWidth: 1)
        )
    }

    @ViewBuilder
    private var detailBody: some View {
        if let screen = store.screens[agent.id] {
            let shown = screen.options.isEmpty ? screen.lines : screen.promptLines
            if !shown.isEmpty {
                ScrollView {
                    Text(shown.suffix(14).joined(separator: "\n"))
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.75))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .frame(maxHeight: 130)
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.black.opacity(0.55)))
            }
            if let tabs = screen.tabs, !tabs.isEmpty { QuestionTabs(tabs: tabs) }
            if !screen.options.isEmpty, screen.multi == true || screen.options.contains(where: { $0.description != nil }) {
                OptionList(agent: agent, screen: screen)
            } else if !screen.options.isEmpty {
                let sending = store.answering[agent.id]
                FlowLayout(spacing: 6) {
                    ForEach(screen.options) { o in
                        let mine = sending == o.n
                        Button { store.answer(agent, option: o) } label: {
                            HStack(spacing: 5) {
                                ZStack {
                                    Circle().fill(mine ? Color.orcaGreen : Color.white.opacity(o.selected ? 0.95 : 0.6))
                                    if mine {
                                        Spinner(color: .black.opacity(0.7), lineWidth: 1.6).padding(3)
                                    } else {
                                        Text("\(o.n)").font(.system(size: 10.5, weight: .bold, design: .rounded))
                                            .foregroundStyle(.black.opacity(0.7))
                                    }
                                }
                                .frame(width: 16, height: 16)
                                Text(o.freeText ? "✎ \(o.label)" : o.label)
                                    .font(.system(size: 11.5, weight: .medium))
                                    .lineLimit(1)
                            }
                            .padding(.leading, 4)
                            .padding(.trailing, 10)
                            .padding(.vertical, 5)
                            .background(Capsule().fill(mine ? Color.orcaGreen.opacity(0.28) : Color.white.opacity(o.selected ? 0.18 : 0.09)))
                            .overlay(Capsule().stroke(mine ? Color.orcaGreen : Color.clear, lineWidth: 1))
                            .opacity(sending != nil && !mine ? 0.4 : 1)
                            .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .disabled(sending != nil)
                    }
                }
            }
            if !screen.options.isEmpty, screen.steps == true { StepButtons(agent: agent, screen: screen) }
        } else if agent.attention != nil {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Reading the agent's screen…").font(.system(size: 11)).foregroundStyle(Color.dim)
            }
        }
        if agent.attention == nil, let last = agent.lastMessage {
            Text(md(last))
                .font(.system(size: 11.5))
                .foregroundStyle(.white.opacity(0.8))
                .lineLimit(14)
                .textSelection(.enabled)
        }
    }
}

/// Options as rows, with each one's description under it. Pick-any options are checkboxes that
/// stay up while you tick them; Next sends the answer on.
struct OptionList: View {
    @EnvironmentObject var store: IslandStore
    let agent: Agent
    let screen: ScreenView

    var body: some View {
        let sending = store.answering[agent.id]
        VStack(alignment: .leading, spacing: 4) {
            ForEach(screen.options) { o in
                let mine = sending == o.n
                Button { store.answer(agent, option: o) } label: {
                    HStack(alignment: .top, spacing: 8) {
                        ZStack {
                            if mine {
                                Spinner(color: .white.opacity(0.85), lineWidth: 1.6).padding(2)
                            } else if let checked = o.checked {
                                Image(systemName: checked ? "checkmark.square.fill" : "square")
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(checked ? Color.orcaGreen : Color.white.opacity(0.6))
                            } else {
                                Circle().fill(Color.white.opacity(o.selected ? 0.95 : 0.6))
                                Text("\(o.n)").font(.system(size: 10.5, weight: .bold, design: .rounded)).foregroundStyle(.black.opacity(0.7))
                            }
                        }
                        .frame(width: 16, height: 16)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(o.freeText ? "✎ \(o.label)" : o.label)
                                .font(.system(size: 11.5, weight: .medium))
                                .foregroundStyle(.white.opacity(0.92))
                            if let d = o.description {
                                Text(d).font(.system(size: 10.5)).foregroundStyle(Color.dim).lineLimit(2)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white.opacity(o.checked == true ? 0.13 : 0.07)))
                    .opacity(sending != nil && !mine ? 0.5 : 1)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(sending != nil)
                .help(o.checked != nil ? "Tick or untick" : "Pick this")
            }
        }
    }
}

/// The questions of a multi-question prompt, ticked once answered.
struct QuestionTabs: View {
    let tabs: [MenuTab]

    var body: some View {
        FlowLayout(spacing: 5) {
            ForEach(tabs) { t in
                HStack(spacing: 4) {
                    Image(systemName: t.label == "Submit" ? "paperplane" : t.done ? "checkmark.square.fill" : "square")
                        .font(.system(size: 9.5, weight: .semibold))
                        .foregroundStyle(t.done && t.label != "Submit" ? Color.orcaGreen : Color.white.opacity(0.6))
                    Text(t.label).font(.system(size: 10.5, weight: .semibold)).foregroundStyle(.white.opacity(0.8))
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Capsule().fill(Color.white.opacity(0.08)))
            }
        }
    }
}

/// Back / Next between questions. Next is the way on from a pick-any question.
struct StepButtons: View {
    @EnvironmentObject var store: IslandStore
    let agent: Agent
    let screen: ScreenView

    var body: some View {
        let busy = store.answering[agent.id] != nil
        HStack(spacing: 6) {
            if screen.tabs?.isEmpty == false {
                ActionButton(title: "Back", symbol: "chevron.left") { store.step(agent, "back") }
            }
            ActionButton(title: screen.multi == true ? "Next" : "Skip", symbol: "chevron.right", prominent: screen.multi == true) { store.step(agent, "next") }
            Spacer(minLength: 0)
        }
        .disabled(busy)
        .opacity(busy ? 0.6 : 1)
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? 400
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, width: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(ProposedViewSize(width: maxW, height: nil))
            if x > 0, x + s.width > maxW {
                x = 0
                y += row + spacing
                row = 0
            }
            x += s.width + spacing
            row = max(row, s.height)
            width = max(width, x - spacing)
        }
        return CGSize(width: min(width, maxW), height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX, x + s.width > bounds.maxX {
                x = bounds.minX
                y += row + spacing
                row = 0
            }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: min(s.width, bounds.width), height: s.height))
            x += s.width + spacing
            row = max(row, s.height)
        }
    }
}
