import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Channel } from "mygo-runtime";
// Library and its types are generated from library.go by `mygo generate`.
import { Library, type Asset, type Progress } from "./mygo";

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

function render() {
  const list = visible();
  $("count").textContent = `${list.length} / ${items.length} 个模型`;
  const grid = $("grid");
  grid.replaceChildren(
    ...list.map((i) => {
      const d = document.createElement("div");
      d.className = "card" + (i.id === activeId ? " active" : "");
      d.dataset.id = i.id;
      d.innerHTML =
        (i.thumb ? `<img loading="lazy" src="${MODELS + i.thumb}" alt="">` : `<div class="ph">无缩略图</div>`) +
        `<span title="${esc(i.title)}">${esc(i.title)}</span>`;
      d.onclick = () => show(i);
      return d;
    }),
  );
}

function fillSelect(el: HTMLSelectElement, values: (string | undefined)[]) {
  const keep = el.value;
  el.length = 1;
  [...new Set(values.filter(Boolean) as string[])].sort().forEach((v) => el.append(new Option(v, v)));
  el.value = keep;
}

async function reload(selectId?: string) {
  items = await Library.list();
  fillSelect($("kit"), items.map((i) => i.kit));
  fillSelect($("cls"), items.map((i) => i.class));
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

async function openDownload() {
  $("dlError").hidden = true;
  dialog.showModal();
  if (kitsLoaded) return;
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
  const opts = {
    kit: $<HTMLSelectElement>("dlKit").value || undefined,
    query: $<HTMLInputElement>("dlQuery").value.trim() || undefined,
    class: $<HTMLInputElement>("dlClass").value.trim() || undefined,
    limit: Number($<HTMLInputElement>("dlLimit").value) || undefined,
  };
  const progress = new Channel<Progress>();
  downloading = new AbortController();
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
    if (failed.length) showDlError(`失败：${failed.join("、")}`);
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
    // Leaving the channel makes Send fail on the Go side, which stops the download.
    downloading.abort();
    $("dlStatus").textContent = "已停止";
  } else dialog.close();
};

// --- wiring ---

["search", "kit", "cls"].forEach((id) => $(id).addEventListener("input", render));
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
addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest(".menu-wrap")) $("moreMenu").hidden = true;
});
$("openDownload").onclick = openDownload;
$("openFolder").onclick = () => Library.openFolder();
addEventListener("keydown", (e) => {
  if (dialog.open || (e.target as HTMLElement).tagName === "INPUT" || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const cards = [...document.querySelectorAll<HTMLElement>(".card")];
  if (!cards.length) return;
  const idx = cards.findIndex((c) => c.dataset.id === activeId);
  const next = cards[(idx + (e.key === "ArrowRight" ? 1 : -1) + cards.length) % cards.length]!;
  next.click();
  next.scrollIntoView({ block: "nearest" });
});
addEventListener("resize", resize);
darkQuery.addEventListener("change", applyTheme);

applyTheme();
resize();
renderer.setAnimationLoop((t) => {
  timer.update(t);
  mixer?.update(timer.getDelta());
  controls.update();
  renderer.render(scene, camera);
});
reload().catch((err) => setEmpty(`读取资料库失败：${esc(String(err))}`));
