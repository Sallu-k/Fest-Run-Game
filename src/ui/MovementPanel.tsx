import { RouteId, detectClassicShape, classicNodeMeta } from '../core/classicBoard';
import { canUseCard, cardHeld, remainingOf } from '../core/engine';
import { Board, CARD_INFO } from '../core/types';
import { getTerms } from '../core/terms';
import { GameState, GameStore, coreOf, currentTeam, targetInfo, tLabel } from '../state/game';
import { routeColor } from './board/colors';
import { CardChips } from './HostDock';
import { TeamIcon } from './symbols';


function routeSpecials(board: Board, ids: string[]) {
  const c = { chance: 0, noise: 0, booster: 0 };
  for (const id of ids) {
    const idx = board.byId.get(id);
    const sp = idx != null ? board.nodes[idx].special : null;
    if (sp) c[sp.type]++;
  }
  return c;
}

/** The branch-choice prompt: reads `pending.options` directly — this is the actual, authoritative list
 *  of legal next nodes from the engine, not re-derived from the classic-shape lane helpers (that
 *  mismatch was the root cause of a click silently doing nothing). Works for any DAG shape: a classic
 *  named lane gets its usual "PATH A" treatment, anything else falls back to its raw node id. */
function RouteChoice({ s, store, board }: { s: GameState; store: GameStore; board: Board }) {
  const p = s.pending;
  if (p?.kind !== 'route') return null;
  const shape = detectClassicShape(board);
  return (
    <div className="prompt">
      <b>FORK — choose a route</b> ({p.stepsLeft} step{p.stepsLeft === 1 ? '' : 's'} left). Click a glowing space on the board or a card:
      <div className="route-opts" style={{ marginTop: 8 }}>
        {p.options.map((optId) => {
          const meta = classicNodeMeta(optId);
          const isLane = /^[A-H]$/.test(meta.lane);
          const r = isLane ? (meta.lane as RouteId) : null;
          const idx = board.byId.get(optId);
          const toGo = idx != null ? board.remaining[idx] : 0;
          const total = r && shape ? shape.routeLengths[r] : toGo;
          const rest = idx != null ? routeSpecials(board, board.succ[optId] ? [optId, ...board.succ[optId]] : [optId]) : { chance: 0, noise: 0, booster: 0 };
          return (
            <button key={optId} className="route-opt" style={{ ['--rc' as string]: r ? routeColor(r) : '#94a3b8' }} onClick={() => store.chooseRoute(optId)}>
              <div className="big">{r ? `PATH ${r}` : optId}</div>
              <div className="meta">
                {total} total · {toGo} to go<br />
                {rest.chance ? `${rest.chance}× ? ` : ''}{rest.noise ? `${rest.noise}× ${getTerms().noise.toLowerCase()} ` : ''}{rest.booster ? `${rest.booster}× ${getTerms().booster.toLowerCase()}` : ''}
                {!rest.chance && !rest.noise && !rest.booster ? 'no specials' : ''}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QuickPrompt({ s, store }: { s: GameState; store: GameStore }) {
  const p = s.pending;
  if (p?.kind !== 'quick') return null;
  return (
    <div className="prompt">
      <b>{p.special === 'chance' ? `✦ ${getTerms().chance} — ask a quick question` : `⚠ ${getTerms().noise} — ask a quick question`}</b>
      <div className="muted" style={{ margin: '4px 0 10px', fontSize: 13 }}>
        {p.special === 'chance' ? 'Correct = the team wins a card (you reveal it).' : 'Wrong = the team moves back.'}
      </div>
      <div className="row">
        <button className="btn go big" onClick={() => store.resolveQuick(true)}>✔ CORRECT</button>
        <button className="btn danger big" onClick={() => store.resolveQuick(false)}>✘ WRONG</button>
      </div>
    </div>
  );
}

/** The one-way "cancel your +N movement?" confirmation — the entire point is to make accidental card
 *  use impossible, since confirming here permanently forfeits the team's registered movement. */
function CardConfirmPrompt({ s, store }: { s: GameState; store: GameStore }) {
  const p = s.pending;
  if (p?.kind !== 'cardConfirm') return null;
  return (
    <div className="prompt card-confirm">
      <b>USE {CARD_INFO[p.card].label}?</b>
      <div className="cancel-flow">
        <div><small>REGISTERED MOVE</small><b>+{p.registeredSteps}</b></div>
        <div className="arrow">→</div>
        <div><small>CARD USED</small><b>{CARD_INFO[p.card].label}</b></div>
        <div className="arrow">→</div>
        <div><small>FINAL MOVE</small><b className="warn">0</b></div>
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>Using this card will cancel your +{p.registeredSteps} movement. This cannot be undone once confirmed.</p>
      <div className="row">
        <button className="btn danger" onClick={() => store.confirmCardUse()}>CONFIRM</button>
        <button className="btn small" onClick={() => store.cancelCardUse()}>CANCEL</button>
      </div>
    </div>
  );
}

function TargetPrompt({ s, store }: { s: GameState; store: GameStore }) {
  const p = s.pending;
  if (p?.kind !== 'target') return null;
  const targets = targetInfo(s);
  return (
    <div className="prompt">
      <b>{CARD_INFO[p.card].label} — pick a target</b> (click a red-ringed team on the board or below)
      <div className="target-list" style={{ marginTop: 8 }}>
        {targets.map((t) => (
          <button key={t.team.id} className="target-row" onClick={() => store.pickTarget(t.team.id)}>
            <TeamIcon index={t.team.id - 1} size={24} />
            <b>T{t.team.id}</b> {t.team.name}
            <span className="muted">· {t.team.node} · {t.dist} away</span>
            {t.shielded && <span className="card-chip held">ORTH</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function OrthPrompt({ s, store }: { s: GameState; store: GameStore }) {
  const p = s.pending;
  if (p?.kind !== 'orth') return null;
  const attacker = s.teams.find((t) => t.id === p.teamId)!;
  const defender = s.teams.find((t) => t.id === p.targetId)!;
  return (
    <div className="prompt">
      <b>{tLabel(defender)} holds {CARD_INFO.orth.label}</b>
      <div className="muted" style={{ margin: '4px 0 10px', fontSize: 13 }}>
        Block {tLabel(attacker)}'s {CARD_INFO[p.card].label}? Both cards are consumed if blocked.
      </div>
      <div className="row">
        <button className="btn go big" onClick={() => store.resolveOrth(true)}>🛡 BLOCK</button>
        <button className="btn danger big" onClick={() => store.resolveOrth(false)}>LET IT THROUGH</button>
      </div>
    </div>
  );
}

/** TEAM_MOVING and its sub-states (PATH_DECISION / SPECIAL_RESOLUTION / CARD_DECISION are all values of
 *  `pending`'s discriminant here) plus TEAM_TURN_COMPLETE. MOVE and USE CARD are rendered as a single
 *  mutually-exclusive choice — never both available at once. */
export function MovementPanel({ s, store, board }: { s: GameState; store: GameStore; board: Board }) {
  const m = s.mover;
  const team = currentTeam(s);
  if (!m || !team) return null;
  const core = coreOf(s);
  const toGo = remainingOf(board, team);

  return (
    <>
      <div className="qc">
        <div className="turn-head" style={{ ['--tc' as string]: team.color }}>
          <TeamIcon index={team.id - 1} size={38} />
          <div style={{ minWidth: 0 }}>
            <div className="nm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>T{team.id} · {team.name}</div>
            <div className="sub">on {team.node} · {toGo} to {getTerms().finish.toLowerCase()} · movement {s.movementIdx + 1}/{s.movementOrder.length}</div>
          </div>
        </div>

        {m.decision === 'pending' && !s.pending && (
          <>
            <div className="move-badge solo" style={{ ['--tc' as string]: team.color }}>
              <span className="lbl">REGISTERED MOVE</span>
              <span className="plus big">+{m.stepsLeft}</span>
            </div>
            <div className="qc-grid">
              <button className="btn go big wide" onClick={() => store.chooseToMove()}>
                {m.stepsLeft > 0 ? `MOVE +${m.stepsLeft} →` : 'STAY (0 spaces)'}
              </button>
            </div>
            <div className="qc-label">Or use a card instead — this forfeits the +{m.stepsLeft} above</div>
            <div className="row">
              {(['isi', 'hop'] as const).map((c) => {
                if (!cardHeld(team, c)) return null;
                const usable = canUseCard(core, team, c);
                return (
                  <button key={c} className="btn small danger" disabled={!usable} onClick={() => store.chooseToUseCard(c)} title={usable ? undefined : 'A card earned this turn cannot be used until next turn.'}>
                    Use {CARD_INFO[c].label}
                  </button>
                );
              })}
              {!cardHeld(team, 'isi') && !cardHeld(team, 'hop') && <span className="muted" style={{ fontSize: 12 }}>No usable cards.</span>}
            </div>
          </>
        )}

        <RouteChoice s={s} store={store} board={board} />
        <QuickPrompt s={s} store={store} />
        <CardConfirmPrompt s={s} store={store} />
        <TargetPrompt s={s} store={store} />
        <OrthPrompt s={s} store={store} />

        {s.roundPhase === 'TEAM_TURN_COMPLETE' && (
          <>
            <div className="ok-text" style={{ fontSize: 15, fontWeight: 800, margin: '8px 0' }}>✔ {tLabel(team)}'S TURN COMPLETE</div>
            <button className="btn primary big wide" onClick={() => store.nextTeamMove()}>NEXT TEAM ▶</button>
          </>
        )}

        <div className="kv" style={{ marginTop: 10 }}>
          <span>Cards</span><CardChips t={team} />
        </div>
      </div>
    </>
  );
}
