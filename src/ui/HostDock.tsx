import { useMemo, useState, type ReactNode } from 'react';
import { fallbackRanking, maxSlots, remainingOf } from '../core/engine';
import { Board, CARD_INFO, CARD_TYPES, Team } from '../core/types';
import { getTerms } from '../core/terms';
import { GameState, GameStore, coreOf, getBoard } from '../state/game';
import { ConfirmGrid } from './ConfirmGrid';
import { LogPanel, download, logToCsv, logToText } from './Log';
import { MovementPanel } from './MovementPanel';
import { MovementSummaryPanel } from './MovementSummaryPanel';
import { RoundSummaryPanel } from './RoundSummaryPanel';
import { TeamIcon } from './symbols';
import { beep, useNow } from './hooks';

export function CardChips({ t }: { t: Team }) {
  return (
    <span className="row" style={{ gap: 3 }}>
      {CARD_TYPES.map((c, i) => {
        const st = t.cards[i];
        return (
          <span key={c} className={`card-chip ${st === 1 ? 'held' : st === 2 ? 'used' : 'none'}`} title={`${CARD_INFO[c].label}: ${st === 1 ? 'held' : st === 2 ? 'used' : 'not owned'}`}>
            {CARD_INFO[c].abbr}
          </span>
        );
      })}
    </span>
  );
}

