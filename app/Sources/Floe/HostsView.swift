import SwiftUI

// Hosts tab: a zen garden per host (sage + project pebbles), then a clear drill-down with
// breadcrumbs: host › project › worktree, where the worktree page holds its agents and
// terminals with big, obvious actions.

struct HostsView: View {
    @EnvironmentObject var store: IslandStore

    var body: some View {
        VStack(spacing: 0) {
            if !store.hostNav.isEmpty { Breadcrumbs() }
            Group {
                switch store.hostNav.last {
                case nil:
                    GatheringView()
                case .host(let id):
                    HostDetail(hostId: id)
                case .project(let hostId, let key):
                    ProjectDetail(hostId: hostId, projectKey: key)
                case .workspace(let hostId, let projectKey, let key):
                    WorkspaceDetail(hostId: hostId, projectKey: projectKey, workspaceKey: key)
                }
            }
            .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
            .id(store.hostNav.count)
        }
    }
}

// MARK: breadcrumbs

struct Breadcrumbs: View {
    @EnvironmentObject var store: IslandStore

    var body: some View {
        HStack(spacing: 6) {
            Button { store.pop() } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 11, weight: .bold))
                    .frame(width: 26, height: 24)
                    .background(Circle().fill(Color.faint))
            }
            .buttonStyle(.plain)
            ScrollView(.horizontal) {
                HStack(spacing: 4) {
                    crumb("Gathering", index: 0, last: false)
                    ForEach(Array(store.hostNav.enumerated()), id: \.offset) { i, n in
                        Image(systemName: "chevron.compact.right").font(.system(size: 10)).foregroundStyle(Color.dim)
                        crumb(title(n), index: i + 1, last: i == store.hostNav.count - 1)
                    }
                }
            }
            .scrollIndicators(.never)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
    }

    private func title(_ n: HostNav) -> String {
        switch n {
        case .host(let id): return store.host(id)?.name ?? "Host"
        case .project(let h, let p): return store.project(h, p)?.name ?? "Project"
        case .workspace(let h, let p, let w): return store.workspace(h, p, w)?.name ?? "Worktree"
        }
    }

    private func crumb(_ text: String, index: Int, last: Bool) -> some View {
        Button { if !last { store.pop(to: index) } } label: {
            Text(text)
                .font(.system(size: 11.5, weight: last ? .semibold : .medium))
                .foregroundStyle(last ? Color.white : Color.white.opacity(0.6))
                .lineLimit(1)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Capsule().fill(last ? Color.white.opacity(0.12) : Color.clear))
        }
        .buttonStyle(.plain)
    }
}

func kindLabel(_ h: HostView) -> String {
    let kind: String
    switch h.kind {
    case "local": kind = "this Mac"
    case "environment": kind = "Orca server"
    default: kind = "SSH"
    }
    return h.online ? kind : "\(kind) · asleep"
}

// MARK: host page

struct HostDetail: View {
    @EnvironmentObject var store: IslandStore
    let hostId: String

    var body: some View {
        if let host = store.host(hostId) {
            let q = store.projectFilter.lowercased()
            let projects = host.projects.filter { q.isEmpty || $0.name.lowercased().contains(q) || $0.workspaces.contains { $0.name.lowercased().contains(q) } }
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 12) {
                        SageAvatar(seed: host.id, kind: host.kind, name: host.name, mood: store.hostMood(host), orbits: host.counts.working)
                            .frame(width: 92, height: 92)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(host.name).font(.system(size: 16, weight: .semibold))
                            Text(kindLabel(host)).font(.system(size: 11)).foregroundStyle(Color.dim)
                            Text("\(host.projects.count) projects · \(host.counts.workspaces) worktrees · \(host.counts.agents) agents")
                                .font(.system(size: 11)).foregroundStyle(.white.opacity(0.75))
                            HStack(spacing: 6) {
                                if host.counts.attention > 0 { Label("\(host.counts.attention) need you", systemImage: "exclamationmark.circle.fill").foregroundStyle(Color.orcaOrange) }
                                if host.counts.working > 0 { Label("\(host.counts.working) working", systemImage: "circle.dotted").foregroundStyle(Color.orcaBlue) }
                            }
                            .font(.system(size: 10.5, weight: .semibold))
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(LinearGradient(colors: zoneTint(host.id), startPoint: .topLeading, endPoint: .bottomTrailing))
                    )

                    if host.projects.count > 5 {
                        HStack(spacing: 6) {
                            Image(systemName: "magnifyingglass").font(.system(size: 11)).foregroundStyle(Color.dim)
                            TextField("Filter projects and worktrees", text: $store.projectFilter)
                                .textFieldStyle(.plain)
                                .font(.system(size: 12))
                                .textCursor()
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.07)))
                    }

                    if !host.online && host.projects.isEmpty {
                        Text(host.error == "disconnected"
                             ? "Not connected. Connect \(host.name) from Orca's host menu and its projects appear here."
                             : "Unreachable right now (\(host.error ?? "offline")). Floe keeps checking.")
                            .font(.system(size: 12)).foregroundStyle(.white.opacity(0.75))
                            .padding(.vertical, 6)
                    }
                    ForEach(projects) { p in
                        ProjectRowBig(host: host, project: p)
                    }
                }
                .padding(12)
            }
            .scrollIndicators(.never)
        } else {
            Gone(text: "That host is no longer in Orca")
        }
    }
}

