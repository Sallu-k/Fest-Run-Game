import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MapLayout, layoutBounds } from '../../core/mapLayout';
import type { Board, Team } from '../../core/types';
import { getTerms } from '../../core/terms';
import type { MoveTrace } from '../../state/game';
import { Cam, FIT, clampZoom, ease, lerpCam, viewBoxOf } from './camera';
import { FxLayer, useFx } from './fx';
import { RxStation, SlotBays, TxTower } from './landmarks';
import { PawnLayer } from './Pawn';
import { RouteLayer } from './routes';
import { Defs, Scenery, Sky } from './scenery';
import { MapTheme } from './theme';
import { TilesLayer } from './tiles';
import { useViewPrefs } from '../hooks';

export interface CanvasHandle {
  fit: () => void;
  zoom: (factor: number) => void;
  fullscreen: () => void;
  /** client (screen) coordinates → world coordinates */
  toWorld: (cx: number, cy: number) => { x: number; y: number };
}

export interface EditorHooks {
  selectedNode: string | null;
  selectedDecor: string | null;
  onNodeDown: (id: string, e: React.PointerEvent) => void;
  onDecorDown: (id: string, e: React.PointerEvent) => void;
  onSlotsDown: (e: React.PointerEvent) => void;
  onBackgroundDown?: (e: React.PointerEvent) => void;
}

export interface NameplateInfo {
  team: Team;
  toGo: number;
  note?: string;
}

export interface BoardCanvasProps {
  /** Show the FIT / zoom / fullscreen buttons (default true; off for small read-only previews). */
  tools?: boolean;
  board: Board;
  layout: MapLayout;
  theme: MapTheme;
  teams: Team[];
  slots: number;
  qualifiers: number[];
  currentTeamId?: number | null;
  nameplate?: NameplateInfo | null;
  showCards?: boolean;
  boosterAmount: number;
  noiseBack: number;
  targets?: Map<number, number>;
  onPickTeam?: (id: number) => void;
  /** offered when a route-choice decision is pending; called with the chosen node id */
  routeChoice?: ((option: string) => void) | null;
  /** The actual pending options to draw fork pucks for — see TilesProps.routeOptions. */
  routeOptions?: string[];
  lastMove?: MoveTrace | null;
  heat?: Record<string, number>;
  showIds?: boolean;
  showTeams?: boolean;
  follow?: boolean;
  calm?: boolean;
  mode: 'host' | 'projector' | 'editor';
  editor?: EditorHooks;
  children?: ReactNode;
}

