// The shipped map presets. Every preset uses the same game rules — they differ in route structure,
// length and where the special spaces sit. Each one was simulated (`npm run maps`) so that no route
// is a free win: the longer routes carry Boosters, the shorter ones carry Noise, and `rounds` is the
// round count where most games are decided by reaching the finish rather than by the fallback ranking.
//
// To add your own map: copy one of the entries below, change the shape, run `npm run maps` and tune
// until the parity gap is small (see CONTRIBUTING.md).

import { buildBoard } from '../core/board';
import { ClassicBoardConfig, compileClassicBoard } from '../core/classicBoard';
import { MapConfiguration, newMap } from '../core/mapEdit';
import { S_CURVE_WAYPOINTS, WheelStyle, Waypoints, defaultLayout } from '../core/mapLayout';
import { BoardConfig, RulesConfig } from '../core/types';
import { WheelBoardConfig, compileWheelBoard } from '../core/wheelBoard';
import { CHOSEN_BOARD, CHOSEN_RULES } from './chosenBoard';

export type MapLength = 'Quick' | 'Standard' | 'Long';

export interface MapPreset {
  id: string;
  name: string;
  blurb: string;
  length: MapLength;
  /** Recommended number of rounds (the Setup screen pre-selects this). */
  rounds: number;
  /** Comfortable team count for this map. */
  teams: [number, number];
  build: () => MapConfiguration;
}

const rules = (patch: Partial<RulesConfig> = {}): RulesConfig => ({ ...CHOSEN_RULES, ...patch });

function mapFrom(cfg: BoardConfig, r: RulesConfig, wp?: Waypoints, wheelStyle?: WheelStyle): MapConfiguration {
  return newMap(cfg, r, defaultLayout(buildBoard(cfg), wp, wheelStyle));
}

// ---------------------------------------------------------------- classic (fork → lanes → merge)

export const S_CURVE: ClassicBoardConfig = {
  name: 's-curve',
  laneIds: ['A', 'B'],
  routeLengths: { A: 17, B: 15 },
  prefixLen: 3,
  suffixLen: 2,
  specials: [
    { node: 'S2', type: 'chance', card: 'isi' },
    { node: 'A4', type: 'chance', card: 'hop' },
    { node: 'A6', type: 'booster', amount: 4 },
    { node: 'A10', type: 'noise', amount: 1 },
    { node: 'B4', type: 'chance', card: 'orth' },
    { node: 'B6', type: 'booster', amount: 2 },
    { node: 'B9', type: 'noise', amount: 2 },
  ],
};

export const SPRINT: ClassicBoardConfig = {
  name: 'sprint',
  laneIds: ['A', 'B'],
  routeLengths: { A: 10, B: 12 },
  prefixLen: 2,
  suffixLen: 2,
  specials: [
    { node: 'S1', type: 'chance', card: 'isi' },
    { node: 'A3', type: 'noise', amount: 3 },
    { node: 'A5', type: 'chance', card: 'orth' },
    { node: 'B2', type: 'booster', amount: 4 },
    { node: 'B5', type: 'chance', card: 'hop' },
  ],
};

export const LIGHTNING: ClassicBoardConfig = {
  name: 'lightning',
  laneIds: ['A', 'B', 'C'],
  routeLengths: { A: 12, B: 13, C: 15 },
  prefixLen: 2,
  suffixLen: 2,
  specials: [
    { node: 'S1', type: 'chance', card: 'isi' },
    { node: 'A3', type: 'noise', amount: 3 },
    { node: 'A5', type: 'chance', card: 'orth' },
    { node: 'B3', type: 'booster', amount: 2 },
    { node: 'C2', type: 'booster', amount: 6 },
    { node: 'C5', type: 'booster', amount: 4 },
    { node: 'M2', type: 'chance', card: 'hop' },
  ],
};

export const CROSSROADS: ClassicBoardConfig = {
  name: 'crossroads',
  laneIds: ['A', 'B', 'C', 'D'],
  routeLengths: { A: 14, B: 15, C: 16, D: 18 },
  prefixLen: 3,
  suffixLen: 3,
  specials: [
    { node: 'S2', type: 'chance', card: 'isi' },
    { node: 'A3', type: 'noise', amount: 3 },
    { node: 'A5', type: 'chance', card: 'orth' },
    { node: 'B4', type: 'noise', amount: 3 },
    { node: 'B6', type: 'booster', amount: 2 },
    { node: 'C3', type: 'booster', amount: 4 },
    { node: 'C6', type: 'chance', card: 'orth' },
    { node: 'D3', type: 'booster', amount: 6 },
    { node: 'D6', type: 'booster', amount: 5 },
    { node: 'M2', type: 'chance', card: 'hop' },
  ],
};

