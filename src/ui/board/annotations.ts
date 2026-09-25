// Where to put tile captions and path-name chips so they never sit on top of neighbouring stones.
// Classic-shaped boards only (see core/classicBoard.ts) — chip placement needs a well-defined "middle
// of this path's own spaces", which only the classic single-fork shape currently has a renderer for.
// Works for any lane count (>= 2): the lane set is read from the board itself, never assumed to be A/B/C.
import type { Board, BoardNode } from '../../core/types';
import { classicLanes } from '../../core/classicBoard';

const nodeOf = (board: Board, id: string): BoardNode => board.nodes[board.byId.get(id)!];

interface Pt {
  x: number;
  y: number;
}

export interface Annotations {
  /** node id → y offset of its caption (below or above the tile) */
  captionY: Record<string, number>;
  chips: Record<string, Pt>;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function computeAnnotations(board: Board, decor: { kind: string; x: number; y: number; scale: number }[] = []): Annotations {
  const pts = board.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  const captionPts: Pt[] = [];
  const captionY: Record<string, number> = {};
  for (const n of board.nodes) {
    if (!n.special) continue;
    let best = 58;
    let bestScore = -1;
    for (const dy of [58, -70]) {
      const c = { x: n.x, y: n.y + dy };
      let score = Infinity;
      for (const p of pts) if (p.id !== n.id) score = Math.min(score, dist(c, p) * (Math.abs(p.x - c.x) < 90 ? 0.8 : 1));
      if (score > bestScore) {
        bestScore = score;
        best = dy;
      }
    }
    captionY[n.id] = best;
    captionPts.push({ x: n.x, y: n.y + best });
  }

  // tall landmarks the chips should keep clear of
  const tall: Record<string, number> = { core: 150, portal: 70, gate: 80, observatory: 60, relay: 80, hub: 60, tower: 70, dish: 50, crystal: 40 };
  const avoid: Pt[] = decor.filter((d) => tall[d.kind]).map((d) => ({ x: d.x, y: d.y - tall[d.kind] * d.scale }));

  const chips: Record<string, Pt> = {};
  const lanes = classicLanes(board);
  const laneIds = lanes ? lanes.laneIds : [];
  const forkNode = lanes ? nodeOf(board, lanes.prefix.length ? lanes.prefix[lanes.prefix.length - 1] : lanes.tx) : board.nodes[0];
  const branchNodes = laneIds.map((r) => (lanes ? lanes.branch[r].map((id) => nodeOf(board, id)) : []));
  const placed: Pt[] = [];
  laneIds.forEach((r, ri) => {
    const list = branchNodes[ri];
    const mid = list[Math.floor(list.length / 2)] ?? forkNode;
    const prev = list[Math.floor(list.length / 2) - 1] ?? mid;
    const next = list[Math.floor(list.length / 2) + 1] ?? mid;
    let nx = -(next.y - prev.y);
    let ny = next.x - prev.x;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    let best: Pt = { x: mid.x + nx * 90, y: mid.y + ny * 90 };
    let bestScore = -1;
    for (const side of [1, -1])
      for (const off of [80, 105, 130, 160])
        for (const along of [0, -90, 90]) {
          const c = { x: mid.x + nx * off * side + (next.x - prev.x) / (l || 1) * along * 0.5, y: mid.y + ny * off * side + (next.y - prev.y) / (l || 1) * along * 0.5 };
          let score = Infinity;
          for (const p of pts) score = Math.min(score, dist(c, p));
          for (const p of captionPts) score = Math.min(score, dist(c, p) * 0.9);
          for (const p of placed) score = Math.min(score, dist(c, p) * 0.7);
          for (const p of avoid) score = Math.min(score, dist(c, p) * 0.75);
          score -= off * 0.15; // prefer staying close to the route it names
          if (score > bestScore) {
            bestScore = score;
            best = c;
          }
        }
    chips[r] = best;
    placed.push(best);
  });
  return { captionY, chips };
}
