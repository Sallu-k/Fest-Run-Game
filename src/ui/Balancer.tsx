import { useEffect, useMemo, useRef, useState } from 'react';
import { buildBoard } from '../core/board';
import { ClassicBoardConfig, ROUTE_IDS, RouteId, SpecialPlacement, classicLanes, compileClassicBoard, detectClassicShape } from '../core/classicBoard';
import { CARD_TYPES, CardType, RulesConfig, defaultRules } from '../core/types';
import { CHOSEN } from '../data/chosenBoard';
import { layoutProblems } from '../sim/constraints';
import { DEFAULT_TARGETS, Report, scoreReport } from '../sim/metrics';
import { DEFAULT_PMF, SimConfig, defaultSimConfig, pmfMean, normalisePmf } from '../sim/model';
import { Candidate, DEFAULT_SPACE, Evaluated, describe } from '../sim/optimize';
import { recommend } from '../sim/recommend';
import type { WorkerRequest, WorkerResponse } from '../sim/worker';
import { clearBoardOverride, getActiveBoard, setBoardOverride } from '../state/activeBoard';
import { MiniMap } from './board/MiniMap';
import { ROUTE_COLORS } from './board/colors';
import { download } from './Log';
import { getHostStore } from './hooks';

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const CARD_LABEL: Record<CardType, string> = { isi: 'ISI', hop: 'FREQUENCY HOP', orth: 'ORTHOGONALITY' };

// ------------------------------------------------------------------ worker plumbing

type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

function useSimWorker() {
  const ref = useRef<Worker | null>(null);
  const nextId = useRef(1);
  const handlers = useRef(new Map<number, (m: WorkerResponse) => void>());
  useEffect(() => () => ref.current?.terminate(), []);
  const ensure = () => {
    if (!ref.current) {
      const w = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => handlers.current.get(e.data.id)?.(e.data);
      ref.current = w;
    }
    return ref.current;
  };
  return {
    call(req: Req, onMsg: (m: WorkerResponse) => void): () => void {
      const id = nextId.current++;
      handlers.current.set(id, (m) => {
        onMsg(m);
        if (m.type !== 'progress') handlers.current.delete(id);
      });
      ensure().postMessage({ ...req, id } as WorkerRequest);
      return () => {
        // cancel = throw the worker away
        ref.current?.terminate();
        ref.current = null;
        handlers.current.clear();
      };
    },
  };
}

// ------------------------------------------------------------------ report view

function Bar({ label, value, max = 1, color, text }: { label: string; value: number; max?: number; color?: string; text?: string }) {
  return (
    <div className="bar-row">
      <span>{label}</span>
      <div className="track"><i style={{ width: `${Math.min(100, (value / max) * 100)}%`, ['--c' as string]: color }} /></div>
      <span>{text ?? pct(value)}</span>
    </div>
  );
}

