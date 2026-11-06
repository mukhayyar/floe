// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "Floe",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "Floe", path: "Sources/Floe")
    ]
)
