// Labels and groupings for the sidebar; kept apart from main.ts so that
// they can be tested without a window.
import type { Asset } from "./mygo";

export const CLASSES: Record<string, string> = {
  prop: "道具",
  building: "建筑",
  character: "角色",
  vehicle: "载具",
  animal: "动物",
  ultra: "极简小物",
  attachment: "配件",
  terrain: "地形",
  hand: "手",
};
export const classLabel = (c?: string) => (c ? (CLASSES[c] ? `${CLASSES[c]} ${c}` : c) : "未分类");
export const kitLabel = (i: Asset) => i.kit_title || i.kit || "不属于套件";

// Each grouping returns a label and a sort key; groups sort by key, then label.
type Grouping = (i: Asset) => [label: string, key: number];
const SIZES: [number, string][] = [
  [0.3, "小件（< 30 cm）"],
  [1, "中等（30 cm – 1 m）"],
  [3, "大件（1 – 3 m）"],
  [10, "很大（3 – 10 m）"],
  [Infinity, "巨型（> 10 m）"],
];
const TRIS: [number, string][] = [
  [300, "< 300 面"],
  [1000, "300 – 1k 面"],
  [3000, "1k – 3k 面"],
  [10000, "3k – 10k 面"],
  [Infinity, "> 10k 面"],
];
const bucket = (v: number, table: [number, string][]): [string, number] => {
  const i = table.findIndex(([max]) => v < max);
  return [table[i]![1], i];
};
const GROUPINGS: Record<string, Grouping> = {
  kit: (i) => [kitLabel(i), i.kit ? 0 : 1],
  class: (i) => [classLabel(i.class), i.class ? 0 : 1],
  size: (i) => (i.size_m ? bucket(Math.max(i.size_m.x, i.size_m.y, i.size_m.z), SIZES) : ["尺寸未知", 99]),
  tris: (i) => (i.triangles ? bucket(i.triangles, TRIS) : ["面数未知", 99]),
  rig: (i) => (i.rigged ? ["可动（带骨骼或活动部件）", 0] : ["静态", 1]),
};

export interface Group {
  // null when the list is not grouped.
  label: string | null;
  items: Asset[];
}

// groupItems splits list by one of the groupings above, keeping each
// group's items in list order; an unknown name returns one unlabelled group.
export function groupItems(list: Asset[], by: string): Group[] {
  const grouping = GROUPINGS[by];
  if (!grouping) return [{ label: null, items: list }];
  const groups = new Map<string, { key: number; items: Asset[] }>();
  for (const i of list) {
    const [label, key] = grouping(i);
    let g = groups.get(label);
    if (!g) groups.set(label, (g = { key, items: [] }));
    g.items.push(i);
  }
  return [...groups]
    .sort(([a, ga], [b, gb]) => ga.key - gb.key || a.localeCompare(b))
    .map(([label, g]) => ({ label, items: g.items }));
}
