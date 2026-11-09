import AppKit
import SwiftUI

// The pod: every host's orca rider swimming in the open sea in front of the shrine island.
//
// Each rider swims its own loop, a diamond whose four legs run along the picture's two
// isometric diagonals, so it always faces the way it swims: the sheet has the rider seen from
// the front (heading down-left) and from behind (heading up-right), and the other two
// headings are those mirrored. At each corner it turns to the next view. Riders swim faster
// while their host's agents work and cruise slowly when idle; a host that needs you comes to
// the front and waits there (spouting), and a host that's offline drifts asleep by the island.
//
// It's all Core Animation: position, depth (nearer riders pass in front), facing, the sprite
// loops and the swell run in the render server, so the app does no work per frame. Taps hit
// the rider where it is on screen right now (its presentation layer).

/// Which way a rider faces on screen, and how to draw it: from the front or behind, and mirrored.
enum Facing: Int {
    case downLeft, downRight, upRight, upLeft
    var back: Bool { self == .upRight || self == .upLeft }
    var mirrored: Bool { self == .downRight || self == .upLeft }

    /// The facing that best matches a move by (dx, dy), in y-up view points.
    static func of(dx: CGFloat, dy: CGFloat) -> Facing {
        switch (dx >= 0, dy >= 0) {
        case (false, false): return .downLeft
        case (true, false): return .downRight
        case (true, true): return .upRight
        case (false, true): return .upLeft
        }
    }
}

struct Pod: NSViewRepresentable {
    struct Rider: Equatable {
        let id: String
        let name: String
        let subtitle: String
        let online: Bool
        let mood: Mood
        let badge: String?
        let badgeAttention: Bool
    }
    let riders: [Rider]
    let layout: SceneLayout
    let size: CGSize
    var onTap: (String) -> Void

    func makeNSView(context: Context) -> PodView { PodView() }
    func updateNSView(_ v: PodView, context: Context) {
        v.onTap = onTap
        v.configure(riders, layout: layout, size: size)
    }
}

@MainActor
final class PodView: NSView {
    var onTap: (String) -> Void = { _ in }
    private let riderLayer = CALayer()
    private let tagLayer = CALayer()
    private var riders: [String: RiderNode] = [:]
    private var order: [String] = []
    private var geometryKey = ""

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = true
        layer?.addSublayer(riderLayer)
        layer?.addSublayer(tagLayer)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    func configure(_ list: [Pod.Rider], layout: SceneLayout, size: CGSize) {
        guard size.width > 20, size.height > 20 else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        riderLayer.frame = CGRect(origin: .zero, size: size)
        tagLayer.frame = riderLayer.frame
        CATransaction.commit()

        let ids = list.map(\.id)
        let fit = SceneFit(layout, size)
        let n = max(1, list.count)
        let spriteSize = fit.length(layout.sage.size) * CGFloat(layout.scale?["\(n)"] ?? 1.5)
        let key = "\(Int(size.width))x\(Int(size.height))|\(ids.joined(separator: ","))|\(Int(spriteSize))"
        let regeometry = key != geometryKey
        geometryKey = key

        for gone in Set(riders.keys).subtracting(ids) {
            riders[gone]?.remove()
            riders[gone] = nil
        }
        order = ids
        let sea = SeaGeometry(layout: layout, fit: fit, size: size, sprite: spriteSize)
        var parked = (dock: 0, call: 0)
        for (i, r) in list.enumerated() {
            let node = riders[r.id] ?? {
                let made = RiderNode(id: r.id, riderLayer: riderLayer, tagLayer: tagLayer)
                riders[r.id] = made
                return made
            }()
            node.updateTag(r, sprite: spriteSize)
            let lane = sea.lane(index: i, of: n, id: r.id)
            let plan: RiderNode.Plan
            switch r.mood {
            case .offline:
                let p = sea.dock(parked.dock); parked.dock += 1
                plan = .park(p, p.x < size.width / 2 ? .downRight : .downLeft, "asleep")
            case .attention:
                let p = sea.call(parked.call); parked.call += 1
                plan = .park(p, p.x < size.width / 2 ? .downRight : .downLeft, "attention")
            case .working, .thinking:
                plan = .swim(lane, speed: sea.speed * 2.1, state: "working")
            default:
                plan = .swim(lane, speed: sea.speed, state: "idle")
            }
            node.apply(plan, sprite: spriteSize, layout: layout, regeometry: regeometry)
            node.setMood(r.mood)
        }
    }

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        // nearest first: the rider drawn on top gets the click
        let hits = riders.values
            .map { ($0, $0.hit(p)) }
            .filter { $0.1 != nil }
            .sorted { $0.1! > $1.1! }
        if let (node, _) = hits.first { onTap(node.id) } else { super.mouseDown(with: event) }
    }
}

