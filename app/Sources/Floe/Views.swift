import SwiftUI

// MARK: palette

extension Color {
    static let orcaBlue = Color(red: 0.40, green: 0.68, blue: 1.0)
    static let orcaOrange = Color(red: 1.0, green: 0.63, blue: 0.22)
    static let orcaGreen = Color(red: 0.33, green: 0.86, blue: 0.52)
    static let orcaPurple = Color(red: 0.74, green: 0.58, blue: 1.0)
    static let dim = Color.white.opacity(0.55)
    static let faint = Color.white.opacity(0.08)
}

func moodColor(_ m: Mood) -> Color {
    switch m {
    case .working: return .orcaBlue
    case .attention: return .orcaOrange
    case .done: return .orcaGreen
    case .thinking: return .orcaPurple
    case .idle: return .white.opacity(0.7)
    case .offline: return .gray
    }
}

func agentMood(_ a: Agent) -> Mood {
    if a.attention != nil { return .attention }
    switch a.state {
    case "working": return .working
    case "done": return .done
    default: return .idle
    }
}

func md(_ s: String) -> AttributedString {
    (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
}

// MARK: shape

/// Hangs from the top edge like the notch: flat top with small flared ears, rounded bottom.
struct IslandShape: Shape {
    var bottomRadius: CGFloat
    var ear: CGFloat = 6

    var animatableData: CGFloat {
        get { bottomRadius }
        set { bottomRadius = newValue }
    }

    func path(in r: CGRect) -> Path {
        let e = min(ear, r.width / 4)
        let br = min(bottomRadius, (r.height) / 2, (r.width - 2 * e) / 2)
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY))
        p.addQuadCurve(to: CGPoint(x: r.minX + e, y: r.minY + e), control: CGPoint(x: r.minX + e, y: r.minY))
        p.addLine(to: CGPoint(x: r.minX + e, y: r.maxY - br))
        p.addArc(tangent1End: CGPoint(x: r.minX + e, y: r.maxY), tangent2End: CGPoint(x: r.minX + e + br, y: r.maxY), radius: br)
        p.addLine(to: CGPoint(x: r.maxX - e - br, y: r.maxY))
        p.addArc(tangent1End: CGPoint(x: r.maxX - e, y: r.maxY), tangent2End: CGPoint(x: r.maxX - e, y: r.maxY - br), radius: br)
        p.addLine(to: CGPoint(x: r.maxX - e, y: r.minY + e))
        p.addQuadCurve(to: CGPoint(x: r.maxX, y: r.minY), control: CGPoint(x: r.maxX - e, y: r.minY))
        p.closeSubpath()
        return p
    }
}

// MARK: root

struct IslandRoot: View {
    @EnvironmentObject var store: IslandStore
    @EnvironmentObject var geo: IslandGeometry

    private var radius: CGFloat {
        switch store.presentation {
        case .compact: return geo.barHeight / 2
        case .peek: return 22
        case .expanded: return 26
        }
    }

    /// A state-colored rim so the island is easy to spot on a black menu bar (half of the
    /// stroke is clipped by the shape, so 2.6 reads as ~1.3pt).
    private var borderStyle: LinearGradient {
        guard store.border else {
            return LinearGradient(colors: [Color.white.opacity(0.07)], startPoint: .leading, endPoint: .trailing)
        }
        let c = store.mood == .idle ? Color(red: 0.75, green: 0.95, blue: 0.9) : moodColor(store.mood)
        let strong = store.mood == .idle || store.mood == .offline ? 0.45 : 0.95
        return LinearGradient(colors: [c.opacity(strong), c.opacity(strong * 0.45), c.opacity(strong)],
                              startPoint: .leading, endPoint: .trailing)
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                IslandShape(bottomRadius: radius).fill(Color.black)
                IslandShape(bottomRadius: radius).stroke(borderStyle, lineWidth: store.border ? 2.6 : 1)
                content(proxy.size)
            }
            .clipShape(IslandShape(bottomRadius: radius))
        }
        .environment(\.colorScheme, .dark)
    }

    @ViewBuilder
    private func content(_ size: CGSize) -> some View {
        switch store.presentation {
        case .compact:
            CompactView()
                .frame(width: size.width, height: size.height)
                .transition(.opacity)
        case .peek:
            PeekView()
                .frame(width: geo.peekSize.width, height: geo.peekSize.height, alignment: .top)
                .frame(width: size.width, height: size.height, alignment: .top)
                .transition(.opacity)
        case .expanded:
            ExpandedView()
                .frame(width: geo.expandedSize.width, height: geo.expandedSize.height, alignment: .top)
                .frame(width: size.width, height: size.height, alignment: .top)
                .transition(.opacity)
        }
    }
}

