import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, nodeDist } from '../src/core/board';
import { ROUTE_IDS, classicNodeMeta, compileClassicBoard, validateClassicConfig } from '../src/core/classicBoard';
import {
  advance,
  fallbackGroups,
  fallbackRanking,
  grantCard,
  hopTargets,
  isiTargets,
  makeTeam,
  maxSlots,
  qualifyTeam,
  remainingOf,
  resolveSpecial,
  roundOrder,
  stepBack,
  synthesizeTrail,
  useHop,
  useIsi,
  canUseCard,
} from '../src/core/engine';
import { Core, Pos, defaultRules } from '../src/core/types';
import { naiveBaseline } from '../src/sim/layouts';
import { layoutProblems } from '../src/sim/constraints';

const layout = naiveBaseline();

function makeCore(n = 4, board = buildBoard(compileClassicBoard(layout.board))): Core {
  const teams = Array.from({ length: n }, (_, i) => makeTeam(i + 1, `T${i + 1}`, '●', '#fff', board));
  return { board, rules: { ...layout.rules }, teams, qualifiers: [], turnId: 1 };
}
const put = (core: Core, teamId: number, nodeId: string) => {
  const t = core.teams[teamId - 1];
  t.node = nodeId;
  t.trail = synthesizeTrail(core.board, nodeId);
};

test('every route is exactly 15 / 16 / 19 steps for any valid prefix/suffix', () => {
  for (let p = 1; p <= 5; p++) {
    for (let s = 0; s <= 4; s++) {
      const cfg = { ...layout.board, prefixLen: p, suffixLen: s, specials: [] };
      assert.deepEqual(validateClassicConfig(cfg), []);
      const b = buildBoard(compileClassicBoard(cfg));
      // walking forward from TX along each named route with a fixed choice reaches RX in exactly that many steps
      for (const r of ROUTE_IDS) {
        const pos: Pos = { node: 'TX', trail: ['TX'] };
        const res = advance(b, pos, 100, (_node, options) => options.find((o) => classicNodeMeta(o).lane === r) ?? options[0]);
        assert.equal(res.reachedRx, true);
        assert.equal(res.moved, cfg.routeLengths[r], `p=${p} s=${s} route=${r}`);
      }
    }
  }
});

