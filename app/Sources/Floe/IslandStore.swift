import AppKit
import SwiftUI

@MainActor
final class IslandStore: ObservableObject {
    let config: IslandConfig
    private var base: String { "http://127.0.0.1:\(config.port)" }

    @Published var snapshot: Snapshot?
    @Published var proxyOnline = false
    @Published var presentation: Presentation = .compact
    @Published var peek: Peek?
    @Published var tab: Tab = .live
    /// Tree rows whose open/closed state the user flipped from the default.
    @Published var toggled: Set<String> = []
    @Published var hostNav: [HostNav] = []
    @Published var projectFilter = ""
    @Published var terminals: [String: [TerminalInfo]] = [:]
    @Published var termScreens: [String: [String]] = [:]
    @Published var openTerminal: String?
    @Published var expandedAgent: String?
    @Published var screens: [String: ScreenView] = [:]
    @Published var chat: [ChatMessage] = []
    @Published var streaming = false
    @Published var input = ""
    @Published var target: Target = .brain
    @Published var sending = false
    @Published var toast: String?
    @Published var pinned = false
    @Published var focusToken = 0
    /// agent id → the option number being sent right now (drives the pressed state).
    @Published var answering: [String: Int] = [:]

    @Published var clickThrough: Bool { didSet { UserDefaults.standard.set(clickThrough, forKey: "clickThrough") } }
    @Published var sound: Bool { didSet { UserDefaults.standard.set(sound, forKey: "sound") } }
    @Published var peekOnDone: Bool { didSet { UserDefaults.standard.set(peekOnDone, forKey: "peekOnDone") } }
    @Published var border: Bool { didSet { UserDefaults.standard.set(border, forKey: "border") } }
    /// Kept by the proxy (it answers even while Floe is closed): deliver held messages, pick recommended options.
    @Published var autoDeliver = false

    /// Set by the window controller: give the panel keyboard focus.
    var requestKey: (() -> Void)?

    private var askTask: Task<Void, Never>?
    private var peekTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?
    private var screenTimer: Timer?

    init(config: IslandConfig) {
        self.config = config
        let d = UserDefaults.standard
        clickThrough = d.bool(forKey: "clickThrough")
        sound = d.object(forKey: "sound") as? Bool ?? true
        peekOnDone = d.object(forKey: "peekOnDone") as? Bool ?? true
        border = d.object(forKey: "border") as? Bool ?? true
    }

    // MARK: derived

    var agents: [Agent] { snapshot?.agents ?? [] }
    var hosts: [HostView] { snapshot?.hosts ?? [] }
    var attentionAgents: [Agent] { agents.filter { $0.attention != nil } }

    func agent(_ id: String) -> Agent? { agents.first { $0.id == id } }

    /// What's happening now: needs-you, working, and recently finished agents on every host.
    var liveAgents: [Agent] {
        let cutoff = Date().timeIntervalSince1970 * 1000 - 20 * 60 * 1000
        return agents.filter { $0.attention != nil || $0.state == "working" || ($0.state == "done" && $0.since > cutoff) }
    }

    func host(_ id: String) -> HostView? { hosts.first { $0.id == id } }
    func project(_ hostId: String, _ key: String) -> ProjectView? { host(hostId)?.projects.first { $0.key == key } }
    func workspace(_ hostId: String, _ projectKey: String, _ key: String) -> WorkspaceView? {
        project(hostId, projectKey)?.workspaces.first { $0.key == key }
    }

    func hostMood(_ h: HostView) -> Mood {
        if !h.online { return .offline }
        if h.counts.attention > 0 { return .attention }
        if h.counts.working > 0 { return .working }
        return .idle
    }

    // MARK: hosts navigation

    func push(_ n: HostNav) {
        projectFilter = ""
        withAnimation(.spring(response: 0.32, dampingFraction: 0.88)) { hostNav.append(n) }
        if case .workspace(_, _, let ws) = n { Task { await loadTerminals(ws) } }
        followNav()
    }

    func pop(to count: Int = -1) {
        withAnimation(.spring(response: 0.32, dampingFraction: 0.88)) {
            if count < 0 { _ = hostNav.popLast() } else { hostNav = Array(hostNav.prefix(count)) }
        }
        openTerminal = nil
        followNav()
    }

