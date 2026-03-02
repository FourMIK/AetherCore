// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "SecureEnclaveKeyManager",
    platforms: [
        .iOS(.v13)
    ],
    products: [
        .library(
            name: "SecureEnclaveKeyManager",
            targets: ["SecureEnclaveKeyManager"]),
    ],
    targets: [
        .target(
            name: "SecureEnclaveKeyManager",
            dependencies: []),
        .testTarget(
            name: "SecureEnclaveKeyManagerTests",
            dependencies: ["SecureEnclaveKeyManager"]),
    ]
)
