// Map layout = everything about how the board LOOKS: where every node sits in the world, path labels
// and decorative landmarks. It never touches game rules — the engine only reads the graph in Board.
// Layouts are plain data so the Map Editor can edit, save and load them.
//
// For a classic-shaped board (single shared start → named branches → single shared finish, the only
// shape the live renderer can draw today) node positions are still sampled along the original hand-
// authored curves, purely by recognising the classic id-naming convention — nothing here reads
// board-level "this is classic" metadata, since the generic Board type doesn't carry any. Any other
// graph shape falls back to a generic BFS-layer layout (the same one buildBoard() seeds by default),
// rescaled into the map's world coordinates.

import { ClassicShape, RouteId, detectClassicShape } from './classicBoard';
import { Board } from './types';
import { Pt, catmullDense, polyLength, sampleAlong } from './spline';
import { WheelShape, detectWheelShape, laneLetter } from './wheelBoard';

export type { Pt };

export type DecorKind =
  | 'platform'
  | 'planet'
  | 'satellite'
  | 'dish'
  | 'relay'
  | 'crystal'
  | 'observatory'
  | 'gate'
  | 'portal'
  | 'core'
  | 'tower'
  | 'cloud'
  | 'jelly'
  | 'probe'
  | 'hub'
  | 'rock';

export const DECOR_KINDS: { kind: DecorKind; label: string }[] = [
  { kind: 'platform', label: 'Floating platform' },
  { kind: 'planet', label: 'Planet' },
  { kind: 'satellite', label: 'Satellite' },
  { kind: 'dish', label: 'Signal dish' },
  { kind: 'relay', label: 'Orbital relay' },
  { kind: 'crystal', label: 'Data crystal' },
  { kind: 'observatory', label: 'Observatory' },
  { kind: 'gate', label: 'Energy gate' },
  { kind: 'portal', label: 'Frequency portal' },
  { kind: 'core', label: 'Signal core' },
  { kind: 'tower', label: 'Antenna tower' },
  { kind: 'hub', label: 'Comms hub' },
  { kind: 'cloud', label: 'Cloud' },
  { kind: 'jelly', label: 'Space jelly' },
  { kind: 'probe', label: 'Probe balloon' },
  { kind: 'rock', label: 'Floating rock' },
];

export interface Decoration {
  id: string;
  kind: DecorKind;
  x: number;
  y: number;
  scale: number;
  rot: number;
  /** Platform width in world units (platforms only). */
  w?: number;
}

export interface MapLayout {
  v: 1;
  worldW: number;
  worldH: number;
  /** Position of every node id, including "TX" and "RX". */
  nodePos: Record<string, Pt>;
  /** Top-left corner of the first Receiver slot ("docking bay"). */
  slotsAnchor: Pt;
  /** Cosmetic path/lane labels — keyed by lane id (the classic "A"/"B"/"C" for a classic board). */
  pathLabels: Record<string, string>;
  decor: Decoration[];
}

export const WORLD_W = 1800;
export const WORLD_H = 1180;

/** Authored route waypoints (world units). Nodes are spread evenly along these curves. */
export interface Waypoints {
  prefix: Pt[]; // TX → fork
  branch: Record<RouteId, Pt[]>; // fork → merge entry
  suffix: Pt[]; // merge entry → RX
}

/** Authoring is done on a 1800×1000 canvas; y is stretched a little so the world uses tall screens well. */
const VS = 1.22;
const Yv = (y: number) => Math.round(500 + (y - 500) * VS);
const P = (x: number, y: number): Pt => ({ x, y: Yv(y) });

export const DEFAULT_WAYPOINTS: Waypoints = {
  prefix: [P(140, 800), P(200, 690), P(300, 640), P(400, 600), P(470, 540), P(560, 480)],
  branch: {
    // A — crystal ridge: the high road over the top
    A: [P(560, 480), P(570, 350), P(650, 245), P(790, 185), P(960, 160), P(1100, 190), P(1215, 265), P(1255, 370), P(1230, 480)],
    // B — satellite belt: weaves through the middle
    B: [P(560, 480), P(650, 480), P(725, 445), P(790, 400), P(880, 370), P(970, 395), P(1040, 375), P(1120, 405), P(1185, 450), P(1230, 480)],
    // C — nebula loop: the long way round, with a curl by the wormhole
    C: [P(560, 480), P(545, 600), P(590, 715), P(700, 795), P(840, 840), P(985, 830), P(1110, 790), P(1185, 705), P(1120, 625), P(1185, 550), P(1230, 480)],
  },
  suffix: [P(1230, 480), P(1330, 470), P(1420, 482), P(1520, 480)],
};

