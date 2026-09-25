# CIPHERON — SIGNAL RUN: Board Balancer report

Generated 2026-09-21T18:25:06.259Z. Seed 20260921. 5934 layouts screened; every finalist simulated for 1,00,000 games (+ 50,000 route-parity games); the winner re-run for 2,50,000.

## Recommended layout

```
p3/s3 isi3/-2 B+5 N-2 hop∞ A3=C:orth A6=N A8=N B4=B+2 C3=B C5=B C7=B M2=C:hop S2=C:isi
```

### Why these positions

- Structure: 3 shared spaces from the Transmitter to the junction, then Path A / B / C with 8 / 9 / 12 own spaces, merging into 3 shared spaces before the Receiver. Route lengths stay exactly 15 / 16 / 19.
- Expected effective length for an average team (real length minus expected Booster/Chance gain plus expected Noise loss): A 14.9, B 14.9, C 14.0 — the specials are placed to pull the 15 / 16 / 19-space routes together.
- S2 — CHANCE (ISI) on the shared start: 20% of teams land here. Every team passes here, so the card is reachable for everyone.
- A3 — CHANCE (ORTH) on Path A: 16% of teams land here. Teams that pick Path A can earn the card; it is not next to any Noise space.
- A6 — NOISE −2 on Path A: 15% of teams land here. A quick question protects the team, so this is a soft penalty that trims the reward of the short route rather than punishing luck.
- A8 — NOISE −2 on Path A: 13% of teams land here. A quick question protects the team, so this is a soft penalty that trims the reward of the short route rather than punishing luck.
- B4 — SIGNAL BOOSTER +2 on Path B: 4% of teams land here. It sits 9 spaces from the Receiver, so even after the jump the team still needs 7 more; it shortens Path B without deciding the game on its own.
- C3 — SIGNAL BOOSTER +5 on Path C: 12% of teams land here. It sits 13 spaces from the Receiver, so even after the jump the team still needs 8 more; it shortens Path C without deciding the game on its own.
- C5 — SIGNAL BOOSTER +5 on Path C: 9% of teams land here. It sits 11 spaces from the Receiver, so even after the jump the team still needs 6 more; it shortens Path C without deciding the game on its own.
- C7 — SIGNAL BOOSTER +5 on Path C: 5% of teams land here. It sits 9 spaces from the Receiver, so even after the jump the team still needs 4 more; it shortens Path C without deciding the game on its own.
- M2 — CHANCE (HOP) on the shared finish: 22% of teams land here. Every team passes here, so the card is reachable for everyone.
- No two special spaces are adjacent, no Noise follows a Chance within two spaces, and no Booster lands within 4 spaces of the Receiver.

## Result vs targets (5 rounds, 10 teams)

| Metric | Value | Target | |
|---|---|---|---|
| Path parity: qualify-rate gap (pp) | 0.56 | 0.00 – 5.00 | ✔ |
| Path parity: mean-finish gap (rounds) | 0.05 | 0.00 – 0.30 | ✔ |
| Busiest path share | 47% | 0% – 55% | ✔ |
| Quietest path share | 15% | 15% – 100% | ✔ |
| Average team reaches RX by last round | 67% | 60% – 90% | ✔ |
| Average team reaches RX by round 4 | 31% | 15% – 50% | ✔ |
| Game decided without fallback (last round) | 85% | 85% – 100% | ✔ |
| Game decided by round 4 | 17% | 15% – 60% | ✔ |
| Top-skill third qualifies | 75% | 60% – 88% | ✔ |
| Bottom-skill third qualifies | 29% | 8% – 30% | ✔ |
| Qualifiers from outside top-N after round 2 | 27% | 15% – 45% | ✔ |
| Spaces lost to ISI per team | 0.21 | 0.25 – 1.50 | ✘ |
| Cards earned per team per game | 0.33 | 0.35 – 1.10 | ✘ |
| Rarest card: share of teams that earn it | 9% | 7% – 100% | ✔ |
| Strongest card qualify uplift | 8% | 0% – 12% | ✔ |
| Least-reached special (hit rate) | 4% | 8% – 100% | ✘ |
| Booster landings per team | 0.31 | 0.25 – 0.90 | ✔ |
| Gap 1st–last team (mid game, spaces) | 10.24 | 5.00 – 11.00 | ✔ |
| Teams within 3 spaces (mid game) | 2.96 | 1.00 – 4.00 | ✔ |
| Games with < slots contenders before last round | 0% | 0% – 20% | ✔ |
| Games ending with ~all teams beside RX | 15% | 0% – 20% | ✔ |

## Path table

| Path | Length | Usage (mixed) | Qualify (parity) | Mean finish (parity) | Reach RX in time |
|---|---|---|---|---|---|
| A | 15 | 47% | 49.7% | 5.03 | 61% |
| B | 16 | 15% | 50.3% | 5.05 | 62% |
| C | 19 | 38% | 50.1% | 5.00 | 61% |

