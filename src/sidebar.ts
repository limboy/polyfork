// Keep the current three-column card size as the basis for up to six columns.
export function initSidebarResize() {
  const sidebar = document.getElementById("sidebar")!;
  const handle = document.getElementById("sidebarResize")!;
  const grid = document.getElementById("grid")!;
  const sidebarStyle = getComputedStyle(sidebar);
  const gridStyle = getComputedStyle(grid);
  const minWidth = parseFloat(sidebarStyle.minWidth);
  const gap = parseFloat(gridStyle.columnGap);
  const inset = parseFloat(sidebarStyle.borderLeftWidth) + parseFloat(sidebarStyle.borderRightWidth)
    + parseFloat(gridStyle.paddingLeft) + parseFloat(gridStyle.paddingRight);
  const columnWidth = (minWidth - inset + gap) / 3;
  const maxWidth = minWidth + 3 * columnWidth;
  const storageKey = "sidebarWidth";
  let preferredWidth = minWidth;
  let drag: { pointerId: number; x: number; width: number } | null = null;

  try {
    const saved = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(saved) && saved >= minWidth) preferredWidth = Math.min(saved, maxWidth);
  } catch {}

  // Leave enough room to use the viewer when the window is narrow.
  const availableWidth = () => Math.max(minWidth, Math.min(maxWidth, document.documentElement.clientWidth - 360));

  function applyWidth() {
    const width = Math.max(minWidth, Math.min(preferredWidth, availableWidth()));
    const columns = Math.min(6, 3 + Math.floor((width - minWidth + 0.01) / columnWidth));
    sidebar.style.width = `${width}px`;
    grid.style.setProperty("--sidebar-columns", String(columns));
    handle.setAttribute("aria-valuemin", String(minWidth));
    handle.setAttribute("aria-valuemax", String(Math.round(availableWidth())));
    handle.setAttribute("aria-valuenow", String(Math.round(width)));
    handle.setAttribute("aria-valuetext", `${Math.round(width)} 像素，每排 ${columns} 个模型`);
  }

  function setWidth(width: number) {
    preferredWidth = Math.max(minWidth, Math.min(width, availableWidth()));
    applyWidth();
  }

  function saveWidth() {
    try {
      localStorage.setItem(storageKey, String(preferredWidth));
    } catch {}
  }

  function finishDrag() {
    if (!drag) return;
    const { pointerId } = drag;
    drag = null;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    document.body.classList.remove("sidebar-resizing");
    saveWidth();
  }

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    handle.focus();
    drag = { pointerId: event.pointerId, x: event.clientX, width: sidebar.getBoundingClientRect().width };
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("sidebar-resizing");
  });
  handle.addEventListener("pointermove", (event) => {
    if (event.pointerId === drag?.pointerId) setWidth(drag.width + event.clientX - drag.x);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    handle.addEventListener(type, (event) => {
      if ((event as PointerEvent).pointerId === drag?.pointerId) finishDrag();
    });
  }
  window.addEventListener("blur", finishDrag);
  handle.addEventListener("keydown", (event) => {
    const width = sidebar.getBoundingClientRect().width;
    switch (event.key) {
      case "ArrowLeft": setWidth(width - 16); break;
      case "ArrowRight": setWidth(width + 16); break;
      case "Home": setWidth(minWidth); break;
      case "End": setWidth(availableWidth()); break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    saveWidth();
  });
  window.addEventListener("resize", applyWidth);
  applyWidth();
}
