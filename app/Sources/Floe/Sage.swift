import AppKit
import SwiftUI

// Every host is a karakuri sage: a small mechanical monk on a plinth, drawn with the anatomy
// kit (../sage) and seeded from the host id, so each machine keeps a stable, unique look.
// Projects are pebbles in the garden's sand.

func fnv(_ s: String) -> UInt64 {
    var h: UInt64 = 0xcbf2_9ce4_8422_2325
    for b in s.utf8 {
        h ^= UInt64(b)
        h = h &* 0x0000_0100_0000_01b3
    }
    return h
}

private func rgb(_ r: Double, _ g: Double, _ b: Double) -> Color { Color(red: r, green: g, blue: b) }

/// Each host's karakuri sage, rendered by the proxy (`../sage`, anatomy kit) as a sprite
/// sheet: one row of frames per state. Floe slices it once and plays the frames with a
/// Core Animation keyframe animation on `contents`, so the loop runs in the render server
/// and costs the app nothing per frame.
@MainActor
final class SageSheets {
    static let shared = SageSheets()
    var base = "http://127.0.0.1:7717"

    struct Loop { let frames: [CGImage]; let seconds: Double }
    typealias Sheet = [String: Loop]

    private var sheets: [String: Sheet] = [:]
    private var loading: Set<String> = []
    private var waiters: [String: [(Sheet) -> Void]] = [:]

    func sheet(_ id: String, _ ready: @escaping (Sheet) -> Void) {
        if let s = sheets[id] { ready(s); return }
        waiters[id, default: []].append(ready)
        load(id, attempt: 0)
    }

    private func load(_ id: String, attempt: Int) {
        guard !loading.contains(id), attempt < 60 else { return }
        let path = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
        guard let url = URL(string: "\(base)/sage/\(path).png") else { return }
        loading.insert(id)
        Task { @MainActor in
            var sheet: Sheet?
            var wait: Double = 15
            if let (data, resp) = try? await URLSession.shared.data(from: url), let http = resp as? HTTPURLResponse {
                if http.statusCode == 200, let layout = http.value(forHTTPHeaderField: "x-sage-layout") {
                    sheet = await Task.detached(priority: .utility) { SageSheets.slice(data, layout: layout) }.value
                } else if http.statusCode == 202 {
                    wait = Double(http.value(forHTTPHeaderField: "retry-after") ?? "") ?? 8
                }
            }
            loading.remove(id)
            if let sheet {
                sheets[id] = sheet
                for w in waiters.removeValue(forKey: id) ?? [] { w(sheet) }
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in self?.load(id, attempt: attempt + 1) }
            }
        }
    }

    /// "idle:8:3.2,working:20:2,attention:12:1.3,asleep:4:4;cell=192;cols=20" → frames per state.
    nonisolated static func slice(_ data: Data, layout: String) -> Sheet? {
        let parts = layout.split(separator: ";")
        guard let rows = parts.first?.split(separator: ","),
              let src = CGImageSourceCreateWithData(data as CFData, nil),
              let png = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
        var cell = 192
        for p in parts.dropFirst() where p.hasPrefix("cell=") { cell = Int(p.dropFirst(5)) ?? cell }
        // Decode once into a bitmap, so every cropped frame shares one decoded buffer.
        guard let ctx = CGContext(data: nil, width: png.width, height: png.height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) else { return nil }
        ctx.draw(png, in: CGRect(x: 0, y: 0, width: png.width, height: png.height))
        guard let full = ctx.makeImage() else { return nil }
        var sheet: Sheet = [:]
        for (row, spec) in rows.enumerated() {
            let f = spec.split(separator: ":")
            guard f.count == 3, let n = Int(f[1]), let secs = Double(f[2]) else { continue }
            let frames = (0..<n).compactMap { col in
                full.cropping(to: CGRect(x: col * cell, y: row * cell, width: cell, height: cell))
            }
            if frames.count == n { sheet[String(f[0])] = Loop(frames: frames, seconds: secs) }
        }
        return sheet.isEmpty ? nil : sheet
    }
}

/// A host's sage: its automaton plays the loop for the host's state (writing while agents
/// work, striking the bowl when one needs you, asleep with the lantern out when offline),
/// over a soft ground glow in the state's colour.
struct SageAvatar: NSViewRepresentable {
    let seed: String
    let kind: String
    var name: String = ""
    let mood: Mood
    var orbits: Int = 0
    /// Where the orca meets the sea in the sprite (its rocking pivot), and which way it faces on
    /// screen (SVG axes), so it can ride the swell; the defaults match the current sprites.
    var pivot = CGPoint(x: 0.398, y: 0.59)
    var heading = CGVector(dx: -0.842, dy: 0.539)

