import ARKit
import QuickLook
import RealityKit
import SwiftUI

struct ModelView: View {
    let asset: Asset
    @Environment(Library.self) private var library
    @State private var url: URL?
    @State private var error: String?
    @State private var arURL: URL?

    var body: some View {
        ZStack {
            Color(.secondarySystemBackground).ignoresSafeArea()
            if let url {
                ModelScene(url: url)
                    .ignoresSafeArea(edges: .bottom)
            } else if let error {
                ContentUnavailableView {
                    Label("下载失败", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("重试") { Task { await load() } }
                }
            } else {
                ProgressView("正在下载模型…")
            }
        }
        .safeAreaInset(edge: .bottom) { details }
        .navigationTitle(asset.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                // AR Quick Look needs world tracking, which the simulator lacks.
                if ARWorldTrackingConfiguration.isSupported {
                    Button("AR", systemImage: "arkit") { arURL = url }
                        .disabled(url == nil)
                }
                Menu("更多", systemImage: "ellipsis.circle") {
                    if let url {
                        ShareLink(item: url) { Label("分享 USDZ", systemImage: "square.and.arrow.up") }
                    }
                    Link(destination: asset.pageURL) { Label("Polyfork 页面", systemImage: "safari") }
                    if library.downloaded.contains(asset.id) {
                        Button("从手机删除", systemImage: "trash", role: .destructive) {
                            library.remove(asset)
                        }
                    }
                }
            }
        }
        // AR Quick Look: shows the model in the room, at its real size.
        .quickLookPreview($arURL)
        .task { await load() }
    }

    private func load() async {
        error = nil
        do {
            url = try await library.model(asset)
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    private var details: some View {
        let parts = [
            classLabel(asset.class),
            library.kitTitle(asset),
            asset.sizeM.map { String(format: "%.2f × %.2f × %.2f m", $0.x, $0.y, $0.z) },
            asset.triangles.map { "\($0.formatted()) 面" },
        ].compactMap { $0 }
        return Text(parts.joined(separator: " · "))
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(2)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .glassEffect()
            .padding(.bottom, 8)
    }
}

/// A RealityKit view of a USDZ that the user turns with a finger and zooms by
/// pinching. The model is scaled to fit a 0.7 m cube at the origin, which the
/// orbit camera circles from about a metre away.
///
/// There is no floor: RealityKit on iOS has no material that shows only the
/// shadows it receives, and a lit floor shows its horizon against the
/// background.
struct ModelScene: View {
    let url: URL

    var body: some View {
        RealityView { content in
            content.camera = .virtual
            guard let model = try? await Entity(contentsOf: url) else { return }
            let bounds = model.visualBounds(relativeTo: nil)
            let longest = max(bounds.extents.x, bounds.extents.y, bounds.extents.z)
            let scale = longest > 0 ? 0.7 / longest : 1
            model.scale = SIMD3(repeating: scale)
            model.position = -bounds.center * scale

            let root = Entity()
            root.addChild(model)

            let sun = DirectionalLight()
            sun.light.intensity = 2500
            sun.look(at: .zero, from: [1.5, 3, 2], relativeTo: nil)
            root.addChild(sun)

            content.add(root)
        }
        .realityViewCameraControls(.orbit)
    }
}