test('nodes have unique ids and coordinates, none overlapping', () => {
  const b = buildBoard(compileClassicBoard(layout.board));
  assert.equal(new Set(b.nodes.map((n) => n.id)).size, b.nodes.length);
  for (const n of b.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
  for (let i = 0; i < b.nodes.length; i++)
    for (let j = i + 1; j < b.nodes.length; j++)
      assert.ok(Math.hypot(b.nodes[i].x - b.nodes[j].x, b.nodes[i].y - b.nodes[j].y) > 40, `${b.nodes[i].id} vs ${b.nodes[j].id}`);
});

test('the fork blocks until a route is chosen; landing on it defers the choice', () => {
  const b = buildBoard(compileClassicBoard(layout.board));
  const forkId = `S${layout.board.prefixLen}`;
  const pos: Pos = { node: 'TX', trail: ['TX'] };
  // exactly to the fork: no choice needed yet
  let r = advance(b, pos, layout.board.prefixLen, () => null);
  assert.equal(pos.node, forkId);
  assert.equal(r.blocked, false);
  // one more step needs a decision
  r = advance(b, pos, 2, () => null);
  assert.equal(r.blocked, true);
  assert.equal(pos.node, forkId);
  r = advance(b, pos, 2, (_node, options) => options.find((o) => classicNodeMeta(o).lane === 'C')!);
  assert.equal(pos.node, 'C2');
});

test('moving back retraces the team’s own trail and never passes the Transmitter', () => {
  const b = buildBoard(compileClassicBoard(layout.board));
  const mergeEntry = layout.board.suffixLen > 0 ? 'M1' : 'RX';
  const forkId = layout.board.prefixLen > 0 ? `S${layout.board.prefixLen}` : 'TX';
  // from the merge entry, one step back lands on B's last own node
  const bLast = b.pred[mergeEntry].find((id) => classicNodeMeta(id).lane === 'B')!;
  const pos: Pos = { node: mergeEntry, trail: [...synthesizeTrail(b, bLast), mergeEntry] };
  stepBack(b, pos, 1);
  assert.equal(pos.node, bLast);
  // back across the fork lands on the fork itself, and never goes past TX
  const p2: Pos = { node: 'C1', trail: synthesizeTrail(b, 'C1') };
  stepBack(b, p2, 1);
  assert.equal(p2.node, forkId);
  stepBack(b, p2, 50);
  assert.equal(p2.node, 'TX');
});

test('reaching or passing the Receiver stops the walk at RX', () => {
  const b = buildBoard(compileClassicBoard(layout.board));
  const preRx = b.pred['RX'][0];
  const pos: Pos = { node: preRx, trail: synthesizeTrail(b, preRx) };
  const r = advance(b, pos, 6, () => null);
  assert.equal(r.reachedRx, true);
  assert.equal(r.moved, 1);
  assert.equal(pos.node, 'RX');
});

test('special spaces: booster, noise (right / wrong), chance (right / wrong)', () => {
  const core = makeCore(2);
  const b = core.board;
  const t = core.teams[0];
  // booster
  const boosterNode = b.nodes.find((n) => n.special?.type === 'booster')!;
  t.node = boosterNode.id;
  t.trail = synthesizeTrail(b, boosterNode.id);
  resolveSpecial(core, t, true);
  assert.equal(nodeDist(b, boosterNode.id, t.node), core.rules.boosterAmount);
  // noise wrong -> back, noise right -> stay
  const noise = b.nodes.find((n) => n.special?.type === 'noise')!;
  const t2 = core.teams[1];
  t2.node = noise.id;
  t2.trail = synthesizeTrail(b, noise.id);
  resolveSpecial(core, t2, true);
  assert.equal(t2.node, noise.id);
  resolveSpecial(core, t2, false);
  assert.equal(nodeDist(b, noise.id, t2.node), core.rules.noiseBack);
  // chance right -> card of that space, wrong -> nothing
  const chance = b.nodes.find((n) => n.special?.type === 'chance')!;
  t2.node = chance.id;
  t2.trail = synthesizeTrail(b, chance.id);
  resolveSpecial(core, t2, false);
  assert.deepEqual(t2.cards, [0, 0, 0]);
  resolveSpecial(core, t2, true);
  assert.equal(t2.cards.filter((c) => c === 1).length, 1);
});

test('at most one copy of a card; a newly earned card is locked for the same turn', () => {
  const core = makeCore(2);
  const t = core.teams[0];
  core.turnId = 5;
  assert.equal(grantCard(core, t, 'isi'), true);
  assert.equal(grantCard(core, t, 'isi'), false);
  assert.equal(canUseCard(core, t, 'isi'), false, 'same turn');
  core.turnId = 6;
  assert.equal(canUseCard(core, t, 'isi'), true, 'next turn');
});

test('ISI: range is board distance, targets exclude qualified / TX / self; moves target back 2', () => {
  const core = makeCore(4);
  put(core, 1, 'A5');
  put(core, 2, 'A7'); // 2 away
  put(core, 3, 'A9'); // 4 away -> out of range (3)
  put(core, 4, 'B5'); // different branch: far
  const targets = isiTargets(core, core.teams[0]).map((x) => x.team.id);
  assert.deepEqual(targets, [2]);
  core.teams[1].status = 'qualified';
  assert.deepEqual(isiTargets(core, core.teams[0]), []);
  core.teams[1].status = 'active';
  useIsi(core, core.teams[0], core.teams[1], false);
  assert.equal(core.teams[1].node, 'A5');
  assert.equal(core.teams[0].cards[0], 2, 'ISI consumed');
});

test('ORTHOGONALITY blocks one card and is consumed with it', () => {
  const core = makeCore(3);
  put(core, 1, 'A5');
  put(core, 2, 'A6');
  core.teams[1].cards[2] = 1;
  const before = core.teams[1].node;
  useIsi(core, core.teams[0], core.teams[1], true);
  assert.equal(core.teams[1].node, before);
  assert.equal(core.teams[1].cards[2], 2);
  // HOP blocked too
  core.teams[2].cards[2] = 1;
  core.teams[0].cards[1] = 1;
  const me = core.teams[0].node;
  useHop(core, core.teams[0], core.teams[2], true);
  assert.equal(core.teams[0].node, me);
  assert.equal(core.teams[2].cards[2], 2);
});

test('FREQUENCY HOP swaps position (and trail) with any active team (or within maxRange)', () => {
  const core = makeCore(3);
  put(core, 1, 'A3');
  put(core, 2, 'C10');
  core.teams[0].cards[1] = 1;
  assert.deepEqual(hopTargets(core, core.teams[0]).map((x) => x.team.id).sort(), [2, 3]);
  useHop(core, core.teams[0], core.teams[1], false);
  assert.equal(core.teams[0].node, 'C10');
  assert.equal(core.teams[1].node, 'A3');
  core.rules.hopMaxRange = 3;
  assert.deepEqual(hopTargets(core, core.teams[0]).map((x) => x.team.id), [], 'range-limited');
});

test('qualification order, locking and slot cap', () => {
  const core = makeCore(10);
  assert.equal(maxSlots(core), 5);
  for (let i = 0; i < 6; i++) qualifyTeam(core, core.teams[i]);
  assert.equal(core.teams[0].slot, 1);
  assert.equal(core.teams[4].slot, 5);
  assert.equal(isiTargets(core, core.teams[9]).some((x) => x.team.status === 'qualified'), false);
  assert.equal(maxSlots(makeCore(3)), 3, 'fewer than 5 teams: slots = team count');
});

test('turn order rotates by two each round', () => {
  assert.deepEqual(roundOrder(10, 1), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(roundOrder(10, 2), [3, 4, 5, 6, 7, 8, 9, 10, 1, 2]);
  assert.deepEqual(roundOrder(10, 3), [5, 6, 7, 8, 9, 10, 1, 2, 3, 4]);
  assert.equal(roundOrder(10, 5)[0], 9);
  assert.equal(roundOrder(7, 4)[0], 7);
});

test('fallback: furthest first, then final-round correct, then sudden death for the cut group', () => {
  const core = makeCore(10);
  // teams 1..2 already qualified
  qualifyTeam(core, core.teams[0]);
  qualifyTeam(core, core.teams[1]);
  const place = (id: number, node: string, lastRound: number) => {
    put(core, id, node);
    core.teams[id - 1].correctByRound = [0, 0, 0, 0, lastRound];
  };
  place(3, 'A9', 2); // remaining 15-3-... compare below
  place(4, 'A9', 5); // same spot, better last round
  place(5, 'A8', 3);
  place(6, 'C4', 6); // far behind on the long path
  place(7, 'B3', 1);
  place(8, 'B3', 1); // exact tie with 7
  place(9, 'A2', 0);
  place(10, 'A2', 0);
  const rank = fallbackRanking(core, 5).map((r) => r.team.id);
  assert.ok(remainingOf(core.board, core.teams[2]) === remainingOf(core.board, core.teams[3]));
  assert.deepEqual(rank.slice(0, 2), [4, 3], 'tie broken by final-round correct answers');
  // 3 slots left: 4,3 then 5 fits; no sudden death needed
  const g = fallbackGroups(core, 5);
  assert.equal(g.sudden, null);
  assert.deepEqual(g.auto.flat().map((r) => r.team.id), [4, 3, 5]);
  // now leave only 1 slot: 4 (best) wins outright, no tie
  qualifyTeam(core, core.teams[7]);
  qualifyTeam(core, core.teams[9]);
  const g2 = fallbackGroups(core, 5);
  assert.deepEqual(g2.auto.flat().map((r) => r.team.id), [4]);
  // exact tie for the last slot -> sudden death group
  const core2 = makeCore(6);
  for (let i = 0; i < 4; i++) qualifyTeam(core2, core2.teams[i]);
  put(core2, 5, 'A8');
  put(core2, 6, 'A8');
  const g3 = fallbackGroups(core2, 5);
  assert.equal(g3.sudden?.needsSuddenDeath, true);
  assert.equal(g3.sudden?.rows.length, 2);
});

test('core rules never use randomness', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/core');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/Math\.random/.test(src), `${f} must not call Math.random`);
  }
});

test('the saved default rules are valid and the baseline layout obeys the placement constraints', () => {
  const problems = layoutProblems(buildBoard(compileClassicBoard(layout.board)), defaultRules());
  assert.deepEqual(problems, []);
});
