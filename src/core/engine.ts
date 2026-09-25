// Rules engine shared by the live game and the simulator.
// No randomness lives in here: movement is purely a function of the answers the host enters.
//
// A team's position is `{ node, trail }`: `trail` is the sequence of node ids the team has actually
// visited, from the Transmitter up to `node`. This works for any DAG shape — forward movement asks
// `choose()` whenever a node has more than one successor (there is no single fixed "the fork" any
// more: any node can branch), and backward movement simply pops the trail, so there is no separate
// "which route was I on" bookkeeping to keep in sync.

import {
  Board,
  CARD_INDEX,
  CardType,
  Core,
  Emit,
  Pos,
  RulesConfig,
  SpecialSpec,
  Team,
  UNREACHABLE,
} from './types';

export const MAX_MOVE = 6;

export interface AdvanceResult {
  moved: number;
  reachedRx: boolean;
  /** True when a step needed a branch decision and none was supplied. */
  blocked: boolean;
}

/**
 * Move `pos` forward up to `steps` steps. Whenever the current node has more than one successor,
 * `choose(node, options)` supplies which one to take; returning `null` stops the walk (host has to
 * choose). Visited node ids are appended to `path`.
 */
export function advance(
  board: Board,
  pos: Pos,
  steps: number,
  choose: (node: string, options: string[]) => string | null,
  path?: string[],
): AdvanceResult {
  let moved = 0;
  for (let i = 0; i < steps; i++) {
    if (pos.node === board.idOf[board.rx]) return { moved, reachedRx: true, blocked: false };
    const options = board.succ[pos.node];
    let next: string;
    if (options.length === 0) {
      // Should never happen post-validation (every node can reach RX); treat as "arrived nowhere".
      return { moved, reachedRx: false, blocked: false };
    } else if (options.length === 1) {
      next = options[0];
    } else {
      const picked = choose(pos.node, options);
      if (picked == null) return { moved, reachedRx: false, blocked: true };
      next = picked;
    }
    pos.node = next;
    pos.trail.push(next);
    moved++;
    path?.push(next);
    if (next === board.idOf[board.rx]) return { moved, reachedRx: true, blocked: false };
  }
  return { moved, reachedRx: false, blocked: false };
}

/** Move `pos` backward `steps` steps by retracing its own trail (never past the Transmitter). */
export function stepBack(_board: Board, pos: Pos, steps: number, path?: string[]): number {
  let moved = 0;
  for (let i = 0; i < steps; i++) {
    if (pos.trail.length <= 1) break; // already at TX
    pos.trail.pop();
    pos.node = pos.trail[pos.trail.length - 1];
    moved++;
    path?.push(pos.node);
  }
  return moved;
}

/** Shortest directed TX→nodeId path (BFS over succ). Used to place a team on an arbitrary node
 *  (host override) without it having actually walked there. Deterministic (lexicographically-first
 *  successor wins any tie), so the same node always yields the same trail. */
export function synthesizeTrail(board: Board, nodeId: string): string[] {
  const target = board.byId.get(nodeId);
  if (target == null) throw new Error(`Unknown node "${nodeId}".`);
  const txId = board.idOf[board.tx];
  if (nodeId === txId) return [txId];
  const prevOf = new Map<string, string>();
  const seen = new Set<string>([txId]);
  const q = [txId];
  let head = 0;
  while (head < q.length) {
    const u = q[head++];
    if (u === nodeId) break;
    for (const v of [...board.succ[u]].sort()) {
      if (!seen.has(v)) {
        seen.add(v);
        prevOf.set(v, u);
        q.push(v);
      }
    }
  }
  if (!seen.has(nodeId)) throw new Error(`"${nodeId}" is not reachable from the Transmitter.`);
  const trail = [nodeId];
  let cur = nodeId;
  while (cur !== txId) {
    cur = prevOf.get(cur)!;
    trail.push(cur);
  }
  trail.reverse();
  return trail;
}

export function specialAmount(rules: RulesConfig, sp: SpecialSpec): number {
  if (sp.amount != null) return sp.amount;
  return sp.type === 'booster' ? rules.boosterAmount : rules.noiseBack;
}

export function makeTeam(id: number, name: string, symbol: string, color: string, board: Board): Team {
  const txId = board.idOf[board.tx];
  return {
    id,
    name,
    symbol,
    color,
    node: txId,
    trail: [txId],
    status: 'active',
    slot: 0,
    cards: [0, 0, 0],
    earnedTurn: [-1, -1, -1],
    correctByRound: [],
    totalCorrect: 0,
  };
}

export function remainingOf(board: Board, team: Pick<Team, 'node'>): number {
  const i = board.byId.get(team.node);
  return i == null ? UNREACHABLE : board.remaining[i];
}