/// Where riders may swim, park and wait, in this view's points (y up).
struct SeaGeometry {
    let band: CGRect          // where a rider's waterline may go
    let docks: [CGPoint]
    let calls: [CGPoint]
    let sprite: CGFloat
    let speed: CGFloat        // idle cruising speed, points per second
    let height: CGFloat

    init(layout: SceneLayout, fit: SceneFit, size: CGSize, sprite: CGFloat) {
        self.sprite = sprite
        height = size.height
        let top = fit.point(0, layout.ocean?.top ?? 0.5).y           // y down
        let yUp = { (yDown: CGFloat) in size.height - yDown }
        let marginX = sprite * 0.34
        let minYDown = top + sprite * 0.06
        let maxYDown = size.height - sprite * 0.3
        band = CGRect(x: marginX, y: yUp(maxYDown), width: max(10, size.width - marginX * 2), height: max(10, maxYDown - minYDown))
        docks = (layout.docks ?? []).map { let p = fit.point($0.x, $0.y); return CGPoint(x: p.x, y: yUp(p.y)) }
        calls = (layout.calls ?? []).map { let p = fit.point($0.x, $0.y); return CGPoint(x: p.x, y: yUp(min(p.y, maxYDown))) }
        speed = max(10, size.width / 30)
    }

    func dock(_ i: Int) -> CGPoint { docks.isEmpty ? CGPoint(x: band.midX, y: band.maxY) : docks[i % docks.count] }
    func call(_ i: Int) -> CGPoint { calls.isEmpty ? CGPoint(x: band.midX, y: band.minY + band.height * 0.25) : calls[i % calls.count] }

    /// A host's loop: a diamond with legs along the two screen diagonals, sized and placed
    /// per host so the loops cross one another, clamped inside the open water.
    func lane(index i: Int, of n: Int, id: String) -> RiderNode.Lane {
        // the diagonals in y-up points: h1 runs down-left, h2 down-right
        let h1 = CGVector(dx: -0.842, dy: -0.539), h2 = CGVector(dx: 0.842, dy: -0.539)
        let golden = (Double(i) * 0.618_034).truncatingRemainder(dividingBy: 1)
        let maxSpan = min(band.height / 0.539, band.width / 0.842)       // a + b at most
        // smaller loops for a bigger pod, so each keeps to its own stretch of water
        let span = maxSpan * (n == 1 ? 0.9 : n == 2 ? 0.66 : 0.46 + 0.2 * CGFloat(golden))
        let ratio = 0.32 + 0.36 * CGFloat((golden + 0.37).truncatingRemainder(dividingBy: 1))
        let a = span * ratio, b = span - a
        let t = (CGFloat(i) + 0.5) / CGFloat(n)
        // spread across the water, neighbours alternately nearer and farther
        var c = CGPoint(x: band.minX + band.width * (0.14 + 0.72 * t), y: band.midY + band.height * (i % 2 == 0 ? -0.16 : 0.16))
        // the diamond's half extents, then keep it inside the band
        let hw = (a + b) * 0.842 / 2, hh = (a + b) * 0.539 / 2
        c.x = min(max(c.x, band.minX + hw), band.maxX - hw)
        c.y = min(max(c.y, band.minY + hh), band.maxY - hh)
        let top = CGPoint(x: c.x - (a * h1.dx + b * h2.dx) / 2, y: c.y - (a * h1.dy + b * h2.dy) / 2)
        let left = CGPoint(x: top.x + a * h1.dx, y: top.y + a * h1.dy)
        let bottom = CGPoint(x: left.x + b * h2.dx, y: left.y + b * h2.dy)
        let right = CGPoint(x: bottom.x - a * h1.dx, y: bottom.y - a * h1.dy)
        let clockwise = i % 2 == 1
        let corners = clockwise ? [top, right, bottom, left] : [top, left, bottom, right]
        let phase = Double(fnv(id) % 1000) / 1000
        return RiderNode.Lane(corners: corners, phase: phase)
    }
}

