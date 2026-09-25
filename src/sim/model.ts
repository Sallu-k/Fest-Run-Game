// Performance model + behavioural policies for the simulator.
// Everything here is a *configurable assumption*, not a fact about real teams.

import { Board, BoardConfig, RulesConfig, defaultRules } from '../core/types';
import { Rng } from '../core/rng';
import { specialAmount } from '../core/engine';

export interface PolicyMix {
  /** Weighted route choice using expected effective route length. */
  value: number;
  /** Always take the shortest route. */
  shortest: number;
  /** Uniform random route. */
  random: number;
}

/** Discrete skill tiers a team can be drawn from (the brief's "weak/average/good/strong/excellent"),
 *  each with its own answer-count distribution. `archetypeMix` is optional: when unset, every team is
 *  drawn from a single implicit population using `pmf`/`skillSigma` — today's exact behaviour, so
 *  every existing board/report stays numerically unchanged unless a mix is explicitly configured. */
export type SkillArchetype = 'weak' | 'average' | 'good' | 'strong' | 'excellent';
export const SKILL_ARCHETYPES: SkillArchetype[] = ['weak', 'average', 'good', 'strong', 'excellent'];

export interface ArchetypeProfile {
  /** P(0..6 correct) for a team of this archetype (normalised at run time). */
  pmf: number[];
  /** Population share (renormalised across all configured archetypes). */
  share: number;
}

/** Defaults matching the brief's ranges: weak 2–3, average 3–4, good 4–5, strong ≈5, excellent 5–6. */
export const DEFAULT_ARCHETYPES: Record<SkillArchetype, ArchetypeProfile> = {
  weak: { pmf: [0.1, 0.28, 0.32, 0.2, 0.08, 0.02, 0.0], share: 0.15 },
  average: { pmf: [0.03, 0.09, 0.17, 0.27, 0.22, 0.14, 0.08], share: 0.4 },
  good: { pmf: [0.0, 0.02, 0.08, 0.22, 0.32, 0.24, 0.12], share: 0.25 },
  strong: { pmf: [0.0, 0.0, 0.03, 0.12, 0.28, 0.34, 0.23], share: 0.15 },
  excellent: { pmf: [0.0, 0.0, 0.0, 0.05, 0.2, 0.37, 0.38], share: 0.05 },
};

export interface SimConfig {
  board: BoardConfig;
  rules: RulesConfig;
  teams: number;
  /** 4–7 in the UI; kept as a plain number so future round counts don't need a type change. */
  rounds: number;
  /** Probability of 0..6 correct answers for an average team (normalised at run time). Used directly
   *  when `archetypeMix` is not set. */
  pmf: number[];
  /** Spread of team skill (θ ~ N(0, σ)); θ tilts the pmf as p_k · e^{θk}. 0 = identical teams. Also
   *  used as within-archetype spread when `archetypeMix` is set. */
  skillSigma: number;
  /** Optional population mix over discrete skill archetypes (see SkillArchetype). Unset = today's
   *  single-population behaviour. Shares are renormalised; profiles default to DEFAULT_ARCHETYPES. */
  archetypeMix?: Partial<Record<SkillArchetype, number>>;
  archetypeProfiles?: Partial<Record<SkillArchetype, ArchetypeProfile>>;
  /** Probability an average team answers a CHANCE / NOISE quick question correctly. */
  quickBase: number;
  /** How strongly skill θ moves the quick-question success probability (logit scale). */
  quickSkillSlope: number;
  policyMix: PolicyMix;
  /** Std-dev of the error in a team's estimate of a branch option's value (spaces). */
  routeNoise: number;
  /** How many spaces a team thinks each card is worth (only used to value CHANCE spaces ahead). */
  cardValues: { isi: number; hop: number; orth: number };
  /** FREQUENCY HOP is used when it gains at least this many spaces. */
  hopGainThreshold: number;
  /** Probability a team uses a useful ISI opportunity. */
  isiUseProb: number;
  /** Non-qualified teams within this many spaces of RX count as "still alive" at the start of the last round. */
  aliveRadius: number;
  /** Round (1-based) the "comeback" metric's baseline ranking is taken from. Defaults to
   *  max(2, ceil(rounds/3)) at run time when left unset, so 4–5 round games keep today's round-2
   *  baseline and longer games scale sensibly. */
  comebackBaselineRound?: number;
}

/**
 * Default model of a team's correct answers out of 6 (mean ≈ 3.3): 3 is the mode, 2 and 4 are common,
 * 0 and 6 are rare. This is an assumption to be replaced with real data — see the Balancer.
 */
export const DEFAULT_PMF = [0.03, 0.09, 0.17, 0.27, 0.22, 0.14, 0.08];

