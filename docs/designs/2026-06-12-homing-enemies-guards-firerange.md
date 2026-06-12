# Homing enemies, shrinking + off-lane road guards, longer fire range + rebalance

## 1. Background

Three gameplay changes from a reference-video review:
1. Enemies should home toward the player (X and Z), not just march in Z.
2. Road guards (tire stacks) should visibly shrink when shot, and be damageable even when the player is off-lane.
3. Firing range should be longer (22 → ~32), with the balance verifier re-tuned to green.

**Critical context:** the requirement was written against a *pre-refactor* codebase that had static
`src/config/stage1.js` / `stage2.js` / `stage3.js` files with literal `enemies[]` arrays and a
`combat.fireRange` field. Commit `ba54900` ("endless procedural stages") replaced all of that with a
single pure procedural generator, `src/config/generator.js`. So:
- There are **no** stage files. `FIRE_RANGE` is one constant (`generator.js:38`); enemy/obstacle specs
  are built in the generator's z-order pass (`generator.js:~225`).
- `difficulty.js` has **no** `marchSpeed` mult — its contract (lines 12–14) *forbids* the mult from
  touching `marchSpeed` / `enemy.hp` / etc. Hard difficulty comes from a curve **offset**, not mults.
- All line numbers in the original issue are stale; every concept still maps cleanly.

Baseline: `node scripts/verify-balance.mjs` is **green** on Normal + Hard before any change.

## 2. Requirements Summary

Goal: implement the three changes faithfully, retargeted onto the procedural generator, keeping the
statistical balance contract green.

Scope:
- `src/entities/Enemy.js` — X+Z homing.
- `src/entities/Obstacle.js` — visible tire-stack shrink.
- `src/Game.js` — pass `leaderX` to enemy update; off-lane target acquisition.
- `src/config/generator.js` — narrow enemy squads, add `chaseSpeed`, raise `FIRE_RANGE`, rebalance.
- `scripts/verify-balance.mjs` — model off-lane obstacle targeting; re-tune.
- `src/config/difficulty.js` — **no change** (see Decision 2).

Out of scope: any non-procedural "stage file" edits (those files don't exist).

## 3. Acceptance Criteria

1. **Homing in game:** a living enemy squad's center lerps toward the player's X at `chaseSpeed`
   while marching in −Z; the death/dying branches do **not** home. Tag + soldiers ride the group.
2. **Can't dodge enemies:** an enemy squad reaching the army drains soldiers (contact) essentially
   regardless of the player's lateral position; the silent slip-past branch survives as a now-rare
   fallback (not deleted).
3. **Visible shrink:** as a road guard takes damage, each tire column physically loses its top tires
   (showing `ceil(tiersPerCol × hpFrac)` per stack), in addition to the existing green→red tint and
   count tag.
4a. **Off-lane targeting:** the crowd auto-targets the nearest obstacle ahead within range regardless
   of lane (`o.inRange` dropped in `_acquireTarget`) for **all** obstacles (full-width + dodgeable).
4b. **Contact only on physical hit:** you LOSE soldiers only on physical contact — full-width guards
   always drain on cross; dodgeable side-blocks drain ONLY when the player is inside their sub-range
   (`inRange` retained in `_resolveCrossings`).
5. **Longer range:** `combat.fireRange === 32` (was 22) in every generated stage, both tiers.
6. **Balance green:** `node scripts/verify-balance.mjs` exits 0 with all checks PASS on Normal AND
   Hard (clean wins 1–5 zero-drain with margin, sloppy + careless lose by stage 5, boss fight band
   [5,18]s, run+fight within timer, monotone boss-drain, gates count-dependent).
7. **No regressions:** game boots and runs (`npm run build` / dev server) without errors.

## 4. Problem Analysis

- **Enemies already span the full road.** In the procedural generator marching enemies use
  `xRange: [-ROAD_HALF, ROAD_HALF]` (`generator.js:225`), and `leaderX` is clamped to the road, so
  `inRange` is *already* always true — the "dodge out of the lane" exploit the issue describes does
  not exist here, and the silent-dodge branch is already dead code.
  - **Approach A (full-width visual slide)** — keep full-road squads, slide the center by `off`.
    Rejected: half the squad overhangs the road at the extremes (ugly), and homing is mechanically a
    no-op.
  - **Approach B (narrow squads + home)** — give enemies a narrower centered `xRange` (a real
    "squad") and lerp it to track the player. *Chosen:* homing becomes meaningful and stays on-road;
    the verifier is unaffected (it models enemies by Z only, never X), so the balance contract holds.

- **Off-lane guards.** Targeting and contact are two separate code paths. Dropping `inRange` only in
  `_acquireTarget` (targeting) while keeping it in `_resolveCrossings` (contact) gives exactly the
  desired "shoot anything ahead, only get hurt by what you run into."

- **`FIRE_RANGE` is a global PACING constant, not a local "range" knob.** It feeds: `slot =
  FIRE_RANGE+GAP` (threat spacing, `generator.js:170`), the enemy HP `window` (`generator.js:223`),
  `maxThreats` (`generator.js:171`), and therefore the clean carry army `cleanEnd` → boss
  `bulletDamage` (`generator.js:252`). Raising 22→32 makes `slot=38`, dropping `maxThreats` by ~⅓
  (fewer mandatory threats fit), which means LESS run attrition → a LARGER boss-entry army → a
  potentially LONGER boss fight (toward the 18s ceiling). Verification must therefore confirm the
  boss fight band + threat distribution, not merely that the verifier exits 0.

## 5. Decision Log

**1. Homing mechanic — full-width slide vs narrow-and-home**
- Options: A) keep full-road squads, cosmetic slide · B) narrow squads + home
- Decision: **B)** — only B makes "full homing" meaningful and on-screen-correct; verifier-neutral
  because enemy X is not modeled in the contract. (User was asked, did not answer → recommended
  default; flip in review if wrong.)

