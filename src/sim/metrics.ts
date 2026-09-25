// Turns raw simulator counters into a Report, and scores a Report against balance targets.
//
// `routes`/`BranchRow` generalizes from a fixed A/B/C route table to a dynamically-keyed list, one
// row per distinct first-branch-choice node id that showed up in the batch (see simulate.ts's module
// comment) — works the same way for the classic 3-path board and for an arbitrary custom graph.

import { Board, CARD_TYPES, CardType, SpecialType } from '../core/types';
import { SkillArchetype } from './model';
import { SimConfig } from './model';
import { Acc } from './simulate';

export interface BranchRow {
  /** The node id a team first diverged to (the branch tag). */
  id: string;
  /** Cosmetic label: `id` with any trailing digits stripped (so classic 'A1' → 'A'); falls back to `id`.
   *  Optional only so reports generated before this field existed keep typechecking — always set on a
   *  freshly-built report (see `rowsFrom`); read as `row.label ?? row.id`. */
  label?: string;
  /** Approximate TX→RX path length through this option (shortest-path estimate; exact for a single
   *  unbranched lane, an estimate if the option itself leads through further forks). */
  length: number;
  /** Share of team-games that first diverged to this option. */
  usage: number;
  /** P(team qualifies | team's first branch choice was this option). */
  qualifyRate: number;
  /** Mean finish round, censored at rounds+1 for teams that never reached RX. */
  meanFinish: number;
  /** P(team reaches RX within the round limit) — ghost mode (play continues after the game ends). */
  reachRate: number;
  /** Number of specials of each type on this option's exclusive lane (walked until the next fork/merge/RX). */
  specialsOnBranch: { chance: number; noise: number; booster: number };
}

export interface NodeHit {
  id: string;
  type: SpecialType;
  card?: CardType;
  /** Fraction of team-games in which a team landed here (before the game ended). */
  hitRate: number;
}

export interface CardRow {
  card: CardType;
  /** Cards earned per team per game. */
  gainedPerTeam: number;
  /** Probability a team earns this card during a game. */
  gainRate: number;
  usedPerTeam: number;
  blockedShare: number;
  /** Qualify-rate lift of teams that earned the card vs matched (same skill tercile) teams that did not. */
  uplift: number;
}

export interface ArchetypeRow {
  archetype: SkillArchetype;
  share: number;
  qualifyRate: number;
  meanFinish: number;
  /** Comeback rate within this archetype (see Report.comeback). */
  comebackShare: number;
}

export interface Report {
  meta: { games: number; parityGames: number; teams: number; rounds: number; slots: number; seed: number };
  finish: {
    meanQualRound: number;
    medianQualRound: number;
    /** P(all slots filled by the end of round r), r = 1..rounds */
    endByRound: number[];
    fallbackPct: number;
    /** Share of games that would still need fallback if the game were played to 4 rounds only. */
    fallback4Pct: number;
    /** Qualifiers per round (share of all qualifiers) */
    qualRoundShare: number[];
    /** Share of games decided 2+ rounds before the final round ("5-qualify-early").
     *  Optional only so reports generated before this field existed keep typechecking. */
    qualifyEarlyPct?: number;
  };
  avgTeam: { reachByRound: number[]; meanFinish: number };
  terciles: { qualifyRate: number[]; reachRate: number[] };
  /** Optional per-archetype breakdown — present whenever `SimConfig.archetypeMix` was set. */
  archetypes?: ArchetypeRow[];
  routes: BranchRow[];
  parity: BranchRow[];
  parityGap: { qualifyPp: number; finishRounds: number; slowest: string; fastest: string };
  nodes: NodeHit[];
  perTeam: { chance: number; noise: number; booster: number };
  quick: { chanceCorrect: number; noiseCorrect: number };
  cards: CardRow[];
  isiStepsPerTeam: number;
  hopGainAvg: number;
  rounds: {
    avgRemaining: number[];
    gap: number[];
    neighbors: number[];
    stillRunning: number[];
    /** Active-team pairs sharing the exact same node, averaged per round. Optional only so reports
     *  generated before this field existed keep typechecking. */
    sameNode?: number[];
    /** Active-team pairs within `rules.isiRange`, averaged per round. Optional for the same reason. */
    isiRangeNear?: number[];
  };
  alive: { mean: number; pBelowSlots: number };
  cluster: { meanNearRx: number; pAllNear: number };
  comeback: { share: number; bottomHalfQualify: number };
}

