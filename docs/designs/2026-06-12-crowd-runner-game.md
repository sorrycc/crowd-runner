# Crowd Runner — Count Masters–style Hypercasual Game (v1)

## 1. Background

Build, from an empty repo, a full clone of a Count Masters–style "crowd runner" hypercasual
game. The player auto-runs down a 3D road, steers between `+N`/`×N`/`−N` gate pairs to grow a
following crowd, smashes HP obstacles, and defeats an end-of-stage boss before a countdown
timer. Reference screenshot: orange leader, green `+15`/`+5` gates, an `80`-HP tire stack, a
`56人` blue crowd, `STAGE 1`, coins, `6 COMBO`, and a `0:16 / 3:18` timer.

Stack and shape were pre-decided by the user: **Three.js (web 3D) + Vite**, **full-clone
scope**, **simple primitives only** (boxes/cylinders/capsules), **no external assets**, **no
audio** for v1. Governing conventions: KISS, YAGNI, DRY, SOLID (user global CLAUDE.md).

## 2. Requirements Summary

**Goal:** A full-loop, polished, single, deterministic stage driven by a generic stage-config
structure so more stages can be added later via data only.

**In scope:** perspective road (vanishing point, dashed lane lines, guardrails, trees, fog, sky
gradient) — all primitives; leader steering (mouse-drag, touch-drag, arrow/A-D), x clamped to
road; crowd in a packed-block formation via `THREE.InstancedMesh` (one draw call), lerping to
slots, re-packing on count change, never leaving the road; gate PAIRS with `+N`/`×N`/`−N` (no
division); floating live count plate; HP tire-stack obstacles that consume crowd on contact;
end boss with HP bar (crowd auto-attacks, boss drains crowd back); HUD (count, `N COMBO`, coins,
single countdown timer, static `STAGE 1`, top boss/progress bar); Start/Win/Lose screens each
with a single Restart; one stage authored entirely in config.

**Out of scope (v1):** division gates, multiple stages, level select, resume/checkpoint, coin
shop/upgrades, persistence, audio, external assets, per-member physics/boids, mandatory
particle juice, randomized gameplay layout.

## 3. Acceptance Criteria

1. On launch a Start screen shows; click/tap Start begins the run with crowd = 1 and the
   configured `timeRemaining`.
2. Leader auto-runs forward continuously and steers left/right via mouse-drag, touch-drag, and
   arrow/A-D; leader x is clamped within road width and can never exit the road.
3. Track renders a perspective road with vanishing point, dashed lane lines, guardrails, trees,
   distance fog, and sky gradient — primitives only, no external assets or audio.
4. Crowd followers render via a single `THREE.InstancedMesh` (one draw call) in a packed-block
   formation behind the leader; members lerp toward slots, the formation re-packs as count
   changes, and no member leaves the road.
5. Gates always appear in pairs; the operation applied is the side the crowd center (leader x)
   crosses; only `+N`/`×N`/`−N` occur (never division), values within configured ranges.
6. Applying a gate updates the integer count correctly and clamps so it never exceeds 200; the
   floating count plate updates to the new value immediately and visibly.
7. Contacting an HP obstacle removes 1 crowd member per 1 HP (per configured rate), the obstacle
   visually breaks at 0 HP, and the run continues afterward.
8. At the boss, the crowd auto-attacks dealing `≈ crowdSize × perMemberDPS` per second; the boss
   HP bar decreases live and accurately; the boss simultaneously removes crowd members at the
   configured fixed rate, reflected live in the count.
9. The single global countdown timer decreases in real time during both run and boss fight and
   is the only authoritative timer in game state.
10. Win triggers exactly when boss HP reaches 0 while `timeRemaining > 0`, showing the Win screen.
11. Lose triggers when `timeRemaining` reaches 0 OR crowd count reaches 0 (whichever first),
    showing the Lose screen.
12. HUD shows and updates live: crowd count, `N COMBO`, coins, countdown timer, static `STAGE 1`,
    and a top boss/progress bar.
