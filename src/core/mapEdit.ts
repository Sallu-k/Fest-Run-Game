// Pure editing operations for the Map Editor: real graph primitives (add/delete/duplicate a node,
// change its type, connect/disconnect any two nodes) plus a few named recipes built from them
// (insert a node on an edge, create a parallel branch, split a path, merge several paths into one).
// Each operation takes a MapConfiguration and returns a new one (or a typed error) — nothing here
// enforces the old "single fork, three named branches, single merge" skeleton; that shape is now
// just one possible graph, produced by core/classicBoard.ts's compiler.

import { buildBoard, longestPath } from './board';
import { detectClassicShape } from './classicBoard';
import { Decoration, DecorKind, MapLayout, Pt, defaultLayout, newDecorId } from './mapLayout';
import { validateMap } from './mapValidate';
import { layoutProblems } from './placementRules';
import { BoardConfig, CardType, GraphNodeConfig, NodeKind, RulesConfig, SpecialSpec } from './types';
import { detectWheelShape } from './wheelBoard';

export interface MapConfiguration {
  board: BoardConfig;
  rules: RulesConfig;
  layout: MapLayout;
}

export type EditResult = { ok: true; map: MapConfiguration; warnings: string[] } | { ok: false; error: string };

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const ok = (map: MapConfiguration, warnings: string[] = []): EditResult => ({ ok: true, map, warnings });
const fail = (error: string): EditResult => ({ ok: false, error });

