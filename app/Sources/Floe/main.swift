import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    var store: IslandStore!
    var controller: IslandController!
    var hotKey: HotKey?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // One island at a time.
        if let id = Bundle.main.bundleIdentifier,
           NSRunningApplication.runningApplications(withBundleIdentifier: id).count > 1 {
            NSApp.terminate(nil)
            return
        }
        let config = IslandConfig.load()
        SageSheets.shared.base = "http://127.0.0.1:\(config.port)"
        store = IslandStore(config: config)
        controller = IslandController(store: store)
        controller.show()
        store.start()
        hotKey = HotKey(config.hotkey) { [weak self] in self?.store.toggle() }
        if hotKey == nil { NSLog("Floe: could not register hotkey \(config.hotkey)") }
    }

    /// floe://live | floe://hosts | floe://ask | floe://collapse | floe://toggle | floe://pin | floe://unpin
    /// floe://host?id=… | floe://project?host=…&key=… | floe://workspace?host=…&project=…&key=…
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme == "floe" {
            let q = Dictionary(uniqueKeysWithValues: (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [])
                .compactMap { i in i.value.map { (i.name, $0) } })
            switch url.host ?? "" {
            case "live": store.expand(tab: .live)
            case "hosts":
                store.pop(to: 0)
                store.expand(tab: .hosts)
            case "host", "project", "workspace":
                store.pop(to: 0)
                store.expand(tab: .hosts)
                if let h = q["id"] ?? q["host"] { store.push(.host(h)) }
                if let h = q["host"], let p = q["project"] ?? (url.host == "project" ? q["key"] : nil) { store.push(.project(h, p)) }
                if url.host == "workspace", let h = q["host"], let p = q["project"], let k = q["key"] { store.push(.workspace(h, p, k)) }
            case "ask": store.expand(tab: .ask, focus: true)
            case "collapse": store.collapse()
            case "pin": store.pinned = true      // stay open when you click elsewhere
            case "unpin": store.pinned = false
            case "selftest": controller.selfTest()
            default: store.toggle()
            }
        }
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
}