/** Map 2 — "S-CURVE": two lanes, one bending through an explicit S so the map reads as a genuinely
 *  different shape from Map 1, not a recolour of it. */
export const S_CURVE_WAYPOINTS: Waypoints = {
  prefix: [P(140, 620), P(240, 590), P(340, 560), P(440, 540), P(520, 520)],
  branch: {
    // A — the S-curve: swings low, then high, then low again before the merge
    A: [P(520, 520), P(620, 620), P(720, 720), P(840, 760), P(960, 720), P(1050, 600), P(1130, 500), P(1210, 470), P(1300, 500), P(1360, 520)],
    // B — a calmer high road, so the two lanes are visually distinct the whole way
    B: [P(520, 520), P(580, 390), P(680, 270), P(840, 200), P(1020, 190), P(1180, 220), P(1300, 270), P(1390, 360), P(1400, 450), P(1360, 520)],
  },
  suffix: [P(1360, 520), P(1480, 518), P(1620, 520)],
};

const linePts = (a: Pt, b: Pt, n = 2): Pt[] => Array.from({ length: n }, (_, i) => P(a.x + ((b.x - a.x) * i) / (n - 1), a.y + ((b.y - a.y) * i) / (n - 1)));

/** A point on a circle of radius `r` around `(cx,cy)`, `angleDeg` measured clockwise from due east —
 *  the one bit of new geometry the wheel map (core/wheelBoard.ts) needs; everything else about laying
 *  it out reuses the same `catmullDense`/`sampleAlong` spline pipeline as the classic board. */
