# Crowd Runner → Soldiers-with-Guns Shooter Rework (v2)

## 1. Background

The shipped game (`docs/designs/2026-06-12-crowd-runner-game.md`) is an abstract Count-Masters
math game: gates grow a crowd, obstacles drain it 1-for-1 on contact, and an end boss is killed
by a continuous `count × perMemberDPS` DPS formula. Combat is invisible math and "more crowd"
only matters at the boss. This rework turns the crowd into **soldiers with guns** and makes combat
**visible, ranged, and continuous**, so that more soldiers = more firepower everywhere. Coins
(purely cosmetic today) are removed and replaced with gameplay power-ups, enemies are added, and
the run becomes two auto-advancing stages.

All product decisions below were locked with the user before this doc (see Decision Log).

## 2. Requirements Summary

**Goal:** Convert the abstract math game into a soldiers-with-guns shooter: continuous ranged
firepower scaling with army size, destructible road blocks, marching enemies, telegraphed boss
return-fire, power-up pickups replacing coins, and a 2-stage auto-advancing run — keeping the
gate-growth, combo, single timer, and deterministic layout from v1.

**In scope:** soldier+gun meshes; pooled visible bullet system (player visual + boss harmful);
unified `count × perSoldierDPS` ranged combat vs. the nearest *engaged* target; destructible
blocks (dodgeable + full-width) with live HP tick and crumble; marching enemy squads; boss
telegraphed dodgeable projectiles; four power-ups (Rapid fire, Reinforcements, Shield, Damage
boost); HUD active-buff indicator; 2 stages with auto-advance and crowd carry-over floored to the
next stage baseline; updated balance verifier (stepped whole-run sim), README, design doc.

**Out of scope:** per-bullet collision/physics for player fire (damage is continuous DPS, bullets
are cosmetic); enemy return fire; stage select menu (auto-advance only); persistence; audio;
external assets; >2 stages.

## 3. Acceptance Criteria

1. No coins remain: no `Coin` entity, no `coins` in any config, no coin pill in the HUD, no
   `coins` field in game state or end-screen stats.
2. The crowd renders as soldiers holding guns (merged box/capsule primitives); followers remain a
   single `THREE.InstancedMesh` (one draw call for the follower bodies).
3. Soldiers fire **visible** bullets drawn from a pooled, recycled `InstancedMesh`; the bullet
   spawn rate scales with soldier count (more soldiers visibly fire more).
4. Combat uses `perSoldierDPS` (renamed from `perMemberDPS`); army firepower
   `= count × perSoldierDPS` is applied each frame to the nearest live **engaged** target ahead
   within `fireRange` (a block, an enemy, or the boss).
5. Road blocks have HP (a float under fire) that drains while **engaged** (`leaderX ∈ xRange`) as
   the army approaches; the HP sprite ticks down live and the block visibly crumbles/breaks at 0 →
   passed with no soldier loss. If reached with HP remaining, the leftover drains
   `min(count, ceil(hp))` soldiers on contact ("1 per remaining HP", ceil), then is passed.
6. Both dodgeable blocks (a sub-range `xRange` you can steer around) and full-width must-shoot
   blocks (`xRange` spanning the road) exist. A dodgeable block you steer *out* of is simply passed
   — no fire spent on it, no loss (v1 dodge behavior). "Destroy before contact" (AC5) applies only
   to blocks you engage: full-width blocks (always engaged) or a dodgeable block you stand in.
7. During the boss phase the boss fires telegraphed projectiles toward the army; they travel with
   a visible window, are dodgeable by steering, and a hit removes a burst of soldiers. An active
   Shield negates the hit.
8. Enemy squads march toward the player, have HP, are shot down like blocks, and drain soldiers on
   contact if reached alive; they do not fire back.
9. Power-ups occupy the former coin slots and are collected by steering into them: Rapid fire
   (timed firepower boost), Reinforcements (instant +N soldiers), Shield (timed soldier-loss
   immunity), Damage boost (permanent run firepower multiplier).