13. Coins increment on pickup; combo increments on consecutive good gate choices and resets to 0
    on a bad gate choice or obstacle damage; both are purely cosmetic, no persistence, reset each
    run.
14. Win and Lose screens each present a single Restart button that fully resets the stage (timer
    reset, crowd = 1) and regenerates the identical deterministic track.
15. Running the same stage twice produces an identical track layout — deterministic and learnable.
16. Stage layout and all tuning (gate ranges, obstacle HP, boss HP, `perMemberDPS`, boss removal
    rate, crowd cap, coin placements, timer duration) come from a single stage-config structure;
    adding another stage requires only new config data, not engine changes.
17. The full loop is completable end-to-end: a clean run reaches the boss with ~50–100 crowd and
    time margin, and can defeat the boss before the timer expires.

Note: lightweight juice (spawn/despawn pop, combo flash, gate-pass feedback) is encouraged but
is explicitly NOT an acceptance gate for v1.

## 4. Problem Analysis

Greenfield — no prior art to evaluate. The only meaningful architectural fork is world motion:

- **Scroll-the-world** — keep player at fixed Z, move all geometry toward camera. Common in
  endless runners, but with a fixed-length deterministic track it complicates distance tracking
  and entity bookkeeping (every entity needs its own scroll). Rejected.
- **Move-the-player (chosen)** — static world; entities placed at fixed Z from config; leader
  advances +Z; chase camera follows. Track distance == leader Z, collisions are simple Z-window
  tests, config maps 1:1 to world coordinates. Wins on simplicity and determinism.

## 5. Decision Log

**1. World motion model**
- Options: A) scroll the world past a fixed player · B) move the player +Z through a static world
- Decision: **B)** — distance == leader.z, config positions map directly to world Z, simplest
  collision and determinism.

**2. Forward axis / camera**
- Options: A) forward = −Z (three.js camera default look dir) · B) forward = +Z, camera behind
- Decision: **B)** — leader runs +Z; chase camera sits behind at lower Z and above, looking
  toward +Z. Explicit and readable; sign of "distance" stays positive.

**3. Crowd representation**
- Options: A) one mesh per member · B) single `InstancedMesh` capacity 200, leader separate
- Decision: **B)** — `count` integer is source of truth; leader is a separate orange capsule;
  followers = `max(0, count−1)` drawn in one `InstancedMesh` (one draw call). AC4/AC6.

**4. Formation layout**
- Options: A) concentric rings · B) centered rectangular block with fixed column count
- Decision: **B)** — fixed columns (≈9), fixed spacing, rows extend backward, centered on leader
  x; slot i = deterministic function of i. Members lerp toward `leader + slotOffset` each frame;
  hidden (scale 0) for i ≥ count−1. Simple, packs/repacks trivially.

**5. In-world text (gate values, obstacle HP, count plate)**
- Options: A) DOM elements projected each frame · B) `CanvasTexture` sprites attached to meshes
- Decision: **B)** — one reused `makeTextSprite(text, opts)` helper; sprites parented to their
  entity so they move/cull with it. DRY, crisp, no per-frame projection bookkeeping. Sprite
  textures are regenerated only when their text changes (count plate on count change).

**6. HUD + screens**
- Options: A) in-canvas (three GUI) · B) DOM overlay over the canvas
- Decision: **B)** — a fixed-position HTML overlay (`#hud`) and full-screen overlays
  (`#screen-*`). Cheap, accessible, easy to style. HUD reads game state each frame.

**7. Top progress bar semantics**
- Options: A) two bars (distance + boss) · B) one bar: run distance fraction, then boss HP
- Decision: **B)** — during run the bar fills with `leader.z / bossZ`; on entering boss it
  switches to `bossHP / bossMaxHP` (red). One element, matches the reference's single top bar.

**8. Gate side resolution**
- Options: A) two discrete doors at lane x · B) road split at center, left/right halves
- Decision: **B)** — gate spans the road, split at x=0; `leader.x < 0` → left op else right op,
  evaluated once when the leader crosses the gate's Z plane. Matches reference's two side-by-side
  panels. AC5.

