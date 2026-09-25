// Persistence for the visual side of the game: the saved Map Configuration (board + rules + layout),
// named map slots, and view preferences (map style, camera follow, calm mode, dock state).
// Everything lives in localStorage — no server, no database.

import { buildBoard } from '../core/board';
import { ClassicBoardConfig, compileClassicBoard } from '../core/classicBoard';
import { MapConfiguration, newMap } from '../core/mapEdit';
import { defaultLayout, ensureLayout } from '../core/mapLayout';
import { CHOSEN_BOARD, CHOSEN_RULES } from '../data/chosenBoard';
import { CUSTOM_BOARD } from '../data/customBoard';
import { DEFAULT_TERMS_ID, Terms, resolveTerms, setActiveTerms } from '../core/terms';

const MAP_KEY = 'festrun.map.v1';
const LEGACY_KEY = 'festrun.boardOverride.v1';
const SLOTS_KEY = 'festrun.mapslots.v1';
const VIEW_KEY = 'festrun.view.v1';
const VIEW_BC = 'festrun-view';

export type MapSource = 'saved-map' | 'custom-file' | 'recommended';

/** The map used for new games: saved map → customBoard.ts → the simulation-tuned recommendation.
 *  Both sources author the classic (single-fork → 3-branches → single-merge) shape and are compiled
 *  to the live graph BoardConfig here — see core/classicBoard.ts. */
export function defaultMap(): { map: MapConfiguration; source: MapSource } {
  if (CUSTOM_BOARD) return { map: newMap(compileClassicBoard(CUSTOM_BOARD.board), CUSTOM_BOARD.rules), source: 'custom-file' };
  return { map: newMap(compileClassicBoard(CHOSEN_BOARD), CHOSEN_RULES), source: 'recommended' };
}

function validate(m: MapConfiguration): MapConfiguration {
  const board = buildBoard(m.board);
  return { board: m.board, rules: m.rules, layout: ensureLayout(board, m.layout) };
}

export function getActiveMap(): { map: MapConfiguration; source: MapSource } {
  try {
    const raw = localStorage.getItem(MAP_KEY);
    if (raw) return { map: validate(JSON.parse(raw) as MapConfiguration), source: 'saved-map' };
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const o = JSON.parse(legacy) as { cfg: MapConfiguration['board']; rules: MapConfiguration['rules'] };
      return { map: newMap(o.cfg, o.rules), source: 'saved-map' };
    }
  } catch {
    /* fall through to the default map */
  }
  return defaultMap();
}

export function saveActiveMap(map: MapConfiguration) {
  buildBoard(map.board);
  localStorage.setItem(MAP_KEY, JSON.stringify(map));
  localStorage.removeItem(LEGACY_KEY);
}

export function clearActiveMap() {
  localStorage.removeItem(MAP_KEY);
  localStorage.removeItem(LEGACY_KEY);
}

// ---- named slots ("SAVE MAP" / "LOAD MAP")
export interface MapSlot {
  name: string;
  savedAt: number;
  map: MapConfiguration;
}

export function listMapSlots(): MapSlot[] {
  try {
    return JSON.parse(localStorage.getItem(SLOTS_KEY) ?? '[]') as MapSlot[];
  } catch {
    return [];
  }
}
export function saveMapSlot(name: string, map: MapConfiguration) {
  const slots = listMapSlots().filter((s) => s.name !== name);
  slots.unshift({ name, savedAt: Date.now(), map });
  localStorage.setItem(SLOTS_KEY, JSON.stringify(slots.slice(0, 20)));
}
export function deleteMapSlot(name: string) {
  localStorage.setItem(SLOTS_KEY, JSON.stringify(listMapSlots().filter((s) => s.name !== name)));
}

/** Used by the Board Balancer's "Apply to next game": the Balancer's structural search is classic-only
 *  (see core/classicBoard.ts), so it hands back a ClassicBoardConfig, compiled to the graph shape here. */
export function applyBoardFromBalancer(board: ClassicBoardConfig, rules: MapConfiguration['rules']) {
  const compiled = compileClassicBoard(board);
  saveActiveMap({ board: compiled, rules, layout: defaultLayout(buildBoard(compiled)) });
}

// ---------------------------------------------------------------- view preferences

export type MapStyleId = 'clean' | 'galactic' | 'neon' | 'hybrid';
export const MAP_STYLES: { id: MapStyleId; label: string; blurb: string }[] = [
  { id: 'galactic', label: 'Galactic Futuristic', blurb: 'White/blue space, floating platforms, soft holograms' },
  { id: 'clean', label: 'Clean Cartoon', blurb: 'Bright, soft colours, playful and minimal glow' },
  { id: 'hybrid', label: 'Hybrid', blurb: 'Light world with neon signal trails' },
  { id: 'neon', label: 'Neon Signal', blurb: 'Dark techno space, strong cyan/green/violet glow' },
];

export interface ViewPrefs {
  style: MapStyleId;
  /** Camera eases towards the moving team and back. */
  follow: boolean;
  /** Turn off looping animation (slow laptops). */
  calm: boolean;
  dock: 'open' | 'rail';
  /** Wording pack id (core/terms.ts) — what the start, finish, spaces and cards are called. */
  terms: string;
  /** The host's own edits on top of the pack ("Customise wording"). */
  customTerms: Partial<Terms> | null;
  /** The event's name, shown above the game title (e.g. "TECHNOVA 2026"). Empty = none. */
  eventName: string;
  /** Overrides the pack's game title when set. */
  gameTitle: string;
}

const DEFAULT_VIEW: ViewPrefs = { style: 'galactic', follow: true, calm: false, dock: 'open', terms: DEFAULT_TERMS_ID, customTerms: null, eventName: '', gameTitle: '' };

/** The wording in force for the current view preferences. */
export function termsFor(v: ViewPrefs): Terms {
  return resolveTerms(v.terms, v.customTerms);
}

/** "TECHNOVA 2026 — CODE RUSH", or just the game title when no event name is set. */
export function titleFor(v: ViewPrefs): { event: string; game: string } {
  return { event: v.eventName.trim(), game: v.gameTitle.trim() || termsFor(v).gameTitle };
}

let view: ViewPrefs = loadView();
setActiveTerms(termsFor(view));
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

function loadView(): ViewPrefs {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) return { ...DEFAULT_VIEW, ...(JSON.parse(raw) as Partial<ViewPrefs>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_VIEW };
}

function emit() {
  setActiveTerms(termsFor(view));
  listeners.forEach((l) => l());
}

export function getViewPrefs(): ViewPrefs {
  return view;
}

export function subscribeViewPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setViewPrefs(patch: Partial<ViewPrefs>) {
  view = { ...view, ...patch };
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    /* ignore */
  }
  try {
    channel?.postMessage(view);
  } catch {
    /* ignore */
  }
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === VIEW_KEY) {
      view = loadView();
      emit();
    }
  });
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(VIEW_BC);
      channel.onmessage = (e: MessageEvent) => {
        view = { ...DEFAULT_VIEW, ...(e.data as Partial<ViewPrefs>) };
        emit();
      };
    } catch {
      channel = null;
    }
  }
}
