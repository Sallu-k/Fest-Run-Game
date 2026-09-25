import { useState } from 'react';
import { classicNodeMeta } from '../core/classicBoard';
import { remainingOf } from '../core/engine';
import { CARD_INFO, CARD_TYPES, Team } from '../core/types';
import { getTerms } from '../core/terms';
import { GameState, getBoard } from '../state/game';
import { TeamIcon } from './symbols';

/** Live status strip: all teams fit without scrolling; the active team is enlarged; click for details. */
export function TeamStrip({ s }: { s: GameState }) {
  const [open, setOpen] = useState<{ id: number; x: number } | null>(null);
  const board = getBoard(s.boardCfg);
  const order = s.movementOrder.length ? s.movementOrder : s.teams.map((t) => t.id);
  const team = open ? s.teams.find((t) => t.id === open.id) : null;
  return (
    <div className="team-strip">
      {order.map((id, i) => {
        const t = s.teams.find((x) => x.id === id)!;
        const cur = s.mover?.teamId === id;
        return (
          <button
            key={id}
            className={`tchip ${cur ? 'cur' : ''} ${i < s.movementIdx && !cur ? 'done' : ''} ${t.status !== 'active' ? 'q' : ''}`}
            style={{ ['--tc' as string]: t.color }}
            title={`T${t.id} ${t.name}`}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setOpen(open?.id === id ? null : { id, x: Math.min(window.innerWidth - 290, Math.max(8, r.left - 100)) });
            }}
          >
            <TeamIcon index={id - 1} size={cur ? 26 : 22} />
            <span>{id}</span>
            {t.status === 'qualified' && <span className="qm">#{t.slot}</span>}
          </button>
        );
      })}
      {team && open && <TeamPop team={team} x={open.x} board={board} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** ' · Path A' style suffix, classic-shaped boards only (see core/classicBoard.ts). */
function lanePath(nodeId: string): string {
  const lane = classicNodeMeta(nodeId).lane;
  return lane === 'A' || lane === 'B' || lane === 'C' ? ` · Path ${lane}` : '';
}

function TeamPop({ team, x, board, onClose }: { team: Team; x: number; board: ReturnType<typeof getBoard>; onClose: () => void }) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 55 }} onClick={onClose} />
      <div className="team-pop" style={{ left: x }}>
        <div className="head" style={{ color: team.color === '#f1f5f9' ? undefined : team.color }}>
          <TeamIcon index={team.id - 1} size={30} /> T{team.id} · {team.name}
        </div>
        <div className="row"><span className="muted">Status</span><b>{team.status === 'qualified' ? `QUALIFIED #${team.slot}` : team.status === 'out' ? 'Withdrawn' : 'Racing'}</b></div>
        {team.status === 'active' && (
          <>
            <div className="row"><span className="muted">Position</span><b>{team.node}{lanePath(team.node)}</b></div>
            <div className="row"><span className="muted">To {getTerms().finish.toLowerCase()}</span><b>{remainingOf(board, team)} spaces</b></div>
          </>
        )}
        <div className="row"><span className="muted">Correct so far</span><b>{team.totalCorrect}</b></div>
        <div className="row" style={{ gap: 4 }}>
          {CARD_TYPES.map((c, i) => (
            <span key={c} className={`card-chip ${team.cards[i] === 1 ? 'held' : team.cards[i] === 2 ? 'used' : 'none'}`} title={CARD_INFO[c].text}>
              {CARD_INFO[c].abbr}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