export function polar(cx: number, cy: number, r: number, angleDeg: number): Pt {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Target distance between consecutive stones on a generated layout (world units). */
const FAN_STEP = 104;

const denseLen = (pts: Pt[]) => polyLength(catmullDense(pts));

const laneGapFor = (n: number) => (n <= 2 ? 300 : n === 3 ? 260 : n === 4 ? 225 : 190);

/**
 * A bundle of parallel lanes from `fork` to a merge point further right, one lane per entry of `lens`
 * (the number of stones on that lane). Lanes leave the fork in a fan (so their first stones never
 * touch), run side by side `gap` apart, and a lane that needs more room than the shortest one either
 * bulges outward (top/bottom lane) or snakes in parallel (inner lanes) until its stones sit roughly
 * FAN_STEP apart. Returns each lane's waypoints (fork and merge included) and the merge point.
 */
function laneBundle(fork: Pt, lens: number[], gap: number): { lanes: Pt[][]; merge: Pt } {
  const n = lens.length;
  const fanR = 150;
  const turn = 150;
  // body length: the shortest lane runs (nearly) straight at FAN_STEP spacing
  const body = Math.max(180, (Math.min(...lens) + 1) * FAN_STEP - 2 * (fanR + turn) + 60);
  const xa = fork.x + fanR + turn;
  const merge: Pt = { x: xa + body + fanR + turn, y: fork.y };
  const spread = Math.min(42, 170 / Math.max(1, n - 1));
  const waves = Math.max(1, Math.round(body / 330));

  const lanePts = (li: number, amp: number): Pt[] => {
    const mid = li - (n - 1) / 2;
    const off = mid * gap;
    const ang = (mid * spread * Math.PI) / 180;
    const outer = li === 0 || li === n - 1;
    const side = off < 0 ? -1 : 1;
    const pts: Pt[] = [fork, { x: fork.x + fanR * Math.cos(ang), y: fork.y + fanR * Math.sin(ang) }];
    const k = 14;
    for (let i = 0; i <= k; i++) {
      const u = i / k;
      const y = outer ? fork.y + off + side * amp * Math.sin(Math.PI * u) : fork.y + off + amp * Math.sin(Math.PI * waves * u);
      pts.push({ x: xa + body * u, y });
    }
    pts.push({ x: merge.x - fanR * Math.cos(ang), y: fork.y + fanR * Math.sin(ang) }, merge);
    return pts;
  };

  const lanes = lens.map((len, li) => {
    const need = (len + 1) * FAN_STEP;
    const outer = li === 0 || li === n - 1;
    if (denseLen(lanePts(li, 0)) >= need) return lanePts(li, 0);
    let lo = 0;
    let hi = outer ? 520 : gap * 0.34;
    for (let it = 0; it < 22; it++) {
      const m = (lo + hi) / 2;
      if (denseLen(lanePts(li, m)) < need) lo = m;
      else hi = m;
    }
    return lanePts(li, hi);
  });
  return { lanes, merge };
}

/** Waypoints for a straight lead-in of `count` stones ending at `end`, starting from a start tower
 *  down-left of it. */
function leadIn(end: Pt, count: number): Pt[] {
  const tx: Pt = { x: end.x - Math.max(380, count * FAN_STEP + 120), y: end.y + 230 };
  return [tx, { x: tx.x + (end.x - tx.x) * 0.45, y: end.y + 150 }, { x: end.x - 110, y: end.y + 30 }, end];
}

/** Waypoints for the finish run from `start` to the Receiver, `count` stones long. */
function runOut(start: Pt, count: number): Pt[] {
  const rx: Pt = { x: start.x + Math.max(280, count * FAN_STEP + 180), y: start.y };
  return [start, { x: (start.x + rx.x) / 2, y: start.y - 20 }, rx];
}

/**
 * Generated waypoints for a classic board with ANY number of lanes and any lane lengths — what makes
 * a 2-, 4- or 5-lane map (or a long "marathon" board) look as tidy as the hand-drawn 3-lane world.
 * World coordinates (no vertical stretch).
 */
export function fanWaypoints(shape: ClassicShape): Waypoints {
  const fork: Pt = { x: 160 + Math.max(380, shape.prefixLen * FAN_STEP + 120), y: 600 };
  const { lanes, merge } = laneBundle(fork, shape.laneIds.map((r) => shape.branchLen[r]), laneGapFor(shape.laneIds.length));
  const branch: Record<RouteId, Pt[]> = {};
  shape.laneIds.forEach((r, i) => (branch[r] = lanes[i]));
  return { prefix: leadIn(fork, shape.prefixLen), branch, suffix: runOut(merge, shape.suffixLen) };
}

/** Smallest distance between any two stones (a quick "does this look cramped?" check). */
function minSpacing(pos: Record<string, Pt>): number {
  const pts = Object.entries(pos)
    .filter(([id]) => id !== 'TX' && id !== 'RX')
    .map(([, p]) => p);
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) best = Math.min(best, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return best;
}

/** True if the map is the classic 3-lane A/B/C shape and fits the hand-drawn world without crowding. */
function usesHandDrawnWorld(shape: ClassicShape): boolean {
  return shape.laneIds.join('') === 'ABC' && minSpacing(classicPositions(shape, DEFAULT_WAYPOINTS)) >= 78;
}

/** Which waypoints a classic board is drawn along: the caller's (if they cover every lane), the hand-
 *  drawn A/B/C world, otherwise a generated fan layout. */
function classicWaypointsFor(shape: ClassicShape, wp?: Waypoints): Waypoints {
  if (wp && shape.laneIds.every((r) => wp.branch[r])) return wp;
  if (usesHandDrawnWorld(shape)) return DEFAULT_WAYPOINTS;
  return fanWaypoints(shape);
}

function classicPositions(shape: ClassicShape, wp: Waypoints): Record<string, Pt> {
  const pos: Record<string, Pt> = {};
  const { prefixLen: p, suffixLen: s, branchLen, laneIds } = shape;
  const rx = wp.suffix[wp.suffix.length - 1];
  pos.TX = wp.prefix[0];
  pos.RX = rx;

  const pre = catmullDense(wp.prefix);
  sampleAlong(pre, Array.from({ length: p }, (_, i) => (i + 1) / p)).forEach((pt, i) => (pos[`S${i + 1}`] = pt));

  laneIds.forEach((r) => {
    const b = branchLen[r];
    let pts = wp.branch[r] ?? wp.branch[Object.keys(wp.branch)[0]];
    if (s === 0) pts = [...pts.slice(0, -1), rx];
    const dense = catmullDense(pts);
    sampleAlong(dense, Array.from({ length: b }, (_, j) => (j + 1) / (b + 1))).forEach((pt, j) => (pos[`${r}${j + 1}`] = pt));
  });

  if (s > 0) {
    const dense = catmullDense(wp.suffix.length >= 2 ? wp.suffix : linePts(wp.suffix[0], rx));
    sampleAlong(dense, Array.from({ length: s }, (_, k) => k / s)).forEach((pt, k) => (pos[`M${k + 1}`] = pt));
  }
  return pos;
}

/** How a wheel-shaped board (chained fork → lanes → merge stages) is drawn. */
export type WheelStyle = 'spiral' | 'chain';

const sampleInto = (pos: Record<string, Pt>, pts: Pt[], ids: string[], from = 1, of = ids.length + 1) =>
  sampleAlong(catmullDense(pts), ids.map((_, j) => (j + from) / of)).forEach((pt, j) => (pos[ids[j]] = pt));

const stageLaneIds = (stage: number, li: number, len: number) => Array.from({ length: len }, (_, j) => `R${stage}${laneLetter(li)}${j + 1}`);

/** "Chain": the stages sit left to right like links of a chain, each one a small fork → lanes → merge. */
function chainPositions(shape: WheelShape): Record<string, Pt> {
  const pos: Record<string, Pt> = {};
  let entry: Pt = { x: 160 + Math.max(380, shape.prefixLen * FAN_STEP + 120), y: 600 };
  const pre = leadIn(entry, shape.prefixLen);
  pos.TX = pre[0];
  sampleInto(pos, pre, Array.from({ length: shape.prefixLen }, (_, i) => `S${i + 1}`), 1, shape.prefixLen);
  shape.stages.forEach((st, si) => {
    const { lanes, merge } = laneBundle(entry, Array(st.laneCount).fill(st.laneLen), st.laneCount <= 2 ? 240 : laneGapFor(st.laneCount));
    lanes.forEach((pts, li) => sampleInto(pos, pts, stageLaneIds(si + 1, li, st.laneLen)));
    pos[`X${si + 1}`] = merge;
    entry = merge;
  });
  const out = runOut(entry, shape.suffixLen);
  pos.RX = out[out.length - 1];
  sampleInto(pos, out, Array.from({ length: shape.suffixLen }, (_, k) => `M${k + 1}`), 1, shape.suffixLen + 1);
  return pos;
}

/** "Spiral": the start tower sits in the middle and each stage is a ring further out, its lanes running
 *  side by side around the arc, so the board reads as a spiral — while the graph itself only ever moves
 *  forward (see wheelBoard.ts). Ring radii and sweep angles are derived from the lane lengths so stones
 *  keep roughly FAN_STEP apart and rings never touch. */
function spiralPositions(shape: WheelShape): Record<string, Pt> {
  const pos: Record<string, Pt> = {};
  const laneGap = 130;
  // stretched sideways so the spiral fills a 16:9 projector instead of a square
  const at = (r: number, deg: number) => {
    const p = polar(0, 0, r, deg);
    return { x: p.x * 1.45, y: p.y };
  };
  let angle = 90; // the lead-in runs straight down from the centre, then the rings turn clockwise
  pos.TX = { x: 0, y: 0 };
  const firstR = 230;
  for (let i = 0; i < shape.prefixLen; i++) pos[`S${i + 1}`] = at(firstR + i * FAN_STEP, angle);
  let entryR = firstR + (shape.prefixLen - 1) * FAN_STEP;
  shape.stages.forEach((st, si) => {
    const half = ((st.laneCount - 1) / 2) * laneGap;
    const ringR = entryR + 110 + half;
    const exitR = ringR + half + 110;
    const need = (st.laneLen + 1) * FAN_STEP - 180;
    const sweep = Math.min(200, Math.max(70, (need / ringR) * (180 / Math.PI)));
    const exit = at(exitR, angle + sweep);
    for (let li = 0; li < st.laneCount; li++) {
      const r = ringR + (li - (st.laneCount - 1) / 2) * laneGap;
      // step out to this lane's own radius first, so neighbouring lanes never leave the fork side by side
      const pts = [at(entryR, angle), at(entryR + (r - entryR) * 0.7, angle + sweep * 0.04)];
      for (let k = 1; k <= 6; k++) pts.push(at(r, angle + sweep * (0.14 + (0.74 * (k - 1)) / 5)));
      pts.push(exit);
      sampleInto(pos, pts, stageLaneIds(si + 1, li, st.laneLen));
    }
    pos[`X${si + 1}`] = exit;
    angle += sweep;
    entryR = exitR;
  });
  for (let k = 1; k <= shape.suffixLen; k++) pos[`M${k}`] = at(entryR + k * FAN_STEP, angle);
  pos.RX = at(entryR + shape.suffixLen * FAN_STEP + 190, angle);
  return pos;
}

function wheelPositions(shape: WheelShape, style: WheelStyle = 'spiral'): Record<string, Pt> {
  return style === 'chain' ? chainPositions(shape) : spiralPositions(shape);
}

/** Generic fallback for a non-classic graph: rescale buildBoard()'s own BFS-layer default positions
 *  (already computed in a small internal coordinate space) into the map's world coordinates. */
function genericPositions(board: Board): Record<string, Pt> {
  const pos: Record<string, Pt> = {};
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of board.nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  }
  const pad = 120;
  const sx = maxX > minX ? (WORLD_W - 2 * pad) / (maxX - minX) : 1;
  const sy = maxY > minY ? (WORLD_H - 2 * pad) / (maxY - minY) : 1;
  const s = Math.min(sx, sy, 2.2);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const n of board.nodes) pos[n.id] = { x: Math.round(WORLD_W / 2 + (n.x - cx) * s), y: Math.round(WORLD_H / 2 + (n.y - cy) * s) };
  return pos;
}

