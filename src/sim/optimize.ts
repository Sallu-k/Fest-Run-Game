// Layout search: generate → screen → refine → confirm at ≥100k games.
// Runs unchanged in Node (CLI, with a worker-thread pool) and in the browser (Balancer, in a Web Worker).
//
// The structural search stays scoped to the classic (single fork → 3 named branches → single merge)
// shape — see core/classicBoard.ts's module comment for why. Candidate.board is a ClassicBoardConfig;
// it is compiled to the general graph BoardConfig only at the point a game is actually simulated
// (simFor() in scripts/optimize.ts / src/ui/Balancer.tsx).

import { buildBoard } from '../core/board';
import { ClassicBoardConfig, RouteId, ROUTE_IDS, SpecialPlacement, compileClassicBoard } from '../core/classicBoard';
import { specialAmount } from '../core/engine';
import { Rng } from '../core/rng';
import { CARD_TYPES, CardType, RulesConfig } from '../core/types';
import { BOOSTER_MIN_REMAINING_AFTER, MAX_BOOSTER, MIN_BRANCH_POS, layoutProblems } from './constraints';
import { Report, ObjectiveTargets, DEFAULT_TARGETS, scoreReport } from './metrics';

export interface Candidate {
  label: string;
  board: ClassicBoardConfig;
  rules: RulesConfig;
}

export interface EvalJob {
  cand: Candidate;
  games: number;
  seed: number;
}

export interface Evaluated {
  cand: Candidate;
  report: Report;
  score: number;
  games: number;
}

/**
 * Small preference for the brief's starting design (3 Chance, 2 Noise, ≤2 Booster, ISI range 3,
 * "swap with any team") so that ties are broken towards rules that are easy to teach.
 */
export function simplicityPenalty(c: Candidate): number {
  const n = (t: string) => c.board.specials.filter((s) => s.type === t).length;
  let pen = 0;
  pen += 1.5 * Math.abs(n('chance') - 3);
  pen += 0.6 * Math.abs(n('noise') - 2);
  pen += 1.0 * Math.max(0, n('booster') - 2);
  pen += 0.5 * c.board.specials.filter((s) => s.amount != null).length;
  pen += c.rules.hopMaxRange != null ? 1.0 : 0;
  pen += c.rules.isiRange !== 3 ? 0.3 : 0;
  return pen;
}

export type Evaluator = (jobs: EvalJob[]) => Promise<Report[]>;

export interface SearchSpace {
  prefix: number[];
  suffix: number[];
  chance: number[];
  noise: number[];
  booster: number[];
  /** Global booster strength (spaces forward). */
  boosterAmount: number[];
  /** Global noise penalty (spaces back). */
  noiseBack: number[];
  isiRange: number[];
  hopMaxRange: (number | null)[];
  /** Allow per-space booster/noise strengths (off by default: one strength each is easier to teach). */
  perSpaceAmounts: boolean;
}

export const DEFAULT_SPACE: SearchSpace = {
  prefix: [2, 3, 4, 5],
  suffix: [1, 2, 3, 4],
  chance: [3],
  noise: [1, 2, 3],
  booster: [1, 2, 3, 4],
  boosterAmount: [3, 4, 5],
  noiseBack: [2, 3],
  isiRange: [2, 3, 4],
  hopMaxRange: [null, 8, 6],
  perSpaceAmounts: false,
};

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function candidateProblems(c: Candidate): string[] {
  try {
    return layoutProblems(buildBoard(compileClassicBoard(c.board)), c.rules);
  } catch (e) {
    return [(e as Error).message];
  }
}

/** All node ids where a special may legally sit for a given structure. */
function nodePool(prefix: number, suffix: number, cfgLengths: ClassicBoardConfig['routeLengths']): string[] {
  const ids: string[] = [];
  ROUTE_IDS.forEach((r) => {
    const b = cfgLengths[r] - prefix - suffix - 1;
    for (let j = MIN_BRANCH_POS; j <= b; j++) ids.push(`${r}${j}`);
  });
  for (let k = 1; k <= suffix; k++) ids.push(`M${k}`);
  // shared start: Chance only, never S1 or the junction (see constraints.ts)
  for (let i = 2; i < prefix; i++) ids.push(`S${i}`);
  return ids;
}

