import { isMyGo } from "mygo-runtime";
import { AppUpdates, events, type AppRelease } from "./mygo";
import { renderReleaseNotes } from "./release-notes";

export function initAppUpdates() {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const dialog = $<HTMLDialogElement>("appUpdates");
  const action = $<HTMLButtonElement>("appUpdateAction");
  let run = 0;
  let busy = false;
  let version = "";
  let release: AppRelease | null = null;
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);

  function showError(text = "") {
    $("appUpdateError").hidden = !text;
    $("appUpdateError").textContent = text;
  }

  function actionLabel() {
    if (!release) return "重试";
    if (!release.currentVersion || (release.available && !release.downloadURL)) return "查看发布页面";
    return release.available ? "下载更新" : "重新检查";
  }

  async function check() {
    const request = ++run;
    busy = true;
    release = null;
    action.disabled = true;
    action.textContent = "检查中…";
    showError();
    $("appUpdateChanges").hidden = true;
    $("appUpdateHint").hidden = true;
    $("appUpdateStatus").textContent = "正在检查新版本…";
    $("appUpdateVersion").textContent = version ? `当前版本 ${version}` : "";
    try {
      const result = await AppUpdates.check();
      if (request !== run) return;
      release = result;
      version = result.currentVersion;
      $("appUpdateStatus").textContent = !version ? `最新正式版本 ${result.version}`
        : result.available ? `Polyfork ${result.version} 已发布。` : "已是最新版本。";
      $("appUpdateVersion").textContent = version ? `当前版本 ${version}` : "当前为开发版本";
      $("appUpdateChangesTitle").textContent = `${result.version} 更新内容`;
      $("appUpdateNotes").innerHTML = renderReleaseNotes(result.notes || "此版本暂无更新说明。");
      $("appUpdateNotes").scrollTop = 0;
      $("appUpdateChanges").hidden = false;
      $("appUpdateHint").hidden = !result.available || !result.downloadURL;
    } catch (error) {
      if (request !== run) return;
      $("appUpdateStatus").textContent = "暂时无法检查更新。";
      showError(message(error));
    } finally {
      if (request === run) {
        busy = false;
        action.disabled = false;
        action.textContent = actionLabel();
      }
    }
  }

  function open() {
    if (dialog.open) return;
    dialog.showModal();
    void check();
  }

  function close() {
    ++run;
    busy = false;
    release = null;
    dialog.close();
  }

  $("appUpdateCancel").onclick = close;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  $("appUpdateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!release || (!release.available && release.currentVersion)) return check();
    const request = run;
    const download = release.available && release.downloadURL;
    busy = true;
    action.disabled = true;
    showError();
    try {
      await AppUpdates.openURL(download || release.releaseURL);
      if (request === run) $("appUpdateStatus").textContent = download
        ? "下载链接已在浏览器中打开。" : "发布页面已在浏览器中打开。";
    } catch (error) {
      if (request === run) showError(message(error));
    } finally {
      if (request === run) {
        busy = false;
        action.disabled = false;
      }
    }
  });
  $("appUpdateNotes").addEventListener("click", async (event) => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link || !release) return;
    event.preventDefault();
    const request = run;
    try {
      await AppUpdates.openURL(new URL(link.getAttribute("href")!, release.releaseURL).href);
    } catch (error) {
      if (request === run) showError(message(error));
    }
  });
  if (isMyGo()) events.appUpdateRequested.on(open);
  AppUpdates.version().then((value) => {
    version = value;
  }).catch(() => {});
  return dialog;
}