**9. Obstacle dodging**
- Options: A) obstacle spans full road (must plow through) · B) obstacle has an X-range (dodgeable)
- Decision: **B)** — obstacle occupies a config X-range; collision (member drain) only if leader
  x is within range when crossing its Z. Adds skill: dodge or pay crowd. AC7.

**10. Collision detection**
- Options: A) physics engine · B) 1-D Z-window crossing + X-overlap, per-entity `done` flag
- Decision: **B)** — no physics dependency. Each frame, entities whose Z is within
  `[prevZ, leaderZ]` and not yet resolved are processed (gate/obstacle/coin). YAGNI.

**11. Determinism / scatter**
- Options: A) `Math.random` · B) gameplay from explicit config + seeded `mulberry32` for decor
- Decision: **B)** — gameplay entities listed explicitly in config (identical every run);
  decorative trees scattered via a seeded PRNG with a fixed seed so even visuals are stable.
  AC15. (Note: `Math.random` is avoided also because it is unavailable in some harness contexts.)

**12. Game loop / timestep**
- Options: A) fixed-step accumulator · B) variable dt clamped to a max (e.g. 0.05s)
- Decision: **B)** — single `requestAnimationFrame` loop, `dt = min(realDt, 0.05)`. Sufficient
  for this game's tolerances; KISS.

**13. State machine**
- Options: A) scattered booleans · B) explicit `state` enum + `phase` sub-state
- Decision: **B)** — `state ∈ {MENU, PLAYING, WIN, LOSE}`; while PLAYING, `phase ∈ {RUN, BOSS}`.
  Transitions centralized in `Game`. AC1/AC10/AC11.

**14. Build tooling**
- Options: A) raw ES modules + import map · B) Vite + npm
- Decision: **B)** — Vite dev server + build, `three` from npm. Standard, fast HMR. `npm install
  && npm run dev`.

## 6. Design

### 6.1 Module layout

- `index.html` — canvas mount, `#hud`, `#screen-start|win|lose` overlays, `#app` styles.
- `package.json` / `vite.config.js` — `three` + `vite`; dev/build/preview scripts.
- `src/main.js` — the **single stage import site**: `import STAGE_1 from './config/stage1.js'`,
  then `new Game(STAGE_1, dom)`. Switching/adding a stage is a one-line change here (AC16); the
  engine never imports a specific stage.
- `src/Game.js` — orchestrator: owns state machine, the rAF loop, and all systems; mediates
  collisions, combat, win/lose, restart. Receives the stage `config` as a constructor argument
  and passes it to `Track`/`Crowd`/`Boss`/`Environment` — none of them import a stage file, so a
  new stage needs only new config data, not engine edits (AC16).
- `src/config/stage1.js` — the entire stage as data (see 6.7). Default export `STAGE_1`.
- `src/core/SceneManager.js` — renderer, scene, perspective camera (chase), hemisphere + dir
  light, fog, sky-gradient background; `resize()`; `chase(targetPos, dt)`.
- `src/core/Input.js` — normalizes pointer-drag / touch-drag / arrow|A-D into a signed
  `steer` intent and an absolute `targetX`; exposes `consume()` for per-frame read.
- `src/world/Road.js` — long road plane, dashed center line (instanced dashes), side guardrails
  (instanced posts), positioned to cover `[0, trackLength]`.
- `src/world/Environment.js` — ground plane, scattered low-poly trees (seeded), sky handled by
  SceneManager background.
- `src/world/Track.js` — consumes stage config; builds Gate/Obstacle/Coin/Boss entities at their
  Z; holds them in arrays; provides `entitiesNear(z0, z1)` for collision; `reset()` rebuilds.
- `src/entities/Crowd.js` — owns `count`, leader mesh, follower `InstancedMesh` (cap), formation
  slot math, per-instance lerped positions, count-plate sprite; `setCount()`, `add/mul/sub`,
  `update(dt, leaderX)`; clamps to `[0, cap]`.
