// OPTIONAL hand-made board. Leave as `null` to use the simulation-tuned layout in chosenBoard.ts.
//
// To use your own layout permanently, replace `null` with an object such as:
//
//   export const CUSTOM_BOARD: CustomBoard | null = {
//     board: {
//       routeLengths: { A: 15, B: 16, C: 19 },
//       prefixLen: 3,          // shared spaces from the Transmitter to the fork (the fork is the last one, S3)
//       suffixLen: 1,          // shared spaces between the merge and the Receiver (M1)
//       specials: [
//         { node: 'A4', type: 'chance', card: 'isi' },   // ids: S1.. (shared start), A1.. B1.. C1.. (own spaces), M1.. (shared finish)
//         { node: 'A9', type: 'noise' },                  // optional "amount" overrides the global NOISE / BOOSTER strength
//         { node: 'C3', type: 'booster', amount: 4 },
//       ],
//     },
//     rules: { boosterAmount: 4, noiseBack: 2, isiRange: 3, isiPenalty: 2, hopMaxRange: null,
//              orthBlocksIsi: true, orthBlocksHop: true, winnerSlots: 5 },
//   };
//
// The Board Balancer (#/balancer) can export exactly this JSON ("Export JSON") and check your placement rules.
// After editing, restart `npm run dev` (or re-run `npm run build`).

import type { ClassicBoardConfig } from '../core/classicBoard';
import type { RulesConfig } from '../core/types';

export interface CustomBoard {
  board: ClassicBoardConfig;
  rules: RulesConfig;
}

export const CUSTOM_BOARD: CustomBoard | null = null;
