# FestRun — the quiz board race for tech fests

A host-run board race for college fests and quiz events. Teams answer rapid-fire questions, and **every correct answer moves them one space** towards the finish. There are no dice. The board is shown on a projector, and one laptop runs everything.

- **10 balanced maps**: 2 to 5 paths, ring-shaped boards, and short, standard and long games (3 to 7 rounds). Every map was simulated so that no route is a free win.
- **Department themes**: one click renames the board for your event. The rules stay the same. Examples:
  - ECE: *Transmitter → Receiver, Noise, ISI, Frequency Hop*
  - CSE: *Hello World → Production, Bug, Merge Conflict*
  - Also Mechanical, Civil, EEE, Biotech, Aerospace, AI/Data and General.
  - You can also type your own wording.
- **Made for the event hall**: a projector window mirrors the board live, with a big timer, card reveals and winner banners. Host controls stay on the laptop.
- **Fully offline**: no login, no server, no database, no internet during the event. State lives in the browser, so a refresh doesn't lose the game.
- **Up to 10 teams**, any number of winners, and a fallback ranking so the game always ends with a result.

> Originally built as *CIPHERON — Signal Run* for an ECE fest. Pick the **Electronics & Communication** theme and enter your event name to get that game back.

---

## Play it

### Option 1: in the browser, nothing to install
If this repo has GitHub Pages enabled (see [Publishing](#publishing-your-own-copy)), open the Pages link. Once the page has loaded, the game never talks to the network again, and it saves its state in your browser. For a venue with unreliable Wi-Fi, use option 2.

### Option 2: on your laptop
You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm run dev          # opens http://localhost:5173
```

For the event itself, build once and serve the static files:

```bash
npm run build        # writes dist/
npm run preview      # http://localhost:4173
# or, without Node on the event laptop:
python3 serve.py     # (Windows: py serve.py) → http://localhost:8080
```

Open the game over `http://localhost`, not by double-clicking `index.html`. Browsers block the projector sync and the simulator on `file://`.

---

## Running an event

### Setup
1. **Your event**: type the event name (e.g. *TECHNOVA 2026*) and pick the **department theme**. Use *Customise wording…* to rename anything yourself.
2. **Teams & rounds**: set the number of teams (1–10), rounds (3–8) and winners, and type the team names. The screen tells you how many rounds the chosen map is tuned for.
3. **Choose a map**: filter by *Quick / Standard / Long* and press **USE MAP**. Choosing a map also sets its recommended round count.
4. Click **Open projector window ↗**, drag that window onto the projector and press **F** for fullscreen.
5. **START GAME ▶**

### Picking a map

| Map | Paths | Rounds | Best for |
|---|---|---|---|
| **Quick Sprint** | 2 short paths | 3 | prelims, tight slots, 2–8 teams |
| **Lightning Triple** | 3 (12 / 13 / 15) | 4 | a shorter 4-round game |
| **Triple Route** | 3 (15 / 16 / 19) | 5 | the original, most-tested board |
| **S-Curve** | 2 (15 / 17) | 5 | small groups, easy to read |
| **Crossroads** | 4 (14–18) | 5 | 6–10 teams, less crowding |
| **Five-Lane Highway** | 5 (14–19) | 5 | a big field of teams |
| **Wheel** | 2 rings | 5 | lots of lead changes |
| **Chain Links** | 3 small rings | 5 | a decision every few spaces |
| **Grand Spiral** | 3 rings | 6 | a finals slot |
| **Marathon** | 3 (20 / 22 / 25) | 7 | a grand finale |

Rule of thumb: an average team gets about 3 answers right per round, so the shortest route should be about **3 × rounds**.

### How a round works
1. **Rapid fire (30 s)**: every team answers 6 questions at the same time, from your own question sheet. A 10 s buffer follows, then result entry.
2. **Result confirmation**: enter each team's correct count (0–6). Nothing moves yet.
3. **Movement**: teams move one at a time, in an order that rotates by two seats each round. On their turn, a team either **moves** its registered spaces or **uses a card** instead (it gives up that round's movement).
   - At a fork, the team chooses a path. Click the glowing space or a route card.
   - Landing on a special space triggers it:
     - **Mystery** (*Chance*): ask a quick question. If they get it right, they win a card.
     - **Trap** (*Noise*): ask a quick question. If they get it wrong, they slip back.
     - **Boost**: the team jumps forward.
4. Reaching the finish locks the team into the next winner slot. After the last round, a **fallback ranking** fills any empty slots: fewest spaces to go, then most correct answers in the final round, then a sudden-death question.

**Cards.** A team holds at most one copy of each card. Each is single use, and a card can't be played in the turn it was won.

| Card (General / ECE name) | What it does |
|---|---|
| Push Back / *ISI* | A team within 3 spaces moves back 2 |
| Swap / *Frequency Hop* | Swap positions with any active team |
| Shield / *Orthogonality* | Block one card played against you |

**Host safety net:**
- **Undo** reverts any game action.
- **Overrides**:
  - give a card, move a team, rename or withdraw a team;
  - turn sound and auto-timers on or off;
  - export the event log as CSV.

The **Map Editor** is locked while a game is running. The hidden **Board Balancer** (Ctrl + Shift + B) simulates any map.

**Questions** are not built in. You bring your own for your department and read them out, and the app only asks how many were right. This is deliberate: one app works for every subject, and answers can never leak onto the projector.

---

## Make it yours

- **Themes and wording**: edit [`src/core/terms.ts`](src/core/terms.ts) to add a department pack, or use *Customise wording…* on the setup screen with no code at all.
- **Maps**: use the in-app **Map Editor** (drag spaces, add or move specials, rename paths, save and export JSON), or add a preset in [`src/data/mapPresets.ts`](src/data/mapPresets.ts) and check it with `npm run maps`.
- **Look**: four visual styles under **⋯ More → Map style**: Galactic, Clean Cartoon, Hybrid and Neon.

[CONTRIBUTING.md](CONTRIBUTING.md) walks through adding a map or a theme.

---

## How the balancing works

The same rules engine ([`src/core/engine.ts`](src/core/engine.ts)) runs the live game and a Monte-Carlo simulator ([`src/sim/`](src/sim)).

**What each simulated game models:**
- a realistic spread of team skill (mean ≈ 3.3 correct answers out of 6);
- route choices, quick questions and card play;
- the fallback ranking.

**What `npm run maps` reports for every shipped map** (20,000 games by default):
- **Route fairness**: the qualify rate for teams that pick a route at random. The gap between the best and worst route is at most about 4 points on every shipped map.
- **Pace**: how many games end by teams actually reaching the finish rather than by fallback. This is 72–96 % at each map's recommended round count.
- **Rule checks**: placement rules (no adjacent specials, no Boost within 4 spaces of the finish, …) and overlapping spaces.

Longer routes carry Boosts and shorter ones carry Traps, so that on average the routes cost the same. For the original Triple Route, [`reports/balance-report.md`](reports/balance-report.md) has the full 250,000-game study, and `npm run optimize` reruns it.

The answer model is an assumption. If your teams are much stronger or weaker, open the Board Balancer, enter your own answer distribution, and re-check the map.

---

## Development

```bash
npm run dev        # dev server with hot reload
npm test           # rules, state machine, maps, themes (node:test)
npm run typecheck
npm run maps       # simulate + check every map preset
npm run build      # production build into dist/
```

```
src/core/     rules engine (no randomness), board graph, map layout, wording packs
src/data/     map presets, the optimizer's tuned board
src/sim/      Monte-Carlo simulator, metrics, optimizer, Web Worker
src/state/    host game state machine (undo, log, persistence, projector sync)
src/ui/       setup, host dashboard, projector, map editor, board balancer
src/ui/board/ SVG board: camera, themes, tiles, pawns, landmarks, effects
scripts/      map checker and optimizer command-line tools
tests/        node:test suites
```

## Publishing your own copy

1. Create a GitHub repository and push this folder to its `main` branch.
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` tests, builds and publishes the game on every push. Your link will be `https://<your-user>.github.io/<repo>/`.

## License

[MIT](LICENSE). Use it at your fest, fork it, and change it.