/// One host's rider and its name tag, all Core Animation.
@MainActor
final class RiderNode {
    struct Lane: Equatable { let corners: [CGPoint]; let phase: Double }
    enum Plan: Equatable {
        case swim(Lane, speed: CGFloat, state: String)
        case park(CGPoint, Facing, String)
    }

    let id: String
    private let container = CALayer()
    private let glow = CAGradientLayer()
    private let swell = CALayer()
    private let flip = CALayer()
    private let front = CALayer()
    private let backView = CALayer()
    private let tag = CALayer()
    private let name = CATextLayer()
    private let sub = CATextLayer()
    private let badge = CATextLayer()
    private var sheet: SageSheets.Sheet?
    private var plan: Plan?
    private var mood: Mood = .idle
    private var size: CGFloat = 0
    private var marks: (front: SceneLayout.Sage, back: SceneLayout.Sage?)?
    /// The loop now running: when it started and how long one lap takes (to keep its phase).
    private var lap: (begin: CFTimeInterval, duration: Double, lane: Lane)?
    private var playing = ""
    private var tagOffset: CGFloat = 0

    init(id: String, riderLayer: CALayer, tagLayer: CALayer) {
        self.id = id
        glow.type = .radial
        glow.startPoint = CGPoint(x: 0.5, y: 0.5)
        glow.endPoint = CGPoint(x: 1, y: 1)
        for l in [front, backView] {
            l.contentsGravity = .resizeAspect
            l.magnificationFilter = .trilinear
            l.minificationFilter = .trilinear
        }
        container.addSublayer(glow)
        container.addSublayer(swell)
        swell.addSublayer(flip)
        flip.addSublayer(front)
        flip.addSublayer(backView)
        riderLayer.addSublayer(container)

        tag.backgroundColor = NSColor.black.withAlphaComponent(0.55).cgColor
        tag.masksToBounds = false
        for t in [name, sub, badge] {
            t.contentsScale = 2
            t.alignmentMode = .center
            t.truncationMode = .middle
            tag.addSublayer(t)
        }
        badge.masksToBounds = true
        tagLayer.addSublayer(tag)

        SageSheets.shared.sheet(id) { [weak self] s in
            guard let self else { return }
            self.sheet = s
            self.playing = ""
            self.play()
        }
    }

    func remove() {
        container.removeFromSuperlayer()
        tag.removeFromSuperlayer()
    }

    // MARK: name tag