export const HIGHWAY: ClassicBoardConfig = {
  name: 'highway',
  laneIds: ['A', 'B', 'C', 'D', 'E'],
  routeLengths: { A: 14, B: 15, C: 16, D: 17, E: 19 },
  prefixLen: 2,
  suffixLen: 2,
  specials: [
    { node: 'S1', type: 'chance', card: 'isi' },
    { node: 'A3', type: 'noise', amount: 3 },
    { node: 'A6', type: 'noise', amount: 3 },
    { node: 'B4', type: 'chance', card: 'orth' },
    { node: 'B7', type: 'noise', amount: 3 },
    { node: 'C3', type: 'booster', amount: 2 },
    { node: 'C7', type: 'chance', card: 'hop' },
    { node: 'D3', type: 'booster', amount: 6 },
    { node: 'D7', type: 'chance', card: 'orth' },
    { node: 'E3', type: 'booster', amount: 6 },
    { node: 'E6', type: 'booster', amount: 6 },
    { node: 'E9', type: 'booster', amount: 4 },
  ],
};

export const MARATHON: ClassicBoardConfig = {
  name: 'marathon',
  laneIds: ['A', 'B', 'C'],
  routeLengths: { A: 20, B: 22, C: 25 },
  prefixLen: 3,
  suffixLen: 3,
  specials: [
    { node: 'S2', type: 'chance', card: 'isi' },
    { node: 'A3', type: 'noise', amount: 1 },
    { node: 'A6', type: 'chance', card: 'orth' },
    { node: 'A9', type: 'noise', amount: 3 },
    { node: 'A12', type: 'noise', amount: 2 },
    { node: 'B4', type: 'booster', amount: 2 },
    { node: 'B8', type: 'noise', amount: 3 },
    { node: 'B11', type: 'booster', amount: 2 },
    { node: 'C3', type: 'booster', amount: 6 },
    { node: 'C7', type: 'booster', amount: 5 },
    { node: 'C11', type: 'booster', amount: 5 },
    { node: 'C14', type: 'chance', card: 'orth' },
    { node: 'M2', type: 'chance', card: 'hop' },
  ],
};

// ---------------------------------------------------------------- wheel (chained fork/merge rings)

export const WHEEL: WheelBoardConfig = {
  name: 'wheel',
  prefixLen: 2,
  stages: [
    { laneCount: 2, laneLen: 4 },
    { laneCount: 3, laneLen: 4 },
  ],
  suffixLen: 2,
  specials: [
    { node: 'S1', type: 'chance', card: 'isi' },
    { node: 'R1A2', type: 'booster', amount: 2 },
    { node: 'R1B2', type: 'chance', card: 'orth' },
    { node: 'R1B4', type: 'booster', amount: 2 },
    { node: 'R2A2', type: 'chance', card: 'hop' },
    { node: 'R2B3', type: 'noise', amount: 2 },
    { node: 'R2C2', type: 'booster', amount: 2 },
    { node: 'R2C4', type: 'noise', amount: 2 },
  ],
};

export const CHAIN: WheelBoardConfig = {
  name: 'chain',
  prefixLen: 2,
  stages: [
    { laneCount: 2, laneLen: 3 },
    { laneCount: 2, laneLen: 3 },
    { laneCount: 2, laneLen: 3 },
  ],
  suffixLen: 1,
  specials: [
    { node: 'S1', type: 'chance', card: 'isi' },
    { node: 'R1A2', type: 'booster', amount: 2 },
    { node: 'R1B2', type: 'chance', card: 'orth' },
    { node: 'R2A3', type: 'noise', amount: 2 },
    { node: 'R2B2', type: 'booster', amount: 2 },
    { node: 'R3A2', type: 'chance', card: 'hop' },
    { node: 'R3B3', type: 'noise', amount: 2 },
  ],
};

