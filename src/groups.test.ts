import { expect, test } from "bun:test";
import { groupItems } from "./groups";
import type { Asset } from "./mygo";

const a = (id: string, x: Partial<Asset>): Asset => ({ id, title: id, glb: `${id}.glb`, ...x });
const list = [
  a("cup", { class: "prop", kit: "k1", kit_title: "Cafe", triangles: 120, size_m: { x: 0.1, y: 0.1, z: 0.1 } }),
  a("bear", { class: "animal", kit: "k2", kit_title: "Forest", triangles: 2542, size_m: { x: 0.95, y: 1.42, z: 2.09 }, rigged: true }),
  a("tower", { class: "building", triangles: 12000, size_m: { x: 6, y: 40, z: 6 } }),
  a("old", {}),
];
const summary = (by: string) => groupItems(list, by).map((g) => [g.label, g.items.map((i) => i.id)]);

test("no grouping keeps the list", () => {
  expect(summary("")).toEqual([[null, ["cup", "bear", "tower", "old"]]]);
});

test("kits by title, models outside a kit last", () => {
  expect(summary("kit")).toEqual([
    ["Cafe", ["cup"]],
    ["Forest", ["bear"]],
    ["不属于套件", ["tower", "old"]],
  ]);
});

test("size buckets in order, unknown last", () => {
  expect(summary("size")).toEqual([
    ["小件（< 30 cm）", ["cup"]],
    ["大件（1 – 3 m）", ["bear"]],
    ["巨型（> 10 m）", ["tower"]],
    ["尺寸未知", ["old"]],
  ]);
});

test("triangles and rig", () => {
  expect(summary("tris").map(([l]) => l)).toEqual(["< 300 面", "1k – 3k 面", "> 10k 面", "面数未知"]);
  expect(summary("rig")).toEqual([
    ["可动（带骨骼或活动部件）", ["bear"]],
    ["静态", ["cup", "tower", "old"]],
  ]);
});