/** Seed a position for every node — classic curves for a classic-shaped board, a radial spiral for a
 *  wheel-shaped board, a generic layered layout for anything else (used for the default layout and
 *  whenever the graph structure changes). */
export function autoNodePositions(board: Board, wp?: Waypoints): Record<string, Pt> {
  const shape = detectClassicShape(board);
  if (shape) {
    const w = classicWaypointsFor(shape, wp);
    const pos = classicPositions(shape, w);
    return w === DEFAULT_WAYPOINTS ? pos : fitToWorld(pos).nodePos;
  }
  const wheel = detectWheelShape(board);
  if (wheel) return fitToWorld(wheelPositions(wheel)).nodePos;
  return genericPositions(board);
}

let decorSeq = 0;
export const newDecorId = () => `d${Date.now().toString(36)}${(decorSeq++).toString(36)}`;

const D = (kind: DecorKind, x: number, y: number, scale = 1, rot = 0, w?: number): Decoration => ({ id: `${kind}-${x}-${Yv(y)}`, kind, x, y: Yv(y), scale, rot, w });

/** The default landmarks: floating platforms under the route, plus scenery. Purely decorative. */
export function defaultDecor(): Decoration[] {
  return [
    // big far-away scenery first (drawn behind)
    D('planet', 250, 170, 1.5),
    D('planet', 1640, 140, 1.1),
    D('planet', 120, 470, 0.8),
    D('cloud', 1380, 90, 1.3),
    D('cloud', 700, 60, 1),
    D('cloud', 1700, 560, 1.1),
    D('cloud', 380, 940, 1.2),
    D('cloud', 1220, 930, 1),
    D('rock', 420, 300, 0.8),
    D('rock', 1450, 780, 0.9),
    D('rock', 60, 640, 0.7),
    D('rock', 1500, 300, 0.6),
    D('satellite', 470, 210, 1, -15),
    D('satellite', 1420, 850, 0.9, 20),
    D('probe', 1330, 250, 1),
    D('jelly', 1050, 930, 1),
    // platforms under the route
    D('platform', 140, 800, 1, 0, 360),
    D('platform', 330, 610, 1, 0, 250),
    D('platform', 560, 480, 1, 0, 230),
    D('platform', 720, 250, 1, 0, 230),
    D('platform', 1010, 190, 1, 0, 250),
    D('platform', 1180, 320, 1, 0, 170),
    D('platform', 880, 665, 1, 0, 330),
    D('platform', 900, 380, 1, 0, 190),
    D('platform', 650, 770, 1, 0, 270),
    D('platform', 930, 850, 1, 0, 250),
    D('platform', 1230, 480, 1, 0, 260),
    D('platform', 1520, 480, 1, 0, 300),
    // landmarks standing on them
    D('tower', 260, 690, 0.9),
    D('gate', 560, 470, 1.1),
    D('observatory', 690, 205, 1),
    D('relay', 1030, 135, 1),
    D('dish', 1160, 275, 0.9),
    D('core', 880, 660, 1.25),
    D('crystal', 990, 850, 1),
    D('dish', 620, 730, 0.9),
    D('portal', 1050, 700, 1),
    D('hub', 1235, 445, 1.1),
    D('crystal', 1130, 760, 0.8),
    D('crystal', 800, 350, 0.7),
  ];
}

