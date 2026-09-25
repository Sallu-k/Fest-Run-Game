import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard } from '../src/core/board';
import { compileClassicBoard } from '../src/core/classicBoard';
import { CHOSEN_BOARD, CHOSEN_RULES } from '../src/data/chosenBoard';
import { applyLayout, defaultLayout, ensureLayout, layoutBounds } from '../src/core/mapLayout';
import { connect, deleteNode, insertNodeOnEdge, mapReport, moveSpecial, newMap, setNodePos, setSpecial } from '../src/core/mapEdit';
import { advance } from '../src/core/engine';
import { BoardConfig } from '../src/core/types';

const COMPILED = compileClassicBoard(CHOSEN_BOARD);
const base = () => newMap(COMPILED, CHOSEN_RULES);
const nodeKind = (cfg: BoardConfig, id: string) => cfg.nodes.find((n) => n.id === id)?.kind;

test('default layout positions every node, with comfortable spacing, inside the world', () => {
  const board = buildBoard(COMPILED);
  const l = defaultLayout(board);
  assert.deepEqual(Object.keys(l.nodePos).sort(), board.nodes.map((n) => n.id).sort());
  const ids = Object.keys(l.nodePos);
  let min = Infinity;
  for (let i = 0; i < ids.length; i++) {
    const a = l.nodePos[ids[i]];
    assert.ok(a.x > 0 && a.x < l.worldW && a.y > 0 && a.y < l.worldH, ids[i]);
    for (let j = i + 1; j < ids.length; j++) min = Math.min(min, Math.hypot(a.x - l.nodePos[ids[j]].x, a.y - l.nodePos[ids[j]].y));
  }
  assert.ok(min >= 60, `closest two nodes are only ${min.toFixed(0)} apart`);
});

test('layout is cosmetic: applying it never changes the graph, distances or route lengths', () => {
  const board = buildBoard(COMPILED);
  const b2 = applyLayout(board, defaultLayout(board));
  assert.deepEqual(Array.from(b2.dist), Array.from(board.dist));
  assert.deepEqual(Array.from(b2.remaining), Array.from(board.remaining));
  assert.deepEqual(b2.succ, board.succ);
  const pos = { node: 'TX', trail: ['TX'] };
  const res = advance(b2, pos, 100, (_node, options) => options[2] ?? options[0]);
  assert.equal(res.moved, 19, 'Path C is always 19 spaces in the shipped layouts');
  const bounds = layoutBounds(b2, defaultLayout(board), 5);
  assert.ok(bounds.w > 500 && bounds.h > 300);
});

test('ensureLayout fills positions for nodes a saved layout does not know', () => {
  const board = buildBoard(COMPILED);
  const l = defaultLayout(board);
  delete l.nodePos.A3;
  assert.ok(ensureLayout(board, l).nodePos.A3);
});

test('specials: set, retype, remove, move; TX/RX refuse; occupied target refuses', () => {
  let m = base();
  let r = setSpecial(m, 'A1', { type: 'booster' });
  assert.ok(r.ok);
  m = (r as any).map;
  assert.equal(nodeKind(m.board, 'A1'), 'booster');
  r = setSpecial(m, 'A1', { type: 'chance', card: 'hop' });
  m = (r as any).map;
  assert.equal(m.board.nodes.find((n) => n.id === 'A1')?.card, 'hop');
  assert.ok(!setSpecial(m, 'RX', { type: 'noise' }).ok);
  assert.ok(!moveSpecial(m, 'A1', 'A3').ok, 'A3 is occupied');
  r = moveSpecial(m, 'A1', 'A2');
  m = (r as any).map;
  assert.equal(nodeKind(m.board, 'A2'), 'chance');
  assert.equal(nodeKind(m.board, 'A1'), 'normal');
  m = (setSpecial(m, 'A2', null) as any).map;
  assert.equal(nodeKind(m.board, 'A2'), 'normal');
});

test('insertNodeOnEdge lengthens a path by one node; deleteNode(reconnect) removes it again', () => {
  const m = base();
  const before = buildBoard(m.board);
  const r = insertNodeOnEdge(m, 'A1', 'A2');
  assert.ok(r.ok);
  const m2 = (r as any).map;
  const b2 = buildBoard(m2.board);
  assert.equal(b2.nodes.length, before.nodes.length + 1);
  const newId = b2.succ['A1'][0];
  assert.notEqual(newId, 'A2');
  assert.deepEqual(b2.succ[newId], ['A2']);
  // the new node sits between its neighbours
  const p = m2.layout.nodePos;
  const midDist = Math.hypot(p[newId].x - p.A1.x, p[newId].y - p.A1.y);
  const endDist = Math.hypot(p.A2.x - p.A1.x, p.A2.y - p.A1.y);
  assert.ok(midDist < endDist);
  // deleting it again reconnects A1 -> A2 directly
  const back = deleteNode(m2, newId, true);
  assert.ok(back.ok);
  const b3 = buildBoard((back as any).map.board);
  assert.deepEqual(b3.succ.A1, ['A2']);
});

test('deleteNode refuses TX/RX; connect rejects a duplicate edge and anything that would cycle', () => {
  const m = base();
  assert.ok(!deleteNode(m, 'TX').ok);
  assert.ok(!deleteNode(m, 'RX').ok);
  assert.ok(!connect(m, 'A1', 'A2').ok, 'A1->A2 already exists');
  assert.ok(!connect(m, 'A2', 'A1').ok, 'would create a cycle');
});

test('dragging a node changes only its position; the report flags overlaps and rule problems', () => {
  let m = base();
  m = setNodePos(m, 'A2', { x: 111.4, y: 222.6 });
  assert.deepEqual(m.layout.nodePos.A2, { x: 111, y: 223 });
  assert.equal(mapReport(base()).problems.length, 0);
  assert.equal(mapReport(base()).playableNow, true);
  const near = setNodePos(base(), 'A2', base().layout.nodePos.A1);
  assert.ok(mapReport(near).overlaps.length > 0);
  const bad = (setSpecial(base(), 'A4', { type: 'chance', card: 'isi' }) as any).map; // next to A3 chance
  assert.ok(mapReport(bad).problems.length > 0);
});
