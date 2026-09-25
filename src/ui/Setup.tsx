import { useState } from 'react';
import { buildBoard, shortestPath } from '../core/board';
import { CARD_EFFECT, SPECIAL_EFFECT, TERM_PACKS, Terms } from '../core/terms';
import { CARD_TYPES, CardType } from '../core/types';
import { presetForBoard } from '../data/mapPresets';
import { clearBoardOverride, getActiveBoard } from '../state/activeBoard';
import { GameState, GameStore, TEAM_COLORS, defaultNames } from '../state/game';
import { setViewPrefs } from '../state/mapStore';
import { useTerms, useTitle, useViewPrefs } from './hooks';
import { MapPresetPicker } from './MapPresetPicker';
import { TeamIcon } from './symbols';

const MIN_ROUNDS = 3;
const MAX_ROUNDS = 8;

function rulesSteps(t: Terms, slots: number): string[] {
  return [
    'Answer 6 rapid-fire questions in 30 seconds.',
    'Count how many you got right.',
    'Move that many spaces — the host moves you, you never roll dice.',
    `Follow the path from the ${t.start} to the ${t.finish}. At a fork you choose which way to go.`,
    'Special spaces can help, hurt or give you a card.',
    `Use your cards wisely: ${CARD_TYPES.map((c) => t.cards[c].short).join(', ')}.`,
    `Reach the ${t.finish} before everyone else — the first ${slots} ${slots === 1 ? 'team wins' : 'teams qualify'}!`,
  ];
}

