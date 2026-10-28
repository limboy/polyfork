import Foundation

/// A model in the polyfork.dev catalogue, as the API's compact listing gives it.
nonisolated struct Asset: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let `class`: String?
    let kit: String?
    let triangles: Int?
    let sizeM: Size3?
    let hasRig: Bool?

    enum CodingKeys: String, CodingKey {
        case id, title, `class`, kit, triangles
        case sizeM = "size_m"
        case hasRig = "has_rig"
    }

    var thumbnailURL: URL { URL(string: "https://polyfork.dev/files/\(id)/renders/hero.png")! }
    /// The USDZ export, which RealityKit and AR Quick Look read; it needs no key.
    var usdzURL: URL { URL(string: "https://polyfork.dev/dl/\(id).usdz")! }
    var pageURL: URL { URL(string: "https://polyfork.dev/asset/\(id)")! }
}

/// An asset's bounding box in metres.
nonisolated struct Size3: Codable, Hashable, Sendable {
    let x: Double
    let y: Double
    let z: Double

    var longest: Double { max(x, y, z) }
}

nonisolated struct Kit: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let title: String
}

/// Requests to the polyfork.dev API.
nonisolated enum PolyforkAPI {
    static let base = URL(string: "https://polyfork.dev/api")!

    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpAdditionalHeaders = ["User-Agent": "polyfork-ios/0.1"]
        config.urlCache = .shared
        return URLSession(configuration: config)
    }()

    static func get<T: Decodable>(_ path: String, _ query: [String: String] = [:]) async throws -> T {
        var url = URLComponents(url: base.appending(path: path), resolvingAgainstBaseURL: false)!
        url.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        let (data, response) = try await session.data(from: url.url!)
        try check(response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func check(_ response: URLResponse) throws {
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            throw URLError(.badServerResponse, userInfo: [NSLocalizedDescriptionKey: "polyfork.dev 返回 \(http.statusCode)"])
        }
    }

    private struct Page: Decodable {
        let total: Int
        let assets: [Asset]
    }

    private struct Kits: Decodable {
        let kits: [Kit]
    }

    static func kits() async throws -> [Kit] {
        try await (get("kits") as Kits).kits
    }

    /// Every free asset: the first page tells how many there are, and the rest
    /// are fetched a few at a time.
    static func allAssets() async throws -> [Asset] {
        let perPage = 100
        func page(_ n: Int) async throws -> Page {
            try await get("assets", ["free": "1", "fields": "compact", "per_page": "\(perPage)", "page": "\(n)"])
        }
        let first = try await page(1)
        let pages = (first.total + perPage - 1) / perPage
        guard pages > 1 else { return first.assets }
        var rest = [Int: [Asset]]()
        try await withThrowingTaskGroup(of: (Int, [Asset]).self) { group in
            var next = 2
            for _ in 0..<min(6, pages - 1) {
                let n = next
                group.addTask { (n, try await page(n).assets) }
                next += 1
            }
            while let (n, assets) = try await group.next() {
                rest[n] = assets
                if next <= pages {
                    let n = next
                    group.addTask { (n, try await page(n).assets) }
                    next += 1
                }
            }
        }
        return first.assets + (2...pages).flatMap { rest[$0] ?? [] }
    }
}
