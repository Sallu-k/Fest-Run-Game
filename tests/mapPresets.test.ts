import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard } from '../src/core/board';
import { mapReport } from '../src/core/mapEdit';
import { validateMap } from '../src/core/mapValidate';
import { advance } from '../src/core/engine';
import { MAP_PRESETS, presetForBoard } from '../src/data/mapPresets';
import { layoutProblems } from '../src/core/placementRules';

for (const preset of MAP_PRESETS) {
  test(`map preset "${preset.name}": compiles, validates clean, and is playable now`, () => {
    const map = preset.build();
    const board = buildBoard(map.board);
    const v = validateMap(map.board);
    assert.deepEqual(v.errors, [], `${preset.name}: ${v.errors.map((e) => e.message).join(' ')}`);
    const report = mapReport(map);
    assert.equal(report.playableNow, true, `${preset.name} should be playable by the live renderer`);
    // every node must have a seeded position (the map editor / live board would otherwise stack nodes at 0,0)
    for (const n of board.nodes) assert.ok(map.layout.nodePos[n.id], `${preset.name}: ${n.id} has no position`);
    // a team can walk the whole thing end to end
    const pos = { node: 'TX', trail: ['TX'] };
    const res = advance(board, pos, 200, (_node, options) => options[0]);
    assert.equal(res.reachedRx, true, `${preset.name}: could not reach RX`);
  });
}

test('presets have unique ids, sensible round counts, and cover 2- to 5-lane and ring shapes', () => {
  const ids = MAP_PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate preset id');
  for (const p of MAP_PRESETS) {
    assert.ok(p.rounds >= 3 && p.rounds <= 8, `${p.id}: rounds ${p.rounds}`);
    assert.ok(p.teams[0] >= 1 && p.teams[0] <= p.teams[1] && p.teams[1] <= 10, `${p.id}: teams ${p.teams}`);
    assert.equal(presetForBoard(p.build().board)?.id, p.id, `${p.id}: board name must map back to its preset`);
  }
  const laneCounts = new Set(MAP_PRESETS.map((p) => mapReport(p.build()).classicRouteLengths).filter(Boolean).map((r) => Object.keys(r!).length));
  for (const n of [2, 3, 4, 5]) assert.ok(laneCounts.has(n), `no ${n}-lane preset`);
  assert.ok(MAP_PRESETS.some((p) => mapReport(p.build()).classicRouteLengths === null), 'no ring (wheel) preset');
});

for (const preset of MAP_PRESETS) {
  test(`map preset "${preset.name}": no placement-rule problems and no overlapping spaces`, () => {
    const map = preset.build();
    const board = buildBoard(map.board);
    assert.deepEqual(layoutProblems(board, map.rules), []);
    assert.deepEqual(mapReport(map).overlaps, []);
    // the slot column and every stone sit inside the world the renderer paints
    for (const [id, p] of Object.entries(map.layout.nodePos)) assert.ok(p.x > 0 && p.y > 0 && p.x < map.layout.worldW && p.y < map.layout.worldH, `${preset.id}: ${id} outside the world`);
  });
}