export const SPIRAL: WheelBoardConfig = {
  name: 'spiral',
  prefixLen: 2,
  stages: [
    { laneCount: 2, laneLen: 4 },
    { laneCount: 3, laneLen: 4 },
    { laneCount: 2, laneLen: 5 },
  ],
  suffixLen: 2,
  specials: [
    { node: 'S1', type: 'chance', card: 'isi' },
    { node: 'R1A3', type: 'booster', amount: 2 },
    { node: 'R1B2', type: 'noise', amount: 1 },
    { node: 'R1B4', type: 'chance', card: 'orth' },
    { node: 'R2A3', type: 'noise', amount: 1 },
    { node: 'R2B2', type: 'chance', card: 'hop' },
    { node: 'R2C3', type: 'booster', amount: 6 },
    { node: 'R3A2', type: 'booster', amount: 3 },
    { node: 'R3B4', type: 'noise', amount: 2 },
  ],
};

export const MAP_PRESETS: MapPreset[] = [
  {
    id: 'triple',
    name: 'Triple Route',
    blurb: 'The original: 3 paths (15 / 16 / 19) — a safe short road, a quiet middle road and a Booster highway. Tuned over 250,000 simulated games.',
    length: 'Standard',
    rounds: 5,
    teams: [4, 10],
    build: () => newMap(compileClassicBoard(CHOSEN_BOARD), CHOSEN_RULES),
  },
  {
    id: 'sprint',
    name: 'Quick Sprint',
    blurb: 'Two short paths, done in 3 rounds. For tight schedules, prelims or a warm-up game.',
    length: 'Quick',
    rounds: 3,
    teams: [2, 8],
    build: () => mapFrom(compileClassicBoard(SPRINT), rules({ winnerSlots: 3 })),
  },
  {
    id: 'lightning',
    name: 'Lightning Triple',
    blurb: 'A compact 3-path board (12 / 13 / 15) that fits a 4-round slot.',
    length: 'Quick',
    rounds: 4,
    teams: [3, 10],
    build: () => mapFrom(compileClassicBoard(LIGHTNING), rules()),
  },
  {
    id: 's-curve',
    name: 'S-Curve',
    blurb: 'Two paths, one bending through a dramatic S. A real choice at the fork, and easy to read on a projector.',
    length: 'Standard',
    rounds: 5,
    teams: [2, 8],
    build: () => mapFrom(compileClassicBoard(S_CURVE), rules(), S_CURVE_WAYPOINTS),
  },
  {
    id: 'crossroads',
    name: 'Crossroads',
    blurb: 'Four paths (14 / 15 / 16 / 18). More choice, less crowding — good for 6–10 teams.',
    length: 'Standard',
    rounds: 5,
    teams: [5, 10],
    build: () => mapFrom(compileClassicBoard(CROSSROADS), rules()),
  },
  {
    id: 'highway',
    name: 'Five-Lane Highway',
    blurb: 'Five paths, from the shortest road to a triple-Booster express lane. Spreads a big field of teams out.',
    length: 'Standard',
    rounds: 5,
    teams: [6, 10],
    build: () => mapFrom(compileClassicBoard(HIGHWAY), rules()),
  },
  {
    id: 'wheel',
    name: 'Wheel',
    blurb: 'Two ring-shaped stages spiralling outward. Teams pick a lane at every ring, so the lead changes often.',
    length: 'Standard',
    rounds: 5,
    teams: [3, 10],
    build: () => mapFrom(compileWheelBoard(WHEEL), rules()),
  },
  {
    id: 'chain',
    name: 'Chain Links',
    blurb: 'Three small two-lane rings in a row: a quick decision every few spaces.',
    length: 'Standard',
    rounds: 5,
    teams: [3, 10],
    build: () => mapFrom(compileWheelBoard(CHAIN), rules(), undefined, 'chain'),
  },
  {
    id: 'spiral',
    name: 'Grand Spiral',
    blurb: 'Three rings, seven lanes, a long way round. For a 6-round finals slot.',
    length: 'Long',
    rounds: 6,
    teams: [4, 10],
    build: () => mapFrom(compileWheelBoard(SPIRAL), rules()),
  },
  {
    id: 'marathon',
    name: 'Marathon',
    blurb: 'Three long paths (20 / 22 / 25) for a 7-round grand finale.',
    length: 'Long',
    rounds: 7,
    teams: [4, 10],
    build: () => mapFrom(compileClassicBoard(MARATHON), rules()),
  },
];

export function mapPresetById(id: string): MapPreset | undefined {
  return MAP_PRESETS.find((p) => p.id === id);
}

/** The preset a board was built from (every preset names its board after its id), if any. */
export function presetForBoard(cfg: BoardConfig): MapPreset | undefined {
  const id = cfg.name === 'recommended' ? 'triple' : cfg.name;
  return MAP_PRESETS.find((p) => p.id === id);
}
