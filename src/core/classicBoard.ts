// The "classic" board shape — a single shared start, a fork into N named branches, a single shared
// finish — expressed as the old, simpler parametric description (route lengths + a special on each
// node), compiled into the general graph BoardConfig that core/board.ts actually builds.
//
// Every board shipped before this session used exactly 3 named branches (A/B/C); the shape now
// generalizes to any lane count >= 2 via `ClassicBoardConfig.laneIds` (defaulting to ['A','B','C']
// when omitted, so every existing board/save/test keeps compiling to the exact same graph). This is
// what lets a map preset like a 2-path "S-Curve" reuse the same compiler/detector/renderer machinery
// as today's 3-path board, instead of needing a parallel one-off shape system.

import { Board, BoardConfig, CardType, GraphNodeConfig, NodeKind, SpecialType } from './types';

export type RouteId = string;
/** The historical default lane set — every board authored before lane counts were configurable. */
export const DEFAULT_LANE_IDS: RouteId[] = ['A', 'B', 'C'];
/** @deprecated kept for call sites that only ever dealt with the classic 3-lane board; prefer reading
 *  the actual lane set from a `ClassicShape`/`ClassicLanes` (via `detectClassicShape`/`classicLanes`)
 *  or a specific `ClassicBoardConfig.laneIds` wherever the lane count might not be 3. */
export const ROUTE_IDS: RouteId[] = DEFAULT_LANE_IDS;

/** A special space on a classic board, addressed by node id (e.g. "A4", "S2", "M1"). */
export interface SpecialPlacement {
  node: string;
  type: SpecialType;
  card?: CardType;
  amount?: number;
}

/**
 * TX → S1 … S{prefixLen}(fork) ─┬─ A1 … A{a} ─┐
 *                                ├─ B1 … B{b} ─┼→ M1 … M{suffixLen} → RX
 *                                └─ (any number of lanes) ┘
 * Every lane has exactly `routeLengths[laneId]` steps from TX to RX (RX counts as the last step), so
 * branch length = routeLengths[laneId] − prefixLen − suffixLen − 1.
 */
export interface ClassicBoardConfig {
  name?: string;
  /** Which lanes exist and their order. Omitted = ['A','B','C'] (every board authored before this was
   *  configurable) — this is what keeps every existing saved board/test compiling unchanged. */
  laneIds?: RouteId[];
  routeLengths: Record<string, number>;
  prefixLen: number;
  suffixLen: number;
  specials: SpecialPlacement[];
}

export function lanesOf(cfg: ClassicBoardConfig): RouteId[] {
  return cfg.laneIds ?? DEFAULT_LANE_IDS;
}

export function branchLengths(cfg: ClassicBoardConfig): number[] {
  return lanesOf(cfg).map((r) => cfg.routeLengths[r] - cfg.prefixLen - cfg.suffixLen - 1);
}

/** Returns a list of human-readable problems with a classic config (empty = valid). */
export function validateClassicConfig(cfg: ClassicBoardConfig): string[] {
  const problems: string[] = [];
  if (cfg.prefixLen < 1) problems.push('prefixLen must be at least 1 (the fork is the last shared space).');
  if (cfg.suffixLen < 0) problems.push('suffixLen cannot be negative.');
  const lanes = lanesOf(cfg);
  if (lanes.length < 2) problems.push('A classic board needs at least 2 lanes (laneIds).');
  const bl = branchLengths(cfg);
  lanes.forEach((r, i) => {
    if (bl[i] < 2) problems.push(`Route ${r}: branch would have ${bl[i]} unique spaces (need at least 2).`);
  });
  const seen = new Set<string>();
  for (const s of cfg.specials) {
    if (seen.has(s.node)) problems.push(`Two specials on node ${s.node}.`);
    seen.add(s.node);
    if (s.type === 'chance' && !s.card) problems.push(`Chance on ${s.node} has no card assigned.`);
  }
  return problems;
}

