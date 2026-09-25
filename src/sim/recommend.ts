// Turns a Report into plain-language advice. Rules are deliberately transparent so hosts can see why.
// Path names are display-only cosmetic labels (BranchRow.label — 'A1' → 'A' for a classic board, the
// raw node id otherwise), never assumed to be exactly 'A'/'B'/'C'.

import { CardType } from '../core/types';
import { Report, metricValues } from './metrics';

export type Severity = 'high' | 'medium' | 'info' | 'good';

export interface Recommendation {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const CARD_NAME: Record<CardType, string> = { isi: 'ISI', hop: 'FREQUENCY HOP', orth: 'ORTHOGONALITY' };

export function recommend(r: Report): Recommendation[] {
  const out: Recommendation[] = [];
  const v = metricValues(r);
  const rounds = r.meta.rounds;
  const push = (id: string, severity: Severity, title: string, detail: string) =>
    out.push({ id, severity, title, detail });

  // ---------------- path parity
  const slow = r.parity.find((p) => p.id === r.parityGap.slowest);
  const fast = r.parity.find((p) => p.id === r.parityGap.fastest);
  if (slow && fast && (r.parityGap.qualifyPp > 6 || r.parityGap.finishRounds > 0.35)) {
    const on = slow.specialsOnBranch;
    const hint =
      on.booster === 0
        ? `Add a Booster on Path ${slow.label}`
        : `Add another Booster (or a Chance) on Path ${slow.label}`;
    push(
      'parity',
      r.parityGap.qualifyPp > 10 ? 'high' : 'medium',
      `Path ${slow.label} is too ${slow.length > fast.length ? 'long' : 'slow'} compared with Path ${fast.label}.`,
      `With route choice randomised, teams on ${slow.label} qualify ${pct(slow.qualifyRate, 1)} of the time vs ${pct(fast.qualifyRate, 1)} on ${fast.label} ` +
        `(gap ${r.parityGap.qualifyPp.toFixed(1)} pp, ${r.parityGap.finishRounds.toFixed(2)} rounds slower on average). ` +
        `${hint}, or move a Noise space from ${slow.label} to ${fast.label}.`,
    );
  } else if (r.parity.length > 1) {
    push(
      'parity',
      'good',
      'The paths are balanced.',
      `Randomised route choice gives qualify rates of ${r.parity.map((p) => `${p.label} ${pct(p.qualifyRate, 1)}`).join(', ')} ` +
        `(gap ${r.parityGap.qualifyPp.toFixed(1)} pp).`,
    );
  }

  // ---------------- usage
  if (r.routes.length > 1) {
    const busiest = [...r.routes].sort((a, b) => b.usage - a.usage)[0];
    const quietest = [...r.routes].sort((a, b) => a.usage - b.usage)[0];
    if (busiest.usage > 0.55) {
      push('usage-dom', 'medium', `Path ${busiest.label} dominates route choice (${pct(busiest.usage)} of teams).`,
        `Give the other paths a visible advantage (Booster or Chance) or remove rewards from ${busiest.label}.`);
    }
    if (quietest.usage < 0.1) {
      push('usage-low', 'info', `Path ${quietest.label} is almost never chosen (${pct(quietest.usage)}).`,
        `Teams see no reason to take it. Add a reward on ${quietest.label}, or accept it as a deliberate trap route.`);
    }
  }

  // ---------------- boosters
  if (v.boosterPerTeam > 0.9) {
    push('booster-high', 'medium', 'Booster frequency appears too high.',
      `Teams land on a Booster ${v.boosterPerTeam.toFixed(2)} times per game on average. Remove one Booster or lower its strength.`);
  } else if (v.boosterPerTeam < 0.2) {
    push('booster-low', 'info', 'Boosters are rarely reached.',
      `Only ${v.boosterPerTeam.toFixed(2)} Booster landings per team per game. Move Boosters onto busier stretches or add one.`);
  }

  // ---------------- ISI
  if (v.isiSteps > 1.5) {
    push('isi-high', 'high', 'ISI causes excessive backward movement.',
      `Teams lose ${v.isiSteps.toFixed(2)} spaces to ISI per game on average. Reduce the ISI range or make ISI harder to earn.`);
  } else if (v.isiSteps < 0.2) {
    const isi = r.cards.find((c) => c.card === 'isi')!;
    push('isi-low', 'medium', 'ISI is rarely used.',
      `Only ${pct(isi.gainRate)} of teams ever earn ISI and just ${v.isiSteps.toFixed(2)} spaces per team are lost to it. ` +
        `Put the ISI Chance on a busier space (shared start or merge) or widen the ISI range.`);
  } else {
    push('isi-ok', 'good', 'ISI is useful without being overwhelming.', `${v.isiSteps.toFixed(2)} spaces lost to ISI per team per game.`);
  }

  // ---------------- chance / noise reach
  const rareChance = r.nodes.filter((n) => n.type === 'chance' && n.hitRate < 0.08);
  if (rareChance.length) {
    push('chance-rare', 'medium', 'Chance spaces are rarely reached.',
      `${rareChance.map((n) => `${n.id} (${pct(n.hitRate, 1)})`).join(', ')} — fewer than 1 team in 12 lands there. Move them to shared or busier stretches.`);
  }
  const rareNoise = r.nodes.filter((n) => n.type === 'noise' && n.hitRate < 0.05);
  if (rareNoise.length) {
    push('noise-rare', 'info', 'Some Noise spaces almost never matter.', rareNoise.map((n) => `${n.id} (${pct(n.hitRate, 1)})`).join(', '));
  }

  // ---------------- cards
  for (const c of r.cards) {
    if (c.uplift > 0.12) {
      push(`card-strong-${c.card}`, 'medium', `${CARD_NAME[c.card]} looks too strong.`,
        `Teams that earn it qualify ${(c.uplift * 100).toFixed(1)} pp more often than comparable teams without it. ` +
          (c.card === 'hop' ? 'Consider limiting the swap range (Balancer → FREQUENCY HOP rules).' : 'Consider making it harder to earn.'));
    }
    if (c.gainRate < 0.05) {
      push(`card-rare-${c.card}`, 'info', `${CARD_NAME[c.card]} is almost never earned.`, `Only ${pct(c.gainRate, 1)} of teams get it.`);
    }
  }

  // ---------------- pace
  if (r.finish.fallbackPct > 0.15) {
    push('fallback', 'medium', `${pct(r.finish.fallbackPct)} of ${rounds}-round games need the fallback rule.`,
      'The average team cannot finish quickly enough. Add Boosters, shorten a path, or play an extra round.');
  }
  if (r.finish.fallback4Pct > 0.5) {
    push('fallback4', 'info', `A shorter game ends via fallback ${pct(r.finish.fallback4Pct)} of the time.`,
      'Play an extra round unless you want a mostly "furthest position wins" ending.');
  }
  if (v.endBy4 > 0.7) {
    push('too-fast', 'medium', 'Games end too early.', `${pct(v.endBy4)} of games are decided early — paths are too easy.`);
  }
  if (v.avgReachFinal < 0.5) {
    push('avg-team', 'medium', 'The average team usually does not reach the Receiver.',
      `An average-skill team reaches RX within ${rounds} rounds only ${pct(v.avgReachFinal)} of the time.`);
  }

  // ---------------- skill / comeback
  const spread = v.topQual - v.bottomQual;
  if (spread < 0.3) {
    push('luck', 'medium', 'Luck outweighs skill.', `Top-skill teams qualify ${pct(v.topQual)} vs ${pct(v.bottomQual)} for the bottom third.`);
  } else if (spread > 0.75 || v.bottomQual < 0.05) {
    push('skill-heavy', 'medium', 'The strongest teams are too dominant.',
      `Bottom-skill teams qualify only ${pct(v.bottomQual)}. Add recovery opportunities (Boosters early, Chance for HOP).`);
  }
  if (v.comeback < 0.1) push('comeback-low', 'info', 'Comebacks are rare.', `Only ${pct(v.comeback)} of qualifiers were outside the qualifying slots at the baseline round.`);
  if (v.comeback > 0.5) push('comeback-high', 'info', 'Comebacks may be too common.', `${pct(v.comeback)} of qualifiers were outside the qualifying slots at the baseline round.`);

  // ---------------- clustering
  if (v.neighborsMid > 4.5) {
    push('packed', 'medium', 'Teams stay packed together.',
      `${v.neighborsMid.toFixed(1)} teams within 3 spaces on average mid-game. Raise the ISI range or add Noise.`);
  } else if (v.neighborsMid < 1) {
    push('spread', 'info', 'Teams are very spread out.', `Only ${v.neighborsMid.toFixed(1)} teams within 3 spaces mid-game, so ISI has few targets.`);
  }
  if (v.aliveLow > 0.25) {
    push('alive', 'medium', 'Too few contenders late in the game.',
      `In ${pct(v.aliveLow)} of games fewer than ${r.meta.slots} teams are qualified or within reach before the last round.`);
  }
  if (v.clusterAll > 0.08) {
    push('cluster-end', 'info', 'Games often end with almost every team beside the Receiver.',
      `${pct(v.clusterAll)} of games. Consider a stronger ISI or an extra Noise near the end.`);
  }

  const order: Record<Severity, number> = { high: 0, medium: 1, info: 2, good: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Cosmetic display label for a branch/path id (see BranchRow.label). */
export function routeLabel(id: string): string {
  const stripped = id.replace(/\d+$/, '');
  return `Path ${stripped || id}`;
}