    /// The input follows where you are: a worktree page (or a project's main worktree) becomes
    /// the target; leaving them goes back to Orca.
    private func followNav() {
        switch hostNav.last {
        case .workspace(let h, let p, let w):
            if let host = host(h), let proj = project(h, p), let ws = workspace(h, p, w) {
                target = .workspace(ws.key, placeLabel(host, proj, ws))
            }
        case .project(let h, let p):
            if let host = host(h), let proj = project(h, p),
               let ws = proj.workspaces.first(where: \.isMain) ?? proj.workspaces.first {
                target = .workspace(ws.key, placeLabel(host, proj, ws))
            }
        default:
            target = .brain
        }
    }

    func placeLabel(_ host: HostView, _ project: ProjectView, _ ws: WorkspaceView) -> String {
        let place = ws.name == project.name ? project.name : "\(project.name)/\(ws.name)"
        return host.kind == "local" ? place : "\(place) · \(host.name)"
    }

    /// Who hears a message sent to a worktree: whoever needs you, else whoever is working,
    /// else the most recent agent there.
    func bestAgent(inWorkspace key: String) -> Agent? {
        let here = agents.filter { $0.workspaceKey == key }
        return here.first { $0.attention != nil } ?? here.first { $0.state == "working" } ?? here.max { $0.since < $1.since }
    }

    var currentWorkspaceKey: String? {
        if case .workspace(_, _, let ws) = hostNav.last { return ws }
        return nil
    }

    func loadTerminals(_ wsKey: String) async {
        guard let url = URL(string: "\(base)/workspaces/\(path(wsKey))/terminals"),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let list = try? JSONDecoder().decode(TerminalList.self, from: data) else { return }
        if terminals[wsKey] != list.terminals { terminals[wsKey] = list.terminals }
    }

    func loadTerminalScreen(_ id: String) async {
        guard let url = URL(string: "\(base)/terminals/\(path(id))/screen"),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let s = try? JSONDecoder().decode(TerminalScreen.self, from: data) else { return }
        if termScreens[id] != s.lines { termScreens[id] = s.lines }
    }

