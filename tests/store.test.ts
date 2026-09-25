import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameStore, GameState, getBoard } from '../src/state/game';
import { Rng } from '../src/core/rng';
import { cardHeld } from '../src/core/engine';
import { CARD_INFO } from '../src/core/types';
import { classicNodeMeta, compileClassicBoard } from '../src/core/classicBoard';
import { CHOSEN_BOARD, CHOSEN_RULES } from '../src/data/chosenBoard';
import { maxSlots } from '../src/core/engine';
import { coreOf } from '../src/state/game';

const COMPILED = compileClassicBoard(CHOSEN_BOARD);
const ROUTE_LANES = ['A', 'B', 'C'];

function newStore(n: number, rounds: number) {
  const store = new GameStore('host', { cfg: COMPILED, rules: CHOSEN_RULES }, { sync: false });
  store.setSetup(Array.from({ length: n }, (_, i) => `Team ${i + 1}`), rounds);
  store.startGame(COMPILED, CHOSEN_RULES);
  return store;
}

function checkInvariants(s: GameState) {
  const board = getBoard(s.boardCfg);
  const slots = new Set<number>();
  for (const t of s.teams) {
    assert.ok(board.byId.has(t.node), `unknown node ${t.node}`);
    assert.equal(t.trail[t.trail.length - 1], t.node, 'trail must end at the current node');
    assert.equal(t.trail[0], board.idOf[board.tx], 'trail must start at the Transmitter');
    if (t.status === 'qualified') {
      assert.ok(t.slot >= 1 && t.slot <= 5);
      assert.ok(!slots.has(t.slot), 'slot used twice');
      slots.add(t.slot);
      assert.equal(t.node, board.idOf[board.rx]);
    }
    for (let i = 0; i < 3; i++) assert.ok([0, 1, 2].includes(t.cards[i]));
  }
  assert.equal(new Set(s.qualifiers).size, s.qualifiers.length);
  assert.ok(s.qualifiers.length <= maxSlots(coreOf(s)) + 0);
  // the two structural rules from the card-timing / next-team rewrite:
  if (s.mover) {
    assert.ok(['pending', 'move', 'card'].includes(s.mover.decision));
    if (s.mover.decision === 'card') assert.equal(s.registeredMoves[s.mover.teamId]?.steps, 0, 'card use must zero the registered movement');
  }
}

const targetIdsFor = (s: GameState): number[] => {
  const pending = s.pending;
  if (pending?.kind !== 'target') return [];
  const board = getBoard(s.boardCfg);
  const attacker = s.teams.find((t) => t.id === pending.teamId)!;
  const n = board.nodes.length;
  const a = board.byId.get(attacker.node)!;
  return s.teams
    .filter((t) => {
      if (t.id === attacker.id || t.status !== 'active') return false;
      const b = board.byId.get(t.node)!;
      const d = board.dist[a * n + b];
      if (pending.card === 'isi') return t.node !== board.idOf[board.tx] && d >= 0 && d <= s.rules.isiRange;
      return t.node !== attacker.node;
    })
    .map((t) => t.id);
};

/** Drives one whole round (rapid fire -> buffer -> confirm -> movement -> round complete), always
 *  choosing MOVE (never a card), auto-picking the first offered route and always answering quick
 *  questions correctly. Used by tests that just need a round to be over quickly and deterministically. */
function runFullRound(store: GameStore, correctFor: (teamId: number) => number) {
  store.startRapidFire();
  store.startAnswerBuffer();
  store.startResultConfirm();
  for (const t of store.get().teams) if (t.status === 'active') store.enterResult(t.id, correctFor(t.id));
  store.confirmResults();
  store.beginMovement();
  let guard = 0;
  while (store.get().roundPhase !== 'ROUND_COMPLETE') {
    if (guard++ > 500) throw new Error('runFullRound stuck');
    const s = store.get();
    if (s.roundPhase === 'TEAM_TURN_COMPLETE') {
      store.nextTeamMove();
      continue;
    }
    const p = s.pending;
    if (p?.kind === 'route') {
      store.chooseRoute(p.options[0]);
      continue;
    }
    if (p?.kind === 'quick') {
      store.resolveQuick(true);
      continue;
    }
    store.chooseToMove();
  }
}