10. The HUD shows the active power-up(s) with a countdown for timed buffs, in place of the coin
    pill.
11. Two stages auto-advance: defeating the stage-1 boss transitions directly into stage 2;
    defeating the stage-2 (final) boss shows the Win screen.
12. A single Restart button fully resets to the start of stage 1 (timer, crowd, stage index,
    power-ups, deterministic layout).
13. Lose triggers if the timer reaches 0 or the army reaches 0 at any point; Win triggers only
    after the final-stage boss dies with time remaining.
14. Gate +N/×N/−N growth, the combo counter, and the single per-stage countdown timer are retained
    and functional.
15. Each stage's layout is deterministic — identical entity positions every run (explicit configs +
    seeded decor).
16. `scripts/verify-balance.mjs` runs a stepped whole-run simulation proving a clean run clears
    every block/enemy and both bosses within the timers, and a careless run loses; it exits 0.
17. README and this design doc reflect the new mechanics.

## 4. Problem Analysis

Current state: combat is a single Z-crossing event (`Game._resolveCrossings`, `Game.js:118`) plus
a boss-only DPS loop (`Boss.update`, `Boss.js:52`). Obstacles instantly drain `min(count, hp)` on
contact (`Obstacle.hit`, `Obstacle.js:53`) — army size never helps. Coins are cosmetic
(`Coin.js`). The world-motion model (move the player +Z through a static world,
`crowd-runner-game.md` §6.2) is sound and is kept.

Approaches for the new combat:

- **A — Per-bullet collision.** Each bullet is a physical projectile that deals damage on hit.
  Realistic but non-deterministic (fire-rate jitter, travel time vs. fast approach), breaks the
  determinism AC and the closed-form verifier. Rejected.
- **B — Continuous DPS + cosmetic bullets (chosen).** Damage is `count × perSoldierDPS × dt`
  applied to the nearest engaged target each frame (extends the existing boss formula to all
  targets); bullets are visual-only, drawn from a pool aimed at the target. Deterministic,
  reuses the proven boss math, cheap. Chosen.
- **C — Keep instant contact damage, just re-skin.** Minimal work but fails "destroyable by
  shooting" and "more soldiers more powerful" for blocks. Rejected.

Boss return-fire is the one place real projectile travel is needed (the dodge window is the
mechanic), so **boss bullets are simulated** (position+velocity, x-proximity collision at the army
Z) while **player bullets are cosmetic**. Both share one pooled `Bullets` module.

## 5. Decision Log

**1. Player-fire damage model**
- Options: A) per-bullet collision · B) continuous DPS, bullets cosmetic · C) instant contact only
- Decision: **B)** — deterministic-enough (see Decision 9), reuses the existing boss DPS formula,
  keeps the verifier sim simple; bullets are visual juice. (AC3, AC4)

**2. What makes a target "engaged" (why dodging matters)**
- Options: A) army always shoots the nearest target regardless of x · B) target engaged only when
  `leaderX ∈ target.xRange`
- Decision: **B)** — reuses `Obstacle.inRange`; steering off a block's range stops both your fire
  on it and its contact damage, so dodging is meaningful. A dodged dodgeable block is *passed* (no
  fire, no loss) — it is never auto-cleared from outside its range; AC5's "destroy before contact"
  applies only to engaged blocks. Full-width blocks use a road-spanning `xRange` (always engaged).
  The boss is always engaged. **Single-target focus fire:** when several targets sit within
  `fireRange`, only the nearest engaged one (lowest Z) takes `F×dt` each frame — accepted as the
  rule (KISS); the verifier models exactly this ordering so balance stays honest. (AC4, AC5, AC6)

**3. Boss return-fire**
- Options: A) hitscan (undodgeable) · B) simulated projectile aimed at army-x at fire time,
  telegraphed