/** Shift generated positions so nothing sits off-canvas (labels above TX/RX need ~360 units of
 *  headroom), and size the world + Receiver slot column to fit them. */
function fitToWorld(pos: Record<string, Pt>): { nodePos: Record<string, Pt>; worldW: number; worldH: number; slotsAnchor: Pt } {
  const pts = Object.values(pos);
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const dx = 170 - minX;
  const dy = 380 - minY;
  const nodePos: Record<string, Pt> = {};
  for (const [id, p] of Object.entries(pos)) nodePos[id] = { x: Math.round(p.x + dx), y: Math.round(p.y + dy) };
  const maxX = Math.max(...Object.values(nodePos).map((p) => p.x));
  const maxY = Math.max(...Object.values(nodePos).map((p) => p.y));
  // the winner-slot column goes right next to the finish (right side first, then left), wherever it
  // doesn't cover a stone; failing that, past the right edge of the board
  const rx = nodePos.RX;
  const colH = 5 * (SLOT_H + SLOT_GAP);
  const stones = Object.entries(nodePos).filter(([id]) => id !== 'RX');
  const free = (a: Pt) => stones.every(([, p]) => p.x < a.x - 70 || p.x > a.x + SLOT_W + 70 || p.y < a.y - 70 || p.y > a.y + colH + 70);
  const top = Math.max(120, rx.y - 330);
  const slotsAnchor = [{ x: rx.x + 200, y: top }, { x: rx.x - 200 - SLOT_W, y: top }].find(free) ?? { x: maxX + 110, y: top };
  slotsAnchor.x = Math.round(slotsAnchor.x);
  slotsAnchor.y = Math.round(slotsAnchor.y);
  return { nodePos, worldW: Math.max(WORLD_W, maxX + 260, slotsAnchor.x + SLOT_W + 170), worldH: Math.max(WORLD_H, maxY + 260, slotsAnchor.y + colH + 120), slotsAnchor };
}

