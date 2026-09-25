// Worker-thread entry: evaluates one layout with the full measurement suite.
import { parentPort } from 'node:worker_threads';
import { runSuite } from '../src/sim/suite';
import type { SimConfig } from '../src/sim/model';

parentPort!.on('message', (m: { id: number; cfg: SimConfig; games: number; seed: number }) => {
  const report = runSuite(m.cfg, { games: m.games, seed: m.seed });
  parentPort!.postMessage({ id: m.id, report });
});