/// Horizontal drag that moves the whole island along the top edge.
/// (No @State: the Command Line Tools SDK lacks the SwiftUI macro plugin, so drag state
/// lives in IslandGeometry.)
struct DragToMove: ViewModifier {
    @EnvironmentObject var geo: IslandGeometry

    func body(content: Content) -> some View {
        content.gesture(
            DragGesture(minimumDistance: 3, coordinateSpace: .global)
                .onChanged { value in
                    if !geo.dragging {
                        geo.dragging = true
                        geo.onDragBegan(value.translation.width)
                    }
                    geo.onDragMoved()
                }
                .onEnded { _ in
                    geo.dragging = false
                    geo.onDragEnded()
                }
        )
    }
}

extension View {
    func dragToMove() -> some View { modifier(DragToMove()) }
}

// MARK: indicator

struct MoodIndicator: View {
    let mood: Mood
    var size: CGFloat = 16

    // All motion here is Core Animation or SF Symbol effects: no per-frame app work.
    var body: some View {
        ZStack {
            switch mood {
            case .working:
                Spinner(color: .orcaBlue, lineWidth: max(1.5, size * 0.15))
            case .attention:
                Image(systemName: "exclamationmark.circle.fill")
                    .resizable().scaledToFit()
                    .foregroundStyle(Color.orcaOrange)
                    .symbolEffect(.pulse)
            case .done:
                Image(systemName: "checkmark.circle.fill")
                    .resizable().scaledToFit()
                    .foregroundStyle(Color.orcaGreen)
            case .thinking:
                Image(systemName: "sparkle")
                    .resizable().scaledToFit()
                    .foregroundStyle(Color.orcaPurple)
                    .symbolEffect(.pulse)
            case .idle:
                OrcaGlyph().foregroundStyle(Color.white.opacity(0.85))
            case .offline:
                Image(systemName: "bolt.horizontal.circle")
                    .resizable().scaledToFit()
                    .foregroundStyle(Color.gray)
            }
        }
        .frame(width: size, height: size)
    }
}

/// A tiny orca fin.
struct OrcaGlyph: View {
    var body: some View {
        Canvas { ctx, s in
            var p = Path()
            p.move(to: CGPoint(x: s.width * 0.08, y: s.height * 0.86))
            p.addCurve(to: CGPoint(x: s.width * 0.62, y: s.height * 0.06),
                       control1: CGPoint(x: s.width * 0.42, y: s.height * 0.72),
                       control2: CGPoint(x: s.width * 0.40, y: s.height * 0.22))
            p.addCurve(to: CGPoint(x: s.width * 0.92, y: s.height * 0.86),
                       control1: CGPoint(x: s.width * 0.60, y: s.height * 0.45),
                       control2: CGPoint(x: s.width * 0.70, y: s.height * 0.75))
            p.closeSubpath()
            ctx.fill(p, with: .foreground)
        }
    }
}

// MARK: compact

struct CompactView: View {
    @EnvironmentObject var store: IslandStore
    @EnvironmentObject var geo: IslandGeometry

    var body: some View {
        let mood = store.mood
        HStack(spacing: 8) {
            MoodIndicator(mood: mood, size: 15)
            if geo.atNotch {
                if mood != .idle && mood != .offline {
                    Text(wingLeft(mood))
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(moodColor(mood))
                        .lineLimit(1)
                }
                Spacer(minLength: geo.notchWidth)
                if let right = wingRight(mood) {
                    Text(right)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.8))
                        .lineLimit(1)
                }
            } else if mood == .idle {
                Text("Orca").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.85))
                Spacer(minLength: 0)
            } else {
                Text(store.compactText)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.92))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
            }
            TrailingBadge(mood: mood)
        }
        .padding(.leading, 14)
        .padding(.trailing, 14)
        .contentShape(Rectangle())
        .onTapGesture { store.expand() }
        .dragToMove()
        .help(store.compactText)
    }
}

