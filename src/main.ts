import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Channel } from "mygo-runtime";
// Library and its types are generated from library.go by `mygo generate`.
import { Library, type Asset, type CheckProgress, type Progress, type Updates } from "./mygo";
import { CLASSES, classLabel, groupItems, kitLabel } from "./groups";
import { initSidebarResize } from "./sidebar";

// The Go side serves the models folder under this scheme (see main.go).
const MODELS = "models://localhost/";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// --- scene ---

const canvas = $<HTMLCanvasElement>("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const rendererSize = new THREE.Vector2();
renderer.setPixelRatio(devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun, sun.target, new THREE.HemisphereLight(0xffffff, 0x666655, 0.6));

const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.18 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
let gridHelper: THREE.GridHelper | null = null;
let gridSpec = { size: 1, y: 0 };

const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 2000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.2;

const loader = new GLTFLoader();
const timer = new THREE.Timer();
let current: THREE.Object3D | null = null;
let mixer: THREE.AnimationMixer | null = null;
// The animated model as it loaded, to return to between clips.
let restPose: [THREE.Object3D, THREE.Vector3, THREE.Quaternion, THREE.Vector3][] = [];
let homeView: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
let items: Asset[] = [];
let activeId: string | null = null;
// The model on screen and its animations, for the toolbars.
let shown: { item: Asset; clips: THREE.AnimationClip[] } | null = null;

function applyTheme() {
  scene.background = new THREE.Color(darkQuery.matches ? 0x1c1c1f : 0xeceae4);
  buildGrid();
}

function buildGrid() {
  if (gridHelper) scene.remove(gridHelper);
  const dark = darkQuery.matches;
  gridHelper = new THREE.GridHelper(gridSpec.size, 20, 0x999999, dark ? 0x333333 : 0xcccccc);
  gridHelper.position.y = gridSpec.y;
  gridHelper.visible = $<HTMLInputElement>("gridToggle").checked;
  scene.add(gridHelper);
}

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas.parentElement!;
  renderer.getSize(rendererSize);
  if (w <= 0 || h <= 0 || (rendererSize.x === w && rendererSize.y === h)) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function frame(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true);
  // precise: skinned meshes are measured in their current pose, not the bind pose.
  const box = new THREE.Box3().setFromObject(obj, true);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) || 1;
  const dist = (r / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * 1.6;
  const pos = center.clone().add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(dist));
  homeView = { pos, target: center };
  camera.near = r / 100;
  camera.far = r * 100;
  camera.updateProjectionMatrix();
  camera.position.copy(pos);
  controls.target.copy(center);
  controls.update();

  ground.scale.setScalar(r * 6);
  ground.position.y = box.min.y;
  const step = Math.pow(10, Math.floor(Math.log10(r)));
  gridSpec = { size: step * 20, y: box.min.y + r * 0.0005 };
  buildGrid();

  sun.position.copy(center).add(new THREE.Vector3(r, r * 2, r * 0.8));
  sun.target.position.copy(center);
  const s = sun.shadow.camera;
  s.left = s.bottom = -r * 1.5;
  s.right = s.top = r * 1.5;
  s.near = 0.01;
  s.far = r * 6;
  s.updateProjectionMatrix();
  return size;
}

function applyWire() {
  const on = $<HTMLInputElement>("wire").checked;
  current?.traverse((o) => {
    if (o instanceof THREE.Mesh) ([] as THREE.Material[]).concat(o.material).forEach((m) => ((m as THREE.MeshStandardMaterial).wireframe = on));
  });
}

function setEmpty(html: string | null) {
  $("empty").hidden = html === null;
  if (html !== null) $("empty").innerHTML = html;
}

// --- showing a model ---