- `src/entities/Gate.js` — two translucent panels (green) + two value sprites; `op` per side;
  `apply(crowd, leaderX)` returns `{good: bool}` for combo logic.
- `src/entities/Obstacle.js` — stacked tire cylinders + HP sprite; `hp`, `xRange`; `hit(crowd)`
  drains members and HP; `broken` flag, shrink/hide on break.
- `src/entities/Boss.js` — large body mesh; `hp`, `maxHp`; `update(dt, crowd)` applies mutual
  damage; exposes `hpFraction`.
- `src/entities/Coin.js` — spinning cylinder; `x`, `collected`; spin in `update`.
- `src/ui/HUD.js` — caches DOM nodes; `update(state)` writes count, combo, coins, timer (mm:ss),
  stage, and top bar width/color.
- `src/ui/Screens.js` — show/hide start/win/lose; binds Start/Restart buttons to callbacks.
- `src/util/text.js` — `makeTextSprite(text, opts)` (CanvasTexture sprite) + `updateTextSprite`.
- `src/util/rng.js` — `mulberry32(seed)`.

### 6.2 Coordinate system & camera

**Track length is derived, not authored** (DRY): `trackLength = boss.z + endPad` (e.g.
`endPad = 40`), so the road plane, fog far-plane, and tree-scatter range all extend safely past
the boss. `Road`/`Environment` compute it from `config.boss.z`; it can never end before the boss.

+Z is forward (into the level), +X is right, +Y up. Road centered on x=0 with half-width
`roadHalf` (≈3.0). Leader starts at `(0,0,0)`, advances +Z at `runSpeed`. Chase camera target =
leader; camera placed at `leader + (0, camHeight, -camBack)` looking at `leader + (0, ~1, lookAhead)`,
position lerped for smoothing. Fog (`scene.fog`) near/far tuned so distant entities fade into the
sky gradient, giving the vanishing-point look. Camera follows leader Z only (and a damped fraction
of X) so steering reads clearly.

### 6.3 Crowd & formation

`count` is an integer in `[0, cap]`. `followerCount = max(0, count-1)`. Formation slots:
`cols = 9`, `spacing = 0.32`; slot i → `col = i % cols`, `row = floor(i / cols)`; local offset
`x = (col - (cols-1)/2) * spacing`, `z = -(row+1) * spacing` (behind leader), centered and
clamped so the slot *target* `|leaderX + x| ≤ roadHalf - margin`. Each follower keeps a current
position lerped toward `leaderPos + slotOffset` (lerp factor ~ `1 - exp(-k·dt)`). **After the
lerp, the written instance X is clamped again to `±(roadHalf - margin)`** so a lagging member
can never render off-road during a fast steer (AC4). For `i ≥ followerCount`, instance scale = 0
(hidden). Matrices written into the `InstancedMesh` each frame; `instanceMatrix.needsUpdate =
true`. Leader is a separate orange capsule bobbing slightly. Count-plate sprite floats above
crowd center; its texture is regenerated only when `count` changes.

**Count mutation API.** Gate ops go through integer methods `add(n)`, `mul(n)`, `sub(n)` — each
clamps the result to `[0, cap]` and integers stay integers. Continuous boss drain goes through a
separate accumulator path `removeContinuous(amount)` (amount may be fractional): `this._removalDebt
+= amount; const whole = Math.floor(this._removalDebt); this._removalDebt -= whole; if (whole)
sub(whole);`. `_removalDebt` is reset to 0 by `setCount()`/restart. This keeps `count` an integer
while allowing sub-1-per-frame removal to accumulate (Decision 6 / AC8) instead of flooring to 0
every frame.

### 6.4 Collision & combat

