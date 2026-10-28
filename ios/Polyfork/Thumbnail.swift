import ImageIO
import SwiftUI
import UIKit

/// Loads the catalogue's 900 px renders scaled down to the size of a grid
/// cell, so that scrolling thousands of them stays light. The data stays in
/// the URL cache on disk; the decoded images in memory. NSCache is safe to
/// use from any thread, hence @unchecked.
nonisolated final class ThumbnailLoader: @unchecked Sendable {
    static let shared = ThumbnailLoader()

    private let images = NSCache<NSURL, UIImage>()

    init() {
        images.countLimit = 400
    }

    func cached(_ url: URL) -> UIImage? {
        images.object(forKey: url as NSURL)
    }

    func load(_ url: URL, pixels: Int) async throws -> UIImage {
        if let image = cached(url) { return image }
        let (data, response) = try await PolyforkAPI.session.data(from: url)
        try PolyforkAPI.check(response)
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: pixels,
            kCGImageSourceCreateThumbnailWithTransform: true,
        ]
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        else { throw URLError(.cannotDecodeContentData) }
        let image = UIImage(cgImage: cg)
        images.setObject(image, forKey: url as NSURL)
        return image
    }
}

struct Thumbnail: View {
    let url: URL
    @State private var image: UIImage?
    @State private var failed = false
    @Environment(\.displayScale) private var scale

    var body: some View {
        ZStack {
            Color(.secondarySystemBackground)
            if let image = image ?? ThumbnailLoader.shared.cached(url) {
                Image(uiImage: image).resizable().scaledToFit()
            } else if failed {
                Image(systemName: "cube.transparent").foregroundStyle(.tertiary)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .task(id: url) {
            guard image == nil else { return }
            do {
                image = try await ThumbnailLoader.shared.load(url, pixels: Int(160 * scale))
            } catch {
                failed = !(error is CancellationError)
            }
        }
    }
}
