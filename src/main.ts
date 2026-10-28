import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Channel } from "mygo-runtime";
// Library and its types are generated from library.go by `mygo generate`.
import { Library, type Asset, type CheckProgress, type Progress, type Updates } from "./mygo";
import { CLASSES, classLabel, groupItems, kitLabel } from "./groups";

// The Go side serves the models folder under this scheme (see main.go).
const MODELS = "models://localhost/";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// --- scene ---

const canvas = $<HTMLCanvasElement>("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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
  if (gltf.animations.length) {
    // Not played until the user picks one in the toolbar.
    mixer = new THREE.AnimationMixer(current);
  }
  frame(current);
  setShown({ item, clips: gltf.animations });
  setEmpty(null);
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
  const cards = visible();
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
  const pick = items.find((i) => i.id === selectId) ?? items.find((i) => i.id === activeId) ?? items[0]!;
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
  const done = Library.download(opts, progress);
  try {
    for await (const p of progress) {
      if (downloading.signal.aborted) break;
      $("dlBar").style.width = p.total ? `${(p.done / p.total) * 100}%` : "0";
      if (p.error) failed.push(p.title || p.id || "");
      $("dlStatus").textContent = p.id ? `${p.done} / ${p.total} · ${p.title}${p.cached ? "（已有）" : ""}` : `共 ${p.total} 个`;
    }
    const total = await done;
    $("dlStatus").textContent = `完成，资料库里现在有 ${total} 个模型` + (failed.length ? `，${failed.length} 个失败` : "");
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

function upError(msg: string | null) {
  $("upError").hidden = msg === null;
  $("upError").textContent = msg ?? "";
}

function upBar(done: number, total: number, text: string) {
  $("upProgress").hidden = false;
  $("upBar").style.width = total ? `${(done / total) * 100}%` : "0";
  $("upProgressText").textContent = text;
}

// The ids the checked boxes select.
function upSelection() {
  if (!updates) return [];
  const ids: string[] = [];
  if ($<HTMLInputElement>("upChanged").checked) ids.push(...updates.changed.map((i) => i.id));
  for (const n of updates.new) {
    if (n.inKit ? $<HTMLInputElement>("upInKit").checked : $<HTMLInputElement>("upOther").checked) ids.push(n.id);
  }
  return ids;
}

function upSync() {
  const n = upSelection().length;
  $<HTMLButtonElement>("upStart").disabled = n === 0 || !!updating;
  $("upStart").textContent = n ? `开始更新（${n} 个）` : "开始更新";
}

async function openUpdates() {
  if (updating) return upDialog.showModal();
  updates = null;
  upError(null);
  $("upChoices").hidden = true;
  $("upProgress").hidden = true;
  $("upStatus").textContent = "正在读取网站目录…";
  upSync();
  upDialog.showModal();

  updating = new AbortController();
  $("upCancel").textContent = "停止";
  const progress = new Channel<CheckProgress>();
  updating.signal.addEventListener("abort", () => progress.close());
  const done = Library.checkUpdates(progress);
  try {
    for await (const p of progress) {
      if (updating.signal.aborted) break;
      if (p.stage === "compare") {
        $("upStatus").textContent = "正在比对已下载的模型…";
        upBar(p.done, p.total, `${p.done} / ${p.total}`);
      }
    }
    updates = await done;
  } catch (err) {
    if (!updating.signal.aborted) upError(String(err));
  } finally {
    updating = null;
    $("upCancel").textContent = "关闭";
    $("upProgress").hidden = true;
  }
  if (!updates) {
    $("upStatus").textContent = "已停止";
    return;
  }

  const u = updates;
  const inKit = u.new.filter((n) => n.inKit).length;
  const other = u.new.length - inKit;
  const avg = catalog && catalog.total ? catalog.bytes / catalog.total : 0;
  const rows: [string, number, string][] = [
    ["upChanged", u.changed.length, `更新 ${u.changed.length} 个网站上有改动的模型`],
    ["upInKit", inKit, `下载已有套件里新增的 ${inKit} 个模型`],
    ["upOther", other, `下载其他 ${other.toLocaleString()} 个新模型${avg ? `（约 ${gb(avg * other)}）` : ""}`],
  ];
  for (const [id, n, text] of rows) {
    $(id).closest("label")!.hidden = n === 0;
    $(id + "Text").textContent = text;
  }
  $("upGone").hidden = u.gone === 0;
  $("upGone").textContent = `另有 ${u.gone} 个模型网站上已经没有了，本地的保留不动。`;
  const nothing = u.changed.length === 0 && u.new.length === 0;
  $("upStatus").textContent = nothing ? "所有模型都是最新的。" : `已下载的 ${items.length} 个模型比对完毕。`;
  $("upChoices").hidden = nothing && u.gone === 0;
  upSync();
}

$("updatesForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ids = upSelection();
  if (!ids.length || updating) return;
  upError(null);
  updating = new AbortController();
  upSync();
  $("upCancel").textContent = "停止";
  upBar(0, ids.length, "开始下载…");
  const failed: string[] = [];
  const progress = new Channel<Progress>();
  updating.signal.addEventListener("abort", () => progress.close());
  const done = Library.update(ids, progress);
  try {
    for await (const p of progress) {
      if (updating.signal.aborted) break;
      if (p.error) failed.push(p.title || p.id || "");
      if (p.id) upBar(p.done, p.total, `${p.done} / ${p.total} · ${p.title}`);
    }
    await done;
    $("upStatus").textContent = `更新完成${failed.length ? `，${failed.length} 个失败` : ""}。`;
    if (failed.length) upError(`失败：${failed.slice(0, 10).join("、")}${failed.length > 10 ? ` 等 ${failed.length} 个` : ""}`);
    $("upChoices").hidden = true;
    updates = null;
  } catch (err) {
    if (!updating.signal.aborted) upError(String(err));
  } finally {
    updating = null;
    $("upCancel").textContent = "关闭";
    upSync();
    // Reload the model on screen too, in case it was one of those updated.
    if (current) scene.remove(current);
    current = null;
    await reload();
  }
});

$("upCancel").onclick = () => {
  if (updating) updating.abort();
  else upDialog.close();
};
for (const id of ["upChanged", "upInKit", "upOther"]) $(id).addEventListener("change", upSync);

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
$("openUpdates").onclick = () => {
  // The size estimate in the dialog needs the catalogue's numbers.
  if (!catalog) Library.catalog().then((c) => (catalog = c)).catch(() => {});
  openUpdates();
};
window.addEventListener("keydown", (e) => {
  if (dialog.open || upDialog.open || (e.target as HTMLElement).tagName === "INPUT" || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const cards = [...document.querySelectorAll<HTMLElement>(".card")];
  if (!cards.length) return;
  const idx = cards.findIndex((c) => c.dataset.id === activeId);
  const next = cards[(idx + (e.key === "ArrowRight" ? 1 : -1) + cards.length) % cards.length]!;
  next.click();
  next.scrollIntoView({ block: "nearest" });
});
window.addEventListener("resize", resize);
darkQuery.addEventListener("change", applyTheme);

applyTheme();
resize();
renderer.setAnimationLoop((t) => {
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