Per frame after advancing the leader from `prevZ` to `z`. The leader X used for side/range tests
is the frame-end X; at `runSpeed=14` and `dt ≤ 0.05` the sub-frame error near a plane is
`≤ steerSpeed·dt` (well under a lane), accepted as within tolerance (KISS — not worth sub-stepping).
- **Gate** (single Z plane): when `prevZ < gateZ ≤ z` and not done → `gate.apply(crowd, leaderX)`:
  pick side by sign of leaderX, apply op (`add`/`mul`/`sub`), clamp to cap, regenerate count
  plate. **"Good" is defined precisely:** at apply-time, simulate *both* sides' ops against the
  current `count`; the choice is "good" iff the chosen side yields a **strictly higher resulting
  count** than the other side (exact tie counts as good). This is well-defined even when both
  sides are positive (e.g. `+15` vs `+5`, or `×2` vs `+5` which flips at count=5). Good →
  `combo++`; otherwise `combo = 0`. Note: when both sides clamp to the same value at low count
  (e.g. `−5` vs `−10` both → 0), the tie scores as good by this rule — accepted intentionally
  since combo is purely cosmetic (AC13) and not worth special-casing.
- **Obstacle** (Z plane + X-range): when crossing and `leaderX ∈ xRange` and not broken →
  `obstacle.hit(crowd)`: `drained = min(crowd.count, hp)`; `crowd.sub(drained)`; `hp -= drained`
  (strict 1 member per 1 HP — see Decision 9, no per-member knob); if `hp ≤ 0` mark broken
  (shrink out); taking obstacle damage resets `combo = 0`. Dodged obstacles (leaderX outside
  range) are simply passed (no loss).
- **Coin** (Z plane + proximity in X): when crossing and `|leaderX - coinX| < pickRadius` →
  `coins++`, mark collected, hide.
- **Boss**: when `z ≥ bossZ`, transition `phase = BOSS`; clamp leader Z at a fight standoff
  position. Each frame `boss.update(dt, crowd)`: compute damage from the **pre-removal** crowd
  value so the killing blow still lands — `boss.hp -= crowdCountThisFrame * perMemberDPS * dt`;
  then `crowd.removeContinuous(bossRemovalRate * dt)` (accumulator path, see 6.3). End-condition
  precedence is resolved in 6.5 (Win check runs before Lose check).

### 6.5 Timer & win/lose

`timeRemaining` starts at `config.timeLimit`. The per-frame order is pinned to remove all
end-condition ambiguity (AC9/AC10/AC11):

1. **Advance + decrement timer** — step leader Z/X; `timeRemaining -= dt`.
2. **Collisions / combat** — gates, obstacles, coins, and (in BOSS phase) `boss.update` with
   damage computed from the pre-removal crowd value.
3. **Win check** — `boss.hp ≤ 0 && timeRemaining > 0` → WIN.
4. **Lose check** — `timeRemaining ≤ 0 || crowd.count ≤ 0` → LOSE.

Win is checked **before** Lose, so a frame where the boss dies *and* the crowd is wiped resolves
as a Win (AC10 — the boss-kill is not stolen by a simultaneous crowd-0). Because damage uses the
pre-removal crowd value, the final crowd can deal its killing blow on the same frame it would
otherwise be removed.

### 6.6 HUD & screens

`#hud` (always visible during PLAYING): top progress bar (run distance fraction → boss HP
fraction, red), `STAGE 1`, coins, `N COMBO`, timer `m:ss`, and the live crowd count (the count
plate is in-world; HUD also shows the numeric count for clarity). `Screens` toggles
`#screen-start|win|lose`; Start calls `game.start()`, Restart calls `game.restart()`.

AC12's "boss/progress bar" is satisfied by this single phase-switching bar (Decision 7): it reads
`leader.z / bossZ` during RUN and `boss.hp / boss.maxHp` (red) during BOSS — one element matching
the reference's single top bar, not two separate bars.

### 6.7 Stage config shape

