// Placement rules from the design brief: enforced by the optimizer, surfaced as warnings in the
// Balancer, and folded into the Map Editor's CHECKS panel via mapEdit.ts's mapReport(). Fully generic
// over the board graph: "too close to a fork" and "adjacent specials" are graph-local checks (via
// board.succ/board.pred) rather than route-position math, so they apply to any DAG shape, not just
// the classic named-branch skeleton. Lives in core/ (not sim/) so mapEdit.ts can use it without a
// core -> sim dependency; sim/constraints.ts re-exports this for its existing callers.

import { specialAmount } from './engine';
import { Board, RulesConfig } from './types';

export const MAX_BOOSTER = 6;
/** After a booster the team must still be at least this far from the Receiver. */
export const BOOSTER_MIN_REMAINING_AFTER = 4;
/** No specials directly after a branch point (a push-back there would re-open the route choice). */
export const MIN_BRANCH_POS = 2;

export function layoutProblems(board: Board, rules: RulesConfig): string[] {
  const out: string[] = [];
  const isBranch = (id: string) => board.succ[id].length > 1;
  const isMerge = (id: string) => board.pred[id].length > 1;

  for (const n of board.nodes) {
    const sp = n.special;
    if (!sp) continue;
    if (isBranch(n.id)) out.push(`${n.id}: a branch point cannot hold a special (the route choice happens here).`);
    if (isMerge(n.id)) out.push(`${n.id}: a merge point affects every incoming route equally — put the special on one of the approaching spaces instead.`);
    if (board.pred[n.id].some(isBranch)) out.push(`${n.id}: too close to a fork (a push-back here re-opens the route choice).`);
    if (sp.type === 'booster') {
      const amt = specialAmount(rules, sp);
      if (amt > MAX_BOOSTER) out.push(`${n.id}: booster +${amt} exceeds the ${MAX_BOOSTER}-space cap.`);
      if (board.remaining[n.idx] - amt < BOOSTER_MIN_REMAINING_AFTER) {
        out.push(`${n.id}: booster lands within ${BOOSTER_MIN_REMAINING_AFTER} spaces of the Receiver (result becomes trivial).`);
      }
    }
    if (sp.type === 'chance' && !sp.card) out.push(`${n.id}: chance has no card.`);
  }

  // adjacency: two specials directly connected, or one hop apart through a single plain node
  const seen = new Set<string>();
  const flag = (a: string, b: string, msg: string) => {
    const key = [a, b].sort().join('-');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(msg);
    }
  };
  for (const n of board.nodes) {
    if (!n.special) continue;
    for (const succId of board.succ[n.id]) {
      const succNode = board.nodes[board.byId.get(succId)!];
      if (succNode.special) {
        flag(n.id, succId, `${n.id} and ${succId} are adjacent specials.`);
      } else {
        for (const succ2Id of board.succ[succId]) {
          const succ2 = board.nodes[board.byId.get(succ2Id)!];
          if (succ2.special && n.special.type === 'chance' && succ2.special.type === 'noise') {
            flag(n.id, succ2Id, `${succ2Id}: a Noise space right after Chance ${n.id}.`);
          }
        }
      }
    }
  }
  return out;
}
