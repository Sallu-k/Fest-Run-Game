// Generates a plain-language explanation of why each special space sits where it does.
//
// The classic (compiled) board keeps its exact original copy — "Path A / B / C", "N shared spaces",
// etc. — via `detectClassicShape`; a custom/non-classic graph falls back to generic per-node prose
// instead of assuming a fork/merge skeleton exists at all.

import { buildBoard } from '../core/board';
import { ClassicShape, RouteId, classicNodeMeta, detectClassicShape } from '../core/classicBoard';
import { specialAmount } from '../core/engine';
import { BoardConfig, RulesConfig } from '../core/types';
import { Report } from './metrics';
import { SimConfig, branchOptionValue, cdfMean, normalisePmf, quickProb, tiltedCdf } from './model';

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const ROUTE_LETTERS: RouteId[] = ['A', 'B', 'C'];

export interface EffectiveLength {
  id: string;
  length: number;
  effective: number;
}

/** Expected effective TX→RX length through each option of the board's first branch node, for an
 *  average team. Works on any graph with at least one branch point (returns [] if the board never
 *  branches at all); on the classic board this is exactly "Path A/B/C effective length". */
export function effectiveLengths(cfg: SimConfig): EffectiveLength[] {
  const board = buildBoard(cfg.board);
  const rules = cfg.rules;
  const cdf = tiltedCdf(normalisePmf(cfg.pmf), 0);
  const hit = Math.min(0.6, 1 / Math.max(1, cdfMean(cdf)));
  const q = quickProb(cfg, 0);
  const forkId = board.nodes.find((n) => board.succ[n.id].length > 1)?.id;
  if (!forkId) return [];
  const n = board.nodes.length;
  return board.succ[forkId].map((option) => {
    const optIdx = board.byId.get(option)!;
    const distToOption = board.dist[board.tx * n + optIdx];
    return {
      id: option,
      length: distToOption + board.remaining[optIdx],
      effective: distToOption + branchOptionValue(board, rules, option, cfg, hit, q),
    };
  });
}

function laneName(shape: ClassicShape | null, id: string): string {
  if (!shape) return id;
  const meta = classicNodeMeta(id);
  return (ROUTE_LETTERS as string[]).includes(meta.lane) ? meta.lane : id;
}

export function explainLayout(board: BoardConfig, rules: RulesConfig, report: Report, cfg: SimConfig): string[] {
  const b = buildBoard(board);
  const lines: string[] = [];
  const shape = detectClassicShape(b);
  const eff = effectiveLengths({ ...cfg, board, rules });

  if (shape) {
    lines.push(
      `Structure: ${shape.prefixLen} shared space${shape.prefixLen === 1 ? '' : 's'} from the Transmitter to the fork, then Path A / B / C with ` +
        `${ROUTE_LETTERS.map((r) => shape.branchLen[r]).join(' / ')} own spaces, merging into ${shape.suffixLen} shared space${shape.suffixLen === 1 ? '' : 's'} before the Receiver. ` +
        `Route lengths stay exactly ${ROUTE_LETTERS.map((r) => shape.routeLengths[r]).join(' / ')}.`,
    );
  } else {
    lines.push(
      `Structure: a custom ${b.nodes.length}-node network from Transmitter to Receiver (not the classic single-fork layout), ` +
        `${eff.length} branch option${eff.length === 1 ? '' : 's'} at the first fork.`,
    );
  }
  if (eff.length) {
    lines.push(
      `Expected effective length for an average team (real length minus expected Booster/Chance gain plus expected Noise loss): ` +
        eff.map((e) => `${laneName(shape, e.id)} ${e.effective.toFixed(1)}`).join(', ') + '.',
    );
  }
  const hitOf = (id: string) => report.nodes.find((n) => n.id === id)?.hitRate ?? 0;
  for (const n of b.nodes) {
    const sp = n.special;
    if (!sp) continue;
    const meta = shape ? classicNodeMeta(n.id) : null;
    const route = meta
      ? meta.lane === 'S'
        ? 'the shared start'
        : meta.lane === 'M'
          ? 'the shared finish'
          : (ROUTE_LETTERS as string[]).includes(meta.lane)
            ? `Path ${meta.lane}`
            : `node ${n.id}`
      : `node ${n.id}`;
    const rem = b.remaining[n.idx];
    const hit = `${pct(hitOf(n.id))} of teams land here`;
    if (sp.type === 'booster') {
      const amt = specialAmount(rules, sp);
      lines.push(
        `${n.id} — SIGNAL BOOSTER +${amt} on ${route}: ${hit}. It sits ${rem} spaces from the Receiver, so even after the jump the team still needs ${Math.max(0, rem - amt)} more; ` +
          `it shortens ${route} without deciding the game on its own.`,
      );
    } else if (sp.type === 'noise') {
      lines.push(
        `${n.id} — NOISE −${specialAmount(rules, sp)} on ${route}: ${hit}. A quick question protects the team, so this is a soft penalty that ` +
          `trims the reward of the route rather than punishing luck.`,
      );
    } else {
      lines.push(
        `${n.id} — CHANCE (${sp.card!.toUpperCase()}) on ${route}: ${hit}. ` +
          (route === 'the shared start' || route === 'the shared finish'
            ? 'Every team passes here, so the card is reachable for everyone.'
            : `Teams that reach ${route} can earn the card.`),
      );
    }
  }
  lines.push(
    `No two special spaces are adjacent, no Noise follows a Chance within two spaces, and no Booster lands within 4 spaces of the Receiver.`,
  );
  return lines;
}
