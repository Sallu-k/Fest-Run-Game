// Thin compatibility layer over mapStore: which board + rules (+ layout) a new game uses, in priority order:
//   1. a map saved from the Map Editor / Board Balancer in this browser (localStorage),
//   2. src/data/customBoard.ts (hand-edited, permanent),
//   3. the simulation-tuned layout in src/data/chosenBoard.ts.

import { ClassicBoardConfig } from '../core/classicBoard';
import { MapLayout } from '../core/mapLayout';
import { BoardConfig, RulesConfig } from '../core/types';
import { applyBoardFromBalancer, clearActiveMap, getActiveMap } from './mapStore';

export interface ActiveBoard {
  cfg: BoardConfig;
  rules: RulesConfig;
  layout: MapLayout;
  isOverride: boolean;
  source: 'balancer' | 'custom-file' | 'recommended';
}

export function getActiveBoard(): ActiveBoard {
  const { map, source } = getActiveMap();
  return {
    cfg: map.board,
    rules: map.rules,
    layout: map.layout,
    isOverride: source === 'saved-map',
    source: source === 'saved-map' ? 'balancer' : source,
  };
}

/** Used by the Board Balancer's "Apply to next game" — the Balancer's structural search is classic-only
 *  (see core/classicBoard.ts), so `cfg` is a ClassicBoardConfig, compiled to the graph shape in mapStore. */
export function setBoardOverride(cfg: ClassicBoardConfig, rules: RulesConfig) {
  applyBoardFromBalancer(cfg, rules);
}

export function clearBoardOverride() {
  clearActiveMap();
}
