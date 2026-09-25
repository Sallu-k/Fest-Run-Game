import { useEffect, useState } from 'react';
import { maxSlots, remainingOf } from '../core/engine';
import { CARD_INFO, CARD_TYPES, CardType } from '../core/types';
import { GameState, GameStore, coreOf, currentTeam, getBoard, renderWorld, targetInfo, tLabel } from '../state/game';
import { MAP_STYLES, setViewPrefs } from '../state/mapStore';
import { BoardCanvas, CanvasHandle } from './board/BoardCanvas';
import { themeOf } from './board/theme';
import { HostDock } from './HostDock';
import { download, logToCsv, logToText } from './Log';
import { RulesList, Setup } from './Setup';
import { TeamStrip } from './TeamStrip';
import { TimerDriver, TimerHUD, TimerMini } from './Timer';
import { TeamIcon } from './symbols';
import { beep, getHostStore, useGame, useTitle, useViewPrefs } from './hooks';
import { useRef } from 'react';

// ------------------------------------------------------------------ top bar

function TopBar({ s, store, onOverrides }: { s: GameState; store: GameStore; onOverrides: (tab: 'card' | 'pos' | 'teams' | 'opts') => void }) {
  const [clicks, setClicks] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [more, setMore] = useState(false);
  const prefs = useViewPrefs();
  const title = useTitle();
  const team = currentTeam(s);
  const playing = s.phase !== 'setup';
  const editMap = () => {
    if (s.phase !== 'setup' && !window.confirm('The map is locked while a game is running. Reset the current game to edit the map?')) return;
    if (s.phase !== 'setup') store.reset();
    window.location.hash = '#/map';
  };
  return (
    <div className="topbar">
      <div
        className="brand"
        onClick={() => {
          if (clicks + 1 >= 5) {
            window.location.hash = '#/balancer';
            setClicks(0);
          } else setClicks(clicks + 1);
        }}
      >
        {title.event || title.game}<small>{title.event ? title.game : 'FestRun'}</small>
      </div>
      {playing && (
        <>
          <div className="round-badge">ROUND {Math.min(s.round, s.rounds)} / {s.rounds}</div>
          <div className="turn-badge">
            <small>TURN</small>
            {team && s.phase === 'playing' ? (
              <>
                <TeamIcon index={team.id - 1} size={22} /> T{team.id}
              </>
            ) : (
              '—'
            )}
          </div>
          <TimerMini timer={s.timer} />
          <TeamStrip s={s} />
        </>
      )}
      <div className="top-actions">
        {playing && (
          <>
            <button className="btn small" onClick={() => store.undo()} disabled={!store.canUndo()} title="Undo the last game action">↩ Undo</button>
            <button className="btn small" onClick={() => onOverrides('card')}>Overrides</button>
            <button className="btn small" onClick={() => window.open('#/projector', 'festrun-projector', 'popup,width=1280,height=720')}>Projector ↗</button>
            <button className="btn small danger" onClick={() => window.confirm('Reset the entire game? All positions, cards and the log will be lost.') && store.reset()}>Reset</button>
          </>
        )}
        <div style={{ position: 'relative' }}>
          <button className="btn small" onClick={() => setMore(!more)}>⋯ More</button>
          {more && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 55 }} onClick={() => setMore(false)} />
              <div className="team-pop" style={{ right: 0, left: 'auto', top: 44, width: 280 }}>
                <div className="field" style={{ marginBottom: 4 }}>
                  <label>Map style</label>
                  <select className="select" value={prefs.style} onChange={(e) => setViewPrefs({ style: e.target.value as typeof prefs.style })}>
                    {MAP_STYLES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
                <label className="row"><input type="checkbox" checked={prefs.follow} onChange={(e) => setViewPrefs({ follow: e.target.checked })} /> Camera follows the moving team</label>
                <label className="row"><input type="checkbox" checked={prefs.calm} onChange={(e) => setViewPrefs({ calm: e.target.checked })} /> Calm mode (no looping animation)</label>
                <button className="btn small" onClick={() => { setMore(false); setShowRules(true); }}>Rules</button>
                <button className="btn small" onClick={() => { setMore(false); editMap(); }}>{s.phase === 'setup' ? '✎ EDIT MAP' : '🔒 Map locked — edit…'}</button>
                {!playing && <button className="btn small" onClick={() => window.open('#/projector', 'festrun-projector', 'popup,width=1280,height=720')}>Projector ↗</button>}
                <button className="btn small" onClick={() => void document.documentElement.requestFullscreen?.()}>⛶ Fullscreen page</button>
                <a className="btn small" style={{ textAlign: 'center', textDecoration: 'none' }} href="#/balancer">Board Balancer</a>
              </div>
            </>
          )}
        </div>
      </div>
      {showRules && (
        <div className="modal-backdrop" onClick={() => setShowRules(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>HOW TO PLAY</h2>
            <RulesList slots={playing ? maxSlots(coreOf(s)) : s.setup.slots} />
            <div className="modal-actions"><button className="btn" onClick={() => setShowRules(false)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ overrides

export function OverridesModal({ s, store, initialTab, onClose }: { s: GameState; store: GameStore; initialTab: 'card' | 'pos' | 'teams' | 'opts'; onClose: () => void }) {
  const board = getBoard(s.boardCfg);
  const [tab, setTab] = useState<'card' | 'pos' | 'teams' | 'opts'>(initialTab);
  const active = s.teams.filter((t) => t.status === 'active');
  const [teamId, setTeamId] = useState(s.mover?.teamId ?? active[0]?.id ?? 1);
  const [card, setCard] = useState<CardType>('isi');
  const [node, setNode] = useState('S1');
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>HOST OVERRIDES</h2>
        <div className="tabs">
          {([['card', 'Give card'], ['pos', 'Place team'], ['teams', 'Teams'], ['opts', 'Options']] as const).map(([k, l]) => (
            <button key={k} className={`btn small ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        {(tab === 'card' || tab === 'pos') && (
          <div className="field">
            <label>TEAM</label>
            <select className="select" value={teamId} onChange={(e) => setTeamId(Number(e.target.value))}>
              {active.map((t) => <option key={t.id} value={t.id}>T{t.id} {t.name}</option>)}
            </select>
          </div>
        )}
        {tab === 'card' && (
          <>
            <div className="field">
              <label>CARD (usable immediately)</label>
              <select className="select" value={card} onChange={(e) => setCard(e.target.value as CardType)}>
                {CARD_TYPES.map((c) => <option key={c} value={c}>{CARD_INFO[c].label}</option>)}
              </select>
            </div>
            <button className="btn primary" onClick={() => store.giveCard(teamId, card)}>Give card</button>
          </>
        )}
        {tab === 'pos' && (
          <>
            <div className="field">
              <label>SPACE</label>
              <select className="select" value={node} onChange={(e) => setNode(e.target.value)}>
                {board.nodes.map((n) => <option key={n.id} value={n.id}>{n.id}{n.special ? ` (${n.special.type})` : ''}</option>)}
              </select>
            </div>
            <button className="btn primary" onClick={() => store.setPosition(teamId, node)}>Move team there (no special triggers; its trail is reconstructed automatically)</button>
          </>
        )}
        {tab === 'teams' && (
          <div className="target-list">
            {s.teams.map((t) => (
              <div key={t.id} className="row">
                <TeamIcon index={t.id - 1} size={24} />
                <b>T{t.id}</b>
                <input className="input grow" defaultValue={t.name} maxLength={22} onBlur={(e) => store.renameTeam(t.id, e.target.value)} />
                <button className="btn small danger" disabled={t.status !== 'active'} onClick={() => window.confirm(`Withdraw T${t.id} ${t.name} from the game?`) && store.removeTeam(t.id)}>
                  Withdraw
                </button>
              </div>
            ))}
          </div>
        )}
        {tab === 'opts' && <OptionsTab s={s} store={store} />}
        <div className="modal-actions"><button className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function OptionsTab({ s, store }: { s: GameState; store: GameStore }) {
  const prefs = useViewPrefs();
  return (
    <div className="target-list">
      <label className="row"><input type="checkbox" checked={s.sound} onChange={(e) => { store.setSound(e.target.checked); if (e.target.checked) beep(880, 150); }} /> Audible timer alerts (beeps in the last 5 seconds)</label>
      <label className="row"><input type="checkbox" checked={s.autoAdvance} onChange={(e) => store.setAutoAdvance(e.target.checked)} /> Auto-start the 10 s buffer and 20 s action timers</label>
      <label className="row"><input type="checkbox" checked={prefs.calm} onChange={(e) => setViewPrefs({ calm: e.target.checked })} /> Calm mode: switch off the looping signal animation (slow laptops)</label>
      <label className="row"><input type="checkbox" checked={prefs.follow} onChange={(e) => setViewPrefs({ follow: e.target.checked })} /> Camera follows the moving team</label>
      <div className="row">
        <button className="btn small" onClick={() => download('festrun-log.csv', logToCsv(s.log))}>Download log (CSV)</button>
        <button className="btn small" onClick={() => void navigator.clipboard?.writeText(logToText(s.log))}>Copy log</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ modals on host

function OrthModal({ s, store }: { s: GameState; store: GameStore }) {
  const p = s.pending;
  if (p?.kind !== 'orth') return null;
  const target = s.teams.find((t) => t.id === p.targetId)!;
  const user = s.teams.find((t) => t.id === p.teamId)!;
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>{CARD_INFO.orth.label}!</h2>
        <p style={{ fontSize: 17, lineHeight: 1.5 }}>
          {tLabel(user)} is using <b>{CARD_INFO[p.card].label}</b> on {tLabel(target)} <b>{target.name}</b>, who holds <b style={{ color: 'var(--pink)' }}>{CARD_INFO.orth.label}</b>.
          Does {tLabel(target)} block it? (Both cards are spent.)
        </p>
        <div className="modal-actions">
          <button className="btn small" onClick={() => store.cancelPending()}>Cancel</button>
          <button className="btn" onClick={() => store.resolveOrth(false)}>Let it through</button>
          <button className="btn primary big" onClick={() => store.resolveOrth(true)}>BLOCK IT</button>
        </div>
      </div>
    </div>
  );
}

export function RevealOverlay({ s, store }: { s: GameState; store?: GameStore }) {
  const r = s.reveal;
  if (!r) return null;
  const t = s.teams.find((x) => x.id === r.teamId)!;
  const info = CARD_INFO[r.card];
  return (
    <div className={store ? 'modal-backdrop' : 'proj-overlay'}>
      <div className={store ? 'modal' : ''} style={store ? undefined : { textAlign: 'center' }}>
        <div className="reveal-wrap">
          <h2 style={{ color: t.color === '#f1f5f9' ? 'var(--ink)' : t.color }}>{tLabel(t)} {t.name} won a card!</h2>
          <div className={`reveal-card ${r.revealed ? 'flipped' : ''}`}>
            <div className="reveal-inner">
              <div className="face back">?</div>
              <div className="face front">
                <div className="cn">{info.label}</div>
                <div className="ct">{info.text}</div>
              </div>
            </div>
          </div>
          {store && (
            <div className="row">
              {!r.revealed ? (
                <button className="btn primary big" onClick={() => store.revealCard()}>REVEAL CARD</button>
              ) : (
                <button className="btn go big" onClick={() => store.dismissReveal()}>OK — CLOSE</button>
              )}
              {!r.revealed && <button className="btn ghost" onClick={() => store.dismissReveal()}>Skip reveal</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ main host screen

export function Host() {
  const store = getHostStore();
  const s = useGame(store);
  const prefs = useViewPrefs();
  const canvas = useRef<CanvasHandle>(null);
  const [ov, setOv] = useState<'card' | 'pos' | 'teams' | 'opts' | null>(null);
  const theme = themeOf(prefs.style);

  useEffect(() => {
    if (!s.message) return;
    const id = window.setTimeout(() => store.clearMessage(), 4500);
    return () => window.clearTimeout(id);
  }, [s.message, store]);

  if (s.phase === 'setup') {
    return (
      <div className="app">
        <TopBar s={s} store={store} onOverrides={setOv} />
        <div className="setup-page">
          <Setup store={store} setup={s.setup} />
        </div>
      </div>
    );
  }

  const { board, layout } = renderWorld(s);
  const team = currentTeam(s);
  const targets = new Map<number, number>();
  if (s.pending?.kind === 'target') for (const t of targetInfo(s)) targets.set(t.team.id, t.dist);
  const slots = maxSlots(coreOf(s));
  const nameplate =
    s.phase === 'playing' && team && team.status === 'active' && s.roundPhase !== 'ROUND_COMPLETE'
      ? { team, toGo: remainingOf(board, team), note: s.pending?.kind === 'route' ? 'CHOOSING ROUTE' : s.pending?.kind === 'quick' ? 'QUICK QUESTION' : undefined }
      : null;

  return (
    <div className="app" data-fs>
      <TopBar s={s} store={store} onOverrides={setOv} />
      <div className="stage">
        <div className="canvas-cell">
          <BoardCanvas
            ref={canvas}
            mode="host"
            board={board}
            layout={layout}
            theme={theme}
            teams={s.teams}
            slots={slots}
            qualifiers={s.qualifiers}
            currentTeamId={s.phase === 'playing' ? s.mover?.teamId : null}
            nameplate={nameplate}
            showCards
            boosterAmount={s.rules.boosterAmount}
            noiseBack={s.rules.noiseBack}
            targets={targets}
            onPickTeam={(id) => store.pickTarget(id)}
            routeChoice={s.pending?.kind === 'route' ? (r) => store.chooseRoute(r) : null}
            routeOptions={s.pending?.kind === 'route' ? s.pending.options : undefined}
            lastMove={s.lastMove}
            follow={prefs.follow}
            calm={prefs.calm}
          >
            <div className="float-timer"><TimerHUD timer={s.timer} /></div>
            {s.message && <div className="toast" onClick={() => store.clearMessage()}>{s.message}</div>}
          </BoardCanvas>
        </div>
        <HostDock s={s} store={store} board={board} rail={prefs.dock === 'rail'} onToggleRail={() => setViewPrefs({ dock: prefs.dock === 'rail' ? 'open' : 'rail' })} openOverrides={(t) => setOv(t)} />
      </div>
      <TimerDriver store={store} />
      <OrthModal s={s} store={store} />
      <RevealOverlay s={s} store={store} />
      {ov && <OverridesModal s={s} store={store} initialTab={ov} onClose={() => setOv(null)} />}
    </div>
  );
}
