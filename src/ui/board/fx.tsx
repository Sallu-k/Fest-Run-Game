import { useEffect, useRef, useState } from 'react';
import type { Board, Team } from '../../core/types';
import { getTerms } from '../../core/terms';
import { FxEvent, MoveTrace } from '../../state/game';
import { HOP_MS } from './Pawn';
import { MapTheme } from './theme';

const nodeOf = (board: Board, id: string) => board.nodes[board.byId.get(id)!];

interface Pt {
  x: number;
  y: number;
}

export interface Fx {
  id: string;
  kind: FxEvent['kind'];
  a?: Pt;
  b?: Pt;
  path?: Pt[];
  ms: number;
  blocked?: boolean;
}

export interface FxState {
  fx: Fx[];
  glitching: Set<number>;
  recentSlot: number | null;
  banner: { key: string; text: string; sub?: string; color: string } | null;
}

/** Turns the store's cosmetic fx cues into timed on-board effects (nothing here touches game state). */
export function useFx(lastMove: MoveTrace | null | undefined, board: Board, teams: Team[], slots: number, calm: boolean): FxState {
  const [state, setState] = useState<FxState>({ fx: [], glitching: new Set(), recentSlot: null, banner: null });
  const seen = useRef<number | null>(lastMove?.seq ?? null);
  const teamsRef = useRef(teams);
  teamsRef.current = teams;

  useEffect(() => {
    if (!lastMove || lastMove.seq === seen.current || !lastMove.fx?.length) {
      if (lastMove) seen.current = lastMove.seq;
      return;
    }
    seen.current = lastMove.seq;
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const hop = calm ? 90 : HOP_MS;
    const nodePt = (id: string): Pt => {
      const n = nodeOf(board, id);
      return { x: n.x, y: n.y };
    };
    const teamPt = (id: number): Pt => {
      const t = teamsRef.current.find((x) => x.id === id);
      return nodePt(t ? t.node : board.idOf[board.tx]);
    };
    // how long the team's own movement takes (effects for that team play after it)
    const moveMs = (id: number) => {
      const n = lastMove.moves.filter((m) => m.teamId === id).reduce((a, m) => a + Math.max(0, m.path.length - 1), 0);
      return n * hop;
    };
    const firstMoveMs = (id: number) => {
      const m = lastMove.moves.find((x) => x.teamId === id);
      return m ? Math.max(0, m.path.length - 1) * hop : 0;
    };
    const add = (delay: number, fx: Fx) => {
      later(delay, () => setState((s) => ({ ...s, fx: [...s.fx, fx] })));
      later(delay + fx.ms, () => setState((s) => ({ ...s, fx: s.fx.filter((x) => x.id !== fx.id) })));
    };
    lastMove.fx.forEach((e, i) => {
      const id = `${lastMove.seq}-${i}`;
      if (e.kind === 'boost' && e.from != null && e.to != null) {
        add(firstMoveMs(e.team), { id, kind: 'boost', path: (e.path ?? [e.from, e.to]).map(nodePt), ms: 900 });
      } else if (e.kind === 'noise' && e.from != null) {
        add(firstMoveMs(e.team), { id, kind: 'noise', a: nodePt(e.from), ms: 900 });
      } else if (e.kind === 'isi' && e.target != null && e.from != null) {
        add(0, { id, kind: 'isi', a: teamPt(e.team), b: nodePt(e.from), ms: 900, blocked: e.blocked });
        if (!e.blocked) {
          setState((s) => ({ ...s, glitching: new Set([...s.glitching, e.target!]) }));
          later(1100, () => setState((s) => ({ ...s, glitching: new Set([...s.glitching].filter((x) => x !== e.target)) })));
        }
      } else if (e.kind === 'hop' && e.from != null && e.to != null) {
        add(0, { id, kind: 'hop', a: nodePt(e.from), b: nodePt(e.to), ms: 800, blocked: e.blocked });
      } else if (e.kind === 'orth' && e.target != null) {
        add(0, { id, kind: 'orth', a: teamPt(e.team), ms: 1100 });
      } else if (e.kind === 'card') {
        add(moveMs(e.team) + 200, { id, kind: 'card', a: teamPt(e.team), ms: 1000 });
      } else if (e.kind === 'qualify') {
        const delay = moveMs(e.team) + 150;
        const total = slots;
        const slot = e.slot ?? 1;
        const t = teamsRef.current.find((x) => x.id === e.team);
        add(delay, { id, kind: 'qualify', a: nodePt(board.idOf[board.rx]), ms: 1300 });
        later(delay + 250, () =>
          setState((s) => ({
            ...s,
            recentSlot: slot,
            banner: {
              key: id,
              text: slot >= total ? getTerms().allLocked : slot === 1 ? getTerms().firstLocked : `SLOT ${slot} LOCKED`,
              sub: t ? `T${t.id} · ${t.name}` : undefined,
              color: slot >= total ? '#f59e0b' : '#16a34a',
            },
          })),
        );
        later(delay + 2600, () => setState((s) => ({ ...s, recentSlot: null, banner: s.banner?.key === id ? null : s.banner })));
      }
    });
    return () => {
      // A newer move supersedes queued effects only if this effect re-runs for a new seq.
      void timers;
    };
  }, [lastMove, board, slots, calm]);
  return state;
}