async function show(item: Asset) {
  activeId = item.id;
  document.querySelectorAll<HTMLElement>(".card").forEach((c) => c.classList.toggle("active", c.dataset.id === item.id));
  setEmpty("加载中…");
  let gltf: GLTF;
  try {
    gltf = await loader.loadAsync(MODELS + item.glb);
  } catch (err) {
    if (activeId === item.id) setEmpty(`加载失败：${esc(String(err))}`);
    return;
  }
  if (activeId !== item.id) return;
  if (current) scene.remove(current);
  mixer = null;
  current = gltf.scene;
  current.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
  scene.add(current);
  applyWire();
  const shared = await sharedClipsFor(current);
  if (activeId !== item.id) return;
  // A model's own clip wins over a shared one of the same name.
  const own = new Set(gltf.animations.map((a) => a.name));
  const clips = [...gltf.animations, ...shared.filter((c) => !own.has(c.name))];
  if (clips.length) {
    // Not played until the user picks one in the toolbar.
    mixer = new THREE.AnimationMixer(current);
    restPose = [];
    current.traverse((o) => restPose.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  }
  frame(current);
  setShown({ item, clips });
  setEmpty(null);
}

// --- shared character clips ---

// The site's characters carry a Mixamo-named skeleton but no clips; it plays
// one shared set of baked Mixamo clips on all of them (anim/clips.json). Each
// clip holds a local quaternion per bone and the hips' travel, at 30 fps.
type RawClip = { times: number[]; tracks: Record<string, number[]>; hips: number[] };
let rawClips: Promise<Record<string, RawClip> | null> | null = null;
const loadRawClips = (): Promise<Record<string, RawClip> | null> =>
  (rawClips ??= Library.clips()
    .then((name) => fetch(MODELS + name))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => {
      rawClips = null; // try again with the next character
      return null;
    }));

// The basics first, as on the site; the rest alphabetically.
const CLIP_ORDER = ["Idle", "Walk", "Run", "Agree", "Head shake"];
const clipRank = (n: string) => (CLIP_ORDER.includes(n) ? CLIP_ORDER.indexOf(n) : CLIP_ORDER.length);

// A bone named base, or base_N as GLTFLoader names a repeat.
function findBone(root: THREE.Object3D, base: string) {
  let found: THREE.Bone | null = null;
  root.traverse((o) => {
    if (!found && o instanceof THREE.Bone && (o.name === base || o.name.startsWith(base + "_"))) found = o;
  });
  return found as THREE.Bone | null;
}

// Retargets the shared clips onto every Mixamo skeleton in root, so a scene
// of several characters moves together. Empty when root has none.
async function sharedClipsFor(root: THREE.Object3D): Promise<THREE.AnimationClip[]> {
  const hipsBones: THREE.Bone[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Bone && /^Hips(_\d+)?$/.test(o.name)) hipsBones.push(o);
  });
  const rigs = hipsBones.filter((h) => ["LeftUpLeg", "RightUpLeg", "LeftArm", "RightArm"].every((n) => findBone(h, n)));
  if (!rigs.length) return [];
  const raw = await loadRawClips();
  if (!raw) return [];
  return Object.keys(raw)
    .sort((a, b) => clipRank(a) - clipRank(b) || a.localeCompare(b))
    .map((name) => {
      const clip = raw[name]!;
      const tracks: THREE.KeyframeTrack[] = [];
      for (const hips of rigs) {
        for (const [base, values] of Object.entries(clip.tracks)) {
          const bone = base === "Hips" ? hips : findBone(hips, base);
          // By uuid: names repeat when a scene holds several characters.
          if (bone && values.length) tracks.push(new THREE.QuaternionKeyframeTrack(bone.uuid + ".quaternion", clip.times, values));
        }
        // The hips' travel is baked for a 0.95 m hip height, as offsets from rest.
        const rest = hips.position;
        const k = (rest.y || 0.95) / 0.95;
        const pos = clip.hips.map((v, i) => [rest.x, rest.y, rest.z][i % 3]! + v * k);
        tracks.push(new THREE.VectorKeyframeTrack(hips.uuid + ".position", clip.times, pos));
      }
      return new THREE.AnimationClip(name, -1, tracks);
    });
}

