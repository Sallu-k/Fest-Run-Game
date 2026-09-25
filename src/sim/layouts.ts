// Named starting layouts used as baselines by the optimizer and as examples in the docs.

// The optimizer's structural search stays scoped to this classic (single fork → 3 named branches →
// single merge) shape — see core/classicBoard.ts's module comment for why. Candidate.board is a
// ClassicBoardConfig; it's compiled to the general graph BoardConfig only when a game is actually run.
import { ClassicBoardConfig, SpecialPlacement } from '../core/classicBoard';
import { CardType, RulesConfig, SpecialType, defaultRules } from '../core/types';
import type { Candidate } from './optimize';

export const ROUTE_LENGTHS = { A: 15, B: 16, C: 19 } as const;

export function sp(node: string, type: SpecialType, opts: { card?: CardType; amount?: number } = {}): SpecialPlacement {
  return { node, type, ...opts };
}

export function makeBoard(name: string, prefixLen: number, suffixLen: number, specials: SpecialPlacement[]): ClassicBoardConfig {
  return { name, routeLengths: { ...ROUTE_LENGTHS }, prefixLen, suffixLen, specials };
}

/** The brief's starting design (3 Chance, 2 Noise, 2 Booster), spread "evenly" with no tuning. */
export function naiveBaseline(): Candidate {
  return {
    label: 'baseline-even',
    rules: defaultRules(),
    board: makeBoard('baseline-even', 3, 2, [
      sp('A4', 'chance', { card: 'isi' }),
      sp('B5', 'chance', { card: 'hop' }),
      sp('C6', 'chance', { card: 'orth' }),
      sp('A7', 'noise'),
      sp('B8', 'noise'),
      sp('C4', 'booster'),
      sp('C9', 'booster'),
    ]),
  };
}

/** Rewards concentrated on the long path, safe short path. */
export function longPathRewards(): Candidate {
  const rules: RulesConfig = { ...defaultRules(), boosterAmount: 4 };
  return {
    label: 'c-heavy-rewards',
    rules,
    board: makeBoard('c-heavy-rewards', 3, 2, [
      sp('C6', 'chance', { card: 'hop' }),
      sp('C11', 'chance', { card: 'isi' }),
      sp('B5', 'chance', { card: 'orth' }),
      sp('A6', 'noise'),
      sp('B8', 'noise'),
      sp('C3', 'booster'),
      sp('C8', 'booster'),
    ]),
  };
}

/** Almost nothing on A, everything risky elsewhere. */
export function safeShort(): Candidate {
  return {
    label: 'safe-short',
    rules: defaultRules(),
    board: makeBoard('safe-short', 3, 2, [
      sp('A5', 'chance', { card: 'orth' }),
      sp('B4', 'chance', { card: 'isi' }),
      sp('C8', 'chance', { card: 'hop' }),
      sp('A8', 'noise'),
      sp('B7', 'noise'),
      sp('B2', 'booster'),
      sp('C5', 'booster'),
    ]),
  };
}

export function baselineCandidates(): Candidate[] {
  return [naiveBaseline(), longPathRewards(), safeShort()];
}

// ---------------------------------------------------------------------------------------------
// Result of the full optimizer run (3 restarts, ~4,600 layouts screened) — kept as data so the
// comparison table can show it next to the manual refinement below.

/** The optimizer's own winner: best score, but Path B is left bare and is rarely chosen. */
export function optimizerWinner(): Candidate {
  return {
    label: 'optimizer-winner',
    rules: { ...defaultRules(), boosterAmount: 4, noiseBack: 2 },
    board: makeBoard('optimizer-winner', 3, 3, [
      sp('S2', 'chance', { card: 'isi' }),
      sp('A3', 'chance', { card: 'orth' }),
      sp('A6', 'noise'),
      sp('A8', 'noise'),
      sp('C2', 'booster'),
      sp('C6', 'booster'),
      sp('C8', 'booster'),
      sp('M2', 'chance', { card: 'hop' }),
    ]),
  };
}

/**
 * RECOMMENDED layout = optimizer winner + one designer refinement found by simulation:
 * Path B gets a small +2 mini-booster and Path C's boosters become +5 (global booster strength 5),
 * which closes the remaining gap between the three paths and gives Path B a reason to exist.
 */
export function recommended(): Candidate {
  return {
    label: 'RECOMMENDED',
    rules: { ...defaultRules(), boosterAmount: 5, noiseBack: 2 },
    board: makeBoard('recommended', 3, 3, [
      sp('S2', 'chance', { card: 'isi' }), // shared start: every team can earn ISI
      sp('A3', 'chance', { card: 'orth' }), // Path A: the only reward on the short path
      sp('A6', 'noise'),
      sp('A8', 'noise'), // Path A pays for being short with two Noise spaces
      sp('B4', 'booster', { amount: 2 }), // Path B: a small +2 mini-booster
      sp('C3', 'booster'),
      sp('C5', 'booster'),
      sp('C7', 'booster'), // Path C: three +5 boosters compensate for its 4 extra spaces
      sp('M2', 'chance', { card: 'hop' }), // shared finish: HOP chance keeps the race open
    ]),
  };
}

/** Other refinements that were simulated at full size and rejected (shown in the comparison table). */
export function refinementVariants(): Candidate[] {
  const w = optimizerWinner();
  const mk = (label: string, f: (c: Candidate) => void): Candidate => {
    const c: Candidate = JSON.parse(JSON.stringify(w));
    c.label = label;
    c.board.name = label;
    f(c);
    return c;
  };
  const setBoosters = (c: Candidate, nodes: string[], bAmt: number, global: number) => {
    c.board.specials = c.board.specials.filter((x) => x.type !== 'booster');
    for (const n of nodes) c.board.specials.push(sp(n, 'booster'));
    c.board.specials.push(sp('B4', 'booster', { amount: bAmt }));
    c.rules.boosterAmount = global;
  };
  return [
    mk('refine: full +4 booster on B', (c) => c.board.specials.push(sp('B4', 'booster'))),
    mk('refine: B +2, C boosters +4', (c) => setBoosters(c, ['C2', 'C6', 'C8'], 2, 4)),
    mk('refine: B +2, C +5 at C2/C5/C7 (B3)', (c) => {
      setBoosters(c, ['C2', 'C5', 'C7'], 2, 5);
      c.board.specials.find((x) => x.node === 'B4')!.node = 'B3';
    }),
    mk('refine: B +3, C +5 at C2/C5/C7', (c) => setBoosters(c, ['C2', 'C5', 'C7'], 3, 5)),
    mk('refine: B +2, four C boosters +4', (c) => setBoosters(c, ['C2', 'C4', 'C6', 'C8'], 2, 4)),
  ];
}
