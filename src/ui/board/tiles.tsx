import { memo, useMemo } from 'react';
import { computeAnnotations } from './annotations';
import { Board, BoardNode, CARD_INFO, SpecialSpec } from '../../core/types';
import { getTerms } from '../../core/terms';
import { classicLanes, classicNodeMeta } from '../../core/classicBoard';
import { MapTheme, shade, themeRouteColor, tint } from './theme';

const nodeOf = (board: Board, id: string): BoardNode => board.nodes[board.byId.get(id)!];

function stoneColor(t: MapTheme, n: BoardNode): string {
  const lane = classicNodeMeta(n.id).lane;
  return /^[A-H]$/.test(lane) ? themeRouteColor(t, lane) : t.route.S;
}

/** Caption pill under a special tile — says what happens here, readable from the back of the room. */
function Caption({ text, color, t, y = 50 }: { text: string; color: string; t: MapTheme; y?: number }) {
  // long theme words ("GRAVITY ASSIST +5") shrink instead of spilling onto the neighbouring stones
  const fs = Math.max(13, Math.min(19, 240 / text.length));
  const w = Math.max(84, text.length * fs * 0.79 + 26);
  return (
    <g transform={`translate(0 ${y})`}>
      <rect x={-w / 2} y={-16} width={w} height={32} rx={16} fill={t.chipBg} stroke={color} strokeWidth={3.5} />
      <text textAnchor="middle" dy="0.36em" fontSize={fs} fontWeight={800} fill={t.chipInk} className="board-font" letterSpacing="0.05em">{text}</text>
    </g>
  );
}

function Sparkle({ x, y, s, c }: { x: number; y: number; s: number; c: string }) {
  return <path d={`M${x} ${y - s} L${x + s * 0.3} ${y - s * 0.3} L${x + s} ${y} L${x + s * 0.3} ${y + s * 0.3} L${x} ${y + s} L${x - s * 0.3} ${y + s * 0.3} L${x - s} ${y} L${x - s * 0.3} ${y - s * 0.3} Z`} fill={c} opacity={0.9} />;
}

function Base({ rx, ry, rim, t, top }: { rx: number; ry: number; rim: string; t: MapTheme; top: string }) {
  return (
    <g>
      <ellipse cx={0} cy={ry * 0.62 + 6} rx={rx * 1.08} ry={ry * 0.9} fill={t.shadow} opacity={0.6} />
      <ellipse cx={0} cy={9} rx={rx} ry={ry} fill={t.dark ? shade(rim, 40) : shade(t.tileSide, 100)} />
      <ellipse cx={0} cy={0} rx={rx} ry={ry} fill={top} stroke={rim} strokeWidth={5} />
      <ellipse cx={-rx * 0.28} cy={-ry * 0.42} rx={rx * 0.4} ry={ry * 0.18} fill="#ffffff" opacity={t.dark ? 0.12 : 0.7} />
    </g>
  );
}

function Glyph({ sp, t, angle, showCard, amount, cy }: { sp: SpecialSpec; t: MapTheme; angle: number; showCard: boolean; amount: number; cy: number }) {
  if (sp.type === 'chance') {
    const c = t.chance;
    return (
      <g>
        <Base rx={37} ry={31} rim={c} t={t} top={t.dark ? '#2a1054' : tint(c, 20)} />
        <ellipse cx={0} cy={0} rx={27} ry={22} fill={t.dark ? '#3a1a70' : tint(c, 42)} />
        <path d="M-20 4 Q-14 -18 6 -16 Q22 -14 18 4" fill="none" stroke="#ffffff" strokeWidth={3.5} strokeLinecap="round" opacity={0.85} />
        <text textAnchor="middle" dy="0.36em" fontSize={38} fontWeight={900} fill="#ffffff" stroke={shade(c, 70)} strokeWidth={5} paintOrder="stroke" className="board-font">?</text>
        <Sparkle x={-36} y={-30} s={9} c={t.dark ? '#f0abfc' : '#f5d0fe'} />
        <Sparkle x={38} y={-24} s={7} c="#fde68a" />
        <Sparkle x={30} y={22} s={6} c={t.dark ? '#f0abfc' : '#f5d0fe'} />
        <Caption text={showCard && sp.card ? `${getTerms().chance} · ${CARD_INFO[sp.card].abbr}` : getTerms().chance} color={c} t={t} y={cy} />
      </g>
    );
  }
  if (sp.type === 'noise') {
    const c = t.noise;
    return (
      <g>
        <Base rx={37} ry={31} rim={c} t={t} top={t.dark ? '#3b1024' : tint(c, 16)} />
        <ellipse cx={0} cy={0} rx={27} ry={22} fill={t.dark ? '#521432' : tint(c, 30)} />
        <g className="glitch">
          <polyline points="-24,4 -16,-14 -8,12 0,-14 8,12 16,-10 24,2" fill="none" stroke="#ffffff" strokeWidth={9} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
          <polyline points="-24,4 -16,-14 -8,12 0,-14 8,12 16,-10 24,2" fill="none" stroke={shade(c, 90)} strokeWidth={4.5} strokeLinejoin="round" strokeLinecap="round" />
        </g>
        <g transform="translate(30 -30)">
          <path d="M0 -14 L15 12 H-15 Z" fill="#fde047" stroke={shade(c, 60)} strokeWidth={3} strokeLinejoin="round" />
          <rect x={-1.8} y={-4} width={3.6} height={9} rx={1.5} fill={shade(c, 60)} />
          <circle cx={0} cy={8} r={2} fill={shade(c, 60)} />
        </g>
        <Caption text={`${getTerms().noise} −${amount}`} color={c} t={t} y={cy} />
      </g>
    );
  }
  const c = t.booster;
  return (
    <g>
      <Base rx={37} ry={31} rim={c} t={t} top={t.dark ? '#0d3a25' : tint(c, 18)} />
      <g transform={`rotate(${angle})`}>
        <path d="M-24 -13 L-6 0 L-24 13 M-6 -13 L12 0 L-6 13 M12 -13 L30 0 L12 13" fill="none" stroke="#ffffff" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
        <path d="M-24 -13 L-6 0 L-24 13 M-6 -13 L12 0 L-6 13 M12 -13 L30 0 L12 13" fill="none" stroke={shade(c, 88)} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g transform="translate(30 -30)">
        <circle r={17} fill={c} stroke="#ffffff" strokeWidth={3.5} />
        <text textAnchor="middle" dy="0.36em" fontSize={19} fontWeight={900} fill="#ffffff" className="board-font">+{amount}</text>
      </g>
      <Caption text={`${getTerms().booster} +${amount}`} color={c} t={t} y={cy} />
    </g>
  );
}