    func makeNSView(context: Context) -> SageNSView { SageNSView() }

    func updateNSView(_ view: SageNSView, context: Context) {
        view.setMotion(pivot: pivot, heading: heading)
        view.configure(id: seed, mood: mood)
    }
}

final class SageNSView: NSView {
    private let glow = CAGradientLayer()
    /// Carries the sprite; it bobs, rocks and surges on the swell (Core Animation, no app CPU).
    private let swell = CALayer()
    private let sage = CALayer()
    private var pivot = CGPoint(x: 0.398, y: 0.59)
    private var heading = CGVector(dx: -0.842, dy: 0.539)
    private var swimming = ""
    private var id = ""
    private var mood: Mood = .idle
    private var sheet: SageSheets.Sheet?
    private var playing = ""

    private static let placeholder: CGImage? = {
        let cfg = NSImage.SymbolConfiguration(pointSize: 28, weight: .ultraLight)
        guard let img = NSImage(systemSymbolName: "figure.mind.and.body", accessibilityDescription: nil)?.withSymbolConfiguration(cfg) else { return nil }
        let tinted = NSImage(size: img.size, flipped: false) { r in
            img.draw(in: r)
            NSColor(white: 1, alpha: 0.18).set()
            r.fill(using: .sourceAtop)
            return true
        }
        return tinted.cgImage(forProposedRect: nil, context: nil, hints: nil)
    }()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        glow.type = .radial
        glow.startPoint = CGPoint(x: 0.5, y: 0.5)
        glow.endPoint = CGPoint(x: 1, y: 1)
        sage.contentsGravity = .resizeAspect
        sage.magnificationFilter = .trilinear
        sage.minificationFilter = .trilinear
        layer?.addSublayer(glow)
        swell.addSublayer(sage)
        layer?.addSublayer(swell)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let b = bounds
        glow.frame = CGRect(x: b.minX - b.width * 0.05, y: b.minY - b.height * 0.02, width: b.width * 1.1, height: b.height * 0.62)
        // pivot at the waterline under the orca (sprite fractions are y-down; layers are y-up)
        swell.anchorPoint = CGPoint(x: pivot.x, y: 1 - pivot.y)
        swell.bounds = CGRect(origin: .zero, size: b.size)
        swell.position = CGPoint(x: b.minX + pivot.x * b.width, y: b.minY + (1 - pivot.y) * b.height)
        sage.frame = swell.bounds
        CATransaction.commit()
        swim()
    }

    func setMotion(pivot: CGPoint, heading: CGVector) {
        guard pivot != self.pivot || heading != self.heading else { return }
        self.pivot = pivot
        self.heading = heading
        swimming = ""
        needsLayout = true
    }

    /// Riding the swell: a bob, a gentle rock about the waterline, and a surge back and forth
    /// along the orca's heading. Livelier while agents work, choppy when one needs you, nearly
    /// still when the host is offline. Each host keeps its own phase so the pod isn't in step.
    private func swim() {
        guard window != nil, bounds.width > 4 else { return }
        let key = "\(id)|\(mood)|\(Int(bounds.width))"
        guard key != swimming else { return }
        swimming = key
        swell.removeAllAnimations()
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        let s = bounds.width
        let m: (bob: CGFloat, bobT: Double, rock: CGFloat, rockT: Double, surge: CGFloat, surgeT: Double)
        switch mood {
        case .working, .thinking: m = (0.016, 2.4, 1.8, 3.6, 0.034, 5.2)
        case .attention: m = (0.02, 1.7, 2.4, 2.6, 0.018, 4.0)
        case .offline: m = (0.007, 5.0, 0.7, 7.0, 0.006, 11)
        default: m = (0.012, 3.4, 1.3, 4.6, 0.02, 8.0)
        }
        let phase = Double(fnv(id) % 997) / 997
        func wave(_ path: String, _ amp: CGFloat, _ period: Double, _ offset: Double) -> CABasicAnimation {
            let a = CABasicAnimation(keyPath: path)
            a.fromValue = -amp
            a.toValue = amp
            a.duration = period / 2
            a.autoreverses = true
            a.repeatCount = .infinity
            a.isAdditive = true
            a.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            a.timeOffset = (offset.truncatingRemainder(dividingBy: 1)) * period
            return a
        }
        swell.add(wave("transform.translation.y", m.bob * s, m.bobT, phase), forKey: "bob")
        swell.add(wave("transform.rotation.z", m.rock * .pi / 180, m.rockT, phase + 0.31), forKey: "rock")
        swell.add(wave("transform.translation.x", m.surge * s * heading.dx, m.surgeT, phase + 0.57), forKey: "surgeX")
        swell.add(wave("transform.translation.y", -m.surge * s * heading.dy, m.surgeT, phase + 0.57), forKey: "surgeY")
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        playing = ""
        swimming = ""
        play()
        swim()
    }

    func configure(id: String, mood: Mood) {
        let newHost = id != self.id
        self.mood = mood
        if newHost {
            self.id = id
            sheet = nil
            playing = ""
            sage.removeAllAnimations()
            sage.contentsGravity = .center      // the loading glyph stays small, whatever the seat size
            sage.contents = Self.placeholder
            SageSheets.shared.sheet(id) { [weak self] s in
                guard let self, self.id == id else { return }
                self.sheet = s
                self.playing = ""
                self.play()
            }
        }
        tint()
        play()
        swim()
    }

    private var state: String {
        switch mood {
        case .offline: return "asleep"
        case .attention: return "attention"
        case .working, .thinking: return "working"
        default: return "idle"
        }
    }

    private func tint() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let c: NSColor
        var a: CGFloat = 0.3
        switch mood {
        case .attention: c = NSColor(Color.orcaOrange); a = 0.42
        case .working: c = NSColor(Color.orcaBlue)
        case .thinking: c = NSColor(Color.orcaPurple)
        case .done: c = NSColor(Color.orcaGreen); a = 0.24
        case .idle, .offline: c = .clear; a = 0
        }
        glow.colors = [c.withAlphaComponent(a).cgColor, c.withAlphaComponent(0).cgColor]
        sage.opacity = mood == .offline ? 0.62 : 1
        CATransaction.commit()
        if a > 0, glow.animation(forKey: "pulse") == nil {
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 0.55
            pulse.toValue = 1
            pulse.duration = mood == .attention ? 0.65 : 1.6
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            glow.add(pulse, forKey: "pulse")
        } else if a == 0 {
            glow.removeAnimation(forKey: "pulse")
        }
    }

    /// Start the state's loop, unless it is already running.
    private func play() {
        guard window != nil, let loop = sheet?[state] ?? sheet?["idle"] else { return }
        let key = "\(id)|\(state)"
        guard key != playing || sage.animation(forKey: "frames") == nil else { return }
        playing = key
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        sage.contentsScale = window?.backingScaleFactor ?? 2
        sage.contentsGravity = .resizeAspect
        sage.contents = loop.frames.first
        CATransaction.commit()
        sage.removeAnimation(forKey: "frames")
        guard loop.frames.count > 1, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        let anim = CAKeyframeAnimation(keyPath: "contents")
        anim.values = loop.frames
        anim.calculationMode = .discrete
        anim.duration = loop.seconds
        anim.repeatCount = .infinity
        anim.isRemovedOnCompletion = false
        sage.add(anim, forKey: "frames")
    }
}