extension CompactView {
    /// Left of the camera: what is happening.
    func wingLeft(_ mood: Mood) -> String {
        let c = store.snapshot?.counts
        switch mood {
        case .attention: return "Needs you"
        case .working: return "\(c?.working ?? 1) working"
        case .done: return "Done"
        case .thinking: return "Thinking"
        default: return ""
        }
    }

    /// Right of the camera: the tool the busiest agent is running right now.
    func wingRight(_ mood: Mood) -> String? {
        switch mood {
        case .attention: return store.attentionAgents.first.map { $0.agentType }
        case .working:
            let a = store.agents.first { $0.state == "working" }
            return a?.steps.last?.tool ?? a?.tool ?? a?.agentType
        case .thinking: return store.chat.last?.tools?.last?.split(separator: ":").first.map(String.init)
        default: return nil
        }
    }
}

struct TrailingBadge: View {
    @EnvironmentObject var store: IslandStore
    let mood: Mood

    var body: some View {
        let c = store.snapshot?.counts
        switch mood {
        case .attention:
            badge("\(c?.attention ?? 1)", .orcaOrange)
        case .working:
            badge("\(c?.working ?? 1)", .orcaBlue)
        case .done:
            Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Color.orcaGreen)
        case .thinking:
            Image(systemName: "waveform")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.orcaPurple)
                .symbolEffect(.variableColor.iterative)
        case .idle:
            if let n = c?.total, n > 0 {
                Text("\(n)").font(.system(size: 11, weight: .semibold, design: .rounded)).foregroundStyle(Color.dim)
            }
        case .offline:
            EmptyView()
        }
    }

    private func badge(_ s: String, _ color: Color) -> some View {
        Text(s)
            .font(.system(size: 11, weight: .bold, design: .rounded))
            .foregroundStyle(.black)
            .padding(.horizontal, 6)
            .frame(minWidth: 18, minHeight: 16)
            .background(Capsule().fill(color))
    }
}

// MARK: peek

struct PeekView: View {
    @EnvironmentObject var store: IslandStore
    @EnvironmentObject var geo: IslandGeometry

