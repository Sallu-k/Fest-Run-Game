// Map themes: one token set per map style. Every renderer reads these tokens, so switching style changes
// only how the world is painted — never the game state.

import type { MapStyleId } from '../../state/mapStore';
import { EXTRA_LANE_COLORS } from './colors';

export interface MapTheme {
  id: MapStyleId;
  dark: boolean;
  skyTop: string;
  skyMid: string;
  skyBot: string;
  /** soft coloured blobs in the sky */
  nebulaA: string;
  nebulaB: string;
  starColor: string;
  starDensity: number;
  cloud: string;
  platTop: string;
  platTopHi: string;
  platRim: string;
  platSide: string;
  platSide2: string;
  ribbonFill: string;
  ribbonEdge: string;
  ribbonPlank: string;
  tileTop: string;
  tileSide: string;
  shadow: string;
  ink: string;
  inkSoft: string;
  chipBg: string;
  chipInk: string;
  /** Only A/B/C/S have an explicit entry in every theme — any other lane id (a custom map's lane, or a
   *  wheel stage) resolves through `themeRouteColor()`'s generated fallback instead. */
  route: Record<string, string>;
  chance: string;
  noise: string;
  booster: string;
  glow: number;
  /** animated glowing lane on the ribbons */
  neonLane: boolean;
  planetA: string;
  planetB: string;
  slotFill: string;
  slotStroke: string;
  metal: string;
  metalDark: string;
}

const light = {
  dark: false,
  ink: '#123259',
  inkSoft: '#4a6a93',
  chipBg: 'rgba(255,255,255,0.94)',
  chipInk: '#123259',
  shadow: 'rgba(52,86,140,0.30)',
  chance: '#a855f7',
  noise: '#ef4444',
  booster: '#16a34a',
};

