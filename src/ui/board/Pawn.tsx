import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Board, Team } from '../../core/types';
import type { MoveTrace } from '../../state/game';
import { symbolShape } from '../symbols';
import { MapTheme, shade } from './theme';

const nodeOf = (board: Board, id: string) => board.nodes[board.byId.get(id)!];

interface Pt {
  x: number;
  y: number;
}

export const HOP_MS = 200;

/** Chunky toy-figurine pawn: glossy team-colour body, team symbol on the chest, helmet, number chip. Feet at (0,0). */
export const PawnArt = memo(function PawnArt({ team, dim, glitch, t }: { team: Team; dim?: boolean; glitch?: boolean; t: MapTheme }) {
  const c = team.color;
  const dark = shade(c, 52);
  return (
    <g opacity={dim ? 0.8 : 1} className={glitch ? 'glitch-pawn' : undefined}>
      <ellipse cx={0} cy={3} rx={25} ry={8} fill={t.shadow} opacity={0.6} />
      <g className="pawn-bob">
        <ellipse cx={-9} cy={-3} rx={9} ry={5.5} fill={dark} />
        <ellipse cx={9} cy={-3} rx={9} ry={5.5} fill={dark} />
        <rect x={-19} y={-47} width={38} height={42} rx={16} fill={c} stroke={dark} strokeWidth={3.5} />
        <rect x={-13} y={-43} width={9} height={26} rx={4.5} fill="#ffffff" opacity={0.4} />
        <ellipse cx={-21} cy={-26} rx={6} ry={10} fill={c} stroke={dark} strokeWidth={3} />
        <ellipse cx={21} cy={-26} rx={6} ry={10} fill={c} stroke={dark} strokeWidth={3} />
        <circle cx={0} cy={-26} r={13} fill="#ffffff" stroke={dark} strokeWidth={2.5} />
        <g transform="translate(0 -26)">{symbolShape(team.id - 1, 8.5, c, dark, 2)}</g>
        <circle cx={0} cy={-64} r={19} fill="#f4f8ff" stroke={dark} strokeWidth={3.5} />
        <ellipse cx={0} cy={-63} rx={13} ry={10} fill="#1b2a55" />
        <ellipse cx={-4} cy={-66} rx={5} ry={3} fill="#ffffff" opacity={0.7} />
        <path d="M0 -83 V-93" stroke={dark} strokeWidth={3} strokeLinecap="round" />
        <circle cx={0} cy={-96} r={4.5} fill={c} stroke={dark} strokeWidth={2} />
        <g transform="translate(19 -76)">
          <circle r={11.5} fill="#ffffff" stroke={c} strokeWidth={3.5} />
          <text textAnchor="middle" dy="0.36em" fontSize={15} fontWeight={900} fill="#0f2044" className="board-font">{team.id}</text>
        </g>
      </g>
    </g>
  );
});

function clusterOffsets(n: number, tx: boolean): Pt[] {
  if (tx) {
    return Array.from({ length: n }, (_, i) => {
      const row = i < 5 ? 0 : 1;
      const cnt = row === 0 ? Math.min(5, n) : n - 5;
      const col = row === 0 ? i : i - 5;
      return { x: (col - (cnt - 1) / 2) * 68, y: row === 0 ? -22 : 46 };
    });
  }
  if (n === 1) return [{ x: 0, y: 6 }];
  if (n === 2) return [{ x: -26, y: 6 }, { x: 26, y: 10 }];
  if (n === 3) return [{ x: -42, y: 8 }, { x: 0, y: -2 }, { x: 42, y: 8 }];
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / 3);
    const cnt = Math.min(3, n - row * 3);
    const col = i - row * 3;
    return { x: (col - (cnt - 1) / 2) * 46, y: 14 - row * 34 };
  });
}

interface Anim {
  pos: Record<number, Pt & { lift: number }>;
  lit: { node: string; key: string }[];
}

/** Slides pawns along their node paths (sequential legs per team, teams in parallel). */
function useMoveAnimation(lastMove: MoveTrace | null | undefined, board: Board, calm: boolean): Anim {
  const [anim, setAnim] = useState<Anim>({ pos: {}, lit: [] });
  const seen = useRef<number | null>(lastMove?.seq ?? null);
  useEffect(() => {
    if (!lastMove || lastMove.seq === seen.current) return;
    seen.current = lastMove.seq;
    const byTeam = new Map<number, string[]>();
    for (const m of lastMove.moves) {
      if (m.path.length < 2) continue;
      const cur = byTeam.get(m.teamId);
      if (!cur) byTeam.set(m.teamId, [...m.path]);
      else if (cur[cur.length - 1] === m.path[0]) cur.push(...m.path.slice(1));
      else cur.push(...m.path);
    }
    if (!byTeam.size) return;
    const hop = calm ? 90 : HOP_MS;
    const runs = [...byTeam.entries()].map(([teamId, path]) => {
      const a = nodeOf(board, path[0]);
      const b = nodeOf(board, path[path.length - 1]);
      const jump = path.length === 2 && Math.hypot(a.x - b.x, a.y - b.y) > 240;
      return { teamId, path, jump, dur: jump ? 700 : (path.length - 1) * hop };
    });
    const total = Math.max(...runs.map((r) => r.dur));
    const t0 = performance.now();
    let raf = 0;
    const litAll: { node: string; key: string }[] = [];
    const tick = (now: number) => {
      const el = Math.max(0, now - t0);
      const pos: Anim['pos'] = {};
      for (const r of runs) {
        const t = Math.min(1, el / r.dur);
        const n = r.path.length - 1;
        const seg = t * n;
        const k = Math.min(n - 1, Math.floor(seg));
        const u = r.jump ? (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2) : seg - k;
        const a = nodeOf(board, r.path[r.jump ? 0 : k]);
        const b = nodeOf(board, r.path[r.jump ? n : k + 1]);
        const lift = r.jump ? Math.sin(Math.PI * t) * 90 : Math.sin(Math.PI * u) * 22;
        pos[r.teamId] = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, lift };
        // light up nodes as they are reached
        const reached = r.jump ? (t >= 1 ? 1 : 0) : Math.floor(seg + 1e-6);
        for (let i = litAll.filter((l) => l.key.startsWith(`${r.teamId}:`)).length + 1; i <= reached; i++) {
          litAll.push({ node: r.path[i], key: `${r.teamId}:${i}:${lastMove.seq}` });
        }
      }
      if (el < total) {
        setAnim({ pos, lit: litAll.slice(-12) });
        raf = requestAnimationFrame(tick);
      } else {
        setAnim({ pos: {}, lit: litAll.slice(-12) });
        window.setTimeout(() => setAnim((a) => ({ pos: a.pos, lit: [] })), 700);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setAnim({ pos: {}, lit: [] });
    };
  }, [lastMove, board, calm]);
  return anim;
}