function setShown(s: typeof shown) {
  shown = s;
  $("info").hidden = !s;
  $("modelActions").hidden = !s;
  $("moreMenu").hidden = true;
  $("animWrap").hidden = !s?.clips.length;
  if (!s) return;
  $("info").innerHTML = `<h2>${esc(s.item.title)}</h2>`;
  $("anim").innerHTML =
    `<option value="-1">不播放</option>` +
    s.clips.map((a, i) => `<option value="${i}">${esc(a.name || `动画 ${i + 1}`)}</option>`).join("");
}

async function remove(item: Asset) {
  if (!confirm(`删除「${item.title}」？`)) return;
  const cards = displayed();
  const next = cards[cards.findIndex((i) => i.id === item.id) + 1] ?? cards.at(-2);
  await Library.remove(item.id);
  if (current) scene.remove(current);
  current = null;
  setShown(null);
  await reload(next?.id);
}

// --- the list ---

function visible() {
  const q = $<HTMLInputElement>("search").value.trim().toLowerCase();
  const kit = $<HTMLSelectElement>("kit").value;
  const cls = $<HTMLSelectElement>("cls").value;
  return items.filter(
    (i) => (!q || i.title.toLowerCase().includes(q) || i.id.includes(q)) && (!kit || i.kit === kit) && (!cls || i.class === cls),
  );
}

function card(i: Asset) {
  const d = document.createElement("div");
  d.className = "card" + (i.id === activeId ? " active" : "");
  d.dataset.id = i.id;
  d.innerHTML =
    (i.thumb ? `<img loading="lazy" src="${MODELS + i.thumb}" alt="">` : `<div class="ph">无缩略图</div>`) +
    `<span title="${esc(i.title)}">${esc(i.title)}</span>`;
  d.onclick = () => show(i);
  return d;
}

// displayed returns the visible models in the order the sidebar shows them.
function displayed() {
  return groupItems(visible(), $<HTMLSelectElement>("group").value).flatMap((g) => g.items);
}

function render() {
  const list = visible();
  $("count").textContent = `${list.length} / ${items.length} 个模型`;
  const groups = groupItems(list, $<HTMLSelectElement>("group").value);
  $("grid").replaceChildren(
    ...groups.flatMap(({ label, items }) => {
      if (label === null) return items.map(card);
      const h = document.createElement("div");
      h.className = "group";
      h.innerHTML = `${esc(label)}<span>${items.length}</span>`;
      return [h, ...items.map(card)];
    }),
  );
}

// fillSelect keeps the first option and the current choice, and lists the
// distinct values after it, sorted by label.
function fillSelect(el: HTMLSelectElement, options: [value: string, label: string][]) {
  const keep = el.value;
  el.length = 1;
  const seen = new Map(options.filter(([v]) => v));
  [...seen].sort((a, b) => a[1].localeCompare(b[1])).forEach(([v, l]) => el.append(new Option(l, v)));
  el.value = keep;
}

async function reload(selectId?: string) {
  items = await Library.list();
  fillSelect($("kit"), items.map((i) => [i.kit ?? "", kitLabel(i)]));
  fillSelect($("cls"), items.map((i) => [i.class ?? "", classLabel(i.class)]));
  render();
  if (!items.length) {
    activeId = null;
    setEmpty(`还没有模型<br><button class="primary" id="emptyDownload">从 polyfork.dev 下载</button>`);
    $("emptyDownload").onclick = openDownload;
    return;
  }
  const pick =
    items.find((i) => i.id === selectId) ?? items.find((i) => i.id === activeId) ?? displayed()[0] ?? items[0]!;
  if (pick.id !== activeId || !current) show(pick);
}

// --- downloading ---

const dialog = $<HTMLDialogElement>("download");
let kitsLoaded = false;
let downloading: AbortController | null = null;

let catalog: { total: number; bytes: number } | null = null;
const gb = (bytes: number) => (bytes >= 1 << 30 ? `${(bytes / (1 << 30)).toFixed(1)} GB` : `${Math.round(bytes / (1 << 20))} MB`);

function syncAll() {
  const all = $<HTMLInputElement>("dlAll").checked;
  for (const id of ["dlKit", "dlQuery", "dlClass", "dlLimit"]) $<HTMLInputElement>(id).disabled = all;
}

