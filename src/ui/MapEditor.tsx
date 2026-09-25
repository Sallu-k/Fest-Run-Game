import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildBoard } from '../core/board';
import { classicNodeMeta } from '../core/classicBoard';
import {
  EditResult,
  MapConfiguration,
  addDecor,
  addNode,
  connect,
  deleteNode,
  disconnect,
  duplicateNode,
  insertNodeOnEdge,
  mapReport,
  moveSpecial,
  removeDecor,
  resetLayout,
  setNodePos,
  setPathLabel,
  setSlotsAnchor,
  setSpecial,
  updateDecor,
} from '../core/mapEdit';
import { DECOR_KINDS, DecorKind, applyLayout, ensureLayout } from '../core/mapLayout';
import { validateMap } from '../core/mapValidate';
import { layoutProblems } from '../core/placementRules';
import { CARD_INFO, CARD_TYPES, CardType } from '../core/types';
import { getTerms } from '../core/terms';
import { MAP_STYLES, clearActiveMap, defaultMap, deleteMapSlot, getActiveMap, listMapSlots, saveActiveMap, saveMapSlot, setViewPrefs } from '../state/mapStore';
import { BoardCanvas, CanvasHandle } from './board/BoardCanvas';
import { routeColor } from './board/colors';
import { presetForBoard } from '../data/mapPresets';
import { themeOf } from './board/theme';
import { download } from './Log';
import { getHostStore, useViewPrefs } from './hooks';

type Armed =
  | { kind: 'special'; type: 'chance' | 'noise' | 'booster'; card: CardType }
  | { kind: 'move'; from: string | null }
  | { kind: 'connect'; from: string | null }
  | { kind: 'disconnect'; from: string | null }
  | null;
type Sel = { kind: 'node'; id: string } | { kind: 'decor'; id: string } | { kind: 'slots' } | null;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/**
 * Map Editor: a free-form graph editor — add/delete/duplicate/connect/disconnect any node, change its
 * type, and (for a still-classic-shaped board) edit path names. Everything is edited on a working copy;
 * SAVE MAP stores it in this browser for new games. Locked while a game runs.
 *
 * The live renderer/host UI only know how to *play* the classic single-fork → 3-branches → single-merge
 * shape today (see core/classicBoard.ts) — a custom graph can be fully built and balance-checked here,
 * but the CHECKS panel shows "▶ Playable now" / "⚠ Needs the graph-rendering follow-up" so that boundary
 * is never silently crossed. A map with validation errors can still be saved by explicitly overriding.
 */
