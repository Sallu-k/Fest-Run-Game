// Host-side game state machine. All rules come from src/core/engine.ts; this file adds the round/turn
// flow, undo history, event log, persistence and the cross-window sync used by the projector view.
//
// SIMULTANEOUS-ROUND FLOW (the only flow — the old sequential per-team-turn mode has been retired):
// every round is ANSWERS (all teams, one global timer) → MOVEMENT (teams resolve one at a time, in
// rotation). The round is driven by an explicit `roundPhase` state machine rather than inferring "what
// can the host click right now" from a combination of nullable/boolean fields — see `RoundPhase` below.
// During the movement phase, a team chooses MOVE (walks its registered spaces) XOR USE CARD (forfeits
// its entire registered movement, permanently, in exchange for resolving one card) — never both; this is
// enforced structurally by `Mover.decision` being write-once per team-turn, not by a UI convention.
//
// Node identity is a string id (`Team.node`/`.trail`, `Pending`, `MoveTrace`, `FxEvent`) and a branch
// decision carries the actual list of successor node ids (`Pending['route'].options`) — this works for
// any DAG shape, not just a single named fork.

import { buildBoard } from '../core/board';
import { getTerms } from '../core/terms';
import { MapLayout, applyLayout, ensureLayout } from '../core/mapLayout';
import {
  advance,
  canUseCard,
  fallbackGroups,
  grantCard,
  hopTargets,
  isiTargets,
  makeTeam,
  maxSlots,
  needsQuestion,
  qualifyTeam,
  resolveSpecial,
  roundOrder,
  slotsFull,
  synthesizeTrail,
  useHop,
  useIsi,
  cardHeld,
} from '../core/engine';
import {
  Board,
  BoardConfig,
  CARD_INFO,
  CardType,
  Core,
  GameEvent,
  Pos,
  RulesConfig,
  Team,
} from '../core/types';

export const SYMBOLS = ['●', '▲', '■', '◆', '★', '✦', '✚', '☼', '◇', '⬢'];
export const TEAM_COLORS = [
  '#22d3ee', // cyan
  '#f472b6', // pink
  '#facc15', // yellow
  '#a3e635', // lime
  '#fb923c', // orange
  '#3b82f6', // blue
  '#ef4444', // red
  '#f1f5f9', // white
  '#2dd4bf', // teal
  '#c084fc', // violet
];

/** One global timer per round-phase (was: one per-team timer). Values unchanged from the brief: 30s
 *  rapid fire, 10s buffer, 20s result confirmation. */
export const TIMER_MS = { rapid: 30000, buffer: 10000, confirm: 20000 } as const;
export type TimerStage = keyof typeof TIMER_MS;

export interface TimerState {
  stage: TimerStage | null;
  durationMs: number;
  /** Epoch ms when the running timer hits zero. */
  endsAt: number | null;
  remainingMs: number;
  running: boolean;
}

/**
 * The round's state machine. `PATH_DECISION` / `SPECIAL_RESOLUTION` / `CARD_DECISION` are sub-states of
 * "a team is mid-movement" (`TEAM_MOVING`), kept as flat sibling values (matching how the brief lists
 * them) so the host UI can gate every control with one `switch(s.roundPhase)` instead of inferring state
 * from a combination of fields. `MAP_EDIT`/`SETUP` are not part of this — they're separate app routes,
 * not values a running game's round machine ever takes.
 */
export type RoundPhase =
  | 'ROUND_READY'
  | 'RAPID_FIRE'
  | 'ANSWER_BUFFER'
  | 'RESULT_CONFIRM'
  | 'MOVEMENT_READY'
  | 'TEAM_MOVING'
  | 'PATH_DECISION'
  | 'SPECIAL_RESOLUTION'
  | 'CARD_DECISION'
  | 'TEAM_TURN_COMPLETE'
  | 'ROUND_COMPLETE'
  | 'GAME_COMPLETE';

export interface RegisteredMove {
  correct: number;
  /** Spaces still owed to this team. Equals `correct` until the team's movement turn either walks it
   *  down to 0 or a card use zeroes it outright (forfeited, never restored). */
  steps: number;
}

/** Frozen at MOVEMENT_READY so the "ROUND N RESULTS" panel can show "current position + registered
 *  movement" without the board having moved yet — team.node keeps changing after this is taken. */
export interface RoundResultRow {
  teamId: number;
  from: string;
  steps: number;
}

/** The team currently resolving its movement turn. Replaces the old per-team `TurnState`; there is no
 *  separate answer-entry step any more (answers were already registered in RESULT_CONFIRM). */
export interface Mover {
  teamId: number;
  /** Write-once per team-turn: 'pending' -> ('move' | 'card'), never back. This one field is what makes
   *  "move XOR use a card" structural rather than a checked condition — see the module comment. */
  decision: 'pending' | 'move' | 'card';
  /** Registered spaces not yet walked. */
  stepsLeft: number;
  fromNode: string;
  cardUsed: boolean;
}

export type Pending =
  | { kind: 'route'; teamId: number; node: string; options: string[]; stepsLeft: number }
  | { kind: 'quick'; teamId: number; node: string; special: 'chance' | 'noise' }
  | { kind: 'cardConfirm'; teamId: number; card: 'isi' | 'hop'; registeredSteps: number }
  | { kind: 'target'; teamId: number; card: 'isi' | 'hop' }
  | { kind: 'orth'; teamId: number; targetId: number; card: 'isi' | 'hop' }
  | null;

