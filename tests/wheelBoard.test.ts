import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard } from '../src/core/board';
import { compileClassicBoard } from '../src/core/classicBoard';
import { validateMap } from '../src/core/mapValidate';
import { advance } from '../src/core/engine';
import { naiveBaseline } from '../src/sim/layouts';
import { compileWheelBoard, detectWheelShape, wheelLanes, wheelNodeIds, WheelBoardConfig } from '../src/core/wheelBoard';

const cfg: WheelBoardConfig = {
  name: 'wheel-test',
  prefixLen: 2,
  stages: [
    { laneCount: 2, laneLen: 4 },
    { laneCount: 3, laneLen: 4 },
  ],
  suffixLen: 2,
  specials: [
    { node: 'R1A2', type: 'chance', card: 'isi' },
    { node: 'R2B3', type: 'noise' },
    { node: 'R2C2', type: 'booster' },
  ],
};

test('compileWheelBoard produces a valid, strictly forward DAG that buildBoard() accepts', () => {
  const graph = compileWheelBoard(cfg);
  const board = buildBoard(graph); // throws on any cycle / duplicate id / bad TX-RX count
  assert.equal(new Set(board.nodes.map((n) => n.id)).size, board.nodes.length, 'unique ids');
  assert.deepEqual(new Set(graph.nodes.map((n) => n.id)), new Set(wheelNodeIds(cfg)));
  // every node must still be able to reach RX (buildBoard's remaining[] is UNREACHABLE otherwise)
  for (const n of board.nodes) assert.notEqual(board.remaining[n.idx], 30000, `${n.id} can't reach RX`);
});

test('validateMap reports no structural errors for a freshly compiled wheel', () => {
  const graph = compileWheelBoard(cfg);
  const v = validateMap(graph);
  assert.deepEqual(v.errors, []);
});

test('detectWheelShape round-trips a compiled wheel back to its stage/prefix/suffix numbers', () => {
  const board = buildBoard(compileWheelBoard(cfg));
  const shape = detectWheelShape(board);
  assert.ok(shape);
  assert.equal(shape!.prefixLen, cfg.prefixLen);
  assert.equal(shape!.suffixLen, cfg.suffixLen);
  assert.deepEqual(shape!.stages, cfg.stages);
});

test('wheelLanes groups every stage into the right number of lane groups, each ending at the shared exit node', () => {
  const board = buildBoard(compileWheelBoard(cfg));
  const lanes = wheelLanes(board);
  assert.ok(lanes);
  assert.equal(lanes!.groups.length, cfg.stages.reduce((a, s) => a + s.laneCount, 0));
  const stage1Groups = lanes!.groups.filter((g) => g.stage === 1);
  assert.equal(stage1Groups.length, 2);
  for (const g of stage1Groups) {
    assert.equal(g.exit, 'X1');
    assert.equal(g.nodes.length, 4);
  }
  const stage2Groups = lanes!.groups.filter((g) => g.stage === 2);
  assert.equal(stage2Groups.length, 3);
  for (const g of stage2Groups) assert.equal(g.entry, 'X1', "stage 2's fork is stage 1's merge");
});

test('a team can walk the whole wheel end to end, choosing a lane at each stage', () => {
  const board = buildBoard(compileWheelBoard(cfg));
  const pos = { node: 'TX', trail: ['TX'] };
  // 2 (prefix) + 4 (stage1 lane) + 1 (into X1) + 4 (stage2 lane) + 1 (into X2) + 2 (suffix) + 1 (into RX) = 15
  const res = advance(board, pos, 15, (_node, options) => options[0]);
  assert.equal(res.reachedRx, true);
  assert.equal(pos.node, 'RX');
});

test('detectWheelShape does not mistake the classic (single-fork) board for a wheel', () => {
  const classicGraph = compileClassicBoard(naiveBaseline().board);
  const board = buildBoard(classicGraph);
  assert.equal(detectWheelShape(board), null);
});