struct ProjectRowBig: View {
    @EnvironmentObject var store: IslandStore
    let host: HostView
    let project: ProjectView

    var body: some View {
        let agents = project.workspaces.flatMap(\.agentIds).compactMap { store.agent($0) }
        let working = agents.filter { $0.state == "working" }.count
        let attention = agents.filter { $0.attention != nil }.count
        Button { store.push(.project(host.id, project.key)) } label: {
            HStack(spacing: 10) {
                Pebble(name: project.name, glow: attention > 0 ? .orcaOrange : working > 0 ? .orcaBlue : nil, width: 38, label: false)
                VStack(alignment: .leading, spacing: 2) {
                    Text(project.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    Text(subtitle(agents: agents.count, working: working, attention: attention))
                        .font(.system(size: 10.5)).foregroundStyle(Color.dim).lineLimit(1)
                }
                Spacer(minLength: 4)
                AgentDots(agents: agents)
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Color.dim)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Color.white.opacity(0.05)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func subtitle(agents: Int, working: Int, attention: Int) -> String {
        var bits = ["\(project.workspaces.count) worktree\(project.workspaces.count == 1 ? "" : "s")"]
        if attention > 0 { bits.append("\(attention) need you") }
        if working > 0 { bits.append("\(working) working") }
        if agents > 0 && working == 0 && attention == 0 { bits.append("\(agents) agent\(agents == 1 ? "" : "s") idle") }
        return bits.joined(separator: " · ")
    }
}

// MARK: project page

struct ProjectDetail: View {
    @EnvironmentObject var store: IslandStore
    let hostId: String
    let projectKey: String

    var body: some View {
        if let host = store.host(hostId), let project = store.project(hostId, projectKey) {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        Pebble(name: project.name, width: 44, label: false)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(project.name).font(.system(size: 15, weight: .semibold))
                            Text("\(project.workspaces.count) worktrees on \(host.name)").font(.system(size: 11)).foregroundStyle(Color.dim)
                        }
                        Spacer()
                    }
                    ForEach(project.workspaces) { w in
                        WorkspaceCard(host: host, project: project, workspace: w)
                    }
                }
                .padding(12)
            }
            .scrollIndicators(.never)
        } else {
            Gone(text: "That project is no longer in Orca")
        }
    }
}

struct WorkspaceCard: View {
    @EnvironmentObject var store: IslandStore
    let host: HostView
    let project: ProjectView
    let workspace: WorkspaceView