/** A bot host that plays a whole game through the public store API. */
function botPlay(store: GameStore, seed: number, opts: { useCards?: boolean } = {}) {
  const rng = new Rng(seed);
  let guard = 0;
  let cardsUsed = 0;
  let ortho = 0;
  for (;;) {
    if (guard++ > 8000) throw new Error('bot stuck');
    const s = store.get();
    checkInvariants(s);
    if (s.phase === 'finished') return { s, cardsUsed, ortho };
    if (s.phase === 'fallback') {
      store.applyFallback();
      const after = store.get();
      if (after.phase === 'fallback') {
        const tie = after.teams.filter((t) => t.status === 'active');
        for (const t of tie) {
          const before = store.get().qualifiers.length;
          store.suddenDeathWinner(t.id);
          if (store.get().qualifiers.length > before) break;
        }
      }
      continue;
    }
    switch (s.roundPhase) {
      case 'ROUND_READY':
        store.startRapidFire();
        continue;
      case 'RAPID_FIRE':
        store.startAnswerBuffer();
        continue;
      case 'ANSWER_BUFFER':
        store.startResultConfirm();
        continue;
      case 'RESULT_CONFIRM':
        for (const t of s.teams) if (t.status === 'active') store.enterResult(t.id, rng.int(7));
        store.confirmResults();
        continue;
      case 'MOVEMENT_READY':
        store.beginMovement();
        continue;
      case 'ROUND_COMPLETE':
        store.proceedRound();
        continue;
      case 'GAME_COMPLETE':
        continue;
      case 'TEAM_TURN_COMPLETE':
        store.nextTeamMove();
        continue;
    }
    const p = s.pending;
    if (p) {
      if (p.kind === 'route') store.chooseRoute(p.options[rng.int(p.options.length)]);
      else if (p.kind === 'quick') store.resolveQuick(rng.next() < 0.6);
      else if (p.kind === 'cardConfirm') {
        store.confirmCardUse();
        cardsUsed++;
      } else if (p.kind === 'target') {
        const targets = targetIdsFor(s);
        if (targets.length) store.pickTarget(targets[rng.int(targets.length)]);
        else store.cancelPending();
      } else if (p.kind === 'orth') {
        ortho++;
        store.resolveOrth(rng.next() < 0.7);
      }
      continue;
    }
    // mover.decision === 'pending', nothing pending: choose MOVE or (sometimes) a card — never both.
    const m = s.mover!;
    if (opts.useCards && rng.next() < 0.3) {
      const team = s.teams.find((t) => t.id === m.teamId)!;
      const preferIsi = cardHeld(team, 'isi');
      const preferHop = cardHeld(team, 'hop');
      if (preferIsi || preferHop) {
        store.chooseToUseCard(preferIsi && (!preferHop || rng.next() < 0.5) ? 'isi' : 'hop');
        continue;
      }
    }
    store.chooseToMove();
  }
}

test('bot-played games always end with exactly min(5, teams) unique qualifiers (4 and 5 rounds, 1–10 teams)', () => {
  let games = 0;
  for (const n of [1, 2, 3, 5, 6, 8, 10]) {
    for (const rounds of [4, 5] as const) {
      for (let seed = 1; seed <= 12; seed++) {
        const store = newStore(n, rounds);
        const { s } = botPlay(store, seed * 101 + n, { useCards: true });
        assert.equal(s.qualifiers.length, Math.min(5, n), `n=${n} rounds=${rounds} seed=${seed}`);
        assert.equal(s.teams.filter((t) => t.status === 'qualified').length, Math.min(5, n));
        games++;
      }
    }
  }
  assert.ok(games > 100);
});

test('cards and ORTH prompts occur in bot games and never break invariants', () => {
  let used = 0;
  let ortho = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const store = newStore(10, 5);
    const r = botPlay(store, seed * 7, { useCards: true });
    used += r.cardsUsed;
    ortho += r.ortho;
  }
  assert.ok(used > 0, 'no card was ever used in 60 games');
  console.log(`   (cards used: ${used}, orth prompts: ${ortho})`);
});