const zig = (a: Pt, b: Pt, n = 9, amp = 14): string => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  let d = `M${a.x} ${a.y}`;
  for (let i = 1; i < n; i++) {
    const f = i / n;
    const o = (i % 2 ? 1 : -1) * amp * (1 - Math.abs(f - 0.5));
    d += ` L${(a.x + dx * f + nx * o).toFixed(1)} ${(a.y + dy * f + ny * o).toFixed(1)}`;
  }
  return d + ` L${b.x} ${b.y}`;
};

export function FxLayer({ fx, t }: { fx: Fx[]; t: MapTheme }) {
  return (
    <g pointerEvents="none">
      {fx.map((f) => {
        if (f.kind === 'boost' && f.path && f.path.length > 1) {
          const d = f.path.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y - 30}`).join(' ');
          return (
            <g key={f.id}>
              <path d={d} fill="none" stroke={t.booster} strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" opacity={0.35} className="fx-fade" />
              <path d={d} fill="none" stroke="#ffffff" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 22" className="fx-trail" />
            </g>
          );
        }
        if (f.kind === 'noise' && f.a) {
          return (
            <g key={f.id} transform={`translate(${f.a.x} ${f.a.y - 30})`}>
              <ellipse rx={60} ry={50} fill={t.noise} opacity={0.25} className="fx-fade" />
              <path d="M-50 -10 L-30 -22 L-20 0 L0 -26 L14 4 L34 -18 L52 -4" fill="none" stroke={t.noise} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" className="fx-glitch" />
              <path d="M-46 14 L-24 6 L-6 22 L18 8 L44 20" fill="none" stroke="#ffffff" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" className="fx-glitch" />
            </g>
          );
        }
        if (f.kind === 'isi' && f.a && f.b) {
          const a = { x: f.a.x, y: f.a.y - 50 };
          const b = { x: f.b.x, y: f.b.y - 50 };
          return (
            <g key={f.id}>
              <path d={zig(a, b)} fill="none" stroke={f.blocked ? '#94a3b8' : t.noise} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" className="fx-zap" />
              <path d={zig(a, b, 11, 9)} fill="none" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="fx-zap" />
              <circle cx={b.x} cy={b.y} r={44} fill="none" stroke={t.noise} strokeWidth={6} className="fx-ring" />
            </g>
          );
        }
        if (f.kind === 'hop' && f.a && f.b) {
          const a = { x: f.a.x, y: f.a.y - 60 };
          const b = { x: f.b.x, y: f.b.y - 60 };
          const mx = (a.x + b.x) / 2;
          const my = Math.min(a.y, b.y) - 90;
          const d = `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`;
          return (
            <g key={f.id}>
              <path d={d} fill="none" stroke={t.route.B} strokeWidth={9} strokeLinecap="round" opacity={0.4} className="fx-fade" />
              <path d={d} fill="none" stroke="#ffffff" strokeWidth={4} strokeLinecap="round" strokeDasharray="3 16" className="fx-trail" />
              <circle cx={a.x} cy={a.y} r={30} fill="none" stroke={t.route.B} strokeWidth={5} className="fx-ring" />
              <circle cx={b.x} cy={b.y} r={30} fill="none" stroke={t.route.B} strokeWidth={5} className="fx-ring" />
            </g>
          );
        }
        if (f.kind === 'orth' && f.a) {
          return (
            <g key={f.id} transform={`translate(${f.a.x} ${f.a.y - 44})`}>
              <path d="M0 -70 L56 -44 V6 Q56 44 0 68 Q-56 44 -56 6 V-44 Z" fill={t.route.A} opacity={0.22} stroke={t.route.A} strokeWidth={7} strokeLinejoin="round" className="fx-shield" />
              <path d="M-20 -6 L-6 10 L24 -22" fill="none" stroke="#ffffff" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" className="fx-shield" />
            </g>
          );
        }
        if (f.kind === 'card' && f.a) {
          return (
            <g key={f.id} transform={`translate(${f.a.x} ${f.a.y - 90})`} className="fx-rise">
              {[-34, 0, 34].map((x, i) => (
                <path key={i} d={`M${x} -18 L${x + 6} -6 L${x + 18} 0 L${x + 6} 6 L${x} 18 L${x - 6} 6 L${x - 18} 0 L${x - 6} -6 Z`} fill={t.chance} stroke="#ffffff" strokeWidth={2} transform={`translate(0 ${i === 1 ? -14 : 0})`} />
              ))}
            </g>
          );
        }
        if (f.kind === 'qualify' && f.a) {
          return (
            <g key={f.id} transform={`translate(${f.a.x} ${f.a.y - 100})`}>
              <circle r={120} fill="none" stroke="#16a34a" strokeWidth={8} className="fx-lock" />
              <circle r={120} fill="none" stroke="#ffffff" strokeWidth={3} strokeDasharray="20 30" className="fx-lock" />
              <path d="M-140 0 H-90 M90 0 H140 M0 -140 V-90 M0 90 V140" stroke="#16a34a" strokeWidth={8} strokeLinecap="round" className="fx-lock" />
            </g>
          );
        }
        return null;
      })}
    </g>
  );
}
