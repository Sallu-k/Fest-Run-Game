import { memo, useMemo } from 'react';
import { smoothPathD } from '../../core/spline';
import type { MapLayout } from '../../core/mapLayout';
import { RouteId, classicLanes, detectClassicShape } from '../../core/classicBoard';
import { Board } from '../../core/types';
import { wheelLanes } from '../../core/wheelBoard';
import { computeAnnotations } from './annotations';
import { MapTheme, shade, themeRouteColor, tint } from './theme';

interface Pt {
  x: number;
  y: number;
}

const pt = (board: Board, id: string): Pt => {
  const n = board.nodes[board.byId.get(id)!];
  return { x: n.x, y: n.y };
};

export interface RouteGeom {
  id: RouteId | 'S';
  pts: Pt[];
}

/** Ribbon polylines, all derived from node coordinates (so dragging a node reshapes its bridge).
 *  Classic- or wheel-shaped boards only (see core/classicBoard.ts / core/wheelBoard.ts's module
 *  comments) — the live renderer doesn't yet know how to draw a fully arbitrary graph's ribbons. */
export function routeGeometry(board: Board): RouteGeom[] {
  const lanes = classicLanes(board);
  if (lanes) {
    const out: RouteGeom[] = [];
    const pre: Pt[] = [pt(board, lanes.tx), ...lanes.prefix.map((id) => pt(board, id))];
    out.push({ id: 'S', pts: pre });
    const forkId = lanes.prefix.length ? lanes.prefix[lanes.prefix.length - 1] : lanes.tx;
    const mergeEntryId = lanes.suffix.length ? lanes.suffix[0] : lanes.rx;
    if (lanes.suffix.length) {
      const suf: Pt[] = [...lanes.suffix.map((id) => pt(board, id)), pt(board, lanes.rx)];
      out.push({ id: 'S', pts: suf });
    }
    lanes.laneIds.forEach((r) => {
      const pts: Pt[] = [pt(board, forkId), ...lanes.branch[r].map((id) => pt(board, id)), pt(board, mergeEntryId)];
      out.push({ id: r, pts });
    });
    return out;
  }
  const wheel = wheelLanes(board);
  if (wheel) {
    const out: RouteGeom[] = [];
    const pre: Pt[] = [pt(board, wheel.tx), ...wheel.prefix.map((id) => pt(board, id))];
    out.push({ id: 'S', pts: pre });
    if (wheel.suffix.length) {
      const lastGroupExit = wheel.groups[wheel.groups.length - 1]?.exit;
      const suf: Pt[] = [...(lastGroupExit ? [pt(board, lastGroupExit)] : []), ...wheel.suffix.map((id) => pt(board, id)), pt(board, wheel.rx)];
      out.push({ id: 'S', pts: suf });
    }
    wheel.groups.forEach((g) => {
      const pts: Pt[] = [pt(board, g.entry), ...g.nodes.map((id) => pt(board, id)), pt(board, g.exit)];
      out.push({ id: g.laneId, pts });
    });
    return out;
  }
  return [];
}

function ribbonColors(t: MapTheme, color: string) {
  switch (t.id) {
    case 'clean':
      return { edge: t.ribbonEdge, fill: t.ribbonFill, lane: color, laneOpacity: 0.9, plank: true, glow: 0 };
    case 'neon':
      return { edge: shade(color, 55), fill: t.ribbonFill, lane: color, laneOpacity: 1, plank: false, glow: 0.42 };
    case 'hybrid':
      return { edge: t.ribbonEdge, fill: '#ffffff', lane: color, laneOpacity: 1, plank: false, glow: 0.3 };
    default:
      return { edge: tint(color, 55), fill: tint(color, 9), lane: color, laneOpacity: 0.85, plank: false, glow: 0.1 };
  }
}

export const RouteLayer = memo(function RouteLayer({ board, layout, t }: { board: Board; layout: MapLayout; t: MapTheme }) {
  const geoms = useMemo(() => routeGeometry(board), [board]);
  const shape = useMemo(() => detectClassicShape(board), [board]);
  const labels = useMemo(() => {
    if (!shape) return [];
    const ann = computeAnnotations(board, layout.decor);
    return shape.laneIds.map((r, i) => ({ r, i, x: ann.chips[r].x, y: ann.chips[r].y, text: `${layout.pathLabels[r] ?? `PATH ${r}`} · ${shape.routeLengths[r]}` }));
  }, [board, layout.pathLabels, layout.decor, shape]);

  return (
    <g pointerEvents="none" strokeLinecap="round" strokeLinejoin="round" fill="none">
      {geoms.map((g, i) => {
        const color = themeRouteColor(t, g.id, i);
        const c = ribbonColors(t, color);
        const d = smoothPathD(g.pts);
        return (
          <g key={i}>
            <path d={d} stroke={t.shadow} strokeWidth={50} opacity={0.55} transform="translate(0 11)" />
            {c.glow > 0 && <path d={d} stroke={color} strokeWidth={62} opacity={c.glow * 0.5} />}
            <path d={d} stroke={c.edge} strokeWidth={44} />
            <path d={d} stroke={c.fill} strokeWidth={35} />
            {c.plank && <path d={d} stroke={t.ribbonPlank} strokeWidth={35} strokeLinecap="butt" strokeDasharray="3 15" opacity={0.75} />}
            <path d={d} stroke={c.lane} strokeWidth={t.neonLane ? 5 : 4} opacity={c.laneOpacity} strokeDasharray={t.neonLane ? '2 22' : '10 16'} className={t.neonLane ? 'flow' : undefined} />
          </g>
        );
      })}
      {labels.map((l) => (
        <g key={l.r} transform={`translate(${l.x} ${l.y})`}>
          <rect x={-88} y={-20} width={176} height={40} rx={20} fill={t.chipBg} stroke={themeRouteColor(t, l.r, l.i)} strokeWidth={4} />
          <text textAnchor="middle" dy="0.36em" fontSize={21} fontWeight={800} fill={t.chipInk} className="board-font" letterSpacing="0.06em">{l.text}</text>
        </g>
      ))}
    </g>
  );
});