- Decision: **B)** — travel time is the dodge window; spawn with a muzzle flash telegraph. Hit =
  remove a burst of soldiers unless Shield active. (AC7)

**4. Enemies**
- Options: A) static squad (a re-skinned block) · B) deterministic slow march toward the player
- Decision: **B)** — marches `−Z` at a fixed `marchSpeed` (no RNG, deterministic); shot down like
  a block while engaged; contact (enemyZ ≤ leaderZ) drains leftover HP. No return fire (scope).
  **Closing-speed bound:** authoring keeps `(runSpeed + marchSpeed) × MAX_DT ≪ fireRange` so an
  enemy spends many frames inside `fireRange` before contact and can't skip the fire window in one
  step (amplifies v1's sub-frame Z tolerance, so it must stay small). (AC8)

**5. Stage flow & crowd carry-over**
- Options: A) reset crowd to startCount each stage · B) carry crowd over · C) carry, floored to
  next stage's startCount
- Decision: **C)** — rewards a big army but `count = max(carried, stage2.startCount)` guarantees
  stage 2 is solvable from its own baseline regardless of stage-1 outcome. Timer resets to the new
  stage's `timeLimit`; leaderZ→0; camera snaps. **Authoring rule (floor survivability):** stage 2's
  first growth gate precedes any full-width block / mandatory enemy, and total mandatory pre-growth
  drain `< startCount`, so a floored army can grow before it can be wiped. (AC11, AC12, AC13)

**6. Power-up semantics**
- Options: per-type timed vs. permanent vs. charge
- Decision: Rapid fire = `firepower ×= rapidMult` for `rapidDuration` s (a **flat** multiplier; a
  second pickup only refreshes `rapidUntil`, never stacks the factor) · Reinforcements = instant
  `add(reinforce)` · Shield = negate all soldier-loss for `shieldDuration` s (also refresh-only) ·
  Damage boost = **additive, capped** `dmgMult = min(dmgCap, dmgMult + dmgBoostStep)` for the rest
  of the run. All effects live in `Game` state; combat reads them. (AC9, AC10)
- **Revised after Phase 4 review:** (a) Damage boost is capped (`dmgCap ≈ 1.6`, e.g. step 0.15)
  rather than unbounded multiplicative; (b) Rapid fire and Shield are flat + refresh-only (no
  multiplicative re-stacking while active). Together these stop any buff from swamping the
  `count × perSoldierDPS` term, preserving the "more soldiers = more powerful" thesis. **Power-ups
  are pure upside:** the solvability proof (Decision 9) assumes *no* power-ups, so their
  reachability and stacking are never load-bearing — they only make a clean run easier.

**7. Soldier mesh / draw calls**
- Options: A) capsule only (no visible gun) · B) merge body+gun+helmet into one geometry
- Decision: **B)** — `BufferGeometryUtils.mergeGeometries` yields one geometry, so the follower
  `InstancedMesh` is still a single draw call while clearly showing a gun. Leader stays a *separate*
  `Mesh` (same merged geometry, larger, orange) as in v1. Army green/blue, enemies red. **Accepted
  cost:** merging gun+helmet ~2–3×'s per-instance vertices vs. the bare capsule; we keep both
  low-poly (few segments) and the geometry is shared, so it remains one draw call with bounded
  throughput at `crowdCap=200`. (AC2)

**8. Multi-stage wiring**
- Options: A) `Game` imports stages · B) `main.js` passes a stages array
- Decision: **B)** — `new Game([STAGE_1, STAGE_2])`; `Game` owns `stageIndex` and advance/restart.
  Keeps the engine stage-agnostic (v1 AC16 spirit). (AC11, AC12)