export function RulesList({ slots }: { slots?: number }) {
  const t = useTerms();
  const n = slots ?? getActiveBoard().rules.winnerSlots;
  return (
    <>
      <ol className="rules-list">
        {rulesSteps(t, n).map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ol>
      <div className="legend-list">
        <div><b style={{ color: '#a855f7' }}>{t.chance}</b> — {SPECIAL_EFFECT.chance}</div>
        <div><b style={{ color: '#ef4444' }}>{t.noise}</b> — {SPECIAL_EFFECT.noise}</div>
        <div><b style={{ color: '#16a34a' }}>{t.booster}</b> — {SPECIAL_EFFECT.booster}</div>
        {CARD_TYPES.map((c) => (
          <div key={c}><b style={{ color: 'var(--pink)' }}>{t.cards[c].label}</b> — {CARD_EFFECT[c]}</div>
        ))}
      </div>
    </>
  );
}

/** "Customise wording": every name in the active pack, editable. Blank = keep the pack's word. */
function WordingEditor() {
  const prefs = useViewPrefs();
  const t = useTerms();
  const custom = prefs.customTerms ?? {};
  const set = (patch: Partial<Terms>) => setViewPrefs({ customTerms: { ...custom, ...patch } });
  const setCard = (c: CardType, patch: Partial<Terms['cards'][CardType]>) =>
    set({ cards: { ...custom.cards, [c]: { ...custom.cards?.[c], ...patch } } as Terms['cards'] });
  const field = (label: string, key: 'gameTitle' | 'start' | 'finish' | 'chance' | 'noise' | 'booster' | 'rapidFire' | 'active' | 'firstLocked' | 'allLocked') => (
    <label className="word-field" key={key}>
      <span>{label}</span>
      <input className="input" placeholder={t[key]} value={(custom[key] as string | undefined) ?? ''} maxLength={24} onChange={(e) => set({ [key]: e.target.value.toUpperCase() })} />
    </label>
  );
  return (
    <div className="wording">
      <div className="word-grid">
        {field('Game title', 'gameTitle')}
        {field('Start', 'start')}
        {field('Finish', 'finish')}
        {field('Mystery space (win a card)', 'chance')}
        {field('Trap space (slip back)', 'noise')}
        {field('Boost space (jump ahead)', 'booster')}
        {field('Answer phase heading', 'rapidFire')}
        {field('Moving-team status', 'active')}
        {field('First team finishes', 'firstLocked')}
        {field('All winners found', 'allLocked')}
      </div>
      <div className="word-grid cards">
        {CARD_TYPES.map((c) => (
          <label className="word-field" key={c}>
            <span>Card — {CARD_EFFECT[c].replace(' One use.', '')}</span>
            <div className="row" style={{ gap: 6 }}>
              <input className="input" placeholder={t.cards[c].label} value={custom.cards?.[c]?.label ?? ''} maxLength={22} onChange={(e) => { const v = e.target.value.toUpperCase(); setCard(c, { label: v, short: v ? v.charAt(0) + v.slice(1).toLowerCase() : '' }); }} />
              <input className="input abbr" placeholder={t.cards[c].abbr} title="Short chip (3–4 letters)" value={custom.cards?.[c]?.abbr ?? ''} maxLength={4} onChange={(e) => setCard(c, { abbr: e.target.value.toUpperCase() })} />
            </div>
          </label>
        ))}
      </div>
      <button className="btn small" onClick={() => setViewPrefs({ customTerms: null })} disabled={!prefs.customTerms}>Reset to pack wording</button>
    </div>
  );
}

export function Setup({ store, setup }: { store: GameStore; setup: GameState['setup'] }) {
  const [active, setActive] = useState(getActiveBoard());
  const [wording, setWording] = useState(false);
  const prefs = useViewPrefs();
  const title = useTitle();
  const t = useTerms();
  const { names, rounds } = setup;
  const n = names.length;
  const preset = presetForBoard(active.cfg);
  const slots = Math.max(1, Math.min(setup.slots ?? active.rules.winnerSlots, n));
  const update = (patch: Partial<GameState['setup']>) => {
    const next = { ...setup, ...patch };
    store.setSetup(next.names, next.rounds, next.slots);
  };
  const setN = (k: number) => {
    const next = Math.max(1, Math.min(10, k));
    const cur = names.slice(0, next);
    while (cur.length < next) cur.push(defaultNames(next)[cur.length]);
    update({ names: cur });
  };
  const start = () => {
    const a = getActiveBoard();
    store.startGame(a.cfg, a.rules, a.layout);
  };
  const shortest = shortestPath(buildBoard(active.cfg));

  return (
    <div className="setup">
      <h1>
        {title.event ? <>{title.event} <span>— {title.game}</span></> : <>{title.game} <span>— FestRun</span></>}
      </h1>
      <div className="sub">Host setup · everything runs in this browser, no internet or login needed.</div>

      <div className="panel">
        <h3>1 · YOUR EVENT</h3>
        <div className="field">
          <label>Event name (optional)</label>
          <input className="input" placeholder="e.g. TECHNOVA 2026" value={prefs.eventName} maxLength={40} onChange={(e) => setViewPrefs({ eventName: e.target.value })} />
        </div>
        <div className="field">
          <label>Department / theme — renames the board, spaces and cards (rules stay the same)</label>
          <select className="select" value={prefs.terms} onChange={(e) => setViewPrefs({ terms: e.target.value, customTerms: null })}>
            {TERM_PACKS.map((p) => (
              <option key={p.id} value={p.id}>{p.department} — {p.gameTitle}</option>
            ))}
          </select>
          <div className="terms-preview">
            <span><b>{t.start}</b> → <b>{t.finish}</b></span>
            <span>Spaces: <i className="c-chance">{t.chance}</i> · <i className="c-noise">{t.noise}</i> · <i className="c-boost">{t.booster}</i></span>
            <span>Cards: {CARD_TYPES.map((c) => t.cards[c].label).join(' · ')}</span>
          </div>
        </div>
        <button className="btn small" onClick={() => setWording((w) => !w)}>{wording ? 'Hide' : '✎ Customise wording…'}</button>
        {wording && <WordingEditor />}
      </div>

      <div className="panel">
        <h3>2 · TEAMS &amp; ROUNDS</h3>
        <div className="row" style={{ gap: 26, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="field">
            <label>Teams (1–10)</label>
            <div className="stepper">
              <button className="btn" onClick={() => setN(n - 1)} disabled={n <= 1}>−</button>
              <b>{n}</b>
              <button className="btn" onClick={() => setN(n + 1)} disabled={n >= 10}>+</button>
            </div>
          </div>
          <div className="field">
            <label>Rounds</label>
            <div className="stepper">
              <button className="btn" onClick={() => update({ rounds: rounds - 1 })} disabled={rounds <= MIN_ROUNDS}>−</button>
              <b>{rounds}</b>
              <button className="btn" onClick={() => update({ rounds: rounds + 1 })} disabled={rounds >= MAX_ROUNDS}>+</button>
            </div>
          </div>
          <div className="field">
            <label>Winners</label>
            <div className="stepper">
              <button className="btn" onClick={() => update({ slots: slots - 1 })} disabled={slots <= 1}>−</button>
              <b>{slots}</b>
              <button className="btn" onClick={() => update({ slots: slots + 1 })} disabled={slots >= n}>+</button>
            </div>
          </div>
        </div>
        <p className="muted hint">
          {preset ? <>This map is tuned for <b>{preset.rounds} rounds</b>{rounds !== preset.rounds && <> — <a href="#/" onClick={(e) => { e.preventDefault(); update({ rounds: preset.rounds }); }}>use {preset.rounds}</a></>}. </> : null}
          Shortest route: {shortest} spaces (a team averages about 3 per round). Unfilled winner slots are decided by a fallback ranking after the last round.
        </p>
        <div className="field">
          <label>Team names — each team gets its own colour and symbol</label>
          <div className="team-inputs">
            {names.map((nm, i) => (
              <div className="team-input" key={i} style={{ borderColor: TEAM_COLORS[i] + '88' }}>
                <span className="n">{i + 1}</span>
                <TeamIcon index={i} size={26} />
                <input
                  value={nm}
                  maxLength={22}
                  onChange={(e) => {
                    const next = [...names];
                    next[i] = e.target.value;
                    update({ names: next });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="row">
          <button className="btn primary big" onClick={start}>START GAME ▶</button>
          <button className="btn ghost" onClick={() => window.open('#/projector', 'festrun-projector', 'popup,width=1280,height=720')}>Open projector window ↗</button>
        </div>
        <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
          Map: <b>{preset ? preset.name : 'custom'}</b>
          {active.isOverride && !preset && (
            <> · <a href="#/setup" onClick={(e) => { e.preventDefault(); if (window.confirm('Discard the saved map and go back to the default map?')) { clearBoardOverride(); setActive(getActiveBoard()); } }}>use default</a></>
          )}
          {' · '}
          <a href="#/map">✎ Edit map</a>
          {' · '}
          <a href="#/balancer">Board Balancer</a>
        </p>
      </div>

      <MapPresetPicker
        current={preset?.id}
        onApplied={(p, map) => {
          setActive(getActiveBoard());
          update({ rounds: p.rounds, slots: Math.min(map.rules.winnerSlots, n) });
        }}
      />

      <div className="panel wide">
        <h3>HOW TO PLAY</h3>
        <RulesList slots={slots} />
      </div>
    </div>
  );
}
