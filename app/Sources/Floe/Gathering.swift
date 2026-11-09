import AppKit
import SwiftUI

// The gathering: every host's karakuri sage riding its orca in the sea before the shrine
// island. The island and the sea are a picture the proxy renders once with the anatomy kit, in
// the same camera as the sages, with a layout that says where the open water is. Over it, the
// pod (Pod.swift) swims the riders, and Core Animation adds the rest of the life: lantern
// light that breathes, fireflies over the island, moonlight glinting on the moving sea. Tap a
// rider to open its host.

struct SceneLayout: Decodable {
    struct Sage: Decodable {
        let size: Double, anchorX: Double, anchorY: Double
        // where the badge (by the sage's head) and the name (by the orca's nose) go, as sprite fractions
        let headX: Double?, headY: Double?, labelX: Double?, labelY: Double?
        let headingX: Double?, headingY: Double?
    }
    struct Lagoon: Decodable { let x: Double; let y: Double; let rx: Double; let ry: Double }
    struct Pond: Decodable { let x: Double; let y: Double; let rx: Double }
    struct Light: Decodable { let x: Double; let y: Double; let r: Double; let color: String }
    struct Seat: Decodable { let x: Double; let y: Double; let depth: Double }
    struct Sea: Decodable { let top: Double; let bottom: Double }
    struct Ocean: Decodable { let top: Double; let bottom: Double; let left: Double; let right: Double }
    struct Spot: Decodable { let x: Double; let y: Double }
    let width: Double
    let height: Double
    /// The rider seen from the front, and from behind (the sheet's "back." rows).
    let sage: Sage
    let sageBack: Sage?
    let lights: [Light]
    let scale: [String: Double]?
    /// The open water the riders swim in, the moorings for sleeping hosts, and where a host
    /// that needs you comes to wait (fractions of the picture).
    let ocean: Ocean?
    let docks: [Spot]?
    let calls: [Spot]?
    let horizon: Double?
    // the lagoon scene's layout (before the riders swam)
    let pond: Pond?
    let sea: Sea?
    let seats: [String: [Seat]]?
    let lagoon: Lagoon?
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
                    Image(nsImage: img)
                        .resizable()
                        .interpolation(.high)
                        .aspectRatio(contentMode: .fill)
                        .frame(width: g.size.width, height: g.size.height)
                        .clipped()
                    SceneLife(layout: layout, size: g.size)
                        .frame(width: g.size.width, height: g.size.height)
                        .allowsHitTesting(false)
                    Pod(riders: riders, layout: layout, size: g.size) { id in store.push(.host(id)) }
                        .frame(width: g.size.width, height: g.size.height)
                    status(working: working, attention: attention)
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

    private var riders: [Pod.Rider] {
        store.hosts.prefix(10).map { h in
            Pod.Rider(id: h.id, name: h.name, subtitle: subtitle(h), online: h.online, mood: store.hostMood(h),
                      badge: h.counts.attention > 0 ? "!" : h.counts.working > 0 ? "\(h.counts.working)" : nil,
                      badgeAttention: h.counts.attention > 0)
        }
    }

    private func subtitle(_ h: HostView) -> String {
        if !h.online { return "asleep" }
        let n = h.projects.count, a = h.counts.agents
        var bits = ["\(n) project\(n == 1 ? "" : "s")"]
        if a > 0 { bits.append("\(a) agent\(a == 1 ? "" : "s")") }
        return bits.joined(separator: " · ")
    }

    /// What everyone is doing, on a pill in the sky.
    private func status(working: Int, attention: Int) -> some View {
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

    private func pondLine(working: Int, attention: Int, hosts: Int) -> String {
        if attention > 0 { return "\(attention) agent\(attention == 1 ? "" : "s") need\(attention == 1 ? "s" : "") you" }
        if working > 0 { return "\(working) agent\(working == 1 ? "" : "s") at work" }
        return "\(hosts) sage\(hosts == 1 ? "" : "s") cruising"
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
                SageAvatar(seed: host.id, kind: host.kind, name: host.name, mood: mood, orbits: host.counts.working,
                           pivot: CGPoint(x: marks?.anchorX ?? 0.398, y: marks?.anchorY ?? 0.59),
                           heading: CGVector(dx: marks?.headingX ?? -0.842, dy: marks?.headingY ?? 0.539))
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

/// The live parts of the scene, all Core Animation: lantern light that breathes, fireflies
/// over the island, and moonlight glinting on the moving sea.
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
            let isle = fit.point(0, ((layout.horizon ?? 0.3) + (layout.ocean?.top ?? 0.5)) / 2).y
            flies.emitterPosition = CGPoint(x: size.width / 2, y: isle)
            flies.emitterSize = CGSize(width: size.width * 0.9, height: size.height * 0.16)
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

            // moonlight glinting on the moving sea, from the island's shore to the bottom
            let glint = CAEmitterCell()
            glint.contents = Self.glint
            glint.birthRate = 9
            glint.lifetime = 5
            glint.lifetimeRange = 2
            glint.velocity = 5
            glint.velocityRange = 3
            glint.emissionLongitude = 0
            glint.emissionRange = 0.25
            glint.scale = 0.5
            glint.scaleRange = 0.25
            glint.alphaRange = 0.3
            glint.alphaSpeed = -0.1
            glint.color = NSColor(red: 0.72, green: 0.84, blue: 1, alpha: 0.55).cgColor
            let seaTop = fit.point(0, layout.ocean?.top ?? layout.sea?.top ?? 0.5).y
            if seaTop < size.height - 6 {
                let sea = CAEmitterLayer()
                sea.frame = CGRect(x: 0, y: seaTop, width: size.width, height: size.height - seaTop)
                sea.emitterShape = .rectangle
                sea.emitterMode = .surface
                sea.emitterPosition = CGPoint(x: size.width / 2, y: (size.height - seaTop) / 2)
                sea.emitterSize = sea.bounds.size
                sea.renderMode = .additive
                sea.emitterCells = [glint]
                root.addSublayer(sea)
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

    /// A short horizontal glint of moonlight on the water, soft at both ends.
    private static let glint: CGImage? = {
        let w = 20, h = 4
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
              let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [CGColor(gray: 1, alpha: 0), CGColor(gray: 1, alpha: 1), CGColor(gray: 1, alpha: 0)] as CFArray, locations: [0, 0.5, 1]) else { return nil }
        ctx.clip(to: CGRect(x: 0, y: 1, width: w, height: 2))
        ctx.drawLinearGradient(g, start: CGPoint(x: 0, y: 2), end: CGPoint(x: w, y: 2), options: [])
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
