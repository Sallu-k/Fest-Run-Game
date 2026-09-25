// Board Balancer, command-line edition:
//   npm run optimize          full run  (≈ a few minutes on 4 cores)
//   npm run optimize:quick    small smoke run
// Searches for a balanced layout, confirms finalists at ≥100k games each, re-runs the winner at 250k,
// then writes src/data/chosenBoard.ts and reports/balance-report.{md,json}.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileClassicBoard } from '../src/core/classicBoard';
import { defaultRules } from '../src/core/types';
import { ChosenData, CandidateRow, SensitivityRow } from '../src/sim/chosen';
import { explainLayout, effectiveLengths } from '../src/sim/explain';
import { DEFAULT_TARGETS, Report, scoreReport } from '../src/sim/metrics';
import { SimConfig, defaultSimConfig, tiltPmf } from '../src/sim/model';
import { baselineCandidates, naiveBaseline, optimizerWinner, recommended, refinementVariants } from '../src/sim/layouts';
import { Candidate, Evaluated, describe, fingerprint, runSearch, simplicityPenalty } from '../src/sim/optimize';
import { recommend } from '../src/sim/recommend';
import { EvalPool } from './pool';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string, d: number) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? Number(argv[i + 1]) : d;
};

const quick = flag('quick');
const cfg = { budget: quick ? { screen: 3000, pop: 40, gens: 4, keep: 8, kids: 5, finalists: 6, final: 20000, winner: 40000, restarts: 1 } : { screen: 10000, pop: 160, gens: 18, keep: 12, kids: 8, finalists: 12, final: opt('games', 100000), winner: 250000, restarts: opt('restarts', 4) } };
const SEED = opt('seed', 20260921);
const FINAL_SEED = 424242;