```js
export default {
  id: 'stage-1',
  timeLimit: 90,            // seconds (tunable; reference shows ~3:18)
  runSpeed: 14,             // units/sec forward
  roadHalf: 3.0,
  crowdCap: 200,
  startCount: 1,
  seed: 1337,              // decorative scatter
  bossStandoff: 4,         // distance before bossZ where the leader stops
  // Combat retuned in Phase 4 review for solvability (see 6.8). With perMemberDPS=d,
  // bossRemovalRate=r, starting boss crowd c0, total damage the crowd can deal before it
  // is drained is d*c0^2/(2r); a win needs that >= boss.hp.
  // d=1.0, r=4, hp=300  =>  win threshold c0 = sqrt(2*r*hp/d) = sqrt(2400) ≈ 49 crowd.
  combat: { perMemberDPS: 1.0, bossRemovalRate: 4 },  // obstacles are strict 1 member / 1 HP
  boss: { z: 360, hp: 300 },
  // gameplay entities, explicit positions => deterministic
  gates: [
    { z: 40,  left: ['mul', 2],  right: ['add', 5]  },
    { z: 80,  left: ['add', 15], right: ['add', 5]  },   // all-positive (reference)
    { z: 130, left: ['sub', 10], right: ['mul', 3]  },
    // ...authored across the track
  ],
  obstacles: [
    { z: 110, hp: 30, xRange: [-1.5, 1.5] },
    { z: 220, hp: 80, xRange: [-3.0, 0.5] },
    // ...
  ],
  coins: [ { z: 60, x: -1.2 }, { z: 95, x: 1.0 }, /* ... */ ],
  trees: 60,               // count; positions from seeded rng along the track sides
}
```

`Track`/`Crowd`/`Boss` read only from this object, so a "stage 2" is a new file with the same
shape (AC16). The shipped `stage1.js` is authored so a clean run ends the track ~50–100 crowd and
beats the boss with time margin (AC17) — tuned during Phase 5 playtest. Authoring rule: no `sub`
gate or obstacle is placed in the final approach band `[bossZ − bossStandoff, bossZ]`, so the
"crowd at boss entry" can't be ambushed right before the fight.

**Scope of AC16 / config vs code constants.** AC16 governs *gameplay/balance* tuning — gate value
ranges, obstacle HP, boss HP, `perMemberDPS`, `bossRemovalRate`, `crowdCap`, coin placements,
`timeLimit` — and all of those are in the config above. *Engine-feel* constants (camera offsets
`camHeight`/`camBack`/`lookAhead`, lerp `k`, `pickRadius`, formation `cols`/`spacing`/`margin`,
`endPad`) intentionally live in code as module constants, out of AC16's scope; they are feel, not
stage balance, and would be identical across stages.

### 6.8 Error handling / edge cases

- Count never negative or above cap (clamp in every mutation).
- `mul` on count 0 stays 0 (no revival); only gates with positive add can grow from low counts.
- **Boss solvability (Phase 4 fix).** Fixed removal rate `r` drains the crowd to 0 at `t = c0/r`;
  total damage dealt over that window is `∫₀^{c0/r} d·(c0 − r·t) dt = d·c0²/(2r)`. A win requires
  `d·c0²/(2r) ≥ bossHp`. The shipped config (`d=1.0, r=4, hp=300`) gives a win threshold of
  `c0 ≈ 49`, consistent with the "reach boss ~50–100 crowd" target (AC17). `stage1.js` gate/obstacle
  authoring is tuned in Phase 5 so a clean run clears the boss with comfortable margin above 49.
- **Time budget (AC17).** Run-to-boss time `= (bossZ − bossStandoff)/runSpeed = 356/14 ≈ 25.4s`,
  leaving `timeLimit − 25.4 ≈ 64.6s` for a fight lasting at most `c0/r ≈ 100/4 = 25s` (and ~12s at
  c0=49). The budget closes with wide margin; if `timeLimit`/`runSpeed`/`boss.z` are retuned, this
  inequality (`(bossZ−bossStandoff)/runSpeed + c0/r < timeLimit`) must still hold.
- **Fractional removal accumulator** lives in `Crowd._removalDebt` (see 6.3); boss drain calls
  `removeContinuous(r·dt)` so sub-1-per-frame removal accumulates instead of flooring to 0. Reset
  to 0 on `setCount`/restart.
