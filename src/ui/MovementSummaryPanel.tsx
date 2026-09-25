import { remainingOf } from '../core/engine';
import { Board } from '../core/types';
import { GameState, GameStore } from '../state/game';
import { TeamIcon } from './symbols';

/** MOVEMENT_READY: "ROUND N RESULTS" — every team's registered movement, board still at its
 *  round-start positions. [BEGIN MOVEMENT] is the explicit, never-automatic start of Phase 4. */
export function MovementSummaryPanel({ s, store, board }: { s: GameState; store: GameStore; board: Board }) {
  const rows = s.roundResults ?? [];
  return (
    <div className="panel movement-summary">
      <h3>ROUND {s.round} RESULTS</h3>
      <div className="badges">
        {rows.map((r) => {
          const t = s.teams.find((x) => x.id === r.teamId)!;
          return (
            <div key={r.teamId} className="move-badge" style={{ ['--tc' as string]: t.color }}>
              <TeamIcon index={t.id - 1} size={22} />
              <b>TEAM {t.id}</b>
              <span className="plus">+{r.steps}</span>
              <small className="muted">from {r.from} · {remainingOf(board, { node: r.from })} to go</small>
            </div>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary big wide go" onClick={() => store.beginMovement()}>▶ BEGIN MOVEMENT</button>
      </div>
    </div>
  );
}