export interface LogEntry {
  id: number;
  ts: number;
  round: number;
  teamId: number | null;
  kind: string;
  text: string;
  from?: string;
  to?: string;
  cards?: string;
}

/** Visual-effect cues derived from rule events (cosmetic only; the rules never read these). */
export interface FxEvent {
  kind: 'isi' | 'hop' | 'orth' | 'boost' | 'noise' | 'qualify' | 'card';
  team: number;
  target?: number;
  from?: string;
  to?: string;
  /** Full walked path for 'boost' (used to draw the jump); absent for the other kinds. */
  path?: string[];
  slot?: number;
  blocked?: boolean;
}

export interface MoveTrace {
  seq: number;
  moves: { teamId: number; path: string[] }[];
  fx?: FxEvent[];
}

export type Phase = 'setup' | 'playing' | 'fallback' | 'finished';

export interface GameState {
  v: 1;
  phase: Phase;
  /** `slots` = how many teams qualify (winners); unset = the map's own setting. */
  setup: { names: string[]; rounds: number; slots?: number };
  rounds: number;
  boardCfg: BoardConfig;
  /** Where things are drawn (cosmetic). Snapshot taken at START GAME; absent in older saves. */
  layout?: MapLayout;
  rules: RulesConfig;
  teams: Team[];
  qualifiers: number[];
  turnId: number;
  round: number;
  roundPhase: RoundPhase;
  /** This round's movement order (from the same rotating `roundOrder()` used every round — movement
   *  order is never based on who answered fastest/best). */
  movementOrder: number[];
  movementIdx: number;
  registeredMoves: Record<number, RegisteredMove>;
  roundResults: RoundResultRow[] | null;
  mover: Mover | null;
  timer: TimerState;
  autoAdvance: boolean;
  sound: boolean;
  pending: Pending;
  reveal: { teamId: number; card: CardType; revealed: boolean } | null;
  lastMove: MoveTrace | null;
  log: LogEntry[];
  logSeq: number;
  message: string | null;
  lastAction: string;
  startedAt: number | null;
}

const SHORT = (c: CardType) => CARD_INFO[c].abbr;

const idleTimer = (): TimerState => ({ stage: null, durationMs: 0, endsAt: null, remainingMs: 0, running: false });
const mkTimer = (stage: TimerStage): TimerState => ({
  stage,
  durationMs: TIMER_MS[stage],
  endsAt: Date.now() + TIMER_MS[stage],
  remainingMs: TIMER_MS[stage],
  running: true,
});

const boardCache = new Map<string, Board>();
export function getBoard(cfg: BoardConfig): Board {
  const key = JSON.stringify(cfg);
  let b = boardCache.get(key);
  if (!b) {
    b = buildBoard(cfg);
    if (boardCache.size > 20) boardCache.clear();
    boardCache.set(key, b);
  }
  return b;
}

const worldCache = new Map<string, { board: Board; layout: MapLayout }>();
/** The board with node coordinates from the game's map layout, plus the layout itself. Cached by content. */
export function renderWorld(s: Pick<GameState, 'boardCfg' | 'layout'>): { board: Board; layout: MapLayout } {
  const key = JSON.stringify([s.boardCfg, s.layout ?? null]);
  let w = worldCache.get(key);
  if (!w) {
    const b = getBoard(s.boardCfg);
    const layout = ensureLayout(b, s.layout);
    w = { board: applyLayout(b, layout), layout };
    if (worldCache.size > 12) worldCache.clear();
    worldCache.set(key, w);
  }
  return w;
}

