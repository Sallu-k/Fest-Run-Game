// Monte-Carlo game simulator. Runs the *same* rules engine as the live game, driven by a
// modelled team (answers ~ configurable pmf/archetype, branch-choice policy) and accumulates raw
// counters. Works on ANY validated graph board, not just the classic 3-named-path shape: branch
// choices are resolved node-by-node via `board.succ`, and per-branch stats are tagged dynamically
// by each team's *first* branch decision of the game (a plain string node id) rather than a fixed
// A/B/C index, so a custom DAG's CHECK BALANCE report works the same way a classic board's does.

import { buildBoard } from '../core/board';
import {
  advance,
  canUseCard,
  fallbackRanking,
  hopTargets,
  isiTargets,
  makeTeam,
  maxSlots,
  qualifyTeam,
  resolveSpecial,
  roundOrder,
  useHop,
  useIsi,
} from '../core/engine';
import { Rng, mixSeed } from '../core/rng';
import { CARD_INDEX, Core, GameEvent, Pos, Team } from '../core/types';
import {
  SimConfig,
  SkillArchetype,
  branchOptionValue,
  cdfMean,
  drawPolicy,
  normalisePmf,
  quickProb,
  resolveArchetypes,
  sampleCdf,
  tiltedCdf,
} from './model';

/** Per-branch-option aggregate, keyed by the node id a team first diverged to. */
export interface BranchAgg {
  use: number;
  qual: number;
  cens: number;
  reach: number;
}

/** Per-archetype aggregate (all archetypes collapse to a single "average" entry when
 *  `SimConfig.archetypeMix` is unset — see `resolveArchetypes`). */
export interface ArchAgg {
  games: number;
  qual: number;
  censSum: number;
  reach: number;
  /** Qualifiers considered for the comeback baseline (see `comebackBaselineRound`). */
  compQ: number;
  /** Of those, teams that ranked outside the qualifying slots at the baseline round. */
  comebackQ: number;
}

function mkArchAgg(): ArchAgg {
  return { games: 0, qual: 0, censSum: 0, reach: 0, compQ: 0, comebackQ: 0 };
}

function mkBranchAgg(): BranchAgg {
  return { use: 0, qual: 0, cens: 0, reach: 0 };
}

export interface Acc {
  games: number;
  teamGames: number;
  /** [round] games whose last slot filled during that round (index 0 unused). */
  endCount: number[];
  fallbackGames: number;
  /** [round] real qualifiers who reached RX in that round. */
  qualRound: number[];
  /** Skill tercile sizes (0 = bottom, 1 = middle, 2 = top), by within-game theta rank. */
  tercTeams: number[];
  /** [tercile][round] teams that reached RX in that round (ghost mode: play continues to the last round). */
  reach: number[][];
  /** Sum over teams of min(finish round, R+1). */
  censSum: number[];
  qualTerc: number[];
  /** Dynamic per-first-branch-choice stats, keyed by node id (see module comment). */
  branch: Record<string, BranchAgg>;
  /** Dynamic per-skill-archetype stats, keyed by SkillArchetype (single "average" key when unset). */
  archetypes: Record<string, ArchAgg>;
  /** Node idx -> landings before the game ended. */
  nodeHit: number[];
  /** [chance, noise, booster] landings before the game ended. */
  typeHit: number[];
  chanceAsked: number;
  chanceRight: number;
  noiseAsked: number;
  noiseRight: number;
  cardGain: number[];
  cardDup: number[];
  cardUse: number[];
  cardBlocked: number[];
  isiSteps: number;
  hopGain: number;
  /** [card][tercile][held?1:0] team counts and qualifiers. */
  cardN: number[];
  cardQ: number[];
  posSum: number[];
  posN: number[];
  gapSum: number[];
  neighSum: number[];
  neighN: number[];
  /** Active-team pairs sharing the exact same node, summed per round (divided by neighN). */
  sameNodeSum: number[];
  /** Active-team pairs within `rules.isiRange` board spaces, summed per round. */
  isiRangeSum: number[];
  alive: number[];
  aliveN: number;
  clusterSum: number;
  clusterHigh: number;
  clusterN: number;
  compQ: number;
  comebackQ: number;
  bottomN: number;
  bottomQ: number;
  /** Games that reached the comeback-baseline round (was `r2Games`; see `comebackBaselineRound`). */
  baselineGames: number;
  /** Rounds actually played until the game ended (for turn-time estimates). */
  turnsPlayed: number;
}