**9. Balance verification**
- Options: A) closed-form inequality · B) stepped whole-run simulation
- Decision: **B)** — ranged combat with engaged targets, enemies marching, and power-ups is not a
  clean closed form; a stepped sim (fixed `dt = 1/60`; advance, gates, single-target engaged
  firepower, contact drains, boss + boss-fire, chained across both stages) is the honest proof.
  **The fixed-step sim is the balance *contract*, not a bit-exact replay of the browser** (which
  uses variable `dt ≤ MAX_DT`); AC15 requires identical *layout* only, not bit-identical outcomes,
  so the clean run must clear with enough margin to absorb `dt` variance. **Clean-run policy
  (proves solvability WITHOUT power-ups — they are pure upside):** best-side gates, dodge every
  dodgeable block, must-shoot every full-width block and enemy, never stand in boss bullets, **no
  power-ups assumed** (so power-up reachability vs. best-gate x never affects the proof).
  **Careless policy (must lose):** worst gates, ignore/stand-in every block and enemy, no power-ups.
  Stage 2 is checked from **both** the floor (`startCount`, must still win) and the carried clean
  count (total time-budget + must not be trivial); the careless path is chained through both stages.
  The obsolete v1 `d·c0²/(2r)` break-even and `bossRemovalRate` are removed. (AC16)

## 6. Design

### 6.1 Combat core (Game)

Per-frame order is preserved and extended (v1 §6.5):

1. **Advance + timer** — step leaderZ/X; `timeRemaining -= dt`. In RUN, clamp to `bossEntryZ` then
   `phase = BOSS`.
2. **Tick buffs** — decrement timed power-ups (rapid fire, shield); compute effective firepower
   `F = crowd.count × perSoldierDPS × dmgMult × (rapidActive ? rapidMult : 1)`.
3. **Acquire target (single-target focus fire)** — `target =` the *nearest* live entity with
   `z ∈ (leaderZ, leaderZ + fireRange]` that is engaged (`boss` in BOSS phase, else a block/enemy
   with `leaderX ∈ xRange`), ties broken by lowest Z. Apply `F × dt` to that one target's `hp`; if
   it drops ≤ 0 mark broken/dead. Only one target is damaged per frame — a farther threat in range
   waits its turn (the verifier models the same ordering). Spawn cosmetic player bullets toward the
   target at a rate `∝ min(count, k)` (capped).
4. **Crossings / contact** — gates (unchanged), block contact (`min(count, ceil(hp))` drained
   unless shielded), enemy contact, power-up pickup. Combo resets on a bad gate or **any actual
   soldier-loss**.
5. **Boss** — in BOSS phase, `boss.update(dt, F)` drains boss HP by `F×dt` and fires telegraphed
   projectiles on a cadence; boss bullets advance and, on reaching the army point, remove a burst of
   soldiers unless shielded. A boss-bullet hit that removes soldiers **also resets combo** (this
   path is in `Game`, not `_resolveCrossings`, so it must be wired explicitly). The boss no longer
   drains crowd at a fixed rate — its only threat is its bullets. Note: there are no gates in the
   BOSS phase, so combo can only fall (on a bullet hit), never rise — combo is effectively
   frozen-then-resettable here. Accepted (combo is cosmetic, AC14); not a bug to "fix".
6. **Win check** — boss.hp ≤ 0 && time > 0 → advance stage, or WIN if final.
7. **Lose check** — time ≤ 0 || count ≤ 0 → LOSE.

`fireRange`, `rapidMult/Duration`, `shieldDuration`, `reinforce`, `dmgBoostStep`, and boss-fire
cadence/damage live in config (per stage where they affect balance; feel constants in code).

### 6.2 Bullets (`src/entities/Bullets.js`)

One pooled `InstancedMesh` class, capacity `CAP` (e.g. 120), reused for both player and boss fire
via two instances:
- `spawn(from, toOrDir, speed, life)` activates a free slot; `update(dt)` advances all active
  bullets and frees expired ones (life elapsed or passed target).
- **Player pool:** cosmetic small bright tracer; spawned each frame from random soldier muzzles
  toward the current target, capped spawn rate; never collides.
