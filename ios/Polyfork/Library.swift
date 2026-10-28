import Foundation
import Observation
import UIKit

/// The catalogue, cached on disk so that the app opens without the network,
/// and the models downloaded to the phone.
@Observable
final class Library {
    private(set) var assets: [Asset] = []
    private(set) var kitTitles: [String: String] = [:]
    private(set) var downloaded: Set<String> = []
    private(set) var isRefreshing = false
    private(set) var error: String?
    private(set) var updated: Date?

    private let fm = FileManager.default
    private let cacheURL: URL
    private let modelsURL: URL

    init() {
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        cacheURL = support.appending(path: "catalog.json")
        modelsURL = support.appending(path: "Models", directoryHint: .isDirectory)
        try? fm.createDirectory(at: modelsURL, withIntermediateDirectories: true)
        // The models folder holds what the phone has; keep it out of iCloud backups.
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var url = modelsURL
        try? url.setResourceValues(values)
    }

    private nonisolated struct Cache: Codable {
        let assets: [Asset]
        let kits: [Kit]
        let updated: Date
    }

    /// Shows the cached catalogue, then fetches a fresh one.
    func load() async {
        if let data = try? Data(contentsOf: cacheURL), let cache = try? JSONDecoder().decode(Cache.self, from: data) {
            apply(cache)
        }
        scanDownloads()
        await refresh()
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            async let kits = PolyforkAPI.kits()
            async let assets = PolyforkAPI.allAssets()
            let cache = try await Cache(assets: assets, kits: kits, updated: .now)
            apply(cache)
            error = nil
            if let data = try? JSONEncoder().encode(cache) {
                try? data.write(to: cacheURL, options: .atomic)
            }
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func apply(_ cache: Cache) {
        assets = cache.assets.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        kitTitles = Dictionary(cache.kits.map { ($0.id, $0.title) }, uniquingKeysWith: { a, _ in a })
        updated = cache.updated
    }

    // MARK: Downloads

    /// Bytes the downloaded models take, kept up to date as they come and go.
    private(set) var downloadedBytes: Int64 = 0

    func localURL(_ asset: Asset) -> URL { modelsURL.appending(path: "\(asset.id).usdz") }

    private func size(_ url: URL) -> Int64 {
        let attrs = try? fm.attributesOfItem(atPath: url.path(percentEncoded: false))
        return (attrs?[.size] as? Int64) ?? 0
    }

    private func scanDownloads() {
        let names = (try? fm.contentsOfDirectory(atPath: modelsURL.path(percentEncoded: false))) ?? []
        downloaded = Set(names.filter { $0.hasSuffix(".usdz") }.map { String($0.dropLast(5)) })
        downloadedBytes = downloaded.reduce(0) { $0 + size(modelsURL.appending(path: "\($1).usdz")) }
    }

    /// Returns the model's USDZ on the phone, downloading it the first time.
    func model(_ asset: Asset) async throws -> URL {
        let dest = localURL(asset)
        if fm.fileExists(atPath: dest.path(percentEncoded: false)) { return dest }
        let (tmp, response) = try await PolyforkAPI.session.download(from: asset.usdzURL)
        try PolyforkAPI.check(response)
        try? fm.removeItem(at: dest)
        try fm.moveItem(at: tmp, to: dest)
        if downloaded.insert(asset.id).inserted {
            downloadedBytes += size(dest)
        }
        return dest
    }

    func remove(_ asset: Asset) {
        let url = localURL(asset)
        if downloaded.remove(asset.id) != nil {
            downloadedBytes -= size(url)
        }
        try? fm.removeItem(at: url)
    }

    func removeAll() {
        cancelDownloadAll()
        for id in downloaded {
            try? fm.removeItem(at: modelsURL.appending(path: "\(id).usdz"))
        }
        downloaded = []
        downloadedBytes = 0
    }

    // MARK: Downloading everything

    struct BulkDownload {
        var done = 0
        var total: Int
        var failed = 0
        var finished = false
        var stopped = false
    }

    /// The current or last download of every model, for the settings page.
    private(set) var bulk: BulkDownload?
    private var bulkTask: Task<Void, Never>?

    var missing: [Asset] { assets.filter { !downloaded.contains($0.id) } }

    /// About how many bytes the missing models take, from the average of the
    /// downloaded ones; 0.3 MB each before there are any.
    var missingBytes: Int64 {
        let average = downloaded.isEmpty ? 300_000 : downloadedBytes / Int64(downloaded.count)
        return average * Int64(missing.count)
    }

    /// Downloads every model the phone lacks, four at a time. Polyfork builds
    /// a USDZ the first time anyone asks for it, so each takes about a second.
    func downloadAll() {
        guard bulkTask == nil else { return }
        let todo = missing
        guard !todo.isEmpty else { return }
        bulk = BulkDownload(total: todo.count)
        // The download stops when the phone locks or the app leaves the screen.
        UIApplication.shared.isIdleTimerDisabled = true
        bulkTask = Task {
            await withTaskGroup(of: Bool.self) { group in
                var next = todo.makeIterator()
                func start() {
                    guard let asset = next.next() else { return }
                    group.addTask { await self.fetch(asset) }
                }
                for _ in 0..<4 { start() }
                while let ok = await group.next() {
                    bulk?.done += 1
                    if !ok { bulk?.failed += 1 }
                    if Task.isCancelled {
                        group.cancelAll()
                    } else {
                        start()
                    }
                }
            }
            bulk?.finished = true
            bulk?.stopped = Task.isCancelled
            bulkTask = nil
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    func cancelDownloadAll() {
        bulkTask?.cancel()
    }

    private func fetch(_ asset: Asset) async -> Bool {
        do {
            _ = try await model(asset)
            return true
        } catch {
            return false
        }
    }

    func kitTitle(_ asset: Asset) -> String? {
        asset.kit.map { kitTitles[$0] ?? $0 }
    }
}
