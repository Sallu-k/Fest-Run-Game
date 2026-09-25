// Wording packs ("themes") — what the start, the finish, the special spaces and the three cards are
// CALLED. The rules never change between packs: a Noise space always pushes back, a Booster always
// jumps forward, the first card always hits a nearby team, and so on. That is what lets one game serve
// an ECE fest ("Transmitter → Receiver, ISI, Frequency Hop"), a CSE fest ("Hello World → Production,
// Merge Conflict, Context Switch") or any other event.
//
// Pure data + a module-level "active pack" so non-React code (the event log in state/game.ts, the card
// captions) can read the current wording. The host's choice is stored with the view preferences in
// state/mapStore.ts, which calls setActiveTerms() and syncs it to the projector window.

import type { CardType } from './types';

export interface CardTerms {
  /** Big name on the card, e.g. "FREQUENCY HOP". */
  label: string;
  /** Longer name, e.g. "Frequency Hop". */
  short: string;
  /** 3–4 letter chip, e.g. "HOP". */
  abbr: string;
}

export interface Terms {
  id: string;
  /** Shown in the pack picker, e.g. "Electronics & Communication". */
  department: string;
  /** Default game title, e.g. "SIGNAL RUN". */
  gameTitle: string;
  start: string;
  finish: string;
  /** The special spaces. */
  chance: string;
  noise: string;
  booster: string;
  cards: Record<CardType, CardTerms>;
  /** Heading of the answer phase, e.g. "SIGNAL RAPID FIRE". */
  rapidFire: string;
  /** Status under the active team's name plate, e.g. "SIGNAL ACTIVE". */
  active: string;
  /** Banner when the first slot is filled, e.g. "SIGNAL LOCKED". */
  firstLocked: string;
  /** Banner when every slot is filled, e.g. "SIGNAL COMPLETE". */
  allLocked: string;
}

/** What each card and special space DOES — the same in every pack, because the rules are the same. */
export const CARD_EFFECT: Record<CardType, string> = {
  isi: 'Hit a nearby team: they move back 2 spaces.',
  hop: 'Swap positions with any active team. One use.',
  orth: 'Block one card used against your team. One use.',
};
export const SPECIAL_EFFECT = {
  chance: 'answer a quick question; if right, win a secret card.',
  noise: 'answer a quick question; if wrong, slip backward.',
  booster: 'jump forward automatically.',
} as const;

const card = (label: string, short: string, abbr: string): CardTerms => ({ label, short, abbr });

