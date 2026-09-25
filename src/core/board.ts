// Builds the runtime Board (adjacency, distances) from a declarative graph BoardConfig.
// buildBoard() enforces only the handful of invariants no algorithm here can work without:
// unique ids, exactly one TX, exactly one RX, and no cycle. Everything else (every node reachable
// from TX, every node able to reach RX, no dead ends, sane path lengths, …) is advisory and lives in
// core/mapValidate.ts, so the Map Editor can show "MAP HAS ERRORS" with an explicit override instead
// of the app refusing to even look at a half-finished map.

import { Board, BoardConfig, BoardNode, SpecialType, UNREACHABLE } from './types';

export const DEFAULT_LAYER_SPACING = 160;
export const DEFAULT_NODE_SPACING = 110;
const MARGIN = 120;

export class BoardBuildError extends Error {}

/** Build the runtime Board. Throws BoardBuildError on any of the four hard invariants. */
export function buildBoard(cfg: BoardConfig): Board {
  const n = cfg.nodes.length;
  if (n === 0) throw new BoardBuildError('The board has no nodes.');

  const byId = new Map<string, number>();
  const idOf: string[] = new Array(n);
  const nodes: BoardNode[] = new Array(n);
  let txIdx = -1;
  let rxIdx = -1;

  cfg.nodes.forEach((nc, idx) => {
    if (byId.has(nc.id)) throw new BoardBuildError(`Duplicate node id "${nc.id}".`);
    byId.set(nc.id, idx);
    idOf[idx] = nc.id;
    const special: BoardNode['special'] =
      nc.kind === 'chance' || nc.kind === 'noise' || nc.kind === 'booster'
        ? { type: nc.kind as SpecialType, card: nc.card, amount: nc.amount }
        : null;
    if (nc.kind === 'chance' && !nc.card) throw new BoardBuildError(`Chance space "${nc.id}" has no card assigned.`);
    nodes[idx] = { idx, id: nc.id, kind: nc.kind, special, x: 0, y: 0 };
    if (nc.kind === 'tx') {
      if (txIdx >= 0) throw new BoardBuildError(`More than one Transmitter node ("${idOf[txIdx]}" and "${nc.id}").`);
      txIdx = idx;
    }
    if (nc.kind === 'rx') {
      if (rxIdx >= 0) throw new BoardBuildError(`More than one Receiver node ("${idOf[rxIdx]}" and "${nc.id}").`);
      rxIdx = idx;
    }
  });
  if (txIdx < 0) throw new BoardBuildError('The board has no Transmitter node.');
  if (rxIdx < 0) throw new BoardBuildError('The board has no Receiver node.');

  // ---- adjacency (directed)
  const succ: Record<string, string[]> = {};
  const pred: Record<string, string[]> = {};
  for (const id of idOf) {
    succ[id] = [];
    pred[id] = [];
  }
  const succIdx: number[][] = Array.from({ length: n }, () => []);
  const predIdx: number[][] = Array.from({ length: n }, () => []);
  for (const [from, to] of cfg.edges) {
    if (!byId.has(from)) throw new BoardBuildError(`Edge references unknown node "${from}".`);
    if (!byId.has(to)) throw new BoardBuildError(`Edge references unknown node "${to}".`);
    if (from === to) throw new BoardBuildError(`Node "${from}" has an edge to itself.`);
    const a = byId.get(from)!;
    const b = byId.get(to)!;
    succ[from].push(to);
    pred[to].push(from);
    succIdx[a].push(b);
    predIdx[b].push(a);
  }

  // ---- topological sort (Kahn's algorithm) — also the cycle check
  const indeg = predIdx.map((p) => p.length);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  const topo: number[] = [];
  let qHead = 0;
  while (qHead < queue.length) {
    const u = queue[qHead++];
    topo.push(u);
    for (const v of succIdx[u]) {
      indeg[v]--;
      if (indeg[v] === 0) queue.push(v);
    }
  }
  if (topo.length !== n) {
    const stuck = idOf.filter((_, i) => indeg[i] > 0);
    throw new BoardBuildError(`The board graph has a cycle (involving: ${stuck.slice(0, 6).join(', ')}${stuck.length > 6 ? ', …' : ''}).`);
  }

  // ---- remaining: single-source BFS from RX, walking edges backward (i.e. over `pred`)
  const remaining = new Int16Array(n).fill(UNREACHABLE);
  remaining[rxIdx] = 0;
  {
    const q = [rxIdx];
    let head = 0;
    while (head < q.length) {
      const u = q[head++];
      for (const v of predIdx[u]) {
        if (remaining[v] === UNREACHABLE) {
          remaining[v] = remaining[u] + 1;
          q.push(v);
        }
      }
    }
  }

  // ---- dist: undirected all-pairs BFS
  const undirAdj: number[][] = Array.from({ length: n }, () => []);
  for (let u = 0; u < n; u++) {
    for (const v of succIdx[u]) {
      undirAdj[u].push(v);
      undirAdj[v].push(u);
    }
  }
  const dist = new Int16Array(n * n).fill(-1);
  for (let src = 0; src < n; src++) {
    dist[src * n + src] = 0;
    const q = [src];
    let head = 0;
    while (head < q.length) {
      const u = q[head++];
      for (const v of undirAdj[u]) {
        if (dist[src * n + v] < 0) {
          dist[src * n + v] = dist[src * n + u] + 1;
          q.push(v);
        }
      }
    }
  }

  // ---- generic default layout: BFS-depth layer from TX × even spacing within a layer.
  // Purely cosmetic — overwritten by applyLayout() whenever a saved MapLayout exists.
  const layer = new Int32Array(n).fill(-1);
  layer[txIdx] = 0;
  {
    const q = [txIdx];
    let head = 0;
    while (head < q.length) {
      const u = q[head++];
      for (const v of succIdx[u]) {
        if (layer[v] < 0 || layer[v] > layer[u] + 1) {
          layer[v] = layer[u] + 1;
          q.push(v);
        }
      }
    }
  }
  let maxLayer = 0;
  const byLayer = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const l = Math.max(0, layer[i]);
    maxLayer = Math.max(maxLayer, l);
    const list = byLayer.get(l) ?? [];
    list.push(i);
    byLayer.set(l, list);
  }
  let maxPerLayer = 1;
  for (const list of byLayer.values()) maxPerLayer = Math.max(maxPerLayer, list.length);
  for (const [l, list] of byLayer) {
    list.forEach((idx, i) => {
      nodes[idx].x = Math.round(MARGIN + l * DEFAULT_LAYER_SPACING);
      nodes[idx].y = Math.round(MARGIN + (maxPerLayer * DEFAULT_NODE_SPACING) / 2 + (i - (list.length - 1) / 2) * DEFAULT_NODE_SPACING);
    });
  }

  return {
    config: cfg,
    nodes,
    tx: txIdx,
    rx: rxIdx,
    byId,
    idOf,
    succ,
    pred,
    topo,
    remaining,
    dist,
    width: MARGIN * 2 + (maxLayer + 1) * DEFAULT_LAYER_SPACING,
    height: MARGIN * 2 + maxPerLayer * DEFAULT_NODE_SPACING,
  };
}

