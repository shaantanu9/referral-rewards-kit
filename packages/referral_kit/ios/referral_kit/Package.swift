// swift-tools-version: 5.9
// Swift Package Manager manifest for the iOS side (UIPasteControl platform view). CocoaPods uses
// ../referral_kit.podspec with the same sources. Layout from Flutter's plugin template (docs.flutter.dev/to/spm).

import PackageDescription

let package = Package(
    name: "referral_kit",
    platforms: [
        .iOS("15.0")
    ],
    products: [
        .library(name: "referral-kit", targets: ["referral_kit"])
    ],
    dependencies: [
        .package(name: "FlutterFramework", path: "../FlutterFramework")
    ],
    targets: [
        .target(
            name: "referral_kit",
            dependencies: [
                .product(name: "FlutterFramework", package: "FlutterFramework")
            ],
            resources: [
                .process("PrivacyInfo.xcprivacy")
            ]
        )
    ]
)
