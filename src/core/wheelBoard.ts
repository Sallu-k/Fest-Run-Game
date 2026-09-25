// The "wheel" board shape: several sequential fork -> merge stages chained end to end (each stage's
// merge node is the next stage's fork node), laid out radially (core/mapLayout.ts's polar() + this
// module's own layout) so it visually reads as a ring — while remaining a strict forward DAG. "Looping"
// is purely a node-coordinate choice; core/board.ts never sees anything but ordinary forward edges, so
// there is no risk of infinite movement (the same cycle-rejection buildBoard() already enforces for
// every other shape applies here too).
//
// Mirrors core/classicBoard.ts's compiler/detector/lanes pattern deliberately, so the live renderer's
// generic per-lane-group ribbon-drawing code (routes.tsx) can draw a wheel the same way it draws a
// classic board — a wheel just contributes more lane groups (one per stage) to the same iteration.

import { Board, BoardConfig, CardType, GraphNodeConfig, NodeKind, SpecialType } from './types';

export interface WheelSpecialPlacement {
  node: string;
  type: SpecialType;
  card?: CardType;
  amount?: number;
}

/** One fork/merge stage: `laneCount` parallel lanes, each with `laneLen` own spaces (uniform per stage
 *  so the ring reads cleanly — individual lanes can still differ via specials, same as the classic board). */
export interface RingStage {
  laneCount: number;
  laneLen: number;
}

export interface WheelBoardConfig {
  name?: string;
  prefixLen: number;
  stages: RingStage[];
  suffixLen: number;
  specials: WheelSpecialPlacement[];
}

const LANE_LETTERS = 'ABCDEFGH';
export const laneLetter = (i: number): string => LANE_LETTERS[i] ?? String.fromCharCode(65 + i);

export function validateWheelConfig(cfg: WheelBoardConfig): string[] {
  const problems: string[] = [];
  if (cfg.prefixLen < 1) problems.push('prefixLen must be at least 1 (the first fork is the last shared space).');
  if (cfg.suffixLen < 0) problems.push('suffixLen cannot be negative.');
  if (cfg.stages.length < 1) problems.push('A wheel needs at least one ring stage.');
  cfg.stages.forEach((st, i) => {
    if (st.laneCount < 2) problems.push(`Stage ${i + 1}: needs at least 2 lanes.`);
    if (st.laneLen < 1) problems.push(`Stage ${i + 1}: lanes need at least 1 space.`);
  });
  const seen = new Set<string>();
  for (const s of cfg.specials) {
    if (seen.has(s.node)) problems.push(`Two specials on node ${s.node}.`);
    seen.add(s.node);
    if (s.type === 'chance' && !s.card) problems.push(`Chance on ${s.node} has no card assigned.`);
  }
  return problems;
}

/** Node ids for one stage's lanes, in lane order: `wheelStageLaneIds(cfg,0)[0]` is stage 1's lane A. */
export function wheelStageLaneIds(cfg: WheelBoardConfig, stageIdx: number): string[][] {
  const st = cfg.stages[stageIdx];
  return Array.from({ length: st.laneCount }, (_, li) =>
    Array.from({ length: st.laneLen }, (_, j) => `R${stageIdx + 1}${laneLetter(li)}${j + 1}`),
  );
}

/** All node ids for a wheel structure, in generation order. */
export function wheelNodeIds(cfg: WheelBoardConfig): string[] {
  const ids = ['TX'];
  for (let i = 1; i <= cfg.prefixLen; i++) ids.push(`S${i}`);
  cfg.stages.forEach((_, si) => {
    wheelStageLaneIds(cfg, si).forEach((lane) => ids.push(...lane));
    ids.push(`X${si + 1}`);
  });
  for (let k = 1; k <= cfg.suffixLen; k++) ids.push(`M${k}`);
  ids.push('RX');
  return ids;
}

function kindOf(specialByNode: Map<string, WheelSpecialPlacement>, id: string, fallback: NodeKind): NodeKind {
  const sp = specialByNode.get(id);
  return sp ? sp.type : fallback;
}

export function compileWheelBoard(cfg: WheelBoardConfig): BoardConfig {
  const problems = validateWheelConfig(cfg);
  if (problems.length) throw new Error(`Invalid wheel board: ${problems.join(' ')}`);

  const specialByNode = new Map<string, WheelSpecialPlacement>();
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
  let stageEntry = prev; // this stage's fork node (the previous stage's exit, or the prefix's end)

  cfg.stages.forEach((_st, si) => {
    const lanes = wheelStageLaneIds(cfg, si);
    const exitId = `X${si + 1}`;
    lanes.forEach((lane) => {
      let p = stageEntry;
      for (const id of lane) {
        addNode(id, 'normal');
        link(p, id);
        p = id;
      }
      link(p, exitId);
    });
    addNode(exitId, 'normal');
    stageEntry = exitId; // this stage's merge doubles as the next stage's fork
  });

  let mprev: string | null = null;
  for (let k = 1; k <= cfg.suffixLen; k++) {
    const id = `M${k}`;
    addNode(id, 'normal');
    link(mprev ?? stageEntry, id);
    mprev = id;
  }
  link(mprev ?? stageEntry, 'RX');
  addNode('RX', 'rx');

  return { name: cfg.name, nodes, edges };
}

export interface WheelShape {
  prefixLen: number;
  suffixLen: number;
  stages: RingStage[];
}

const STAGE_LANE_RE = /^R(\d+)([A-Za-z])(\d+)$/;
const STAGE_EXIT_RE = /^X(\d+)$/;
const PREFIX_RE = /^S(\d+)$/;
const SUFFIX_RE = /^M(\d+)$/;

