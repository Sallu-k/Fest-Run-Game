/** Route colours for DOM UI (buttons, chips). The board itself reads colours from the active map theme.
 *  Extra lanes beyond A/B/C (a custom map with a different lane count) fall back to a generated palette
 *  keyed by the lane's position, so an arbitrary lane set "just works" without hand-editing this file. */
/** Lanes beyond A/B/C (4- and 5-lane maps) — shared with the board themes so buttons match the board. */
export const EXTRA_LANE_COLORS: Record<string, string> = { D: '#ec4899', E: '#14b8a6', F: '#eab308', G: '#f43f5e', H: '#a78bfa' };
const BASE_ROUTE_COLORS: Record<string, string> = { A: '#0ea5e9', B: '#8b5cf6', C: '#f59e0b', ...EXTRA_LANE_COLORS };
const FALLBACK_ROUTE_PALETTE = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#22c55e', '#ec4899', '#eab308', '#14b8a6', '#f43f5e'];

export function routeColor(laneId: string, index = 0): string {
  return BASE_ROUTE_COLORS[laneId] ?? FALLBACK_ROUTE_PALETTE[index % FALLBACK_ROUTE_PALETTE.length];
}

/** @deprecated fixed 3-lane palette; prefer `routeColor(laneId, index)`, which handles any lane set. */
export const ROUTE_COLORS = BASE_ROUTE_COLORS;