**2. chaseSpeed on Hard — tier-independent vs new mult**
- Options: A) fixed generator constant like `marchSpeed`, no `difficulty.js` change · B) add a Hard
  `chaseSpeed` mult
- Decision: **A)** — `difficulty.js`'s explicit invariant forbids the mult from touching enemy
  movement props; Hard already homes "as-if-deeper" via the curve offset (denser/tankier squads).
  `difficulty.js` is therefore **not** modified, deviating from the (stale) issue file-list. (User
  asked, did not answer → recommended default.)

**3. Stale file targets (`stage1/2/3.js`)**
- Decision: retarget all such edits to `src/config/generator.js`. No alternative — those files were
  deleted in the procedural refactor. Factual, not a judgment call.

**4. Drop `inRange` for enemies too in `_acquireTarget` (not only obstacles)?**
- Options: A) obstacles only (as literally written) · B) obstacles + enemies
- Decision: **B)** — the verifier targets enemies purely by Z (`verify-balance.mjs:87`). If the game
  only shot enemies when laterally aligned, a homing squad's early approach wouldn't be shot, the
  effective window would be shorter than the contract assumes, and a clean run could drain. Dropping
  `inRange` for enemies makes the game match the verifier's by-Z model. Homing already guarantees
  contact, so this is the consistent choice.

**5. Off-lane targeting applies to which obstacles**
- Decision: **all** ("both") — per the issue's explicit decision. Dodgeable side-blocks become
  auto-targeted as nearest-ahead, so they effectively stop being dodgeable.

**6. `chaseSpeed` magnitude + enemy squad width**
- Decision: `CHASE_SPEED = 3.5` (units/s, clamped-linear toward target X); enemy half-width ≈ 1.2
  (squad ~2.4 wide, slides within the 6-wide road). Reversible tuning constants.

## 6. Design

### 6.1 Enemy homing (`src/entities/Enemy.js`)

- Constructor (explicit fields): keep `spec.xRange` as the **base** range and add
  `this._baseX0 = x0; this._baseX1 = x1; this._baseCenter = (x0 + x1) / 2; this._off = 0;
  this.chaseSpeed = spec.chaseSpeed ?? 0`. The existing `this._x0 = x0` (used by `_layout`) stays and
  equals `_baseX0`. `_layout` keeps using the base `_x0`; the slide is applied via
  `group.position.x`, so there is no relayout per frame. **Invariant: the base range stays symmetric
  (`_baseCenter === 0`)** — the generator sets `[-ENEMY_HALF_WIDTH, ENEMY_HALF_WIDTH]`, so a squad
  killed before its first homing frame death-pops at `x=0` matching its `_layout` (no jump).