- **Boss pool:** larger red orb; the army is treated as a **single point** `(leaderX, leaderZ)`
  for collision (the multi-row formation is collapsed to the leader). `Game` checks each active boss
  bullet (`|bx − leaderX| < HIT_RADIUS` when `bz ≤ leaderZ + ε`) → `removeBurst` soldiers unless
  shielded, then frees the bullet. `HIT_RADIUS` is **derived** from `Crowd`'s exported formation
  half-width `((COLS-1)/2) × SPACING ≈ 1.36` (+ a soldier radius), not a magic literal — so a
  future `COLS`/`SPACING` change keeps boss-bullet fairness in sync (DRY). It stays well inside
  `roadHalf=3`, so steering reliably clears the line.

Both pools are **cleared** on `restart()` and on `_advanceStage()` so no active bullet leaks across
a reset/stage change. Deterministic note: muzzle/jitter uses an index-derived offset, not
`Math.random` (unavailable in some harness contexts, v1 §6.7), so visuals stay stable.

### 6.3 Crowd / soldiers (`src/entities/Crowd.js`)

`makeSoldierGeometry()` merges a body capsule + a small gun box (+ helmet box) via
`BufferGeometryUtils.mergeGeometries`. Followers use it in the existing `InstancedMesh` (one draw
call); leader is the same geometry, scaled up, orange. Count math (`add/mul/sub/removeContinuous`),
formation packing, and the count plate are unchanged. New: `frontPosition()` and a `muzzleAt(i)`
helper for bullet spawn origins; `removeBurst(n)` is just `sub(n)`.

### 6.4 Obstacles → destructible blocks (`src/entities/Obstacle.js`)

Keeps `z`, `hp`, `xRange`, `inRange`. `hp` becomes a **float** while under fire. `damage(amount)`
lowers HP, updates the HP sprite (shown as `ceil(hp)`), and on ≤ 0 marks `broken` and crumbles
(scale-out). `contact(crowd, shielded)` runs only if reached with `hp > 0` and engaged: drains
`min(count, ceil(hp))` soldiers unless shielded ("1 per remaining HP", ceil — the verifier uses the
same rounding). A `fullWidth` block is just `xRange:[-roadHalf, roadHalf]`. Visual: tire-stack
kept, tinted by remaining HP fraction.

### 6.5 Enemies (`src/entities/Enemy.js`)

Rows of red soldier instances (reusing the soldier geometry) with `hp`, `xRange`, `z`, and a fixed
`marchSpeed`. `update(dt)` moves the group `−Z`. `damage()`/`contact()` mirror the block. `Game`
treats enemies as targets in the same acquisition pass and as contact threats when `z ≤ leaderZ`.

### 6.6 Boss return-fire (`src/entities/Boss.js`)

`update(dt, firepower)` drains `hp -= firepower × dt` (firepower already includes count and
multipliers, computed by `Game`) and accumulates a fire timer; when it exceeds `fireInterval` it
asks `Game`/its boss-bullet pool to spawn a projectile aimed at the army's current x with a brief
muzzle-flash telegraph. Exposes `hpFraction`. Boss no longer drains crowd directly via a fixed
rate — the threat is now its bullets (configurable `fireInterval`, `burst`).

### 6.7 Power-ups (`src/entities/Powerup.js`)

Replaces `Coin.js`. Spec `{ z, x, type }` where `type ∈ {rapid, reinforce, shield, damage}`.
Distinct primitive + color per type, spins for shimmer, hides on pickup. `Game` applies the effect
on pickup (`leaderX` within `PICK_RADIUS`) and tracks active buffs in state:
`rapidUntil`, `shieldUntil` (timed), `dmgMult` (permanent, capped at `dmgCap`). HUD reads these.

### 6.8 HUD & screens