export function isActive(t: Team): boolean {
  return t.status === 'active';
}

export function maxSlots(core: Core): number {
  const eligible = core.teams.filter((t) => t.status !== 'out').length;
  return Math.max(1, Math.min(core.rules.winnerSlots, eligible));
}

export function slotsFull(core: Core): boolean {
  return core.qualifiers.length >= maxSlots(core);
}

export function qualifyTeam(core: Core, team: Team, emit?: Emit): void {
  if (team.status === 'qualified') return;
  team.status = 'qualified';
  const rxId = core.board.idOf[core.board.rx];
  team.node = rxId;
  if (team.trail[team.trail.length - 1] !== rxId) team.trail.push(rxId);
  core.qualifiers.push(team.id);
  team.slot = core.qualifiers.length;
  emit?.({ kind: 'qualify', team: team.id, slot: team.slot });
}

/** Does landing here require a quick question (CHANCE / NOISE)? */
export function needsQuestion(sp: SpecialSpec | null): boolean {
  return !!sp && (sp.type === 'chance' || sp.type === 'noise');
}

export function grantCard(core: Core, team: Team, card: CardType, emit?: Emit, earnedTurn = core.turnId): boolean {
  const i = CARD_INDEX[card];
  if (team.cards[i] !== 0) {
    emit?.({ kind: 'card-dup', team: team.id, card });
    return false;
  }
  team.cards[i] = 1;
  team.earnedTurn[i] = earnedTurn;
  emit?.({ kind: 'card-gain', team: team.id, card });
  return true;
}

function nodeOf(board: Board, id: string) {
  return board.nodes[board.byId.get(id)!];
}

/**
 * Resolve the special space the team is standing on (called once, after answer-movement).
 * `correct` is the outcome of the quick question for CHANCE / NOISE (ignored for BOOSTER).
 * Displacement from a special never chains into another special.
 */
export function resolveSpecial(core: Core, team: Team, correct: boolean, emit?: Emit): void {
  const sp = nodeOf(core.board, team.node).special;
  if (!sp) return;
  const board = core.board;
  if (sp.type === 'booster') {
    const from = team.node;
    const pos: Pos = { node: team.node, trail: team.trail };
    const path: string[] = [from];
    const r = advance(board, pos, specialAmount(core.rules, sp), (_node, options) => options[0] ?? null, path);
    team.node = pos.node;
    team.trail = pos.trail;
    emit?.({ kind: 'boost', team: team.id, from, to: team.node, amount: r.moved, path });
    if (r.reachedRx) qualifyTeam(core, team, emit);
    return;
  }
  emit?.({ kind: 'quick', team: team.id, special: sp.type, correct });
  if (sp.type === 'chance') {
    if (correct && sp.card) grantCard(core, team, sp.card, emit);
  } else if (sp.type === 'noise' && !correct) {
    const from = team.node;
    const pos: Pos = { node: team.node, trail: team.trail };
    const path: string[] = [from];
    const moved = stepBack(board, pos, specialAmount(core.rules, sp), path);
    team.node = pos.node;
    team.trail = pos.trail;
    emit?.({ kind: 'noise-back', team: team.id, from, to: team.node, amount: moved, path });
  }
}

export function cardHeld(t: Team, card: CardType): boolean {
  return t.cards[CARD_INDEX[card]] === 1;
}

/** A held card is usable unless it was earned during the current turn. */
export function canUseCard(core: Core, t: Team, card: CardType): boolean {
  const i = CARD_INDEX[card];
  return t.cards[i] === 1 && t.earnedTurn[i] !== core.turnId;
}

export interface TargetInfo {
  team: Team;
  dist: number;
  /** Target holds ORTHOGONALITY that could block this card. */
  shielded: boolean;
}

/** Teams the attacker may hit with ISI: active, within `isiRange` board spaces, and able to move back. */
export function isiTargets(core: Core, attacker: Team): TargetInfo[] {
  const { board, rules } = core;
  const n = board.nodes.length;
  const a = board.byId.get(attacker.node)!;
  const txId = board.idOf[board.tx];
  const out: TargetInfo[] = [];
  for (const t of core.teams) {
    if (t.id === attacker.id || t.status !== 'active' || t.node === txId) continue;
    const b = board.byId.get(t.node)!;
    const d = board.dist[a * n + b];
    if (d >= 0 && d <= rules.isiRange) out.push({ team: t, dist: d, shielded: cardHeld(t, 'orth') && rules.orthBlocksIsi });
  }
  return out;
}