function Acc({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="acc">
      <button onClick={onToggle}>
        <span>{title}</span>
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="acc-body">{children}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ answer phases (RAPID_FIRE / ANSWER_BUFFER)

function RoundReadyPanel({ s, store }: { s: GameState; store: GameStore }) {
  return (
    <div className="panel">
      <h3>ROUND {s.round} — READY</h3>
      <p className="muted" style={{ marginTop: 0 }}>Movement order this round: {s.movementOrder.map((id) => `T${id}`).join(' → ')}</p>
      <button className="btn primary big wide go" onClick={() => { store.startRapidFire(); beep(660, 90, 0.12, 'sine'); }}>▶ START RAPID FIRE (30s)</button>
    </div>
  );
}

function AnswerPhasePanel({ s, store }: { s: GameState; store: GameStore }) {
  const stage = s.timer.stage;
  const paused = !!stage && !s.timer.running && s.timer.remainingMs > 0;
  const canSkip = !!stage && (s.timer.running || s.timer.remainingMs > 0);
  const rapid = s.roundPhase === 'RAPID_FIRE';
  return (
    <div className="panel">
      <h3>{rapid ? getTerms().rapidFire : 'ANSWER BUFFER'}</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        {rapid ? 'All teams answer the same 6 questions now. Answers lock at 0:00.' : 'Final submissions / corrections. Locks at 0:00 — then result confirmation opens.'}
      </p>
      <div className="row">
        <button className="btn warn" disabled={!stage || (!paused && !s.timer.running)} onClick={() => (paused ? store.resume() : store.pause())}>{paused ? '▶ RESUME' : '⏸ PAUSE'}</button>
        <button className="btn small" disabled={!canSkip} onClick={() => store.timerElapsed()}>⏭ Skip timer</button>
        <button className="btn small" onClick={() => (rapid ? store.startAnswerBuffer() : store.startResultConfirm())}>
          {rapid ? 'Skip to buffer ▶' : 'Skip to confirm ▶'}
        </button>
      </div>
      <label className="row" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={s.autoAdvance} onChange={(e) => store.setAutoAdvance(e.target.checked)} /> Auto-advance phases at 0:00
      </label>
      <label className="row"><input type="checkbox" checked={s.sound} onChange={(e) => { store.setSound(e.target.checked); if (e.target.checked) beep(880, 150); }} /> Audible alerts (last 5 s)</label>
    </div>
  );
}

// ------------------------------------------------------------------ control tab

function ControlTab({ s, store, board, openOverrides }: { s: GameState; store: GameStore; board: Board; openOverrides: (tab: 'card' | 'pos') => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const tog = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  if (s.phase === 'fallback') return <FallbackPanel s={s} store={store} />;
  if (s.phase === 'finished' || s.roundPhase === 'GAME_COMPLETE') return <FinishedPanel s={s} store={store} />;

  let body: ReactNode;
  switch (s.roundPhase) {
    case 'ROUND_READY':
      body = <RoundReadyPanel s={s} store={store} />;
      break;
    case 'RAPID_FIRE':
    case 'ANSWER_BUFFER':
      body = <AnswerPhasePanel s={s} store={store} />;
      break;
    case 'RESULT_CONFIRM':
      body = <ConfirmGrid s={s} store={store} />;
      break;
    case 'MOVEMENT_READY':
      body = <MovementSummaryPanel s={s} store={store} board={board} />;
      break;
    case 'ROUND_COMPLETE':
      body = <RoundSummaryPanel s={s} store={store} board={board} />;
      break;
    default:
      // TEAM_MOVING / PATH_DECISION / SPECIAL_RESOLUTION / CARD_DECISION / TEAM_TURN_COMPLETE
      body = <MovementPanel s={s} store={store} board={board} />;
  }

  return (
    <>
      {body}

      <Acc title="Overrides" open={!!open.overrides} onToggle={() => tog('overrides')}>
        <div className="row">
          <button className="btn small" onClick={() => openOverrides('card')}>Award card…</button>
          <button className="btn small" onClick={() => openOverrides('pos')}>Place team (penalty / fix)…</button>
        </div>
      </Acc>

      <Acc title="Game" open={!!open.game} onToggle={() => tog('game')}>
        <div className="row">
          <button className="btn small" disabled={!store.canUndo()} onClick={() => store.undo()}>↩ Undo</button>
          <button className="btn small danger" onClick={() => window.confirm('Reset the entire game? All positions, cards and the log will be lost.') && store.reset()}>Reset</button>
        </div>
      </Acc>
    </>
  );
}

// ------------------------------------------------------------------ fallback + finished + teams

function FallbackPanel({ s, store }: { s: GameState; store: GameStore }) {
  const core = coreOf(s);
  const ranking = fallbackRanking(core, s.rounds);
  const need = maxSlots(core) - s.qualifiers.length;
  const tie = useMemo(() => {
    let slots = need;
    let i = 0;
    while (slots > 0 && i < ranking.length) {
      let j = i + 1;
      while (j < ranking.length && ranking[j].remaining === ranking[i].remaining && ranking[j].finalRoundCorrect === ranking[i].finalRoundCorrect) j++;
      if (j - i <= slots) {
        slots -= j - i;
        i = j;
      } else return { rows: ranking.slice(i, j), slots };
    }
    return null;
  }, [ranking, need]);
  return (
    <div className="panel">
      <h3>FALLBACK RANKING — {need} slot{need === 1 ? '' : 's'} left</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>Furthest along wins → then most correct answers in the final round → then a sudden-death question.</p>
      <table className="tbl">
        <thead><tr><th>#</th><th>Team</th><th className="num">To go</th><th className="num">Final rd</th></tr></thead>
        <tbody>
          {ranking.map((r, i) => (
            <tr key={r.team.id} className={i < need ? 'cur' : ''}>
              <td>{i + 1}</td>
              <td><TeamIcon index={r.team.id - 1} size={16} /> T{r.team.id} {r.team.name}</td>
              <td className="num">{r.remaining}</td>
              <td className="num">{r.finalRoundCorrect}/6</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={() => store.applyFallback()}>Apply ranking</button></div>
      {tie && (
        <div className="prompt" style={{ marginTop: 10 }}>
          <b>TIE — sudden-death question</b>
          <div className="muted" style={{ margin: '4px 0 8px' }}>{tie.slots} slot(s) for these {tie.rows.length} tied teams. Ask a sudden-death question and click the winner:</div>
          <div className="target-list">
            {tie.rows.map((r) => (
              <button key={r.team.id} className="target-row" onClick={() => store.suddenDeathWinner(r.team.id)}>
                <TeamIcon index={r.team.id - 1} size={24} /> <b>T{r.team.id}</b> {r.team.name} <span className="muted">wins</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FinishedPanel({ s, store }: { s: GameState; store: GameStore }) {
  return (
    <div className="panel" style={{ borderColor: 'var(--ok)' }}>
      <h3 style={{ color: 'var(--ok)' }}>{getTerms().allLocked} — QUALIFIED TEAMS</h3>
      <div className="target-list" style={{ gap: 6 }}>
        {s.qualifiers.map((id, i) => {
          const t = s.teams.find((x) => x.id === id)!;
          return (
            <div key={id} className="row" style={{ fontFamily: 'var(--head)', fontWeight: 800, fontSize: 17 }}>
              <span style={{ color: 'var(--warn)', width: 34 }}>#{i + 1}</span>
              <TeamIcon index={id - 1} size={26} /> T{id} {t.name}
            </div>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => store.undo()} disabled={!store.canUndo()}>↩ Undo last action</button>
        <button className="btn danger" onClick={() => window.confirm('Start a new game? This clears the current one.') && store.reset()}>New game</button>
      </div>
    </div>
  );
}

function TeamsTab({ s }: { s: GameState }) {
  const board = getBoard(s.boardCfg);
  return (
    <div className="panel">
      <table className="tbl">
        <thead><tr><th>Team</th><th>At</th><th className="num">To go</th><th>Cards</th></tr></thead>
        <tbody>
          {s.teams.map((t) => (
            <tr key={t.id} className={`${s.mover?.teamId === t.id ? 'cur' : ''} ${t.status !== 'active' ? 'q' : ''}`}>
              <td style={{ fontWeight: 700 }}><TeamIcon index={t.id - 1} size={18} /> T{t.id} <span className="muted" style={{ fontWeight: 500 }}>{t.name.length > 11 ? `${t.name.slice(0, 10)}…` : t.name}</span></td>
              <td>{t.status === 'qualified' ? `#${t.slot} ✔` : t.status === 'out' ? 'out' : t.node}</td>
              <td className="num">{t.status === 'active' ? remainingOf(board, t) : '—'}</td>
              <td><CardChips t={t} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ dock shell

const RAIL_ACTION: Partial<Record<GameState['roundPhase'], { label: string; icon: string; run: (store: GameStore) => void }>> = {
  ROUND_READY: { label: 'Start rapid fire', icon: '▶', run: (s) => s.startRapidFire() },
  RESULT_CONFIRM: { label: 'Confirm all', icon: '✔', run: (s) => s.confirmResults() },
  MOVEMENT_READY: { label: 'Begin movement', icon: '▶', run: (s) => s.beginMovement() },
  TEAM_TURN_COMPLETE: { label: 'Next team', icon: '⏭', run: (s) => s.nextTeamMove() },
  ROUND_COMPLETE: { label: 'Next round', icon: '▶', run: (s) => s.proceedRound() },
};

export function HostDock({
  s, store, board, rail, onToggleRail, openOverrides,
}: {
  s: GameState; store: GameStore; board: Board; rail: boolean; onToggleRail: () => void; openOverrides: (tab: 'card' | 'pos') => void;
}) {
  const [tab, setTab] = useState<'control' | 'teams' | 'log'>('control');
  useNow(1000); // keeps relative UI fresh without re-rendering the board
  if (rail) {
    const action = s.phase === 'playing' ? RAIL_ACTION[s.roundPhase] : undefined;
    return (
      <aside className="dock rail">
        <div className="dock-rail-btns">
          <button className="btn icon-btn" title="Open controls" onClick={onToggleRail}>◀</button>
          {action && <button className="btn icon-btn primary" title={action.label} onClick={() => action.run(store)}>{action.icon}</button>}
          <button className="btn icon-btn" title="Undo" disabled={!store.canUndo()} onClick={() => store.undo()}>↩</button>
        </div>
      </aside>
    );
  }
  return (
    <aside className="dock">
      <div className="dock-head">
        <div className="dock-tabs">
          <button className={`btn ${tab === 'control' ? 'on' : ''}`} onClick={() => setTab('control')}>Control</button>
          <button className={`btn ${tab === 'teams' ? 'on' : ''}`} onClick={() => setTab('teams')}>Teams</button>
          <button className={`btn ${tab === 'log' ? 'on' : ''}`} onClick={() => setTab('log')}>Log</button>
        </div>
        <button className="btn icon-btn" title="Collapse panel" onClick={onToggleRail}>▶</button>
      </div>
      <div className="dock-body">
        {tab === 'control' && <ControlTab s={s} store={store} board={board} openOverrides={openOverrides} />}
        {tab === 'teams' && <TeamsTab s={s} />}
        {tab === 'log' && (
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <button className="btn small" onClick={() => download('festrun-log.csv', logToCsv(s.log))}>CSV</button>
              <button className="btn small" onClick={() => void navigator.clipboard?.writeText(logToText(s.log))}>Copy</button>
            </div>
            <LogPanel log={s.log} max={9999} />
          </div>
        )}
      </div>
    </aside>
  );
}