async function openDownload() {
  $("dlError").hidden = true;
  dialog.showModal();
  Library.catalog()
    .then((c) => {
      catalog = c;
      $("dlAllInfo").textContent = `（约 ${c.total.toLocaleString()} 个 · 约 ${gb(c.bytes)}）`;
    })
    .catch(() => {});
  if (kitsLoaded) return;
  fillSelect($("dlClass"), Object.keys(CLASSES).map((c) => [c, classLabel(c)]));
  try {
    const kits = await Library.kits();
    const sel = $<HTMLSelectElement>("dlKit");
    for (const k of kits) sel.append(new Option(`${k.title}（${k.parts} 个${k.status === "published" ? "" : "，更新中"}）`, k.id));
    kitsLoaded = true;
  } catch (err) {
    showDlError(`读取套件列表失败：${err}`);
  }
}

function showDlError(msg: string) {
  $("dlError").hidden = false;
  $("dlError").textContent = msg;
}

$("downloadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (downloading) return;
  $("dlError").hidden = true;
  const all = $<HTMLInputElement>("dlAll").checked;
  if (all && !confirm(`将下载全部${catalog ? ` ${catalog.total.toLocaleString()} 个模型，约 ${gb(catalog.bytes)}` : "模型"}。已有的会跳过，中途可以停止。继续？`)) return;
  const opts = {
    all: all || undefined,
    kit: $<HTMLSelectElement>("dlKit").value || undefined,
    query: $<HTMLInputElement>("dlQuery").value.trim() || undefined,
    class: $<HTMLSelectElement>("dlClass").value || undefined,
    limit: Number($<HTMLInputElement>("dlLimit").value) || undefined,
  };
  const progress = new Channel<Progress>();
  downloading = new AbortController();
  // Closing the channel cancels the Go side's context at once.
  downloading.signal.addEventListener("abort", () => progress.close());
  $<HTMLButtonElement>("dlStart").disabled = true;
  $("dlCancel").textContent = "停止";
  $("dlProgress").hidden = false;
  $("dlBar").style.width = "0";
  $("dlStatus").textContent = "正在查询…";
  const failed: string[] = [];
  let skipped = 0;
  const done = Library.download(opts, progress);
  try {
    for await (const p of progress) {
      if (downloading.signal.aborted) break;
      $("dlBar").style.width = p.total ? `${(p.done / p.total) * 100}%` : "0";
      if (p.error) failed.push(p.title || p.id || "");
      if (p.skipped) skipped++;
      $("dlStatus").textContent = p.id ? `${p.done} / ${p.total} · ${p.title}${p.cached ? "（已有）" : ""}` : `共 ${p.total} 个`;
    }
    const total = await done;
    $("dlStatus").textContent = `完成，资料库里现在有 ${total} 个模型` + (failed.length ? `，${failed.length} 个失败` : "") + (skipped ? `，${skipped} 个暂不可用，已跳过` : "");
    if (failed.length) showDlError(`失败：${failed.slice(0, 10).join("、")}${failed.length > 10 ? ` 等 ${failed.length} 个` : ""}`);
  } catch (err) {
    if (!downloading.signal.aborted) showDlError(String(err));
  } finally {
    downloading = null;
    $<HTMLButtonElement>("dlStart").disabled = false;
    $("dlCancel").textContent = "关闭";
    await reload();
  }
});

$("dlCancel").onclick = () => {
  if (downloading) {
    downloading.abort();
    $("dlStatus").textContent = "已停止";
  } else dialog.close();
};

// --- updates ---

const upDialog = $<HTMLDialogElement>("updates");
let updates: Updates | null = null;
let updating: AbortController | null = null;
let compared = false;
// Reject results from a dialog the user has canceled, including catalogue reads.
let checkRun = 0;

function upError(msg: string | null) {
  $("upError").hidden = msg === null;
  $("upError").textContent = msg ?? "";
}

function upBar(done: number, total: number, text: string) {
  $("upProgress").hidden = false;
  $("upBar").style.width = total ? `${(done / total) * 100}%` : "0";
  $("upProgressText").textContent = text;
}

