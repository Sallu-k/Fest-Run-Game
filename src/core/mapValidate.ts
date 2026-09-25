// The 10-point map validation checklist. buildBoard() (core/board.ts) already refuses to build a
// board with a duplicate id, zero/multiple TX or RX nodes, or a cycle — those four are structural
// invariants nothing here can be well-defined without, so they're always hard errors with no override.
// Everything else here is advisory: a node the current design leaves stranded doesn't crash anything
// (it just never gets visited, or a team that lands there never moves again), so the Map Editor can
// offer an explicit "start anyway" override for those, matching the brief's "unless they explicitly
// override it."

import { buildBoard, longestPath, shortestPath, BoardBuildError } from './board';
import { BoardConfig, UNREACHABLE } from './types';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  nodeIds?: string[];
}

export interface ValidationReport {
  /** True only if there are no `severity: 'error'` issues (hard invariants always included as errors). */
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Every error/warning code that is safe to override and still start a game with (i.e. not a
   *  buildBoard()-fatal invariant). */
  overridable: boolean;
}

/** Codes that buildBoard() itself refuses to run without — never overridable. */
export const HARD_CODES = new Set(['DUPLICATE_ID', 'SINGLE_TX', 'SINGLE_RX', 'CYCLE', 'BUILD_ERROR']);

const MIN_REASONABLE_PATH = 8;
const MAX_REASONABLE_PATH = 40;

export function validateMap(cfg: BoardConfig): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const push = (list: ValidationIssue[], code: string, message: string, nodeIds?: string[]) =>
    list.push({ code, severity: list === errors ? 'error' : 'warning', nodeIds, message });

  // 9. duplicate node ids (checked before buildBoard so we can list every duplicate, not just the first)
  const seen = new Map<string, number>();
  for (const n of cfg.nodes) seen.set(n.id, (seen.get(n.id) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, c]) => c > 1).map(([id]) => id);
  if (dupes.length) push(errors, 'DUPLICATE_ID', `Duplicate node id${dupes.length > 1 ? 's' : ''}: ${dupes.join(', ')}.`, dupes);

  // 1 & 2. exactly one TX, exactly one RX
  const txIds = cfg.nodes.filter((n) => n.kind === 'tx').map((n) => n.id);
  const rxIds = cfg.nodes.filter((n) => n.kind === 'rx').map((n) => n.id);
  if (txIds.length !== 1) push(errors, 'SINGLE_TX', txIds.length === 0 ? 'The board has no Transmitter.' : `The board has ${txIds.length} Transmitters (${txIds.join(', ')}) — there must be exactly one.`, txIds);
  if (rxIds.length !== 1) push(errors, 'SINGLE_RX', rxIds.length === 0 ? 'The board has no Receiver.' : `The board has ${rxIds.length} Receivers (${rxIds.join(', ')}) — there must be exactly one.`, rxIds);

  if (dupes.length || txIds.length !== 1 || rxIds.length !== 1) {
    // Can't safely build/BFS with these unresolved; report what we have and stop here.
    return { valid: false, errors, warnings, overridable: false };
  }

  let board;
  try {
    board = buildBoard(cfg);
  } catch (e) {
    if (e instanceof BoardBuildError && /cycle/i.test(e.message)) {
      push(errors, 'CYCLE', e.message);
      return { valid: false, errors, warnings, overridable: false };
    }
    push(errors, 'BUILD_ERROR', e instanceof Error ? e.message : String(e));
    return { valid: false, errors, warnings, overridable: false };
  }

  const n = board.nodes.length;

  // 3. every node reachable from TX (forward BFS)
  const fromTx = new Uint8Array(n);
  {
    fromTx[board.tx] = 1;
    const q = [board.tx];
    let head = 0;
    while (head < q.length) {
      const u = q[head++];
      for (const vId of board.succ[board.idOf[u]]) {
        const v = board.byId.get(vId)!;
        if (!fromTx[v]) {
          fromTx[v] = 1;
          q.push(v);
        }
      }
    }
  }
  const unreachableFromTx = board.nodes.filter((nd) => !fromTx[nd.idx]).map((nd) => nd.id);
  if (unreachableFromTx.length) push(errors, 'UNREACHABLE_FROM_TX', `Not reachable from the Transmitter: ${unreachableFromTx.join(', ')}.`, unreachableFromTx);

  // 4. every node can reach RX (backward BFS — remaining is already computed this way in buildBoard)
  const cantReachRx = board.nodes.filter((nd) => board.remaining[nd.idx] >= UNREACHABLE).map((nd) => nd.id);
  // 7. dead ends: reachable from TX, but can't reach RX (a strict, more actionable subset)
  const deadEnds = board.nodes.filter((nd) => fromTx[nd.idx] && board.remaining[nd.idx] >= UNREACHABLE && nd.kind !== 'rx').map((nd) => nd.id);
  if (deadEnds.length) push(errors, 'DEAD_END', `Dead end${deadEnds.length > 1 ? 's' : ''} — cannot reach the Receiver: ${deadEnds.join(', ')}.`, deadEnds);
  const otherCantReach = cantReachRx.filter((id) => !deadEnds.includes(id) && !unreachableFromTx.includes(id));
  if (otherCantReach.length) push(errors, 'CANT_REACH_RX', `Cannot reach the Receiver: ${otherCantReach.join(', ')}.`, otherCantReach);

  // 6. disconnected nodes (neither reachable from TX nor reaching RX at all — isolated)
  const disconnected = board.nodes.filter((nd) => !fromTx[nd.idx] && board.remaining[nd.idx] >= UNREACHABLE).map((nd) => nd.id);
  if (disconnected.length) push(errors, 'DISCONNECTED', `Disconnected from the rest of the map: ${disconnected.join(', ')}.`, disconnected);

  // 8. unreachable special tiles
  const unreachableSpecials = board.nodes.filter((nd) => nd.special && !fromTx[nd.idx]).map((nd) => nd.id);
  if (unreachableSpecials.length) push(errors, 'UNREACHABLE_SPECIAL', `Special space${unreachableSpecials.length > 1 ? 's' : ''} can never be reached: ${unreachableSpecials.join(', ')}.`, unreachableSpecials);

  // 5. loops — buildBoard() already refused to build if there was one; nothing further to check here.

  // 10. path length within reasonable bounds
  const shortest = shortestPath(board);
  const longest = longestPath(board);
  if (shortest >= 0 && shortest < MIN_REASONABLE_PATH) push(warnings, 'PATH_TOO_SHORT', `The shortest Transmitter→Receiver path is only ${shortest} spaces — consider lengthening it.`);
  if (longest > MAX_REASONABLE_PATH) push(warnings, 'PATH_TOO_LONG', `The longest Transmitter→Receiver path is ${longest} spaces — consider shortening it.`);

  return { valid: errors.length === 0, errors, warnings, overridable: errors.every((e) => !HARD_CODES.has(e.code)) };
}