const base: SimConfig = defaultSimConfig(compileClassicBoard(naiveBaseline().board), defaultRules());
const pool = new EvalPool();
const simFor = (c: Candidate, over: Partial<SimConfig> = {}): SimConfig => ({ ...base, board: compileClassicBoard(c.board), rules: c.rules, ...over });
const evaluate = (jobs: { cand: Candidate; games: number; seed: number }[]) =>
  Promise.all(jobs.map((j) => pool.run(simFor(j.cand), j.games, j.seed)));

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${m}`);

async function main() {
  log(`Board Balancer — ${quick ? 'QUICK' : 'FULL'} run, seed ${SEED}, ${cfg.budget.restarts} restart(s), ${cfg.budget.final} games per finalist`);

  const refine = flag('refine');
  const allFinalists = new Map<string, Evaluated>();
  const winners: Evaluated[] = [];
  let screened = 0;
  let searchRows: CandidateRow[] = [];
  let refineRows: CandidateRow[] = [];
  let winner: Evaluated;
  let wCand: Candidate;
  if (refine) {
    // Re-use the last full search (reports/search-run-final.json) and evaluate the designer refinement on top of it.
    const prev = JSON.parse(fs.readFileSync(path.join(root, 'reports/search-run-final.json'), 'utf8')) as ChosenData;
    screened = prev.screenedLayouts;
    searchRows = prev.candidates.map((c) => (c.label === 'RECOMMENDED' ? { ...c, label: 'optimizer-winner (pure search)' } : c));
    const rec = recommended();
    log('Refine mode: evaluating the recommended layout and refinement variants…');
    const [recReport, ...varReports] = await Promise.all([
      pool.run(simFor(rec), cfg.budget.winner, FINAL_SEED + 876),
      ...refinementVariants().map((v) => pool.run(simFor(v), cfg.budget.final, FINAL_SEED)),
    ]);
    wCand = rec;
    winner = { cand: rec, report: recReport, score: scoreReport(recReport).score + simplicityPenalty(rec), games: cfg.budget.winner };
    refineRows = refinementVariants().map((v, i) => ({ label: v.label, description: describe(v), score: scoreReport(varReports[i]).score + simplicityPenalty(v), report: varReports[i] }));
    void optimizerWinner;
  } else {
  for (let k = 0; k < cfg.budget.restarts; k++) {
    const res = await runSearch(
      {
        baseBoard: naiveBaseline().board,
        baseRules: base.rules,
        seed: SEED + k * 7919,
        finalSeed: FINAL_SEED,
        screenGames: cfg.budget.screen,
        populationSize: cfg.budget.pop,
        generations: cfg.budget.gens,
        keep: cfg.budget.keep,
        offspring: cfg.budget.kids,
        finalGames: cfg.budget.final,
        finalists: cfg.budget.finalists,
        winnerGames: cfg.budget.winner,
        seeds: baselineCandidates(),
        onProgress: (m, f) => log(`restart ${k + 1}/${cfg.budget.restarts}: ${m} (${(f * 100).toFixed(0)}%)`),
      },
      evaluate,
    );
    screened += res.screened;
    for (const f of res.finalists) allFinalists.set(fingerprint(f.cand), f);
    winners.push(res.winner);
  }
  winners.sort((a, b) => a.score - b.score);
  winner = winners[0];
  wCand = { ...winner.cand, label: 'RECOMMENDED', board: { ...winner.cand.board, name: 'recommended' } };
  }
  log(`Winner: ${describe(wCand)}  (score ${winner.score.toFixed(2)} @ ${winner.games} games)`);

  // ---- extra analyses on the winner
  const analyses: [string, string, Partial<SimConfig>][] = [
    ['weaker teams', 'answer distribution tilted down (θ = −0.35, mean ≈ 2.7 correct)', {}],
    ['stronger teams', 'answer distribution tilted up (θ = +0.35, mean ≈ 3.9 correct)', {}],
    ['wider skill spread', 'team skill spread doubled (σ 0.25 → 0.5)', { skillSigma: 0.5 }],
    ['identical teams', 'no skill differences (σ = 0): pure luck check', { skillSigma: 0.001 }],
    ['8 teams', 'only 8 teams playing', { teams: 8 }],
    ['more careful route choice', 'every team picks routes by expected value', { policyMix: { value: 1, shortest: 0, random: 0 } }],
    ['ISI-happy teams', 'every team always uses ISI when a target exists', { isiUseProb: 1 }],
  ];
  analyses[0][2] = { pmf: tiltPmf(base.pmf, -0.35) };
  analyses[1][2] = { pmf: tiltPmf(base.pmf, 0.35) };
  const sensGames = quick ? 20000 : 100000;
  log('Running 4-round and sensitivity analyses…');
  const [report250, report4, ...sens] = await Promise.all([
    Promise.resolve(winner.report),
    pool.run(simFor(wCand, { rounds: 4 }), sensGames, FINAL_SEED + 5),
    ...analyses.map(([, , over]) => pool.run(simFor(wCand, over), sensGames, FINAL_SEED + 9)),
  ]);
  const sensitivity: SensitivityRow[] = analyses.map(([label, note], i) => ({ label, note, report: sens[i] as Report }));

  // ---- candidate table (top finalists by score, baselines always included)
  const sorted = [...allFinalists.values()].sort((a, b) => a.score - b.score);
  const rows: CandidateRow[] = [];
  if (refine) {
    rows.push({ label: 'RECOMMENDED', description: describe(wCand), score: winner.score, report: winner.report });
    rows.push(...refineRows, ...searchRows);
  } else {
  const take = (e: Evaluated, label: string) => rows.push({ label, description: describe(e.cand), score: e.score, report: e.report });
  take({ ...winner, cand: wCand }, 'RECOMMENDED');
  const wfp = fingerprint(winner.cand);
  let n = 0;
  for (const e of sorted) {
    if (fingerprint(e.cand) === wfp) continue;
    const isBase = ['baseline-even', 'c-heavy-rewards', 'safe-short'].includes(e.cand.label);
    if (isBase) continue;
    if (n++ >= cfg.budget.finalists - 1) break;
    take(e, `search-${n}`);
  }
  for (const e of sorted) if (['baseline-even', 'c-heavy-rewards', 'safe-short'].includes(e.cand.label)) take(e, e.cand.label);
  }

  const model = { ...base } as Partial<SimConfig>;
  delete model.board;
  delete model.rules;
  const winnerSim = simFor(wCand);
  const data: ChosenData = {
    generatedAt: new Date().toISOString(),
    seed: SEED,
    screenedLayouts: screened,
    gamesPerFinalist: cfg.budget.final,
    winnerGames: winner.games,
    board: wCand.board,
    rules: wCand.rules,
    model: model as ChosenData['model'],
    report: report250,
    report4Rounds: report4 as Report,
    sensitivity,
    candidates: rows,
    rationale: explainLayout(compileClassicBoard(wCand.board), wCand.rules, report250, winnerSim),
    effectiveLengths: effectiveLengths(winnerSim),
  };

  // ---- write outputs
  const ts =
    `// GENERATED by \`npm run optimize\` — do not edit by hand (re-run the optimizer instead).\n` +
    `// Generated ${data.generatedAt}; ${screened} layouts screened, ${data.gamesPerFinalist} games per finalist, ${data.winnerGames} for the winner.\n` +
    `import type { ChosenData } from '../sim/chosen';\n\n` +
    `export const CHOSEN: ChosenData = ${JSON.stringify(data, null, 1)};\n\n` +
    `export const CHOSEN_BOARD = CHOSEN.board;\nexport const CHOSEN_RULES = CHOSEN.rules;\n`;
  fs.writeFileSync(path.join(root, 'src/data/chosenBoard.ts'), ts);
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports/balance-report.json'), JSON.stringify(data, null, 1));
  fs.writeFileSync(path.join(root, 'reports/balance-report.md'), markdown(data, winnerSim));
  log('Wrote src/data/chosenBoard.ts, reports/balance-report.md, reports/balance-report.json');
  await pool.close();
}