export function defaultNames(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Team ${i + 1}`);
}

export function initialState(cfg: BoardConfig, rules: RulesConfig, names = defaultNames(10), rounds: number = 5): GameState {
  return {
    v: 1,
    phase: 'setup',
    setup: { names, rounds },
    rounds,
    boardCfg: cfg,
    rules,
    teams: [],
    qualifiers: [],
    turnId: 0,
    round: 1,
    roundPhase: 'ROUND_READY',
    movementOrder: [],
    movementIdx: 0,
    registeredMoves: {},
    roundResults: null,
    mover: null,
    timer: idleTimer(),
    autoAdvance: true,
    sound: true,
    pending: null,
    reveal: null,
    lastMove: null,
    log: [],
    logSeq: 0,
    message: null,
    lastAction: '',
    startedAt: null,
  };
}

export const tLabel = (t: Team | undefined) => (t ? `T${t.id}` : '?');

export function coreOf(s: GameState): Core {
  return { board: getBoard(s.boardCfg), rules: s.rules, teams: s.teams, qualifiers: s.qualifiers, turnId: s.turnId };
}

/** The team currently resolving its movement turn (there is no "current team" outside TEAM_MOVING and
 *  its sub-states — the answer-entry phases operate on every team at once, not one at a time). */
export function currentTeam(s: GameState): Team | null {
  return s.mover ? (s.teams.find((t) => t.id === s.mover!.teamId) ?? null) : null;
}

/** IDs of teams that are valid ISI / HOP targets for the current team while a target pick is pending. */
export function targetInfo(s: GameState) {
  if (s.pending?.kind !== 'target') return [];
  const core = coreOf(s);
  const t = s.teams.find((x) => x.id === s.pending!.teamId)!;
  return s.pending.card === 'isi' ? isiTargets(core, t) : hopTargets(core, t);
}

// ------------------------------------------------------------------ store

const LS_KEY = 'festrun.state.v1';
const BC_NAME = 'festrun-sync';

type Listener = () => void;

export class GameStore {
  private state: GameState;
  private history: { state: GameState; label: string }[] = [];
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private mode: 'host' | 'view',
    fallback: { cfg: BoardConfig; rules: RulesConfig },
    opts: { sync?: boolean } = {},
  ) {
    this.state = this.load() ?? initialState(fallback.cfg, fallback.rules);
    if (opts.sync !== false && typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(BC_NAME);
        if (mode === 'view') {
          this.channel.onmessage = (e: MessageEvent) => {
            if (e.data && e.data.v === 1) {
              this.state = e.data as GameState;
              this.notify();
            }
          };
        }
      } catch {
        this.channel = null;
      }
    }
    if (opts.sync !== false && mode === 'view' && typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === LS_KEY && e.newValue) {
          try {
            const s = JSON.parse(e.newValue) as GameState;
            if (s.v === 1) {
              this.state = s;
              this.notify();
            }
          } catch {
            /* ignore */
          }
        }
      });
    }
  }

  private load(): GameState | null {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as GameState;
      if (s.v !== 1) return null;
      getBoard(s.boardCfg);
      // A page refresh mid-timer must never leave the host silently stuck on an already-expired clock.
      if (s.timer.running && s.timer.endsAt != null && s.timer.endsAt <= Date.now()) {
        s.timer = { ...s.timer, running: false, remainingMs: 0 };
      }
      return s;
    } catch {
      return null;
    }
  }

  get = (): GameState => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  canUndo(): boolean {
    return this.history.length > 0;
  }

  private notify() {
    this.listeners.forEach((l) => l());
    if (this.mode !== 'host') return;
    try {
      this.channel?.postMessage(this.state);
    } catch {
      /* ignore */
    }
    if (this.saveTimer == null) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(this.state));
        } catch {
          /* storage full / blocked: the game still works in memory */
        }
      }, 120);
    }
  }

  /** Apply `fn` to a clone of the state. Return false from `fn` to reject the action (message is kept). */
  private commit(label: string, fn: (s: GameState, ctx: Ctx) => boolean | void, undoable = true) {
    if (this.mode !== 'host') return;
    const next = structuredClone(this.state);
    next.message = null;
    const ctx = makeCtx(next);
    const ok = fn(next, ctx) !== false;
    if (!ok) {
      this.state = { ...this.state, message: next.message };
      this.notify();
      return;
    }
    if (ctx.moves.length || ctx.fx.length) next.lastMove = { seq: (this.state.lastMove?.seq ?? 0) + 1, moves: ctx.moves, fx: ctx.fx };
    if (undoable) {
      this.history.push({ state: this.state, label });
      if (this.history.length > 80) this.history.shift();
      next.lastAction = label;
    }
    this.state = next;
    this.notify();
  }

  // ------------------------------------------------------------ setup

  setSetup(names: string[], rounds: number, slots?: number) {
    this.commit('setup', (s) => {
      s.setup = { names, rounds, slots };
    }, false);
  }

  /** Begin the game with the current setup. */
  startGame(cfg: BoardConfig, rules: RulesConfig, layout?: MapLayout) {
    this.commit('start', (s, c) => {
      const names = s.setup.names.map((n, i) => n.trim() || `Team ${i + 1}`);
      if (names.length < 1 || names.length > 10) return false;
      const board = getBoard(cfg);
      s.boardCfg = cfg;
      s.layout = layout;
      s.rules = { ...rules, winnerSlots: Math.max(1, Math.min(s.setup.slots ?? rules.winnerSlots, names.length)) };
      s.rounds = s.setup.rounds;
      s.teams = names.map((n, i) => makeTeam(i + 1, n, SYMBOLS[i], TEAM_COLORS[i], board));
      s.qualifiers = [];
      s.turnId = 0;
      s.round = 1;
      s.log = [];
      s.logSeq = 0;
      s.pending = null;
      s.reveal = null;
      s.lastMove = null;
      s.phase = 'playing';
      s.startedAt = Date.now();
      this.history = [];
      startRound(s, c);
    }, false);
    this.history = [];
  }

  reset() {
    const s = this.state;
    this.history = [];
    this.state = initialState(s.boardCfg, s.rules, s.setup.names, s.setup.rounds);
    this.state.setup.slots = s.setup.slots;
    this.state.sound = s.sound;
    this.state.autoAdvance = s.autoAdvance;
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
    this.notify();
  }

  // ------------------------------------------------------------ round phase: answers

  /** ROUND_READY -> RAPID_FIRE, starts the one global 30s timer. */
  startRapidFire() {
    this.commit('rapid fire', (s) => {
      if (s.roundPhase !== 'ROUND_READY') return false;
      s.roundPhase = 'RAPID_FIRE';
      s.timer = mkTimer('rapid');
    }, false);
  }

  /** RAPID_FIRE -> ANSWER_BUFFER, starts the one global 10s timer. Also reachable automatically via
   *  timerElapsed() when autoAdvance is on. */
  startAnswerBuffer() {
    this.commit('answer buffer', (s) => {
      if (s.roundPhase !== 'RAPID_FIRE') return false;
      toAnswerBuffer(s);
    }, false);
  }

  /** ANSWER_BUFFER -> RESULT_CONFIRM, starts the one global 20s timer. */
  startResultConfirm() {
    this.commit('result confirm', (s) => {
      if (s.roundPhase !== 'ANSWER_BUFFER') return false;
      toResultConfirm(s);
    }, false);
  }

  /** Called by the host window when the running global timer reaches zero (or the host skips it). */
  timerElapsed() {
    this.commit('timer-end', (s, c) => {
      const st = s.timer.stage;
      if (!st) return false;
      s.timer = { ...s.timer, running: false, endsAt: null, remainingMs: 0 };
      if (!s.autoAdvance) return;
      if (st === 'rapid' && s.roundPhase === 'RAPID_FIRE') toAnswerBuffer(s);
      else if (st === 'buffer' && s.roundPhase === 'ANSWER_BUFFER') toResultConfirm(s);
      else if (st === 'confirm' && s.roundPhase === 'RESULT_CONFIRM') confirmResultsInternal(s, c);
    }, false);
  }

  pause() {
    this.commit('pause', (s) => {
      if (!s.timer.running || s.timer.endsAt == null) return false;
      s.timer.remainingMs = Math.max(0, s.timer.endsAt - Date.now());
      s.timer.running = false;
      s.timer.endsAt = null;
    }, false);
  }

  resume() {
    this.commit('resume', (s) => {
      if (s.timer.running || !s.timer.stage || s.timer.remainingMs <= 0) return false;
      s.timer.endsAt = Date.now() + s.timer.remainingMs;
      s.timer.running = true;
    }, false);
  }

  setSound(on: boolean) {
    this.commit('sound', (s) => {
      s.sound = on;
    }, false);
  }
  setAutoAdvance(on: boolean) {
    this.commit('auto', (s) => {
      s.autoAdvance = on;
    }, false);
  }

  /** RESULT_CONFIRM only: host enters/corrects one team's correct-out-of-6 count. Movement is NOT
   *  applied yet — the board stays exactly as it was at round start until BEGIN MOVEMENT. */
  enterResult(teamId: number, correct: number) {
    this.commit(`enter ${teamId}=${correct}`, (s, c) => {
      if (s.roundPhase !== 'RESULT_CONFIRM') return false;
      const t = s.teams.find((x) => x.id === teamId);
      if (!t || t.status !== 'active') return false;
      const k = Math.max(0, Math.min(6, correct));
      s.registeredMoves[teamId] = { correct: k, steps: k };
      t.correctByRound[s.round - 1] = k;
      t.totalCorrect = t.correctByRound.reduce((a, b) => a + (b ?? 0), 0);
      c.log(t, 'answers', `${tLabel(t)} → ${k}/6`);
    });
  }

  /** RESULT_CONFIRM -> MOVEMENT_READY: locks every team's count (defaulting any missing entry to 0/6,
   *  same "no count entered" fallback as before), freezes the "ROUND N RESULTS" snapshot. */
  confirmResults() {
    this.commit('confirm results', (s, c) => {
      if (s.roundPhase !== 'RESULT_CONFIRM') return false;
      confirmResultsInternal(s, c);
    });
  }

  /** Host override, usable any time before a team has actually chosen MOVE/USE CARD this round. */
  correctRegisteredMove(teamId: number, correct: number) {
    this.commit('correct result', (s, c) => {
      if (s.roundPhase !== 'MOVEMENT_READY' && s.roundPhase !== 'TEAM_MOVING') return false;
      const t = s.teams.find((x) => x.id === teamId);
      if (!t || t.status !== 'active') return false;
      if (s.mover?.teamId === teamId && s.mover.decision !== 'pending') return false;
      const k = Math.max(0, Math.min(6, correct));
      s.registeredMoves[teamId] = { correct: k, steps: k };
      t.correctByRound[s.round - 1] = k;
      t.totalCorrect = t.correctByRound.reduce((a, b) => a + (b ?? 0), 0);
      const row = s.roundResults?.find((r) => r.teamId === teamId);
      if (row) row.steps = k;
      if (s.mover?.teamId === teamId) s.mover.stepsLeft = k;
      c.log(t, 'override', `HOST corrected ${tLabel(t)}'s result to ${k}/6`);
    });
  }

  // ------------------------------------------------------------ round phase: movement

  /** MOVEMENT_READY -> TEAM_MOVING: the explicit, never-automatic transition into moving teams one at
   *  a time in this round's movement order. */
  beginMovement() {
    this.commit('begin movement', (s, c) => {
      if (s.roundPhase !== 'MOVEMENT_READY') return false;
      startMoverAt(s, c, 0);
    });
  }

  /** The current mover walks its full registered movement. Only legal while its decision is still
   *  'pending' — once this or USE CARD commits, the other is structurally unreachable this turn. */
  chooseToMove() {
    this.commit('move', (s, c) => {
      const m = s.mover;
      const team = currentTeam(s);
      if (!m || !team || m.decision !== 'pending' || s.pending) {
        s.message = 'No movement decision is pending.';
        return false;
      }
      m.decision = 'move';
      runMove(s, c, team, m.stepsLeft);
    });
  }

  /** Opens the "cancel your +N movement?" confirmation — does not commit anything yet. */
  chooseToUseCard(card: 'isi' | 'hop') {
    this.commit(`consider ${card}`, (s) => {
      const m = s.mover;
      const team = currentTeam(s);
      if (!m || !team || m.decision !== 'pending' || s.pending) {
        s.message = 'Finish the pending action first.';
        return false;
      }
      const core = coreOf(s);
      if (!canUseCard(core, team, card)) {
        s.message = cardHeld(team, card) ? 'A card earned this turn cannot be used until next turn.' : `${tLabel(team)} does not hold ${CARD_INFO[card].label}.`;
        return false;
      }
      const targets = card === 'isi' ? isiTargets(core, team) : hopTargets(core, team);
      if (!targets.length) {
        s.message = card === 'isi' ? `No valid ${CARD_INFO.isi.label} targets within range.` : 'No valid teams to swap with.';
        return false;
      }
      s.pending = { kind: 'cardConfirm', teamId: team.id, card, registeredSteps: m.stepsLeft };
    }, false);
  }

  /** The one-way point of no return: forfeits the team's entire registered movement (permanently — it
   *  is never restored, even if the card use is later blocked by ORTHOGONALITY) and opens target
   *  selection. */
  confirmCardUse() {
    this.commit('confirm card', (s, c) => {
      const p = s.pending;
      const m = s.mover;
      if (!p || p.kind !== 'cardConfirm' || !m || m.decision !== 'pending') return false;
      m.decision = 'card';
      m.stepsLeft = 0;
      if (s.registeredMoves[m.teamId]) s.registeredMoves[m.teamId] = { ...s.registeredMoves[m.teamId], steps: 0 };
      const team = teamById(s, m.teamId);
      c.log(team, 'card', `${tLabel(team)} forfeits its registered movement to use ${CARD_INFO[p.card].label}`);
      s.pending = { kind: 'target', teamId: p.teamId, card: p.card };
    });
  }

  cancelCardUse() {
    this.commit('cancel card', (s) => {
      if (s.pending?.kind !== 'cardConfirm') return false;
      s.pending = null;
    }, false);
  }

  /** `option` is one of the node ids offered by the pending branch decision — validated against it, so
   *  a stale/mismatched click is rejected with a message instead of silently doing nothing. */
  chooseRoute(option: string) {
    this.commit(`route ${option}`, (s, c) => {
      const p = s.pending;
      const team = currentTeam(s);
      if (!p || p.kind !== 'route' || !team) return false;
      if (!p.options.includes(option)) {
        s.message = `${option} is not one of the available routes from ${p.node}.`;
        return false;
      }
      s.pending = null;
      runMove(s, c, team, p.stepsLeft, option);
    });
  }

  resolveQuick(correct: boolean) {
    this.commit(correct ? 'quick ✔' : 'quick ✘', (s, c) => {
      const p = s.pending;
      const team = currentTeam(s);
      if (!p || p.kind !== 'quick' || !team) return false;
      s.pending = null;
      resolveSpecial(coreOf(s), team, correct, c.emit);
      finishMoverTurn(s, c);
    });
  }

  cancelPending() {
    this.commit('cancel', (s) => {
      if (s.pending?.kind === 'target' || s.pending?.kind === 'orth') s.pending = null;
      else return false;
    }, false);
  }

  pickTarget(targetId: number) {
    this.commit('target', (s, c) => {
      const p = s.pending;
      if (!p || p.kind !== 'target') return false;
      const info = targetInfo(s).find((x) => x.team.id === targetId);
      if (!info) {
        s.message = 'That team is not a valid target.';
        return false;
      }
      if (info.shielded) {
        s.pending = { kind: 'orth', teamId: p.teamId, targetId, card: p.card };
        return;
      }
      applyCard(s, c, p.teamId, targetId, p.card, false);
    }, false);
  }

  /** Target holds ORTHOGONALITY: host confirms whether the team blocks the card. Purely defensive/
   *  reactive — the defender never moves from this, and no card chains are created. */
  resolveOrth(block: boolean) {
    this.commit(block ? 'orth block' : 'orth decline', (s, c) => {
      const p = s.pending;
      if (!p || p.kind !== 'orth') return false;
      applyCard(s, c, p.teamId, p.targetId, p.card, block);
    });
  }

  /** Only legal once the current mover's turn is fully resolved (roundPhase === TEAM_TURN_COMPLETE) —
   *  re-checked here independently of the UI's disabled attribute, so this is enforced structurally. */
  nextTeamMove() {
    this.commit('next team', (s, c) => {
      if (s.roundPhase !== 'TEAM_TURN_COMPLETE') {
        s.message = "Finish the current team's movement first.";
        return false;
      }
      s.reveal = null;
      startMoverAt(s, c, s.movementIdx + 1);
    });
  }

  /** ROUND_COMPLETE -> next round's ROUND_READY, or into fallback/GAME_COMPLETE. Never automatic. */
  proceedRound() {
    this.commit('next round', (s, c) => {
      if (s.roundPhase !== 'ROUND_COMPLETE') {
        s.message = 'The round is not complete yet.';
        return false;
      }
      s.reveal = null;
      s.mover = null;
      s.timer = idleTimer();
      if (s.round >= s.rounds) {
        endRounds(s, c);
        return;
      }
      s.round++;
      startRound(s, c);
    });
  }

  dismissReveal() {
    this.commit('dismiss', (s) => {
      s.reveal = null;
    }, false);
  }
  revealCard() {
    this.commit('reveal', (s) => {
      if (s.reveal) s.reveal.revealed = true;
    }, false);
  }
  clearMessage() {
    this.commit('msg', (s) => {
      s.message = null;
    }, false);
  }

  // ------------------------------------------------------------ overrides

  giveCard(teamId: number, card: CardType) {
    this.commit(`give ${card}`, (s, c) => {
      const t = s.teams.find((x) => x.id === teamId);
      if (!t || t.status !== 'active') return false;
      const core = coreOf(s);
      if (!grantCard(core, t, card, undefined, -1)) {
        s.message = `${tLabel(t)} already has ${CARD_INFO[card].label}.`;
        return false;
      }
      c.log(t, 'card', `HOST gave ${CARD_INFO[card].label} to ${tLabel(t)}`, { cards: `+${SHORT(card)}` });
    });
  }

  /** Host override: teleport a team to an arbitrary node (its trail is synthesized, shortest TX→node). */
  setPosition(teamId: number, nodeId: string) {
    this.commit('set position', (s, c) => {
      const t = s.teams.find((x) => x.id === teamId);
      const board = getBoard(s.boardCfg);
      if (!t || t.status !== 'active' || !board.byId.has(nodeId)) return false;
      const from = t.node;
      t.node = nodeId;
      t.trail = synthesizeTrail(board, nodeId);
      c.moves.push({ teamId, path: [from, nodeId] });
      c.log(t, 'override', `HOST placed ${tLabel(t)} on ${nodeId}`, { from, to: nodeId });
      if (nodeId === board.idOf[board.rx]) {
        qualifyTeam(coreOf(s), t, c.emit);
        checkGameEnd(s, c);
      }
    });
  }

  renameTeam(teamId: number, name: string) {
    this.commit('rename', (s) => {
      const t = s.teams.find((x) => x.id === teamId);
      if (t) t.name = name.trim() || `Team ${teamId}`;
      s.setup.names[teamId - 1] = name.trim() || `Team ${teamId}`;
    }, false);
  }

  /** Withdraw a team mid-game (it is skipped from now on). The one deliberate exception to "next team
   *  is blocked until the mover's turn completes": a withdrawn mover's turn will never complete on its
   *  own, so this advances movement directly instead of waiting for TEAM_TURN_COMPLETE. */
  removeTeam(teamId: number) {
    this.commit('remove team', (s, c) => {
      const t = s.teams.find((x) => x.id === teamId);
      if (!t || t.status !== 'active') return false;
      t.status = 'out';
      c.log(t, 'team', `${tLabel(t)} ${t.name} withdrew from the game`);
      if (s.mover?.teamId === teamId) {
        s.pending = null;
        startMoverAt(s, c, s.movementIdx + 1);
      }
      checkGameEnd(s, c);
    });
  }

  // ------------------------------------------------------------ fallback

  /** Qualify everything the ranking decides outright, then stop at the first tie that needs a sudden-death question. */
  applyFallback() {
    this.commit('fallback', (s, c) => {
      if (s.phase !== 'fallback') return false;
      fallbackRun(s, c);
    });
  }

  /** Host-chosen sudden-death winner takes the next slot. */
  suddenDeathWinner(teamId: number) {
    this.commit('sudden death', (s, c) => {
      if (s.phase !== 'fallback') return false;
      const core = coreOf(s);
      const g = fallbackGroups(core, s.rounds);
      if (!g.sudden || !g.sudden.rows.some((r) => r.team.id === teamId)) return false;
      const t = s.teams.find((x) => x.id === teamId)!;
      c.log(t, 'fallback', `${tLabel(t)} won the sudden-death question`);
      qualifyTeam(core, t, c.emit);
      fallbackRun(s, c);
    });
  }

  // ------------------------------------------------------------ undo

  undo() {
    if (this.mode !== 'host') return;
    const h = this.history.pop();
    if (!h) return;
    const cur = this.state;
    const restored = structuredClone(h.state);
    // Keep the live (running) timer only if undo didn't change which round-phase we're in; otherwise a
    // reverted phase would be left ticking against a clock that no longer matches what it's timing.
    restored.timer = restored.roundPhase === cur.roundPhase ? cur.timer : idleTimer();
    restored.sound = cur.sound;
    restored.autoAdvance = cur.autoAdvance;
    restored.reveal = null;
    restored.lastMove = null;
    restored.message = null;
    restored.logSeq = cur.logSeq + 1;
    restored.log.push({
      id: restored.logSeq,
      ts: Date.now(),
      round: restored.round,
      teamId: null,
      kind: 'undo',
      text: `↩ UNDO — reverted "${cur.lastAction || 'last action'}"`,
    });
    this.state = restored;
    this.notify();
  }
}