// MARK: pebbles

private let stones: [(Color, Color)] = [
    (rgb(0.36, 0.38, 0.42), rgb(0.22, 0.23, 0.26)), // basalt
    (rgb(0.44, 0.49, 0.56), rgb(0.28, 0.31, 0.37)), // slate
    (rgb(0.66, 0.57, 0.46), rgb(0.45, 0.38, 0.30)), // sandstone
    (rgb(0.36, 0.53, 0.48), rgb(0.22, 0.36, 0.32)), // jade
    (rgb(0.62, 0.45, 0.40), rgb(0.42, 0.29, 0.26)), // clay
    (rgb(0.55, 0.55, 0.57), rgb(0.36, 0.36, 0.38)), // granite
]

/// A river stone with its own wobble.
struct PebbleShape: Shape {
    let seed: UInt64

    func path(in r: CGRect) -> Path {
        let n = 9
        var pts: [CGPoint] = []
        for i in 0..<n {
            let a = Double(i) / Double(n) * 2 * .pi
            let jitter = 0.86 + Double((seed >> UInt64((i * 5) % 60)) & 0xF) / 15 * 0.18
            pts.append(CGPoint(x: r.midX + cos(a) * r.width / 2 * jitter, y: r.midY + sin(a) * r.height / 2 * jitter))
        }
        var p = Path()
        let mid = { (a: CGPoint, b: CGPoint) in CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2) }
        p.move(to: mid(pts[n - 1], pts[0]))
        for i in 0..<n { p.addQuadCurve(to: mid(pts[i], pts[(i + 1) % n]), control: pts[i]) }
        p.closeSubpath()
        return p
    }
}

