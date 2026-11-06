import AppKit
import Combine
import SwiftUI

/// Borderless, non-activating, on every Space (including full-screen games): clicking it
/// never steals focus from the app underneath. It only becomes key when a text field
/// needs the keyboard, or when the hotkey asks for it.
final class IslandPanel: NSPanel {
    init() {
        super.init(contentRect: NSRect(x: 0, y: 0, width: 200, height: 32),
                   styleMask: [.borderless, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        isFloatingPanel = true
        becomesKeyOnlyIfNeeded = true
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        hidesOnDeactivate = false
        isMovable = false
        isReleasedWhenClosed = false
        animationBehavior = .none
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class IslandHostingView<Content: View>: NSHostingView<Content> {
    var onRightClick: ((NSEvent) -> Void)?
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func rightMouseDown(with event: NSEvent) { onRightClick?(event) }

    // Floe's own cursor even while a game is the active app (see FloeCursor).
    private var cursorArea: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let a = cursorArea { removeTrackingArea(a) }
        let a = NSTrackingArea(rect: .zero,
                               options: [.mouseEnteredAndExited, .mouseMoved, .cursorUpdate, .activeAlways, .inVisibleRect],
                               owner: self, userInfo: nil)
        addTrackingArea(a)
        cursorArea = a
    }

    override func mouseEntered(with event: NSEvent) {
        super.mouseEntered(with: event)
        if event.trackingArea === cursorArea { FloeCursor.entered() }
    }

    override func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        if event.trackingArea === cursorArea { FloeCursor.exited() }
    }

    override func mouseMoved(with event: NSEvent) {
        super.mouseMoved(with: event)
        if !FloeCursor.hovering { FloeCursor.entered() } else { FloeCursor.apply() }
    }

    override func cursorUpdate(with event: NSEvent) { FloeCursor.apply() }

    override func mouseDown(with event: NSEvent) {
        super.mouseDown(with: event)
        FloeCursor.apply()
    }

    override func mouseDragged(with event: NSEvent) {
        super.mouseDragged(with: event)
        FloeCursor.apply()
    }

    override func mouseUp(with event: NSEvent) {
        super.mouseUp(with: event)
        FloeCursor.apply()
    }
}

/// Geometry the SwiftUI side needs, plus drag callbacks into the controller.
@MainActor
final class IslandGeometry: ObservableObject {
    @Published var atNotch = false
    /// The panel spans the camera notch without being centered on it: keep content below it.
    @Published var overNotch = false
    @Published var notchWidth: CGFloat = 0
    @Published var barHeight: CGFloat = 32
    @Published var expandedSize = CGSize(width: 440, height: 520)
    var topInset: CGFloat { atNotch || overNotch ? barHeight : 8 }
    var peekSize: CGSize { CGSize(width: min(420, expandedSize.width), height: topInset + 66) }

    var dragging = false
    /// Called with how far the pointer already moved before the gesture was recognised.
    var onDragBegan: (CGFloat) -> Void = { _ in }
    var onDragMoved: () -> Void = {}
    var onDragEnded: () -> Void = {}
}

@MainActor
final class IslandController: NSObject {
    let panel = IslandPanel()
    let store: IslandStore
    let geo = IslandGeometry()
    private var hosting: IslandHostingView<AnyView>!
    private var bag = Set<AnyCancellable>()
    private var centerX: CGFloat = 0
    private var dragStart: (mouse: CGFloat, center: CGFloat)?
    private var previousApp: NSRunningApplication?
    private var monitors: [Any] = []
    private let baseLevel: NSWindow.Level

    init(store: IslandStore) {
        self.store = store
        switch store.config.level {
        case "screensaver": baseLevel = .screenSaver
        case "statusbar": baseLevel = .statusBar
        default: baseLevel = NSWindow.Level(rawValue: Int(CGShieldingWindowLevel()) + 1)
        }
        super.init()
        panel.level = baseLevel

        let root = IslandRoot().environmentObject(store).environmentObject(geo)
        hosting = IslandHostingView(rootView: AnyView(root))
        hosting.sizingOptions = []
        hosting.onRightClick = { [weak self] e in self?.showMenu(e) }
        panel.contentView = hosting

        geo.onDragBegan = { [weak self] dx in self?.beginDrag(alreadyMoved: dx) }
        geo.onDragMoved = { [weak self] in self?.drag() }
        geo.onDragEnded = { [weak self] in self?.endDrag() }
        store.requestKey = { [weak self] in self?.takeKey() }

        restorePosition()

        // @Published fires before the value lands; lay out on the next turn.
        store.$presentation.removeDuplicates().sink { [weak self] p in
            DispatchQueue.main.async {
                self?.layout(animated: true)
                if p != .expanded { self?.releaseKey() }
            }
        }.store(in: &bag)
        Publishers.Merge4(store.$snapshot.map { _ in () }, store.$streaming.map { _ in () },
                          store.$proxyOnline.map { _ in () }, store.$clickThrough.map { _ in () })
            .sink { [weak self] in DispatchQueue.main.async { self?.layout(animated: true) } }
            .store(in: &bag)

        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.restorePosition()
                self?.layout(animated: false)
            }
        }

        // Keyboard ownership is the part that matters in games: log it.
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification] {
            NotificationCenter.default.addObserver(forName: name, object: panel, queue: .main) { n in
                let front = NSWorkspace.shared.frontmostApplication?.localizedName ?? "?"
                NSLog("Floe: panel %@ keyboard (frontmost app: %@)", n.name == NSWindow.didBecomeKeyNotification ? "took" : "released", front)
            }
        }

