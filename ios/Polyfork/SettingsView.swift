import SwiftUI

struct SettingsView: View {
    @Environment(Library.self) private var library
    @Environment(\.dismiss) private var dismiss
    @State private var confirmRemove = false
    @State private var bytes: Int64 = 0

    var body: some View {
        NavigationStack {
            Form {
                Section("目录") {
                    LabeledContent("模型", value: library.assets.count.formatted())
                    LabeledContent("套件", value: library.kitTitles.count.formatted())
                    if let updated = library.updated {
                        LabeledContent("更新于", value: updated.formatted(date: .abbreviated, time: .shortened))
                    }
                    Button {
                        Task { await library.refresh() }
                    } label: {
                        HStack {
                            Text("刷新目录")
                            if library.isRefreshing {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    .disabled(library.isRefreshing)
                    if let error = library.error {
                        Text(error).font(.footnote).foregroundStyle(.red)
                    }
                }
                Section {
                    LabeledContent("已下载", value: "\(library.downloaded.count) 个")
                    LabeledContent("占用空间", value: bytes.formatted(.byteCount(style: .file)))
                    Button("删除全部已下载的模型", role: .destructive) { confirmRemove = true }
                        .disabled(library.downloaded.isEmpty)
                } header: {
                    Text("手机上的模型")
                } footer: {
                    Text("打开模型时会下载它的 USDZ 文件，之后离线也能看。")
                }
                Section {
                    Link("polyfork.dev", destination: URL(string: "https://polyfork.dev")!)
                } footer: {
                    Text("模型来自 polyfork.dev，免费的低多边形模型可以商用、不需要署名，但不能转售或再分发模型本身。")
                }
            }
            .navigationTitle("设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
            .confirmationDialog("删除手机上全部 \(library.downloaded.count) 个模型？", isPresented: $confirmRemove, titleVisibility: .visible) {
                Button("删除", role: .destructive) {
                    library.removeAll()
                    bytes = 0
                }
            }
            .task(id: library.downloaded.count) { bytes = library.downloadedBytes() }
        }
    }
}