export const TERM_PACKS: Terms[] = [
  {
    id: 'general',
    department: 'General / any event',
    gameTitle: 'QUIZ RACE',
    start: 'START',
    finish: 'FINISH',
    chance: 'MYSTERY',
    noise: 'TRAP',
    booster: 'BOOST',
    cards: { isi: card('PUSH BACK', 'Push Back', 'PUSH'), hop: card('SWAP', 'Swap', 'SWAP'), orth: card('SHIELD', 'Shield', 'SHLD') },
    rapidFire: 'RAPID FIRE',
    active: 'ON THE MOVE',
    firstLocked: 'FIRST PLACE',
    allLocked: 'RACE COMPLETE',
  },
  {
    id: 'ece',
    department: 'Electronics & Communication (ECE)',
    gameTitle: 'SIGNAL RUN',
    start: 'TRANSMITTER',
    finish: 'RECEIVER',
    chance: 'CHANCE',
    noise: 'NOISE',
    booster: 'SIGNAL BOOSTER',
    cards: {
      isi: card('ISI', 'Inter-Symbol Interference', 'ISI'),
      hop: card('FREQUENCY HOP', 'Frequency Hop', 'HOP'),
      orth: card('ORTHOGONALITY', 'Orthogonality', 'ORTH'),
    },
    rapidFire: 'SIGNAL RAPID FIRE',
    active: 'SIGNAL ACTIVE',
    firstLocked: 'SIGNAL LOCKED',
    allLocked: 'SIGNAL COMPLETE',
  },
  {
    id: 'cse',
    department: 'Computer Science / IT (CSE)',
    gameTitle: 'CODE RUSH',
    start: 'HELLO WORLD',
    finish: 'PRODUCTION',
    chance: 'EASTER EGG',
    noise: 'BUG',
    booster: 'CACHE HIT',
    cards: {
      isi: card('MERGE CONFLICT', 'Merge Conflict', 'MRG'),
      hop: card('CONTEXT SWITCH', 'Context Switch', 'CTX'),
      orth: card('FIREWALL', 'Firewall', 'FW'),
    },
    rapidFire: 'CODE RAPID FIRE',
    active: 'COMPILING',
    firstLocked: 'DEPLOYED',
    allLocked: 'ALL SYSTEMS LIVE',
  },
  {
    id: 'eee',
    department: 'Electrical & Electronics (EEE)',
    gameTitle: 'POWER GRID',
    start: 'GENERATOR',
    finish: 'CITY GRID',
    chance: 'JUNCTION BOX',
    noise: 'SHORT CIRCUIT',
    booster: 'POWER SURGE',
    cards: {
      isi: card('VOLTAGE DROP', 'Voltage Drop', 'VDRP'),
      hop: card('PHASE SWAP', 'Phase Swap', 'PHSE'),
      orth: card('CIRCUIT BREAKER', 'Circuit Breaker', 'CB'),
    },
    rapidFire: 'POWER RAPID FIRE',
    active: 'LIVE WIRE',
    firstLocked: 'POWERED UP',
    allLocked: 'GRID ONLINE',
  },
  {
    id: 'mech',
    department: 'Mechanical / Automobile',
    gameTitle: 'GEAR GRAND PRIX',
    start: 'PIT LANE',
    finish: 'CHEQUERED FLAG',
    chance: 'TOOLBOX',
    noise: 'BREAKDOWN',
    booster: 'TURBO',
    cards: {
      isi: card('OIL SLICK', 'Oil Slick', 'OIL'),
      hop: card('GEAR SHIFT', 'Gear Shift', 'GEAR'),
      orth: card('ROLL CAGE', 'Roll Cage', 'CAGE'),
    },
    rapidFire: 'PIT-STOP RAPID FIRE',
    active: 'ENGINE RUNNING',
    firstLocked: 'FIRST ACROSS',
    allLocked: 'RACE COMPLETE',
  },
  {
    id: 'civil',
    department: 'Civil / Architecture',
    gameTitle: 'SKYLINE BUILDERS',
    start: 'FOUNDATION',
    finish: 'SKYLINE',
    chance: 'BLUEPRINT',
    noise: 'LANDSLIDE',
    booster: 'EXPRESSWAY',
    cards: {
      isi: card('ROADBLOCK', 'Roadblock', 'BLOK'),
      hop: card('DETOUR', 'Detour', 'DTR'),
      orth: card('RETAINING WALL', 'Retaining Wall', 'WALL'),
    },
    rapidFire: 'SITE RAPID FIRE',
    active: 'ON SITE',
    firstLocked: 'TOPPED OUT',
    allLocked: 'CITY COMPLETE',
  },
  {
    id: 'bio',
    department: 'Biotech / Chemical',
    gameTitle: 'LAB TO CURE',
    start: 'LAB BENCH',
    finish: 'BREAKTHROUGH',
    chance: 'MYSTERY SAMPLE',
    noise: 'CONTAMINATION',
    booster: 'CATALYST',
    cards: {
      isi: card('MUTATION', 'Mutation', 'MUT'),
      hop: card('GENE SWAP', 'Gene Swap', 'GENE'),
      orth: card('ANTIBODY', 'Antibody', 'ANTI'),
    },
    rapidFire: 'LAB RAPID FIRE',
    active: 'REACTING',
    firstLocked: 'DISCOVERED',
    allLocked: 'CURE FOUND',
  },
  {
    id: 'aero',
    department: 'Aerospace / Space',
    gameTitle: 'ORBIT RUN',
    start: 'LAUNCH PAD',
    finish: 'ORBIT',
    chance: 'SUPPLY POD',
    noise: 'SPACE DEBRIS',
    booster: 'GRAVITY ASSIST',
    cards: {
      isi: card('SOLAR FLARE', 'Solar Flare', 'FLR'),
      hop: card('WORMHOLE', 'Wormhole', 'WORM'),
      orth: card('DEFLECTOR SHIELD', 'Deflector Shield', 'SHLD'),
    },
    rapidFire: 'MISSION RAPID FIRE',
    active: 'IN FLIGHT',
    firstLocked: 'ORBIT REACHED',
    allLocked: 'MISSION COMPLETE',
  },
  {
    id: 'ai',
    department: 'AI / Data Science',
    gameTitle: 'MODEL MARATHON',
    start: 'RAW DATA',
    finish: 'DEPLOYMENT',
    chance: 'HIDDEN LAYER',
    noise: 'OVERFITTING',
    booster: 'GPU BOOST',
    cards: {
      isi: card('ADVERSARIAL ATTACK', 'Adversarial Attack', 'ADV'),
      hop: card('TRANSFER LEARNING', 'Transfer Learning', 'XFER'),
      orth: card('REGULARIZATION', 'Regularization', 'REG'),
    },
    rapidFire: 'TRAINING RAPID FIRE',
    active: 'TRAINING',
    firstLocked: 'CONVERGED',
    allLocked: 'ALL MODELS SHIPPED',
  },
];

export const DEFAULT_TERMS_ID = 'general';

export function termPack(id: string): Terms {
  return TERM_PACKS.find((p) => p.id === id) ?? TERM_PACKS[0];
}

/** The pack with the host's own edits laid over it (the "Customise wording" form). */
export function resolveTerms(id: string, custom?: Partial<Terms> | null): Terms {
  const base = termPack(id);
  if (!custom) return base;
  const clean = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'string' && v.trim() !== '')) as Partial<T>;
  const cards = { ...base.cards };
  for (const c of Object.keys(cards) as CardType[]) cards[c] = { ...cards[c], ...clean(custom.cards?.[c] ?? {}) };
  const { cards: _ignored, ...rest } = custom;
  return { ...base, ...clean(rest), cards, id: base.id, department: base.department };
}

let active: Terms = termPack(DEFAULT_TERMS_ID);

export function getTerms(): Terms {
  return active;
}

export function setActiveTerms(t: Terms) {
  active = t;
}