/** All node ids for a classic structure, in generation order (TX, shared start, each lane, shared finish, RX). */
export function classicNodeIds(cfg: ClassicBoardConfig): string[] {
  const ids = ['TX'];
  for (let i = 1; i <= cfg.prefixLen; i++) ids.push(`S${i}`);
  const bl = branchLengths(cfg);
  lanesOf(cfg).forEach((r, ri) => {
    for (let j = 1; j <= bl[ri]; j++) ids.push(`${r}${j}`);
  });
  for (let k = 1; k <= cfg.suffixLen; k++) ids.push(`M${k}`);
  ids.push('RX');
  return ids;
}

/** Parsed identity of a classic-shaped node id: which "lane" it belongs to and its step along it. */
export interface ClassicNodeMeta {
  /** 'TX' | 'S' (shared start) | a lane id (any letter(s), e.g. 'A'/'B'/'C') | 'M' (shared finish) | 'RX' */
  lane: string;
  /** step index within the lane (1-based; 0 for TX/RX) */
  step: number;
}

const LANE_RE = /^([A-Za-z]+)(\d*)$/;

/** Reads a classic-style id ("A4", "S2", "M1", "TX", "RX") back into its lane/step. Purely a naming
 *  convention used by classic boards; never relied on by core/board.ts or core/engine.ts. */
export function classicNodeMeta(id: string): ClassicNodeMeta {
  if (id === 'TX' || id === 'RX') return { lane: id, step: 0 };
  const m = LANE_RE.exec(id);
  if (!m) return { lane: 'S', step: 0 };
  return { lane: m[1], step: m[2] ? Number(m[2]) : 0 };
}

function kindOf(specialByNode: Map<string, SpecialPlacement>, id: string, fallback: NodeKind): NodeKind {
  const sp = specialByNode.get(id);
  return sp ? sp.type : fallback;
}

/** Compiles a classic board description into the general graph BoardConfig, node-for-node identical
 *  to how core/board.ts built boards before the graph rewrite (for the default 3-lane shape). */
export function compileClassicBoard(cfg: ClassicBoardConfig): BoardConfig {
  const problems = validateClassicConfig(cfg);
  if (problems.length) throw new Error(`Invalid classic board: ${problems.join(' ')}`);

  const specialByNode = new Map<string, SpecialPlacement>();
  for (const s of cfg.specials) specialByNode.set(s.node, s);

  const nodes: GraphNodeConfig[] = [];
  const edges: [string, string][] = [];
  const addNode = (id: string, fallback: NodeKind) => {
    const sp = specialByNode.get(id);
    nodes.push({ id, kind: kindOf(specialByNode, id, fallback), card: sp?.card, amount: sp?.amount });
  };
  const link = (a: string, b: string) => edges.push([a, b]);

  addNode('TX', 'tx');
  let prev = 'TX';
  for (let i = 1; i <= cfg.prefixLen; i++) {
    const id = `S${i}`;
    addNode(id, 'normal');
    link(prev, id);
    prev = id;
  }
  const fork = prev; // last shared-start node

  const bl = branchLengths(cfg);
  const mergeEntry = cfg.suffixLen > 0 ? 'M1' : 'RX';
  lanesOf(cfg).forEach((r, ri) => {
    let p = fork;
    for (let j = 1; j <= bl[ri]; j++) {
      const id = `${r}${j}`;
      addNode(id, 'normal');
      link(p, id);
      p = id;
    }
    link(p, mergeEntry);
  });

  let mprev: string | null = null;
  for (let k = 1; k <= cfg.suffixLen; k++) {
    const id = `M${k}`;
    addNode(id, 'normal');
    if (mprev) link(mprev, id);
    mprev = id;
  }
  if (cfg.suffixLen > 0) link(mprev!, 'RX');
  addNode('RX', 'rx');

  return { name: cfg.name, nodes, edges };
}

/** A classic-shaped board's node ids, grouped by lane and ordered by step — what the live renderer
 *  (routes.tsx / tiles.tsx / annotations.ts / BoardCanvas.tsx) needs in place of the old numeric
 *  `junction`/`mergeEntry`/`branchFirst`/`branchLast`/`routeNodes` Board fields. `null` if `board`
 *  isn't classic-shaped (see `detectClassicShape`). Works for any lane count >= 2, discovered from the
 *  board itself — never assumes A/B/C specifically. */