export function MapEditor() {
  const prefs = useViewPrefs();
  const canvas = useRef<CanvasHandle>(null);
  const initial = useMemo(() => getActiveMap(), []);
  const [map, setMap] = useState<MapConfiguration>(() => clone(initial.map));
  const [saved, setSaved] = useState<string>(() => JSON.stringify(initial.map));
  const [past, setPast] = useState<MapConfiguration[]>([]);
  const [future, setFuture] = useState<MapConfiguration[]>([]);
  const [sel, setSel] = useState<Sel>(null);
  const [armed, setArmed] = useState<Armed>(null);
  const [armCard, setArmCard] = useState<CardType>('isi');
  const [overrideErrors, setOverrideErrors] = useState(false);
  const [snap, setSnap] = useState(true);
  const [editing, setEditing] = useState(true);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [decorKind, setDecorKind] = useState<DecorKind>('crystal');
  const [importText, setImportText] = useState('');
  const [slotName, setSlotName] = useState('My map');
  const [tick, setTick] = useState(0);

  const running = getHostStore().get().phase !== 'setup';
  const canEdit = editing && !running;
  const dirty = JSON.stringify(map) !== saved;
  const theme = themeOf(prefs.style);

  const say = useCallback((text: string, bad = false) => {
    setNote({ text, bad });
    window.setTimeout(() => setNote((n) => (n?.text === text ? null : n)), 5000);
  }, []);

  const world = useMemo(() => {
    try {
      const b = buildBoard(map.board);
      const l = ensureLayout(b, map.layout);
      return { board: applyLayout(b, l), layout: l, error: null as string | null };
    } catch (e) {
      return { board: null, layout: null, error: (e as Error).message };
    }
  }, [map]);
  const report = useMemo(() => mapReport(map), [map]);
  const validation = useMemo(() => validateMap(map.board), [map.board]);
  const placement = useMemo(() => (world.board ? layoutProblems(world.board, map.rules) : []), [world.board, map.rules]);

  const commit = useCallback(
    (next: MapConfiguration) => {
      setPast((p) => [...p.slice(-60), map]);
      setFuture([]);
      setMap(next);
    },
    [map],
  );
  const applyResult = useCallback(
    (res: EditResult) => {
      if (!res.ok) {
        say(res.error, true);
        return false;
      }
      commit(res.map);
      if (res.warnings.length) say(res.warnings.join(' '));
      return true;
    },
    [commit, say],
  );
  const undo = () => {
    const p = past[past.length - 1];
    if (!p) return;
    setFuture((f) => [map, ...f]);
    setPast(past.slice(0, -1));
    setMap(p);
  };
  const redo = () => {
    const f = future[0];
    if (!f) return;
    setPast((p) => [...p, map]);
    setFuture(future.slice(1));
    setMap(f);
  };

  // ------------------------------------------------------------ dragging
  const drag = useRef<{ sel: Sel; before: MapConfiguration; off: { x: number; y: number }; moved: boolean } | null>(null);
  const mapRef = useRef(map);
  mapRef.current = map;
  const snapV = (v: number) => (snap ? Math.round(v / 10) * 10 : Math.round(v));

  const startDrag = (target: Sel, e: React.PointerEvent, origin: { x: number; y: number }) => {
    if (!canvas.current) return;
    e.stopPropagation();
    const w = canvas.current.toWorld(e.clientX, e.clientY);
    drag.current = { sel: target, before: mapRef.current, off: { x: origin.x - w.x, y: origin.y - w.y }, moved: false };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || !canvas.current) return;
      const p = canvas.current.toWorld(ev.clientX, ev.clientY);
      const x = snapV(p.x + d.off.x);
      const y = snapV(p.y + d.off.y);
      d.moved = true;
      const cur = mapRef.current;
      if (d.sel?.kind === 'node') setMap(setNodePos(cur, d.sel.id, { x, y }));
      else if (d.sel?.kind === 'decor') setMap(updateDecor(cur, d.sel.id, { x, y }));
      else if (d.sel?.kind === 'slots') setMap(setSlotsAnchor(cur, { x, y }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = drag.current;
      drag.current = null;
      if (d?.moved) {
        setPast((p) => [...p.slice(-60), d.before]);
        setFuture([]);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ------------------------------------------------------------ actions
  const selNode = sel?.kind === 'node' ? world.board?.nodes.find((n) => n.id === sel.id) : undefined;
  const selSpecial = selNode?.special;
  const selDecor = sel?.kind === 'decor' ? map.layout.decor.find((d) => d.id === sel.id) : undefined;
  const selMeta = selNode ? classicNodeMeta(selNode.id) : null;

  const onNodeDown = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    if (!canEdit) {
      setSel({ kind: 'node', id });
      return;
    }
    if (armed?.kind === 'special') {
      if (id === 'TX' || id === 'RX') return say('The start and finish cannot hold special spaces.', true);
      if (world.board?.nodes.find((n) => n.id === id)?.special) return say(`${id} already has a special space — use EDIT TILE to change it.`, true);
      applyResult(setSpecial(map, id, { type: armed.type, card: armed.type === 'chance' ? armed.card : undefined }));
      setSel({ kind: 'node', id });
      return;
    }
    if (armed?.kind === 'move') {
      if (!armed.from) {
        if (!world.board?.nodes.find((n) => n.id === id)?.special) return say('Click a special space first (the one to move).', true);
        setArmed({ kind: 'move', from: id });
        setSel({ kind: 'node', id });
        return say(`Now click the empty space where ${id}'s special should go.`);
      }
      if (applyResult(moveSpecial(map, armed.from, id))) {
        setArmed(null);
        setSel({ kind: 'node', id });
      }
      return;
    }
    if (armed?.kind === 'connect') {
      if (!armed.from) {
        setArmed({ kind: 'connect', from: id });
        setSel({ kind: 'node', id });
        return say(`Now click the node ${id} should connect to.`);
      }
      if (applyResult(connect(map, armed.from, id))) {
        setArmed(null);
        setSel({ kind: 'node', id });
      }
      return;
    }
    if (armed?.kind === 'disconnect') {
      if (!armed.from) {
        setArmed({ kind: 'disconnect', from: id });
        setSel({ kind: 'node', id });
        return say(`Now click the node ${id} connects to (the edge to remove).`);
      }
      if (applyResult(disconnect(map, armed.from, id))) {
        setArmed(null);
        setSel({ kind: 'node', id });
      }
      return;
    }
    setSel({ kind: 'node', id });
    const p = map.layout.nodePos[id];
    if (p) startDrag({ kind: 'node', id }, e, p);
  };
  const onDecorDown = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    setSel({ kind: 'decor', id });
    if (!canEdit) return;
    const d = map.layout.decor.find((x) => x.id === id);
    if (d) startDrag({ kind: 'decor', id }, e, { x: d.x, y: d.y });
  };
  const onSlotsDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    setSel({ kind: 'slots' });
    if (canEdit) startDrag({ kind: 'slots' }, e, map.layout.slotsAnchor);
  };

  const arm = (type: 'chance' | 'noise' | 'booster') => {
    if (!canEdit) return;
    if (selNode && selNode.kind !== 'tx' && selNode.kind !== 'rx' && !selSpecial) {
      applyResult(setSpecial(map, selNode.id, { type, card: type === 'chance' ? armCard : undefined }));
      return;
    }
    setArmed({ kind: 'special', type, card: armCard });
    say(`Click a normal space to make it a ${type.toUpperCase()} space.`);
  };
  const deleteTile = () => {
    if (!canEdit || !selNode) return say('Select a tile first.', true);
    if (selNode.kind === 'tx' || selNode.kind === 'rx') return say('The start and finish cannot be deleted.', true);
    if (selSpecial) {
      applyResult(setSpecial(map, selNode.id, null));
      return;
    }
    if (!window.confirm(`Delete space ${selNode.id}? Its predecessors reconnect directly to its successors.`)) return;
    if (applyResult(deleteNode(map, selNode.id, true))) setSel(null);
  };
  const addNormal = () => {
    if (!canEdit || !world.board) return;
    if (!selNode) return say('Select a tile first: the new space is inserted right after it.', true);
    const succs = world.board.succ[selNode.id];
    if (succs.length !== 1) return say('Select a tile with exactly one space after it (not a fork or the finish).', true);
    applyResult(insertNodeOnEdge(map, selNode.id, succs[0]));
  };
  const addFreeNode = () => {
    if (!canEdit || !world.layout) return;
    const r = addNode(map, { kind: 'normal' }, { x: world.layout.worldW / 2, y: world.layout.worldH / 2 });
    commit(r.map);
    setSel({ kind: 'node', id: r.id });
    say(`Added ${r.id} — use CONNECT to wire it into the network.`);
  };
  const duplicateSelected = () => {
    if (!canEdit || !selNode) return say('Select a tile first.', true);
    applyResult(duplicateNode(map, selNode.id));
  };
  const armConnect = () => {
    if (!canEdit) return;
    setArmed(armed?.kind === 'connect' ? null : { kind: 'connect', from: selNode?.id ?? null });
    say(selNode ? `Click the node ${selNode.id} should connect to.` : 'Click the FROM node, then the TO node.');
  };
  const armDisconnect = () => {
    if (!canEdit) return;
    setArmed(armed?.kind === 'disconnect' ? null : { kind: 'disconnect', from: selNode?.id ?? null });
    say(selNode ? `Click the node ${selNode.id} connects to (the edge to remove).` : 'Click the FROM node, then the TO node.');
  };

  const save = () => {
    try {
      saveActiveMap(map);
      setSaved(JSON.stringify(map));
      say('Map saved — the next new game will use it.');
    } catch (e) {
      say(`Could not save: ${(e as Error).message}`, true);
    }
  };
  const resetDefault = () => {
    if (!window.confirm('Reset to the default map? Your saved map and all unsaved edits will be replaced.')) return;
    clearActiveMap();
    const d = defaultMap().map;
    setPast((p) => [...p, map]);
    setMap(clone(d));
    setSaved(JSON.stringify(d));
    setSel(null);
    say('Default map restored.');
  };
  const slots = useMemo(() => listMapSlots(), [tick]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.key === 'Escape') {
        setArmed(null);
        setSel(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selDecor && canEdit) {
        setMap(removeDecor(map, selDecor.id));
        setSel(null);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const leave = () => {
    if (dirty && !window.confirm('You have unsaved map edits. Leave without saving?')) return;
    window.location.hash = '#/';
  };

  // compare with the tuned preset this map started from (every preset names its board after itself)
  const basePreset = presetForBoard(map.board);
  const baseMap = useMemo(() => basePreset?.build(), [basePreset]);
  const differsFromSim = !baseMap || JSON.stringify([map.board, map.rules]) !== JSON.stringify([baseMap.board, baseMap.rules]);
  const canSave = dirty && !world.error && (validation.valid || overrideErrors);

  return (
    <div className="app" data-fs>
      <div className="topbar">
        <div className="brand">MAP EDITOR<small>ADMIN</small></div>
        <span className="muted">{running ? '🔒 Locked — a game is running' : canEdit ? 'Editing — press SAVE MAP to use these changes in new games' : 'Locked — press EDIT MAP to change the board'}</span>
        <div className="top-actions">
          <select className="select" value={prefs.style} onChange={(e) => setViewPrefs({ style: e.target.value as typeof prefs.style })} title="Map style (visual only)">
            {MAP_STYLES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <button className="btn small" disabled={!past.length || !canEdit} onClick={undo}>↩ Undo</button>
          <button className="btn small" disabled={!future.length || !canEdit} onClick={redo}>↪ Redo</button>
          {editing && !running ? (
            <button className="btn small warn" onClick={() => setEditing(false)}>🔒 LOCK MAP</button>
          ) : (
            <button
              className="btn small"
              onClick={() => {
                if (running) {
                  if (!window.confirm('A game is running. Reset it to edit the map?')) return;
                  getHostStore().reset();
                }
                setEditing(true);
              }}
            >
              ✎ EDIT MAP
            </button>
          )}
          <button className="btn small go" disabled={!canSave} onClick={save}>SAVE MAP{dirty ? ' •' : ''}</button>
          <button className="btn small" onClick={leave}>← Back to game</button>
        </div>
      </div>

      <div className="editor">
        {/* ---------------- left: tools */}
        <div className="ed-side">
          <div className="panel">
            <h3>ADD / CHANGE TILES</h3>
            <div className="field" style={{ marginBottom: 8 }}>
              <label>Card for new {getTerms().chance} tiles</label>
              <select className="select" value={armCard} onChange={(e) => setArmCard(e.target.value as CardType)}>
                {CARD_TYPES.map((c) => <option key={c} value={c}>{CARD_INFO[c].label}</option>)}
              </select>
            </div>
            <div className="ed-tools">
              <button className="btn" disabled={!canEdit} onClick={addNormal}>+ NORMAL (after selection)</button>
              <button className={`btn ${armed?.kind === 'special' && armed.type === 'chance' ? 'on' : ''}`} disabled={!canEdit} onClick={() => arm('chance')}>+ {getTerms().chance}</button>
              <button className={`btn ${armed?.kind === 'special' && armed.type === 'noise' ? 'on' : ''}`} disabled={!canEdit} onClick={() => arm('noise')}>+ {getTerms().noise}</button>
              <button className={`btn ${armed?.kind === 'special' && armed.type === 'booster' ? 'on' : ''}`} disabled={!canEdit} onClick={() => arm('booster')}>+ {getTerms().booster}</button>
              <button className="btn danger" disabled={!canEdit} onClick={deleteTile}>DELETE TILE</button>
              <button className="btn" disabled={!selNode} onClick={() => say(selNode ? `Editing ${selNode.id} — use the panel on the right.` : 'Select a tile first.')}>EDIT TILE</button>
              <button
                className={`btn ${armed?.kind === 'move' ? 'on' : ''}`}
                disabled={!canEdit}
                onClick={() => {
                  setArmed(armed?.kind === 'move' ? null : { kind: 'move', from: null });
                  say('Click the special tile to move, then the empty space to move it to.');
                }}
              >
                MOVE SPECIAL
              </button>
              <button className="btn ghost" disabled={!armed} onClick={() => setArmed(null)}>Cancel (Esc)</button>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0', lineHeight: 1.5 }}>
              Select a tile, then press a + button to turn it into that special; or press the button first and click a normal tile.
              <b> Drag</b> any tile, landmark, the start, the finish or the slot column to reposition it.
            </p>
          </div>

          <div className="panel">
            <h3>GRAPH TOOLS</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>Free-form graph editing: add a node anywhere, then wire it in. Branch/merge/fork — any shape.</p>
            <div className="ed-tools">
              <button className="btn" disabled={!canEdit} onClick={addFreeNode}>ADD NODE</button>
              <button className="btn" disabled={!canEdit || !selNode} onClick={duplicateSelected}>DUPLICATE NODE</button>
              <button className={`btn ${armed?.kind === 'connect' ? 'on' : ''}`} disabled={!canEdit} onClick={armConnect}>CONNECT</button>
              <button className={`btn ${armed?.kind === 'disconnect' ? 'on' : ''}`} disabled={!canEdit} onClick={armDisconnect}>DISCONNECT</button>
            </div>
          </div>

          {report.classicRouteLengths && (
            <div className="panel">
              <h3>PATHS &amp; LENGTHS</h3>
              <div className="kv">
                {Object.keys(report.classicRouteLengths).map((r) => (
                  <span key={r} style={{ display: 'contents' }}>
                    <span style={{ color: routeColor(r), fontWeight: 700 }}>{map.layout.pathLabels[r] ?? `PATH ${r}`}</span>
                    <b>{report.classicRouteLengths![r]} spaces</b>
                  </span>
                ))}
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label>Path names</label>
                {Object.keys(report.classicRouteLengths).map((r) => (
                  <input key={r} className="input" style={{ marginBottom: 4, borderColor: routeColor(r) }} value={map.layout.pathLabels[r] ?? ''} maxLength={14} disabled={!canEdit} onChange={(e) => setMap(setPathLabel(map, r, e.target.value))} />
                ))}
              </div>
            </div>
          )}

          <div className="panel">
            <h3>LANDMARKS (decoration only)</h3>
            <div className="row">
              <select className="select grow" value={decorKind} onChange={(e) => setDecorKind(e.target.value as DecorKind)}>
                {DECOR_KINDS.map((d) => <option key={d.kind} value={d.kind}>{d.label}</option>)}
              </select>
              <button
                className="btn small"
                disabled={!canEdit || !world.layout}
                onClick={() => {
                  const w = world.layout!;
                  const r = addDecor(map, decorKind, { x: w.worldW / 2, y: w.worldH / 2 });
                  commit(r.map);
                  setSel({ kind: 'decor', id: r.id });
                }}
              >
                + Add
              </button>
            </div>
            <label className="row" style={{ marginTop: 8 }}><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to grid</label>
            <button className="btn small" style={{ marginTop: 8 }} disabled={!canEdit} onClick={() => window.confirm('Re-seed all positions from the default route curves? Special spaces stay.') && commit(resetLayout(map))}>Reset all positions</button>
          </div>
        </div>

        {/* ---------------- centre: map */}
        <div className="ed-canvas">
          {world.board && world.layout ? (
            <BoardCanvas
              ref={canvas}
              mode="editor"
              board={world.board}
              layout={world.layout}
              theme={theme}
              teams={[]}
              slots={5}
              qualifiers={[]}
              showCards
              showIds
              boosterAmount={map.rules.boosterAmount}
              noiseBack={map.rules.noiseBack}
              calm
              follow={false}
              editor={{
                selectedNode: sel?.kind === 'node' ? sel.id : null,
                selectedDecor: sel?.kind === 'decor' ? sel.id : null,
                onNodeDown,
                onDecorDown,
                onSlotsDown,
                onBackgroundDown: () => {
                  if (!armed) setSel(null);
                },
              }}
            />
          ) : (
            <div style={{ padding: 30 }} className="warn">⚠ {world.error}</div>
          )}
          {note && <div className="ed-banner" style={note.bad ? { background: '#fee2e2', borderColor: '#f87171', color: '#7f1d1d' } : undefined}>{note.text}</div>}
          {armed && (
            <div className="ed-banner" style={{ top: 48, background: '#dbeafe', borderColor: '#60a5fa', color: '#1e3a8a' }}>
              {armed.kind === 'special'
                ? `Placing ${armed.type.toUpperCase()} — click a normal space`
                : armed.kind === 'move'
                  ? armed.from
                    ? `Moving ${armed.from} — click the destination`
                    : 'Move special — click the tile to move'
                  : armed.kind === 'connect'
                    ? armed.from
                      ? `Connect ${armed.from} → click the destination`
                      : 'Connect — click the FROM node'
                    : armed.from
                      ? `Disconnect ${armed.from} → click the TO node`
                      : 'Disconnect — click the FROM node'}
            </div>
          )}
        </div>

        {/* ---------------- right: inspector + checks + save/load */}
        <div className="ed-side right">
          <div className="panel">
            <h3>EDIT TILE</h3>
            {selNode ? (
              <>
                <div className="kv" style={{ marginBottom: 8 }}>
                  <span>Space</span><b>{selNode.id}</b>
                  <span>Belongs to</span>
                  <b>
                    {selMeta && /^[A-H]$/.test(selMeta.lane)
                      ? map.layout.pathLabels[selMeta.lane] ?? `Path ${selMeta.lane}`
                      : selMeta?.lane === 'S'
                        ? 'Shared start'
                        : selMeta?.lane === 'M'
                          ? 'Shared finish'
                          : selNode.kind === 'tx'
                            ? `${getTerms().start} (start)`
                            : selNode.kind === 'rx'
                              ? `${getTerms().finish} (finish)`
                              : 'Custom node'}
                  </b>
                  <span>Connects to</span>
                  <b>{world.board?.succ[selNode.id]?.join(', ') || '—'}</b>
                  <span>Connects from</span>
                  <b>{world.board?.pred[selNode.id]?.join(', ') || '—'}</b>
                </div>
                {selNode.kind !== 'tx' && selNode.kind !== 'rx' && (
                  <>
                    <div className="field">
                      <label>Type</label>
                      <select
                        className="select"
                        disabled={!canEdit}
                        value={selSpecial ? selSpecial.type : 'normal'}
                        onChange={(e) => {
                          const v = e.target.value;
                          applyResult(setSpecial(map, selNode.id, v === 'normal' ? null : { type: v as 'chance' | 'noise' | 'booster', card: v === 'chance' ? (selSpecial?.card ?? 'isi') : undefined }));
                        }}
                      >
                        <option value="normal">Normal space</option>
                        <option value="chance">{getTerms().chance} (win a card)</option>
                        <option value="noise">{getTerms().noise} (slip back)</option>
                        <option value="booster">{getTerms().booster} (jump ahead)</option>
                      </select>
                    </div>
                    {selSpecial?.type === 'chance' && (
                      <div className="field">
                        <label>Card awarded</label>
                        <select className="select" disabled={!canEdit} value={selSpecial.card ?? 'isi'} onChange={(e) => applyResult(setSpecial(map, selNode.id, { type: 'chance', card: e.target.value as CardType }))}>
                          {CARD_TYPES.map((c) => <option key={c} value={c}>{CARD_INFO[c].label}</option>)}
                        </select>
                      </div>
                    )}
                    {(selSpecial?.type === 'booster' || selSpecial?.type === 'noise') && (
                      <div className="field">
                        <label>{selSpecial.type === 'booster' ? 'Forward spaces' : 'Backward spaces'} (blank = global {selSpecial.type === 'booster' ? map.rules.boosterAmount : map.rules.noiseBack})</label>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={8}
                          disabled={!canEdit}
                          value={selSpecial.amount ?? ''}
                          onChange={(e) => applyResult(setSpecial(map, selNode.id, { type: selSpecial.type, amount: e.target.value === '' ? undefined : Math.max(1, Math.min(8, Number(e.target.value))) }))}
                        />
                      </div>
                    )}
                    {selSpecial && (
                      <div className="field">
                        <label>Move this special to…</label>
                        <select
                          className="select"
                          disabled={!canEdit}
                          value=""
                          onChange={(e) => {
                            const to = e.target.value;
                            if (to && applyResult(moveSpecial(map, selNode.id, to))) setSel({ kind: 'node', id: to });
                          }}
                        >
                          <option value="">choose an empty space</option>
                          {world.board!.nodes.filter((n) => n.kind !== 'tx' && n.kind !== 'rx' && !n.special).map((n) => <option key={n.id} value={n.id}>{n.id}</option>)}
                        </select>
                      </div>
                    )}
                  </>
                )}
                <div className="row">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>X</label>
                    <input className="input" style={{ width: 80 }} type="number" disabled={!canEdit} value={Math.round(map.layout.nodePos[selNode.id]?.x ?? 0)} onChange={(e) => setMap(setNodePos(map, selNode.id, { x: Number(e.target.value), y: map.layout.nodePos[selNode.id].y }))} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Y</label>
                    <input className="input" style={{ width: 80 }} type="number" disabled={!canEdit} value={Math.round(map.layout.nodePos[selNode.id]?.y ?? 0)} onChange={(e) => setMap(setNodePos(map, selNode.id, { x: map.layout.nodePos[selNode.id].x, y: Number(e.target.value) }))} />
                  </div>
                </div>
              </>
            ) : selDecor ? (
              <>
                <div className="kv"><span>Landmark</span><b>{DECOR_KINDS.find((d) => d.kind === selDecor.kind)?.label}</b></div>
                <div className="field" style={{ marginTop: 8 }}><label>Size</label><input type="range" min={0.4} max={2.5} step={0.05} disabled={!canEdit} value={selDecor.scale} onChange={(e) => setMap(updateDecor(map, selDecor.id, { scale: Number(e.target.value) }))} /></div>
                <div className="field"><label>Rotation</label><input type="range" min={-45} max={45} step={1} disabled={!canEdit} value={selDecor.rot} onChange={(e) => setMap(updateDecor(map, selDecor.id, { rot: Number(e.target.value) }))} /></div>
                {selDecor.kind === 'platform' && (
                  <div className="field"><label>Width</label><input type="range" min={120} max={420} step={10} disabled={!canEdit} value={selDecor.w ?? 220} onChange={(e) => setMap(updateDecor(map, selDecor.id, { w: Number(e.target.value) }))} /></div>
                )}
                <button className="btn small danger" disabled={!canEdit} onClick={() => { setMap(removeDecor(map, selDecor.id)); setSel(null); }}>Delete landmark</button>
              </>
            ) : sel?.kind === 'slots' ? (
              <p className="muted">Winner slot column — drag it to move.</p>
            ) : (
              <p className="muted" style={{ margin: 0 }}>Click a tile, landmark, the start or the finish to inspect it. Landmarks never become game spaces.</p>
            )}
          </div>

          <div className="panel">
            <h3>CHECKS</h3>
            <div className={`kv-line ${validation.valid ? 'ok-text' : 'warn'}`} style={{ fontWeight: 800, marginBottom: 6 }}>
              {validation.valid ? '✔ MAP VALID' : '⚠ MAP HAS ERRORS'}
            </div>
            <div className={report.playableNow ? 'ok-text' : 'warn'} style={{ fontSize: 12.5, marginBottom: 8 }}>
              {report.playableNow ? '▶ Playable now' : '⚠ Needs the graph-rendering follow-up — the live game can only play the classic (single-fork) or wheel (ring-of-forks) shapes today; this map can still be balance-checked here.'}
            </div>
            {world.error && <div className="warn">⚠ {world.error}</div>}
            {validation.errors.map((i) => <div className="warn" key={i.code + i.message}>⚠ {i.message}</div>)}
            {validation.warnings.map((i) => <div className="warn" key={i.code + i.message}>⚠ {i.message}</div>)}
            {placement.map((p) => <div className="warn" key={p}>⚠ {p}</div>)}
            {report.overlaps.slice(0, 4).map((p) => <div className="warn" key={p}>⚠ {p}</div>)}
            {validation.valid && !placement.length && !report.overlaps.length && !world.error && <div className="ok-text" style={{ fontSize: 13 }}>✔ Placement rules satisfied, no overlapping spaces.</div>}
            {!validation.valid && validation.overridable && (
              <label className="row" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={overrideErrors} onChange={(e) => setOverrideErrors(e.target.checked)} /> Start/save anyway (override)
              </label>
            )}
            {differsFromSim ? <div className="warn">{basePreset ? <>This map differs from the tuned “{basePreset.name}” map.</> : 'This is a custom map.'} <a href="#/balancer">Run the Board Balancer</a> (or <code>npm run maps</code>) to check the balance.</div> : <div className="ok-text" style={{ fontSize: 13 }}>✔ Unchanged “{basePreset!.name}” map — balance-tested.</div>}
          </div>

          <div className="panel">
            <h3>SAVE / LOAD</h3>
            <div className="row">
              <button className="btn go" disabled={!canSave} onClick={save}>SAVE MAP</button>
              <button className="btn danger small" onClick={resetDefault}>RESET DEFAULT MAP</button>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Named copies</label>
              <div className="row">
                <input className="input grow" value={slotName} onChange={(e) => setSlotName(e.target.value)} />
                <button className="btn small" onClick={() => { saveMapSlot(slotName.trim() || 'My map', map); setTick(tick + 1); say(`Saved a copy named "${slotName}".`); }}>Save copy</button>
              </div>
              {slots.map((s) => (
                <div className="row" key={s.name} style={{ marginTop: 4 }}>
                  <span className="grow" style={{ fontWeight: 600 }}>{s.name}</span>
                  <button className="btn small" disabled={!canEdit} onClick={() => { if (window.confirm(`Load "${s.name}"? Unsaved edits are replaced.`)) { commit(clone(s.map)); setSel(null); } }}>LOAD</button>
                  <button className="btn small danger" onClick={() => { if (window.confirm(`Delete the copy "${s.name}"?`)) { deleteMapSlot(s.name); setTick(tick + 1); } }}>✕</button>
                </div>
              ))}
            </div>
            <div className="row">
              <button className="btn small" onClick={() => download('festrun-map.json', JSON.stringify(map, null, 2), 'application/json')}>Export JSON</button>
            </div>
            <textarea className="input" style={{ width: '100%', height: 64, marginTop: 8 }} placeholder="Paste exported map JSON here…" value={importText} onChange={(e) => setImportText(e.target.value)} />
            <button
              className="btn small"
              disabled={!canEdit || !importText.trim()}
              onClick={() => {
                try {
                  const m = JSON.parse(importText) as MapConfiguration;
                  const b = buildBoard(m.board);
                  commit(clone({ board: m.board, rules: m.rules, layout: ensureLayout(b, m.layout) }));
                  setImportText('');
                  say('Map imported (not saved yet).');
                } catch (e) {
                  say(`Import failed: ${(e as Error).message}`, true);
                }
              }}
            >
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