`index.html`/`HUD.js`: remove the coin pill; add a `#hud-buffs` row showing active power-up chips
(icon + remaining seconds for timed ones, "DMG ×N" for the stacked damage boost). Stage label
reads the current stage's `label`. The single top bar keeps phase-switching semantics
(run-distance → boss HP). `Screens` adds no new screens (auto-advance is silent, optional brief
"STAGE 2" flash via HUD); Win/Lose unchanged. Stage advance is handled in `Game` (not a screen).

### 6.9 Multi-stage (`Game` + `main.js`)

`main.js`: `new Game([STAGE_1, STAGE_2])`. `Game` holds `stages`, `stageIndex`, and `config`
(current). `_advanceStage()`: rebuild `Track` for the next stage, `crowd.setCount(max(count,
next.startCount))` (which zeroes `_removalDebt`), reset timer/leaderZ/phase, **clear both bullet
pools**, **clear timed buffs (`rapidUntil`/`shieldUntil`) but keep the permanent `dmgMult`** (rest
of the run, Decision 6), snap camera, flash the new label. `restart()` → `stageIndex = 0`, clear
**all** buffs (including `dmgMult`), **clear both bullet pools**, full reset.
Win only fires after the final stage. `Track.dispose()` is extended to remove enemies + power-ups
and the coin branch is deleted.

### 6.10 Config shape additions (per stage)

```js
combat: { perSoldierDPS, fireRange },          // perSoldierDPS renamed; bossRemovalRate REMOVED
boss: { z, hp, fireInterval, burst, bulletSpeed },  // boss fires bullets, no fixed crowd drain
obstacles: [{ z, hp, xRange, fullWidth? }],    // fullWidth → xRange spans road
enemies:   [{ z, hp, xRange, marchSpeed }],
powerups:  [{ z, x, type }],                   // replaces coins; type ∈ rapid|reinforce|shield|damage
powerupTuning: { rapidMult, rapidDuration, reinforce, shieldDuration, dmgBoostStep, dmgCap },
// gates, trees, timing unchanged
```

### 6.11 Error handling / edge cases

- Count clamps `[0, cap]` in every mutation (unchanged). Shield negates *all* soldier-loss while
  active (block/enemy contact + boss bullets). Combo resets on any actual soldier-loss.