function upDetails(text: string) {
  $("upDetails").hidden = !text;
  $("upDetails").textContent = text;
}

// Every new model and every changed download is included, regardless of kit.
function upSelection() {
  return updates ? [...new Set([...updates.changed, ...updates.new].map((i) => i.id))] : [];
}

function upSync() {
  const canUpdate = !!updates && (upSelection().length > 0 || (!compared && items.length > 0));
  $<HTMLButtonElement>("upStart").disabled = !canUpdate || !!updating;
}

async function openUpdates() {
  if (!upDialog.open) upDialog.showModal();
  if (updating && !updating.signal.aborted) return;
  const run = ++checkRun;
  updates = null;
  compared = false;
  upError(null);
  upDetails("");
  $("upProgress").hidden = true;
  $("upStatus").textContent = "正在读取网站目录…";
  upSync();
  try {
    const u = await Library.checkUpdates();
    if (run !== checkRun) return;
    updates = u;
    $("upStatus").textContent = u.new.length ? `发现 ${u.new.length.toLocaleString()} 个新模型。` : "没有新模型。";
    upDetails(items.length ? "更新全部新模型，并自动检查和更新已有模型。" : u.new.length ? "下载全部新模型。" : "");
    upSync();
  } catch (err) {
    if (run === checkRun) {
      $("upStatus").textContent = "检查更新失败，请稍后重新检查。";
      upError(err instanceof Error ? err.message : String(err));
    }
  }
}

