// Shape of the generated file src/data/chosenBoard.ts (written by `npm run optimize`).
// The optimizer's structural search stays classic-only (see core/classicBoard.ts / sim/optimize.ts's
// module comments), so the generated board is still a ClassicBoardConfig — compiled to the live graph
// BoardConfig at load time by state/mapStore.ts.

import { ClassicBoardConfig } from '../core/classicBoard';
import { RulesConfig } from '../core/types';
import { Report } from './metrics';
import { SimConfig } from './model';

export interface CandidateRow {
  label: string;
  description: string;
  score: number;
  report: Report;
}

export interface SensitivityRow {
  label: string;
  note: string;
  report: Report;
}

export interface ChosenData {
  generatedAt: string;
  seed: number;
  screenedLayouts: number;
  gamesPerFinalist: number;
  winnerGames: number;
  board: ClassicBoardConfig;
  rules: RulesConfig;
  /** Simulation model the layout was tuned against (board/rules omitted). */
  model: Omit<SimConfig, 'board' | 'rules'>;
  report: Report;
  report4Rounds: Report;
  sensitivity: SensitivityRow[];
  candidates: CandidateRow[];
  rationale: string[];
  effectiveLengths: { id: string; length: number; effective: number }[];
}
