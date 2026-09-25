import { GameState, GameStore } from '../state/game';
import { TeamIcon } from './symbols';

/** RESULT_CONFIRM: one row per active team, a 0-6 stepper. Movement is NOT applied here — the board
 *  stays exactly as it was at round start until BEGIN MOVEMENT (shown after CONFIRM ALL). */
export function ConfirmGrid({ s, store }: { s: GameState; store: GameStore }) {
  const active = s.teams.filter((t) => t.status === 'active');
  const entered = active.filter((t) => s.registeredMoves[t.id] != null).length;
  return (
    <div className="panel">
      <h3>RESULT CONFIRMATION</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
        Enter (or correct) every team's correct-answer count out of 6. Nothing moves yet — this just registers how far each team will travel.
      </p>
      <div className="confirm-grid">
        {active.map((t) => {
          const k = s.registeredMoves[t.id]?.correct;
          return (
            <div key={t.id} className={`confirm-row ${k == null ? 'todo' : ''}`}>
              <div className="who" style={{ ['--tc' as string]: t.color }}>
                <TeamIcon index={t.id - 1} size={26} />
                <b>T{t.id}</b>
                <span className="muted">{t.name}</span>
              </div>
              <div className="steppers">
                {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                  <button key={n} className={`btn small ${k === n ? 'sel' : ''}`} onClick={() => store.enterResult(t.id, n)}>{n}</button>
                ))}
              </div>
              <div className="result">{k == null ? <span className="muted">no count entered</span> : <b>{k}/6</b>}</div>
            </div>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary big wide" onClick={() => store.confirmResults()}>
          CONFIRM ALL {entered < active.length ? `(${active.length - entered} unentered → 0/6)` : ''} ▶
        </button>
      </div>
    </div>
  );
}
