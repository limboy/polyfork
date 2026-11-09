import { expect, test } from "bun:test";
import { groupItems, sortItems } from "./groups";
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

test("recent sorting puts new and updated models first, with unknown times last", () => {
  const models = [
    a("unknown", { title: "A model" }),
    a("old", { updated_at: 100 }),
    a("model10", { title: "Model 10", updated_at: 200 }),
    a("model2", { title: "Model 2", updated_at: 200 }),
  ];
  expect(sortItems(models, "updated").map((i) => i.id)).toEqual(["model2", "model10", "old", "unknown"]);
  expect(models.map((i) => i.id)).toEqual(["unknown", "old", "model10", "model2"]);
});

test("name sorting uses names regardless of update times", () => {
  const models = [a("new", { title: "Tree 10", updated_at: 200 }), a("old", { title: "Tree 2", updated_at: 100 })];
  expect(sortItems(models, "name").map((i) => i.id)).toEqual(["old", "new"]);
});

test("recent sorting moves the newest group and its newest model to the front", () => {
  const models = [
    a("cafe-old", { kit: "cafe", kit_title: "Cafe", updated_at: 100 }),
    a("forest-old", { kit: "forest", kit_title: "Forest", updated_at: 50 }),
    a("forest-new", { kit: "forest", kit_title: "Forest", updated_at: 300 }),
    a("cafe-new", { kit: "cafe", kit_title: "Cafe", updated_at: 200 }),
  ];
  expect(groupItems(models, "kit", "updated").map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
    ["Forest", ["forest-new", "forest-old"]],
    ["Cafe", ["cafe-new", "cafe-old"]],
  ]);
  expect(groupItems(models, "", "updated")[0]!.items.map((i) => i.id)).toEqual([
    "forest-new", "cafe-new", "cafe-old", "forest-old",
  ]);
});
