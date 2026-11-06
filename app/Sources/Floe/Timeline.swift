import SwiftUI

// A vertical step-by-step trail of what an agent is doing: each tool call (or thing it said)
// is a node on a rail. When a new step lands, the rail draws down from the previous node,
// the new node pops in, then its text fades in. The current step spins; finished steps tick.
//
// Everything is derived from each step's timestamp inside a TimelineView, so no view state
// is needed (the Command Line Tools SDK has no SwiftUI macro plugin, so no @State).

private func clamp01(_ v: Double) -> Double { min(1, max(0, v)) }
private func ease(_ t: Double) -> Double { 1 - pow(1 - t, 3) }

func toolSymbol(_ tool: String?, kind: String) -> String {
    if kind == "say" { return "text.bubble" }
    switch (tool ?? "").lowercased() {
    case "bash", "shell", "exec", "exec_command", "local_shell": return "terminal"
    case "read", "view", "notebookread": return "doc.text"
    case "edit", "multiedit", "write", "apply_patch", "notebookedit", "str_replace_editor": return "pencil"
    case "grep", "glob", "search", "ls", "find": return "magnifyingglass"
    case "webfetch", "websearch", "fetch", "web_search": return "globe"
    case "task", "agent", "dispatch_agent": return "person.2"
    case "todowrite", "update_plan": return "checklist"
    case "askuserquestion": return "questionmark.bubble"
    default: return "wrench.and.screwdriver"
    }
}

struct StepTimeline: View {
    let steps: [Step]
    /// The agent is still running, so the last unfinished step is "in progress".
    let live: Bool
    var attention = false
    var maxSteps = 6

    var body: some View {
        let shown = Array(steps.suffix(maxSteps))
        let now = Date().timeIntervalSince1970
        // Animate only while the newest step is landing (~1.2s), on a finite schedule that
        // stops by itself. The spinner and the elapsed timer need no frames from us.
        let end = (shown.map(\.at).max() ?? 0) / 1000 + 1.2
        if end > now {
            let frames = stride(from: now, through: end, by: 1.0 / 30).map { Date(timeIntervalSince1970: $0) }
            TimelineView(.explicit(frames)) { ctx in
                rows(shown, now: ctx.date.timeIntervalSince1970 * 1000)
            }
        } else {
            rows(shown, now: 1e15)
        }
    }

    private func rows(_ shown: [Step], now: Double) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if steps.count > shown.count {
                Text("\(steps.count - shown.count) earlier step\(steps.count - shown.count == 1 ? "" : "s")")
                    .font(.system(size: 9.5, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.35))
                    .padding(.leading, 22)
                    .padding(.bottom, 2)
            }
            ForEach(Array(shown.enumerated()), id: \.element.id) { i, step in
                StepRow(
                    step: step,
                    first: i == 0,
                    nextAt: i + 1 < shown.count ? shown[i + 1].at : nil,
                    active: live && i == shown.count - 1 && !step.done,
                    attention: attention && i == shown.count - 1,
                    now: now
                )
            }
        }
    }
}

private struct StepRow: View {
    let step: Step
    let first: Bool
    let nextAt: Double?
    let active: Bool
    let attention: Bool
    let now: Double

    private var color: Color {
        if attention { return .orcaOrange }
        if active { return .orcaBlue }
        return step.kind == "say" ? .orcaPurple.opacity(0.8) : .white.opacity(0.45)
    }

    var body: some View {
        let age = now - step.at
        let top = ease(clamp01((age - 280) / 160)) // rail into this node
        let pop = ease(clamp01((age - 400) / 180)) // node appears
        let reveal = ease(clamp01((age - 440) / 320)) // text fades in
        let bottom = nextAt.map { ease(clamp01((now - $0) / 280)) } ?? 0 // rail drawing to the next node

        HStack(alignment: .top, spacing: 8) {
            // rail
            VStack(spacing: 0) {
                Rectangle()
                    .fill(first ? Color.clear : Color.white.opacity(0.22))
                    .frame(width: 1.5, height: 6)
                    .scaleEffect(x: 1, y: first ? 1 : top, anchor: .top)
                node.scaleEffect(0.35 + 0.65 * pop).opacity(pop)
                GeometryReader { g in
                    Rectangle()
                        .fill(Color.white.opacity(0.22))
                        .frame(width: 1.5, height: g.size.height * bottom)
                        .frame(maxWidth: .infinity, alignment: .center)
                }
                .frame(width: 14)
            }
            .frame(width: 14)

            // text
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 5) {
                    Image(systemName: toolSymbol(step.tool, kind: step.kind))
                        .font(.system(size: 9.5, weight: .semibold))
                        .foregroundStyle(color)
                    Text(step.kind == "say" ? "said" : (step.tool ?? "tool"))
                        .font(.system(size: 10.5, weight: .semibold))
                        .foregroundStyle(active || attention ? color : Color.white.opacity(0.75))
                    if active {
                        Text(timerInterval: Date(timeIntervalSince1970: step.at / 1000)...Date.distantFuture, countsDown: false)
                            .font(.system(size: 9.5, design: .rounded))
                            .foregroundStyle(Color.dim)
                            .monospacedDigit()
                    }
                }
                if !step.text.isEmpty {
                    Text(step.text)
                        .font(.system(size: 10.5, design: step.kind == "tool" ? .monospaced : .default))
                        .foregroundStyle(Color.white.opacity(active ? 0.85 : 0.55))
                        .lineLimit(active ? 3 : 1)
                        .truncationMode(.tail)
                }
            }
            .padding(.top, 3)
            .padding(.bottom, 7)
            .opacity(reveal)
            .offset(x: 6 * (1 - reveal))
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var node: some View {
        if active {
            ZStack {
                Circle().fill(color.opacity(0.18))
                Spinner(color: color, lineWidth: 1.6).padding(1)
            }
            .frame(width: 11, height: 11)
        } else if attention {
            Circle().fill(Color.orcaOrange).frame(width: 9, height: 9)
                .overlay(Text("!").font(.system(size: 7, weight: .black)).foregroundStyle(.black))
        } else if step.kind == "say" {
            Circle().fill(Color.orcaPurple.opacity(0.85)).frame(width: 7, height: 7).padding(2)
        } else {
            ZStack {
                Circle().fill(Color.white.opacity(0.16))
                Image(systemName: "checkmark").font(.system(size: 5.5, weight: .heavy)).foregroundStyle(Color.white.opacity(0.75))
            }
            .frame(width: 11, height: 11)
        }
    }
}