export function newAcc(nNodes: number, rounds: number, teams: number): Acc {
  const z = (n: number) => new Array<number>(n).fill(0);
  return {
    games: 0,
    teamGames: 0,
    endCount: z(rounds + 1),
    fallbackGames: 0,
    qualRound: z(rounds + 1),
    tercTeams: z(3),
    reach: [z(rounds + 1), z(rounds + 1), z(rounds + 1)],
    censSum: z(3),
    qualTerc: z(3),
    branch: {},
    archetypes: {},
    nodeHit: z(nNodes),
    typeHit: z(3),
    chanceAsked: 0,
    chanceRight: 0,
    noiseAsked: 0,
    noiseRight: 0,
    cardGain: z(3),
    cardDup: z(3),
    cardUse: z(3),
    cardBlocked: z(3),
    isiSteps: 0,
    hopGain: 0,
    cardN: z(18),
    cardQ: z(18),
    posSum: z(rounds + 1),
    posN: z(rounds + 1),
    gapSum: z(rounds + 1),
    neighSum: z(rounds + 1),
    neighN: z(rounds + 1),
    sameNodeSum: z(rounds + 1),
    isiRangeSum: z(rounds + 1),
    alive: z(teams + 1),
    aliveN: 0,
    clusterSum: 0,
    clusterHigh: 0,
    clusterN: 0,
    compQ: 0,
    comebackQ: 0,
    bottomN: 0,
    bottomQ: 0,
    baselineGames: 0,
    turnsPlayed: 0,
  };
}

/** Merge one record's numeric leaves into another, growing keys as needed (used for the
 *  dynamically-keyed `branch`/`archetypes` maps — every other field is a plain number/array). */
function mergeRecord(a: Record<string, unknown> | undefined, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(a ?? {}) };
  for (const k of Object.keys(b)) {
    const bv = b[k];
    if (typeof bv === 'number') out[k] = ((out[k] as number) ?? 0) + bv;
    else if (bv && typeof bv === 'object') out[k] = mergeRecord(out[k] as Record<string, unknown> | undefined, bv as Record<string, unknown>);
  }
  return out;
}

/** Add `src` into `dst` (recursively over numbers / arrays / plain-object records). */
export function mergeAcc<T extends object>(dst: T, src: T): T {
  const d = dst as Record<string, unknown>;
  const s = src as Record<string, unknown>;
  for (const k of Object.keys(s)) {
    const a = d[k];
    const b = s[k];
    if (typeof b === 'number') d[k] = (a as number) + b;
    else if (Array.isArray(b)) {
      if (Array.isArray(b[0])) {
        (b as number[][]).forEach((row, i) => row.forEach((v, j) => ((a as number[][])[i][j] += v)));
      } else (b as number[]).forEach((v, i) => ((a as number[])[i] += v));
    } else if (b && typeof b === 'object') {
      d[k] = mergeRecord(a as Record<string, unknown> | undefined, b as Record<string, unknown>);
    }
  }
  return dst;
}

export interface BatchOptions {
  games: number;
  seed: number;
  /** Index of the first game (lets chunked runs reproduce a single long run exactly). */
  offset?: number;
  /** Every team picks uniformly at random among a branch node's options (removes strategy bias for
   *  path-parity measurement). */
  uniformRoutes?: boolean;
  onProgress?: (done: number) => void;
}