export function ReportView({ report, cfg, title }: { report: Report; cfg: SimConfig; title?: string }) {
  const board = useMemo(() => {
    try {
      return buildBoard(cfg.board);
    } catch {
      return null;
    }
  }, [cfg.board]);
  const sc = useMemo(() => scoreReport(report, DEFAULT_TARGETS), [report]);
  const recs = useMemo(() => recommend(report), [report]);
  const R = report.meta.rounds;
  const heat = useMemo(() => {
    const m: Record<string, number> = {};
    const max = Math.max(0.0001, ...report.nodes.map((n) => n.hitRate));
    for (const n of report.nodes) m[n.id] = n.hitRate / max;
    return m;
  }, [report]);
  const kpi = (label: string, value: string, ok?: boolean) => (
    <div className={`kpi ${ok === true ? 'ok' : ok === false ? 'bad' : ''}`}><div className="v">{value}</div><div className="l">{label}</div></div>
  );
  const line = (k: string) => sc.lines.find((l) => l.key === k)?.ok;
  return (
    <div>
      {title && <h2>{title}</h2>}
      <p className="muted" style={{ marginTop: 0 }}>
        {report.meta.games.toLocaleString()} simulated games (+ {report.meta.parityGames.toLocaleString()} route-parity games) · {report.meta.teams} teams · {R} rounds · score {sc.score.toFixed(1)} (lower is better)
      </p>
      <div className="kpis">
        {kpi('Mean finish round (qualifiers)', report.finish.meanQualRound.toFixed(2))}
        {kpi('Median finish round', String(report.finish.medianQualRound))}
        {kpi('Decided by round 4', pct(report.finish.endByRound[Math.min(3, R - 1)]), line('endBy4'))}
        {kpi(`Decided by round ${R}`, pct(report.finish.endByRound[R - 1]), line('endByFinal'))}
        {kpi('Decided by fallback', pct(report.finish.fallbackPct), report.finish.fallbackPct <= 0.15)}
        {kpi('Average team reaches RX (by last round)', pct(report.avgTeam.reachByRound[R - 1]), line('avgReachFinal'))}
        {kpi('Path parity gap (qualify)', `${report.parityGap.qualifyPp.toFixed(1)} pp`, line('parityQualGapPp'))}
        {kpi('Booster landings / team', report.perTeam.booster.toFixed(2), line('boosterPerTeam'))}
        {kpi('Cards earned / team', report.cards.reduce((a, c) => a + c.gainedPerTeam, 0).toFixed(2), line('cardsPerTeam'))}
        {kpi('Spaces lost to ISI / team', report.isiStepsPerTeam.toFixed(2), line('isiSteps'))}
        {kpi('Avg gap 1st→last (mid game)', report.rounds.gap[Math.min(2, R - 1)].toFixed(1), line('gapMid'))}
        {kpi('Teams within 3 spaces (mid game)', report.rounds.neighbors[Math.min(2, R - 1)].toFixed(1), line('neighborsMid'))}
      </div>

      <h2 style={{ marginTop: 18 }}>RECOMMENDATIONS</h2>
      {recs.map((r) => (
        <div key={r.id} className={`rec ${r.severity}`}><b>{r.title}</b><span>{r.detail}</span></div>
      ))}

      <h2 style={{ marginTop: 18 }}>PATHS</h2>
      <table className="tbl">
        <thead><tr><th>Path</th><th>Len</th><th>Chosen by</th><th>Qualify (mixed)</th><th>Qualify (parity)</th><th>Mean finish (parity)</th><th>Reach RX</th><th>Specials on branch</th></tr></thead>
        <tbody>
          {report.routes.map((m, i) => {
            const p = report.parity[i];
            return (
              <tr key={m.id}>
                <td style={{ color: ROUTE_COLORS[(m.label ?? m.id) as RouteId], fontWeight: 800 }}>PATH {m.label ?? m.id}</td>
                <td>{m.length}</td>
                <td>{pct(m.usage)}</td>
                <td>{pct(m.qualifyRate, 1)}</td>
                <td>{pct(p.qualifyRate, 1)}</td>
                <td>{p.meanFinish.toFixed(2)} rd</td>
                <td>{pct(p.reachRate)}</td>
                <td>{p.specialsOnBranch.chance}× chance · {p.specialsOnBranch.noise}× noise · {p.specialsOnBranch.booster}× boost</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="bal-grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', marginTop: 18 }}>
        <div>
          <h2>SPECIAL-SPACE HIT FREQUENCY</h2>
          <div className="bars">
            {report.nodes.map((n) => (
              <Bar key={n.id} label={`${n.id} ${n.type}${n.card ? ` (${n.card})` : ''}`} value={n.hitRate} max={Math.max(0.3, ...report.nodes.map((x) => x.hitRate))} color={n.type === 'chance' ? '#e879f9' : n.type === 'noise' ? '#f87171' : '#4ade80'} />
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Share of teams that land on each special space during a game.</p>
        </div>
        <div>
          <h2>FINISH ROUND OF THE {report.meta.slots} QUALIFIERS</h2>
          <div className="bars">
            {report.finish.qualRoundShare.map((v, i) => <Bar key={i} label={`Round ${i + 1}`} value={v} />)}
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Game decided by: {report.finish.endByRound.map((x, i) => `R${i + 1} ${pct(x)}`).join(' · ')}</p>
        </div>
      </div>

      {board && (
        <div className="mini-board" style={{ marginTop: 14, aspectRatio: '16/9' }}>
          <MiniMap cfg={cfg.board} rules={cfg.rules} heat={heat} showIds />
        </div>
      )}

      <h2 style={{ marginTop: 18 }}>CARDS</h2>
      <table className="tbl">
        <thead><tr><th>Card</th><th>Earned by</th><th>Earned / team</th><th>Used / team</th><th>Blocked by ORTH</th><th>Qualify uplift*</th></tr></thead>
        <tbody>
          {report.cards.map((c) => (
            <tr key={c.card}><td>{CARD_LABEL[c.card]}</td><td>{pct(c.gainRate, 1)}</td><td>{c.gainedPerTeam.toFixed(3)}</td><td>{c.usedPerTeam.toFixed(3)}</td><td>{c.card === 'orth' ? '—' : pct(c.blockedShare)}</td><td>{(c.uplift * 100).toFixed(1)} pp</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 12 }}>* Teams that earned the card vs teams of similar skill that did not. ISI's value is mostly what it does to <i>rivals</i>, so its uplift for the holder is small or negative.</p>

      <h2 style={{ marginTop: 18 }}>POSITION AT THE END OF EACH ROUND (games still running)</h2>
      <table className="tbl">
        <thead><tr><th>Round</th><th>Games still running</th><th>Avg spaces to go</th><th>Avg gap 1st→last</th><th>Avg teams within 3 spaces</th></tr></thead>
        <tbody>
          {report.rounds.avgRemaining.map((v, i) => (
            <tr key={i}><td>{i + 1}</td><td>{pct(report.rounds.stillRunning[i])}</td><td>{v ? v.toFixed(1) : '—'}</td><td>{report.rounds.gap[i] ? report.rounds.gap[i].toFixed(1) : '—'}</td><td>{report.rounds.neighbors[i] ? report.rounds.neighbors[i].toFixed(1) : '—'}</td></tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: 18 }}>SKILL, COMEBACKS AND CLUSTERING</h2>
      <div className="kv">
        <span>Top-skill third qualifies</span><b>{pct(report.terciles.qualifyRate[2])}</b>
        <span>Middle third qualifies</span><b>{pct(report.terciles.qualifyRate[1])}</b>
        <span>Bottom third qualifies</span><b>{pct(report.terciles.qualifyRate[0])}</b>
        <span>Qualifiers from outside the top {report.meta.slots} after round 2 (comebacks)</span><b>{pct(report.comeback.share)}</b>
        <span>Bottom-half-after-round-2 teams that still qualify</span><b>{pct(report.comeback.bottomHalfQualify)}</b>
        <span>Contenders (qualified or within 6 spaces) before the last round</span><b>{report.alive.mean.toFixed(1)} teams</b>
        <span>Games with fewer contenders than slots</span><b>{pct(report.alive.pBelowSlots)}</b>
        <span>Teams within 3 spaces of RX when the game ends</span><b>{report.cluster.meanNearRx.toFixed(1)}</b>
        <span>Games ending with ~all teams beside RX</span><b>{pct(report.cluster.pAllNear)}</b>
        <span>Quick-question accuracy observed (Chance / Noise)</span><b>{pct(report.quick.chanceCorrect)} / {pct(report.quick.noiseCorrect)}</b>
        <span>Average spaces gained per Frequency Hop</span><b>{report.hopGainAvg.toFixed(1)}</b>
      </div>

      <h2 style={{ marginTop: 18 }}>RESULT VS TARGETS</h2>
      <table className="tbl">
        <thead><tr><th>Metric</th><th>Value</th><th>Target</th><th /></tr></thead>
        <tbody>
          {sc.lines.map((l) => {
            const f = (x: number) => (l.unit === 'pct' ? pct(x) : x.toFixed(2));
            return (
              <tr key={l.key}><td>{l.label}</td><td>{f(l.value)}</td><td>{f(l.lo)} – {f(l.hi)}</td><td style={{ color: l.ok ? 'var(--green)' : 'var(--red)' }}>{l.ok ? '✔' : '✘'}</td></tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ main balancer

type Choice = 'none' | 'chance:isi' | 'chance:hop' | 'chance:orth' | 'noise' | 'booster';
const CYCLE: Choice[] = ['none', 'chance:isi', 'chance:hop', 'chance:orth', 'noise', 'booster'];

function choiceOf(p: SpecialPlacement | undefined): Choice {
  if (!p) return 'none';
  return p.type === 'chance' ? (`chance:${p.card ?? 'isi'}` as Choice) : p.type;
}

/** The Balancer's structural editor works on the classic (single-fork → 3-branches → single-merge)
 *  parametric shape — see core/classicBoard.ts's module comment — compiled to the live graph shape
 *  whenever a simulation actually runs. If the active board (which may have been hand-built in the
 *  Map Editor into a non-classic graph) isn't classic-shaped, falls back to the recommended layout. */
function initialClassicBoard(): ClassicBoardConfig {
  const active = getActiveBoard();
  try {
    const b = buildBoard(active.cfg);
    const shape = detectClassicShape(b);
    const lanes = shape ? classicLanes(b) : null;
    if (shape && lanes) {
      const specials: SpecialPlacement[] = [];
      const collect = (ids: string[]) => {
        for (const id of ids) {
          const n = b.nodes[b.byId.get(id)!];
          if (n.special) specials.push({ node: id, type: n.special.type, card: n.special.card, amount: n.special.amount });
        }
      };
      collect(lanes.prefix);
      ROUTE_IDS.forEach((r) => collect(lanes.branch[r]));
      collect(lanes.suffix);
      return { name: active.cfg.name, routeLengths: shape.routeLengths, prefixLen: shape.prefixLen, suffixLen: shape.suffixLen, specials };
    }
  } catch {
    /* fall through to the recommended layout */
  }
  return CHOSEN.board;
}

function initialConfig(classic: ClassicBoardConfig): SimConfig {
  const active = getActiveBoard();
  const compiled = compileClassicBoard(classic);
  return { ...defaultSimConfig(compiled, active.rules), ...CHOSEN.model, board: compiled, rules: active.rules };
}

export function Balancer() {
  const [classic, setClassicState] = useState<ClassicBoardConfig>(initialClassicBoard);
  const [cfg, setCfg] = useState<SimConfig>(() => initialConfig(classic));
  const [games, setGames] = useState(100000);
  const [seed, setSeed] = useState(12345);
  const [report, setReport] = useState<{ report: Report; cfg: SimConfig } | null>(null);
  const [progress, setProgress] = useState<{ frac: number; msg: string } | null>(null);
  const [busy, setBusy] = useState<'sim' | 'search' | null>(null);
  const [tab, setTab] = useState<'report' | 'saved' | 'search'>('saved');
  const [finalists, setFinalists] = useState<Evaluated[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [selNode, setSelNode] = useState<string | null>(null);
  const worker = useSimWorker();
  const cancelRef = useRef<(() => void) | null>(null);

  const bc = classic;
  const rules = cfg.rules;
  /** Edits the classic source; keeps `cfg.board` (the compiled graph the simulator/worker use) in sync
   *  whenever the edit compiles — an invalid transient state (e.g. prefixLen briefly 0) is shown via
   *  `built.error` below without discarding `cfg.board`'s last valid value. */
  const setBoard = (patch: Partial<ClassicBoardConfig>) => {
    const next = { ...classic, ...patch };
    setClassicState(next);
    try {
      const compiled = compileClassicBoard(next);
      setCfg((c) => ({ ...c, board: compiled }));
    } catch {
      /* built.error (derived from `classic` directly) shows the problem */
    }
  };
  const setRules = (r: Partial<RulesConfig>) => setCfg((c) => ({ ...c, rules: { ...c.rules, ...r } }));

  const built = useMemo(() => {
    try {
      const compiled = compileClassicBoard(bc);
      const b = buildBoard(compiled);
      return { compiled, board: b, error: null as string | null, problems: layoutProblems(b, rules) };
    } catch (e) {
      return { compiled: null as ReturnType<typeof compileClassicBoard> | null, board: null, error: (e as Error).message, problems: [] as string[] };
    }
  }, [bc, rules]);
  const shape = useMemo(() => (built.board ? detectClassicShape(built.board) : null), [built.board]);
  const lanes = useMemo(() => (built.board ? classicLanes(built.board) : null), [built.board]);

  const specialAt = (id: string) => bc.specials.find((s) => s.node === id);
  const cycleNode = (id: string) => {
    if (id === 'TX' || id === 'RX') return;
    const cur = choiceOf(specialAt(id));
    const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
    const rest = bc.specials.filter((s) => s.node !== id);
    if (next !== 'none') {
      rest.push(next.startsWith('chance') ? { node: id, type: 'chance', card: next.split(':')[1] as CardType } : { node: id, type: next as 'noise' | 'booster' });
    }
    setBoard({ specials: rest });
    setSelNode(id);
  };

  const run = () => {
    if (!built.board) return;
    setBusy('sim');
    setProgress({ frac: 0, msg: 'starting…' });
    const snapshot = cfg;
    cancelRef.current = worker.call({ type: 'suite', cfg: snapshot, games, seed }, (m) => {
      if (m.type === 'progress') setProgress({ frac: m.frac, msg: m.msg });
      else if (m.type === 'suite-done') {
        setReport({ report: m.report, cfg: snapshot });
        setBusy(null);
        setProgress(null);
        setTab('report');
      } else if (m.type === 'error') {
        setBusy(null);
        setStatus(`Simulation failed: ${m.message}`);
      }
    });
  };

  const autoTune = () => {
    setBusy('search');
    setProgress({ frac: 0, msg: 'starting search…' });
    const snapshot = cfg;
    cancelRef.current = worker.call(
      {
        type: 'search',
        base: snapshot,
        baseBoard: classic,
        params: {
          seed,
          finalSeed: seed + 101,
          space: DEFAULT_SPACE,
          screenGames: 3000,
          populationSize: 30,
          generations: 5,
          keep: 6,
          offspring: 5,
          finalGames: Math.min(games, 40000),
          finalists: 5,
          winnerGames: Math.min(games, 80000),
          seeds: [{ label: 'current', board: classic, rules: snapshot.rules } as Candidate],
        },
      },
      (m) => {
        if (m.type === 'progress') setProgress({ frac: m.frac, msg: m.msg });
        else if (m.type === 'search-done') {
          setFinalists([m.winner, ...m.finalists.filter((f) => f.cand.label !== m.winner.cand.label)]);
          setBusy(null);
          setProgress(null);
          setTab('search');
          setStatus(`Searched ${m.screened} layouts. Best found below — load it to inspect.`);
        } else if (m.type === 'error') {
          setBusy(null);
          setStatus(`Search failed: ${m.message}`);
        }
      },
    );
  };

  const cancel = () => {
    cancelRef.current?.();
    setBusy(null);
    setProgress(null);
  };

  const loadCandidate = (c: Candidate) => {
    setClassicState(c.board);
    setCfg((cur) => ({ ...cur, board: compileClassicBoard(c.board), rules: c.rules }));
    setStatus(`Loaded layout: ${describe(c)}`);
  };
  const loadRecommended = () => {
    setClassicState(CHOSEN.board);
    setCfg((c) => ({ ...c, board: savedCfg.board, rules: savedCfg.rules }));
    setStatus('Loaded the recommended layout.');
  };

  const pmfRaw = cfg.pmf;
  const pmfNorm = normalisePmf(pmfRaw);
  const gameOptions = [10000, 50000, 100000, 250000];

  const savedCfg: SimConfig = useMemo(() => {
    const compiled = compileClassicBoard(CHOSEN.board);
    return { ...defaultSimConfig(compiled, CHOSEN.rules), ...CHOSEN.model, board: compiled, rules: CHOSEN.rules };
  }, []);

  return (
    <div className="app" style={{ overflow: 'auto' }}>
      <div className="topbar">
        <div className="brand">BOARD BALANCER<small>ADMIN</small></div>
        <span className="muted">Simulate thousands of games to test a layout before the event.</span>
        <div className="grow" />
        <a className="btn small" href="#/" style={{ textDecoration: 'none' }}>← Back to game</a>
      </div>
      <div className="bal">
        <div className="bal-grid">
          {/* ---------------- parameters */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="panel">
              <h2>SIMULATION</h2>
              <div className="field">
                <label>GAMES TO SIMULATE</label>
                <div className="row">
                  {gameOptions.map((g) => <button key={g} className={`btn small ${games === g ? 'on' : ''}`} onClick={() => setGames(g)}>{g.toLocaleString()}</button>)}
                </div>
              </div>
              <div className="row">
                <div className="field"><label>TEAMS</label><input className="input" type="number" min={2} max={10} value={cfg.teams} onChange={(e) => setCfg({ ...cfg, teams: Math.max(2, Math.min(10, Number(e.target.value) || 10)) })} style={{ width: 70 }} /></div>
                <div className="field"><label>ROUNDS</label>
                  <select className="select" value={cfg.rounds} onChange={(e) => setCfg({ ...cfg, rounds: Number(e.target.value) as number })}>{[3, 4, 5, 6, 7, 8].map((r) => <option key={r} value={r}>{r}</option>)}</select>
                </div>
                <div className="field"><label>SEED</label><input className="input" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 1)} style={{ width: 96 }} /></div>
              </div>
              <div className="row">
                <button className="btn primary" disabled={!!busy || !!built.error} onClick={run}>▶ Run simulation</button>
                <button className="btn" disabled={!!busy || !!built.error} onClick={autoTune} title="Searches for a better layout starting from this one (small budget; use `npm run optimize` for the full search)">✦ Auto-tune layout</button>
                {busy && <button className="btn danger small" onClick={cancel}>Cancel</button>}
              </div>
              {progress && (
                <div style={{ marginTop: 10 }}>
                  <div className="progress"><i style={{ width: `${progress.frac * 100}%` }} /></div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{progress.msg}</div>
                </div>
              )}
              {status && <p className="muted" style={{ fontSize: 12 }}>{status}</p>}
            </div>

            <div className="panel">
              <h2>BOARD STRUCTURE</h2>
              <div className="row">
                {ROUTE_IDS.map((r) => (
                  <div className="field" key={r}>
                    <label style={{ color: ROUTE_COLORS[r] }}>PATH {r} LENGTH</label>
                    <input className="input" type="number" min={6} max={30} value={bc.routeLengths[r]} style={{ width: 70 }} onChange={(e) => setBoard({ routeLengths: { ...bc.routeLengths, [r]: Number(e.target.value) || 15 } })} />
                  </div>
                ))}
              </div>
              <div className="row">
                <div className="field"><label>SHARED START (junction at)</label><input className="input" type="number" min={1} max={6} value={bc.prefixLen} style={{ width: 70 }} onChange={(e) => setBoard({ prefixLen: Number(e.target.value) || 1 })} /></div>
                <div className="field"><label>SHARED FINISH (merge)</label><input className="input" type="number" min={0} max={6} value={bc.suffixLen} style={{ width: 70 }} onChange={(e) => setBoard({ suffixLen: Number(e.target.value) || 0 })} /></div>
              </div>
              {built.error && <div className="warn">⚠ {built.error}</div>}
              {shape && lanes && (
                <div className="muted" style={{ fontSize: 12 }}>
                  Own spaces per path: {ROUTE_IDS.map((r) => shape.branchLen[r]).join(' / ')} · junction at {lanes.prefix.length ? lanes.prefix[lanes.prefix.length - 1] : lanes.tx}
                </div>
              )}
            </div>

            <div className="panel">
              <h2>RULES</h2>
              <div className="row">
                {([['isiRange', 'ISI RANGE', 1, 8], ['isiPenalty', 'ISI PUSH-BACK', 1, 5], ['boosterAmount', 'BOOSTER +', 1, 6], ['noiseBack', 'NOISE −', 1, 5]] as const).map(([k, l, lo, hi]) => (
                  <div className="field" key={k}><label>{l}</label><input className="input" type="number" min={lo} max={hi} style={{ width: 70 }} value={rules[k]} onChange={(e) => setRules({ [k]: Math.max(lo, Math.min(hi, Number(e.target.value) || lo)) })} /></div>
                ))}
              </div>
              <div className="row">
                <div className="field"><label>HOP RANGE (blank = any team)</label><input className="input" type="number" min={1} style={{ width: 100 }} value={rules.hopMaxRange ?? ''} onChange={(e) => setRules({ hopMaxRange: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) })} /></div>
              </div>
              <label className="row"><input type="checkbox" checked={rules.orthBlocksIsi} onChange={(e) => setRules({ orthBlocksIsi: e.target.checked })} /> ORTHOGONALITY blocks ISI</label>
              <label className="row"><input type="checkbox" checked={rules.orthBlocksHop} onChange={(e) => setRules({ orthBlocksHop: e.target.checked })} /> ORTHOGONALITY blocks FREQUENCY HOP</label>
            </div>

            <div className="panel">
              <h2>ANSWER MODEL (correct answers out of 6)</h2>
              {pmfRaw.map((v, k) => (
                <div className="pmf-row" key={k}>
                  <b>{k}</b>
                  <input type="range" min={0} max={40} value={v * 100} onChange={(e) => { const next = [...pmfRaw]; next[k] = Number(e.target.value) / 100; setCfg({ ...cfg, pmf: next }); }} />
                  <span>{pct(pmfNorm[k], 1)}</span>
                </div>
              ))}
              <div className="row" style={{ marginTop: 6 }}>
                <span className="muted">mean {pmfMean(pmfRaw).toFixed(2)} correct</span>
                <button className="btn small ghost" onClick={() => setCfg({ ...cfg, pmf: [...DEFAULT_PMF] })}>reset</button>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <div className="field"><label>TEAM SKILL SPREAD σ</label><input className="input" type="number" step={0.05} min={0} max={1} style={{ width: 80 }} value={cfg.skillSigma} onChange={(e) => setCfg({ ...cfg, skillSigma: Math.max(0, Number(e.target.value) || 0) })} /></div>
                <div className="field"><label>QUICK-Q ACCURACY</label><input className="input" type="number" step={0.05} min={0.05} max={0.95} style={{ width: 80 }} value={cfg.quickBase} onChange={(e) => setCfg({ ...cfg, quickBase: Math.max(0.05, Math.min(0.95, Number(e.target.value) || 0.6)) })} /></div>
              </div>
            </div>

            <div className="panel">
              <h2>SPECIAL SPACES</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>Click a space on the map to cycle: empty → CHANCE (ISI / HOP / ORTH) → NOISE → BOOSTER → empty.</p>
              {built.compiled && (
                <div className="mini-board" style={{ aspectRatio: '16/9' }}>
                  <MiniMap cfg={built.compiled} rules={rules} showIds onNodeClick={cycleNode} selectedNode={selNode} />
                </div>
              )}
              {built.problems.map((p) => <div className="warn" key={p}>⚠ {p}</div>)}
              {built.board && !built.problems.length && <div className="ok-text" style={{ fontSize: 12, marginTop: 6 }}>✔ Placement rules satisfied</div>}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn small" onClick={loadRecommended}>Load recommended</button>
                <button className="btn small" onClick={() => download('festrun-board.json', JSON.stringify({ board: classic, rules: cfg.rules }, null, 2), 'application/json')}>Export JSON</button>
                <button className="btn small" onClick={() => setShowImport(!showImport)}>Import JSON</button>
              </div>
              {showImport && (
                <div style={{ marginTop: 8 }}>
                  <textarea className="input" style={{ width: '100%', height: 90 }} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{"board": {...}, "rules": {...}}' />
                  <button className="btn small" onClick={() => {
                    try {
                      const o = JSON.parse(importText) as { board: ClassicBoardConfig; rules: RulesConfig };
                      const compiled = compileClassicBoard(o.board);
                      setClassicState(o.board);
                      setCfg((c) => ({ ...c, board: compiled, rules: { ...defaultRules(), ...o.rules } }));
                      setShowImport(false);
                      setStatus('Imported layout.');
                    } catch (e) {
                      setStatus(`Import failed: ${(e as Error).message}`);
                    }
                  }}>Load</button>
                </div>
              )}
            </div>

            <div className="panel">
              <h2>USE IN THE GAME</h2>
              <div className="row">
                <button className="btn go" disabled={!!built.error} onClick={() => {
                  if (getHostStore().get().phase !== 'setup') { setStatus('A game is in progress — reset it first, then apply.'); return; }
                  setBoardOverride(classic, cfg.rules);
                  setStatus('Applied! The next new game will use this layout. (Use "recommended" on the setup screen to undo.)');
                }}>Apply to next game</button>
                <button className="btn small" onClick={() => { clearBoardOverride(); setStatus('Back to the recommended layout for new games.'); }}>Use recommended again</button>
              </div>
            </div>
          </div>

          {/* ---------------- results */}
          <div className="panel" style={{ minHeight: 400 }}>
            <div className="tabs">
              <button className={`btn small ${tab === 'saved' ? 'on' : ''}`} onClick={() => setTab('saved')}>★ Recommended layout (saved)</button>
              <button className={`btn small ${tab === 'report' ? 'on' : ''}`} onClick={() => setTab('report')} disabled={!report}>Your simulation report</button>
              <button className={`btn small ${tab === 'search' ? 'on' : ''}`} onClick={() => setTab('search')} disabled={!finalists.length}>Auto-tune results</button>
            </div>

            {tab === 'report' && report && <ReportView report={report.report} cfg={report.cfg} title="SIMULATION REPORT" />}
            {tab === 'report' && !report && <p className="muted">Run a simulation to see the report.</p>}

            {tab === 'search' && (
              <div>
                <h2>AUTO-TUNE RESULTS</h2>
                <p className="muted" style={{ fontSize: 12 }}>Small in-browser search. For the full search (thousands of layouts, ≥100k games each) run <code>npm run optimize</code>.</p>
                <table className="tbl">
                  <thead><tr><th>Layout</th><th>Score</th><th>Parity gap</th><th>Decided by R5</th><th /></tr></thead>
                  <tbody>
                    {finalists.map((f, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 11 }}>{describe(f.cand)}</td>
                        <td>{f.score.toFixed(1)}</td>
                        <td>{f.report.parityGap.qualifyPp.toFixed(1)} pp</td>
                        <td>{pct(f.report.finish.endByRound[f.report.meta.rounds - 1])}</td>
                        <td className="row"><button className="btn small" onClick={() => loadCandidate(f.cand)}>Load</button><button className="btn small" onClick={() => { setReport({ report: f.report, cfg: { ...cfg, board: compileClassicBoard(f.cand.board), rules: f.cand.rules } }); setTab('report'); }}>Report</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'saved' && (
              <div>
                <h2>RECOMMENDED LAYOUT — CHOSEN BY SIMULATION</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                  Generated {new Date(CHOSEN.generatedAt).toLocaleString()} · {CHOSEN.screenedLayouts.toLocaleString()} layouts screened · finalists simulated for {CHOSEN.gamesPerFinalist.toLocaleString()} games each · winner re-run for {CHOSEN.winnerGames.toLocaleString()}.
                </p>
                <div className="panel" style={{ marginBottom: 14 }}>
                  <h3>WHY THESE POSITIONS</h3>
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>{CHOSEN.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
                <ReportView report={CHOSEN.report} cfg={savedCfg} />
                <h2 style={{ marginTop: 22 }}>LAYOUT COMPARISON</h2>
                <table className="tbl">
                  <thead><tr><th>Layout</th><th>Score</th><th>Parity gap</th><th>Finish gap</th><th>A / B / C chosen</th><th>Decided by R5</th><th>Fallback</th></tr></thead>
                  <tbody>
                    {CHOSEN.candidates.map((c) => (
                      <tr key={c.label} title={c.description}>
                        <td><b>{c.label}</b><div className="muted" style={{ fontSize: 10 }}>{c.description}</div></td>
                        <td>{c.score.toFixed(1)}</td>
                        <td>{c.report.parityGap.qualifyPp.toFixed(1)} pp</td>
                        <td>{c.report.parityGap.finishRounds.toFixed(2)} rd</td>
                        <td>{c.report.routes.map((r) => pct(r.usage)).join(' / ')}</td>
                        <td>{pct(c.report.finish.endByRound[4] ?? 0)}</td>
                        <td>{pct(c.report.finish.fallbackPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h2 style={{ marginTop: 22 }}>ROBUSTNESS</h2>
                <table className="tbl">
                  <thead><tr><th>Scenario</th><th>Parity gap</th><th>Decided by last round</th><th>Fallback</th><th>Top / bottom third qualify</th></tr></thead>
                  <tbody>
                    <tr><td><b>4-round game</b><div className="muted" style={{ fontSize: 10 }}>fallback ranking decides most games</div></td><td>{CHOSEN.report4Rounds.parityGap.qualifyPp.toFixed(1)} pp</td><td>{pct(CHOSEN.report4Rounds.finish.endByRound[3] ?? 0)}</td><td>{pct(CHOSEN.report4Rounds.finish.fallbackPct)}</td><td>{pct(CHOSEN.report4Rounds.terciles.qualifyRate[2])} / {pct(CHOSEN.report4Rounds.terciles.qualifyRate[0])}</td></tr>
                    {CHOSEN.sensitivity.map((s) => (
                      <tr key={s.label}><td><b>{s.label}</b><div className="muted" style={{ fontSize: 10 }}>{s.note}</div></td><td>{s.report.parityGap.qualifyPp.toFixed(1)} pp</td><td>{pct(s.report.finish.endByRound[4] ?? 0)}</td><td>{pct(s.report.finish.fallbackPct)}</td><td>{pct(s.report.terciles.qualifyRate[2])} / {pct(s.report.terciles.qualifyRate[0])}</td></tr>
                    ))}
                  </tbody>
                </table>
                <div className="row" style={{ marginTop: 14 }}>
                  <button className="btn small" onClick={loadRecommended}>Load into editor</button>
                  <span className="muted" style={{ fontSize: 12 }}>Cards: {CARD_TYPES.map((c) => CARD_LABEL[c]).join(' · ')}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