export function defaultSimConfig(board: BoardConfig, rules: RulesConfig = defaultRules()): SimConfig {
  return {
    board,
    rules,
    teams: 10,
    rounds: 5,
    pmf: [...DEFAULT_PMF],
    skillSigma: 0.25,
    quickBase: 0.6,
    quickSkillSlope: 1.5,
    policyMix: { value: 0.5, shortest: 0.3, random: 0.2 },
    routeNoise: 1.0,
    cardValues: { isi: 1.0, hop: 2.5, orth: 0.8 },
    hopGainThreshold: 4,
    isiUseProb: 0.9,
    aliveRadius: 6,
  };
}

export function normalisePmf(pmf: number[]): number[] {
  const sum = pmf.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  return pmf.map((p) => Math.max(0, p) / sum);
}

export function pmfMean(pmf: number[]): number {
  const p = normalisePmf(pmf);
  return p.reduce((a, b, k) => a + b * k, 0);
}

/** Resolve the archetype mix for a SimConfig into a normalised list of {archetype, pmf, share}. */
export function resolveArchetypes(cfg: SimConfig): { archetype: SkillArchetype; pmf: number[]; share: number }[] {
  if (!cfg.archetypeMix) return [{ archetype: 'average', pmf: cfg.pmf, share: 1 }];
  const entries = SKILL_ARCHETYPES.map((a) => {
    const share = cfg.archetypeMix?.[a] ?? 0;
    const profile = cfg.archetypeProfiles?.[a] ?? DEFAULT_ARCHETYPES[a];
    return { archetype: a, pmf: profile.pmf, share };
  }).filter((e) => e.share > 0);
  const total = entries.reduce((s, e) => s + e.share, 0) || 1;
  return entries.map((e) => ({ ...e, share: e.share / total }));
}

/** Cumulative distribution of a skill-tilted pmf. */
export function tiltedCdf(pmf: number[], theta: number): Float64Array {
  const w = pmf.map((p, k) => Math.max(0, p) * Math.exp(theta * k));
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  const cdf = new Float64Array(w.length);
  let acc = 0;
  for (let k = 0; k < w.length; k++) {
    acc += w[k] / sum;
    cdf[k] = acc;
  }
  cdf[w.length - 1] = 1;
  return cdf;
}

export function cdfMean(cdf: Float64Array): number {
  let mean = 0;
  let prev = 0;
  for (let k = 0; k < cdf.length; k++) {
    mean += k * (cdf[k] - prev);
    prev = cdf[k];
  }
  return mean;
}

export function sampleCdf(cdf: Float64Array, u: number): number {
  for (let k = 0; k < cdf.length; k++) if (u < cdf[k]) return k;
  return cdf.length - 1;
}

export function quickProb(cfg: SimConfig, theta: number): number {
  const base = Math.min(0.98, Math.max(0.02, cfg.quickBase));
  const logit = Math.log(base / (1 - base)) + cfg.quickSkillSlope * theta;
  return 1 / (1 + Math.exp(-logit));
}

/**
 * A team's local estimate of how many "effective" spaces are left if it takes `option` from a branch
 * node — generalizes the old fixed 3-route table to work at ANY branch point in ANY graph shape: walk
 * forward along the straight run after `option` (until RX, a dead end, or the *next* branch/merge
 * point), adjusting for specials met along the way, then add the shortest remaining distance from
 * wherever that run ends. A team only plans one decision ahead — exactly as it would re-evaluate this
 * same way when it actually reaches the next branch point, rather than solving the whole graph upfront.
 */
export function branchOptionValue(board: Board, rules: RulesConfig, option: string, cfg: SimConfig, hitProb: number, q: number): number {
  let adjust = 0;
  let cur = option;
  const rxId = board.idOf[board.rx];
  for (let guard = 0; guard < 500 && cur !== rxId; guard++) {
    const idx = board.byId.get(cur)!;
    const n = board.nodes[idx];
    if (n.special) {
      const sp = n.special;
      if (sp.type === 'booster') adjust -= hitProb * specialAmount(rules, sp);
      else if (sp.type === 'noise') adjust += hitProb * (1 - q) * specialAmount(rules, sp);
      else if (sp.card) adjust -= hitProb * q * cfg.cardValues[sp.card];
    }
    const succs = board.succ[cur];
    if (succs.length !== 1) break; // RX, a dead end, or another branch point — stop the lookahead here
    cur = succs[0];
  }
  const idx = board.byId.get(option)!;
  return board.remaining[idx] + adjust;
}

export type RoutePolicy = 0 | 1 | 2; // value, shortest, random

export function drawPolicy(mix: PolicyMix, rng: Rng): RoutePolicy {
  const total = mix.value + mix.shortest + mix.random || 1;
  const u = rng.next() * total;
  if (u < mix.value) return 0;
  if (u < mix.value + mix.shortest) return 1;
  return 2;
}

/** Skill-tilt a pmf (θ > 0 = stronger teams). Used for sensitivity analysis. */
export function tiltPmf(pmf: number[], theta: number): number[] {
  const w = normalisePmf(pmf).map((p, k) => p * Math.exp(theta * k));
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / s);
}
