import { useEffect } from 'react';
import { GameStore, TIMER_MS, TimerStage, TimerState } from '../state/game';
import { timerRemaining, useGame, useNow, useTimerAudio } from './hooks';

const STAGES: { id: TimerStage; label: string; short: string }[] = [
  { id: 'rapid', label: 'RAPID FIRE', short: '30s' },
  { id: 'buffer', label: 'ANSWER BUFFER', short: '10s' },
  { id: 'confirm', label: 'RESULT CONFIRM', short: '20s' },
];

function useTimerView(timer: TimerState) {
  const now = useNow(100);
  const left = timerRemaining(timer, now);
  const secs = Math.ceil(left / 1000);
  const frac = timer.stage ? Math.min(1, Math.max(0, left / timer.durationMs)) : 0;
  const danger = !!timer.stage && timer.running && secs <= 5 && secs > 0;
  const done = !!timer.stage && !timer.running && left <= 0;
  const paused = !!timer.stage && !timer.running && left > 0;
  return { secs, frac, danger, done, paused };
}

/** Big floating timer: progress ring, seconds, stage name and the three stage pips. */
export function TimerHUD({ timer, big = false }: { timer: TimerState; big?: boolean }) {
  const v = useTimerView(timer);
  const stage = timer.stage;
  const R = 41;
  const C = 2 * Math.PI * R;
  const idx = stage ? STAGES.findIndex((s) => s.id === stage) : -1;
  const cls = ['timer', big ? 'big' : '', v.danger ? 'danger' : '', v.done ? 'done' : '', stage ?? 'idle'].join(' ');
  return (
    <div className={cls}>
      <div className="timer-card">
        <div className="ring">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r={R} className="ring-bg" />
            <circle cx="50" cy="50" r={R} className="ring-fg" strokeDasharray={C} strokeDashoffset={C * (1 - v.frac)} transform="rotate(-90 50 50)" />
          </svg>
          <div className="digits">{stage ? (v.done ? '0' : v.secs) : '--'}</div>
        </div>
        <div className="cap">
          <b>{!stage ? 'READY' : v.done ? "TIME'S UP" : v.paused ? 'PAUSED' : STAGES[idx].label}</b>
          <span>{!stage ? '30s · 10s · 20s per turn' : STAGES[idx].short + ' phase'}</span>
          <div className="steps">
            {STAGES.map((s, i) => (
              <i key={s.id} className={i <= idx ? 'on' : ''} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact seconds pill for the top bar. */
export function TimerMini({ timer }: { timer: TimerState }) {
  const v = useTimerView(timer);
  const stage = timer.stage;
  const cls = ['timer', v.danger ? 'danger' : '', stage ?? 'idle'].join(' ');
  return (
    <span className={cls}>
      <span className="timer-mini">
        <small>{stage ? STAGES.find((s) => s.id === stage)!.short : 'TIMER'}</small>
        {stage ? (v.done ? '0' : v.secs) : '--'}
      </span>
    </span>
  );
}

/** Host-only: fires the timer-elapsed transition and plays the alert beeps. Renders nothing, re-renders 10×/s. */
export function TimerDriver({ store }: { store: GameStore }) {
  const s = useGame(store);
  const now = useNow(100);
  useTimerAudio(s.timer, s.sound, now);
  useEffect(() => {
    if (s.timer.running && s.timer.endsAt != null && now >= s.timer.endsAt) store.timerElapsed();
  }, [now, s.timer, store]);
  return null;
}

export { TIMER_MS };