export interface ClassicLanes {
  tx: string;
  rx: string;
  laneIds: RouteId[];
  /** S1..Sp, in order (TX/fork itself excluded; the last entry is the fork, or `tx` if prefixLen is 0). */
  prefix: string[];
  /** Each lane's own nodes (excluding the fork and merge entry), in order. */
  branch: Record<string, string[]>;
  /** M1..Ms, in order (empty if suffixLen is 0). */
  suffix: string[];
}

export function classicLanes(board: Board): ClassicLanes | null {
  const shape = detectClassicShape(board);
  if (!shape) return null;
  const byLane: Record<string, { step: number; id: string }[]> = { S: [], M: [] };
  for (const r of shape.laneIds) byLane[r] = [];
  let tx = '';
  let rx = '';
  for (const n of board.nodes) {
    const meta = classicNodeMeta(n.id);
    if (meta.lane === 'TX') tx = n.id;
    else if (meta.lane === 'RX') rx = n.id;
    else (byLane[meta.lane] ??= []).push({ step: meta.step, id: n.id });
  }
  const ordered = (arr: { step: number; id: string }[]) => [...arr].sort((a, b) => a.step - b.step).map((x) => x.id);
  const branch: Record<string, string[]> = {};
  for (const r of shape.laneIds) branch[r] = ordered(byLane[r] ?? []);
  return { tx, rx, laneIds: shape.laneIds, prefix: ordered(byLane.S), branch, suffix: ordered(byLane.M) };
}

export interface ClassicShape {
  prefixLen: number;
  suffixLen: number;
  laneIds: RouteId[];
  branchLen: Record<string, number>;
  routeLengths: Record<string, number>;
}

/**
 * True (and the structural numbers) if `board`'s node ids are exactly the classic naming convention
 * for SOME prefix/suffix/branch lengths and SOME set of >=2 lanes (discovered from the board's own
 * node ids, not assumed to be A/B/C) — a cosmetic/compatibility heuristic, not a rules concept. Used
 * to decide (a) which layout algorithm draws the map, and (b) whether the live renderer can play the
 * map at all ("▶ Playable now" vs "⚠ Needs the graph-rendering follow-up" in the Map Editor).
 */
export function detectClassicShape(board: Board): ClassicShape | null {
  const ids = board.nodes.map((n) => n.id);
  if (!ids.includes('TX') || !ids.includes('RX')) return null;
  let prefixLen = 0;
  let suffixLen = 0;
  const branchLen: Record<string, number> = {};
  const laneSet = new Set<string>();
  for (const id of ids) {
    if (id === 'TX' || id === 'RX') continue;
    const meta = classicNodeMeta(id);
    if (meta.lane === 'S') prefixLen = Math.max(prefixLen, meta.step);
    else if (meta.lane === 'M') suffixLen = Math.max(suffixLen, meta.step);
    else {
      laneSet.add(meta.lane);
      branchLen[meta.lane] = Math.max(branchLen[meta.lane] ?? 0, meta.step);
    }
  }
  if (laneSet.size < 2) return null;
  const laneIds = [...laneSet].sort();
  if (!laneIds.every((r) => branchLen[r] >= 2)) return null;
  const routeLengths: Record<string, number> = {};
  for (const r of laneIds) routeLengths[r] = prefixLen + branchLen[r] + suffixLen + 1;
  const expectedIds = new Set(classicNodeIds({ routeLengths, laneIds, prefixLen, suffixLen, specials: [] }));
  if (expectedIds.size !== ids.length || !ids.every((id) => expectedIds.has(id))) return null;
  // Also confirm the edges themselves match what compileClassicBoard would generate — a node-id
  // match alone could in principle hide a manually-rewired (non-classic) edge set.
  const expectedEdges = new Set(compileClassicBoard({ routeLengths, laneIds, prefixLen, suffixLen, specials: [] }).edges.map(([a, b]) => `${a}>${b}`));
  const actualEdges = new Set<string>();
  for (const id of ids) for (const to of board.succ[id]) actualEdges.add(`${id}>${to}`);
  if (expectedEdges.size !== actualEdges.size || ![...expectedEdges].every((e) => actualEdges.has(e))) return null;
  return { prefixLen, suffixLen, laneIds, branchLen, routeLengths };
}
