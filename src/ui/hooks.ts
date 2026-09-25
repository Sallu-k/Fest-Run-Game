import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GameState, GameStore, TimerState } from '../state/game';
import { getActiveBoard } from '../state/activeBoard';
import { ViewPrefs, getViewPrefs, subscribeViewPrefs, termsFor, titleFor } from '../state/mapStore';
import type { Terms } from '../core/terms';

let hostStore: GameStore | null = null;
let viewStore: GameStore | null = null;

export function getHostStore(): GameStore {
  if (!hostStore) hostStore = new GameStore('host', getActiveBoard());
  return hostStore;
}
export function getViewStore(): GameStore {
  if (!viewStore) viewStore = new GameStore('view', getActiveBoard());
  return viewStore;
}

export function useGame(store: GameStore): GameState {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Re-render every `ms` milliseconds; returns Date.now(). */
export function useNow(ms = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function timerRemaining(t: TimerState, now: number): number {
  if (!t.stage) return 0;
  return t.running && t.endsAt != null ? Math.max(0, t.endsAt - now) : t.remainingMs;
}

// ---------------------------------------------------------------- audio

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function beep(freq = 880, ms = 120, vol = 0.18, type: OscillatorType = 'square') {
  const c = audio();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + ms / 1000);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + ms / 1000 + 0.02);
}

/** Beeps in the last 5 seconds and a long tone at zero. Only the host window makes sound. */
export function useTimerAudio(timer: TimerState, enabled: boolean, now: number) {
  const last = useRef<{ stage: string | null; sec: number }>({ stage: null, sec: -1 });
  useEffect(() => {
    if (!enabled || !timer.stage || !timer.running) {
      last.current = { stage: timer.stage, sec: -1 };
      return;
    }
    const left = timerRemaining(timer, now);
    const sec = Math.ceil(left / 1000);
    if (last.current.stage !== timer.stage) {
      last.current = { stage: timer.stage, sec: sec + 1 };
      beep(660, 90, 0.12, 'sine');
    }
    if (sec !== last.current.sec) {
      if (sec > 0 && sec <= 5) beep(sec <= 2 ? 1180 : 880, 110, 0.2);
      if (sec === 0) beep(440, 700, 0.25, 'sawtooth');
      last.current.sec = sec;
    }
  }, [timer, enabled, now]);
}

export function useViewPrefs(): ViewPrefs {
  return useSyncExternalStore(subscribeViewPrefs, getViewPrefs);
}

/** The wording pack in force (re-renders when the host switches department or edits a name). */
export function useTerms(): Terms {
  const v = useViewPrefs();
  return useMemo(() => termsFor(v), [v]);
}

/** Event name + game title for headers ("TECHNOVA 2026 — CODE RUSH"). */
export function useTitle(): { event: string; game: string } {
  const v = useViewPrefs();
  return useMemo(() => titleFor(v), [v]);
}