    var body: some View {
        if let p = store.peek {
            HStack(alignment: .top, spacing: 12) {
                MoodIndicator(mood: p.mood, size: 24).padding(.top, 2)
                VStack(alignment: .leading, spacing: 3) {
                    Text(p.title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(moodColor(p.mood))
                        .lineLimit(1)
                    Text(p.text)
                        .font(.system(size: 12.5))
                        .foregroundStyle(.white.opacity(0.9))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(.top, geo.topInset + 6)
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .contentShape(Rectangle())
            .onTapGesture {
                if p.agentId != nil { store.expand(agent: p.agentId) } else { store.expand(tab: .ask) }
            }
            .dragToMove()
        }
    }
}

// MARK: expanded

struct ExpandedView: View {
    @EnvironmentObject var store: IslandStore
    @EnvironmentObject var geo: IslandGeometry

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Color.faint).frame(height: 1)
            Group {
                switch store.tab {
                case .live: LiveView()
                case .hosts: HostsView()
                case .ask: ChatView()
                case .settings: SettingsView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            if store.tab != .settings { InputBar() }
        }
        .overlay(alignment: .top) { collapseBand }
    }

    /// The empty black band along the top (around the camera, at the notch): click it to fold
    /// Floe back up, like the chevron. Dragging it still moves Floe along the top edge.
    private var collapseBand: some View {
        Color.clear
            .frame(maxWidth: .infinity)
            .frame(height: geo.topInset + 2)
            .contentShape(Rectangle())
            .onTapGesture { store.collapse() }
            .dragToMove()
            .help("Click to collapse")
    }

    private var header: some View {
        HStack(spacing: 10) {
            MoodIndicator(mood: store.mood, size: 16)
            VStack(alignment: .leading, spacing: 0) {
                Text("Orca").font(.system(size: 13, weight: .semibold))
                Text(summary).font(.system(size: 10.5)).foregroundStyle(Color.dim).lineLimit(1)
            }
            Spacer(minLength: 8)
            TabButton(title: "Live", count: store.liveAgents.count, on: store.tab == .live) { store.tab = .live }
            TabButton(title: "Hosts", count: store.hosts.filter(\.online).count, on: store.tab == .hosts) { store.tab = .hosts }
            TabButton(title: "Ask", count: nil, on: store.tab == .ask) { store.tab = .ask }
            IconButton(symbol: "gearshape", on: store.tab == .settings) {
                store.tab = store.tab == .settings ? .live : .settings
            }
            IconButton(symbol: store.pinned ? "pin.fill" : "pin", on: store.pinned) { store.pinned.toggle() }
                .help("Keep open when clicking elsewhere")
            IconButton(symbol: "chevron.up", on: false) { store.collapse() }
        }
        .padding(.top, geo.topInset + 4)
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
        .contentShape(Rectangle())
        .dragToMove()
    }

    private var summary: String {
        if !store.proxyOnline { return "Floe proxy offline (launchctl kickstart -k gui/$UID/com.mukhayyar.floe.proxy)" }
        guard let s = store.snapshot else { return "Connecting…" }
        if !s.online { return s.headline }
        var bits: [String] = []
        let online = s.hosts.filter { $0.online && $0.counts.workspaces > 0 }.count
        if online > 1 { bits.append("\(online) hosts") }
        if s.counts.attention > 0 { bits.append("\(s.counts.attention) need you") }
        if s.counts.working > 0 { bits.append("\(s.counts.working) working") }
        if s.counts.done > 0 { bits.append("\(s.counts.done) done") }
        return bits.isEmpty ? "No agents running" : bits.joined(separator: " · ")
    }
}

struct TabButton: View {
    let title: String
    let count: Int?
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(title)
                if let count, count > 0 { Text("\(count)").foregroundStyle(on ? .black.opacity(0.6) : Color.dim) }
            }
            .font(.system(size: 11.5, weight: .semibold))
            .foregroundStyle(on ? .black : .white.opacity(0.8))
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Capsule().fill(on ? Color.white.opacity(0.9) : Color.faint))
        }
        .buttonStyle(.plain)
    }
}

struct IconButton: View {
    let symbol: String
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(on ? Color.white : Color.dim)
                .frame(width: 24, height: 22)
                .background(Circle().fill(on ? Color.white.opacity(0.16) : Color.faint))
        }
        .buttonStyle(.plain)
    }
}

// MARK: input