Finish: mean qualifier round 4.26, median 4. Game decided by round: R1 0%, R2 0%, R3 0%, R4 17%, R5 85%. Fallback needed: 14.8% (5 rounds), 82.6% (4 rounds).

## Special-space hit frequency

| Node | Type | Teams landing |
|---|---|---|
| S2 | chance (isi) | 20.1% |
| A3 | chance (orth) | 15.9% |
| A6 | noise | 14.8% |
| A8 | noise | 13.2% |
| B4 | booster | 4.0% |
| C3 | booster | 12.3% |
| C5 | booster | 8.8% |
| C7 | booster | 5.5% |
| M2 | chance (hop) | 21.5% |

## Cards

| Card | Earned by | Used per team | Blocked | Qualify uplift |
|---|---|---|---|---|
| isi | 11.0% | 0.10 | 0% | -13.8 pp |
| hop | 13.0% | 0.00 | 0% | 7.9 pp |
| orth | 9.4% | 0.00 | 0% | -1.3 pp |

## Recommendations for this layout

- **[info] A 4-round game ends via fallback 83% of the time.** Use 5 rounds unless you want a mostly "furthest position wins" ending.
- **[info] Games often end with almost every team beside the Receiver.** 15% of games. Consider a stronger ISI or an extra Noise near the end.
- **[good] The three paths are balanced.** Randomised route choice gives qualify rates of A 49.7%, B 50.3%, C 50.1% (gap 0.6 pp).
- **[good] ISI is useful without being overwhelming.** 0.21 spaces lost to ISI per team per game.

## Layout comparison (all simulated at full size)