function markdown(d: ChosenData, sim: SimConfig): string {
  const r = d.report;
  const sc = scoreReport(r, DEFAULT_TARGETS);
  const L: string[] = [];
  L.push('# FestRun — Board Balancer report (Triple Route)', '');
  L.push(`Generated ${d.generatedAt}. Seed ${d.seed}. ${d.screenedLayouts} layouts screened; every finalist simulated for ${d.gamesPerFinalist.toLocaleString()} games (+ ${Math.round(d.gamesPerFinalist / 2).toLocaleString()} route-parity games); the winner re-run for ${d.winnerGames.toLocaleString()}.`, '');
  L.push('## Recommended layout', '', '```', describe({ label: '', board: d.board, rules: d.rules }), '```', '');
  L.push('### Why these positions', '', ...d.rationale.map((x) => `- ${x}`), '');
  L.push('## Result vs targets (5 rounds, 10 teams)', '', '| Metric | Value | Target | |', '|---|---|---|---|');
  for (const l of sc.lines) {
    const f = (x: number) => (l.unit === 'pct' ? pct(x, 0) : x.toFixed(2));
    L.push(`| ${l.label} | ${f(l.value)} | ${f(l.lo)} – ${f(l.hi)} | ${l.ok ? '✔' : '✘'} |`);
  }
  L.push('', '## Path table', '', '| Path | Length | Usage (mixed) | Qualify (parity) | Mean finish (parity) | Reach RX in time |', '|---|---|---|---|---|---|');
  r.routes.forEach((m, i) => {
    const p = r.parity[i];
    L.push(`| ${m.id} | ${m.length} | ${pct(m.usage, 0)} | ${pct(p.qualifyRate)} | ${p.meanFinish.toFixed(2)} | ${pct(p.reachRate, 0)} |`);
  });
  L.push('', `Finish: mean qualifier round ${r.finish.meanQualRound.toFixed(2)}, median ${r.finish.medianQualRound}. Game decided by round: ${r.finish.endByRound.map((x, i) => `R${i + 1} ${pct(x, 0)}`).join(', ')}. Fallback needed: ${pct(r.finish.fallbackPct)} (5 rounds), ${pct(d.report4Rounds.finish.fallbackPct)} (4 rounds).`, '');
  L.push('## Special-space hit frequency', '', '| Node | Type | Teams landing |', '|---|---|---|', ...r.nodes.map((n) => `| ${n.id} | ${n.type}${n.card ? ` (${n.card})` : ''} | ${pct(n.hitRate)} |`), '');
  L.push('## Cards', '', '| Card | Earned by | Used per team | Blocked | Qualify uplift |', '|---|---|---|---|---|', ...r.cards.map((c) => `| ${c.card} | ${pct(c.gainRate)} | ${c.usedPerTeam.toFixed(2)} | ${pct(c.blockedShare, 0)} | ${(c.uplift * 100).toFixed(1)} pp |`), '');
  L.push('## Recommendations for this layout', '', ...recommend(r).map((x) => `- **[${x.severity}] ${x.title}** ${x.detail}`), '');
  L.push('## Layout comparison (all simulated at full size)', '', '| Layout | Score | Parity gap (pp) | Finish gap (rounds) | Usage A/B/C | Decided by R5 | Fallback | Layout |', '|---|---|---|---|---|---|---|---|');
  for (const c of d.candidates) {
    L.push(`| ${c.label} | ${c.score.toFixed(1)} | ${c.report.parityGap.qualifyPp.toFixed(1)} | ${c.report.parityGap.finishRounds.toFixed(2)} | ${c.report.routes.map((x) => pct(x.usage, 0)).join('/')} | ${pct(c.report.finish.endByRound[4] ?? 0, 0)} | ${pct(c.report.finish.fallbackPct, 0)} | \`${c.description}\` |`);
  }
  L.push('', '## Robustness', '', '| Scenario | Parity gap (pp) | Decided by R5 | Fallback | Top / bottom third qualify | Note |', '|---|---|---|---|---|---|');
  L.push(`| 4-round mode | ${d.report4Rounds.parityGap.qualifyPp.toFixed(1)} | ${pct(d.report4Rounds.finish.endByRound[3] ?? 0, 0)} (by R4) | ${pct(d.report4Rounds.finish.fallbackPct, 0)} | ${pct(d.report4Rounds.terciles.qualifyRate[2], 0)} / ${pct(d.report4Rounds.terciles.qualifyRate[0], 0)} | fallback decides most 4-round games |`);
  for (const s of d.sensitivity) L.push(`| ${s.label} | ${s.report.parityGap.qualifyPp.toFixed(1)} | ${pct(s.report.finish.endByRound[4] ?? 0, 0)} | ${pct(s.report.finish.fallbackPct, 0)} | ${pct(s.report.terciles.qualifyRate[2], 0)} / ${pct(s.report.terciles.qualifyRate[0], 0)} | ${s.note} |`);
  L.push('', `Simulation model: pmf ${sim.pmf.join(', ')} · skill σ ${sim.skillSigma} · quick-question base ${sim.quickBase} · route policies ${JSON.stringify(sim.policyMix)}`, `Simplicity penalty of winner: ${simplicityPenalty({ label: '', board: d.board, rules: d.rules }).toFixed(1)}`, '');
  return L.join('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
