// Runs the full measurement suite for one layout: a realistic mixed-strategy batch plus a
// uniform-random-route "parity" batch that removes strategy bias from the path comparison.

import { buildBoard } from '../core/board';
import { Report, finalizeReport } from './metrics';
import { SimConfig } from './model';
import { Acc, mergeAcc, runBatch } from './simulate';

export interface SuiteOptions {
  games: number;
  seed: number;
  /** Parity games as a fraction of `games` (min 5000). */
  parityFraction?: number;
  chunk?: number;
  onProgress?: (done: number, total: number) => void;
}

export function parityGamesFor(games: number, fraction = 0.5): number {
  return Math.max(5000, Math.floor(games * fraction));
}

export function runSuite(cfg: SimConfig, opts: SuiteOptions): Report {
  const board = buildBoard(cfg.board);
  const pg = parityGamesFor(opts.games, opts.parityFraction);
  const total = opts.games + pg;
  const chunk = opts.chunk ?? 5000;
  let done = 0;
  const run = (games: number, uniform: boolean, seed: number): Acc => {
    let acc: Acc | null = null;
    for (let off = 0; off < games; off += chunk) {
      const n = Math.min(chunk, games - off);
      const part = runBatch(cfg, { games: n, seed, offset: off, uniformRoutes: uniform });
      acc = acc ? mergeAcc(acc, part) : part;
      done += n;
      opts.onProgress?.(done, total);
    }
    return acc!;
  };
  const mixed = run(opts.games, false, opts.seed);
  const parity = run(pg, true, opts.seed ^ 0x5bd1e995);
  return finalizeReport(mixed, parity, cfg, board, opts.seed);
}
