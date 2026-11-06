import AppKit
import SwiftUI

// The gathering: every host's karakuri sage on one ice floe, no scrolling. The floe is a
// picture the proxy renders once with the anatomy kit, in the same camera as the sages, and
// it says where each seat is; the sages stand on the deck at true scale, nearest drawn last.
// Over the picture, Core Animation adds the live parts: the pond ripples while agents run,
// the lanterns breathe, fireflies drift, and orca fins pass in the sea. Tap a sage to open
// its host.

struct SceneLayout: Decodable {
    struct Sage: Decodable {
        let size: Double, anchorX: Double, anchorY: Double
        // where the badge (by the sage's head) and the name (by the orca's nose) go, as sprite fractions
        let headX: Double?, headY: Double?, labelX: Double?, labelY: Double?
    }
    struct Pond: Decodable { let x: Double; let y: Double; let rx: Double }
    struct Light: Decodable { let x: Double; let y: Double; let r: Double; let color: String }
    struct Seat: Decodable { let x: Double; let y: Double; let depth: Double }
    struct Sea: Decodable { let top: Double; let bottom: Double }
    let width: Double
    let height: Double
    let sage: Sage
    let pond: Pond
    let lights: [Light]
    let sea: Sea
    let seats: [String: [Seat]]
    let scale: [String: Double]?
}

@MainActor
final class FloeScene: ObservableObject {
    static let shared = FloeScene()
    @Published private(set) var image: NSImage?
    @Published private(set) var layout: SceneLayout?
    private var loading = false

    func load() {
        guard image == nil, !loading else { return }
        loading = true
        let base = SageSheets.shared.base
        Task { @MainActor in
            var ok = false
            if let ju = URL(string: "\(base)/scene.json"), let pu = URL(string: "\(base)/scene.png"),
               let (jd, jr) = try? await URLSession.shared.data(from: ju), (jr as? HTTPURLResponse)?.statusCode == 200,
               let layout = try? JSONDecoder().decode(SceneLayout.self, from: jd),
               let (pd, pr) = try? await URLSession.shared.data(from: pu), (pr as? HTTPURLResponse)?.statusCode == 200,
               let img = NSImage(data: pd) {
                self.layout = layout
                self.image = img
                ok = true
            }
            loading = false
            if !ok { DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in self?.load() } }
        }
    }
}

/// Picture fractions → view points, for a picture drawn aspect-fill.
struct SceneFit {
    let scale: CGFloat, dx: CGFloat, dy: CGFloat, w: CGFloat, h: CGFloat
    init(_ layout: SceneLayout, _ size: CGSize) {
        w = layout.width
        h = layout.height
        scale = max(size.width / w, size.height / h)
        dx = (size.width - w * scale) / 2
        dy = (size.height - h * scale) / 2
    }
    func point(_ fx: Double, _ fy: Double) -> CGPoint { CGPoint(x: fx * w * scale + dx, y: fy * h * scale + dy) }
    func length(_ f: Double) -> CGFloat { f * w * scale }
}

struct GatheringView: View {
    @EnvironmentObject var store: IslandStore
    @ObservedObject private var scene = FloeScene.shared