$("updatesForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!updates || updating) return;
  const u = updates;
  const run = checkRun;
  const controller = new AbortController();
  updating = controller;
  upError(null);
  upDetails("");
  upSync();
  let downloaded = false;

  // Each channel serves one call. Attach cancellation only for its lifetime,
  // and await the call directly so an early rejection is always handled.
  async function stream<T, P>(call: (progress: Channel<P>) => Promise<T>, receive: (p: P) => void) {
    controller.signal.throwIfAborted();
    const progress = new Channel<P>((p) => {
      if (!controller.signal.aborted && run === checkRun) receive(p);
    });
    const cancel = () => progress.close();
    controller.signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await call(progress);
      controller.signal.throwIfAborted();
      return result;
    } finally {
      controller.signal.removeEventListener("abort", cancel);
    }
  }

  try {
    if (!compared) {
      $("upStatus").textContent = "正在检查已有模型…";
      upBar(0, items.length, "正在比对已下载的模型…");
      u.changed = await stream(Library.checkChanged, (p: CheckProgress) => {
        upBar(p.done, p.total, `正在比对… ${p.done.toLocaleString()} / ${p.total.toLocaleString()}`);
      });
      compared = true;
    }
    const ids = upSelection();
    if (!ids.length) {
      $("upStatus").textContent = "所有模型都是最新的。";
      return;
    }
    $("upStatus").textContent = `正在更新 ${ids.length.toLocaleString()} 个模型…`;
    upBar(0, ids.length, "开始下载…");
    downloaded = true;
    const failed = new Map<string, string>();
    const skipped = new Set<string>();
    await stream((progress: Channel<Progress>) => Library.update(ids, progress), (p) => {
      if (p.id && p.skipped) skipped.add(p.id);
      else if (p.id && p.error) failed.set(p.id, `${p.title || p.id}：${p.error}`);
      if (p.id) upBar(p.done, p.total, `${p.done} / ${p.total} · ${p.title || p.id}`);
    });
    const count = ids.length - failed.size - skipped.size;
    $("upStatus").textContent = failed.size
      ? `已更新 ${count.toLocaleString()} 个模型，${failed.size} 个失败。`
      : `更新完成，已更新 ${count.toLocaleString()} 个模型。`;
    if (skipped.size) upDetails(`${skipped.size} 个模型的源文件暂不可用，已跳过。`);
    if (failed.size) upError(`以下模型更新失败，可点击“更新”重试：\n${[...failed.values()].slice(0, 10).join("\n")}`);
    // Keep only genuine failures for a retry. Unavailable source files are
    // checked again the next time the user checks the site's catalogue.
    u.changed = u.changed.filter((i) => failed.has(i.id));
    u.new = u.new.filter((i) => failed.has(i.id));
  } catch (err) {
    if (!controller.signal.aborted && run === checkRun) {
      $("upStatus").textContent = "更新未完成，可点击“更新”重试。";
      upError(err instanceof Error ? err.message : String(err));
    }
  } finally {
    updating = null;
    if (run === checkRun) $("upProgress").hidden = true;
    upSync();
    // Reload the model on screen too, in case it was one of those updated.
    if (downloaded) {
      if (current) scene.remove(current);
      current = null;
      try {
        await reload();
      } catch (err) {
        if (run === checkRun) upError(`刷新资料库失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
});

function cancelUpdates() {
  ++checkRun;
  updating?.abort();
  upDialog.close();
}
$("upCancel").onclick = cancelUpdates;
upDialog.addEventListener("cancel", (e) => {
  e.preventDefault();
  cancelUpdates();
});

// --- wiring ---

["search", "kit", "cls"].forEach((id) => $(id).addEventListener("input", render));
$("group").addEventListener("input", () => {
  try {
    localStorage.setItem("group", $<HTMLSelectElement>("group").value);
  } catch {}
  render();
});
try {
  $<HTMLSelectElement>("group").value = localStorage.getItem("group") ?? "kit";
} catch {}
$("dlAll").onchange = syncAll;
$<HTMLInputElement>("rotate").onchange = (e) => (controls.autoRotate = (e.target as HTMLInputElement).checked);
$("wire").onchange = applyWire;
$<HTMLInputElement>("gridToggle").onchange = (e) => gridHelper && (gridHelper.visible = (e.target as HTMLInputElement).checked);
$("reset").onclick = () => {
  if (!homeView) return;
  camera.position.copy(homeView.pos);
  controls.target.copy(homeView.target);
};
$("anim").onchange = (e) => {
  if (!mixer || !shown) return;
  mixer.stopAllAction();
  for (const [o, p, q, s] of restPose) {
    o.position.copy(p);
    o.quaternion.copy(q);
    o.scale.copy(s);
  }
  const clip = shown.clips[Number((e.target as HTMLSelectElement).value)];
  if (clip) mixer.clipAction(clip).play();
};
$("openPage").onclick = () => shown && Library.openPage(shown.item.id);
$("more").onclick = (e) => {
  e.stopPropagation();
  $("moreMenu").hidden = !$("moreMenu").hidden;
};
$("remove").onclick = () => {
  $("moreMenu").hidden = true;
  if (shown) remove(shown.item);
};
window.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest(".menu-wrap")) $("moreMenu").hidden = true;
});
$("openDownload").onclick = openDownload;
$("openFolder").onclick = () => Library.openFolder();
$("openUpdates").onclick = openUpdates;
window.addEventListener("keydown", (e) => {
  if (dialog.open || upDialog.open || (e.target as HTMLElement).tagName === "INPUT" || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const cards = [...document.querySelectorAll<HTMLElement>(".card")];
  if (!cards.length) return;
  const idx = cards.findIndex((c) => c.dataset.id === activeId);
  const next = cards[(idx + (e.key === "ArrowRight" ? 1 : -1) + cards.length) % cards.length]!;
  next.click();
  next.scrollIntoView({ block: "nearest" });
});
initSidebarResize();
darkQuery.addEventListener("change", applyTheme);

applyTheme();
renderer.setAnimationLoop((t) => {
  // Resizing clears the drawing buffer, so do it immediately before drawing.
  resize();
  timer.update(t);
  mixer?.update(timer.getDelta());
  controls.update();
  renderer.render(scene, camera);
});
reload()
  .then(async () => {
    // Models downloaded by an older version lack kit names and the rig flag.
    if (items.some((i) => (i.meta ?? 0) < 1) && (await Library.refresh()) > 0) await reload();
  })
  .catch((err) => setEmpty(`读取资料库失败：${esc(String(err))}`));