/** Walk the exclusive lane starting at `start` (until the next branch/merge point or RX), tallying
 *  specials met along the way — the same "one straight run" walk `branchOptionValue` uses. */
function specialsOnLane(board: Board, start: string): { chance: number; noise: number; booster: number } {
  const on = { chance: 0, noise: 0, booster: 0 };
  let cur = start;
  const rxId = board.idOf[board.rx];
  for (let guard = 0; guard < 500; guard++) {
    const idx = board.byId.get(cur)!;
    const n = board.nodes[idx];
    if (n.special) on[n.special.type]++;
    if (cur === rxId) break;
    const succs = board.succ[cur];
    if (succs.length !== 1) break;
    cur = succs[0];
  }
  return on;
}

function laneLabel(id: string): string {
  const stripped = id.replace(/\d+$/, '');
  return stripped || id;
}

function rowsFrom(acc: Acc, board: Board, rounds: number): BranchRow[] {
  const total = Object.values(acc.branch).reduce((s, b) => s + b.use, 0) || 1;
  const n = board.nodes.length;
  const txIdx = board.tx;
  return Object.entries(acc.branch)
    .map(([id, b]) => {
      const idx = board.byId.get(id);
      const length = idx != null ? board.dist[txIdx * n + idx] + board.remaining[idx] : rounds + 1;
      return {
        id,
        label: laneLabel(id),
        length,
        usage: b.use / total,
        qualifyRate: b.use ? b.qual / b.use : 0,
        meanFinish: b.use ? b.cens / b.use : rounds + 1,
        reachRate: b.use ? b.reach / b.use : 0,
        specialsOnBranch: specialsOnLane(board, id),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

const div = (a: number, b: number) => (b > 0 ? a / b : 0);

export function finalizeReport(
  acc: Acc,
  parityAcc: Acc | null,
  cfg: SimConfig,
  board: Board,
  seed: number,
): Report {
  const R: number = cfg.rounds;
  const G = acc.games;
  const slots = Math.min(cfg.rules.winnerSlots, cfg.teams);

  // ---- finish
  const endByRound: number[] = [];
  let cum = 0;
  for (let r = 1; r <= R; r++) {
    cum += acc.endCount[r];
    endByRound.push(div(cum, G));
  }
  const qTotal = acc.qualRound.reduce((a, b) => a + b, 0);
  let meanQ = 0;
  for (let r = 1; r <= R; r++) meanQ += r * acc.qualRound[r];
  meanQ = div(meanQ, qTotal);
  let medianQ = R;
  let c2 = 0;
  for (let r = 1; r <= R; r++) {
    c2 += acc.qualRound[r];
    if (c2 >= qTotal / 2) {
      medianQ = r;
      break;
    }
  }
  const p4 = R >= 4 ? endByRound[3] : endByRound[R - 1];
  const earlyIdx = Math.max(0, R - 3); // decided 2+ rounds before the end
  const qualifyEarlyPct = endByRound[earlyIdx];

  // ---- terciles
  const reachByRound = (t: number) => {
    const out: number[] = [];
    let s = 0;
    for (let r = 1; r <= R; r++) {
      s += acc.reach[t][r];
      out.push(div(s, acc.tercTeams[t]));
    }
    return out;
  };
  const midReach = reachByRound(1);

  // ---- routes / branches
  const routes = rowsFrom(acc, board, R);
  const parity = parityAcc ? rowsFrom(parityAcc, board, R) : routes;
  const qs = parity.map((p) => p.qualifyRate);
  const fs = parity.map((p) => p.meanFinish);
  const slowest = parity.length ? parity[fs.indexOf(Math.max(...fs))].id : '';
  const fastest = parity.length ? parity[fs.indexOf(Math.min(...fs))].id : '';

  // ---- archetypes (only when more than the implicit single "average" entry was recorded)
  const archEntries = Object.entries(acc.archetypes);
  const archetypes: ArchetypeRow[] | undefined =
    archEntries.length > 1
      ? archEntries.map(([archetype, a]) => ({
          archetype: archetype as SkillArchetype,
          share: div(a.games, acc.teamGames || 1),
          qualifyRate: div(a.qual, a.games),
          meanFinish: div(a.censSum, a.games),
          comebackShare: div(a.comebackQ, a.compQ),
        }))
      : undefined;

  // ---- specials
  const tg = acc.teamGames || 1;
  const nodes: NodeHit[] = [];
  for (const n of board.nodes) {
    if (n.special) nodes.push({ id: n.id, type: n.special.type, card: n.special.card, hitRate: acc.nodeHit[n.idx] / tg });
  }

  // ---- cards
  const cards: CardRow[] = CARD_TYPES.map((card, c) => {
    let num = 0;
    let wsum = 0;
    for (let t = 0; t < 3; t++) {
      const nH = acc.cardN[(c * 3 + t) * 2 + 1];
      const nN = acc.cardN[(c * 3 + t) * 2];
      if (nH > 0 && nN > 0) {
        const lift = acc.cardQ[(c * 3 + t) * 2 + 1] / nH - acc.cardQ[(c * 3 + t) * 2] / nN;
        num += lift * (nH + nN);
        wsum += nH + nN;
      }
    }
    const held = acc.cardN[c * 6 + 1] + acc.cardN[c * 6 + 3] + acc.cardN[c * 6 + 5];
    const all = acc.cardN[c * 6] + acc.cardN[c * 6 + 2] + acc.cardN[c * 6 + 4] + held;
    return {
      card,
      gainedPerTeam: acc.cardGain[c] / tg,
      gainRate: div(held, all),
      usedPerTeam: acc.cardUse[c] / tg,
      blockedShare: c < 2 ? div(acc.cardBlocked[c], acc.cardUse[c]) : 0,
      uplift: div(num, wsum),
    };
  });

  const alive = acc.alive.reduce((s, v, i) => s + i * v, 0);
  let below = 0;
  for (let i = 0; i < slots; i++) below += acc.alive[i] || 0;

  return {
    meta: { games: G, parityGames: parityAcc?.games ?? 0, teams: cfg.teams, rounds: R, slots, seed },
    finish: {
      meanQualRound: meanQ,
      medianQualRound: medianQ,
      endByRound,
      fallbackPct: div(acc.fallbackGames, G),
      fallback4Pct: 1 - p4,
      qualRoundShare: acc.qualRound.slice(1).map((v) => div(v, qTotal)),
      qualifyEarlyPct,
    },
    avgTeam: { reachByRound: midReach, meanFinish: div(acc.censSum[1], acc.tercTeams[1]) },
    terciles: {
      qualifyRate: [0, 1, 2].map((t) => div(acc.qualTerc[t], acc.tercTeams[t])),
      reachRate: [0, 1, 2].map((t) => reachByRound(t)[R - 1]),
    },
    archetypes,
    routes,
    parity,
    parityGap: {
      qualifyPp: (Math.max(...qs, 0) - Math.min(...qs, 0)) * 100,
      finishRounds: fs.length ? Math.max(...fs) - Math.min(...fs) : 0,
      slowest,
      fastest,
    },
    nodes,
    perTeam: { chance: acc.typeHit[0] / tg, noise: acc.typeHit[1] / tg, booster: acc.typeHit[2] / tg },
    quick: { chanceCorrect: div(acc.chanceRight, acc.chanceAsked), noiseCorrect: div(acc.noiseRight, acc.noiseAsked) },
    cards,
    isiStepsPerTeam: acc.isiSteps / tg,
    hopGainAvg: div(acc.hopGain, acc.cardUse[1] - acc.cardBlocked[1]),
    rounds: {
      avgRemaining: Array.from({ length: R }, (_, i) => div(acc.posSum[i + 1], acc.posN[i + 1])),
      gap: Array.from({ length: R }, (_, i) => div(acc.gapSum[i + 1], acc.posN[i + 1])),
      neighbors: Array.from({ length: R }, (_, i) => div(acc.neighSum[i + 1], acc.neighN[i + 1])),
      stillRunning: Array.from({ length: R }, (_, i) => div(acc.posN[i + 1], G)),
      sameNode: Array.from({ length: R }, (_, i) => div(acc.sameNodeSum[i + 1], acc.posN[i + 1])),
      isiRangeNear: Array.from({ length: R }, (_, i) => div(acc.isiRangeSum[i + 1], acc.posN[i + 1])),
    },
    alive: { mean: div(alive, acc.aliveN), pBelowSlots: div(below, acc.aliveN) },
    cluster: { meanNearRx: div(acc.clusterSum, acc.clusterN), pAllNear: div(acc.clusterHigh, acc.clusterN) },
    comeback: { share: div(acc.comebackQ, acc.compQ), bottomHalfQualify: div(acc.bottomQ, acc.bottomN) },
  };
}

// ------------------------------------------------------------------ targets & scoring

export interface Band {
  label: string;
  lo: number;
  hi: number;
  weight: number;
  /** Normalising scale for the violation. */
  scale: number;
  /** Display unit hint */
  unit?: 'pct' | 'num' | 'pp' | 'rounds';
}

export type ObjectiveTargets = Record<string, Band>;

export const DEFAULT_TARGETS: ObjectiveTargets = {
  parityQualGapPp: { label: 'Path parity: qualify-rate gap (pp)', lo: 0, hi: 5, weight: 6, scale: 5, unit: 'pp' },
  parityFinishGap: { label: 'Path parity: mean-finish gap (rounds)', lo: 0, hi: 0.3, weight: 5, scale: 0.3, unit: 'rounds' },
  maxUsage: { label: 'Busiest path share', lo: 0, hi: 0.55, weight: 2, scale: 0.1, unit: 'pct' },
  minUsage: { label: 'Quietest path share', lo: 0.15, hi: 1, weight: 3, scale: 0.1, unit: 'pct' },
  avgReachFinal: { label: 'Average team reaches RX by last round', lo: 0.6, hi: 0.9, weight: 3, scale: 0.1, unit: 'pct' },
  avgReach4: { label: 'Average team reaches RX by round 4', lo: 0.15, hi: 0.5, weight: 2, scale: 0.1, unit: 'pct' },
  endByFinal: { label: 'Game decided without fallback (last round)', lo: 0.85, hi: 1, weight: 3, scale: 0.1, unit: 'pct' },
  endBy4: { label: 'Game decided by round 4', lo: 0.15, hi: 0.6, weight: 1.5, scale: 0.1, unit: 'pct' },
  topQual: { label: 'Top-skill third qualifies', lo: 0.6, hi: 0.88, weight: 2, scale: 0.1, unit: 'pct' },
  bottomQual: { label: 'Bottom-skill third qualifies', lo: 0.08, hi: 0.3, weight: 2, scale: 0.1, unit: 'pct' },
  comeback: { label: 'Qualifiers from outside top-N after the baseline round', lo: 0.15, hi: 0.45, weight: 2, scale: 0.1, unit: 'pct' },
  isiSteps: { label: 'Spaces lost to ISI per team', lo: 0.25, hi: 1.5, weight: 4, scale: 0.4, unit: 'num' },
  cardsPerTeam: { label: 'Cards earned per team per game', lo: 0.35, hi: 1.1, weight: 3, scale: 0.2, unit: 'num' },
  minCardGain: { label: 'Rarest card: share of teams that earn it', lo: 0.07, hi: 1, weight: 2, scale: 0.04, unit: 'pct' },
  maxCardUplift: { label: 'Strongest card qualify uplift', lo: 0, hi: 0.12, weight: 2, scale: 0.05, unit: 'pct' },
  minSpecialHit: { label: 'Least-reached special (hit rate)', lo: 0.08, hi: 1, weight: 2, scale: 0.05, unit: 'pct' },
  boosterPerTeam: { label: 'Booster landings per team', lo: 0.25, hi: 0.9, weight: 1.5, scale: 0.2, unit: 'num' },
  gapMid: { label: 'Gap 1st–last team (mid game, spaces)', lo: 5, hi: 11, weight: 1.5, scale: 3, unit: 'num' },
  neighborsMid: { label: 'Teams within 3 spaces (mid game)', lo: 1.0, hi: 4.0, weight: 1.5, scale: 1, unit: 'num' },
  aliveLow: { label: 'Games with < slots contenders before last round', lo: 0, hi: 0.2, weight: 1.5, scale: 0.1, unit: 'pct' },
  clusterAll: { label: 'Games ending with ~all teams beside RX', lo: 0, hi: 0.2, weight: 0.7, scale: 0.05, unit: 'pct' },
};

export function metricValues(r: Report): Record<string, number> {
  const R = r.meta.rounds;
  const mid = Math.min(R - 1, 3) - 1; // index of round 3 (or R-1)
  return {
    parityQualGapPp: r.parityGap.qualifyPp,
    parityFinishGap: r.parityGap.finishRounds,
    maxUsage: r.routes.length ? Math.max(...r.routes.map((x) => x.usage)) : 0,
    minUsage: r.routes.length ? Math.min(...r.routes.map((x) => x.usage)) : 0,
    avgReachFinal: r.avgTeam.reachByRound[R - 1],
    avgReach4: r.avgTeam.reachByRound[Math.min(3, R - 1)],
    endByFinal: r.finish.endByRound[R - 1],
    endBy4: r.finish.endByRound[Math.min(3, R - 1)],
    topQual: r.terciles.qualifyRate[2],
    bottomQual: r.terciles.qualifyRate[0],
    comeback: r.comeback.share,
    isiSteps: r.isiStepsPerTeam,
    cardsPerTeam: r.cards.reduce((a, c) => a + c.gainedPerTeam, 0),
    minCardGain: Math.min(...r.cards.map((c) => c.gainRate)),
    maxCardUplift: Math.max(...r.cards.map((c) => c.uplift)),
    minSpecialHit: r.nodes.length ? Math.min(...r.nodes.map((n) => n.hitRate)) : 0,
    boosterPerTeam: r.perTeam.booster,
    gapMid: r.rounds.gap[mid],
    neighborsMid: r.rounds.neighbors[mid],
    aliveLow: r.alive.pBelowSlots,
    clusterAll: r.cluster.pAllNear,
  };
}

export interface ScoreLine {
  key: string;
  label: string;
  value: number;
  lo: number;
  hi: number;
  penalty: number;
  ok: boolean;
  unit?: Band['unit'];
}

export function scoreReport(r: Report, targets: ObjectiveTargets = DEFAULT_TARGETS): { score: number; lines: ScoreLine[] } {
  const vals = metricValues(r);
  let score = 0;
  const lines: ScoreLine[] = [];
  for (const [key, b] of Object.entries(targets)) {
    const v = vals[key];
    const viol = Math.max(0, b.lo - v, v - b.hi);
    const penalty = (b.weight * viol) / b.scale;
    // gentle quadratic growth so one huge miss dominates many small ones
    score += penalty * (1 + Math.min(3, viol / b.scale) * 0.5);
    lines.push({ key, label: b.label, value: v, lo: b.lo, hi: b.hi, penalty, ok: viol === 0, unit: b.unit });
  }
  return { score, lines };
}
