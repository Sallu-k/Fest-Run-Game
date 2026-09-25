// Shared type definitions for the rules engine.
// The same types are used by the live game (browser), the simulator (worker) and the CLI optimizer.
//
// The board is a directed acyclic graph (DAG) from a single Transmitter (TX) to a single Receiver
// (RX). Node identity is a plain string id chosen by whoever builds the config — the classic
// compiler in core/classicBoard.ts, the Map Editor, or a hand-written BoardConfig. Nothing in this
// file or in core/engine.ts assumes a fixed number of branches or a particular id naming scheme;
// that assumption lives only in core/classicBoard.ts (the "3 named paths" shape used by every board
// shipped today) and in the renderer, which for now only knows how to draw that classic shape.

import { CARD_EFFECT, getTerms } from './terms';

export type NodeKind = 'tx' | 'rx' | 'normal' | 'chance' | 'noise' | 'booster';
/** The subset of NodeKind that is a "special space" (as opposed to plain/TX/RX). */
export type SpecialType = 'chance' | 'noise' | 'booster';

export type CardType = 'isi' | 'hop' | 'orth';
export const CARD_TYPES: CardType[] = ['isi', 'hop', 'orth'];
export const CARD_INDEX: Record<CardType, number> = { isi: 0, hop: 1, orth: 2 };

/** Card names come from the active wording pack (core/terms.ts); what a card does is the same in
 *  every pack. Read through getters so a pack change shows up everywhere without re-importing. */
const cardInfo = (c: CardType) => ({ label: getTerms().cards[c].label, short: getTerms().cards[c].short, abbr: getTerms().cards[c].abbr, text: CARD_EFFECT[c] });
export const CARD_INFO: Record<CardType, { label: string; short: string; abbr: string; text: string }> = {
  get isi() {
    return cardInfo('isi');
  },
  get hop() {
    return cardInfo('hop');
  },
  get orth() {
    return cardInfo('orth');
  },
};

/** A special space's effect, in the shape the renderer/host UI already expects. */
export interface SpecialSpec {
  type: SpecialType;
  /** chance only: the card this space can award. */
  card?: CardType;
  /** noise: spaces back. booster: spaces forward. Falls back to the rules default when omitted. */
  amount?: number;
}

/** One node of the board graph. */
export interface GraphNodeConfig {
  id: string;
  kind: NodeKind;
  /** chance only: the card this space can award. */
  card?: CardType;
  /** noise: spaces back. booster: spaces forward. Falls back to the rules default when omitted. */
  amount?: number;
}

/**
 * Declarative description of the board graph: a set of nodes and directed edges from TX to RX.
 * Exactly one node has kind 'tx' and exactly one has kind 'rx'; the graph must be acyclic. buildBoard()
 * (core/board.ts) only enforces those few invariants — the full design checklist (every node reachable
 * from TX, every node able to reach RX, no dead ends, no unreachable specials, sane path lengths, …)
 * lives in core/mapValidate.ts and is advisory, with an explicit override in the Map Editor.
 */
export interface BoardConfig {
  name?: string;
  nodes: GraphNodeConfig[];
  /** Directed edges, [from, to]. */
  edges: [string, string][];
}

export interface RulesConfig {
  /** Default forward spaces for a booster that has no explicit amount. */
  boosterAmount: number;
  /** Default backward spaces for a noise space that has no explicit amount. */
  noiseBack: number;
  /** ISI reaches teams within this board distance (spaces along the network). */
  isiRange: number;
  /** Spaces the ISI target moves back. */
  isiPenalty: number;
  /** FREQUENCY HOP only reaches teams within this many spaces (null = any active team). */
  hopMaxRange: number | null;
  orthBlocksIsi: boolean;
  orthBlocksHop: boolean;
  /** Number of qualification slots (capped at team count at runtime). */
  winnerSlots: number;
}

export interface BoardNode {
  idx: number;
  id: string;
  kind: NodeKind;
  /** Derived from kind/card/amount; null for tx/rx/normal. Kept for renderer/host-UI compatibility. */
  special: SpecialSpec | null;
  x: number;
  y: number;
}

export interface Board {
  config: BoardConfig;
  nodes: BoardNode[];
  tx: number;
  rx: number;
  byId: Map<string, number>;
  idOf: string[];
  /** Directed successors/predecessors by node id (small; editor- and engine-facing). */
  succ: Record<string, string[]>;
  pred: Record<string, string[]>;
  /** Topological order (node idx), TX-first, RX-last. */
  topo: number[];
  /** Numeric fast path: shortest hops from a node to RX. Unreachable nodes get UNREACHABLE. */
  remaining: Int16Array;
  /** Numeric fast path: undirected all-pairs BFS distance (n×n). -1 if disconnected. */
  dist: Int16Array;
  width: number;
  height: number;
}

/** Sentinel for "cannot reach the Receiver" in Board.remaining — large enough to always sort last. */
export const UNREACHABLE = 30000;

export type CardState = 0 | 1 | 2; // 0 = not owned, 1 = held, 2 = used

export type TeamStatus = 'active' | 'qualified' | 'out';

export interface Team {
  /** 1-based team number; also index + 1 in `Core.teams`. */
  id: number;
  name: string;
  symbol: string;
  color: string;
  node: string;
  /** The team's own visited-node history: trail[0] = TX id, trail[trail.length-1] = node. Never empty. */
  trail: string[];
  status: TeamStatus;
  /** Qualification slot 1..5 (0 = none). */
  slot: number;
  /** [isi, hop, orth] */
  cards: [CardState, CardState, CardState];
  /** Turn id in which each card was earned (−1 = never / usable at once). */
  earnedTurn: [number, number, number];
  correctByRound: number[];
  totalCorrect: number;
}

export interface Core {
  board: Board;
  rules: RulesConfig;
  teams: Team[];
  qualifiers: number[];
  /** Increments at every team turn; used to lock cards earned this turn. */
  turnId: number;
}

export interface Pos {
  node: string;
  trail: string[];
}

export type GameEvent =
  | { kind: 'move'; team: number; from: string; to: string; steps: number; correct: number }
  | { kind: 'land'; team: number; node: string; special: SpecialType }
  | { kind: 'quick'; team: number; special: SpecialType; correct: boolean }
  | { kind: 'boost'; team: number; from: string; to: string; amount: number; path: string[] }
  | { kind: 'noise-back'; team: number; from: string; to: string; amount: number; path: string[] }
  | { kind: 'card-gain'; team: number; card: CardType }
  | { kind: 'card-dup'; team: number; card: CardType }
  | { kind: 'isi'; team: number; target: number; from: string; to: string; steps: number; blocked: boolean; path: string[] }
  | { kind: 'hop'; team: number; target: number; teamFrom: string; teamTo: string; blocked: boolean }
  | { kind: 'orth'; team: number; against: CardType; attacker: number }
  | { kind: 'qualify'; team: number; slot: number };

export type Emit = (e: GameEvent) => void;

export function defaultRules(): RulesConfig {
  return {
    boosterAmount: 3,
    noiseBack: 2,
    isiRange: 3,
    isiPenalty: 2,
    hopMaxRange: null,
    orthBlocksIsi: true,
    orthBlocksHop: true,
    winnerSlots: 5,
  };
}
