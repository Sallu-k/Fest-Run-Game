import { useEffect, useRef, useState } from 'react';
import { maxSlots, remainingOf } from '../core/engine';
import { RoundPhase, coreOf, currentTeam, renderWorld } from '../state/game';
import { BoardCanvas, CanvasHandle } from './board/BoardCanvas';
import { themeOf } from './board/theme';
import { RevealOverlay } from './Host';
import { RulesList } from './Setup';
import { TimerHUD } from './Timer';
import { TeamIcon } from './symbols';
import { getViewStore, useGame, useTerms, useTitle, useViewPrefs } from './hooks';

/** Read-only audience display: one huge board, the active team, the timer and the slots. Never shows host-only information. */
export function Projector() {
  const store = getViewStore();
  const s = useGame(store);
  const prefs = useViewPrefs();
  const terms = useTerms();
  const title = useTitle();
  const canvas = useRef<CanvasHandle>(null);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef(0);

  useEffect(() => {
    const wake = () => {
      setIdle(false);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setIdle(true), 3000);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'f') canvas.current?.fullscreen();
      if (e.key === '0') canvas.current?.fit();
      wake();
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', key);
      window.clearTimeout(idleTimer.current);
    };
  }, []);

  if (s.phase === 'setup') {
    return (
      <div className="proj proj-rules">
        <h1 style={{ fontSize: 'clamp(36px, 8vh, 96px)', color: 'var(--accent)' }}>
          {title.event ? <>{title.event} <span style={{ color: 'var(--accent2)' }}>— {title.game}</span></> : title.game}
        </h1>
        <div style={{ maxWidth: 900, fontSize: 'clamp(16px, 2.6vh, 28px)' }}>
          <RulesList slots={s.setup.slots} />
        </div>
      </div>
    );
  }

  const { board, layout } = renderWorld(s);
  const theme = themeOf(prefs.style);
  const team = currentTeam(s);
  const last = s.log[s.log.length - 1];
  const banner =
    s.pending?.kind === 'route'
      ? 'CHOOSING A ROUTE…'
      : s.pending?.kind === 'quick'
        ? `${s.pending.special === 'chance' ? terms.chance : terms.noise} — QUICK QUESTION!`
        : s.pending?.kind === 'cardConfirm'
          ? 'CARD DECISION…'
          : s.pending?.kind === 'target' || s.pending?.kind === 'orth'
            ? 'CARD IN PLAY…'
            : s.phase === 'fallback'
              ? 'FINAL RANKING'
              : s.phase === 'playing'
                ? ({
                    ROUND_READY: `ROUND ${s.round}`,
                    RAPID_FIRE: terms.rapidFire,
                    ANSWER_BUFFER: 'ANSWERS LOCKED — BUFFER',
                    RESULT_CONFIRM: 'RESULT CONFIRMATION',
                    MOVEMENT_READY: `ROUND ${s.round} RESULTS`,
                    ROUND_COMPLETE: `ROUND ${s.round} COMPLETE`,
                  } as Partial<Record<RoundPhase, string>>)[s.roundPhase] ?? null
                : null;
  const nameplate =
    s.phase === 'playing' && team && team.status === 'active' && s.roundPhase !== 'ROUND_COMPLETE' ? { team, toGo: remainingOf(board, team) } : null;

  return (
    <div className={`proj ${idle ? 'proj-hide-cursor' : ''}`} data-fs onDoubleClick={() => canvas.current?.fullscreen()}>
      <BoardCanvas
        ref={canvas}
        mode="projector"
        board={board}
        layout={layout}
        theme={theme}
        teams={s.teams}
        slots={maxSlots(coreOf(s))}
        qualifiers={s.qualifiers}
        currentTeamId={s.phase === 'playing' ? s.mover?.teamId : null}
        nameplate={nameplate}
        boosterAmount={s.rules.boosterAmount}
        noiseBack={s.rules.noiseBack}
        lastMove={s.lastMove}
        follow={prefs.follow}
        calm={prefs.calm}
      >
        <div className="proj-round"><small>ROUND</small>{Math.min(s.round, s.rounds)} / {s.rounds}</div>
        <div className="proj-timer"><TimerHUD timer={s.timer} big /></div>
        {banner && <div className="proj-banner">{banner}</div>}
        {last && <div className="ticker">{last.text}</div>}
        {s.phase === 'finished' && (
          <div className="proj-overlay">
            <h1>{terms.allLocked} — QUALIFIED TEAMS</h1>
            <div className="winner-list">
              {s.qualifiers.map((id, i) => {
                const t = s.teams.find((x) => x.id === id)!;
                return (
                  <div className="winner-row" key={id} style={{ ['--wc' as string]: t.color }}>
                    <span className="pos">#{i + 1}</span>
                    <TeamIcon index={id - 1} size={56} />
                    T{id} {t.name}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <RevealOverlay s={s} />
      </BoardCanvas>
    </div>
  );
}
