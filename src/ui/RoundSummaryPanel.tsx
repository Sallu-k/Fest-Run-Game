import { remainingOf } from '../core/engine';
import { getTerms } from '../core/terms';
import { Board } from '../core/types';
import { GameState, GameStore } from '../state/game';
import { CardChips } from './HostDock';
import { TeamIcon } from './symbols';

/** ROUND_COMPLETE: per-team correct/movement/position/cards/distance-to-Receiver, then an explicit
 *  [START NEXT ROUND] — never automatic. */
export function RoundSummaryPanel({ s, store, board }: { s: GameState; store: GameStore; board: Board }) {
  const last = s.round >= s.rounds;
  return (
    <div className="panel">
      <h3>ROUND {s.round} COMPLETE</h3>
      <table className="tbl">
        <thead><tr><th>Team</th><th className="num">Correct</th><th className="num">Movement</th><th>Position</th><th>Cards</th><th className="num">To go</th></tr></thead>
        <tbody>
          {s.movementOrder.map((id) => {
            const t = s.teams.find((x) => x.id === id)!;
            const rm = s.registeredMoves[id];
            return (
              <tr key={id} className={t.status !== 'active' ? 'q' : ''}>
                <td style={{ fontWeight: 700 }}><TeamIcon index={t.id - 1} size={18} /> T{t.id} <span className="muted" style={{ fontWeight: 500 }}>{t.name}</span></td>
                <td className="num">{rm ? `${rm.correct}/6` : '—'}</td>
                <td className="num">{rm ? `+${rm.steps}${rm.steps !== rm.correct ? ' (card used)' : ''}` : '—'}</td>
                <td>{t.status === 'qualified' ? `#${t.slot} ✔ ${getTerms().finish}` : t.status === 'out' ? 'withdrew' : t.node}</td>
                <td><CardChips t={t} /></td>
                <td className="num">{t.status === 'active' ? remainingOf(board, t) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="btn primary big wide" style={{ marginTop: 12 }} onClick={() => store.proceedRound()}>
        {last ? 'FINISH ROUNDS → RANKING ▶' : `START ROUND ${s.round + 1} ▶`}
      </button>
    </div>
  );
}