function tryRandomLayout(rng: Rng, space: SearchSpace, base: ClassicBoardConfig, rules: RulesConfig): Candidate | null {
  const prefix = rng.pick(space.prefix);
  const suffix = rng.pick(space.suffix);
  const nCh = rng.pick(space.chance);
  const nNo = rng.pick(space.noise);
  const nBo = rng.pick(space.booster);
  const pool = nodePool(prefix, suffix, base.routeLengths);
  const cards = [...CARD_TYPES].sort(() => rng.next() - 0.5);
  const specials: SpecialPlacement[] = [];
  const used = new Set<string>();
  const place = (build: (node: string) => SpecialPlacement, branchOnly = false) => {
    for (let t = 0; t < 40; t++) {
      const node = rng.pick(pool);
      if (used.has(node)) continue;
      if (branchOnly && !/^[ABC]\d+$/.test(node)) continue;
      used.add(node);
      specials.push(build(node));
      return true;
    }
    return false;
  };
  for (let i = 0; i < nCh; i++) place((node) => ({ node, type: 'chance', card: cards[i % 3] }));
  for (let i = 0; i < nNo; i++) place((node) => ({ node, type: 'noise' }), true);
  for (let i = 0; i < nBo; i++) place((node) => ({ node, type: 'booster' }), true);
  const cand: Candidate = {
    label: 'random',
    board: { name: 'random', routeLengths: { ...base.routeLengths }, prefixLen: prefix, suffixLen: suffix, specials },
    rules: {
      ...rules,
      isiRange: rng.pick(space.isiRange),
      boosterAmount: rng.pick(space.boosterAmount),
      noiseBack: rng.pick(space.noiseBack),
      hopMaxRange: rng.pick(space.hopMaxRange),
    },
  };
  return candidateProblems(cand).length === 0 ? cand : null;
}

export function randomCandidate(rng: Rng, space: SearchSpace, base: ClassicBoardConfig, rules: RulesConfig): Candidate {
  for (let i = 0; i < 2000; i++) {
    const c = tryRandomLayout(rng, space, base, rules);
    if (c) return c;
  }
  throw new Error('Could not generate a valid random layout — search space too tight.');
}

