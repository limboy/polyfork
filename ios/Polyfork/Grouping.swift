import Foundation

/// Chinese labels for the API's asset classes, as the desktop app shows them.
let classLabels: [String: String] = [
    "prop": "道具",
    "building": "建筑",
    "character": "角色",
    "vehicle": "载具",
    "animal": "动物",
    "ultra": "极简小物",
    "attachment": "配件",
    "terrain": "地形",
    "hand": "手",
]

func classLabel(_ c: String?) -> String {
    guard let c else { return "未分类" }
    return classLabels[c] ?? c
}

/// Ways to split the catalogue into sections, the same as the desktop app's.
enum Grouping: String, CaseIterable, Identifiable {
    case none, kit, `class`, size, triangles, rig

    var id: Self { self }

    var label: String {
        switch self {
        case .none: "不分组"
        case .kit: "套件"
        case .class: "类别"
        case .size: "尺寸"
        case .triangles: "面数"
        case .rig: "是否可动"
        }
    }
}

struct AssetGroup: Identifiable {
    /// nil when the list is not grouped.
    let label: String?
    let assets: [Asset]

    var id: String { label ?? "" }
}

private let sizes: [(Double, String)] = [
    (0.3, "小件（< 30 cm）"), (1, "中等（30 cm – 1 m）"), (3, "大件（1 – 3 m）"),
    (10, "很大（3 – 10 m）"), (.infinity, "巨型（> 10 m）"),
]
private let triangleBuckets: [(Double, String)] = [
    (300, "< 300 面"), (1000, "300 – 1k 面"), (3000, "1k – 3k 面"), (10000, "3k – 10k 面"), (.infinity, "> 10k 面"),
]

private func bucket(_ v: Double, _ table: [(Double, String)]) -> (String, Int) {
    let i = table.firstIndex { v < $0.0 } ?? table.count - 1
    return (table[i].1, i)
}

/// Splits assets into sections, keeping each section's assets in order; sections
/// sort by a key that puts unknowns last, then by label.
func group(_ assets: [Asset], by grouping: Grouping, kitTitles: [String: String]) -> [AssetGroup] {
    let key: (Asset) -> (String, Int)
    switch grouping {
    case .none:
        return [AssetGroup(label: nil, assets: assets)]
    case .kit:
        key = { a in a.kit.map { (kitTitles[$0] ?? $0, 0) } ?? ("不属于套件", 1) }
    case .class:
        key = { a in (classLabel(a.class), a.class == nil ? 1 : 0) }
    case .size:
        key = { a in a.sizeM.map { bucket($0.longest, sizes) } ?? ("尺寸未知", 99) }
    case .triangles:
        key = { a in a.triangles.map { bucket(Double($0), triangleBuckets) } ?? ("面数未知", 99) }
    case .rig:
        key = { a in a.hasRig == true ? ("可动（带骨骼或活动部件）", 0) : ("静态", 1) }
    }
    var order: [String: Int] = [:]
    var members: [String: [Asset]] = [:]
    for a in assets {
        let (label, k) = key(a)
        order[label] = k
        members[label, default: []].append(a)
    }
    return members.keys
        .sorted { (order[$0]!, $0) < (order[$1]!, $1) }
        .map { AssetGroup(label: $0, assets: members[$0]!) }
}