// ------------------------------------------------------------------ helpers used inside commits

interface Ctx {
  moves: { teamId: number; path: string[] }[];
  fx: FxEvent[];
  emit: (e: GameEvent) => void;
  log: (team: Team | null, kind: string, text: string, extra?: Partial<LogEntry>) => void;
}

function makeCtx(s: GameState): Ctx {
  const board = getBoard(s.boardCfg);
  const ctx: Ctx = {
    moves: [],
    fx: [],
    log: (team, kind, text, extra = {}) => {
      s.log.push({ id: ++s.logSeq, ts: Date.now(), round: s.round, teamId: team?.id ?? null, kind, text, ...extra });
    },
    emit: (e) => onEvent(s, board, ctx, e),
  };
  return ctx;
}

function teamById(s: GameState, id: number): Team {
  return s.teams.find((t) => t.id === id)!;
}

function onEvent(s: GameState, _board: Board, ctx: Ctx, e: GameEvent) {
  const T = (id: number) => tLabel(teamById(s, id));
  switch (e.kind) {
    case 'move':
      break;
    case 'land':
      ctx.log(teamById(s, e.team), 'land', `${T(e.team)} landed on ${e.special.toUpperCase()}`);
      break;
    case 'quick':
      ctx.log(teamById(s, e.team), 'quick', `${T(e.team)} answered ${e.special.toUpperCase()} question ${e.correct ? 'correctly' : 'wrong'}`);
      break;
    case 'boost':
      ctx.fx.push({ kind: 'boost', team: e.team, from: e.from, to: e.to, path: e.path });
      ctx.moves.push({ teamId: e.team, path: e.path });
      ctx.log(teamById(s, e.team), 'boost', `${T(e.team)} hit ${getTerms().booster}: +${e.amount} spaces`, { from: e.from, to: e.to });
      break;
    case 'noise-back':
      ctx.fx.push({ kind: 'noise', team: e.team, from: e.from, to: e.to, path: e.path });
      ctx.moves.push({ teamId: e.team, path: e.path });
      ctx.log(teamById(s, e.team), 'noise', `${T(e.team)} was pushed back ${e.amount} by ${getTerms().noise}`, { from: e.from, to: e.to });
      break;
    case 'card-gain':
      ctx.fx.push({ kind: 'card', team: e.team });
      s.reveal = { teamId: e.team, card: e.card, revealed: false };
      ctx.log(teamById(s, e.team), 'card', `${T(e.team)} received ${CARD_INFO[e.card].label}`, { cards: `+${SHORT(e.card)}` });
      break;
    case 'card-dup':
      ctx.log(teamById(s, e.team), 'card', `${T(e.team)} already owns ${CARD_INFO[e.card].label} — no new card`);
      break;
    case 'isi':
      ctx.fx.push({ kind: 'isi', team: e.team, target: e.target, from: e.from, to: e.to, blocked: e.blocked });
      if (e.blocked) {
        ctx.log(teamById(s, e.team), 'card', `${T(e.team)} used ${CARD_INFO.isi.label} on ${T(e.target)} — BLOCKED`, { cards: `−${SHORT('isi')}` });
      } else {
        ctx.moves.push({ teamId: e.target, path: e.path });
        ctx.log(teamById(s, e.team), 'card', `${T(e.team)} used ${CARD_INFO.isi.label} on ${T(e.target)}: ${T(e.target)} moved back ${e.steps}`, {
          from: e.from,
          to: e.to,
          cards: `−${SHORT('isi')}`,
        });
      }
      break;
    case 'hop':
      ctx.fx.push({ kind: 'hop', team: e.team, target: e.target, from: e.teamFrom, to: e.teamTo, blocked: e.blocked });
      if (e.blocked) {
        ctx.log(teamById(s, e.team), 'card', `${T(e.team)} used ${CARD_INFO.hop.label} on ${T(e.target)} — BLOCKED`, { cards: `−${SHORT('hop')}` });
      } else {
        const tgtNode = teamById(s, e.target).node;
        ctx.moves.push({ teamId: e.team, path: [e.teamFrom, e.teamTo] });
        ctx.moves.push({ teamId: e.target, path: [e.teamTo, tgtNode] });
        ctx.log(teamById(s, e.team), 'card', `${T(e.team)} used ${CARD_INFO.hop.label}: swapped with ${T(e.target)}`, {
          from: e.teamFrom,
          to: e.teamTo,
          cards: `−${SHORT('hop')}`,
        });
      }
      break;
    case 'orth':
      ctx.fx.push({ kind: 'orth', team: e.team, target: e.attacker });
      ctx.log(teamById(s, e.team), 'card', `${T(e.team)} used ${CARD_INFO.orth.label} against ${T(e.attacker)}'s ${CARD_INFO[e.against].label}`, { cards: `−${SHORT('orth')}` });
      break;
    case 'qualify':
      ctx.fx.push({ kind: 'qualify', team: e.team, slot: e.slot });
      ctx.log(teamById(s, e.team), 'qualify', `${T(e.team)} reached ${getTerms().finish} — qualified #${e.slot}`);
      break;
  }
}