| Layout | Score | Parity gap (pp) | Finish gap (rounds) | Usage A/B/C | Decided by R5 | Fallback | Layout |
|---|---|---|---|---|---|---|---|
| RECOMMENDED | 5.5 | 0.6 | 0.05 | 47%/15%/38% | 85% | 15% | `p3/s3 isi3/-2 B+5 N-2 hop∞ A3=C:orth A6=N A8=N B4=B+2 C3=B C5=B C7=B M2=C:hop S2=C:isi` |
| refine: full +4 booster on B | 13.9 | 10.0 | 0.23 | 49%/30%/21% | 86% | 14% | `p3/s3 isi3/-2 B+4 N-2 hop∞ A3=C:orth A6=N A8=N B4=B C2=B C6=B C8=B M2=C:hop S2=C:isi` |
| refine: B +2, C boosters +4 | 4.9 | 5.0 | 0.11 | 53%/22%/26% | 83% | 17% | `p3/s3 isi3/-2 B+4 N-2 hop∞ A3=C:orth A6=N A8=N B4=B+2 C2=B C6=B C8=B M2=C:hop S2=C:isi` |
| refine: B +2, C +5 at C2/C5/C7 (B3) | 4.9 | 1.2 | 0.01 | 47%/15%/38% | 85% | 15% | `p3/s3 isi3/-2 B+5 N-2 hop∞ A3=C:orth A6=N A8=N B3=B+2 C2=B C5=B C7=B M2=C:hop S2=C:isi` |
| refine: B +3, C +5 at C2/C5/C7 | 5.0 | 3.4 | 0.05 | 46%/18%/36% | 86% | 14% | `p3/s3 isi3/-2 B+5 N-2 hop∞ A3=C:orth A6=N A8=N B4=B+3 C2=B C5=B C7=B M2=C:hop S2=C:isi` |
| refine: B +2, four C boosters +4 | 7.3 | 0.9 | 0.03 | 45%/14%/41% | 85% | 15% | `p3/s3 isi3/-2 B+4 N-2 hop∞ A3=C:orth A6=N A8=N B4=B+2 C2=B C4=B C6=B C8=B M2=C:hop S2=C:isi` |
| optimizer-winner (pure search) | 4.2 | 4.2 | 0.13 | 56%/15%/29% | 82% | 18% | `p3/s3 isi3/-2 B+4 N-2 hop∞ A3=C:orth A6=N A8=N C2=B C6=B C8=B M2=C:hop S2=C:isi` |
| search-1 | 4.3 | 3.9 | 0.11 | 55%/11%/33% | 85% | 15% | `p2/s3 isi3/-2 B+5 N-3 hop∞ A2=C:isi A4=C:orth A8=N C2=B C5=B C7=B C10=N M1=C:hop` |
| search-2 | 4.5 | 4.8 | 0.12 | 56%/11%/34% | 86% | 14% | `p2/s3 isi3/-2 B+5 N-2 hop∞ A2=C:isi A4=C:orth A8=N C2=B C5=B C7=B C10=N M1=C:hop` |
| search-3 | 4.5 | 3.9 | 0.11 | 55%/11%/33% | 85% | 15% | `p2/s3 isi3/-2 B+5 N-3 hop∞ A2=C:isi A4=C:orth A8=N C2=B C5=B C7=B C9=N M3=C:hop` |
| search-4 | 4.5 | 3.7 | 0.11 | 55%/11%/33% | 85% | 15% | `p2/s3 isi3/-2 B+5 N-3 hop∞ A2=C:isi A4=C:orth A9=N C2=B C5=B C7=B C9=N M3=C:hop` |
| search-5 | 4.6 | 3.6 | 0.11 | 55%/11%/33% | 85% | 15% | `p2/s3 isi3/-2 B+5 N-3 hop∞ A2=C:isi A4=C:orth A7=N C2=B C5=B C7=B C9=N M3=C:hop` |
| search-6 | 4.6 | 4.0 | 0.11 | 55%/11%/33% | 85% | 15% | `p2/s3 isi2/-2 B+5 N-3 hop∞ A2=C:isi A4=C:orth A8=N C2=B C5=B C7=B C10=N M1=C:hop` |
| search-7 | 4.6 | 3.7 | 0.11 | 55%/11%/33% | 85% | 15% | `p2/s3 isi3/-2 B+5 N-3 hop∞ A2=C:isi A4=C:orth A7=N C2=B C5=B C7=B C10=N M3=C:hop` |
| search-8 | 4.7 | 3.6 | 0.10 | 55%/11%/33% | 85% | 15% | `p2/s3 isi3/-2 B+5 N-3 hop∞ A2=C:isi A6=C:orth A9=N C2=B C5=B C7=B C9=N M3=C:hop` |
| search-9 | 4.7 | 4.4 | 0.12 | 55%/11%/33% | 85% | 15% | `p2/s3 isi3/-2 B+5 N-3 hop∞ A2=C:orth A4=C:isi A8=N C2=B C5=B C7=B C9=N M3=C:hop` |
| search-10 | 4.7 | 3.8 | 0.11 | 55%/11%/33% | 84% | 16% | `p2/s3 isi3/-2 B+5 N-3 hop∞ A2=C:isi A4=C:orth A7=N C2=B C5=B C7=B C11=N M3=C:hop` |
| search-11 | 4.7 | 4.6 | 0.12 | 56%/11%/34% | 86% | 14% | `p2/s3 isi3/-2 B+5 N-2 hop∞ A2=C:isi A4=C:orth A8=N C2=B C5=B C7=B C9=N M3=C:hop` |
| c-heavy-rewards | 35.3 | 12.2 | 0.28 | 64%/16%/20% | 85% | 15% | `p3/s2 isi3/-2 B+4 N-2 hop∞ A6=N B5=C:orth B8=N C3=B C6=C:hop C8=B C11=C:isi` |
| baseline-even | 52.6 | 15.9 | 0.38 | 70%/21%/10% | 83% | 17% | `p3/s2 isi3/-2 B+3 N-2 hop∞ A4=C:isi A7=N B5=C:hop B8=N C4=B C6=C:orth C9=B` |
| safe-short | 80.5 | 22.1 | 0.52 | 62%/31%/7% | 87% | 13% | `p3/s2 isi3/-2 B+3 N-2 hop∞ A5=C:orth A8=N B2=B B4=C:isi B7=N C5=B C8=C:hop` |

## Robustness

| Scenario | Parity gap (pp) | Decided by R5 | Fallback | Top / bottom third qualify | Note |
|---|---|---|---|---|---|
| 4-round mode | 0.4 | 17% (by R4) | 83% | 75% / 29% | fallback decides most 4-round games |
| weaker teams | 5.1 | 14% | 86% | 76% / 28% | answer distribution tilted down (θ = −0.35, mean ≈ 2.7 correct) |
| stronger teams | 2.2 | 100% | 0% | 71% / 32% | answer distribution tilted up (θ = +0.35, mean ≈ 3.9 correct) |
| wider skill spread | 0.2 | 80% | 20% | 88% / 17% | team skill spread doubled (σ 0.25 → 0.5) |
| identical teams | 1.2 | 89% | 11% | 50% / 50% | no skill differences (σ = 0): pure luck check |
| 8 teams | 1.5 | 63% | 37% | 86% / 40% | only 8 teams playing |
| more careful route choice | 0.3 | 86% | 14% | 74% / 30% | every team picks routes by expected value |
| ISI-happy teams | 0.4 | 85% | 15% | 75% / 29% | every team always uses ISI when a target exists |

Simulation model: pmf 0.03, 0.09, 0.17, 0.27, 0.22, 0.14, 0.08 · skill σ 0.25 · quick-question base 0.6 · route policies {"value":0.5,"shortest":0.3,"random":0.2}
Simplicity penalty of winner: 2.5
