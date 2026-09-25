// Board camera: an auto-fit view box that always shows the whole map, plus optional zoom/pan and eased focus.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Cam {
  /** centre offset from the map centre, in world units */
  dx: number;
  dy: number;
  /** 1 = fit the whole map */
  z: number;
}

export const FIT: Cam = { dx: 0, dy: 0, z: 1 };

/** Smallest box with the container's aspect ratio that contains `b` (so the SVG never letterboxes). */
export function fitBox(b: Box, cw: number, ch: number): Box {
  const a = cw > 0 && ch > 0 ? cw / ch : 16 / 9;
  let w = b.w;
  let h = b.h;
  if (w / h > a) h = w / a;
  else w = h * a;
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
}

export function viewBoxOf(b: Box, cw: number, ch: number, cam: Cam): Box {
  const f = fitBox(b, cw, ch);
  const w = f.w / cam.z;
  const h = f.h / cam.z;
  const cx = b.x + b.w / 2 + cam.dx;
  const cy = b.y + b.h / 2 + cam.dy;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export const clampZoom = (z: number) => Math.min(4, Math.max(0.6, z));

export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export const lerpCam = (a: Cam, b: Cam, t: number): Cam => ({
  dx: a.dx + (b.dx - a.dx) * t,
  dy: a.dy + (b.dy - a.dy) * t,
  z: a.z + (b.z - a.z) * t,
});