/** Teams the user may swap with using FREQUENCY HOP. */
export function hopTargets(core: Core, user: Team): TargetInfo[] {
  const { board, rules } = core;
  const n = board.nodes.length;
  const a = board.byId.get(user.node)!;
  const out: TargetInfo[] = [];
  for (const t of core.teams) {
    if (t.id === user.id || t.status !== 'active') continue;
    if (t.node === user.node) continue;
    const b = board.byId.get(t.node)!;
    const d = board.dist[a * n + b];
    if (rules.hopMaxRange != null && (d < 0 || d > rules.hopMaxRange)) continue;
    out.push({ team: t, dist: d, shielded: cardHeld(t, 'orth') && rules.orthBlocksHop });
  }
  return out;
}

export function useIsi(core: Core, attacker: Team, target: Team, blocked: boolean, emit?: Emit): void {
  attacker.cards[CARD_INDEX.isi] = 2;
  const from = target.node;
  if (blocked && cardHeld(target, 'orth')) {
    target.cards[CARD_INDEX.orth] = 2;
    emit?.({ kind: 'isi', team: attacker.id, target: target.id, from, to: from, steps: 0, blocked: true, path: [from] });
    emit?.({ kind: 'orth', team: target.id, against: 'isi', attacker: attacker.id });
    return;
  }
  const pos: Pos = { node: target.node, trail: target.trail };
  const path: string[] = [from];
  const steps = stepBack(core.board, pos, core.rules.isiPenalty, path);
  target.node = pos.node;
  target.trail = pos.trail;
  emit?.({ kind: 'isi', team: attacker.id, target: target.id, from, to: target.node, steps, blocked: false, path });
}

export function useHop(_core: Core, user: Team, target: Team, blocked: boolean, emit?: Emit): void {
  user.cards[CARD_INDEX.hop] = 2;
  const teamFrom = user.node;
  if (blocked && cardHeld(target, 'orth')) {
    target.cards[CARD_INDEX.orth] = 2;
    emit?.({ kind: 'hop', team: user.id, target: target.id, teamFrom, teamTo: teamFrom, blocked: true });
    emit?.({ kind: 'orth', team: target.id, against: 'hop', attacker: user.id });
    return;
  }
  const n = user.node;
  const tr = user.trail;
  user.node = target.node;
  user.trail = target.trail;
  target.node = n;
  target.trail = tr;
  emit?.({ kind: 'hop', team: user.id, target: target.id, teamFrom, teamTo: user.node, blocked: false });
}

// ---------------------------------------------------------------- ranking / fallback

export interface RankRow {
  team: Team;
  remaining: number;
  finalRoundCorrect: number;
}

/** Non-qualified teams ordered by fewest spaces remaining, then final-round correct answers. */
export function fallbackRanking(core: Core, finalRound: number): RankRow[] {
  const rows: RankRow[] = core.teams
    .filter((t) => t.status === 'active')
    .map((t) => ({
      team: t,
      remaining: remainingOf(core.board, t),
      finalRoundCorrect: t.correctByRound[finalRound - 1] ?? 0,
    }));
  rows.sort(
    (a, b) => a.remaining - b.remaining || b.finalRoundCorrect - a.finalRoundCorrect || a.team.id - b.team.id,
  );
  return rows;
}

export interface TieGroup {
  rows: RankRow[];
  /** Number of qualification slots left when this group starts. */
  slotsAvailable: number;
  /** True when the slots cannot fit the whole group: needs sudden death. */
  needsSuddenDeath: boolean;
}

/**
 * Walk the fallback ranking and cut it into groups of exact ties. The first group that does not fit in
 * the remaining slots needs a sudden-death question; groups before it qualify outright.
 */
export function fallbackGroups(core: Core, finalRound: number): { auto: RankRow[][]; sudden: TieGroup | null } {
  const ranking = fallbackRanking(core, finalRound);
  let slots = maxSlots(core) - core.qualifiers.length;
  const auto: RankRow[][] = [];
  let i = 0;
  while (slots > 0 && i < ranking.length) {
    let j = i + 1;
    while (
      j < ranking.length &&
      ranking[j].remaining === ranking[i].remaining &&
      ranking[j].finalRoundCorrect === ranking[i].finalRoundCorrect
    ) {
      j++;
    }
    const group = ranking.slice(i, j);
    if (group.length <= slots) {
      auto.push(group);
      slots -= group.length;
      i = j;
    } else {
      return { auto, sudden: { rows: group, slotsAvailable: slots, needsSuddenDeath: true } };
    }
  }
  return { auto, sudden: null };
}

// ---------------------------------------------------------------- turn order

/** Full team-number order for a round: round r starts at offset 2·(r−1), wrapping around. */
export function roundOrder(teamCount: number, round: number): number[] {
  if (teamCount <= 0) return [];
  const start = (2 * (round - 1)) % teamCount;
  const out: number[] = [];
  for (let i = 0; i < teamCount; i++) out.push(((start + i) % teamCount) + 1);
  return out;
}