/** True (and the structural numbers) if `board`'s node ids exactly match the wheel naming convention
 *  for some prefix/suffix length and stage list. Mirrors `detectClassicShape`'s role for the wheel shape. */
export function detectWheelShape(board: Board): WheelShape | null {
  const ids = board.nodes.map((n) => n.id);
  if (!ids.includes('TX') || !ids.includes('RX')) return null;
  let prefixLen = 0;
  let suffixLen = 0;
  let maxStage = 0;
  const stageLaneMax: Record<number, Record<string, number>> = {};
  const seenExit = new Set<number>();
  for (const id of ids) {
    if (id === 'TX' || id === 'RX') continue;
    let m = PREFIX_RE.exec(id);
    if (m) {
      prefixLen = Math.max(prefixLen, Number(m[1]));
      continue;
    }
    m = SUFFIX_RE.exec(id);
    if (m) {
      suffixLen = Math.max(suffixLen, Number(m[1]));
      continue;
    }
    m = STAGE_EXIT_RE.exec(id);
    if (m) {
      const stage = Number(m[1]);
      maxStage = Math.max(maxStage, stage);
      seenExit.add(stage);
      continue;
    }
    m = STAGE_LANE_RE.exec(id);
    if (m) {
      const stage = Number(m[1]);
      const lane = m[2];
      const step = Number(m[3]);
      maxStage = Math.max(maxStage, stage);
      (stageLaneMax[stage] ??= {})[lane] = Math.max(stageLaneMax[stage]?.[lane] ?? 0, step);
      continue;
    }
    return null; // an id that doesn't fit the wheel convention at all
  }
  if (maxStage < 1) return null;
  const stages: RingStage[] = [];
  for (let s = 1; s <= maxStage; s++) {
    if (!seenExit.has(s)) return null;
    const lanes = stageLaneMax[s];
    if (!lanes) return null;
    const lens = Object.values(lanes);
    if (lens.length < 2) return null;
    const laneLen = lens[0];
    if (!lens.every((l) => l === laneLen)) return null; // must be uniform per stage for a clean ring
    stages.push({ laneCount: lens.length, laneLen });
  }
  const cfg: WheelBoardConfig = { prefixLen, stages, suffixLen, specials: [] };
  const expectedIds = new Set(wheelNodeIds(cfg));
  if (expectedIds.size !== ids.length || !ids.every((id) => expectedIds.has(id))) return null;
  const expectedEdges = new Set(compileWheelBoard(cfg).edges.map(([a, b]) => `${a}>${b}`));
  const actualEdges = new Set<string>();
  for (const id of ids) for (const to of board.succ[id]) actualEdges.add(`${id}>${to}`);
  if (expectedEdges.size !== actualEdges.size || ![...expectedEdges].every((e) => actualEdges.has(e))) return null;
  return { prefixLen, suffixLen, stages };
}

/** One (stage, lane) group — what routes.tsx draws one ribbon for. `entry`/`exit` are the shared
 *  fork/merge node ids at each end (the previous/next stage's boundary, or TX/RX for the first/last). */
export interface WheelLaneGroup {
  stage: number;
  laneId: string;
  nodes: string[];
  entry: string;
  exit: string;
}

export interface WheelLanes {
  tx: string;
  rx: string;
  prefix: string[];
  groups: WheelLaneGroup[];
  suffix: string[];
}

export function wheelLanes(board: Board): WheelLanes | null {
  const shape = detectWheelShape(board);
  if (!shape) return null;
  const byStageLane: Record<string, { step: number; id: string }[]> = {};
  const prefixArr: { step: number; id: string }[] = [];
  const suffixArr: { step: number; id: string }[] = [];
  const exitByStage: Record<number, string> = {};
  let tx = '';
  let rx = '';
  for (const n of board.nodes) {
    if (n.id === 'TX') {
      tx = n.id;
      continue;
    }
    if (n.id === 'RX') {
      rx = n.id;
      continue;
    }
    let m = PREFIX_RE.exec(n.id);
    if (m) {
      prefixArr.push({ step: Number(m[1]), id: n.id });
      continue;
    }
    m = SUFFIX_RE.exec(n.id);
    if (m) {
      suffixArr.push({ step: Number(m[1]), id: n.id });
      continue;
    }
    m = STAGE_EXIT_RE.exec(n.id);
    if (m) {
      exitByStage[Number(m[1])] = n.id;
      continue;
    }
    m = STAGE_LANE_RE.exec(n.id);
    if (m) {
      const key = `${m[1]}.${m[2]}`;
      (byStageLane[key] ??= []).push({ step: Number(m[3]), id: n.id });
    }
  }
  const ordered = (arr: { step: number; id: string }[]) => [...arr].sort((a, b) => a.step - b.step).map((x) => x.id);
  const prefix = ordered(prefixArr);
  const groups: WheelLaneGroup[] = [];
  shape.stages.forEach((st, si) => {
    const stage = si + 1;
    const entry = stage === 1 ? (prefix.length ? prefix[prefix.length - 1] : tx) : exitByStage[stage - 1];
    const exit = exitByStage[stage];
    for (let li = 0; li < st.laneCount; li++) {
      const laneId = laneLetter(li);
      const key = `${stage}.${laneId}`;
      groups.push({ stage, laneId, nodes: ordered(byStageLane[key] ?? []), entry, exit });
    }
  });
  return { tx, rx, prefix, groups, suffix: ordered(suffixArr) };
}