        // Clicking anywhere else (another app, the game) folds the island back up.
        if let m = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.store.presentation == .expanded, !self.store.pinned { self.store.collapse() }
            }
        }) { monitors.append(m) }
        if let m = NSEvent.addLocalMonitorForEvents(matching: .keyDown, handler: { [weak self] e in
            guard e.keyCode == 53 else { return e } // Esc
            MainActor.assumeIsolated { self?.store.collapse() }
            return nil
        }) { monitors.append(m) }
    }

    func show() {
        layout(animated: false)
        panel.orderFrontRegardless()
        FloeCursor.enableInBackground()
        FloeCursor.stillOver = { [weak self] in
            guard let p = self?.panel else { return false }
            return p.isVisible && !p.ignoresMouseEvents && p.frame.contains(NSEvent.mouseLocation)
        }
    }

    // MARK: geometry

    private var screen: NSScreen { NSScreen.screens.first ?? NSScreen.main! }

    private var notchRect: CGRect? {
        let s = screen
        guard s.safeAreaInsets.top > 0, let l = s.auxiliaryTopLeftArea, let r = s.auxiliaryTopRightArea else { return nil }
        return CGRect(x: l.maxX, y: s.frame.maxY - s.safeAreaInsets.top, width: r.minX - l.maxX, height: s.safeAreaInsets.top)
    }

    private func restorePosition() {
        let f = screen.frame
        if let n = notchRect {
            geo.notchWidth = n.width
            geo.barHeight = n.height
        } else {
            geo.notchWidth = 0
            let menuBar = f.maxY - screen.visibleFrame.maxY
            geo.barHeight = max(28, min(menuBar, 40))
        }
        geo.expandedSize = CGSize(width: min(480, f.width - 16), height: min(600, f.height * 0.74))
        let saved = UserDefaults.standard.object(forKey: "anchor") as? Double
        if let saved {
            centerX = f.minX + CGFloat(saved) * f.width
        } else {
            centerX = notchRect?.midX ?? f.midX
        }
        if let n = notchRect, abs(centerX - n.midX) < 2 { centerX = n.midX }
    }

    private func compactSize() -> CGSize {
        let active = store.mood != .idle && store.mood != .offline
        if geo.atNotch {
            // Live-activity wings: room for words on both sides of the camera when busy.
            let wing: CGFloat = active ? 112 : 40
            return CGSize(width: geo.notchWidth + wing * 2, height: geo.barHeight)
        }
        return CGSize(width: active ? 300 : 112, height: geo.barHeight)
    }

    func layout(animated: Bool) {
        if let n = notchRect { geo.atNotch = abs(centerX - n.midX) < 2 } else { geo.atNotch = false }
        let size: CGSize
        switch store.presentation {
        case .compact: size = compactSize()
        case .peek: size = geo.peekSize
        case .expanded: size = geo.expandedSize
        }
        let f = screen.frame
        var x = min(max(centerX - size.width / 2, f.minX), f.maxX - size.width)
        var over = false
        if let n = notchRect, !geo.atNotch, x + size.width > n.minX - 6, x < n.maxX + 6 {
            if store.presentation == .compact, dragStart == nil {
                // Never park the pill half behind the camera: step to the side it is on.
                x = centerX < n.midX ? n.minX - 8 - size.width : n.maxX + 8
                x = min(max(x, f.minX), f.maxX - size.width)
            } else {
                over = true // wide panels keep their content below the camera instead
            }
        }
        if geo.overNotch != over { geo.overNotch = over }
        let frame = NSRect(x: x.rounded(), y: f.maxY - size.height, width: size.width, height: size.height)
        panel.ignoresMouseEvents = store.clickThrough && store.presentation == .compact
        guard frame != panel.frame else { return }
        if animated && panel.isVisible {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = store.presentation == .compact ? 0.3 : 0.36
                ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.2, 1.0)
                panel.animator().setFrame(frame, display: true)
            }
        } else {
            panel.setFrame(frame, display: true)
        }
    }

    // MARK: drag (horizontal only, pinned to the top edge)

    /// Pointer x in screen coordinates, read from the mouse event itself (so it is right for
    /// every kind of input), falling back to the hardware cursor.
    private func pointerX() -> CGFloat {
        if let e = NSApp.currentEvent, e.window === panel,
           [.leftMouseDown, .leftMouseDragged, .leftMouseUp].contains(e.type) {
            return panel.convertPoint(toScreen: e.locationInWindow).x
        }
        return NSEvent.mouseLocation.x
    }

    private func beginDrag(alreadyMoved: CGFloat) {
        // Anchor to where the press started so the pill stays exactly under the cursor.
        dragStart = (pointerX() - alreadyMoved, centerX)
        FloeCursor.dragging = true
        FloeCursor.apply()
        NSLog("Floe: drag began at x=%.0f", centerX)
    }

    private func drag() {
        guard let s = dragStart else { return }
        centerX = s.center + (pointerX() - s.mouse)
        let f = screen.frame
        centerX = min(max(centerX, f.minX + 40), f.maxX - 40)
        layout(animated: false)
    }

    private func endDrag() {
        dragStart = nil
        FloeCursor.dragging = false
        FloeCursor.apply()
        if let n = notchRect, abs(centerX - n.midX) < 44 { centerX = n.midX }
        savePosition()
        layout(animated: true)
        NSLog("Floe: drag ended at x=%.0f (saved)", centerX)
    }

    private func savePosition() {
        let f = screen.frame
        UserDefaults.standard.set(Double((centerX - f.minX) / f.width), forKey: "anchor")
    }

    // MARK: keyboard focus

    private func takeKey() {
        if let front = NSWorkspace.shared.frontmostApplication, front != NSRunningApplication.current {
            previousApp = front
        }
        panel.makeKeyAndOrderFront(nil)
    }

    /// Hand the keyboard back to whatever was in front (the game) without hiding the island.
    private func releaseKey() {
        guard panel.isKeyWindow else { return }
        panel.orderOut(nil)
        panel.orderFrontRegardless()
        if NSApp.isActive { previousApp?.activate() }
    }

    // MARK: self-test (floe://selftest)

    /// Feeds the panel real AppKit events through the normal queue: a pointer drag on the pill
    /// (left 200pt, then back) and an Esc keypress while the panel holds the keyboard. Exercises
    /// the same gesture, move, save and Esc paths a person does; results go to the log.
    func selfTest() {
        guard store.presentation == .compact else {
            store.collapse()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.selfTest() }
            return
        }
        let original = centerX
        NSLog("Floe selftest: start, pill center x=%.0f", original)
        drag(by: -200) { [self] in
            let moved = centerX - original
            NSLog("Floe selftest: drag moved %.0fpt, saved anchor %.4f", moved, UserDefaults.standard.double(forKey: "anchor"))
            drag(by: original - centerX) { [self] in
                NSLog("Floe selftest: dragged back to x=%.0f (started at %.0f)", centerX, original)
                store.expand(focus: true) // what the hotkey does
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
                    NSLog("Floe selftest: open=%@ panelHasKeyboard=%@", store.presentation == .expanded ? "yes" : "no", panel.isKeyWindow ? "yes" : "no")
                    post(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                          windowNumber: panel.windowNumber, context: nil, characters: "\u{1b}",
                                          charactersIgnoringModifiers: "\u{1b}", isARepeat: false, keyCode: 53))
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [self] in
                        NSLog("Floe selftest: after Esc open=%@ panelHasKeyboard=%@ frontmost=%@",
                              store.presentation == .expanded ? "yes" : "no", panel.isKeyWindow ? "yes" : "no",
                              NSWorkspace.shared.frontmostApplication?.localizedName ?? "?")
                    }
                }
            }
        }
    }

    private func post(_ e: NSEvent?) { if let e { NSApp.postEvent(e, atStart: false) } }

    private func mouse(_ type: NSEvent.EventType, screenX: CGFloat) -> NSEvent? {
        let local = NSPoint(x: screenX - panel.frame.minX, y: panel.frame.height / 2)
        return NSEvent.mouseEvent(with: type, location: local, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                  windowNumber: panel.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
                                  pressure: type == .leftMouseUp ? 0 : 1)
    }

    /// A pointer drag on the pill, one event per frame, aimed from the pill's current center.
    private func drag(by dx: CGFloat, then done: @escaping () -> Void) {
        let start = panel.frame.midX
        let steps = 12
        post(mouse(.leftMouseDown, screenX: start))
        for i in 1...steps {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.016 * Double(i)) { [self] in
                post(mouse(.leftMouseDragged, screenX: start + dx * CGFloat(i) / CGFloat(steps)))
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.016 * Double(steps + 2)) { [self] in
            post(mouse(.leftMouseUp, screenX: start + dx))
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: done)
        }
    }

    // MARK: menu

    private func showMenu(_ event: NSEvent) {
        let menu = NSMenu()
        func item(_ title: String, _ sel: Selector, on: Bool? = nil) {
            let i = NSMenuItem(title: title, action: sel, keyEquivalent: "")
            i.target = self
            if let on { i.state = on ? .on : .off }
            menu.addItem(i)
        }
        if notchRect != nil { item("Snap to Notch", #selector(snapNotch)) }
        item("Move to Center", #selector(snapCenter))
        menu.addItem(.separator())
        item("Click-through When Collapsed", #selector(toggleClickThrough), on: store.clickThrough)
        item("Sound When an Agent Asks", #selector(toggleSound), on: store.sound)
        item("Show When an Agent Finishes", #selector(togglePeekDone), on: store.peekOnDone)
        item("Colored Border", #selector(toggleBorder), on: store.border)
        menu.addItem(.separator())
        item("New Floe Chat", #selector(newChat))
        item("Open Orca", #selector(openOrca))
        menu.addItem(.separator())
        item("Quit Floe", #selector(quit))
        // Menus live below our window level; drop the island under them while one is open.
        panel.level = .statusBar
        NSMenu.popUpContextMenu(menu, with: event, for: hosting)
        panel.level = baseLevel
    }

    @objc private func snapNotch() {
        if let n = notchRect { centerX = n.midX; savePosition(); layout(animated: true) }
    }

    @objc private func snapCenter() {
        centerX = screen.frame.midX
        savePosition()
        layout(animated: true)
    }

    @objc private func toggleClickThrough() { store.clickThrough.toggle() }
    @objc private func toggleSound() { store.sound.toggle() }
    @objc private func togglePeekDone() { store.peekOnDone.toggle() }
    @objc private func toggleBorder() { store.border.toggle() }
    @objc private func newChat() { store.newChat() }
    @objc private func openOrca() { NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications/Orca.app")) }
    @objc private func quit() { NSApp.terminate(nil) }
}