function startRound(s: GameState, c: Ctx) {
  s.movementOrder = roundOrder(s.teams.length, s.round);
  s.movementIdx = 0;
  s.roundPhase = 'ROUND_READY';
  s.mover = null;
  s.registeredMoves = {};
  s.roundResults = null;
  s.timer = idleTimer();
  s.pending = null;
  c.log(null, 'round', `ROUND ${s.round} — movement order: ${s.movementOrder.map((id) => `T${id}`).join(' → ')}`);
}

function toAnswerBuffer(s: GameState) {
  s.roundPhase = 'ANSWER_BUFFER';
  s.timer = mkTimer('buffer');
}

function toResultConfirm(s: GameState) {
  s.roundPhase = 'RESULT_CONFIRM';
  s.timer = mkTimer('confirm');
}

function confirmResultsInternal(s: GameState, c: Ctx) {
  for (const t of s.teams) {
    if (t.status !== 'active') continue;
    if (!s.registeredMoves[t.id]) {
      s.registeredMoves[t.id] = { correct: 0, steps: 0 };
      c.log(t, 'answers', `${tLabel(t)} answered 0/6 (no count entered)`);
    }
  }
  s.roundResults = s.teams
    .filter((t) => t.status === 'active')
    .map((t) => ({ teamId: t.id, from: t.node, steps: s.registeredMoves[t.id].steps }));
  s.roundPhase = 'MOVEMENT_READY';
  s.timer = idleTimer();
  c.log(null, 'round', `ANSWERS LOCKED — ${s.roundResults.map((r) => `T${r.teamId} +${r.steps}`).join(', ')}`);
}

