import { compileClassicBoard } from '../src/core/classicBoard';
import { defaultSimConfig } from '../src/sim/model';
import { runSuite } from '../src/sim/suite';
import { scoreReport } from '../src/sim/metrics';
import { baselineCandidates } from '../src/sim/layouts';

const games = Number(process.argv[2] ?? 20000);
for (const c of baselineCandidates()) {
  const b = c.board;
  const cfg = defaultSimConfig(compileClassicBoard(b), c.rules);
  const t0 = Date.now();
  const r = runSuite(cfg, { games, seed: 1 });
  const dt = (Date.now() - t0) / 1000;
  const sc = scoreReport(r);
  console.log(`\n=== ${b.name} — ${games}+${r.meta.parityGames} games in ${dt.toFixed(1)}s (${((games + r.meta.parityGames) / dt).toFixed(0)} games/s) score=${sc.score.toFixed(1)}`);
  console.log('routes(mixed):', r.routes.map((x) => `${x.id} use=${(x.usage * 100).toFixed(0)}% q=${(x.qualifyRate * 100).toFixed(0)}% fin=${x.meanFinish.toFixed(2)}`).join(' | '));
  console.log('routes(parity):', r.parity.map((x) => `${x.id} q=${(x.qualifyRate * 100).toFixed(1)}% fin=${x.meanFinish.toFixed(2)} reach=${(x.reachRate * 100).toFixed(0)}%`).join(' | '));
  console.log('endByRound:', r.finish.endByRound.map((x) => (x * 100).toFixed(0) + '%').join(' '), 'fallback', (r.finish.fallbackPct * 100).toFixed(1) + '%', 'meanQ', r.finish.meanQualRound.toFixed(2));
  console.log('avgTeam reach:', r.avgTeam.reachByRound.map((x) => (x * 100).toFixed(0) + '%').join(' '));
  console.log('terc qual:', r.terciles.qualifyRate.map((x) => (x * 100).toFixed(0) + '%').join(' '), 'comeback', (r.comeback.share * 100).toFixed(0) + '%');
  console.log('cards:', r.cards.map((c) => `${c.card} gain=${(c.gainRate * 100).toFixed(0)}% up=${(c.uplift * 100).toFixed(1)}pp`).join(' | '), 'isiSteps/team', r.isiStepsPerTeam.toFixed(2));
  console.log('nodes:', r.nodes.map((n) => `${n.id}:${(n.hitRate * 100).toFixed(0)}%`).join(' '));
  console.log('gap:', r.rounds.gap.map((x) => x.toFixed(1)).join(' '), 'neigh:', r.rounds.neighbors.map((x) => x.toFixed(1)).join(' '));
  console.log('fails:', sc.lines.filter((l) => !l.ok).map((l) => `${l.key}=${l.value.toFixed(2)}[${l.lo}-${l.hi}]`).join(' '));
}
