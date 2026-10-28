import SwiftUI

@main
struct PolyforkApp: App {
    @State private var library = Library()

    init() {
        // Thumbnails and API responses; the models themselves are kept apart, in Library.
        URLCache.shared = URLCache(memoryCapacity: 32 << 20, diskCapacity: 600 << 20)
    }

    var body: some Scene {
        WindowGroup {
            LibraryView()
                .environment(library)
                .task { await library.load() }
        }
    }
}