/** Finds the next active team from `idx` onward in this round's movement order and starts its turn;
 *  if none remain, the round is complete. The single place `mover`/`roundPhase` transition together. */
function startMoverAt(s: GameState, c: Ctx, idx: number) {
  let i = idx;
  while (i < s.movementOrder.length && teamById(s, s.movementOrder[i]).status !== 'active') i++;
  s.pending = null;
  if (i >= s.movementOrder.length) {
    s.movementIdx = s.movementOrder.length;
    s.mover = null;
    s.roundPhase = 'ROUND_COMPLETE';
    c.log(null, 'round', `ROUND ${s.round} movement complete`);
    return;
  }
  s.movementIdx = i;
  const teamId = s.movementOrder[i];
  s.turnId++;
  s.roundPhase = 'TEAM_MOVING';
  s.mover = { teamId, decision: 'pending', stepsLeft: s.registeredMoves[teamId]?.steps ?? 0, fromNode: teamById(s, teamId).node, cardUsed: false };
}

/** `chosenOption`: the node id previously picked for a branch this move re-enters (from `chooseRoute`). */
function runMove(s: GameState, c: Ctx, team: Team, steps: number, chosenOption?: string) {
  const core = coreOf(s);
  const board = core.board;
  const pos: Pos = { node: team.node, trail: team.trail };
  const path: string[] = [team.node];
  let blockedAt: { node: string; options: string[] } | null = null;
  const res = advance(
    board,
    pos,
    steps,
    (node, options) => {
      if (chosenOption != null && options.includes(chosenOption)) return chosenOption;
      blockedAt = { node, options };
      return null;
    },
    path,
  );
  team.node = pos.node;
  team.trail = pos.trail;
  if (path.length > 1) c.moves.push({ teamId: team.id, path });
  if (res.blocked) {
    s.roundPhase = 'PATH_DECISION';
    s.pending = { kind: 'route', teamId: team.id, node: blockedAt!.node, options: blockedAt!.options, stepsLeft: steps - res.moved };
    return;
  }
  const fromNode = s.mover?.fromNode ?? team.node;
  c.log(team, 'move', steps === 0 ? `${tLabel(team)} stays put (0 spaces)` : `${tLabel(team)} moved from ${fromNode} → ${team.node}`, {
    from: fromNode,
    to: team.node,
  });
  if (res.reachedRx) {
    qualifyTeam(core, team, c.emit);
    finishMoverTurn(s, c);
    return;
  }
  if (steps > 0) {
    const sp = board.nodes[board.byId.get(team.node)!].special;
    if (sp) {
      c.emit({ kind: 'land', team: team.id, node: team.node, special: sp.type });
      if (needsQuestion(sp)) {
        s.roundPhase = 'SPECIAL_RESOLUTION';
        s.pending = { kind: 'quick', teamId: team.id, node: team.node, special: sp.type as 'chance' | 'noise' };
        return;
      }
      resolveSpecial(core, team, true, c.emit);
    }
  }
  finishMoverTurn(s, c);
}

