import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard } from '../src/core/board';
import { compileClassicBoard, detectClassicShape } from '../src/core/classicBoard';
import { defaultSimConfig } from '../src/sim/model';
import { mergeAcc, runBatch } from '../src/sim/simulate';
import { runSuite } from '../src/sim/suite';
import { scoreReport } from '../src/sim/metrics';
import { recommend } from '../src/sim/recommend';
import { naiveBaseline } from '../src/sim/layouts';
import { CHOSEN } from '../src/data/chosenBoard';
import { layoutProblems } from '../src/sim/constraints';

const base = naiveBaseline();
const cfg = defaultSimConfig(compileClassicBoard(base.board), base.rules);

test('the simulator is deterministic for a given seed', () => {
  const a = runSuite(cfg, { games: 2000, seed: 99 });
  const b = runSuite(cfg, { games: 2000, seed: 99 });
  assert.deepEqual(a, b);
  const c = runSuite(cfg, { games: 2000, seed: 100 });
  assert.notDeepEqual(a.finish, c.finish);
});

/** Round floats so summation order (chunked vs whole) cannot cause spurious 1e-11 differences. */
const round = (x: unknown): unknown =>
  typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : Array.isArray(x) ? x.map(round) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, round(v)])) : x;

test('chunked runs reproduce a single long run exactly', () => {
  const whole = runBatch(cfg, { games: 1200, seed: 5 });
  const parts = mergeAcc(runBatch(cfg, { games: 500, seed: 5, offset: 0 }), runBatch(cfg, { games: 700, seed: 5, offset: 500 }));
  assert.deepEqual(round(parts), round(whole));
});

test('every simulated game either ends by qualification or by fallback', () => {
  const acc = runBatch(cfg, { games: 3000, seed: 3 });
  const ended = acc.endCount.reduce((a, b) => a + b, 0);
  assert.equal(ended + acc.fallbackGames, acc.games);
  // exactly 5 qualifiers per game (via Receiver or fallback)
  assert.equal(acc.qualTerc.reduce((a, b) => a + b, 0), acc.games * 5);
});

test('report is well-formed: probabilities in [0,1], nodes match the layout', () => {
  const r = runSuite(cfg, { games: 3000, seed: 8 });
  const inRange = (x: number) => Number.isFinite(x) && x >= 0 && x <= 1.0000001;
  r.finish.endByRound.forEach((x) => assert.ok(inRange(x)));
  r.routes.forEach((x) => assert.ok(inRange(x.usage) && inRange(x.qualifyRate)));
  assert.equal(r.nodes.length, base.board.specials.length);
  const s = scoreReport(r);
  assert.ok(Number.isFinite(s.score));
  assert.ok(recommend(r).length > 0);
});

test('a plain board (no specials) makes the long path clearly slower — the reason placement matters', () => {
  const plain = defaultSimConfig(compileClassicBoard({ ...base.board, specials: [] }), base.rules);
  const r = runSuite(plain, { games: 20000, seed: 11 });
  const [a, , c] = r.parity;
  assert.ok(a.meanFinish < c.meanFinish - 0.4, `A ${a.meanFinish.toFixed(2)} vs C ${c.meanFinish.toFixed(2)}`);
});

test('the saved recommended layout is valid, obeys the placement rules and keeps every route exact', () => {
  const board = buildBoard(compileClassicBoard(CHOSEN.board));
  const shape = detectClassicShape(board);
  assert.ok(shape);
  assert.deepEqual(shape!.routeLengths, { A: 15, B: 16, C: 19 });
  assert.deepEqual(layoutProblems(board, CHOSEN.rules), []);
  assert.ok(CHOSEN.gamesPerFinalist >= 100000, 'finalists were simulated for at least 100,000 games');
  assert.ok(CHOSEN.report.meta.games >= 100000);
});

test('the saved recommended layout is fair across paths (parity gap below 8 pp)', () => {
  assert.ok(CHOSEN.report.parityGap.qualifyPp < 8, `gap ${CHOSEN.report.parityGap.qualifyPp.toFixed(1)}`);
});