export function runBatch(cfg: SimConfig, opts: BatchOptions): Acc {
  const board = buildBoard(cfg.board);
  const N = cfg.teams;
  const R = cfg.rounds;
  const rules = { ...cfg.rules, winnerSlots: Math.min(cfg.rules.winnerSlots, N) };
  const nNodes = board.nodes.length;
  const acc = newAcc(nNodes, R, N);
  const uniform = !!opts.uniformRoutes;
  // Precompute the resolved archetype list once (pure config → deterministic); when `archetypeMix`
  // is unset this is exactly `[{archetype:'average', pmf: normalisePmf(cfg.pmf), share:1}]`, and the
  // draw below skips its rng.next() call in that case, so results stay byte-identical to the old
  // single-population model unless a mix is explicitly configured.
  const archs = resolveArchetypes(cfg).map((e) => ({ ...e, pmf: normalisePmf(e.pmf) }));
  // Reproduces today's round-2 baseline at R=4/5, scales sensibly for longer games.
  const baseRound = cfg.comebackBaselineRound ?? Math.max(2, Math.ceil(R / 3));

  const remOf = (id: string) => board.remaining[board.byId.get(id)!];

  const theta = new Float64Array(N);
  const terc = new Int8Array(N);
  const archTag: SkillArchetype[] = new Array(N);
  const cdfs: Float64Array[] = new Array(N);
  const qProb = new Float64Array(N);
  const hit = new Float64Array(N);
  const policy = new Int8Array(N);
  const finishRound = new Int8Array(N);
  const heldEver = new Uint8Array(N * 3);
  const realQual = new Uint8Array(N);
  const baseRank = new Int16Array(N);
  const firstBranchTag: (string | null)[] = new Array(N);
  const order = Array.from({ length: N }, (_, i) => i);

  for (let g = 0; g < opts.games; g++) {
    const rng = new Rng(mixSeed(opts.seed, (opts.offset ?? 0) + g));
    const teams: Team[] = [];
    for (let i = 0; i < N; i++) {
      teams.push(makeTeam(i + 1, `T${i + 1}`, '', '', board));
      let chosen = archs[0];
      if (archs.length > 1) {
        const u = rng.next();
        let accShare = 0;
        chosen = archs[archs.length - 1];
        for (const e of archs) {
          accShare += e.share;
          if (u < accShare) {
            chosen = e;
            break;
          }
        }
      }
      archTag[i] = chosen.archetype;
      theta[i] = rng.normal() * cfg.skillSigma;
      cdfs[i] = tiltedCdf(chosen.pmf, theta[i]);
      qProb[i] = quickProb(cfg, theta[i]);
      hit[i] = Math.min(0.6, 1 / Math.max(1, cdfMean(cdfs[i])));
      policy[i] = drawPolicy(cfg.policyMix, rng);
      finishRound[i] = 0;
      realQual[i] = 0;
      firstBranchTag[i] = null;
      heldEver[i * 3] = heldEver[i * 3 + 1] = heldEver[i * 3 + 2] = 0;
    }
    // skill terciles by rank of θ (within-game, cross-archetype — matches today's definition)
    order.sort((a, b) => theta[a] - theta[b]);
    for (let rank = 0; rank < N; rank++) terc[order[rank]] = Math.min(2, Math.floor((rank * 3) / N));
    for (let i = 0; i < N; i++) acc.tercTeams[terc[i]]++;

    const core: Core = { board, rules, teams, qualifiers: [], turnId: 0 };
    const maxS = maxSlots(core);
    let gameOver = false;
    let curRound = 1;
    let hasBaseline = false;
    let curTeam = 0;

    const conclude = (ids: number[]) => {
      // qualifier composition
      for (const id of ids) {
        realQual[id - 1] = 1;
        acc.qualTerc[terc[id - 1]]++;
      }
      if (hasBaseline) {
        acc.baselineGames++;
        const half = Math.ceil(N / 2);
        for (const id of ids) {
          acc.compQ++;
          const a = (acc.archetypes[archTag[id - 1]] ??= mkArchAgg());
          a.compQ++;
          if (baseRank[id - 1] >= maxS) {
            acc.comebackQ++;
            a.comebackQ++;
          }
          if (baseRank[id - 1] >= half) acc.bottomQ++;
        }
        acc.bottomN += N - half;
      }
      for (let i = 0; i < N; i++) {
        for (let c = 0; c < 3; c++) {
          const h = heldEver[i * 3 + c];
          const idx = (c * 3 + terc[i]) * 2 + h;
          acc.cardN[idx]++;
          if (realQual[i]) acc.cardQ[idx]++;
        }
      }
    };

    const emit = (e: GameEvent) => {
      switch (e.kind) {
        case 'qualify': {
          finishRound[e.team - 1] = curRound;
          if (!gameOver) {
            acc.qualRound[curRound]++;
            if (e.slot >= maxS) {
              gameOver = true;
              acc.endCount[curRound]++;
              let near = 0;
              for (const t of teams) if (remOf(t.node) <= 3) near++;
              acc.clusterSum += near;
              acc.clusterN++;
              if (near >= N - 1 && N > maxS) acc.clusterHigh++;
              conclude(core.qualifiers.slice(0, maxS));
            }
          }
          break;
        }
        case 'card-gain':
          if (!gameOver) {
            acc.cardGain[CARD_INDEX[e.card]]++;
            heldEver[(e.team - 1) * 3 + CARD_INDEX[e.card]] = 1;
          }
          break;
        case 'card-dup':
          if (!gameOver) acc.cardDup[CARD_INDEX[e.card]]++;
          break;
        case 'isi':
          if (!gameOver) {
            acc.cardUse[0]++;
            if (e.blocked) acc.cardBlocked[0]++;
            else acc.isiSteps += e.steps;
          }
          break;
        case 'hop':
          if (!gameOver) {
            acc.cardUse[1]++;
            if (e.blocked) acc.cardBlocked[1]++;
          }
          break;
        case 'orth':
          if (!gameOver) acc.cardUse[2]++;
          break;
        default:
          break;
      }
    };

    // A team's branch-node decision. Generalizes the old fixed 3-route lookup to any DAG: at any node
    // with >1 successor, `policy[curTeam]` picks how the option is evaluated (shortest-remaining /
    // uniform-random / one-decision-ahead `branchOptionValue`). The *first* decision made this game is
    // recorded as the team's branch tag for the dynamic per-branch report.
    const choose = (_node: string, options: string[]): string | null => {
      let pick: string;
      if (uniform) {
        pick = options[rng.int(options.length)];
      } else {
        const pol = policy[curTeam];
        if (pol === 1) {
          let best = options[0];
          let bv = Infinity;
          for (const o of options) {
            const v = remOf(o);
            if (v < bv) {
              bv = v;
              best = o;
            }
          }
          pick = best;
        } else if (pol === 2) {
          pick = options[rng.int(options.length)];
        } else {
          let best = options[0];
          let bv = Infinity;
          for (const o of options) {
            const v = branchOptionValue(board, rules, o, cfg, hit[curTeam], qProb[curTeam]) + rng.normal() * cfg.routeNoise;
            if (v < bv) {
              bv = v;
              best = o;
            }
          }
          pick = best;
        }
      }
      if (firstBranchTag[curTeam] == null) firstBranchTag[curTeam] = pick;
      return pick;
    };

    const tryCard = (t: Team) => {
      const myRem = remOf(t.node);
      const last = curRound === R;
      if (canUseCard(core, t, 'hop')) {
        let best: ReturnType<typeof hopTargets>[number] | null = null;
        let bestGain = -99;
        for (const x of hopTargets(core, t)) {
          if (x.shielded) continue;
          const gain = myRem - remOf(x.team.node);
          if (gain > bestGain) {
            bestGain = gain;
            best = x;
          }
        }
        if (best && (bestGain >= cfg.hopGainThreshold || (last && bestGain >= 2))) {
          if (!gameOver) acc.hopGain += bestGain;
          useHop(core, t, best.team, false, emit);
          return;
        }
      }
      if (canUseCard(core, t, 'isi')) {
        let best: ReturnType<typeof isiTargets>[number] | null = null;
        let bestRem = 1e9;
        const slack = last ? 2 : 1;
        for (const x of isiTargets(core, t)) {
          if (x.shielded) continue;
          const rem = remOf(x.team.node);
          if (rem <= myRem + slack && rem < bestRem) {
            bestRem = rem;
            best = x;
          }
        }
        if (best && rng.next() < cfg.isiUseProb) useIsi(core, t, best.team, false, emit);
      }
    };

    for (let round = 1; round <= R; round++) {
      curRound = round;
      for (const id of roundOrder(N, round)) {
        const t = teams[id - 1];
        if (t.status !== 'active') continue;
        core.turnId++;
        curTeam = id - 1;
        const k = sampleCdf(cdfs[curTeam], rng.next());
        t.correctByRound[round - 1] = k;
        t.totalCorrect += k;
        if (!gameOver) acc.turnsPlayed++;
        const pos: Pos = { node: t.node, trail: t.trail };
        const res = advance(board, pos, k, choose);
        t.node = pos.node;
        t.trail = pos.trail;
        if (res.reachedRx) {
          qualifyTeam(core, t, emit);
          continue;
        }
        const nIdx = board.byId.get(t.node)!;
        const sp = board.nodes[nIdx].special;
        if (sp) {
          if (!gameOver) {
            acc.nodeHit[nIdx]++;
            acc.typeHit[sp.type === 'chance' ? 0 : sp.type === 'noise' ? 1 : 2]++;
          }
          let correct = true;
          if (sp.type !== 'booster') {
            correct = rng.next() < qProb[curTeam];
            if (!gameOver) {
              if (sp.type === 'chance') {
                acc.chanceAsked++;
                if (correct) acc.chanceRight++;
              } else {
                acc.noiseAsked++;
                if (correct) acc.noiseRight++;
              }
            }
          }
          resolveSpecial(core, t, correct, emit);
        }
        if (t.status === 'active') tryCard(t);
      }

      // ---- end-of-round snapshots (only while the real game is still running)
      if (!gameOver) {
        let sum = 0;
        let lo = 1e9;
        let hi = -1;
        for (const t of teams) {
          const rem = remOf(t.node);
          sum += rem;
          if (rem < lo) lo = rem;
          if (rem > hi) hi = rem;
        }
        acc.posSum[round] += sum / N;
        acc.gapSum[round] += hi - lo;
        acc.posN[round]++;
        let neigh = 0;
        let sameNode = 0;
        let isiRangePairs = 0;
        let nAct = 0;
        for (const a of teams) {
          if (a.status !== 'active') continue;
          nAct++;
          const ai = board.byId.get(a.node)!;
          for (const b of teams) {
            if (b === a || b.status !== 'active') continue;
            const bi = board.byId.get(b.node)!;
            const d = board.dist[ai * nNodes + bi];
            if (d >= 0 && d <= 3) neigh++;
            if (a.node === b.node) sameNode++;
            if (d >= 0 && d <= rules.isiRange) isiRangePairs++;
          }
        }
        if (nAct >= 2) {
          acc.neighSum[round] += neigh / nAct;
          acc.neighN[round]++;
        }
        acc.sameNodeSum[round] += sameNode / 2;
        acc.isiRangeSum[round] += isiRangePairs / 2;
        if (round === baseRound) {
          const ranked = [...teams].sort((a, b) => remOf(a.node) - remOf(b.node) || a.id - b.id);
          ranked.forEach((t, i) => (baseRank[t.id - 1] = i));
          hasBaseline = true;
        }
        if (round === R - 1) {
          let alive = core.qualifiers.length;
          for (const t of teams) if (t.status === 'active' && remOf(t.node) <= cfg.aliveRadius) alive++;
          acc.alive[Math.min(N, alive)]++;
          acc.aliveN++;
        }
      }
    }

    if (!gameOver) {
      acc.fallbackGames++;
      const need = maxS - core.qualifiers.length;
      const ranking = fallbackRanking(core, R);
      const ids = core.qualifiers.slice();
      for (let i = 0; i < need && i < ranking.length; i++) ids.push(ranking[i].team.id);
      curRound = R;
      conclude(ids);
    }

    // ---- per-team tallies
    for (let i = 0; i < N; i++) {
      const fr = finishRound[i];
      const cens = fr > 0 ? fr : R + 1;
      acc.censSum[terc[i]] += cens;
      if (fr > 0) acc.reach[terc[i]][fr]++;
      acc.teamGames++;

      const a = (acc.archetypes[archTag[i]] ??= mkArchAgg());
      a.games++;
      a.censSum += cens;
      if (fr > 0) a.reach++;
      if (realQual[i]) a.qual++;

      const tag = firstBranchTag[i];
      if (tag != null) {
        const b = (acc.branch[tag] ??= mkBranchAgg());
        b.use++;
        b.cens += cens;
        if (fr > 0) b.reach++;
        if (realQual[i]) b.qual++;
      }
    }
    acc.games++;
    if (opts.onProgress && (g + 1) % 2000 === 0) opts.onProgress(g + 1);
  }
  return acc;
}
