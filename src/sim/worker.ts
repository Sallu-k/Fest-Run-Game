/// <reference lib="webworker" />
// Web Worker: runs simulations and layout searches off the UI thread (used by the Board Balancer).

import { ClassicBoardConfig, compileClassicBoard } from '../core/classicBoard';
import { Report } from './metrics';
import { SimConfig } from './model';
import { Candidate, SearchParams, runSearch, Evaluated } from './optimize';
import { runSuite } from './suite';

export type WorkerRequest =
  | { type: 'suite'; id: number; cfg: SimConfig; games: number; seed: number }
  | {
      type: 'search';
      id: number;
      /** Supplies teams/rounds/pmf/rules/etc. for evaluating candidates (its `.board` is unused —
       *  each candidate compiles its own `baseBoard` instead). */
      base: SimConfig;
      /** The classic-shape skeleton the structural search mutates (see SearchParams.baseBoard). */
      baseBoard: ClassicBoardConfig;
      params: Omit<SearchParams, 'baseBoard' | 'baseRules' | 'onProgress'>;
    };

export type WorkerResponse =
  | { type: 'progress'; id: number; frac: number; msg: string }
  | { type: 'suite-done'; id: number; report: Report }
  | { type: 'search-done'; id: number; finalists: Evaluated[]; winner: Evaluated; screened: number }
  | { type: 'error'; id: number; message: string };

const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  try {
    if (m.type === 'suite') {
      const report = runSuite(m.cfg, {
        games: m.games,
        seed: m.seed,
        onProgress: (d, t) => post({ type: 'progress', id: m.id, frac: d / t, msg: `${d.toLocaleString()} / ${t.toLocaleString()} games` }),
      });
      post({ type: 'suite-done', id: m.id, report });
    } else {
      const evaluate = async (jobs: { cand: Candidate; games: number; seed: number }[]) =>
        jobs.map((j) => runSuite({ ...m.base, board: compileClassicBoard(j.cand.board), rules: j.cand.rules }, { games: j.games, seed: j.seed }));
      const res = await runSearch(
        {
          ...m.params,
          baseBoard: m.baseBoard,
          baseRules: m.base.rules,
          onProgress: (msg, frac) => post({ type: 'progress', id: m.id, frac, msg }),
        },
        evaluate,
      );
      post({ type: 'search-done', id: m.id, finalists: res.finalists, winner: res.winner, screened: res.screened });
    }
  } catch (err) {
    post({ type: 'error', id: m.id, message: (err as Error).message });
  }
};