export function nodeDist(board: Board, aId: string, bId: string): number {
  const a = board.byId.get(aId);
  const b = board.byId.get(bId);
  if (a == null || b == null) return -1;
  return board.dist[a * board.nodes.length + b];
}

export function remainingOf(board: Board, id: string): number {
  const i = board.byId.get(id);
  return i == null ? UNREACHABLE : board.remaining[i];
}

/** Longest TX→RX path length (steps), via one topological-order DP pass. Infinity-safe on a DAG. */
export function longestPath(board: Board): number {
  const n = board.nodes.length;
  const best = new Int32Array(n).fill(-1);
  best[board.tx] = 0;
  for (const u of board.topo) {
    if (best[u] < 0) continue;
    for (const vId of board.succ[board.idOf[u]]) {
      const v = board.byId.get(vId)!;
      if (best[v] < best[u] + 1) best[v] = best[u] + 1;
    }
  }
  return best[board.rx] < 0 ? -1 : best[board.rx];
}

/** Shortest TX→RX path length (steps). Equivalent to board.remaining[tx]. */
export function shortestPath(board: Board): number {
  return board.remaining[board.tx];
}

/**
 * Enumerate every simple TX→RX path (as arrays of node ids), capped at `limit` results.
 * For diagnostics/inspection only — never used in a hot loop (the simulator tags games by their own
 * trail instead of enumerating). Returns `{ paths, truncated }`.
 */
export function enumeratePaths(board: Board, limit = 500): { paths: string[][]; truncated: boolean } {
  const paths: string[][] = [];
  let truncated = false;
  const walk = (nodeIdx: number, trail: number[]) => {
    if (truncated) return;
    if (nodeIdx === board.rx) {
      if (paths.length >= limit) {
        truncated = true;
        return;
      }
      paths.push(trail.map((i) => board.idOf[i]));
      return;
    }
    for (const succId of board.succ[board.idOf[nodeIdx]]) {
      const v = board.byId.get(succId)!;
      walk(v, [...trail, v]);
      if (truncated) return;
    }
  };
  walk(board.tx, [board.tx]);
  return { paths, truncated };
}