export const THEMES: Record<MapStyleId, MapTheme> = {
  galactic: {
    ...light,
    id: 'galactic',
    skyTop: '#cfeaff',
    skyMid: '#e6f5ff',
    skyBot: '#f7fcff',
    nebulaA: '#c4b5fd',
    nebulaB: '#86efac',
    starColor: '#7cc4f5',
    starDensity: 0.7,
    cloud: '#ffffff',
    platTop: '#f1fbff',
    platTopHi: '#ffffff',
    platRim: '#8fd3f0',
    platSide: '#b4d2ee',
    platSide2: '#7fa8d6',
    ribbonFill: '#ffffff',
    ribbonEdge: '#b9d3ee',
    ribbonPlank: '#d5e6f7',
    tileTop: '#ffffff',
    tileSide: '#a9c4e2',
    route: { A: '#0ea5e9', B: '#8b5cf6', C: '#f59e0b', S: '#22c55e' },
    glow: 0.35,
    neonLane: false,
    planetA: '#a5b4fc',
    planetB: '#7dd3fc',
    slotFill: '#ffffff',
    slotStroke: '#8fd3f0',
    metal: '#e8f1fb',
    metalDark: '#9db6d3',
  },
  clean: {
    ...light,
    id: 'clean',
    skyTop: '#a9dcff',
    skyMid: '#d3efff',
    skyBot: '#f2faff',
    nebulaA: '#fde68a',
    nebulaB: '#bbf7d0',
    starColor: '#ffffff',
    starDensity: 0.15,
    cloud: '#ffffff',
    platTop: '#b9e8a0',
    platTopHi: '#d7f7c0',
    platRim: '#7cc866',
    platSide: '#d1a978',
    platSide2: '#a67c52',
    ribbonFill: '#f8e6ba',
    ribbonEdge: '#c69357',
    ribbonPlank: '#d8a969',
    tileTop: '#fff8e6',
    tileSide: '#c99a5c',
    route: { A: '#0ea5e9', B: '#a855f7', C: '#f97316', S: '#22c55e' },
    glow: 0,
    neonLane: false,
    planetA: '#fdba74',
    planetB: '#86efac',
    slotFill: '#fffaf0',
    slotStroke: '#c69357',
    metal: '#fff4dc',
    metalDark: '#c9a06a',
    shadow: 'rgba(120,80,30,0.28)',
  },
  hybrid: {
    ...light,
    id: 'hybrid',
    skyTop: '#d6ecff',
    skyMid: '#eaf6ff',
    skyBot: '#f8fdff',
    nebulaA: '#ddd6fe',
    nebulaB: '#a7f3d0',
    starColor: '#38bdf8',
    starDensity: 0.5,
    cloud: '#ffffff',
    platTop: '#e5f8ea',
    platTopHi: '#f6fff8',
    platRim: '#6ee7b7',
    platSide: '#b8cfe8',
    platSide2: '#84a4cf',
    ribbonFill: '#ffffff',
    ribbonEdge: '#c9d8ee',
    ribbonPlank: '#dbe7f5',
    tileTop: '#ffffff',
    tileSide: '#a9bfdc',
    route: { A: '#06b6d4', B: '#8b5cf6', C: '#f59e0b', S: '#10b981' },
    glow: 0.8,
    neonLane: true,
    planetA: '#c4b5fd',
    planetB: '#67e8f9',
    slotFill: '#ffffff',
    slotStroke: '#67e8f9',
    metal: '#eef5fc',
    metalDark: '#9fb8d6',
  },
  neon: {
    id: 'neon',
    dark: true,
    skyTop: '#060a24',
    skyMid: '#0d1140',
    skyBot: '#1b1256',
    nebulaA: '#7c3aed',
    nebulaB: '#0891b2',
    starColor: '#a5f3fc',
    starDensity: 1,
    cloud: '#3b3f8f',
    platTop: '#1a2a63',
    platTopHi: '#26397f',
    platRim: '#22d3ee',
    platSide: '#111a48',
    platSide2: '#080e2c',
    ribbonFill: '#0b1236',
    ribbonEdge: '#1e2f7a',
    ribbonPlank: '#16225e',
    tileTop: '#16224f',
    tileSide: '#0a1235',
    shadow: 'rgba(0,0,0,0.5)',
    ink: '#e6f6ff',
    inkSoft: '#9db8e6',
    chipBg: 'rgba(10,16,52,0.92)',
    chipInk: '#e6f6ff',
    route: { A: '#22d3ee', B: '#c084fc', C: '#fbbf24', S: '#4ade80' },
    chance: '#e879f9',
    noise: '#fb7185',
    booster: '#4ade80',
    glow: 1,
    neonLane: true,
    planetA: '#7c3aed',
    planetB: '#0891b2',
    slotFill: '#0e1650',
    slotStroke: '#22d3ee',
    metal: '#26397f',
    metalDark: '#111a48',
  },
};

export const themeOf = (id: MapStyleId): MapTheme => THEMES[id] ?? THEMES.galactic;

const FALLBACK_LANE_PALETTE = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#22c55e', '#ec4899', '#eab308', '#14b8a6', '#f43f5e', '#a78bfa', '#fb7185'];

/** Resolves a lane's ribbon/label colour: an explicit theme entry if this lane id has one (today's
 *  A/B/C/S), otherwise a colour generated from the lane's position — so a custom map's lane set (a
 *  2-lane S-Curve, a wheel's per-stage lanes) "just works" without hand-editing every theme object. */
export function themeRouteColor(t: MapTheme, laneId: string, index = 0): string {
  return t.route[laneId] ?? EXTRA_LANE_COLORS[laneId] ?? FALLBACK_LANE_PALETTE[index % FALLBACK_LANE_PALETTE.length];
}

/** Mix a colour with white (p = % of the colour kept). */
export const tint = (c: string, p: number) => `color-mix(in srgb, ${c} ${p}%, white)`;
/** Mix a colour with deep navy (p = % of the colour kept). */
export const shade = (c: string, p: number) => `color-mix(in srgb, ${c} ${p}%, #0b1230)`;