test('movement order rotates by 2 each round and qualified teams are skipped', () => {
  const store = newStore(10, 5);
  assert.deepEqual(store.get().movementOrder, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  runFullRound(store, () => 0);
  assert.equal(store.get().roundPhase, 'ROUND_COMPLETE');
  store.proceedRound();
  assert.equal(store.get().round, 2);
  assert.deepEqual(store.get().movementOrder, [3, 4, 5, 6, 7, 8, 9, 10, 1, 2]);
  assert.equal(store.get().roundPhase, 'ROUND_READY');
});

test('undo restores the previous positions and mover state', () => {
  const store = newStore(4, 5);
  store.startRapidFire();
  store.startAnswerBuffer();
  store.startResultConfirm();
  for (const t of store.get().teams) store.enterResult(t.id, 3);
  store.confirmResults();
  store.beginMovement();
  const before = JSON.stringify(store.get().teams);
  const moverBefore = JSON.stringify(store.get().mover);
  store.chooseToMove();
  const moved = store.get();
  assert.notEqual(JSON.stringify(moved.teams), before);
  store.undo();
  assert.equal(JSON.stringify(store.get().teams), before);
  assert.equal(JSON.stringify(store.get().mover), moverBefore);
  assert.match(store.get().log.at(-1)!.text, /UNDO/);
  // undo through every undoable action back to the last non-undoable phase transition (RESULT_CONFIRM
  // was entered via a non-undoable startResultConfirm(), matching how startTimer() worked before).
  let n = 0;
  while (store.canUndo() && n++ < 30) store.undo();
  assert.equal(store.get().roundPhase, 'RESULT_CONFIRM');
});

test('an unusable card action is rejected with a message and changes nothing', () => {
  const store = newStore(3, 5);
  store.startRapidFire();
  store.startAnswerBuffer();
  store.startResultConfirm();
  for (const t of store.get().teams) store.enterResult(t.id, 3);
  store.confirmResults();
  store.beginMovement();
  const before = JSON.stringify(store.get().teams);
  store.chooseToUseCard('isi');
  assert.equal(JSON.stringify(store.get().teams), before);
  assert.ok(store.get().message);
  assert.equal(store.get().pending, null);
});

test('host-given cards are usable at once; HOP needs a team on a different space, and using it forfeits the registered movement', () => {
  const store = newStore(3, 5);
  store.giveCard(1, 'hop');
  store.setPosition(2, 'A5');
  store.startRapidFire();
  store.startAnswerBuffer();
  store.startResultConfirm();
  for (const t of store.get().teams) store.enterResult(t.id, 4);
  store.confirmResults();
  store.beginMovement();
  assert.equal(store.get().mover?.teamId, 1);
  store.chooseToUseCard('hop'); // T1 and T3 are both on TX: only T2 (moved to A5) is a valid target
  assert.equal(store.get().pending?.kind, 'cardConfirm');
  store.confirmCardUse();
  assert.equal(store.get().registeredMoves[1].steps, 0, 'movement forfeited on card confirm');
  assert.equal(store.get().pending?.kind, 'target');
  store.pickTarget(2);
  const t1 = store.get().teams[0];
  const t2 = store.get().teams[1];
  assert.equal(t1.node, 'A5');
  assert.equal(t2.node, 'TX');
  assert.equal(t1.cards[1], 2, 'HOP consumed');
  assert.equal(store.get().roundPhase, 'TEAM_TURN_COMPLETE');
  store.nextTeamMove();
  store.chooseToUseCard('isi');
  assert.match(store.get().message ?? '', /does not hold/i);
});

test('ISI against a team holding ORTHOGONALITY prompts the host; blocking spends both cards and never moves the attacker', () => {
  const store = newStore(3, 5);
  store.setPosition(1, 'A5');
  store.setPosition(2, 'A6');
  store.giveCard(1, 'isi');
  store.giveCard(2, 'orth');
  store.startRapidFire();
  store.startAnswerBuffer();
  store.startResultConfirm();
  for (const t of store.get().teams) store.enterResult(t.id, 3);
  store.confirmResults();
  store.beginMovement();
  assert.equal(store.get().mover?.teamId, 1);
  store.chooseToUseCard('isi');
  store.confirmCardUse();
  store.pickTarget(2);
  assert.equal(store.get().pending?.kind, 'orth');
  store.resolveOrth(true);
  const s = store.get();
  assert.equal(s.teams[1].node, 'A6', 'target did not move');
  assert.equal(s.teams[0].node, 'A5', 'attacker did not move either — using a card never moves the user');
  assert.equal(s.teams[0].cards[0], 2);
  assert.equal(s.teams[1].cards[2], 2);
  assert.ok(s.log.some((l) => /BLOCKED/.test(l.text)));
  assert.ok(s.log.some((l) => l.text.includes(CARD_INFO.orth.label)));
  // declining the block lets ISI through
  const store2 = newStore(3, 5);
  store2.setPosition(1, 'A5');
  store2.setPosition(2, 'A6');
  store2.giveCard(1, 'isi');
  store2.giveCard(2, 'orth');
  store2.startRapidFire();
  store2.startAnswerBuffer();
  store2.startResultConfirm();
  for (const t of store2.get().teams) store2.enterResult(t.id, 3);
  store2.confirmResults();
  store2.beginMovement();
  store2.chooseToUseCard('isi');
  store2.confirmCardUse();
  store2.pickTarget(2);
  store2.resolveOrth(false);
  const s2 = store2.get();
  assert.equal(s2.teams[1].node, 'A4');
  assert.equal(s2.teams[1].cards[2], 1, 'ORTH kept');
});

test('using a card is mutually exclusive with moving: MOVE and USE CARD can never both apply to the same turn', () => {
  const store = newStore(3, 5);
  store.giveCard(1, 'isi');
  store.setPosition(2, 'S2'); // within ISI range of TX
  store.startRapidFire();
  store.startAnswerBuffer();
  store.startResultConfirm();
  for (const t of store.get().teams) store.enterResult(t.id, 5);
  store.confirmResults();
  store.beginMovement();
  assert.equal(store.get().mover?.teamId, 1);
  assert.equal(store.get().registeredMoves[1].steps, 5);
  store.chooseToUseCard('isi');
  store.confirmCardUse();
  // once decision has committed to 'card', chooseToMove must be structurally unreachable this turn
  store.chooseToMove();
  assert.notEqual(store.get().mover?.decision, 'move');
  store.pickTarget(2);
  const t1 = store.get().teams[0];
  assert.equal(t1.node, 'TX', 'the +5 registered movement was never applied');
  assert.equal(store.get().registeredMoves[1].steps, 0);
});

test('chooseRoute rejects an option that is not in the pending route\'s option list', () => {
  const store = newStore(3, 5);
  // find how many steps reach one node PAST the classic board's fork — landing exactly on the fork
  // itself never needs a decision (the choice is only needed to leave it), so it takes fork-distance+1.
  const board = getBoard(store.get().boardCfg);
  const forkId = board.nodes.find((n) => board.succ[n.id].length > 1)!.id;
  const steps = board.dist[board.tx * board.nodes.length + board.byId.get(forkId)!] + 1;
  store.startRapidFire();
  store.startAnswerBuffer();
  store.startResultConfirm();
  for (const t of store.get().teams) store.enterResult(t.id, t.id === 1 ? steps : 0);
  store.confirmResults();
  store.beginMovement();
  store.chooseToMove();
  const p = store.get().pending;
  assert.equal(p?.kind, 'route');
  const before = JSON.stringify(store.get().teams);
  store.chooseRoute('not-a-real-node-id');
  assert.equal(JSON.stringify(store.get().teams), before, 'a bogus option must not silently move anyone');
  assert.ok(store.get().message);
  assert.equal(store.get().pending?.kind, 'route', 'still waiting on a valid choice');
});

test('a Chance space grants its card, revealed to the host, held by the team afterward', () => {
  const store = newStore(3, 5);
  const board = getBoard(store.get().boardCfg);
  const chance = board.nodes.find((n) => n.special?.type === 'chance' && ROUTE_LANES.includes(classicNodeMeta(n.id).lane))!;
  const before = board.nodes.find((n) => n.id === `${chance.id[0]}${Number(chance.id.slice(1)) - 2}`)!;
  store.setPosition(1, before.id);
  store.startRapidFire();
  store.startAnswerBuffer();
  store.startResultConfirm();
  for (const t of store.get().teams) store.enterResult(t.id, t.id === 1 ? 2 : 0);
  store.confirmResults();
  store.beginMovement();
  assert.equal(store.get().mover?.teamId, 1);
  store.chooseToMove();
  assert.equal(store.get().pending?.kind, 'quick');
  store.resolveQuick(true);
  const s = store.get();
  assert.ok(s.reveal, 'card reveal pending');
  const idx = { isi: 0, hop: 1, orth: 2 }[chance.special!.card!];
  assert.equal(s.teams[0].cards[idx], 1);
  assert.equal(s.roundPhase, 'TEAM_TURN_COMPLETE');
});

test('the log carries timestamps, team, action and old/new positions', () => {
  const store = newStore(3, 5);
  store.startRapidFire();
  store.startAnswerBuffer();
  store.startResultConfirm();
  for (const t of store.get().teams) store.enterResult(t.id, 2);
  store.confirmResults();
  store.beginMovement();
  store.chooseToMove();
  const e = store.get().log.filter((l) => l.kind === 'move').at(-1)!;
  assert.ok(e.ts > 0 && e.teamId === 1 && e.from === 'TX' && e.to);
});

import { defaultLayout } from '../src/core/mapLayout';
import { renderWorld } from '../src/state/game';
import { detectClassicShape } from '../src/core/classicBoard';

test('the map layout is snapshotted at START GAME and is purely cosmetic for the rules', () => {
  const board = getBoard(COMPILED);
  const layout = defaultLayout(board);
  layout.nodePos.A2 = { x: 999, y: 111 }; // a custom drag position
  const store = new GameStore('host', { cfg: COMPILED, rules: CHOSEN_RULES }, { sync: false });
  store.setSetup(['a', 'b', 'c'], 5);
  store.startGame(COMPILED, CHOSEN_RULES, layout);
  const s = store.get();
  assert.deepEqual(s.layout?.nodePos.A2, { x: 999, y: 111 });
  const w = renderWorld(s);
  assert.equal(w.board.nodes[w.board.byId.get('A2')!].x, 999);
  // same graph, same distances, same route lengths regardless of layout
  assert.deepEqual(Array.from(w.board.dist), Array.from(board.dist));
  assert.deepEqual(detectClassicShape(w.board)?.routeLengths, { A: 15, B: 16, C: 19 });
  // game play is identical with and without a custom layout
  const plain = new GameStore('host', { cfg: COMPILED, rules: CHOSEN_RULES }, { sync: false });
  plain.setSetup(['a', 'b', 'c'], 5);
  plain.startGame(COMPILED, CHOSEN_RULES);
  for (const st of [store, plain]) runFullRound(st, () => 4);
  assert.deepEqual(store.get().teams.map((t) => t.node), plain.get().teams.map((t) => t.node));
});

test('visual effect cues are emitted for cards, boosters and qualification without touching the rules', () => {
  const store = newStore(4, 5);
  store.setPosition(1, 'A4');
  store.setPosition(2, 'A5');
  store.giveCard(1, 'isi');
  store.startRapidFire();
  store.startAnswerBuffer();
  store.startResultConfirm();
  for (const t of store.get().teams) store.enterResult(t.id, 0);
  store.confirmResults();
  store.beginMovement();
  assert.equal(store.get().mover?.teamId, 1);
  store.chooseToUseCard('isi');
  store.confirmCardUse();
  store.pickTarget(2);
  const fx = store.get().lastMove?.fx ?? [];
  assert.ok(fx.some((f) => f.kind === 'isi' && f.team === 1 && f.target === 2));
  // qualification cue
  store.setPosition(3, 'RX');
  assert.ok((store.get().lastMove?.fx ?? []).some((f) => f.kind === 'qualify' && f.team === 3 && f.slot === 1));
});
