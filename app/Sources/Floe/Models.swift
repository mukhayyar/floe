import Foundation

struct Step: Codable, Equatable, Identifiable {
    let kind: String // tool | say
    let tool: String?
    let text: String
    let at: Double
    let done: Bool
    var id: String { "\(Int(at))|\(kind)|\(tool ?? "")|\(text.prefix(40))" }
}

struct Agent: Codable, Identifiable, Equatable {
    let id: String
    let paneKey: String
    let hostId: String
    let hostName: String
    let worktreeId: String
    let workspaceKey: String
    let workspace: String
    let project: String
    let path: String
    let agentType: String
    let state: String
    let title: String
    let tool: String?
    let detail: String?
    let attention: String?
    let progress: Double?
    let lastMessage: String?
    let since: Double
    let updatedAt: Double
    let steps: [Step]

    var isRemote: Bool { !id.hasPrefix("local|") }
    var place: String { isRemote ? "\(hostName) · \(workspace)" : workspace }
}

struct Counts: Codable, Equatable {
    let working: Int
    let attention: Int
    let done: Int
    let idle: Int
    let total: Int
}

struct WorkspaceView: Codable, Equatable, Identifiable {
    let key: String
    let worktreeId: String
    let name: String
    let branch: String
    let path: String
    let status: String
    let unread: Bool
    let liveTerminals: Int
    let isMain: Bool
    let agentIds: [String]
    var id: String { key }
}

struct ProjectView: Codable, Equatable, Identifiable {
    let key: String
    let name: String
    let workspaces: [WorkspaceView]
    var id: String { key }
}

struct HostCounts: Codable, Equatable {
    let working: Int
    let attention: Int
    let workspaces: Int
    let agents: Int
}

struct HostView: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let kind: String // local | environment | ssh
    let via: String
    let online: Bool
    let error: String?
    let projects: [ProjectView]
    let counts: HostCounts
}

struct Snapshot: Codable, Equatable {
    let at: Double
    let online: Bool
    let error: String?
    let mood: String
    let headline: String
    let counts: Counts
    let agents: [Agent]
    let hosts: [HostView]
}

struct Activity: Codable {
    let kind: String
    let agentId: String
    let workspace: String
    let title: String
    let text: String
    let at: Double
}

struct MenuOption: Codable, Identifiable, Equatable {
    let n: Int
    let label: String
    let selected: Bool
    let freeText: Bool
    var id: Int { n }
}

struct ScreenView: Codable, Equatable {
    let lines: [String]
    let options: [MenuOption]
}

struct ChatMessage: Codable, Identifiable, Equatable {
    var id = UUID()
    let role: String
    var text: String
    let at: Double
    var tools: [String]?
    /// When each tool call arrived (local only, drives the timeline animation).
    var toolAt: [Double]?

    enum CodingKeys: String, CodingKey { case role, text, at, tools }
}

struct ChatHistory: Codable {
    let sessionId: String?
    let busy: Bool
    let messages: [ChatMessage]
}

enum Mood: String {
    case offline, idle, working, attention, done, thinking
}

enum Presentation: Equatable {
    case compact, peek, expanded
}

enum Tab: Equatable {
    case live, hosts, ask, settings
}

enum Target: Equatable {
    case brain
    case agent(String)
    /// Start a new agent in a workspace: (workspaceKey, agentType, label).
    case launch(String, String, String)
    /// Type a command into a terminal: (terminalId, label).
    case terminal(String, String)
    /// A worktree picked in the Hosts tab: messages go to its agent, or start a Claude there.
    case workspace(String, String) // workspaceKey, label
}

/// Drill-down in the Hosts tab: host › project › worktree.
enum HostNav: Equatable {
    case host(String)
    case project(String, String) // hostId, projectKey
    case workspace(String, String, String) // hostId, projectKey, workspaceKey
}

struct TerminalInfo: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let agentType: String?
    let agentId: String?
    let preview: String?
    let lastOutputAt: Double?
    let connected: Bool
    let main: Bool
}

struct TerminalList: Codable {
    let terminals: [TerminalInfo]
}

struct TerminalScreen: Codable {
    let lines: [String]
}

struct Peek: Equatable {
    let mood: Mood
    let title: String
    let text: String
    let agentId: String?
}

/// ~/.config/floe/config.json, shared with the proxy.
struct IslandConfig {
    var port = 7717
    var hotkey = "option+space"
    /// Above everything games use, including SDL's CGShieldingWindowLevel full-screen mode.
    var level = "shielding"

    static func load() -> IslandConfig {
        var c = IslandConfig()
        let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config/floe/config.json")
        guard let data = try? Data(contentsOf: url),
              let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return c }
        if let p = j["port"] as? Int { c.port = p }
        if let h = j["hotkey"] as? String { c.hotkey = h }
        if let l = j["level"] as? String { c.level = l }
        return c
    }
}

func ago(_ ms: Double) -> String {
    let s = max(0, Date().timeIntervalSince1970 - ms / 1000)
    if s < 60 { return "now" }
    if s < 3600 { return "\(Int(s / 60))m" }
    if s < 86400 { return "\(Int(s / 3600))h" }
    return "\(Int(s / 86400))d"
}