struct InputBar: View {
    @EnvironmentObject var store: IslandStore
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let t = store.toast {
                Text(t).font(.system(size: 11, weight: .medium)).foregroundStyle(Color.orcaGreen)
                    .padding(.horizontal, 6)
                    .transition(.opacity)
            }
            targets
            HStack(spacing: 8) {
                TextField(placeholder, text: $store.input, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .lineLimit(1...4)
                    .focused($focused)
                    .onSubmit { store.send() }
                    .textCursor()
                if store.sending || (store.streaming && store.target == .brain) {
                    ProgressView().controlSize(.small)
                }
                Button { store.send() } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(store.input.isEmpty ? Color.white.opacity(0.25) : Color.white)
                }
                .buttonStyle(.plain)
                .disabled(store.input.isEmpty)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.08)))
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 12)
        .padding(.top, 6)
        .onChange(of: store.focusToken) { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { focused = true }
        }
    }

    private var placeholder: String {
        if case .launch(_, let agent, let label) = store.target {
            return "Task for a new \(agent == "codex" ? "Codex" : "Claude") in \(label)…"
        }
        if case .terminal(_, let label) = store.target {
            return "Command to run in \(label)…"
        }
        if case .workspace(let key, let label) = store.target {
            if let a = store.bestAgent(inWorkspace: key) {
                return a.attention != nil ? "Answer \(a.agentType) in \(label)…" : "Message \(a.agentType) in \(label)…"
            }
            return "Task for a new Claude in \(label)…"
        }
        if let a = store.targetAgent {
            return a.attention != nil ? "Answer \(a.place)…" : "Message \(a.place)…"
        }
        return "Ask Orca anything…"
    }

    /// Who the text goes to. The current pick is pinned up front so it is always visible;
    /// everything else scrolls after it.
    private var targets: some View {
        HStack(spacing: 6) {
            if let pin = pinned {
                HStack(spacing: 5) {
                    Image(systemName: pin.symbol).font(.system(size: 9, weight: .bold))
                    Text(pin.title).font(.system(size: 10.5, weight: .semibold)).lineLimit(1).truncationMode(.middle)
                    Button { store.target = .brain } label: {
                        Image(systemName: "xmark").font(.system(size: 8, weight: .heavy)).padding(2)
                    }
                    .buttonStyle(.plain)
                    .help("Talk to Orca instead")
                }
                .foregroundStyle(Color.black)
                .padding(.leading, 8)
                .padding(.trailing, 5)
                .padding(.vertical, 3)
                .background(Capsule().fill(pin.color))
                .layoutPriority(1)
                .transition(.scale(scale: 0.85).combined(with: .opacity))
            }
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    chip("Orca", symbol: "sparkle", on: store.target == .brain, color: .orcaPurple) { store.target = .brain }
                    ForEach(store.liveAgents.filter { store.target != .agent($0.id) }) { a in
                        chip(a.place, symbol: nil, on: false, color: moodColor(agentMood(a))) {
                            store.target = .agent(a.id)
                            store.expandedAgent = a.id
                            if store.tab != .live && store.tab != .hosts { store.tab = .live }
                        }
                    }
                }
            }
            .scrollIndicators(.never)
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: store.target)
    }

    private var pinned: (title: String, symbol: String, color: Color)? {
        switch store.target {
        case .brain:
            return nil
        case .workspace(let key, let label):
            let a = store.bestAgent(inWorkspace: key)
            return (label, "arrow.triangle.branch", a.map { moodColor(agentMood($0)) } ?? .orcaGreen)
        case .agent(let id):
            guard let a = store.agent(id) else { return nil }
            return ("\(a.agentType) · \(a.place)", "sparkle", moodColor(agentMood(a)))
        case .terminal(_, let label):
            return (label, "terminal", .orcaGreen)
        case .launch(_, let agent, let label):
            return ("New \(agent) · \(label)", "plus", .orcaGreen)
        }
    }

    private func chip(_ title: String, symbol: String?, on: Bool, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let symbol { Image(systemName: symbol).font(.system(size: 9, weight: .bold)) } else {
                    Circle().fill(color).frame(width: 6, height: 6)
                }
                Text(title).font(.system(size: 10.5, weight: .semibold)).lineLimit(1)
            }
            .foregroundStyle(on ? Color.black : Color.white.opacity(0.75))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(on ? color : Color.faint))
        }
        .buttonStyle(.plain)
    }
}

// MARK: settings

struct SettingsView: View {
    @EnvironmentObject var store: IslandStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Toggle("Click-through in full-screen games (open it with \(store.config.hotkey))", isOn: $store.clickThrough)
                Toggle("Play a sound when an agent asks something", isOn: $store.sound)
                Toggle("Show a banner when an agent finishes", isOn: $store.peekOnDone)
                Toggle("Colored border so Floe is easy to spot", isOn: $store.border)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Position").font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.dim)
                    Text("Drag Floe left or right along the top edge. It snaps to the notch. Right-click it for more.")
                        .font(.system(size: 11.5)).foregroundStyle(.white.opacity(0.75))
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Config").font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.dim)
                    Text("~/.config/floe/config.json: hotkey, model, level (screensaver | shielding | statusbar). Restart Floe after editing.")
                        .font(.system(size: 11.5)).foregroundStyle(.white.opacity(0.75))
                }
                HStack {
                    SmallButton(title: "New chat", symbol: "plus") { store.newChat() }
                    SmallButton(title: "Quit Floe", symbol: "power") { NSApp.terminate(nil) }
                }
            }
            .toggleStyle(.switch)
            .controlSize(.mini)
            .font(.system(size: 12))
            .padding(16)
        }
    }
}