- `update(dt, leaderX = null)`:
  - dead+hidden → return; `_dying > 0` → death anim only, **no homing** (return as today).
  - alive: march `this.z -= marchSpeed*dt` (existing); then homing:
    ```js
    if (this.chaseSpeed && leaderX != null) {
      const target = leaderX - this._baseCenter      // offset that puts squad center on the player
      const step = this.chaseSpeed * dt
      this._off += Math.max(-step, Math.min(step, target - this._off))  // constant-speed chase
      this.group.position.x = this._off
      this.xRange = [this._baseX0 + this._off, this._baseX1 + this._off] // moving range for inRange/aim
    }
    ```
  - hit-flash + `group.position.z` recoil: unchanged.
- `inRange(x)` already reads `this.xRange`, which now moves. Contact uses `inRange` → rides the move.

### 6.2 Enemy spec + chaseSpeed (`src/config/generator.js`)

- Add `const CHASE_SPEED = 3.5` and `const ENEMY_HALF_WIDTH = 1.2` near `MARCH_SPEED`.
- Raise `const FIRE_RANGE = 22` → `32`.
- Enemy push becomes:
  ```js
  enemies.push({ z: e.z, hp, xRange: [-ENEMY_HALF_WIDTH, ENEMY_HALF_WIDTH],
                 marchSpeed: march, chaseSpeed: CHASE_SPEED })
  ```
  (Obstacles unchanged: full-width still `[-ROAD_HALF, ROAD_HALF]`, dodgeables keep sub-ranges.)
- **`cols`/`rows` consequence (acknowledged):** narrowing width 6→2.4 makes `cols = round(2.4/0.5)=5`
  (was capped at 9) and `rows = ceil(maxVisible/cols)` roughly doubles, so squads render narrower +
  deeper (a homing column). This is acceptable for the "swarm chasing you" feel; `ENEMY_HALF_WIDTH`
  is a reversible tuning constant — bump it (e.g. 1.4–1.5) if squads look too deep in playtest.

### 6.3 Game wiring (`src/Game.js`)

- Enemy update loop (`for (const e of this.track.enemies) e.update(dt)`) → `e.update(dt, leaderX)`.
- `_acquireTarget`: drop `o.inRange(leaderX)` for obstacles **and** `e.inRange(leaderX)` for enemies
  (Decision 4/5). Keep the `z > leaderZ && z <= far` window + `z < bestZ` nearest tie-break.
- `_resolveCrossings`: **unchanged** — obstacle + enemy contact still gated by `inRange` (you only
  lose soldiers on physical contact); the enemy silent slip-past `else` branch stays as the fallback.

### 6.4 Tire-stack shrink (`src/entities/Obstacle.js`)