/** Small random change to a candidate. Returns null when the mutant violates the placement rules. */
export function mutate(c: Candidate, rng: Rng, space: SearchSpace): Candidate | null {
  const n = clone(c) as Candidate;
  n.label = 'mutant';
  const b = n.board;
  const r = rng.next();
  const pool = nodePool(b.prefixLen, b.suffixLen, b.routeLengths);
  const used = new Set(b.specials.map((s) => s.node));
  const idxOf = (id: string) => b.specials.findIndex((s) => s.node === id);
  if (r < 0.45 && b.specials.length) {
    // move one special (locally most of the time)
    const s = rng.pick(b.specials);
    let target: string | null = null;
    if (rng.next() < 0.7 && /^[ABC]\d+$/.test(s.node)) {
      const route = s.node[0];
      const j = Number(s.node.slice(1)) + (rng.int(5) - 2);
      target = `${route}${j}`;
    } else target = rng.pick(pool);
    if (!pool.includes(target) || used.has(target)) return null;
    s.node = target;
  } else if (r < 0.6) {
    // change a global rule strength
    const w = rng.int(4);
    if (w === 0) n.rules.boosterAmount = rng.pick(space.boosterAmount);
    else if (w === 1) n.rules.noiseBack = rng.pick(space.noiseBack);
    else if (w === 2) n.rules.hopMaxRange = rng.pick(space.hopMaxRange);
    else n.rules.isiRange = rng.pick(space.isiRange);
  } else if (r < 0.7) {
    // swap card assignment between two chance spaces, or reassign one
    const ch = b.specials.filter((s) => s.type === 'chance');
    if (!ch.length) return null;
    if (ch.length >= 2 && rng.next() < 0.7) {
      const [a, d] = [rng.pick(ch), rng.pick(ch)];
      const t = a.card;
      a.card = d.card;
      d.card = t;
    } else rng.pick(ch).card = rng.pick(CARD_TYPES) as CardType;
  } else if (r < 0.8) {
    // retype one special
    const s = rng.pick(b.specials);
    const to = rng.pick(['chance', 'noise', 'booster'] as const);
    if (to === s.type) return null;
    s.type = to;
    if (to === 'chance') s.card = rng.pick(CARD_TYPES) as CardType;
    else delete s.card;
    delete s.amount;
    if (!/^[ABC]\d+$/.test(s.node) && to !== 'chance') return null;
  } else if (r < 0.88) {
    // add or remove
    const count = (t: string) => b.specials.filter((s) => s.type === t).length;
    if (rng.next() < 0.5) {
      const type = rng.pick(['noise', 'booster'] as const);
      const max = Math.max(...(type === 'noise' ? space.noise : space.booster));
      if (count(type) >= max) return null;
      const node = rng.pick(pool);
      if (used.has(node) || !/^[ABC]\d+$/.test(node)) return null;
      b.specials.push({ node, type });
    } else {
      const type = rng.pick(['noise', 'booster'] as const);
      const min = Math.min(...(type === 'noise' ? space.noise : space.booster));
      if (count(type) <= min) return null;
      const list = b.specials.filter((s) => s.type === type);
      b.specials.splice(idxOf(rng.pick(list).node), 1);
    }
  } else if (r < 0.95) {
    // restructure: prefix / suffix, remapping by branch position
    const newP = rng.pick(space.prefix);
    const newS = rng.pick(space.suffix);
    if (newP === b.prefixLen && newS === b.suffixLen) return null;
    const nb: SpecialPlacement[] = [];
    const taken = new Set<string>();
    const branchRe = /^([ABC])(\d+)$/;
    for (const s of b.specials) {
      let id: string;
      const m = branchRe.exec(s.node);
      if (m) {
        const rt = m[1] as RouteId;
        const step = b.prefixLen + Number(m[2]);
        id = `${rt}${step - newP}`;
      } else if (/^M\d+$/.test(s.node)) id = `M${Math.min(newS, Number(s.node.slice(1)))}`;
      else id = `S${Math.min(Number(s.node.slice(1)), Math.max(2, newP - 1))}`;
      if (!nodePool(newP, newS, b.routeLengths).includes(id) || taken.has(id)) id = rng.pick(nodePool(newP, newS, b.routeLengths));
      if (taken.has(id)) return null;
      taken.add(id);
      nb.push({ ...s, node: id });
    }
    b.prefixLen = newP;
    b.suffixLen = newS;
    b.specials = nb;
  } else {
    n.rules.isiRange = rng.pick(space.isiRange);
  }
  return candidateProblems(n).length === 0 ? n : null;
}

export function describe(c: Candidate): string {
  const bits = c.board.specials
    .slice()
    .sort((a, b) => a.node.localeCompare(b.node, undefined, { numeric: true }))
    .map((s) => {
      const t = s.type === 'chance' ? `C:${s.card}` : s.type === 'noise' ? `N${s.amount ? '-' + s.amount : ''}` : `B${s.amount ? '+' + s.amount : ''}`;
      return `${s.node}=${t}`;
    });
  const r = c.rules;
  return `p${c.board.prefixLen}/s${c.board.suffixLen} isi${r.isiRange}/-${r.isiPenalty} B+${r.boosterAmount} N-${r.noiseBack} hop${r.hopMaxRange ?? '∞'} ${bits.join(' ')}`;
}

export function fingerprint(c: Candidate): string {
  return `${c.board.prefixLen}|${c.board.suffixLen}|${c.rules.isiRange}|${describe(c)}`;
}

export interface SearchParams {
  /** Structural base (route lengths) new random candidates are generated from. */
  baseBoard: ClassicBoardConfig;
  baseRules: RulesConfig;
  space?: SearchSpace;
  targets?: ObjectiveTargets;
  seed: number;
  /** Seed for the finalist / winner evaluations (kept constant across restarts so scores are comparable). */
  finalSeed?: number;
  /** Games per screening evaluation. */
  screenGames: number;
  populationSize: number;
  generations: number;
  keep: number;
  offspring: number;
  /** Games for finalists (≥100k for the real run). */
  finalGames: number;
  finalists: number;
  /** Games for the winning layout re-run. */
  winnerGames: number;
  seeds: Candidate[];
  onProgress?: (msg: string, frac: number) => void;
}

export interface SearchResult {
  finalists: Evaluated[];
  winner: Evaluated;
  screened: number;
}

