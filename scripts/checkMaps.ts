// Checks every shipped map preset: placement rules, overlapping spaces, and a Monte-Carlo run at the
// preset's recommended round count. Use it after adding or changing a map in src/data/mapPresets.ts.
//
//   npm run maps              (20,000 games per map)
//   npm run maps -- 50000     (more games, tighter numbers)
//   npm run maps -- 20000 highway   (one map only)

import { buildBoard } from '../src/core/board';
import { mapReport } from '../src/core/mapEdit';
import { layoutProblems } from '../src/core/placementRules';
import { MAP_PRESETS } from '../src/data/mapPresets';
import { defaultSimConfig } from '../src/sim/model';
import { runSuite } from '../src/sim/suite';

const games = Number(process.argv[2] ?? 20000);
const only = process.argv[3];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

let failed = false;
for (const preset of MAP_PRESETS) {
  if (only && preset.id !== only) continue;
  const map = preset.build();
  const board = buildBoard(map.board);
  const report = mapReport(map);
  const placement = layoutProblems(board, map.rules);
  const teams = Math.min(10, preset.teams[1]);
  const cfg = { ...defaultSimConfig(map.board, map.rules), teams, rounds: preset.rounds };
  const r = runSuite(cfg, { games, seed: 7 });
  const qs = r.parity.map((p) => p.qualifyRate);
  const gap = (Math.max(...qs) - Math.min(...qs)) * 100;
  const decided = r.finish.endByRound[preset.rounds - 1] ?? 0;

  console.log(`\n=== ${preset.name} (${preset.id}) — ${board.nodes.length} spaces, ${preset.rounds} rounds, ${teams} teams, shortest ${report.shortestPath} / longest ${report.longestPath}`);
  console.log('  routes (random choice):', r.parity.map((p) => `${p.id} qualify ${pct(p.qualifyRate)}`).join(' | '), `  → parity gap ${gap.toFixed(1)} pp`);
  console.log('  routes (real choice):  ', r.routes.map((p) => `${p.id} used ${pct(p.usage)}`).join(' | '));
  console.log(`  decided by reaching the finish: ${pct(decided)}  (fallback ${pct(r.finish.fallbackPct)}), mean qualifying round ${r.finish.meanQualRound.toFixed(2)}`);
  console.log(`  top / bottom skill third qualify: ${pct(r.terciles.qualifyRate[2])} / ${pct(r.terciles.qualifyRate[0])}`);
  const issues = [...placement, ...report.overlaps];
  if (issues.length) {
    failed = true;
    console.log('  PROBLEMS:\n   - ' + issues.join('\n   - '));
  }
}
if (failed) process.exitCode = 1;
