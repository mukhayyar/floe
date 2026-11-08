import AppKit

/// Floe's own cursor while the pointer is over the panel, even when a game is the active app.
///
/// macOS only lets the active app set the cursor, and Floe never becomes active, because that
/// would pull focus out of the game. So, over Floe, you used to see the game's cursor (Dota's
/// gauntlet). Chromium works around this with a private WindowServer connection property,
/// "SetsCursorInBackground", which lets a background app set the cursor. Floe enables it once,
/// then sets the arrow (I-beam over text, closed hand while dragging) only while the pointer is
/// over the panel. When the pointer leaves, the game gets its cursor back on its own.
@MainActor
enum FloeCursor {
    static var hovering = false
    static var dragging = false
    static var overText = false
    private static var enabled = false
    private static var timer: Timer?
    private static var lastLogged = Date.distantPast
    /// Returns whether the pointer is still over Floe (and Floe still takes the mouse).
    static var stillOver: () -> Bool = { false }

    static var current: NSCursor { dragging ? .closedHand : overText ? .iBeam : .arrow }

    static func enableInBackground() {
        typealias Conn = @convention(c) () -> Int32
        typealias SetProp = @convention(c) (Int32, Int32, CFString, CFTypeRef) -> Int32
        let any = UnsafeMutableRawPointer(bitPattern: -2) // RTLD_DEFAULT
        guard let connSym = dlsym(any, "CGSMainConnectionID") ?? dlsym(any, "_CGSDefaultConnection"),
              let setSym = dlsym(any, "CGSSetConnectionProperty") else {
            NSLog("Floe: background cursor unavailable (WindowServer symbols missing)")
            return
        }
        let cid = unsafeBitCast(connSym, to: Conn.self)()
        let err = unsafeBitCast(setSym, to: SetProp.self)(cid, cid, "SetsCursorInBackground" as CFString, kCFBooleanTrue)
        enabled = err == 0
        NSLog("Floe: background cursor %@", enabled ? "enabled" : "failed (\(err))")
    }

    /// When the pointer last arrived on the panel.
    static var enteredAt = Date.distantPast

    static func entered() {
        if !hovering { enteredAt = Date() }
        hovering = true
        apply()
        startTimer()
        logIfDue()
    }

    static func exited() {
        hovering = false
        overText = false
        if !dragging { stopTimer() }
        // Nothing to restore: the game's own cursor area sets its cursor again on entry.
    }

    static func apply() {
        guard enabled, hovering || dragging else { return }
        current.set()
    }

    /// The game can change its cursor while the pointer rests on Floe (a hero walks under it,
    /// an attack cursor shows up). Re-assert ours a few times a second, only while hovering.
    private static func startTimer() {
        guard timer == nil else { return }
        let t = Timer(timeInterval: 0.12, repeats: true) { _ in
            MainActor.assumeIsolated {
                if dragging || stillOver() {
                    apply()
                } else {
                    hovering = false
                    overText = false
                    stopTimer()
                }
            }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private static func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    /// One log line per hover (at most every 30 s) recording which cursor is actually showing.
    private static func logIfDue() {
        guard Date().timeIntervalSince(lastLogged) > 30 else { return }
        lastLogged = Date()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            let sys = NSCursor.currentSystem
            let mine = current
            let ok = sys.map { $0.hotSpot == mine.hotSpot && $0.image.size == mine.image.size } ?? false
            let front = NSWorkspace.shared.frontmostApplication?.localizedName ?? "?"
            NSLog("Floe: cursor over panel = %@ (system cursor %.0fx%.0f, frontmost app: %@)",
                  ok ? "Floe's" : "someone else's",
                  sys?.image.size.width ?? 0, sys?.image.size.height ?? 0, front)
        }
    }
}

import SwiftUI

extension View {
    /// I-beam over a text field, set through FloeCursor so it works while a game is active.
    func textCursor() -> some View {
        onHover { inside in
            FloeCursor.overText = inside
            FloeCursor.apply()
        }
    }
}
