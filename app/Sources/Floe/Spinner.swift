import AppKit
import SwiftUI

/// An arc spinner rotated by Core Animation: it spins in the window server, so the app
/// does no per-frame work (it runs while a game is in front, so this matters).
struct Spinner: NSViewRepresentable {
    var color: Color
    var lineWidth: CGFloat = 2

    func makeNSView(context: Context) -> SpinnerView { SpinnerView() }

    func updateNSView(_ view: SpinnerView, context: Context) {
        view.arc.strokeColor = NSColor(color).cgColor
        view.lineWidth = lineWidth
        view.needsLayout = true
    }
}

final class SpinnerView: NSView {
    let arc = CAShapeLayer()
    var lineWidth: CGFloat = 2

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        arc.fillColor = nil
        arc.lineCap = .round
        arc.strokeStart = 0.12
        arc.strokeEnd = 0.78
        layer?.addSublayer(arc)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        arc.frame = bounds
        arc.lineWidth = lineWidth
        arc.path = CGPath(ellipseIn: bounds.insetBy(dx: lineWidth / 2 + 0.5, dy: lineWidth / 2 + 0.5), transform: nil)
        CATransaction.commit()
        spin()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        spin()
    }

    private func spin() {
        guard window != nil, arc.animation(forKey: "spin") == nil else { return }
        let a = CABasicAnimation(keyPath: "transform.rotation.z")
        a.fromValue = 0
        a.toValue = -2 * Double.pi
        a.duration = 1.0
        a.repeatCount = .infinity
        a.isRemovedOnCompletion = false
        arc.add(a, forKey: "spin")
    }
}