    var body: some View {
        GeometryReader { g in
            let working = store.agents.filter { $0.state == "working" }.count
            let attention = store.attentionAgents.count
            ZStack(alignment: .topLeading) {
                if let img = scene.image, let layout = scene.layout {
                    let fit = SceneFit(layout, g.size)
                    Image(nsImage: img)
                        .resizable()
                        .interpolation(.high)
                        .aspectRatio(contentMode: .fill)
                        .frame(width: g.size.width, height: g.size.height)
                        .clipped()
                    SceneLife(layout: layout, size: g.size)
                        .frame(width: g.size.width, height: g.size.height)
                        .allowsHitTesting(false)
                    pond(layout, fit, working: working, attention: attention)
                    seats(layout, fit)
                } else {
                    LinearGradient(colors: [Color(red: 0.04, green: 0.06, blue: 0.13), Color(red: 0.02, green: 0.03, blue: 0.06)], startPoint: .top, endPoint: .bottom)
                    HStack(spacing: 8) {
                        ForEach(store.hosts) { h in FloeSeat(host: h, size: 84, anchorY: 0.69, marks: nil, layer: .both).frame(width: 84, height: 84) }
                    }
                    .frame(width: g.size.width, height: g.size.height)
                    .onAppear { scene.load() }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .onAppear { scene.load() }
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 4)
    }

    @ViewBuilder
    private func pond(_ layout: SceneLayout, _ fit: SceneFit, working: Int, attention: Int) -> some View {
        let c = fit.point(layout.pond.x, layout.pond.y)
        let rx = fit.length(layout.pond.rx)
        if working + attention > 0 {
            RippleRings(color: attention > 0 ? .orcaOrange : .orcaBlue)
                .frame(width: rx * 2, height: rx)
                .position(c)
                .allowsHitTesting(false)
        }
        // the orca's fin in the pond, and what everyone is doing on a pill in the sky
        OrcaGlyph()
            .foregroundStyle(Color.white.opacity(0.92))
            .frame(width: 18, height: 18)
            .shadow(color: (attention > 0 ? Color.orcaOrange : working > 0 ? Color.orcaBlue : Color.white).opacity(0.9), radius: 6)
            .position(x: c.x, y: c.y - 3)
            .allowsHitTesting(false)
        HStack(spacing: 5) {
            Circle().fill(attention > 0 ? Color.orcaOrange : working > 0 ? Color.orcaBlue : Color.white.opacity(0.5)).frame(width: 6, height: 6)
            Text(pondLine(working: working, attention: attention, hosts: store.hosts.count))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(attention > 0 ? Color.orcaOrange : Color.white.opacity(0.88))
                .lineLimit(1)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Capsule().fill(Color.black.opacity(0.4)))
        .fixedSize()
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private func seats(_ layout: SceneLayout, _ fit: SceneFit) -> some View {
        let hosts = Array(store.hosts.prefix(10))
        let seats = layout.seats["\(max(hosts.count, 1))"] ?? []
        let size = fit.length(layout.sage.size) * (layout.scale?["\(max(hosts.count, 1))"] ?? 1)
        let order = zip(hosts, seats).sorted { $0.1.depth < $1.1.depth }
        // sprites nearest-last, then every name and badge above all of them, so none is hidden
        ForEach(Array(order.enumerated()), id: \.element.0.id) { _, pair in
            let p = fit.point(pair.1.x, pair.1.y)
            FloeSeat(host: pair.0, size: size, anchorY: layout.sage.anchorY, marks: layout.sage, layer: .sprite)
                .frame(width: size, height: size)
                .position(x: p.x - (layout.sage.anchorX - 0.5) * size, y: p.y - (layout.sage.anchorY - 0.5) * size)
        }
        ForEach(Array(order.enumerated()), id: \.element.0.id) { _, pair in
            let p = fit.point(pair.1.x, pair.1.y)
            FloeSeat(host: pair.0, size: size, anchorY: layout.sage.anchorY, marks: layout.sage, layer: .labels)
                .frame(width: size, height: size)
                .position(x: p.x - (layout.sage.anchorX - 0.5) * size, y: p.y - (layout.sage.anchorY - 0.5) * size)
        }
    }

    private func pondLine(working: Int, attention: Int, hosts: Int) -> String {
        if attention > 0 { return "\(attention) agent\(attention == 1 ? "" : "s") need\(attention == 1 ? "s" : "") you" }
        if working > 0 { return "\(working) agent\(working == 1 ? "" : "s") at work" }
        return "\(hosts) sage\(hosts == 1 ? "" : "s") resting"
    }
}

/// One host on the floe: its sage, a count badge by its head, and its name under the plinth.
struct FloeSeat: View {
    @EnvironmentObject var store: IslandStore
    let host: HostView
    let size: CGFloat
    let anchorY: Double
    let marks: SceneLayout.Sage?
    enum Layer { case sprite, labels, both }
    var layer: Layer = .both

    var body: some View {
        let mood = store.hostMood(host)
        let badgeAt = CGPoint(x: size * ((marks?.headX ?? 0.62) + 0.06), y: size * ((marks?.headY ?? 0.14) - 0.05))
        let labelAt = CGPoint(x: size * (marks?.labelX ?? 0.5), y: size * min(0.97, (marks?.labelY ?? (anchorY + 0.27)) + 0.04))
        ZStack {
            if layer != .labels {
                SageAvatar(seed: host.id, kind: host.kind, name: host.name, mood: mood, orbits: host.counts.working)
            }
            if layer != .sprite { labels(badgeAt: badgeAt, labelAt: labelAt) }
        }
        .frame(width: size, height: size)
        .contentShape(Rectangle())
        .allowsHitTesting(layer != .labels)
        .onTapGesture { store.push(.host(host.id)) }
        .help("\(host.name): \(kindLabel(host)). \(host.projects.count) projects, \(host.counts.agents) agents. Click to open.")
    }

    @ViewBuilder
    private func labels(badgeAt: CGPoint, labelAt: CGPoint) -> some View {
            if host.counts.attention > 0 {
                badge("!", .orcaOrange).position(badgeAt)
            } else if host.counts.working > 0 {
                badge("\(host.counts.working)", .orcaBlue).position(badgeAt)
            }
            VStack(spacing: 0) {
                Text(host.name)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(host.online ? Color.white : Color.white.opacity(0.55))
                Text(subtitle)
                    .font(.system(size: 8.5, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.6))
            }
            .lineLimit(1)
            .truncationMode(.middle)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Capsule().fill(Color.black.opacity(0.55)))
            .frame(maxWidth: size * 1.3)
            .fixedSize()
            .position(labelAt)
    }

    private var subtitle: String {
        if !host.online { return "asleep" }
        let n = host.projects.count, a = host.counts.agents
        var bits = ["\(n) project\(n == 1 ? "" : "s")"]
        if a > 0 { bits.append("\(a) agent\(a == 1 ? "" : "s")") }
        return bits.joined(separator: " · ")
    }

    private func badge(_ s: String, _ c: Color) -> some View {
        Text(s)
            .font(.system(size: 9.5, weight: .heavy, design: .rounded))
            .foregroundStyle(.black.opacity(0.8))
            .frame(minWidth: 16, minHeight: 16)
            .background(Circle().fill(c))
            .shadow(color: c.opacity(0.8), radius: 4)
    }
}

/// The live parts of the floe, all Core Animation: lantern light that breathes, fireflies
/// over the deck, and orca fins passing in the sea in front of the floe.
struct SceneLife: NSViewRepresentable {
    let layout: SceneLayout
    let size: CGSize
    func makeNSView(context: Context) -> SceneLifeView { SceneLifeView() }
    func updateNSView(_ v: SceneLifeView, context: Context) { v.configure(layout, size) }
}

final class SceneLifeView: NSView {
    private var built = ""
    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = true
    }
    required init?(coder: NSCoder) { fatalError() }

    func configure(_ layout: SceneLayout, _ size: CGSize) {
        let key = "\(Int(size.width))x\(Int(size.height))"
        guard key != built, size.width > 10, let root = layer else { return }
        built = key
        root.sublayers?.forEach { $0.removeFromSuperlayer() }
        let fit = SceneFit(layout, size)
        let still = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

        for (i, l) in layout.lights.enumerated() {
            let g = CAGradientLayer()
            g.type = .radial
            g.startPoint = CGPoint(x: 0.5, y: 0.5)
            g.endPoint = CGPoint(x: 1, y: 1)
            let c = NSColor(hex: l.color) ?? .orange
            g.colors = [c.withAlphaComponent(0.55).cgColor, c.withAlphaComponent(0).cgColor]
            let r = fit.length(l.r)
            let p = fit.point(l.x, l.y)
            g.frame = CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)
            g.compositingFilter = "screenBlendMode"
            root.addSublayer(g)
            if !still {
                let a = CABasicAnimation(keyPath: "opacity")
                a.fromValue = 0.55
                a.toValue = 1
                a.duration = 1.6 + Double(i) * 0.37
                a.autoreverses = true
                a.repeatCount = .infinity
                a.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                g.add(a, forKey: "breathe")
            }
        }

        if !still {
            let flies = CAEmitterLayer()
            flies.frame = root.bounds
            flies.emitterShape = .rectangle
            flies.emitterPosition = CGPoint(x: size.width / 2, y: size.height * 0.52)
            flies.emitterSize = CGSize(width: size.width * 0.8, height: size.height * 0.4)
            flies.renderMode = .additive
            let cell = CAEmitterCell()
            cell.contents = Self.dot
            cell.birthRate = 0.9
            cell.lifetime = 7
            cell.velocity = 5
            cell.velocityRange = 4
            cell.emissionRange = .pi * 2
            cell.yAcceleration = -0.8
            cell.scale = 0.12
            cell.scaleRange = 0.05
            cell.alphaRange = 0.5
            cell.alphaSpeed = -0.12
            cell.color = NSColor(red: 1, green: 0.86, blue: 0.5, alpha: 0.9).cgColor
            flies.emitterCells = [cell]
            root.addSublayer(flies)

            // a mother orca and her calf, passing left to right in the open sea, now and then
            let seaY = fit.point(0, (layout.sea.top + layout.sea.bottom) / 2).y
            for (i, scale) in [1.0, 0.62].enumerated() {
                let fin = CALayer()
                fin.contents = Self.fin
                fin.bounds = CGRect(x: 0, y: 0, width: 16 * scale, height: 14 * scale)
                fin.position = CGPoint(x: -30, y: min(size.height - 8, seaY + CGFloat(i) * 5))
                fin.opacity = 0
                root.addSublayer(fin)
                let move = CAKeyframeAnimation(keyPath: "position.x")
                move.values = [-30, size.width + 30]
                let fade = CAKeyframeAnimation(keyPath: "opacity")
                fade.values = [0, 0.95, 0.95, 0]
                fade.keyTimes = [0, 0.12, 0.85, 1]
                let bob = CAKeyframeAnimation(keyPath: "transform.translation.y")
                bob.values = [0, 1.6, 0, 1.6, 0]
                let swim = CAAnimationGroup()
                swim.animations = [move, fade, bob]
                swim.duration = 14
                let cycle = CAAnimationGroup()
                cycle.animations = [swim]
                cycle.duration = 34
                cycle.repeatCount = .infinity
                cycle.beginTime = CACurrentMediaTime() + 3 + Double(i) * 1.1
                fin.add(cycle, forKey: "swim")
            }
        }
    }