export interface TilesProps {
  board: Board;
  t: MapTheme;
  showCards: boolean;
  boosterAmount: number;
  noiseBack: number;
  heat?: Record<string, number>;
  showIds?: boolean;
  editor?: { selected: string | null; onDown: (id: string, e: React.PointerEvent) => void };
  /** offered when a route-choice decision is pending; called with the chosen node id */
  pickRoutes?: ((option: string) => void) | null;
  /** The actual pending options (from the engine's `Pending['route'].options`) to draw pucks for —
   *  the authoritative source, not re-derived from the classic-lane helpers (a mismatch between the
   *  two was the root cause of a fork click silently doing nothing). Falls back to the classic-lane
   *  guess only when this isn't supplied. */
  routeOptions?: string[];
}

export const TilesLayer = memo(function TilesLayer({ board, t, showCards, boosterAmount, noiseBack, heat, showIds, editor, pickRoutes, routeOptions }: TilesProps) {
  const ann = useMemo(() => computeAnnotations(board), [board]);
  const lanes = useMemo(() => classicLanes(board), [board]);
  // direction of travel at each node (used to point booster chevrons forward)
  const dir = (n: BoardNode) => {
    const nxId = board.succ[n.id]?.[0];
    if (!nxId) return 0;
    const nx = nodeOf(board, nxId);
    return (Math.atan2(nx.y - n.y, nx.x - n.x) * 180) / Math.PI;
  };
  const nodes = board.nodes.filter((n) => n.kind !== 'tx' && n.kind !== 'rx');
  const sorted = [...nodes].sort((a, b) => a.y - b.y);
  return (
    <g pointerEvents={editor ? undefined : 'none'}>
      {sorted.map((n) => {
        const h = heat?.[n.id];
        const color = stoneColor(t, n);
        const sp = n.special;
        const isFork = board.succ[n.id].length > 1;
        return (
          <g
            key={n.idx}
            transform={`translate(${n.x} ${n.y})`}
            onPointerDown={editor ? (e) => editor.onDown(n.id, e) : undefined}
            style={editor ? { cursor: 'grab' } : undefined}
          >
            {h != null && <circle r={40 + h * 34} fill={sp ? t[sp.type] : t.route.A} opacity={0.18 + h * 0.4} />}
            {sp ? (
              <Glyph sp={sp} t={t} angle={dir(n)} showCard={showCards} amount={sp.amount ?? (sp.type === 'booster' ? boosterAmount : noiseBack)} cy={ann.captionY[n.id] ?? 58} />
            ) : (
              <g>
                <Base rx={isFork ? 34 : 27} ry={isFork ? 29 : 23} rim={color} t={t} top={t.dark ? shade(color, 32) : tint(color, isFork ? 32 : 18)} />
                {isFork && (
                  <g>
                    <circle r={9} fill="#ffffff" stroke={shade(color, 75)} strokeWidth={3} />
                    <Caption text="FORK" color={color} t={t} y={54} />
                  </g>
                )}
              </g>
            )}
            {showIds && <text y={sp ? -46 : -34} textAnchor="middle" fontSize={15} fontWeight={800} fill={t.ink} stroke={t.chipBg} strokeWidth={4} paintOrder="stroke">{n.id}</text>}
            {editor?.selected === n.id && <ellipse rx={50} ry={44} fill="none" stroke="#f43f5e" strokeWidth={4.5} strokeDasharray="9 7" />}
          </g>
        );
      })}
      {pickRoutes &&
        (routeOptions ?? (lanes ? lanes.laneIds.map((r) => lanes.branch[r][0]).filter((id): id is string => !!id) : [])).map((optId) => {
          const n = nodeOf(board, optId);
          const meta = classicNodeMeta(optId);
          const isLane = meta.lane === 'A' || meta.lane === 'B' || meta.lane === 'C';
          const color = isLane ? t.route[meta.lane as 'A' | 'B' | 'C'] : t.route.S;
          const label = isLane ? meta.lane : optId;
          return (
            <g key={optId} transform={`translate(${n.x} ${n.y})`} onClick={() => pickRoutes(optId)} style={{ cursor: 'pointer' }} pointerEvents="all">
              <circle r={52} fill="#ffffff" opacity={0.001} />
              <ellipse rx={50} ry={44} fill="none" stroke={color} strokeWidth={7} className="pulse-ring" />
              <text y={-58} textAnchor="middle" fontSize={26} fontWeight={900} fill={color} stroke={t.chipBg} strokeWidth={6} paintOrder="stroke" className="board-font">{label}</text>
            </g>
          );
        })}
    </g>
  );
});