- Target acquisition skips broken/dead/picked entities; ties broken by lowest Z.
- Boss bullets that miss expire by life; on stage advance the boss-bullet pool is cleared.
- Crowd carry-over floored to `startCount` keeps stage 2 solvable from baseline. The verifier
  proves stage 2 from **both** the floor (`startCount`, the worst incoming case — must win) and the
  clean carried count (for the total time-budget check and to confirm it isn't trivially won).
  Authoring rule (floor survivability): stage 2's first growth gate precedes any full-width block /
  mandatory enemy and total mandatory pre-growth drain `< startCount`, so a floored army can grow
  before being wiped (the verifier asserts this).
- Enemy closing-speed bound: `(runSpeed + marchSpeed) × MAX_DT ≪ fireRange` so a marching enemy
  can't cross the whole fire window in one frame.
- **Mandatory-threat non-overlap (focus-fire authoring rule):** because firepower is single-target
  (nearest engaged), two *mandatory* threats (full-width blocks + enemies) must not have
  overlapping engagement windows — space their Z so focus-fire fully destroys each before the next
  becomes engageable. The verifier enforces this operationally by asserting **the clean run takes
  zero contact drain** from blocks/enemies (any overlap that lets a threat reach contact at >0 HP
  fails the check), so AC5/AC8's "no soldier loss on a clean run" holds. Dodgeable blocks are
  exempt (the clean run steers around them).
- **Buff carry across stage advance:** per Decision 6 the permanent `dmgMult` persists into stage 2
  ("rest of the run"); timed buffs (`rapidUntil`/`shieldUntil`) are **cleared** on `_advanceStage()`
  so a stage-1 Shield can't bleed into stage 2. `setCount` already zeroes `_removalDebt`. The
  verifier's per-stage proof runs with no power-ups (so `dmgMult = 1`, timed buffs off), keeping the
  floor proof honest.
- Determinism scope: layout is bit-identical (explicit configs + seeded decor + index-derived
  bullet jitter, no `Math.random`). Combat *outcomes* use variable `dt ≤ MAX_DT` in-browser, so
  they are not bit-exact across machines; the fixed-step verifier is the **balance contract** and
  the clean run must clear with margin to absorb `dt` variance (AC15 needs only identical layout).

## 7. Files Changed

- `src/config/stage1.js` — drop coins; add `perSoldierDPS`/`fireRange`, `enemies`, `powerups`,
  `powerupTuning`, boss fire fields; retune; some blocks `fullWidth`.
- `src/config/stage2.js` — **new** second stage (harder), same shape.
- `src/main.js` — pass `[STAGE_1, STAGE_2]`.
- `src/Game.js` — buff state, firepower computation, target-acquisition + apply-damage pass,
  block/enemy/power-up resolution, boss-bullet collision, stage advance, remove all coin logic.
- `src/entities/Bullets.js` — **new** pooled bullet `InstancedMesh` (player cosmetic + boss
  harmful).
- `src/entities/Crowd.js` — soldier+gun merged geometry; muzzle/front helpers; `removeBurst`.
- `src/entities/Obstacle.js` — `damage()`/`contact()` ranged-HP model; crumble; HP-fraction tint.
- `src/entities/Enemy.js` — **new** marching enemy squad.
- `src/entities/Boss.js` — firepower-driven HP drain + telegraphed projectile fire; drop fixed
  crowd drain.
- `src/entities/Powerup.js` — **new**, replaces `Coin.js`.
- `src/entities/Coin.js` — **deleted**.
- `src/world/Track.js` — build/dispose enemies + power-ups; drop coins; expose target lists.
- `src/ui/HUD.js` — remove coin pill; add active-buff row; stage label per stage.
- `src/ui/Screens.js` — unchanged behavior (verify no coin stats).
- `index.html` — remove coin pill markup; add `#hud-buffs`; CSS for buff chips.
- `scripts/verify-balance.mjs` — replace the closed-form `d·c0²/(2r)` threshold + `bossRemovalRate`
  logic entirely with a stepped whole-run sim across both stages (clean vs. careless policies per
  Decision 9), asserting floor-survivability and non-trivialization.
- `README.md` — new mechanics, controls, tuning.

## 8. Verification

1. [AC1] Grep shows no `Coin`/`coins`; no coin pill in DOM; end stats omit coins.
2. [AC2] Followers visibly carry guns; `renderer.info.render.calls` shows one instanced follower
   draw call.
3. [AC3] Bullets stream from the army; spawning more soldiers visibly increases fire.
4. [AC4] `grep perSoldierDPS` in config + code; blocks/enemies/boss all lose HP from a distance,
   faster with a bigger army.
5. [AC5,6] Approach a low-HP block with a big army → destroyed before contact, no loss; approach a
   high-HP full-width block with a small army → reach it with HP left, lose that many soldiers;
   steer off a dodgeable block → no fire spent, no loss.
6. [AC7] At the boss, projectiles telegraph and fly; standing in one removes a burst; steering
   dodges; Shield active → no loss on hit.
7. [AC8] An ignored enemy squad reaches the army and drains soldiers; shooting it down first
   prevents loss.
8. [AC9,10] Drive through each power-up → effect applies; HUD chip shows with countdown for timed
   buffs.
9. [AC11,12,13] Beat stage-1 boss → stage 2 starts with carried army; beat stage-2 boss → Win;
   run out of time or army → Lose; Restart → stage 1 fresh.
10. [AC14] Gates still grow/shrink; combo shows and resets on damage; timer counts down.
11. [AC15] Two runs of a stage produce identical layouts.
12. [AC16] `node scripts/verify-balance.mjs` → clean run clears both stages within timers, careless
    run loses; exit 0.
13. [AC17] README/design reflect the rework.
