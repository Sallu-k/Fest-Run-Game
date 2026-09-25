// Re-exported from core/placementRules.ts, which moved there so core/mapEdit.ts's mapReport() can use
// it without a core -> sim dependency. Kept here too since sim/optimize.ts and the UI already import
// from this path.
export { MAX_BOOSTER, BOOSTER_MIN_REMAINING_AFTER, MIN_BRANCH_POS, layoutProblems } from '../core/placementRules';