- Damage uses the pre-removal crowd value each boss frame so the killing blow still lands; Win is
  checked before Lose (6.5).
- Resize handler keeps aspect correct; pointer math uses client rect.
- **Deterministic restart (AC14/AC15).** `Track.reset()` and `Environment.build()` **rebuild**
  entities from config rather than reusing instances, so every per-entity resolution flag
  (`gate.done`, `obstacle.broken`, `coin.collected`) starts clean. Decorative tree scatter
  constructs a **fresh `mulberry32(config.seed)`** on every build/reset, so tree positions are
  byte-identical across runs (not a persistent generator that drifts).
- `restart()` resets all game state to config defaults (timer, `count = startCount`,
  `_removalDebt = 0`, combo, coins, `phase = RUN`, leader transform).

## 7. Files Changed

- `index.html` — canvas + HUD/screens overlay markup and CSS.
- `package.json` — `three`, `vite`; scripts.
- `vite.config.js` — base Vite config.
- `README.md` — run instructions, controls, tuning notes.
- `src/main.js` — bootstrap.
- `src/Game.js` — state machine, loop, systems orchestration, collision/combat, win/lose, restart.
- `src/config/stage1.js` — the authored stage data.
- `src/core/SceneManager.js` — renderer/scene/camera/lights/fog/sky/resize/chase.
- `src/core/Input.js` — pointer/touch/keyboard steering.
- `src/world/Road.js` — road, lane dashes, guardrails.
- `src/world/Environment.js` — ground, seeded trees.
- `src/world/Track.js` — build/reset entities from config; near-query for collisions.
- `src/entities/Crowd.js` — InstancedMesh formation, count math, count plate.
- `src/entities/Gate.js` — gate pair + ops + apply.
- `src/entities/Obstacle.js` — tire stack + HP + hit.
- `src/entities/Boss.js` — boss body + HP + mutual combat.
- `src/entities/Coin.js` — coin pickup.
- `src/ui/HUD.js` — live HUD updates.
- `src/ui/Screens.js` — start/win/lose overlays + buttons.
- `src/util/text.js` — `makeTextSprite`/`updateTextSprite`.
- `src/util/rng.js` — `mulberry32`.

## 8. Verification

1. [AC1] `npm run dev`; Start screen appears; clicking Start shows crowd=1 and timer at
   `config.timeLimit`.
2. [AC2] Drag mouse / use arrows / A-D and touch (devtools mobile): leader moves L/R, never
   passes the guardrails.
3. [AC3] Visually confirm road, dashed lines, guardrails, trees, fog fade, sky gradient; no
   network requests for assets; no audio.
4. [AC4] Inspect: followers grow to a packed block, one `InstancedMesh` (one extra draw call in
   `renderer.info.render.calls`), members stay on road, formation re-packs when count changes.
5. [AC5,6] Pass several gates; choose left vs right; count changes match the op and clamp at 200;
   count plate updates instantly; never see a `÷` gate.
6. [AC7] Drive into an obstacle: members drop by its HP, it breaks at 0, run continues; steer
   around a dodgeable obstacle and take no loss.
7. [AC8,9] Reach boss: HP bar drains at ~`count×perMemberDPS`/s, crowd shrinks at removal rate,
   timer keeps counting.
8. [AC10,11] Force win (big crowd) → Win screen; force lose (run out crowd or timer) → Lose screen.
9. [AC12,13] During play HUD shows live count/combo/coins/timer/stage/top bar; collect coins
   (increment), break combo via a bad gate/obstacle (resets to 0); confirm no gameplay effect.
10. [AC14] Restart from both screens → timer reset, crowd=1, identical track.
11. [AC15] Run twice; gate/obstacle/coin/boss positions identical.
12. [AC16] Duplicate `stage1.js` → `stage2.js`, change values, point Game at it: works with no
    engine edits.
13. [AC17] Play a clean run start-to-finish: reach boss ~50–100 crowd, defeat before timer 0.