    var body: some View {
        let agents = workspace.agentIds.compactMap { store.agent($0) }
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 7) {
                Circle().fill(workspace.status == "inactive" ? Color.white.opacity(0.25) : Color.orcaGreen).frame(width: 7, height: 7)
                Text(workspace.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                if workspace.isMain { Tag(text: "main") }
                if !workspace.branch.isEmpty, workspace.branch != workspace.name {
                    Text(workspace.branch).font(.system(size: 10, design: .monospaced)).foregroundStyle(Color.dim).lineLimit(1)
                }
                Spacer(minLength: 4)
                if workspace.liveTerminals > 0 {
                    Label("\(workspace.liveTerminals)", systemImage: "terminal").font(.system(size: 10)).foregroundStyle(Color.dim)
                }
                AgentDots(agents: agents)
            }
            ForEach(agents.prefix(3)) { a in
                HStack(spacing: 6) {
                    MoodIndicator(mood: agentMood(a), size: 10)
                    Text(a.title).font(.system(size: 11)).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
                    if let step = a.steps.last, a.state == "working" {
                        Text(step.tool ?? "").font(.system(size: 10, weight: .semibold)).foregroundStyle(Color.orcaBlue)
                    }
                }
            }
            HStack(spacing: 6) {
                ActionButton(title: "Open", symbol: "arrow.up.forward.app") { store.focusWorkspace(workspace) }
                ActionButton(title: "Terminals", symbol: "terminal", prominent: true) {
                    store.push(.workspace(host.id, project.key, workspace.key))
                }
                ActionButton(title: "Claude", symbol: "plus") { store.beginLaunch(workspace, project: project.name, host: host, agent: "claude") }
                ActionButton(title: "Codex", symbol: "plus") { store.beginLaunch(workspace, project: project.name, host: host, agent: "codex") }
            }
        }
        .padding(11)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.05)))
        .contentShape(Rectangle())
        .onTapGesture { store.push(.workspace(host.id, project.key, workspace.key)) }
    }
}

// MARK: worktree page

struct WorkspaceDetail: View {
    @EnvironmentObject var store: IslandStore
    let hostId: String
    let projectKey: String
    let workspaceKey: String

    var body: some View {
        if let host = store.host(hostId), let project = store.project(hostId, projectKey), let ws = store.workspace(hostId, projectKey, workspaceKey) {
            let agents = ws.agentIds.compactMap { store.agent($0) }
            let place = host.kind == "local" ? "\(project.name)/\(ws.name)" : "\(project.name)/\(ws.name) on \(host.name)"
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(ws.name).font(.system(size: 15, weight: .semibold))
                            if ws.isMain { Tag(text: "main") }
                            Tag(text: host.name)
                        }
                        if !ws.branch.isEmpty { Text(ws.branch).font(.system(size: 10.5, design: .monospaced)).foregroundStyle(Color.dim) }
                        Text(ws.path).font(.system(size: 10, design: .monospaced)).foregroundStyle(Color.white.opacity(0.35)).lineLimit(1).truncationMode(.middle)
                    }
                    HStack(spacing: 6) {
                        ActionButton(title: "Open in Orca", symbol: "arrow.up.forward.app") { store.focusWorkspace(ws) }
                        ActionButton(title: "New terminal", symbol: "plus.rectangle") { store.newTerminal(ws) }
                        ActionButton(title: "Claude", symbol: "plus") { store.beginLaunch(ws, project: project.name, host: host, agent: "claude") }
                        ActionButton(title: "Codex", symbol: "plus") { store.beginLaunch(ws, project: project.name, host: host, agent: "codex") }
                    }

                    if !agents.isEmpty {
                        SectionTitle(text: "Agents", count: agents.count)
                        ForEach(agents) { a in AgentCard(agent: a, showPlace: false) }
                    }

                    SectionTitle(text: "Terminals", count: store.terminals[ws.key]?.count ?? 0)
                    if let terms = store.terminals[ws.key] {
                        if terms.isEmpty {
                            Text("No terminals open. Start one with New terminal.")
                                .font(.system(size: 11.5)).foregroundStyle(Color.dim)
                        }
                        ForEach(terms) { t in TerminalRow(terminal: t, place: place) }
                    } else {
                        HStack(spacing: 6) {
                            ProgressView().controlSize(.small)
                            Text("Loading terminals…").font(.system(size: 11)).foregroundStyle(Color.dim)
                        }
                    }
                }
                .padding(12)
            }
            .scrollIndicators(.never)
        } else {
            Gone(text: "That worktree is no longer in Orca")
        }
    }
}

struct TerminalRow: View {
    @EnvironmentObject var store: IslandStore
    let terminal: TerminalInfo
    let place: String