/** Tiny deterministic PRNG so a generated map always gets the same scenery. */
function lcg(seed: number) {
  let x = seed >>> 0 || 1;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Scenery for a generated layout: platforms under the start, the finish and every fork/merge, then
 *  background pieces scattered wherever there is empty sky (never on top of a stone or a path). */
export function generatedDecor(board: Board, nodePos: Record<string, Pt>, worldW: number, worldH: number): Decoration[] {
  const out: Decoration[] = [];
  const mk = (kind: DecorKind, x: number, y: number, scale = 1, rot = 0, w?: number): Decoration => ({ id: `${kind}-${Math.round(x)}-${Math.round(y)}`, kind, x: Math.round(x), y: Math.round(y), scale, rot, w });
  const at = (id: string) => nodePos[id];
  if (at('TX')) out.push(mk('platform', at('TX').x, at('TX').y, 1, 0, 340));
  if (at('RX')) out.push(mk('platform', at('RX').x, at('RX').y, 1, 0, 300));
  for (const n of board.nodes) {
    if (n.kind === 'tx' || n.kind === 'rx') continue;
    const hub = (board.succ[n.id]?.length ?? 0) > 1 || (board.pred[n.id]?.length ?? 0) > 1;
    if (hub && at(n.id)) out.push(mk('platform', at(n.id).x, at(n.id).y, 1, 0, 220));
  }
  const pts = Object.values(nodePos);
  const clearOf = (x: number, y: number, r: number) => pts.every((p) => Math.hypot(p.x - x, p.y - y) > r) && out.every((d) => d.kind === 'platform' || Math.hypot(d.x - x, d.y - y) > 230);
  const rnd = lcg(board.nodes.length * 7919 + Math.round(worldW));
  const far: DecorKind[] = ['planet', 'cloud', 'cloud', 'planet', 'rock', 'cloud', 'satellite', 'probe', 'jelly', 'rock'];
  const near: DecorKind[] = ['crystal', 'dish', 'relay', 'observatory', 'hub', 'crystal'];
  let fi = 0;
  let ni = 0;
  for (let tries = 0; tries < 400 && fi < far.length; tries++) {
    const x = 80 + rnd() * (worldW - 160);
    const y = 60 + rnd() * (worldH - 120);
    if (!clearOf(x, y, 250)) continue;
    const kind = far[fi++];
    out.push(mk(kind, x, y, kind === 'planet' ? 0.9 + rnd() * 0.6 : 0.8 + rnd() * 0.4, kind === 'satellite' ? -20 + rnd() * 40 : 0));
  }
  for (let tries = 0; tries < 400 && ni < near.length; tries++) {
    const x = 120 + rnd() * (worldW - 240);
    const y = 160 + rnd() * (worldH - 260);
    if (!clearOf(x, y, 150)) continue;
    // "near" landmarks sit close-ish to the route, so it reads as a place rather than empty space
    if (pts.every((p) => Math.hypot(p.x - x, p.y - y) > 300)) continue;
    out.push(mk(near[ni++], x, y, 0.8 + rnd() * 0.3));
  }
  // far scenery first so it is drawn behind
  return [...out.filter((d) => far.includes(d.kind) && d.kind !== 'rock'), ...out.filter((d) => !(far.includes(d.kind) && d.kind !== 'rock'))];
}

export function defaultLayout(board: Board, wp?: Waypoints, wheelStyle: WheelStyle = 'spiral'): MapLayout {
  const shape = detectClassicShape(board);
  if (shape) {
    const pathLabels: Record<string, string> = {};
    for (const r of shape.laneIds) pathLabels[r] = `PATH ${r}`;
    const w = classicWaypointsFor(shape, wp);
    if (w === DEFAULT_WAYPOINTS) {
      return { v: 1, worldW: WORLD_W, worldH: WORLD_H, nodePos: classicPositions(shape, w), slotsAnchor: { x: 1620, y: 250 }, pathLabels, decor: defaultDecor() };
    }
    const fit = fitToWorld(classicPositions(shape, w));
    return { v: 1, ...fit, pathLabels, decor: generatedDecor(board, fit.nodePos, fit.worldW, fit.worldH) };
  }
  const wheel = detectWheelShape(board);
  if (wheel) {
    const pathLabels: Record<string, string> = {};
    wheel.stages.forEach((st) => {
      for (let li = 0; li < st.laneCount; li++) pathLabels[laneLetter(li)] = pathLabels[laneLetter(li)] ?? `LANE ${laneLetter(li)}`;
    });
    const fit = fitToWorld(wheelPositions(wheel, wheelStyle));
    return { v: 1, ...fit, pathLabels, decor: generatedDecor(board, fit.nodePos, fit.worldW, fit.worldH) };
  }
  return { v: 1, worldW: WORLD_W, worldH: WORLD_H, nodePos: genericPositions(board), slotsAnchor: { x: 1620, y: 250 }, pathLabels: {}, decor: [] };
}

/** Make sure every node of `board` has a position; missing ones are seeded from the auto layout. */
export function ensureLayout(board: Board, layout?: MapLayout | null): MapLayout {
  if (!layout) return defaultLayout(board);
  const auto = autoNodePositions(board);
  const nodePos: Record<string, Pt> = {};
  for (const n of board.nodes) nodePos[n.id] = layout.nodePos[n.id] ?? auto[n.id];
  return { ...layout, nodePos };
}

/** The board with node x/y taken from the layout (graph, specials and rules untouched). */
export function applyLayout(board: Board, layout: MapLayout): Board {
  return {
    ...board,
    nodes: board.nodes.map((n) => {
      const p = layout.nodePos[n.id];
      return p ? { ...n, x: Math.round(p.x), y: Math.round(p.y) } : n;
    }),
    width: layout.worldW,
    height: layout.worldH,
  };
}

export const SLOT_W = 150;
export const SLOT_H = 104;
export const SLOT_GAP = 16;

/** Bounding box that must be visible: every node, the slots and the main landmarks. */
export function layoutBounds(board: Board, layout: MapLayout, slots: number, pad = 90): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number, r = 0) => {
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  };
  for (const n of board.nodes) {
    const p = layout.nodePos[n.id] ?? { x: n.x, y: n.y };
    add(p.x, p.y, n.id === 'TX' ? 130 : n.id === 'RX' ? 120 : 50);
  }
  const a = layout.slotsAnchor;
  add(a.x, a.y);
  add(a.x + SLOT_W, a.y + slots * (SLOT_H + SLOT_GAP));
  for (const d of layout.decor) if (d.kind === 'platform') add(d.x, d.y, (d.w ?? 220) * 0.42);
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}