export interface PawnLayerProps {
  board: Board;
  teams: Team[];
  currentTeamId?: number | null;
  lastMove?: MoveTrace | null;
  targets?: Map<number, number>;
  onPickTeam?: (id: number) => void;
  glitching: Set<number>;
  t: MapTheme;
  calm: boolean;
  /** Notifies the canvas of the animation end position so the camera can follow. */
  hidden?: boolean;
}

export function PawnLayer({ board, teams, currentTeamId, lastMove, targets, onPickTeam, glitching, t, calm, hidden }: PawnLayerProps) {
  const anim = useMoveAnimation(lastMove, board, calm);
  const draws = useMemo(() => {
    const groups = new Map<string, Team[]>();
    for (const tm of teams) {
      if (tm.status !== 'active' || anim.pos[tm.id]) continue;
      const list = groups.get(tm.node) ?? [];
      list.push(tm);
      groups.set(tm.node, list);
    }
    const out: { team: Team; x: number; y: number; scale: number; lift: number }[] = [];
    groups.forEach((list, id) => {
      const n = nodeOf(board, id);
      const offs = clusterOffsets(list.length, n.kind === 'tx');
      const sc = list.length === 1 ? 1 : list.length <= 3 ? 0.94 : n.kind === 'tx' ? 0.86 : 0.82;
      list.forEach((tm, i) => out.push({ team: tm, x: n.x + offs[i].x, y: n.y + offs[i].y, scale: sc, lift: 0 }));
    });
    for (const tm of teams) {
      const p = anim.pos[tm.id];
      if (p) out.push({ team: tm, x: p.x, y: p.y, scale: 1, lift: p.lift });
    }
    return out.sort((a, b) => a.y - b.y || a.team.id - b.team.id);
  }, [teams, anim.pos, board]);

  const anyActive = currentTeamId != null && teams.some((tm) => tm.id === currentTeamId && tm.status === 'active');
  if (hidden) return null;
  return (
    <g>
      {anim.lit.map((l) => {
        const n = nodeOf(board, l.node);
        return <ellipse key={l.key} cx={n.x} cy={n.y} rx={34} ry={28} fill="none" stroke={t.route.A} strokeWidth={6} className="ripple" pointerEvents="none" />;
      })}
      {draws.map((d) => {
        const active = d.team.id === currentTeamId;
        const isTarget = targets?.has(d.team.id);
        const sc = d.scale * 1.25 * (active ? 1.28 : anyActive ? 0.92 : 1);
        return (
          <g
            key={d.team.id}
            transform={`translate(${d.x} ${d.y - d.lift})`}
            onClick={isTarget && onPickTeam ? () => onPickTeam(d.team.id) : undefined}
            style={isTarget ? { cursor: 'pointer' } : undefined}
            pointerEvents={isTarget ? 'all' : 'none'}
          >
            {active && (
              <g pointerEvents="none">
                <ellipse cx={0} cy={4} rx={46} ry={15} fill="none" stroke={t.dark ? '#ffffff' : d.team.color} strokeWidth={5} className="beacon" />
                <ellipse cx={0} cy={4} rx={38} ry={12} fill={d.team.color} opacity={0.28} />
              </g>
            )}
            {isTarget && (
              <g>
                <ellipse cx={0} cy={2} rx={44} ry={16} fill="none" stroke="#ef4444" strokeWidth={5} strokeDasharray="9 7" className="halo" />
                <g transform="translate(0 -118)">
                  <rect x={-40} y={-15} width={80} height={28} rx={14} fill="#ef4444" />
                  <text textAnchor="middle" dy="0.36em" fontSize={16} fontWeight={800} fill="#ffffff">{targets!.get(d.team.id)} away</text>
                </g>
              </g>
            )}
            <g transform={`scale(${sc})`}>
              <PawnArt team={d.team} dim={anyActive && !active} glitch={glitching.has(d.team.id)} t={t} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

