import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERM_PACKS, getTerms, resolveTerms, setActiveTerms, termPack } from '../src/core/terms';
import { CARD_INFO, CARD_TYPES } from '../src/core/types';

test('every wording pack names everything, with a unique id', () => {
  assert.equal(new Set(TERM_PACKS.map((p) => p.id)).size, TERM_PACKS.length);
  for (const p of TERM_PACKS) {
    for (const [k, v] of Object.entries(p)) if (typeof v === 'string') assert.ok(v.trim(), `${p.id}.${k} is empty`);
    for (const c of CARD_TYPES) {
      const card = p.cards[c];
      assert.ok(card.label && card.short && card.abbr, `${p.id}: card ${c} incomplete`);
      assert.ok(card.abbr.length <= 4, `${p.id}: ${c} chip "${card.abbr}" is longer than 4 letters`);
    }
  }
});

test('custom wording overrides only the fields that were filled in', () => {
  const t = resolveTerms('ece', { finish: 'BASE STATION', noise: '  ', cards: { hop: { label: 'CHANNEL SWAP' } } as never });
  assert.equal(t.finish, 'BASE STATION');
  assert.equal(t.noise, 'NOISE', 'blank keeps the pack word');
  assert.equal(t.cards.hop.label, 'CHANNEL SWAP');
  assert.equal(t.cards.hop.abbr, 'HOP');
  assert.equal(t.cards.isi.label, 'ISI');
  assert.equal(termPack('nope').id, TERM_PACKS[0].id, 'unknown pack falls back to the first');
});

test('card names follow the active pack; card effects do not change', () => {
  const before = getTerms();
  try {
    setActiveTerms(termPack('cse'));
    assert.equal(CARD_INFO.isi.label, 'MERGE CONFLICT');
    const cseText = CARD_INFO.isi.text;
    setActiveTerms(termPack('ece'));
    assert.equal(CARD_INFO.isi.label, 'ISI');
    assert.equal(CARD_INFO.isi.text, cseText);
  } finally {
    setActiveTerms(before);
  }
});