function checkGameEnd(s: GameState, c: Ctx): boolean {
  if (slotsFull(coreOf(s)) && s.phase === 'playing') {
    endGame(s, c);
    return true;
  }
  return false;
}

/** The single funnel to TEAM_TURN_COMPLETE — reachable only once a mover's movement/card interaction
 *  is fully resolved (pending === null), which is what makes "NEXT TEAM is blocked until fully
 *  resolved" structural rather than a UI convention. */
function finishMoverTurn(s: GameState, c: Ctx) {
  if (checkGameEnd(s, c)) return;
  s.pending = null;
  s.roundPhase = 'TEAM_TURN_COMPLETE';
}

function applyCard(s: GameState, c: Ctx, userId: number, targetId: number, card: 'isi' | 'hop', blocked: boolean) {
  const core = coreOf(s);
  const user = teamById(s, userId);
  const target = teamById(s, targetId);
  s.pending = null;
  if (card === 'isi') useIsi(core, user, target, blocked, c.emit);
  else useHop(core, user, target, blocked, c.emit);
  if (s.mover && s.mover.teamId === userId) s.mover.cardUsed = true;
  finishMoverTurn(s, c);
}

function endRounds(s: GameState, c: Ctx) {
  const core = coreOf(s);
  if (slotsFull(core)) {
    endGame(s, c);
    return;
  }
  s.phase = 'fallback';
  c.log(null, 'round', `All ${s.rounds} rounds complete — ${maxSlots(core) - s.qualifiers.length} slot(s) decided by fallback ranking`);
}

function fallbackRun(s: GameState, c: Ctx) {
  const core = coreOf(s);
  for (;;) {
    if (slotsFull(core)) break;
    const g = fallbackGroups(core, s.rounds);
    for (const grp of g.auto) {
      for (const row of grp) {
        const t = teamById(s, row.team.id);
        c.log(t, 'fallback', `${tLabel(t)} qualified by fallback ranking (${row.remaining} spaces from ${getTerms().finish}, ${row.finalRoundCorrect} correct in final round)`);
        qualifyTeam(core, t, c.emit);
      }
    }
    if (g.sudden || g.auto.length === 0) break;
  }
  if (slotsFull(core)) endGame(s, c);
}

function endGame(s: GameState, c: Ctx) {
  s.phase = 'finished';
  s.roundPhase = 'GAME_COMPLETE';
  s.pending = null;
  s.mover = null;
  s.timer = idleTimer();
  const names = s.qualifiers.map((id, i) => `#${i + 1} T${id}`).join(', ');
  c.log(null, 'end', `GAME OVER — qualified: ${names}`);
}