    var body: some View {
        let open = store.openTerminal == terminal.id
        let typing: Bool = {
            if case .terminal(let id, _) = store.target { return id == terminal.id }
            if case .agent(let id) = store.target, let a = terminal.agentId { return id == a }
            return false
        }()
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                Image(systemName: terminal.agentType != nil ? "sparkle" : "terminal")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(terminal.agentType != nil ? Color.orcaPurple : Color.white.opacity(0.75))
                    .frame(width: 16)
                Text(terminal.title).font(.system(size: 12, weight: .medium)).lineLimit(1)
                if terminal.main { Tag(text: "main") }
                if let a = terminal.agentType { Tag(text: a) }
                Spacer(minLength: 4)
                if let t = terminal.lastOutputAt { Text(ago(t)).font(.system(size: 10)).foregroundStyle(Color.dim) }
            }
            if let p = terminal.preview, !p.isEmpty, !open {
                Text(p).font(.system(size: 10, design: .monospaced)).foregroundStyle(Color.white.opacity(0.5)).lineLimit(1)
            }
            if open {
                Group {
                    if let lines = store.termScreens[terminal.id] {
                        ScrollView {
                            Text(lines.suffix(18).joined(separator: "\n"))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(.white.opacity(0.8))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                        }
                        .defaultScrollAnchor(.bottom)
                        .frame(height: 150)
                    } else {
                        ProgressView().controlSize(.small).frame(maxWidth: .infinity, minHeight: 40)
                    }
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.black.opacity(0.6)))
            }
            HStack(spacing: 6) {
                ActionButton(title: terminal.agentId != nil ? "Message" : "Type command", symbol: "keyboard", prominent: typing) {
                    store.beginTerminal(terminal, place: place)
                }
                ActionButton(title: open ? "Hide screen" : "Peek screen", symbol: open ? "eye.slash" : "eye") { store.toggleTerminal(terminal) }
                ActionButton(title: "Show in Orca", symbol: "arrow.up.forward.app") { store.focusTerminal(terminal) }
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(Color.white.opacity(typing ? 0.09 : 0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(typing ? Color.orcaGreen.opacity(0.6) : Color.clear, lineWidth: 1)
        )
    }
}

// MARK: small parts

struct ActionButton: View {
    let title: String
    let symbol: String
    var prominent = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 10.5, weight: .semibold))
                .lineLimit(1)
                .foregroundStyle(prominent ? Color.black : Color.white.opacity(0.85))
                .padding(.horizontal, 9)
                .frame(height: 24)
                .background(Capsule().fill(prominent ? Color.white.opacity(0.9) : Color.white.opacity(0.09)))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct Tag: View {
    let text: String
    var body: some View {
        Text(text).font(.system(size: 9.5, weight: .semibold)).foregroundStyle(Color.white.opacity(0.7))
            .padding(.horizontal, 6).padding(.vertical, 1.5)
            .background(Capsule().fill(Color.white.opacity(0.1)))
    }
}

struct SectionTitle: View {
    let text: String
    let count: Int
    var body: some View {
        HStack(spacing: 6) {
            Text(text.uppercased()).font(.system(size: 9.5, weight: .bold)).tracking(0.6).foregroundStyle(Color.dim)
            if count > 0 { Text("\(count)").font(.system(size: 9.5, weight: .bold)).foregroundStyle(Color.dim) }
            Rectangle().fill(Color.faint).frame(height: 1)
        }
        .padding(.top, 2)
    }
}

struct Gone: View {
    @EnvironmentObject var store: IslandStore
    let text: String
    var body: some View {
        VStack(spacing: 8) {
            Text(text).font(.system(size: 12)).foregroundStyle(Color.dim)
            ActionButton(title: "Back to the gathering", symbol: "chevron.left") { store.pop(to: 0) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// A dot per agent, colored by state.
struct AgentDots: View {
    let agents: [Agent]

    var body: some View {
        HStack(spacing: 3) {
            ForEach(agents.prefix(6)) { a in
                Circle().fill(moodColor(agentMood(a))).frame(width: 6, height: 6)
            }
            if agents.count > 6 {
                Text("+\(agents.count - 6)").font(.system(size: 9, weight: .semibold)).foregroundStyle(Color.dim)
            }
        }
    }
}