    private static let dot: CGImage? = {
        let s = 24
        guard let ctx = CGContext(data: nil, width: s, height: s, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
              let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [CGColor(gray: 1, alpha: 1), CGColor(gray: 1, alpha: 0)] as CFArray, locations: [0, 1]) else { return nil }
        ctx.drawRadialGradient(g, startCenter: CGPoint(x: 12, y: 12), startRadius: 0, endCenter: CGPoint(x: 12, y: 12), endRadius: 12, options: [])
        return ctx.makeImage()
    }()

    /// A dorsal fin: black with a moonlit edge and a little wake at its base.
    private static let fin: CGImage? = {
        let w = 32, h = 28
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let p = CGMutablePath()
        p.move(to: CGPoint(x: 6, y: 5))
        p.addCurve(to: CGPoint(x: 20, y: 26), control1: CGPoint(x: 12, y: 10), control2: CGPoint(x: 15, y: 20))
        p.addCurve(to: CGPoint(x: 26, y: 5), control1: CGPoint(x: 22, y: 18), control2: CGPoint(x: 22, y: 9))
        p.closeSubpath()
        ctx.addPath(p)
        ctx.setFillColor(CGColor(red: 0.04, green: 0.05, blue: 0.08, alpha: 1))
        ctx.fillPath()
        ctx.addPath(p)
        ctx.setStrokeColor(CGColor(red: 0.75, green: 0.82, blue: 0.95, alpha: 0.7))
        ctx.setLineWidth(1.2)
        ctx.strokePath()
        ctx.setFillColor(CGColor(red: 0.75, green: 0.85, blue: 1, alpha: 0.45))
        ctx.fillEllipse(in: CGRect(x: 1, y: 2, width: 30, height: 4))
        return ctx.makeImage()
    }()
}