    func toggleTerminal(_ t: TerminalInfo) {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.88)) {
            openTerminal = openTerminal == t.id ? nil : t.id
        }
        if openTerminal == t.id { Task { await loadTerminalScreen(t.id) } }
    }

    /// Point the input at a terminal: agent terminals get a prompt, shells get a command.
    func beginTerminal(_ t: TerminalInfo, place: String) {
        if let agentId = t.agentId {
            target = .agent(agentId)
        } else {
            target = .terminal(t.id, "\(t.title) · \(place)")
        }
        focusInput()
    }

    func focusTerminal(_ t: TerminalInfo) {
        Task {
            let r = await post("terminals/\(path(t.id))/focus", [:])
            if !r.ok { say(r.message) } else { collapse() }
        }
    }

    func newTerminal(_ ws: WorkspaceView) {
        Task {
            let r = await post("workspaces/\(path(ws.key))/terminal", [:])
            say(r.ok ? "Opened a terminal in \(ws.name)" : r.message)
            await loadTerminals(ws.key)
        }
    }

    func isOpen(_ key: String, default open: Bool) -> Bool { toggled.contains(key) ? !open : open }

    func flip(_ key: String) {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
            if toggled.contains(key) { toggled.remove(key) } else { toggled.insert(key) }
        }
    }

    var mood: Mood {
        if !proxyOnline { return .offline }
        if let s = snapshot, s.mood == "attention" { return .attention }
        if streaming { return .thinking }
        guard let s = snapshot, s.online else { return .offline }
        return Mood(rawValue: s.mood) ?? .idle
    }

    var compactText: String {
        if !proxyOnline { return "Floe proxy offline" }
        if mood == .attention, let s = snapshot { return s.headline }
        if streaming {
            let last = chat.last?.text.split(separator: "\n").last.map(String.init) ?? ""
            return last.isEmpty ? "Orca is thinking…" : last
        }
        return snapshot?.headline ?? "Connecting…"
    }

    var targetAgent: Agent? {
        if case .agent(let id) = target { return agents.first { $0.id == id } }
        return nil
    }

    /// "codex" → "Codex", from what the hosts report.
    func agentName(_ id: String) -> String {
        for h in hosts { if let k = h.agents?.first(where: { $0.id == id }) { return k.label } }
        return agents.first { $0.agentType == id }?.agentLabel ?? id.prefix(1).uppercased() + id.dropFirst()
    }

    /// What starts when you send a task to a workspace with no agent: that host's Orca default.
    func defaultKind(inWorkspace key: String) -> AgentKind {
        let host = hosts.first { $0.projects.contains { $0.workspaces.contains { $0.key == key } } }
        return host?.launchable.first ?? AgentKind.fallback[0]
    }

    func beginLaunch(_ ws: WorkspaceView, project: String, host: HostView, agent: String) {
        let label = host.kind == "local" ? "\(project)/\(ws.name)" : "\(project)/\(ws.name) on \(host.name)"
        target = .launch(ws.key, agent, label)
        focusInput()
    }

    func focusWorkspace(_ ws: WorkspaceView) {
        Task {
            let r = await post("workspaces/\(path(ws.key))/focus", [:])
            if !r.ok { say(r.message) } else { collapse() }
        }
    }

    // MARK: lifecycle

    func start() {
        Task { await runEvents() }
        Task { await loadChat() }
    }

    private func runEvents() async {
        var backoff: UInt64 = 1
        while !Task.isCancelled {
            if let url = URL(string: "\(base)/events") {
                var req = URLRequest(url: url)
                req.timeoutInterval = 60
                do {
                    for try await ev in sseStream(req) {
                        if !proxyOnline { proxyOnline = true; Task { await loadPrefs() } }
                        backoff = 1
                        handle(ev)
                    }
                } catch {}
            }
            proxyOnline = false
            try? await Task.sleep(nanoseconds: backoff * 1_000_000_000)
            backoff = min(backoff * 2, 8)
        }
    }

    private func handle(_ ev: SSEEvent) {
        guard let data = ev.data.data(using: .utf8) else { return }
        switch ev.event {
        case "snapshot":
            if let s = try? JSONDecoder().decode(Snapshot.self, from: data) { apply(s) }
        case "activity":
            if let a = try? JSONDecoder().decode(Activity.self, from: data) { onActivity(a) }
        default: break
        }
    }

    private func apply(_ s: Snapshot) {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { snapshot = s }
        let ids = Set(s.agents.map(\.id))
        screens = screens.filter { ids.contains($0.key) }
        if case .agent(let id) = target, !ids.contains(id) { target = .brain; if tab == .hosts { followNav() } }
        if let e = expandedAgent, !ids.contains(e) { expandedAgent = nil }
        if presentation == .expanded { refreshScreens() }
    }

    private func onActivity(_ a: Activity) {
        switch a.kind {
        case "attention":
            if sound { NSSound(named: "Tink")?.play() }
            Task { await fetchScreen(a.agentId) }
            showPeek(Peek(mood: .attention, title: "\(a.workspace) needs you", text: a.text, agentId: a.agentId), seconds: 9)
        case "auto":
            showPeek(Peek(mood: .done, title: "Floe answered for \(a.workspace)", text: a.text, agentId: a.agentId), seconds: 5)
        case "done":
            if peekOnDone {
                showPeek(Peek(mood: .done, title: "\(a.workspace) finished", text: a.text, agentId: a.agentId), seconds: 6)
            }
        default: break
        }
    }

    // MARK: presentation

    func showPeek(_ p: Peek, seconds: Double) {
        guard presentation != .expanded else { return }
        withAnimation(.spring(response: 0.38, dampingFraction: 0.8)) {
            peek = p
            presentation = .peek
        }
        peekTask?.cancel()
        peekTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled, let self, self.presentation == .peek else { return }
            withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
                self.presentation = .compact
                self.peek = nil
            }
        }
    }

    /// Open the island. With `focus`, it takes the keyboard (hotkey path).
    func expand(agent: String? = nil, tab: Tab? = nil, focus: Bool = false) {
        peekTask?.cancel()
        let attention = attentionAgents.first
        if case .launch = target { target = .brain }
        if case .terminal = target, focus { target = .brain }
        if case .workspace = target, self.tab != .hosts { target = .brain }
        if let agent {
            self.tab = .live
            expandedAgent = agent
            target = .agent(agent)
        } else if let tab {
            self.tab = tab
        } else if let attention {
            self.tab = .live
            expandedAgent = attention.id
            target = .agent(attention.id)
        } else if focus {
            self.tab = .ask
            target = .brain
        }
        withAnimation(.spring(response: 0.4, dampingFraction: 0.82)) {
            presentation = .expanded
            peek = nil
        }
        refreshScreens()
        startScreenTimer()
        if focus { focusInput() }
    }

    func collapse() {
        screenTimer?.invalidate()
        screenTimer = nil
        withAnimation(.spring(response: 0.36, dampingFraction: 0.9)) {
            presentation = .compact
            peek = nil
        }
    }

    func toggle() {
        presentation == .expanded ? collapse() : expand(focus: true)
    }

    func focusInput() {
        requestKey?()
        focusToken += 1
    }

    func select(agent: Agent) {
        if expandedAgent == agent.id {
            expandedAgent = nil
            if target == .agent(agent.id) { target = .brain }
        } else {
            expandedAgent = agent.id
            target = .agent(agent.id)
            Task { await fetchScreen(agent.id) }
        }
    }

    func say(_ text: String) {
        toastTask?.cancel()
        withAnimation { toast = text }
        toastTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            guard !Task.isCancelled else { return }
            withAnimation { self?.toast = nil }
        }
    }

    // MARK: agents

    private func startScreenTimer() {
        screenTimer?.invalidate()
        screenTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshScreens() }
        }
    }

    func refreshScreens() {
        var ids = Set(attentionAgents.map(\.id))
        if let e = expandedAgent { ids.insert(e) }
        for id in ids { Task { await fetchScreen(id) } }
        if tab == .hosts, let ws = currentWorkspaceKey {
            Task { await loadTerminals(ws) }
            if let t = openTerminal { Task { await loadTerminalScreen(t) } }
        }
    }

    private func path(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_."))) ?? id
    }

    func fetchScreen(_ id: String) async {
        guard let url = URL(string: "\(base)/agents/\(path(id))/screen"),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let view = try? JSONDecoder().decode(ScreenView.self, from: data) else { return }
        if screens[id] != view { screens[id] = view }
    }

    func answer(_ agent: Agent, option: MenuOption) {
        if option.freeText {
            target = .agent(agent.id)
            expandedAgent = agent.id
            focusInput()
            say("Type your answer for \(agent.workspace)")
            return
        }
        guard answering[agent.id] == nil else { return }
        // Feel it immediately: pressed state + a trackpad tick before the network round trip.
        answering[agent.id] = option.n
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
        let toggle = option.checked != nil
        Task {
            let r = await post("agents/\(path(agent.id))/answer", ["option": option.n])
            if r.ok, var s = screens[agent.id] {
                // A box flips and the question stays up; any other pick answers it.
                if toggle { s.options = s.options.map { o in var o = o; if o.n == option.n { o.checked = !(o.checked ?? false) }; return o } }
                else { s = ScreenView(lines: s.lines, options: []) }
                withAnimation(.easeOut(duration: 0.2)) { screens[agent.id] = s }
            }
            answering[agent.id] = nil
            if !r.ok { say(r.message) } else if !toggle { say("Picked \(option.n) · \(option.label)") }
            try? await Task.sleep(nanoseconds: 350_000_000)
            await fetchScreen(agent.id)
        }
    }

    /// Back / Next between the questions of a multi-question prompt.
    func step(_ agent: Agent, _ dir: String) {
        guard answering[agent.id] == nil else { return }
        answering[agent.id] = dir == "next" ? -1 : -2
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
        Task {
            let r = await post("agents/\(path(agent.id))/answer", ["step": dir])
            answering[agent.id] = nil
            if !r.ok { say(r.message) }
            try? await Task.sleep(nanoseconds: 300_000_000)
            await fetchScreen(agent.id)
        }
    }

    func focusInOrca(_ agent: Agent) {
        Task {
            let r = await post("agents/\(path(agent.id))/focus", [:])
            if !r.ok { say(r.message) } else { collapse() }
        }
    }

    // MARK: input

    func send() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        input = ""
        switch target {
        case .brain:
            ask(text)
        case .workspace(let key, let label):
            sending = true
            Task {
                if let agent = bestAgent(inWorkspace: key) {
                    let r = await post("agents/\(path(agent.id))/answer", ["text": text])
                    sending = false
                    say(r.ok ? "Sent to \(agent.kindName) in \(label)" : r.message)
                    try? await Task.sleep(nanoseconds: 700_000_000)
                    await fetchScreen(agent.id)
                } else {
                    let kind = defaultKind(inWorkspace: key)
                    let r = await post("workspaces/\(path(key))/launch", ["agent": kind.id, "prompt": text])
                    sending = false
                    say(r.ok ? "Started \(kind.label) in \(label)" : r.message)
                }
            }
        case .launch(let key, let agentType, let label):
            sending = true
            Task {
                let r = await post("workspaces/\(path(key))/launch", ["agent": agentType, "prompt": text])
                sending = false
                say(r.ok ? "Started \(agentName(agentType)) in \(label)" : r.message)
                if r.ok {
                    if tab == .hosts, !hostNav.isEmpty {
                        followNav()
                    } else {
                        target = .brain
                        tab = .live
                    }
                }
            }
        case .terminal(let id, let label):
            sending = true
            Task {
                let r = await post("terminals/\(path(id))/send", ["text": text, "enter": true])
                sending = false
                say(r.ok ? "Ran in \(label)" : r.message)
                try? await Task.sleep(nanoseconds: 900_000_000)
                await loadTerminalScreen(id)
                if openTerminal != id { withAnimation { openTerminal = id } }
            }
        case .agent(let id):
            let name = agents.first { $0.id == id }?.place ?? "agent"
            sending = true
            Task {
                let r = await post("agents/\(path(id))/answer", ["text": text])
                sending = false
                say(r.ok ? "Sent to \(name)" : r.message)
                try? await Task.sleep(nanoseconds: 700_000_000)
                await fetchScreen(id)
            }
        }
    }

    func ask(_ text: String) {
        askTask?.cancel()
        tab = .ask
        chat.append(ChatMessage(role: "user", text: text, at: Date().timeIntervalSince1970 * 1000))
        chat.append(ChatMessage(role: "assistant", text: "", at: Date().timeIntervalSince1970 * 1000, tools: []))
        streaming = true
        let index = chat.count - 1
        askTask = Task { [weak self] in
            guard let self, let url = URL(string: "\(self.base)/ask") else { return }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["text": text])
            req.timeoutInterval = 600
            var finalText: String?
            do {
                for try await ev in sseStream(req) {
                    guard index < self.chat.count,
                          let obj = (try? JSONSerialization.jsonObject(with: Data(ev.data.utf8))) as? [String: Any] else { continue }
                    switch ev.event {
                    case "delta":
                        self.chat[index].text += obj["text"] as? String ?? ""
                    case "tool":
                        let name = obj["name"] as? String ?? "tool"
                        let summary = obj["summary"] as? String ?? ""
                        self.chat[index].tools = (self.chat[index].tools ?? []) + [summary.isEmpty ? name : "\(name): \(summary)"]
                        self.chat[index].toolAt = (self.chat[index].toolAt ?? []) + [Date().timeIntervalSince1970 * 1000]
                    case "done":
                        let t = obj["text"] as? String ?? ""
                        if !t.isEmpty { self.chat[index].text = t }
                        finalText = self.chat[index].text
                    case "error":
                        let m = obj["message"] as? String ?? "error"
                        self.chat[index].text += (self.chat[index].text.isEmpty ? "" : "\n") + "⚠︎ \(m)"
                    default: break
                    }
                }
            } catch {
                if index < self.chat.count, !Task.isCancelled {
                    self.chat[index].text += "\n⚠︎ \(error.localizedDescription)"
                }
            }
            self.streaming = false
            if let finalText, self.presentation != .expanded {
                let short = finalText.replacingOccurrences(of: "\n", with: " ")
                self.showPeek(Peek(mood: .thinking, title: "Orca", text: short, agentId: nil), seconds: 12)
            }
        }
    }

    func stopAsking() {
        Task { _ = await post("ask/stop", [:]) }
    }

    func newChat() {
        askTask?.cancel()
        streaming = false
        chat = []
        Task { _ = await post("chat/new", [:]) }
        say("New conversation")
    }

    func openChatInOrca() {
        Task {
            let r = await post("chat/open", [:])
            if r.ok { collapse() } else { say(r.message) }
        }
    }

    func setAutoDeliver(_ on: Bool) {
        autoDeliver = on
        Task {
            let r = await post("prefs", ["autoDeliver": on])
            if !r.ok { autoDeliver = !on; say(r.message.isEmpty ? "Couldn't change auto-deliver" : r.message) }
        }
    }

    private func loadPrefs() async {
        guard let url = URL(string: "\(base)/prefs"),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        autoDeliver = j["autoDeliver"] as? Bool ?? false
    }

    private func loadChat() async {
        for _ in 0..<20 {
            if let url = URL(string: "\(base)/chat"),
               let (data, _) = try? await URLSession.shared.data(from: url),
               let h = try? JSONDecoder().decode(ChatHistory.self, from: data) {
                if chat.isEmpty { chat = h.messages }
                return
            }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
        }
    }

    private func post(_ path: String, _ body: [String: Any]) async -> (ok: Bool, message: String) {
        guard let url = URL(string: "\(base)/\(path)") else { return (false, "bad url") }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        req.timeoutInterval = 45
        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let ok = j?["ok"] as? Bool ?? false
            return (ok, (j?["result"] as? String) ?? (j?["error"] as? String) ?? "")
        } catch {
            return (false, proxyOnline ? error.localizedDescription : "Floe proxy is offline")
        }
    }
}
