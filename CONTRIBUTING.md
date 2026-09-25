# Contributing

Thanks for helping! The two most useful contributions are **new maps** and **new department themes**. Neither needs any change to the game rules.

```bash
npm install
npm run dev     # play with your change at http://localhost:5173
npm test        # must pass
npm run maps    # must report no PROBLEMS for any map
```

## Adding a department theme

Themes only rename things. Open [`src/core/terms.ts`](src/core/terms.ts) and add an entry to `TERM_PACKS`:

```ts
{
  id: 'chem',
  department: 'Chemical Engineering',
  gameTitle: 'REACTION RACE',
  start: 'FEEDSTOCK',
  finish: 'PURE PRODUCT',
  chance: 'MYSTERY FLASK',   // lands → quick question → win a card
  noise: 'SIDE REACTION',    // lands → quick question → slip back if wrong
  booster: 'CATALYST',       // lands → jump forward
  cards: {
    isi:  card('IMPURITY', 'Impurity', 'IMP'),        // hit a nearby team, they move back 2
    hop:  card('PHASE CHANGE', 'Phase Change', 'PHSE'), // swap places with any team
    orth: card('INHIBITOR', 'Inhibitor', 'INHB'),     // block one card used on you
  },
  rapidFire: 'LAB RAPID FIRE',
  active: 'REACTING',
  firstLocked: 'FIRST YIELD',
  allLocked: 'BATCH COMPLETE',
},
```

Guidelines:
- Keep names short, because they are drawn on the board. The chips (3rd argument of `card`) must be 4 letters or fewer; the tests enforce this.
- Use UPPER CASE for everything except the card's "short" name.
- Don't describe effects in names. The effect text is shared and lives in `CARD_EFFECT` / `SPECIAL_EFFECT`.

## Adding a map

Maps are data. The engine reads a graph of spaces, and the layout is only how it looks. Most maps are one of two shapes:

- **Classic**: shared start → fork into 2–5 lanes → merge → shared finish (`ClassicBoardConfig`, [`src/core/classicBoard.ts`](src/core/classicBoard.ts)).
- **Wheel / chain**: several fork → merge stages in a row (`WheelBoardConfig`, [`src/core/wheelBoard.ts`](src/core/wheelBoard.ts)), drawn as a spiral or left to right.

Both are laid out automatically, so you never place coordinates by hand.

1. Copy an entry in [`src/data/mapPresets.ts`](src/data/mapPresets.ts), give it a new `id`, and give its board the same `name`.
2. Pick the lengths. An average team moves about 3 spaces per round, so aim for a shortest route of about **3 × rounds**.
3. Place specials:
   - Longer lanes need Boosters and shorter lanes need Noise, so that all routes cost about the same.
   - The placement rules:
     - no two specials next to each other;
     - no special on a fork, on a merge, or on the first space after a fork;
     - no Booster that lands within 4 spaces of the finish;
     - no Noise two spaces after a Chance.
4. Run `npm run maps -- 20000 <your-id>` and tune until:
   - the **parity gap** is under ~5 points (no route is clearly better);
   - **decided by reaching the finish** is above ~75 % at your recommended round count;
   - there are no `PROBLEMS` (rule violations or overlapping spaces).

You can also build a map in the in-app **Map Editor**, export the JSON, and open an issue or pull request with it.

## Code style

- Match the surrounding code: TypeScript, React function components, small pure helpers in `src/core/`.
- Game rules stay deterministic, with no `Math.random` outside `src/sim/`. A test enforces this.
- Nothing on the projector (`src/ui/Projector.tsx`) may show host-only information.
