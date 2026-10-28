import SwiftUI

struct SettingsView: View {
    @Environment(Library.self) private var library
    @Environment(\.dismiss) private var dismiss
    @State private var confirmRemove = false
    @State private var confirmDownload = false

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
                    LabeledContent("已下载", value: "\(library.downloaded.count.formatted()) / \(library.assets.count.formatted()) 个")
                    LabeledContent("占用空间", value: library.downloadedBytes.formatted(.byteCount(style: .file)))
                    downloadAll
                    Button("删除全部已下载的模型", role: .destructive) { confirmRemove = true }
                        .disabled(library.downloaded.isEmpty)
                } header: {
                    Text("手机上的模型")
                } footer: {
                    Text("打开模型时会下载它的 USDZ 文件，之后离线也能看。全部下载时请让应用停留在前台，锁屏或切走后会暂停，之后再点一次会接着下载缺的。")
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
                Button("删除", role: .destructive) { library.removeAll() }
            }
            .confirmationDialog(
                "下载 \(library.missing.count.formatted()) 个模型，约 \(library.missingBytes.formatted(.byteCount(style: .file)))？",
                isPresented: $confirmDownload,
                titleVisibility: .visible
            ) {
                Button("下载") { library.downloadAll() }
            } message: {
                Text("每个模型要 1 秒左右，全部需要一段时间。已经下载过的会跳过。")
            }
        }
    }

    /// The button that starts downloading everything, or its progress.
    @ViewBuilder
    private var downloadAll: some View {
        if let bulk = library.bulk, !bulk.finished {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("正在下载全部模型")
                    Spacer()
                    Button("停止", role: .cancel) { library.cancelDownloadAll() }
                        .buttonStyle(.borderless)
                }
                ProgressView(value: Double(bulk.done), total: Double(max(bulk.total, 1)))
                Text("\(bulk.done.formatted()) / \(bulk.total.formatted())\(bulk.failed > 0 ? "，\(bulk.failed) 个失败" : "")")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            .padding(.vertical, 4)
        } else {
            Button {
                confirmDownload = true
            } label: {
                LabeledContent {
                    Text(library.missing.isEmpty ? "已全部下载" : "约 \(library.missingBytes.formatted(.byteCount(style: .file)))")
                } label: {
                    Text("下载全部模型")
                }
            }
            .disabled(library.missing.isEmpty || library.assets.isEmpty)
            if let bulk = library.bulk, bulk.finished {
                Text(bulk.stopped
                     ? "已停止：下载了 \(bulk.done - bulk.failed) 个。"
                     : "已完成\(bulk.failed > 0 ? "，\(bulk.failed) 个失败，再点一次可以重试" : "")。")
                    .font(.footnote)
                    .foregroundStyle(bulk.failed > 0 && !bulk.stopped ? .orange : .secondary)
            }
        }
    }
}