    func updateTag(_ r: Pod.Rider, sprite: CGFloat) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let nameFont = NSFont.systemFont(ofSize: 10, weight: .semibold)
        let subFont = NSFont.systemFont(ofSize: 8.5, weight: .medium)
        name.string = NSAttributedString(string: r.name, attributes: [.font: nameFont, .foregroundColor: NSColor.white.withAlphaComponent(r.online ? 1 : 0.55)])
        sub.string = NSAttributedString(string: r.subtitle, attributes: [.font: subFont, .foregroundColor: NSColor.white.withAlphaComponent(0.6)])
        let maxW = max(60, sprite * 1.3)
        let w = min(maxW, max(textWidth(r.name, nameFont), textWidth(r.subtitle, subFont)) + 14)
        tag.bounds = CGRect(x: 0, y: 0, width: w, height: 27)
        tag.cornerRadius = 13.5
        name.frame = CGRect(x: 7, y: 13, width: w - 14, height: 13)
        sub.frame = CGRect(x: 7, y: 2, width: w - 14, height: 11)
        if let b = r.badge {
            let c = r.badgeAttention ? NSColor(Color.orcaOrange) : NSColor(Color.orcaBlue)
            badge.isHidden = false
            badge.string = NSAttributedString(string: b, attributes: [.font: NSFont.systemFont(ofSize: 9.5, weight: .heavy), .foregroundColor: NSColor.black.withAlphaComponent(0.8)])
            badge.backgroundColor = c.cgColor
            badge.frame = CGRect(x: w - 9, y: 18, width: 16, height: 16)
            badge.cornerRadius = 8
            badge.shadowColor = c.cgColor
        } else {
            badge.isHidden = true
        }
        tagOffset = sprite * 0.24 + 8
        CATransaction.commit()
    }

    private func textWidth(_ s: String, _ f: NSFont) -> CGFloat { ceil((s as NSString).size(withAttributes: [.font: f]).width) }

    // MARK: mood: the sprite loop and the glow

    func setMood(_ m: Mood) {
        guard m != mood || glow.colors == nil else { return }
        mood = m
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        var a: CGFloat = 0.3
        let c: NSColor
        switch m {
        case .attention: c = NSColor(Color.orcaOrange); a = 0.42
        case .working: c = NSColor(Color.orcaBlue)
        case .thinking: c = NSColor(Color.orcaPurple)
        case .done: c = NSColor(Color.orcaGreen); a = 0.24
        case .idle, .offline: c = .clear; a = 0
        }
        glow.colors = [c.withAlphaComponent(a).cgColor, c.withAlphaComponent(0).cgColor]
        flip.opacity = m == .offline ? 0.62 : 1
        CATransaction.commit()
        glow.removeAnimation(forKey: "pulse")
        if a > 0, !still {
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 0.55
            pulse.toValue = 1
            pulse.duration = m == .attention ? 0.65 : 1.6
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            glow.add(pulse, forKey: "pulse")
        }
        bob()
        play()
    }

    private var still: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    private var state: String {
        switch plan {
        case .swim(_, _, let s): return s
        case .park(_, _, let s): return s
        case nil: return "idle"
        }
    }

    /// Start the state's sprite loop on both views, unless it is already running.
    private func play() {
        guard let sheet, let loop = sheet[state] ?? sheet["idle"] else { return }
        let key = state
        guard key != playing || front.animation(forKey: "frames") == nil else { return }
        playing = key
        let backLoop = sheet["back.\(state)"] ?? sheet["back.idle"] ?? loop
        for (layer, l) in [(front, loop), (backView, backLoop)] {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.contentsScale = 2
            layer.contents = l.frames.first
            CATransaction.commit()
            layer.removeAnimation(forKey: "frames")
            guard l.frames.count > 1, !still else { continue }
            let anim = CAKeyframeAnimation(keyPath: "contents")
            anim.values = l.frames
            anim.calculationMode = .discrete
            anim.duration = l.seconds
            anim.repeatCount = .infinity
            layer.add(anim, forKey: "frames")
        }
    }

    /// The swell: a bob and a gentle rock about the waterline, livelier while working.
    private func bob() {
        swell.removeAllAnimations()
        guard !still, size > 0 else { return }
        let m: (bob: CGFloat, bobT: Double, rock: CGFloat, rockT: Double)
        switch mood {
        case .working, .thinking: m = (0.014, 2.2, 1.6, 3.4)
        case .attention: m = (0.02, 1.7, 2.4, 2.6)
        case .offline: m = (0.007, 5.0, 0.7, 7.0)
        default: m = (0.011, 3.2, 1.2, 4.6)
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
            a.timeOffset = offset.truncatingRemainder(dividingBy: 1) * period
            return a
        }
        swell.add(wave("transform.translation.y", m.bob * size, m.bobT, phase), forKey: "bob")
        swell.add(wave("transform.rotation.z", m.rock * .pi / 180, m.rockT, phase + 0.31), forKey: "rock")
    }

    // MARK: geometry

    /// Lay out the sprite so the waterline point of each view sits at the container's centre,
    /// which is what moves along the path (and what the swell rocks about).
    private func setSize(_ s: CGFloat, layout: SceneLayout) {
        size = s
        let f = layout.sage, b = layout.sageBack
        marks = (f, b)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let box = CGRect(x: 0, y: 0, width: s, height: s)
        container.bounds = box
        swell.frame = box
        flip.frame = box
        let place = { (layer: CALayer, ax: Double, ay: Double) in
            layer.frame = CGRect(x: s / 2 - ax * s, y: s / 2 - (1 - ay) * s, width: s, height: s)
        }
        place(front, f.anchorX, f.anchorY)
        place(backView, b?.anchorX ?? (1 - f.anchorX), b?.anchorY ?? f.anchorY)
        glow.frame = CGRect(x: s * 0.05, y: s * 0.22, width: s * 0.9, height: s * 0.5)
        CATransaction.commit()
        bob()
    }

    /// Show one facing now (model values), with no animation.
    private func face(_ f: Facing) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        front.opacity = f.back ? 0 : 1
        backView.opacity = f.back ? 1 : 0
        flip.transform = CATransform3DMakeScale(f.mirrored ? -1 : 1, 1, 1)
        CATransaction.commit()
    }

    private func place(_ p: CGPoint) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        container.position = p
        container.zPosition = -p.y
        tag.position = CGPoint(x: p.x, y: p.y - tagOffset)
        tag.zPosition = -p.y
        CATransaction.commit()
    }

    /// Where the rider is on screen right now (mid-animation included).
    private var now: CGPoint { container.presentation()?.position ?? container.position }

    func apply(_ next: Plan, sprite: CGFloat, layout: SceneLayout, regeometry: Bool) {
        let resized = abs(sprite - size) > 0.5
        if resized { setSize(sprite, layout: layout) }
        guard next != plan || regeometry || resized else { return }
        let previous = plan
        plan = next
        play()
        let from = previous == nil || regeometry ? nil : now
        clearMotion()

        switch next {
        case let .park(p, facing, _):
            lap = nil
            place(p)
            face(facing)
            if let from, !still, hypot(p.x - from.x, p.y - from.y) > 2 {
                glide(from: from, to: p, then: facing, speed: max(30, sprite * 0.6))
            }
        case let .swim(lane, speed, _):
            let perimeter = zip(lane.corners, lane.corners.dropFirst() + [lane.corners[0]]).reduce(0) { $0 + hypot($1.1.x - $1.0.x, $1.1.y - $1.0.y) }
            let duration = Double(perimeter / speed)
            // keep our place on the same loop when only the speed changed
            var fraction = lane.phase
            if let lap, lap.lane == lane, previous != nil, !regeometry {
                fraction = ((CACurrentMediaTime() - lap.begin) / lap.duration).truncatingRemainder(dividingBy: 1)
                if fraction < 0 { fraction += 1 }
                swimLoop(lane, duration: duration, fraction: fraction, begin: CACurrentMediaTime())
            } else if let from, !still {
                // join the loop at its nearest corner
                let k = lane.corners.indices.min { hypot(lane.corners[$0].x - from.x, lane.corners[$0].y - from.y) < hypot(lane.corners[$1].x - from.x, lane.corners[$1].y - from.y) }!
                let at = fractionAt(corner: k, of: lane)
                let g = glide(from: from, to: lane.corners[k], then: nil, speed: speed * 1.2)
                swimLoop(lane, duration: duration, fraction: at, begin: CACurrentMediaTime() + g)
            } else {
                swimLoop(lane, duration: duration, fraction: fraction, begin: CACurrentMediaTime())
            }
        }
    }

    private func clearMotion() {
        for l in [container, tag] { l.removeAnimation(forKey: "glide"); l.removeAnimation(forKey: "swim"); l.removeAnimation(forKey: "glideZ"); l.removeAnimation(forKey: "swimZ") }
        for l in [front, backView, flip] { l.removeAnimation(forKey: "glideFace"); l.removeAnimation(forKey: "swimFace") }
    }

    /// Where along the loop (0..1, by distance) a corner is.
    private func fractionAt(corner k: Int, of lane: Lane) -> Double {
        let legs = legLengths(lane)
        let total = legs.reduce(0, +)
        return Double(legs.prefix(k).reduce(0, +) / max(total, 1))
    }

    private func legLengths(_ lane: Lane) -> [CGFloat] {
        let c = lane.corners
        return c.indices.map { i in let a = c[i], b = c[(i + 1) % c.count]; return hypot(b.x - a.x, b.y - a.y) }
    }

    /// A straight swim from one point to another, facing the way it goes; returns its duration.
    @discardableResult
    private func glide(from: CGPoint, to: CGPoint, then: Facing?, speed: CGFloat) -> Double {
        let d = hypot(to.x - from.x, to.y - from.y)
        let duration = min(7, max(1.2, Double(d / speed)))
        let facing = Facing.of(dx: to.x - from.x, dy: to.y - from.y)
        let begin = CACurrentMediaTime()
        func move(_ layer: CALayer, offset: CGFloat) {
            let a = CABasicAnimation(keyPath: "position")
            a.fromValue = CGPoint(x: from.x, y: from.y - offset)
            a.toValue = CGPoint(x: to.x, y: to.y - offset)
            a.duration = duration
            a.beginTime = begin
            a.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            a.fillMode = .backwards
            layer.add(a, forKey: "glide")
            let z = CABasicAnimation(keyPath: "zPosition")
            z.fromValue = -from.y
            z.toValue = -to.y
            z.duration = duration
            z.beginTime = begin
            z.fillMode = .backwards
            layer.add(z, forKey: "glideZ")
        }
        move(container, offset: 0)
        move(tag, offset: tagOffset)
        hold(facing, from: begin, for: duration, key: "glideFace")
        return duration
    }

    /// Keep a facing for a while (overrides the model values while it runs).
    private func hold(_ f: Facing, from begin: CFTimeInterval, for duration: Double, key: String) {
        func set(_ layer: CALayer, _ path: String, _ value: Any) {
            let a = CABasicAnimation(keyPath: path)
            a.fromValue = value
            a.toValue = value
            a.duration = duration
            a.beginTime = begin
            a.fillMode = .backwards
            layer.add(a, forKey: key)
        }
        set(front, "opacity", f.back ? 0 : 1)
        set(backView, "opacity", f.back ? 1 : 0)
        set(flip, "transform", CATransform3DMakeScale(f.mirrored ? -1 : 1, 1, 1))
    }

    /// Lap the loop forever from `fraction` of the way round, starting at `begin`.
    private func swimLoop(_ lane: Lane, duration: Double, fraction: Double, begin: CFTimeInterval) {
        lap = (begin - fraction * duration, duration, lane)
        let c = lane.corners
        let legs = legLengths(lane)
        let total = max(legs.reduce(0, +), 1)
        var times: [NSNumber] = [0]
        var run: CGFloat = 0
        for l in legs { run += l; times.append(NSNumber(value: Double(run / total))) }
        let points = c + [c[0]]
        let facings = c.indices.map { i in Facing.of(dx: c[(i + 1) % c.count].x - c[i].x, dy: c[(i + 1) % c.count].y - c[i].y) }

        // model values: where it is at `fraction`, so the picture is right if animations stop
        let start = point(at: fraction, points: points, times: times.map(\.doubleValue))
        place(start)
        face(facings[max(0, (times.lastIndex { $0.doubleValue <= fraction } ?? 0)) % facings.count])
        guard !still else { return }

        func loop(_ layer: CALayer, offset: CGFloat) {
            let a = CAKeyframeAnimation(keyPath: "position")
            a.values = points.map { CGPoint(x: $0.x, y: $0.y - offset) }
            a.keyTimes = times
            a.calculationMode = .linear
            a.duration = duration
            a.repeatCount = .infinity
            a.beginTime = begin
            a.timeOffset = fraction * duration
            layer.add(a, forKey: "swim")
            let z = CAKeyframeAnimation(keyPath: "zPosition")
            z.values = points.map { -$0.y }
            z.keyTimes = times
            z.duration = duration
            z.repeatCount = .infinity
            z.beginTime = begin
            z.timeOffset = fraction * duration
            layer.add(z, forKey: "swimZ")
        }
        loop(container, offset: 0)
        loop(tag, offset: tagOffset)
        func faces(_ layer: CALayer, _ path: String, _ value: (Facing) -> Any) {
            let a = CAKeyframeAnimation(keyPath: path)
            a.values = facings.map(value)
            a.keyTimes = times                      // one more time than values: discrete
            a.calculationMode = .discrete
            a.duration = duration
            a.repeatCount = .infinity
            a.beginTime = begin
            a.timeOffset = fraction * duration
            layer.add(a, forKey: "swimFace")
        }
        faces(front, "opacity") { $0.back ? 0 : 1 }
        faces(backView, "opacity") { $0.back ? 1 : 0 }
        faces(flip, "transform") { CATransform3DMakeScale($0.mirrored ? -1 : 1, 1, 1) }
    }

    private func point(at f: Double, points: [CGPoint], times: [Double]) -> CGPoint {
        for i in 0..<(points.count - 1) where f >= times[i] && f <= times[i + 1] {
            let u = times[i + 1] > times[i] ? (f - times[i]) / (times[i + 1] - times[i]) : 0
            return CGPoint(x: points[i].x + (points[i + 1].x - points[i].x) * u, y: points[i].y + (points[i + 1].y - points[i].y) * u)
        }
        return points[0]
    }

    /// Whether `p` hits this rider (its body around the waterline, or its name tag); returns
    /// its depth (bigger is nearer) so the nearest rider wins.
    func hit(_ p: CGPoint) -> CGFloat? {
        let c = now
        let dx = (p.x - c.x) / (size * 0.34)
        let up = p.y - c.y
        let inBody = abs(dx) < 1 && up > -size * 0.16 && up < size * 0.42
        let tagFrame = tag.presentation()?.frame ?? tag.frame
        guard inBody || tagFrame.contains(p) else { return nil }
        return -c.y
    }
}
