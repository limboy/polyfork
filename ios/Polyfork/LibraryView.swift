import SwiftUI

struct LibraryView: View {
    @Environment(Library.self) private var library
    @State private var query = ""
    @AppStorage("grouping") private var grouping: Grouping = .kit
    @State private var kit: String?
    @State private var assetClass: String?
    @State private var onlyDownloaded = false
    @State private var showSettings = false

    private var visible: [Asset] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return library.assets.filter { a in
            (q.isEmpty || a.title.localizedCaseInsensitiveContains(q) || a.id.contains(q.lowercased()))
                && (kit == nil || a.kit == kit)
                && (assetClass == nil || a.class == assetClass)
                && (!onlyDownloaded || library.downloaded.contains(a.id))
        }
    }

    var body: some View {
        NavigationStack {
            let groups = group(visible, by: grouping, kitTitles: library.kitTitles)
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 12, pinnedViews: .sectionHeaders) {
                    ForEach(groups) { g in
                        Section {
                            ForEach(g.assets) { a in
                                NavigationLink(value: a) {
                                    AssetCard(asset: a, downloaded: library.downloaded.contains(a.id))
                                }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    if library.downloaded.contains(a.id) {
                                        Button("删除已下载的模型", systemImage: "trash", role: .destructive) { library.remove(a) }
                                    }
                                    Link(destination: a.pageURL) { Label("Polyfork 页面", systemImage: "safari") }
                                }
                            }
                        } header: {
                            if let label = g.label {
                                SectionHeader(title: label, count: g.assets.count)
                            }
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.bottom)
            }
            .overlay { overlay(empty: groups.allSatisfy { $0.assets.isEmpty }) }
            .navigationTitle("Polyfork")
            .navigationDestination(for: Asset.self) { ModelView(asset: $0) }
            .searchable(text: $query, prompt: "搜索名称")
            .refreshable { await library.refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("设置", systemImage: "gearshape") { showSettings = true }
                }
                ToolbarItem(placement: .topBarTrailing) { filterMenu }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
        }
    }

    private var filterMenu: some View {
        Menu {
            Picker("分组", selection: $grouping) {
                ForEach(Grouping.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.menu)
            Picker("套件", selection: $kit) {
                Text("全部套件").tag(String?.none)
                ForEach(library.kitTitles.sorted { $0.value < $1.value }, id: \.key) { id, title in
                    Text(title).tag(Optional(id))
                }
            }
            .pickerStyle(.menu)
            Picker("类别", selection: $assetClass) {
                Text("全部类别").tag(String?.none)
                ForEach(classLabels.keys.sorted { classLabel($0) < classLabel($1) }, id: \.self) { c in
                    Text("\(classLabel(c)) \(c)").tag(Optional(c))
                }
            }
            .pickerStyle(.menu)
            Toggle("只看已下载", systemImage: "arrow.down.circle", isOn: $onlyDownloaded)
        } label: {
            let filtered = kit != nil || assetClass != nil || onlyDownloaded
            Label("筛选", systemImage: filtered ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }

    @ViewBuilder
    private func overlay(empty: Bool) -> some View {
        if library.assets.isEmpty {
            if let error = library.error {
                ContentUnavailableView {
                    Label("读不到 polyfork.dev", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button("重试") { Task { await library.refresh() } }
                }
            } else {
                ProgressView("正在读取目录…")
            }
        } else if empty {
            if onlyDownloaded && library.downloaded.isEmpty {
                ContentUnavailableView("还没有下载的模型", systemImage: "arrow.down.circle", description: Text("打开一个模型就会下载到手机上，之后离线也能看。"))
            } else {
                ContentUnavailableView.search(text: query)
            }
        }
    }
}

struct SectionHeader: View {
    let title: String
    let count: Int

    var body: some View {
        HStack {
            Text(title).font(.subheadline.weight(.semibold))
            Spacer()
            Text("\(count)").font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(.bar)
    }
}

struct AssetCard: View {
    let asset: Asset
    let downloaded: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Thumbnail(url: asset.thumbnailURL)
                .clipShape(.rect(cornerRadius: 10))
                .overlay(alignment: .topTrailing) {
                    if downloaded {
                        Image(systemName: "checkmark.circle.fill")
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, .tint)
                            .padding(5)
                    }
                }
            Text(asset.title)
                .font(.caption)
                .lineLimit(1)
                .foregroundStyle(.primary)
        }
        .contentShape(.rect)
    }
}
