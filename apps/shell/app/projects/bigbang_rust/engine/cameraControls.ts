import type { Camera } from "../renderer/types";

export function createCameraControls(el: HTMLElement) {
  const cam: Camera = { azimuth: 0.6, elevation: 0.35, distance: 3.2 };
  let dragging = false;
  let px = 0, py = 0;
  let autoRotate = true;

  const onDown = (e: PointerEvent) => {
    dragging = true; autoRotate = false;
    px = e.clientX; py = e.clientY;
    el.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    cam.azimuth -= (e.clientX - px) * 0.006;
    cam.elevation = clamp(cam.elevation + (e.clientY - py) * 0.006, -1.4, 1.4);
    px = e.clientX; py = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    dragging = false;
    try { el.releasePointerCapture(e.pointerId); } catch {}
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    cam.distance = clamp(cam.distance * (1 + Math.sign(e.deltaY) * 0.08), 1.4, 8);
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("wheel", onWheel, { passive: false });

  return {
    camera: cam,
    tick(dt: number) {
      if (autoRotate) cam.azimuth += dt * 0.05;
    },
    dispose() {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
    },
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