Per-column (not a flat sorted list) so each stack loses its own top tire — a clean downward shrink,
no ragged floating tile (reviewer #6).

- Constructor: a guard is `cols` columns × `TIERS_PER_COL = 3` tires. When creating each tire, tag its
  height index: `tire.userData.k = k` (0 = bottom … 2 = top), and push to `this.tires`. Record
  `this.tiersPerCol = 3`.
- `_refresh()`: keep tint + count tag; add
  ```js
  const frac = Math.max(0, this.hp) / this.maxHp
  const shownPerCol = Math.ceil(this.tiersPerCol * frac)   // hp>0 ⇒ ≥1 while alive
  for (const t of this.tires) t.visible = t.userData.k < shownPerCol
  ```
  Hides the top tier of every column first, then the middle → uniform shrink, matching AC3.
- `_break()`: restore all tires visible before the crumble pop, so the death anim isn't a thin
  single-tier stack (the last `_refresh` may have left only 1 tier per column at low HP).

### 6.5 Verifier (`scripts/verify-balance.mjs`)

- Split targeting vs contact on a single shared block-object list (so HP drained in targeting is seen
  by contact):
  ```js
  const blocks = cfg.obstacles.map((o) => ({ z: o.z, hp: o.hp, done: false,
                                             contact: o.fullWidth || standDodge }))
  ```
- Targeting loop (line ~86): iterate **all** `blocks` (no `fullWidth` filter) — every obstacle is
  auto-targeted by Z, matching the new `_acquireTarget`.
- Contact loop (line ~90): only drain when `b.contact`; otherwise mark `done` (slipped past):
  ```js
  for (const b of blocks)
    if (!b.done && b.z <= z) {
      if (b.contact) { const d = Math.min(count, Math.ceil(b.hp)); count -= d; contactDrain += d }
      b.done = true
    }
  ```
- Enemies in the verifier are unchanged (already mandatory by-Z for targeting + contact). Enemy
  contact stays **unconditional** (no `inRange`), which is conservative vs the game's rare
  homing-miss slip-past: the contract **over-counts** enemy drain, never under-counts, so it cannot
  hide a clean-run break (safe direction).
- **Rebalance knob order (reviewer #4):** run the verifier; if any clean seed drains from the new
  off-lane dodgeable contention, prefer (1) narrowing dodgeable HP (`generator.js:237`,
  `cleanEnd*DPS*0.1` factor) or (2) constraining dodgeable z away from mandatory windows, BEFORE
  loosening `BETA_MIN` (which also weakens the sloppy/careless-must-lose margin). Only touch `BETA_*`
  as a last resort, and re-confirm sloppy + careless still lose 100%.

## 7. Files Changed

- `src/entities/Enemy.js` — `update(dt, leaderX)` X+Z homing; store base range/center + `_off`; read `chaseSpeed`.
- `src/config/generator.js` — `FIRE_RANGE` 22→32; add `CHASE_SPEED`, `ENEMY_HALF_WIDTH`; narrow enemy `xRange` + add `chaseSpeed`; rebalance constants as needed.
- `src/Game.js` — pass `leaderX` to `e.update`; drop `inRange` in `_acquireTarget` for obstacles + enemies.
- `src/entities/Obstacle.js` — tag each tire with its height index (`userData.k`); per-column shrink in `_refresh`; restore all tires in `_break`.
- `scripts/verify-balance.mjs` — all-obstacle targeting list + full-width(+careless) contact list; re-tune.
- `src/config/difficulty.js` — **unchanged** (Decision 2).

## 7b. Revised during implementation

- **Rebalance knob:** the only clean drain introduced by the changes was 3/500 Hard mandatory-block
  instances (max 19 soldiers) — and it was caused by **`FIRE_RANGE=32` alone**, NOT by the new
  off-lane dodgeable targeting (verified: old-`fullWidth`-only vs new-all-obstacle targeting give
  *identical* drain). So the documented "narrow dodgeable HP" knob was inapplicable; the fix was to
  give clean more clear-margin via `CLEAR_CEIL` 0.9 → **0.85** in `sizeThreat` (`generator.js`). This
  is NOT `BETA_MIN` — it lowers every mandatory's HP ceiling uniformly, so the worst-army-drains floor
  (`worstDmg·1.1/1.2`) is untouched and sloppy/careless still lose 100%.
- **Verifier hardening:** added an explicit `clean takes zero contact-drain in stages 1-5` check per
  tier (the old suite only asserted "clean wins", which silently tolerated the drain). Now guarded.
- `src/config/difficulty.js` was **not** modified (Decision 2 held).

## 8. Verification

1. [AC6] `node scripts/verify-balance.mjs` → exit 0, all PASS on Normal + Hard. Also eyeball the
   printed "median clean fight by depth" stays in-band (≈5–14s, never >18) and threat counts didn't
   collapse — confirm `FIRE_RANGE`'s pacing cascade (§4) didn't silently push the fight long.
2. [AC7] `npm run build` succeeds; dev server boots with no console errors.
3. [AC1/AC2] Manual: start a run, steer side-to-side as a squad approaches — the squad's center
   tracks you and contact still drains; it can't be dodged by lateral movement.
4. [AC3] Manual: shoot a full-width guard — each tire column loses its top tire as HP drains; tint +
   count still update; the crumble pop shows a full stack.
5. [AC4a] Manual: a dodgeable side-block ahead is auto-shot even when you're in the other lane.
6. [AC4b] Manual: stay off the dodgeable's sub-range → no soldier loss; deliberately steer into it
   with HP remaining → soldiers drain on contact. Full-width guard always drains on cross.
7. [AC5] `combat.fireRange === 32` in a generated stage (both tiers; `applyDifficulty` doesn't touch it).