export const BoardCanvas = forwardRef<CanvasHandle, BoardCanvasProps>(function BoardCanvas(props, ref) {
  const { board, layout, theme: t, teams, slots, qualifiers, currentTeamId, nameplate, mode, editor, follow = true, calm = false } = props;
  const prefs = useViewPrefs();
  const wording = JSON.stringify([prefs.terms, prefs.customTerms]);
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState<Cam>(FIT);
  const camRef = useRef<Cam>(FIT);
  camRef.current = cam;
  const animRef = useRef(0);
  const manual = useRef(false);
  const [hover, setHover] = useState(false);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bounds = useMemo(() => layoutBounds(board, layout, slots), [board, layout, slots]);
  const vb = viewBoxOf(bounds, size.w, size.h, cam);

  const animateTo = useCallback((to: Cam, ms: number) => {
    cancelAnimationFrame(animRef.current);
    const from = camRef.current;
    if (ms <= 0) {
      setCam(to);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / ms);
      setCam(lerpCam(from, to, ease(u)));
      if (u < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  const toWorld = useCallback(
    (cx: number, cy: number) => {
      const r = wrap.current!.getBoundingClientRect();
      const v = viewBoxOf(bounds, r.width, r.height, camRef.current);
      return { x: v.x + ((cx - r.left) / r.width) * v.w, y: v.y + ((cy - r.top) / r.height) * v.h };
    },
    [bounds],
  );

  const api = useMemo<CanvasHandle>(
    () => ({
      fit: () => {
        manual.current = false;
        animateTo(FIT, 350);
      },
      zoom: (f: number) => {
        manual.current = true;
        animateTo({ ...camRef.current, z: clampZoom(camRef.current.z * f) }, 200);
      },
      fullscreen: () => {
        const el = wrap.current?.closest('[data-fs]') ?? wrap.current;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void (el as HTMLElement | null)?.requestFullscreen?.();
      },
      toWorld,
    }),
    [animateTo, toWorld],
  );
  useImperativeHandle(ref, () => api, [api]);

  // re-fit whenever the map's extent changes (editing, new game)
  const boundsKey = `${Math.round(bounds.x)}|${Math.round(bounds.y)}|${Math.round(bounds.w)}|${Math.round(bounds.h)}`;
  useEffect(() => {
    if (!manual.current) animateTo(FIT, 0);
  }, [boundsKey, animateTo]);

  // gentle camera follow: ease towards the moving team, then back to the full map
  const lastSeq = useRef<number | null>(props.lastMove?.seq ?? null);
  useEffect(() => {
    const lm = props.lastMove;
    if (!lm || lm.seq === lastSeq.current) return;
    lastSeq.current = lm.seq;
    if (!follow || mode === 'editor' || manual.current || calm || !lm.moves.length) return;
    const m = lm.moves[lm.moves.length - 1];
    const destIdx = board.byId.get(m.path[m.path.length - 1]);
    const dest = destIdx != null ? board.nodes[destIdx] : undefined;
    if (!dest) return;
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    const steps = lm.moves.reduce((a, x) => Math.max(a, x.path.length - 1), 0);
    const focus: Cam = { dx: (dest.x - cx) * 0.55, dy: (dest.y - cy) * 0.55, z: 1.28 };
    animateTo(focus, 450);
    const back = window.setTimeout(() => animateTo(FIT, 650), 450 + steps * 200 + 900);
    return () => window.clearTimeout(back);
  }, [props.lastMove, follow, mode, calm, board, bounds, animateTo]);

  const fx = useFx(props.lastMove, board, teams, slots, calm);
  const tx = board.nodes[board.tx];
  const rx = board.nodes[board.rx];

  // wheel zoom + drag pan (host / projector only when zoomed)
  const drag = useRef<{ x: number; y: number; cam: Cam } | null>(null);
  const onWheel = (e: React.WheelEvent) => {
    if (mode === 'projector') return;
    manual.current = true;
    const z = clampZoom(camRef.current.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    setCam((c) => ({ ...c, z }));
    if (z <= 1.001 && camRef.current.z <= 1.001) setCam(FIT);
  };
  const onBgDown = (e: React.PointerEvent) => {
    if (editor?.onBackgroundDown) editor.onBackgroundDown(e);
    if (e.button !== 0 && e.button !== 1) return;
    drag.current = { x: e.clientX, y: e.clientY, cam: camRef.current };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onBgMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !wrap.current) return;
    const dxs = e.clientX - d.x;
    const dys = e.clientY - d.y;
    if (Math.abs(dxs) + Math.abs(dys) < 4 && d.cam.z <= 1.001) return;
    if (d.cam.z <= 1.001 && mode !== 'editor') return;
    manual.current = true;
    const scale = vb.w / size.w;
    setCam({ ...d.cam, dx: d.cam.dx - dxs * scale, dy: d.cam.dy - dys * scale });
  };
  const onBgUp = () => {
    drag.current = null;
  };

  // nameplate position (HTML overlay, projected from world coordinates)
  const np = useMemo(() => {
    if (!nameplate) return null;
    const idx = board.byId.get(nameplate.team.node);
    return idx != null ? { x: board.nodes[idx].x, y: board.nodes[idx].y } : null;
  }, [nameplate, board]);
  const sx = size.w / vb.w;
  const npLeft = np ? Math.max(150, Math.min(size.w - 150, (np.x - vb.x) * sx)) : 0;
  const npTop = np ? Math.max(84, (np.y - vb.y - (nameplate!.team.node === board.idOf[board.tx] ? 235 : 150)) * (size.h / vb.h)) : 0;

  const editorScenery = editor ? { selected: editor.selectedDecor, onDown: editor.onDecorDown } : undefined;
  const editorTiles = editor ? { selected: editor.selectedNode, onDown: editor.onNodeDown } : undefined;

  return (
    <div
      ref={wrap}
      className={`canvas canvas-${mode}${calm ? ' calm' : ''}`}
      style={{ ['--sky1' as string]: t.skyTop, ['--sky2' as string]: t.skyMid, ['--sky3' as string]: t.skyBot }}
      onWheel={onWheel}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseMove={() => mode === 'projector' && !hover && setHover(true)}
    >
      <svg
        ref={svgRef}
        className="board-svg"
        viewBox={`${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ overflow: 'visible' }}
        role="img"
        aria-label="Game board"
      >
        <Defs t={t} />
        <rect x={vb.x - 4000} y={vb.y - 4000} width={vb.w + 8000} height={vb.h + 8000} fill="transparent" onPointerDown={onBgDown} onPointerMove={onBgMove} onPointerUp={onBgUp} onPointerCancel={onBgUp} />
        <Sky t={t} w={layout.worldW} h={layout.worldH} />
        <Scenery layout={layout} t={t} editor={editorScenery} />
        <RouteLayer board={board} layout={layout} t={t} />
        {/* tiles and the start/finish read the wording pack directly — remount them when it changes */}
        <g key={wording}>
          <TilesLayer board={board} t={t} showCards={!!props.showCards} boosterAmount={props.boosterAmount} noiseBack={props.noiseBack} heat={props.heat} showIds={props.showIds} editor={editorTiles} pickRoutes={props.routeChoice ?? null} routeOptions={props.routeOptions} />
          <g onPointerDown={editor ? (e) => editor.onNodeDown('TX', e) : undefined} style={editor ? { cursor: 'grab' } : undefined}><TxTower p={tx} t={t} /></g>
          <g onPointerDown={editor ? (e) => editor.onNodeDown('RX', e) : undefined} style={editor ? { cursor: 'grab' } : undefined}><RxStation p={rx} t={t} locked={qualifiers.length} total={slots} /></g>
        </g>
        {editor?.selectedNode && (editor.selectedNode === 'TX' || editor.selectedNode === 'RX') && (
          <ellipse cx={board.nodes[editor.selectedNode === 'TX' ? board.tx : board.rx].x} cy={board.nodes[editor.selectedNode === 'TX' ? board.tx : board.rx].y - 60} rx={130} ry={150} fill="none" stroke="#f43f5e" strokeWidth={5} strokeDasharray="12 9" pointerEvents="none" />
        )}
        <g onPointerDown={editor ? editor.onSlotsDown : undefined} style={editor ? { cursor: 'grab' } : undefined} pointerEvents={editor ? undefined : 'none'}>
          <SlotBays layout={layout} rx={rx} t={t} teams={teams} qualifiers={qualifiers} slots={slots} recentSlot={fx.recentSlot} />
        </g>
        {props.showTeams !== false && (
          <PawnLayer board={board} teams={teams} currentTeamId={currentTeamId} lastMove={props.lastMove} targets={props.targets} onPickTeam={props.onPickTeam} glitching={fx.glitching} t={t} calm={calm} />
        )}
        <FxLayer fx={fx.fx} t={t} />
      </svg>

      {nameplate && np && mode !== 'editor' && (
        <div key={`${nameplate.team.id}`} className={`nameplate ${mode === 'projector' ? 'big' : ''}`} style={{ left: npLeft, top: npTop, ['--tc' as string]: nameplate.team.color }}>
          <span className="np-badge">
            <svg width="34" height="34" viewBox="-14 -14 28 28">{nameplateShape(nameplate.team)}</svg>
          </span>
          <span className="np-text">
            <b>TEAM {nameplate.team.id}</b>
            <i>{nameplate.team.name}</i>
            <em>{getTerms().active}{nameplate.note ? ` · ${nameplate.note}` : ''}</em>
          </span>
          <span className="np-steps"><b>{nameplate.toGo}</b><small>to {getTerms().finish.toLowerCase()}</small></span>
        </div>
      )}
      {fx.banner && (
        <div key={fx.banner.key} className="lock-banner" style={{ ['--bc' as string]: fx.banner.color }}>
          <b>{fx.banner.text}</b>
          {fx.banner.sub && <span>{fx.banner.sub}</span>}
        </div>
      )}
      {props.tools !== false && <div className={`cam-tools ${mode === 'projector' ? (hover ? 'show' : 'hide') : ''}`}>
        <button className="cam-btn" title="Fit board" onClick={() => api.fit()}>FIT</button>
        <button className="cam-btn" title="Zoom in" onClick={() => api.zoom(1.25)}>＋</button>
        <button className="cam-btn" title="Zoom out" onClick={() => api.zoom(0.8)}>－</button>
        <button className="cam-btn" title="Reset view" onClick={() => api.fit()}>RESET</button>
        <button className="cam-btn" title="Fullscreen (F)" onClick={() => api.fullscreen()}>⛶</button>
      </div>}
      {props.children}
    </div>
  );
});

import { symbolShape } from '../symbols';
function nameplateShape(team: Team) {
  return symbolShape(team.id - 1, 9.5, team.color, '#0f2044', 1.6);
}