extension NSColor {
    convenience init?(hex: String) {
        let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
}

struct RippleRings: NSViewRepresentable {
    let color: Color

    func makeNSView(context: Context) -> RippleView { RippleView() }
    func updateNSView(_ v: RippleView, context: Context) { v.color = NSColor(color) }
}

final class RippleView: NSView {
    private var rings: [CAShapeLayer] = []
    var color: NSColor = .systemBlue {
        didSet { rings.forEach { $0.strokeColor = color.withAlphaComponent(0.7).cgColor } }
    }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        for _ in 0..<3 {
            let r = CAShapeLayer()
            r.fillColor = nil
            r.lineWidth = 1.2
            r.opacity = 0
            layer?.addSublayer(r)
            rings.append(r)
        }
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for r in rings {
            r.frame = bounds
            r.path = CGPath(ellipseIn: bounds.insetBy(dx: 2, dy: 2), transform: nil)
        }
        CATransaction.commit()
        start()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        start()
    }

    private func start() {
        guard window != nil else { return }
        let now = CACurrentMediaTime()
        for (i, r) in rings.enumerated() where r.animation(forKey: "ripple") == nil {
            let scale = CABasicAnimation(keyPath: "transform.scale")
            scale.fromValue = 0.55
            scale.toValue = 1.15
            let fade = CABasicAnimation(keyPath: "opacity")
            fade.fromValue = 0.8
            fade.toValue = 0
            let g = CAAnimationGroup()
            g.animations = [scale, fade]
            g.duration = 3
            g.repeatCount = .infinity
            g.beginTime = now + Double(i)
            g.timingFunction = CAMediaTimingFunction(name: .easeOut)
            r.add(g, forKey: "ripple")
        }
    }
}