/** Rebuilds the board to check the edit didn't break an invariant buildBoard() enforces (cycle, etc). */
function tryBuild(map: MapConfiguration): string | null {
  try {
    buildBoard(map.board);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function nodeById(cfg: BoardConfig, id: string): GraphNodeConfig | undefined {
  return cfg.nodes.find((n) => n.id === id);
}

let genSeq = 0;
/** A short, human-friendly, unused node id. */
export function freshNodeId(cfg: BoardConfig, hint = 'N'): string {
  const used = new Set(cfg.nodes.map((n) => n.id));
  for (let i = 1; i < 1000; i++) {
    const id = `${hint}${i}`;
    if (!used.has(id)) return id;
  }
  return `${hint}${Date.now().toString(36)}${genSeq++}`;
}

// ------------------------------------------------------------------ node primitives

/** Add a plain (or special) node, not yet connected to anything. */
export function addNode(map: MapConfiguration, spec: { id?: string; kind: NodeKind; card?: CardType; amount?: number }, at?: Pt): { map: MapConfiguration; id: string } {
  const m = clone(map);
  const id = spec.id && !nodeById(m.board, spec.id) ? spec.id : freshNodeId(m.board, spec.kind === 'chance' ? 'C' : spec.kind === 'noise' ? 'N' : spec.kind === 'booster' ? 'B' : 'X');
  m.board.nodes.push({ id, kind: spec.kind, card: spec.card, amount: spec.amount });
  const pos = at ?? { x: m.layout.worldW / 2, y: m.layout.worldH / 2 };
  m.layout.nodePos[id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
  return { map: m, id };
}

/** Delete a node and its edges. If `reconnect`, every predecessor is wired directly to every
 *  successor first, so removing a mid-path node doesn't sever the path. */
export function deleteNode(map: MapConfiguration, id: string, reconnect = true): EditResult {
  const node = nodeById(map.board, id);
  if (!node) return fail(`Unknown node "${id}".`);
  if (node.kind === 'tx' || node.kind === 'rx') return fail('The Transmitter and Receiver cannot be deleted.');
  const m = clone(map);
  const preds = m.board.edges.filter(([, to]) => to === id).map(([from]) => from);
  const succs = m.board.edges.filter(([from]) => from === id).map(([, to]) => to);
  m.board.edges = m.board.edges.filter(([from, to]) => from !== id && to !== id);
  if (reconnect) {
    for (const p of preds) for (const s of succs) if (!m.board.edges.some(([a, b]) => a === p && b === s)) m.board.edges.push([p, s]);
  }
  m.board.nodes = m.board.nodes.filter((n) => n.id !== id);
  delete m.layout.nodePos[id];
  const err = tryBuild(m);
  return err ? fail(err) : ok(m);
}

/** A copy of `id` (same type/card/amount, a fresh id), not yet connected to anything. */
export function duplicateNode(map: MapConfiguration, id: string): EditResult {
  const node = nodeById(map.board, id);
  if (!node) return fail(`Unknown node "${id}".`);
  if (node.kind === 'tx' || node.kind === 'rx') return fail('The Transmitter and Receiver cannot be duplicated.');
  const at = map.layout.nodePos[id];
  const { map: m } = addNode(map, { kind: node.kind, card: node.card, amount: node.amount }, at ? { x: at.x + 40, y: at.y + 40 } : undefined);
  return ok(m);
}

/** Change a node's type (normal ↔ chance/noise/booster) and its special-effect fields. */
export function changeNodeType(map: MapConfiguration, id: string, kind: NodeKind, spec?: { card?: CardType; amount?: number }): EditResult {
  const node = nodeById(map.board, id);
  if (!node) return fail(`Unknown node "${id}".`);
  if (node.kind === 'tx' || node.kind === 'rx') return fail('The Transmitter and Receiver cannot change type.');
  if (kind === 'chance' && !spec?.card) return fail('A Chance space needs a card.');
  const m = clone(map);
  const n = nodeById(m.board, id)!;
  n.kind = kind;
  n.card = kind === 'chance' ? spec?.card : undefined;
  n.amount = kind === 'noise' || kind === 'booster' ? spec?.amount : undefined;
  return ok(m);
}

/** Connect two existing nodes with a directed edge. Rejects duplicate edges and anything that would
 *  create a cycle. */
export function connect(map: MapConfiguration, from: string, to: string): EditResult {
  if (!nodeById(map.board, from)) return fail(`Unknown node "${from}".`);
  if (!nodeById(map.board, to)) return fail(`Unknown node "${to}".`);
  if (from === to) return fail('A node cannot connect to itself.');
  if (map.board.edges.some(([a, b]) => a === from && b === to)) return fail(`${from} already connects to ${to}.`);
  const m = clone(map);
  m.board.edges.push([from, to]);
  const err = tryBuild(m);
  return err ? fail(/cycle/i.test(err) ? `Connecting ${from} → ${to} would create a loop.` : err) : ok(m);
}

/** Remove a directed edge. */
export function disconnect(map: MapConfiguration, from: string, to: string): EditResult {
  if (!map.board.edges.some(([a, b]) => a === from && b === to)) return fail(`${from} does not connect to ${to}.`);
  const m = clone(map);
  m.board.edges = m.board.edges.filter(([a, b]) => !(a === from && b === to));
  return ok(m);
}

// ------------------------------------------------------------------ specials (thin wrappers)

export function setSpecial(map: MapConfiguration, id: string, spec: SpecialSpec | null): EditResult {
  return changeNodeType(map, id, spec ? spec.type : 'normal', spec ? { card: spec.card, amount: spec.amount } : undefined);
}

/** Move a special's effect from one node to another (source becomes normal, target must be normal). */
export function moveSpecial(map: MapConfiguration, from: string, to: string): EditResult {
  const src = nodeById(map.board, from);
  if (!src || (src.kind !== 'chance' && src.kind !== 'noise' && src.kind !== 'booster')) return fail(`${from} has no special space to move.`);
  const dst = nodeById(map.board, to);
  if (!dst) return fail(`Unknown space ${to}.`);
  if (dst.kind !== 'normal') return fail(`${to} already holds a special space or is TX/RX.`);
  const r1 = changeNodeType(map, to, src.kind, { card: src.card, amount: src.amount });
  if (!r1.ok) return r1;
  return changeNodeType(r1.map, from, 'normal');
}

// ------------------------------------------------------------------ recipes: insert / branch / split / merge

/** Split an existing edge by inserting a new node in the middle (the generic form of "add a normal
 *  space after this one" — works for any edge, not just a named branch). */
export function insertNodeOnEdge(map: MapConfiguration, from: string, to: string, kind: NodeKind = 'normal', spec?: { card?: CardType; amount?: number }): EditResult {
  const d = disconnect(map, from, to);
  if (!d.ok) return d;
  const a = map.layout.nodePos[from];
  const b = map.layout.nodePos[to];
  const mid = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : undefined;
  const { map: m2, id } = addNode(d.map, { kind, card: spec?.card, amount: spec?.amount }, mid);
  const c1 = connect(m2, from, id);
  if (!c1.ok) return c1;
  const c2 = connect(c1.map, id, to);
  return c2;
}

/** Add a new parallel path of `count` plain nodes between two existing nodes — "create a branch". */
export function createBranch(map: MapConfiguration, from: string, to: string, count: number): EditResult {
  if (count < 1) return fail('A branch needs at least one space.');
  if (!nodeById(map.board, from)) return fail(`Unknown node "${from}".`);
  if (!nodeById(map.board, to)) return fail(`Unknown node "${to}".`);
  let cur = map;
  const a = map.layout.nodePos[from];
  const b = map.layout.nodePos[to];
  let prev = from;
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const at = a && b ? { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + 60 } : undefined;
    const { map: m2, id } = addNode(cur, { kind: 'normal' }, at);
    const c = connect(m2, prev, id);
    if (!c.ok) return c;
    cur = c.map;
    prev = id;
  }
  const cFinal = connect(cur, prev, to);
  return cFinal;
}

/** Delete a list of nodes (e.g. every node that makes up a branch you created with createBranch). */
export function deleteBranch(map: MapConfiguration, nodeIds: string[]): EditResult {
  let cur = map;
  for (const id of nodeIds) {
    const r = deleteNode(cur, id, false);
    if (!r.ok) return r;
    cur = r.map;
  }
  const err = tryBuild(cur);
  return err ? fail(err) : ok(cur);
}

/** Split a single edge into `branches` parallel one-node paths (a mini fork+merge on that edge). */
export function splitPath(map: MapConfiguration, from: string, to: string, branches: number): EditResult {
  if (branches < 2) return fail('Splitting a path needs at least 2 branches.');
  const d = disconnect(map, from, to);
  if (!d.ok) return d;
  let cur = d.map;
  for (let i = 0; i < branches; i++) {
    const r = createBranch(cur, from, to, 1);
    if (!r.ok) return r;
    cur = r.map;
  }
  return ok(cur);
}

/** Connect several existing nodes into a shared downstream node (creating it if `into` doesn't exist yet). */
export function mergePaths(map: MapConfiguration, fromNodes: string[], into: string, at?: Pt): EditResult {
  let cur = map;
  if (!nodeById(cur.board, into)) {
    const { map: m2 } = addNode(cur, { id: into, kind: 'normal' }, at);
    cur = m2;
  }
  for (const from of fromNodes) {
    const r = connect(cur, from, into);
    if (!r.ok) return r;
    cur = r.map;
  }
  return ok(cur);
}

// ------------------------------------------------------------------ layout-only edits

export function setNodePos(map: MapConfiguration, id: string, p: Pt): MapConfiguration {
  const m = clone(map);
  m.layout.nodePos[id] = { x: Math.round(p.x), y: Math.round(p.y) };
  return m;
}

export function setPathLabel(map: MapConfiguration, lane: string, label: string): MapConfiguration {
  const m = clone(map);
  m.layout.pathLabels[lane] = label.trim() || `PATH ${lane}`;
  return m;
}

export function setSlotsAnchor(map: MapConfiguration, p: Pt): MapConfiguration {
  const m = clone(map);
  m.layout.slotsAnchor = { x: Math.round(p.x), y: Math.round(p.y) };
  return m;
}

export function addDecor(map: MapConfiguration, kind: DecorKind, at: Pt): { map: MapConfiguration; id: string } {
  const m = clone(map);
  const d: Decoration = { id: newDecorId(), kind, x: Math.round(at.x), y: Math.round(at.y), scale: 1, rot: 0, ...(kind === 'platform' ? { w: 220 } : {}) };
  m.layout.decor.push(d);
  return { map: m, id: d.id };
}

export function updateDecor(map: MapConfiguration, id: string, patch: Partial<Decoration>): MapConfiguration {
  const m = clone(map);
  const d = m.layout.decor.find((x) => x.id === id);
  if (d) Object.assign(d, patch, { id: d.id });
  return m;
}

export function removeDecor(map: MapConfiguration, id: string): MapConfiguration {
  const m = clone(map);
  m.layout.decor = m.layout.decor.filter((d) => d.id !== id);
  return m;
}

export function resetLayout(map: MapConfiguration): MapConfiguration {
  const m = clone(map);
  m.layout = defaultLayout(buildBoard(m.board));
  return m;
}

// ------------------------------------------------------------------ validation / reporting

export interface MapReport {
  /** Route lengths if (and only if) the map is still classic-shaped; null for a free-form graph.
   *  Keyed by whatever lane ids the board actually has — not assumed to be exactly A/B/C. */
  classicRouteLengths: Record<string, number> | null;
  /** Whether the live renderer/host UI can play this map today (see classicBoard.ts's detector). */
  playableNow: boolean;
  shortestPath: number;
  longestPath: number;
  problems: string[];
  overlaps: string[];
}

export function mapReport(map: MapConfiguration): MapReport {
  const v = validateMap(map.board);
  let classicRouteLengths: MapReport['classicRouteLengths'] = null;
  let shortest = -1;
  let longest = -1;
  let playableNow = false;
  let placement: string[] = [];
  try {
    const board = buildBoard(map.board);
    const shape = detectClassicShape(board);
    playableNow = !!shape || !!detectWheelShape(board);
    if (shape) classicRouteLengths = shape.routeLengths;
    shortest = board.remaining[board.tx];
    longest = longestPath(board);
    placement = layoutProblems(board, map.rules);
  } catch {
    /* build errors already surfaced via validateMap */
  }
  const overlaps: string[] = [];
  const ids = Object.keys(map.layout.nodePos);
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = map.layout.nodePos[ids[i]];
      const b = map.layout.nodePos[ids[j]];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 54) overlaps.push(`${ids[i]} and ${ids[j]} overlap`);
    }
  return {
    classicRouteLengths,
    playableNow,
    shortestPath: shortest,
    longestPath: longest,
    problems: [...v.errors, ...v.warnings].map((i) => i.message).concat(placement),
    overlaps,
  };
}

export function newMap(board: BoardConfig, rules: RulesConfig, layout?: MapLayout): MapConfiguration {
  return { board: clone(board), rules: clone(rules), layout: layout ? clone(layout) : defaultLayout(buildBoard(board)) };
}