func monogram(_ name: String) -> String {
    let parts = name.split(whereSeparator: { "-_ ./".contains($0) }).filter { !$0.isEmpty }
    if parts.count >= 2 { return String(parts[0].prefix(1) + parts[1].prefix(1)).uppercased() }
    let caps = name.filter(\.isUppercase)
    if caps.count >= 2 { return String(caps.prefix(2)) }
    return String(name.prefix(2)).uppercased()
}

struct Pebble: View {
    let name: String
    var glow: Color? = nil
    var badge: Int = 0
    var width: CGFloat = 46
    var label = true

    var body: some View {
        let seed = fnv(name)
        let stone = stones[Int(seed % UInt64(stones.count))]
        VStack(spacing: 3) {
            ZStack(alignment: .topTrailing) {
                ZStack {
                    PebbleShape(seed: seed)
                        .fill(LinearGradient(colors: [stone.0, stone.1], startPoint: .topLeading, endPoint: .bottomTrailing))
                    PebbleShape(seed: seed)
                        .stroke(glow ?? Color.white.opacity(0.10), lineWidth: glow == nil ? 0.6 : 1.6)
                    Text(monogram(name))
                        .font(.system(size: width * 0.24, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.88))
                }
                .frame(width: width, height: width * 0.68)
                .shadow(color: (glow ?? .black).opacity(glow == nil ? 0.35 : 0.7), radius: glow == nil ? 2 : 6)
                if badge > 1 {
                    Text("\(badge)")
                        .font(.system(size: 8.5, weight: .bold, design: .rounded))
                        .foregroundStyle(.black.opacity(0.75))
                        .padding(.horizontal, 3.5)
                        .frame(minWidth: 13, minHeight: 13)
                        .background(Capsule().fill(Color.white.opacity(0.85)))
                        .offset(x: 4, y: -4)
                }
            }
            if label {
                Text(name)
                    .font(.system(size: 9.5, weight: .medium))
                    .foregroundStyle(.white.opacity(0.75))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(width: width + 18)
            }
        }
    }
}

/// Raked sand: ripples around the sage, straight rake lines elsewhere.
struct SandRakes: View {
    let center: CGPoint

    var body: some View {
        Canvas { ctx, size in
            for i in 0..<7 {
                let r = 44 + Double(i) * 9
                ctx.stroke(Path(ellipseIn: CGRect(x: center.x - r, y: center.y - r * 0.82, width: r * 2, height: r * 1.64)),
                           with: .color(.white.opacity(0.045)), lineWidth: 1)
            }
            var y = 10.0
            while y < size.height {
                var line = Path()
                line.move(to: CGPoint(x: center.x + 110, y: y))
                var x = center.x + 110
                while x < size.width {
                    line.addQuadCurve(to: CGPoint(x: x + 24, y: y), control: CGPoint(x: x + 12, y: y + 1.6))
                    x += 24
                }
                ctx.stroke(line, with: .color(.white.opacity(0.03)), lineWidth: 1)
                y += 8
            }
        }
        .allowsHitTesting(false)
    }
}

func zoneTint(_ seed: String) -> [Color] {
    let tints: [[Color]] = [
        [rgb(0.07, 0.13, 0.16), rgb(0.04, 0.07, 0.09)], // deep teal
        [rgb(0.09, 0.09, 0.17), rgb(0.05, 0.05, 0.10)], // ink indigo
        [rgb(0.08, 0.13, 0.10), rgb(0.04, 0.07, 0.05)], // moss
        [rgb(0.15, 0.10, 0.09), rgb(0.08, 0.05, 0.05)], // ember
        [rgb(0.12, 0.10, 0.15), rgb(0.06, 0.05, 0.09)], // dusk
    ]
    return tints[Int(fnv(seed) % UInt64(tints.count))]
}