export async function runSearch(p: SearchParams, evaluate: Evaluator): Promise<SearchResult> {
  const space = p.space ?? DEFAULT_SPACE;
  const targets = p.targets ?? DEFAULT_TARGETS;
  const rng = new Rng(p.seed);
  const baseBoard = p.baseBoard;
  const rules = p.baseRules;
  const seenFp = new Set<string>();
  let screened = 0;
  const totalSteps = 1 + p.generations + 2;
  let step = 0;
  const tick = (msg: string) => p.onProgress?.(msg, ++step / totalSteps);

  const scoreAll = async (cands: Candidate[], games: number, seed: number): Promise<Evaluated[]> => {
    const reports = await evaluate(cands.map((cand) => ({ cand, games, seed })));
    screened += cands.length;
    return cands.map((cand, i) => ({
      cand,
      report: reports[i],
      score: scoreReport(reports[i], targets).score + simplicityPenalty(cand),
      games,
    }));
  };

  // ---- generation 0
  const init: Candidate[] = [...p.seeds.map(clone) as Candidate[]];
  for (const c of init) seenFp.add(fingerprint(c));
  while (init.length < p.populationSize) {
    const c = randomCandidate(rng, space, baseBoard, rules);
    const fp = fingerprint(c);
    if (seenFp.has(fp)) continue;
    seenFp.add(fp);
    init.push(c);
  }
  let pool = await scoreAll(init, p.screenGames, p.seed);
  pool.sort((a, b) => a.score - b.score);
  tick(`generation 0: best ${pool[0].score.toFixed(1)}`);

  // ---- refinement
  for (let g = 1; g <= p.generations; g++) {
    const parents = pool.slice(0, p.keep);
    const kids: Candidate[] = [];
    let guard = 0;
    while (kids.length < p.keep * p.offspring && guard++ < 5000) {
      const parent = parents[rng.int(parents.length)].cand;
      let m: Candidate | null = mutate(parent, rng, space);
      // sometimes stack a second mutation
      if (m && rng.next() < 0.4) m = mutate(m, rng, space) ?? m;
      if (!m) continue;
      const fp = fingerprint(m);
      if (seenFp.has(fp)) continue;
      seenFp.add(fp);
      kids.push(m);
    }
    // a little fresh blood every generation
    for (let i = 0; i < 4; i++) {
      const c = randomCandidate(rng, space, baseBoard, rules);
      const fp = fingerprint(c);
      if (!seenFp.has(fp)) {
        seenFp.add(fp);
        kids.push(c);
      }
    }
    const evald = await scoreAll(kids, p.screenGames, p.seed);
    pool = [...pool, ...evald].sort((a, b) => a.score - b.score).slice(0, Math.max(p.keep * 3, 30));
    tick(`generation ${g}/${p.generations}: best ${pool[0].score.toFixed(1)}`);
  }

  // ---- finalists at full size (plus the seed layouts so the comparison always shows them)
  const finalCands: Candidate[] = [];
  const fps = new Set<string>();
  for (const e of pool) {
    const fp = fingerprint(e.cand);
    if (fps.has(fp)) continue;
    fps.add(fp);
    finalCands.push({ ...e.cand, label: `search-${finalCands.length + 1}` });
    if (finalCands.length >= p.finalists) break;
  }
  for (const s of p.seeds) {
    const fp = fingerprint(s);
    if (!fps.has(fp)) {
      fps.add(fp);
      finalCands.push(clone(s));
    }
  }
  const finalSeed = p.finalSeed ?? p.seed + 101;
  const finals = await scoreAll(finalCands, p.finalGames, finalSeed);
  finals.sort((a, b) => a.score - b.score);
  tick(`finalists evaluated: best ${finals[0].score.toFixed(1)}`);

  // ---- winner re-run with a fresh seed and more games (avoids picking a lucky screen)
  const top = finals.filter((f) => !f.cand.label.startsWith('baseline') && !f.cand.label.startsWith('c-heavy') && !f.cand.label.startsWith('safe')).slice(0, 3);
  const rerun = await scoreAll(top.map((t) => t.cand), p.winnerGames, finalSeed + 876);
  rerun.sort((a, b) => a.score - b.score);
  tick(`winner confirmed: score ${rerun[0].score.toFixed(1)}`);
  return { finalists: finals, winner: rerun[0], screened };
}

// re-export helpers used by the CLI report writer
export { specialAmount, BOOSTER_MIN_REMAINING_AFTER, MAX_BOOSTER, compileClassicBoard };
