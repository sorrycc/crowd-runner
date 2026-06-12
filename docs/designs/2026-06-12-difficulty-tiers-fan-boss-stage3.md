# Difficulty Tiers + Fan/Enrage Boss + Count-Dependent Gates + Stage 3

## 1. Background

`npm run verify` is green but the game leaks difficulty in four places (measured today):

- **Timer is a non-threat.** Clean run uses ~30.2s/60s (stage1) and ~30.1s/65s (stage2) — ~50% surplus.
- **Boss is trivial.** `Boss._fire` (`src/entities/Boss.js:223-239`) spawns ONE aimed bullet per interval; the config's `burst` (11/13) is *soldiers-removed-per-hit*, not a bullet count, so "dodging" is a single strafe. Biggest leak.
- **Gates are obvious.** Red `sub` panels telegraph the bad side (`src/entities/Gate.js:15-16`); pick the biggest green — no thought.
- **Power-ups are pure upside** (no decision), and the verifier even forbids mandatory-threat overlap, so there is zero prioritization pressure.

This is a full overhaul: keep today's tuning as a **Normal** tier, add a distinct **Hard** tier as a transform, make the boss/gates/timer bite, add a third stage, and keep `scripts/verify-balance.mjs` green as the contract across 3 stages × 2 tiers.

## 2. Requirements Summary

**Goal:** More playable AND more difficult. Normal ≈ today's qualitative contract; Hard is genuinely harder in both the clock and the boss. One shared `applyDifficulty(stage, preset)` is the single source of truth for "Hard," imported by BOTH the game and the verifier.

**In scope:**
- NEW `src/config/difficulty.js` — `PRESETS = { NORMAL (identity), HARD }` + pure `applyDifficulty`.
- Boss → FAN volley + ENRAGE: rename `burst` → `bullets` (count), add `bulletDamage` (soldiers per bullet hit); `_fire` spawns N bullets in an angular fan centered on army x; enrage under ~33% HP (shorter interval, +bullets, telegraph recolor).
- Count-dependent **both-green** gate pairs in every stage config (e.g. `×2` vs `+30`); engine unchanged.
- Power-up POSITIONAL tradeoffs only (placement); no new types; `Powerup.js`/rng untouched.
- Tighter timers + denser/longer runs (more threats, faster march/run, longer tracks).
- NEW `src/config/stage3.js`; world auto-sizes to longest stage; `main.js` → 3 stages.
- UI: Normal/Hard start-screen selector → `onStart(difficulty)`; `Game.start(difficulty)` threads the tier through every stage activation; Win/Lose show the tier.
- Verifier: import shared `applyDifficulty`; run clean/careless/sloppy/undodged × 3 stages × {Normal, Hard}; new boss-volley/enrage model; Hard-only overlap-rule skip; new tier-relative checks.
- Docs: README + this design note.

**Out of scope:** difficulty persistence (in-memory only) · per-stage difficulty · new power-up TYPES or `Powerup.js`/rng changes · modeling power-up grabs in the verifier · Gate-engine changes · changing boss-bullet spawn origin (HIT_RADIUS reasoning preserved) · relaxing the clean zero-drain bar on Hard.

## 3. Acceptance Criteria

1. `npm run verify` exits 0 running clean/careless/sloppy/undodged across 3 stages × {Normal, Hard}, with the verifier importing the SHARED `applyDifficulty` from `src/config/difficulty.js` (no duplicated Hard definition).
2. CLEAN wins with ZERO contact drain on ALL 3 stages, on BOTH tiers.
3. CARELESS loses on both tiers; SLOPPY loses on both tiers.
4. Clean boss fight > 5s on every stage and both tiers (no instant melt).
5. Buffed-cap closed-form no-melt guard `meltSeconds()` > 2.5s on every stage and both tiers.
6. Clean total time (run + fight) < that stage's `timeLimit` on every stage and both tiers.
7. Undodged (best gates + competent run, eats every boss bullet) bossDrain exceeds its authored per-(stage,tier) lethal floor on every stage and both tiers.
8. Relative "Hard is tighter": for each stage, Hard clean timer-margin < Normal clean timer-margin, AND Hard undodged bossDrain ≥ Normal undodged bossDrain.
9. Mandatory-threat-overlap authoring check enforced on Normal (asserts no overlap), skipped on Hard; despite authored Hard overlaps, Hard clean still clears every threat with zero drain via priority ordering.
10. Verifier boss-phase model reflects new volley mechanics: per-volley drain = `bullets × bulletDamage`, with enrage (shorter interval / +bullets) under ~33% HP, consistent with `Boss.js` and `_resolveBossBullets`.
11. Boss `_fire` spawns N bullets in a fan centered on army x; bullet spawn origin/trajectory constants (HIT_RADIUS-relevant path) unchanged; `burst` renamed to `bullets`; `bulletDamage` is the per-bullet drain.
12. Gate values in every stage config are count-dependent both-green pairs where the optimal side flips with count (no trivially-dominant option), **machine-asserted by a `gateFlips` check in the verifier**; best/worst-path comments re-derived.
13. Power-ups remain pure-upside types but positioned so grabbing one costs army or position; no new types; `Powerup.js`/rng unchanged.
14. `src/config/stage3.js` exists (same shape, hardest finale), wired via `Game([STAGE_1, STAGE_2, STAGE_3])`; world geometry auto-sizes to the longest stage.
15. Start screen presents Normal + Hard buttons; selecting one calls `onStart(difficulty)`; the tier applies to all 3 stages; on win/lose restart the player returns to the start screen to re-pick (no persistence).
16. `Game.start(difficulty)` stores the tier and runs the active stage through `applyDifficulty` at every activation (`_beginStart`, `_advanceStage`, `restart`); Win/Lose screens show the tier.
17. Normal plays approximately as today (criteria 2–6 on Normal); Hard is genuinely harder in BOTH clock and boss (criterion 8 + applied Hard multipliers).
18. `README.md` updated and this design note describes the difficulty transform, fan/enrage boss, count-dependent gates, and verifier contract changes.

## 4. Problem Analysis

- **Per-tier duplicate configs** (a `stage1-hard.js` etc.) — rejected: 6 files to keep in sync, and the verifier would need its own copy of "Hard." Violates DRY.
- **Hard as a runtime multiplier transform** (chosen) — one `applyDifficulty(stage, preset)` consumed by both the game (`Game._activeStage`) and the verifier. Stage files remain the Normal baseline; "Hard" is defined once. Adds the tier with zero config duplication.
- **Boss bullet-count vs in-game fan geometry (reviewer pt 1/2).** A *wide* fan would spread bullets across x, so a stationary army could NOT eat all N — outer bullets land outside `HIT_RADIUS` and miss, making the verifier's eat-all model over-count. We resolve this by making the fan **narrow enough that the whole volley stays within `HIT_RADIUS` of its center at the army's distance** (worked in Decision 5), so "undodged eats `bullets × bulletDamage`" is *faithful*, not an over-count. The fan still forces a real dodge: the volley covers a ~2.6-unit band, so escaping means moving the whole formation to a road edge, not a micro-step. The verifier stays at today's dodge-all/eat-all abstraction level, now justified by geometry.
- **Enrage params location.** Putting them in `Boss.js` would force the verifier to import THREE + a canvas-using `text.js`. Instead enrage is DATA on `boss.enrage` in each stage config (consistent with "stage as data") — both `Boss.js` and the verifier read it. **The enrage threshold + active-bullet-count logic itself is a shared pure helper `bossVolley()` (Decision 6), not hand-copied into each** — avoiding the second source-of-truth the reviewer flagged (pt 15).

## 5. Decision Log

**1. How is "Hard" represented?**
- Options: A) duplicate per-tier stage files · B) runtime `applyDifficulty(stage, preset)` transform · C) inline `if (hard)` scattered in entities
- Decision: **B)** — single pure transform in `src/config/difficulty.js`, imported by game + verifier. DRY, single source of truth, no entity changes.

**2. How does `applyDifficulty` clone?**
- Options: A) hand-written structured clone · B) `JSON.parse(JSON.stringify())` deep clone then multiply · C) shallow spread
- Decision: **B), and ALWAYS clone (both tiers)** (reviewer pt 8/9) — stage configs are pure JSON-serializable data (no functions); deep-clone then apply multipliers to known fields. Normal applies no multipliers but still returns a fresh clone tagged `tier: 'normal'`; Hard returns a transformed clone. Cloning on both removes the asymmetric-aliasing footgun (Normal would otherwise alias the imported module singleton) for negligible cost (tiny configs, once per stage activation, never per-frame). `this.config` is treated read-only regardless.

**3. Hard multiplier set (starting point, verifier-tuned).**
- timeLimit ×0.85 · runSpeed ×1.12 · boss.hp ×1.3 · boss.fireInterval ×0.85 · boss.bulletSpeed ×1.15 · boss.bullets **+2** (additive) · obstacle hp ×1.2 · enemy hp ×1.2 · enemy marchSpeed ×1.15 · powerupTuning.reinforce ×0.8.
- Decision: apply exactly these as the starting transform; **exact factors are tuned against the verifier** until all checks pass. hp/bullets/reinforce round to ints; times/speeds stay float. `boss.z`, `crowdCap`, `perSoldierDPS`, gate values are NOT transformed (track length + gate math identical across tiers; only pacing/lethality scale).
- **Risk (reviewer pt 6):** `marchSpeed ×1.15` + `enemyHp ×1.2` both shrink the kill-before-contact window, the riskiest pair for clean's zero-drain bar on Hard (AC2). The verifier's clean-zero-drain check on Hard IS the machine test for this; if it can't be satisfied by spacing/positioning, the marchSpeed factor is the first to reduce or drop. `runSpeed ×1.12` partly offsets (army reaches enemies sooner with more DPS accumulated).

**4. Boss volley model.**
- Decision: `boss.burst` → `boss.bullets` (projectile count); add `boss.bulletDamage` (soldiers lost per bullet hit). In-game each connecting bullet drains `bulletDamage` (`Game._resolveBossBullets`); a full fan of N connecting = `N × bulletDamage`. Verifier models undodged volley drain = `bullets × bulletDamage` — faithful because the narrow fan (Decision 5) keeps every bullet within `HIT_RADIUS` of a stationary centered army.

**5. Fan geometry (with worked HIT_RADIUS check — reviewer pt 1/2).**
- Decision: a FIXED total fan angle `FAN_ANGLE = 0.13 rad`, bullets spaced evenly within it: `offset_i = N>1 ? (i/(N−1) − 0.5)·FAN_ANGLE : 0` (center on army x; N=1 → straight). Rotate the horizontal component by `offset_i` about Y; horizontal magnitude + dy preserved → `dist`/speed identical for every bullet (speed-preserving). Fixed total angle means the band width is constant regardless of bullet count.
- **Geometry proof:** army-to-boss distance ≈ `bossStandoff = 20`. Outermost lateral offset at the army = `20·tan(FAN_ANGLE/2) = 20·tan(0.065) ≈ 1.30`. `HIT_RADIUS = FORMATION_HALF_WIDTH + 0.2 ≈ 1.56`. Since `1.30 < 1.56`, every bullet of a stationary centered army connects → eat-all faithful. The covered band is `2·1.30 ≈ 2.6` units wide, forcing a real dodge (road width `2·roadHalf = 6`). Spawn origin `(0, 1.9, z−1.4)` + `ty=0.6` unchanged (AC11). `FAN_ANGLE` is re-checked if `bossStandoff` changes per stage.

**6. Enrage + shared volley helper (DRY — reviewer pt 15).**
- Options: A) constants in Boss.js (verifier must import THREE) · B) data on `boss.enrage` config + a shared pure helper read by both · C) hand-copy the threshold/count math into Boss.js AND the verifier
- Decision: **B)** — `boss.enrage = { below: 0.33, fireIntervalMult: 0.7, bulletsAdd: 2 }` per stage config (data-driven). The enrage *logic* lives in ONE shared pure helper exported from `difficulty.js` (the existing no-THREE, import-nothing game+verifier module): `bossVolley(boss, hpFraction) → { interval, bullets, enraged }` (takes an explicit 0..1 fraction so the game's live-hp instance and the verifier's config-max object agree — reviewer R2 pt 1). When `hpFraction < boss.enrage.below`, it returns `interval = fireInterval·fireIntervalMult` and `bullets = bullets + bulletsAdd`; else the base values. `Boss.js` uses `{interval, bullets}` to gate firing + size the fan (+ `enraged` to recolor the telegraph, cosmetic); the verifier uses `{interval, bullets}` and multiplies `bullets × bulletDamage` for drain. Single source for the enrage threshold + bullet count — no hand-copied arithmetic. `applyDifficulty` leaves `enrage` ratios unchanged (Hard already shortens base interval + adds bullets).

**7. Count-dependent both-green gates (with cap-convergence invariant — reviewer pt 5).**
- Decision: replace `sub` panels with both-green pairs mixing `add`/`mul` so the optimal side flips with count (e.g. `×2` beats `+30` only past count 30). The verifier's clean = `max(left,right)` (perfect count-tracker); worst = `min` (deliberately under-grows). At low count `min(×N, +k)` compounds to a tiny army → wiped by the first mandatory threat, exactly how worst-path loses today. No engine change; `Gate.panelColor` keeps green for both (no red telegraph).
- **Invariant:** the min-path must be WIPED at a mandatory threat *before* any path can reach `crowdCap` — otherwise a capped min-path converges with clean (both `×N` at cap are no-ops) and "sloppy loses" breaks. So early gates keep the min-path well under cap, and only POST-wipe-point gates may push toward cap. Best/worst-path header comments re-derived per stage.

**8. Worst/careless/sloppy still lose — worked min-path (reviewer pt 4).**
- Decision: loss comes from threats + timer, not red gates. The min-path army is much smaller (early `×N` of a tiny count stays tiny), so it can't out-DPS a mandatory full-width block → contact drain → wipe; or it reaches the boss thin and is drained out by the fan. Tighter timer also punishes stalling.
- **Worked example (illustrative; exact numbers tuned in Phase 5):** stage1 gates `[+8|×3], [×2|+25], …` from start 1, min-path = `min` each: `min(9, 3)=3 → min(6, 28)=6 → …` stays single digits, reaches the first full-width block (hp ~24) with ~6 soldiers; `6·perSoldierDPS·window « 24` ⇒ contact drains the leftover ~`min(6, ⌈hp_left⌉)` ⇒ wipe. **AC3 is machine-tested** by the verifier's `careless/sloppy loses` checks; this worked path just shows the loss is *authored-in*, and each stage header carries its own min-path derivation (the current `stage1.js` best-path comment block, mirrored for the min path).

**9. Difficulty selection + restart.**
- Decision: single start-screen choice (Normal | Hard), in-memory, applies to all 3 stages. `restart()` returns to the start screen (state `MENU`) so the player re-picks the tier (`Screens.showStart()`); the existing restart buttons call `game.restart()`. `Game.start(difficulty)` stores `this.difficulty` + resolves `this.preset`.

**10. Verifier overlap rule.**
- Decision: add `hasMandatoryOverlap(stage)` (any two mandatory threats — full-width blocks + enemies — whose engagement windows overlap on z). Assert false on Normal; skip on Hard. Clean zero-drain stays the universal bar; Hard overlaps must be solvable by focus-fire priority ordering.
- **Revised during implementation:** because Hard is a pure *multiplier* transform (it does not move threat z-positions), the positional overlap value is identical on both tiers — so authoring any Normal baseline *with* positional overlap would fail the Normal assertion. The implemented contract therefore authors all three Normal baselines overlap-free (Normal assertion passes), keeps the `skip-on-Hard` branch (forward-compatible: a future Hard-specific layout could introduce overlap without the check blocking it), and delivers the genuine "Hard forces target priority" pressure through (a) **tight back-to-back mandatory threats** (e.g. stage 3's z134→z170 wall, windows 14 units apart) and (b) Hard's higher threat HP + tighter clock shrinking the kill margins. AC9's real machine test is **Hard clean still wins with zero contact drain** despite those tightened margins — which the verifier enforces per (stage, Hard).

**11. Verifier anchor thresholds + AC8 robustness + Hard time budget.**
- Decision: keep absolute slack floors — `clean fight > 5s`, `melt > 2.5s` for ALL (stage,tier); undodged `bossDrain` floor authored per stage (reused for both tiers). Add relative checks (AC8): Hard clean timer-margin < Normal's; Hard undodged bossDrain ≥ Normal's.
- **AC8 drain robustness (reviewer pt 3):** `bossDrain = bossEntryCount − finalCount` is computed identically on win / lose / timeout (on a wipe, finalCount=0 ⇒ drain = full entry, the max). The undodged ENTRY count is **tier-invariant** — undodged uses best gates (tier-invariant gate values) + a competent zero-drain run, so it reaches the boss with the same gate-grown count on Normal and Hard. Hard's volley drains *more* per volley (more bullets + earlier enrage) and the boss has more HP (more volleys land), so Hard undodged drain ≥ Normal is structural, with equality when both fully wipe. Tuning targets undodged WIPE on both tiers so the floor (AC7) is comfortably cleared and AC8 holds as `≥`.
- **Hard time budget feasibility (reviewer pt 12):** the three pressures co-exist because the run phase dominates the budget (~21s run vs ~9s fight today) and `runSpeed ×1.12` *shrinks* run time while `timeLimit ×0.85` *shrinks* the budget — roughly proportional. The fight grows (`hp ×1.3`, count tier-invariant ⇒ `fight ×1.3`) but off a small base. Sketch for the tightest stage: if Normal clean = `runT + fightT` with margin `M = timeLimit − (runT+fightT)`, Hard clean ≈ `runT/1.12 + 1.3·fightT` vs `0.85·timeLimit`. With Normal `runT≈21, fightT≈9, timeLimit≈48`: Hard ≈ `18.8 + 11.7 = 30.5` vs `40.8` ⇒ ~10s margin. Feasible; the verifier's `clean within timer` + the relative margin check confirm per (stage,tier) during tuning.

**12. AC12 machine-test for count-dependence (reviewer pt 14).**
- Options: A) leave AC12 author-verified (only a comment) · B) add a pure verifier assertion that each gate pair's winner flips within `[1, cap]`
- Decision: **B)** — add `gateFlips(left, right, cap)` to the verifier: true iff `∃ counts a,b ∈ [1,cap]` with `left` winning at `a` and `right` winning at `b` (no dominant side). Assert every gate in every stage is count-dependent. This makes AC12 machine-tested, independent of the run sim. (Cosmetic green-both is UI-only and not modeled.)

**13. Required boss fields — single source of defaults (reviewer pt 13).**
- Decision: `boss.bullets`, `boss.bulletDamage`, `boss.enrage` are **required** in all 3 stage configs (the stage file is the single source of truth). `Boss.js` keeps light `??` fallbacks for crash-safety only (never relied upon); the verifier and `bossVolley()` assume the fields are present (no second default set). All 3 stages author them explicitly, so the fallbacks are dead code by construction.

## 6. Design

### 6.1 `src/config/difficulty.js` (NEW)

```js
export const PRESETS = {
  normal: { id: 'normal', label: 'NORMAL', mult: null },        // identity (still clones)
  hard: {
    id: 'hard', label: 'HARD',
    mult: {
      timeLimit: 0.85, runSpeed: 1.12,
      bossHp: 1.3, bossFireInterval: 0.85, bossBulletSpeed: 1.15, bossBulletsAdd: 2,
      obstacleHp: 1.2, enemyHp: 1.2, marchSpeed: 1.15, reinforce: 0.8,
    },
  },
}

// Always returns a fresh deep clone (pt 8): Normal applies no multipliers, Hard transforms.
export function applyDifficulty(stage, preset) {
  const p = preset || PRESETS.normal
  const s = JSON.parse(JSON.stringify(stage))                   // pure-data deep clone
  s.tier = p.id
  s.tierLabel = p.label
  const m = p.mult
  if (m) {
    s.timeLimit = stage.timeLimit * m.timeLimit
    s.runSpeed  = stage.runSpeed  * m.runSpeed
    s.boss.hp = Math.round(stage.boss.hp * m.bossHp)
    s.boss.fireInterval = stage.boss.fireInterval * m.bossFireInterval
    s.boss.bulletSpeed  = stage.boss.bulletSpeed  * m.bossBulletSpeed
    s.boss.bullets = stage.boss.bullets + m.bossBulletsAdd
    for (const o of s.obstacles) o.hp = Math.round(o.hp * m.obstacleHp)
    for (const e of s.enemies) { e.hp = Math.round(e.hp * m.enemyHp); if (e.marchSpeed) e.marchSpeed *= m.marchSpeed }
    s.powerupTuning.reinforce = Math.round(stage.powerupTuning.reinforce * m.reinforce)
  }
  return s
}

// Shared boss volley/enrage model (Decision 6) — ONE source for game + verifier, no THREE import.
// Takes an explicit hpFraction (0..1) so callers with different "hp" conventions agree
// (reviewer R2 pt 1): the Boss instance passes `this.hpFraction` (= this.hp/this.maxHp), the
// verifier passes `hp / boss.hp` (live/config-max). `boss` only needs the fire fields + enrage.
export function bossVolley(boss, hpFraction) {
  const enraged = hpFraction < boss.enrage.below
  return {
    enraged,
    interval: enraged ? boss.fireInterval * boss.enrage.fireIntervalMult : boss.fireInterval,
    bullets:  enraged ? boss.bullets + boss.enrage.bulletsAdd : boss.bullets,
  }
}
```

**`difficulty.js` imports NOTHING** (reviewer R2 pt 2) — it is fully self-contained (`PRESETS`, `applyDifficulty`, `bossVolley` only), so both the THREE-side (`Boss.js`) and the no-THREE side (the verifier) import it safely; the verifier's "no THREE" guarantee can't silently break.

`boss.z`, `crowdCap`, `perSoldierDPS`, gate values, `boss.bulletDamage`, `boss.enrage`, `bossStandoff` are NOT transformed.

### 6.2 Boss — fan + enrage (`src/entities/Boss.js`)

- Constructor: `this.bullets = config.boss.bullets ?? 5`, `this.bulletDamage = config.boss.bulletDamage ?? 3`, `this.enrage = config.boss.enrage ?? { below: 0.33, fireIntervalMult: 0.7, bulletsAdd: 2 }` (crash-safety fallbacks only; all stages author them — Decision 13). Keep `fireInterval`, `bulletSpeed`. Drop the old `burst`.
- `update()`: `const v = bossVolley(this, this.hpFraction)` (imported from `difficulty.js`; the existing `hpFraction` getter = `this.hp/this.maxHp`, so enrage triggers on LIVE hp — reviewer R2 pt 1). Use `v.interval` for the `_fireTimer` gate + the wind-up clamp; pass `v.bullets` to `_fire`; use `v.enraged` to drive the telegraph recolor. No enrage arithmetic hand-copied here (Decision 6/15).
- Enrage telegraph recolor (cosmetic): when `v.enraged`, shift eye/core emissive toward a hotter hue + raise intensity. No gameplay change beyond `v.interval`/`v.bullets`.
- `_fire(armyX, armyZ, bossBullets, n)`: spawn `n` bullets in a fixed-`FAN_ANGLE` yaw fan (Decision 5). Origin `(0, 1.9, z-1.4)`, `ty = 0.6` unchanged (AC11).

### 6.3 Game coupling (`src/Game.js`)

- `_resolveBossBullets`: `const bulletDamage = this.track.boss.bulletDamage` (was `burst`); each connecting bullet `this.crowd.removeBurst(bulletDamage)`. Rest unchanged.
- Boss-bullet pool cap (reviewer pt 7): worst case = largest base `bullets` across the 3 stages (~6) + Hard `+2` + enrage `+2` = ~10/volley; at the enraged Hard interval (`≈ fireInterval·0.85·0.7`) up to 2 volleys can be in flight ⇒ ~20 live. Raise `bossBullets` pool cap `32 → 64` (comfortable margin).
- `start(difficulty = 'normal')`: `this.difficulty = difficulty; this.preset = PRESETS[difficulty]`. Add `_activeStage(i) { return applyDifficulty(this.stages[i], this.preset) }`.
- `_beginStart`: set `this.config = this._activeStage(this.stageIndex)`, **`this.track.reset(this.config)`** (rebuild entities with the tier-applied hp/bullets — the constructor's initial Track build only covers the menu backdrop), then `_resetStageState`. `_advanceStage` likewise uses `_activeStage(stageIndex)` + `track.reset`.
- `worldLen` (constructor, `Math.max(...stages.map(s=>s.boss.z)) + END_PAD`) stays from BASE stages. Since `boss.z` is tier-invariant (Decision 3), `worldLen` bounds every (stage,tier) track and `trackLength = this.config.boss.z + END_PAD` matches on both tiers (reviewer pt 11). Stage 3 has the max `boss.z`, so the existing `Math.max` auto-sizes the world with no code change (AC14).
- `restart()` (reviewer pt 10): stop music, `stageIndex = 0`, `dmgMult = 1`, `this.preset = null; this.difficulty = null`, `this.config = this.stages[0]` (BASE, pre-transform), `this.track.reset(this.config)`, state `MENU`, `screens.showStart()` (player re-picks tier; a fresh `start()` re-resolves it).
- `_end`: stats string includes the tier label from `this.preset.label` (defined for both tiers — pt 9), e.g. `Crowd N · Stage k · HARD`.

### 6.4 UI (`index.html` + `src/ui/Screens.js`)

- index.html: replace the single `#btn-start` with two buttons `#btn-start-normal` / `#btn-start-hard` (Hard styled as a hotter/red variant), plus a one-line tier hint.
- Screens: constructor takes `onStart` (now `(difficulty) => …`); wire both buttons → `onStart('normal')` / `onStart('hard')`. Add `showStart()` (show start screen, hide others). Win/Lose stats already render whatever string `_end` builds.

### 6.5 Stage configs

- `boss`: `burst` → `bullets`; add `bulletDamage`; add `enrage: { below: 0.33, fireIntervalMult: 0.7, bulletsAdd: 2 }`. Tighter `timeLimit` (s1 60→~48, s2 65→~52, s3 ~56). Higher `runSpeed`, longer track (`boss.z` up), more obstacles/enemies/spread, faster `marchSpeed`.
- Gates: count-dependent both-green pairs; re-derive best/worst-path comments.
- Power-ups: positioned behind dodgeable blocks / on the worse gate side (x/z only).
- `stage3.js` (NEW): hardest finale — same shape, highest `boss.z` + hp, tightest timer, densest threats (authored to overlap on Hard but clean-clearable).

### 6.6 Verifier (`scripts/verify-balance.mjs`)

- Import `applyDifficulty`, `PRESETS`, **`bossVolley`** (shared model, no THREE), and `STAGE_1/2/3`.
- Boss phase: per-volley drain uses the shared helper — `const v = bossVolley(boss, hp / boss.hp)` (pass the live/config-max fraction; `boss` is the config object — reviewer R2 pt 1); `fireTimer` gated on `v.interval`; on fire, `count -= v.bullets * boss.bulletDamage`. No hand-copied enrage math (Decision 6/15).
- `hasMandatoryOverlap(stage)` helper: any two mandatory threats (full-width blocks + enemies) whose engagement windows `[z−fireRange, z]` overlap on z. Assert false on Normal; skip on Hard (AC9).
- `gateFlips(left, right, cap)` helper (Decision 12): assert every gate in every stage is count-dependent (AC12).
- Driver: `for (const tier of ['normal','hard']) for (stage of [STAGE_1,2,3])` → `applyDifficulty(stage, PRESETS[tier])`, run the `clean → … ` chain carrying the army across the 3 stages, collect results per (stage,tier).
- Checks per (stage,tier): clean wins + zero drain; careless loses; sloppy loses; clean fight > 5s; melt > 2.5s; clean within timer; undodged drain > per-stage floor; Normal no-overlap; all gates flip. Relative (per stage): Hard clean timer-margin < Normal margin; Hard undodged drain ≥ Normal.
- Print a labelled `[NORMAL]` / `[HARD]` section per stage so the matrix is readable.

## 7. Files Changed

- `src/config/difficulty.js` — NEW: `PRESETS` + `applyDifficulty` + shared `bossVolley` (no-THREE game+verifier module).
- `src/config/stage1.js` — fan/enrage boss fields, tighter timer, count-dependent gates, denser threats, positional power-ups, re-derived comments.
- `src/config/stage2.js` — same treatment.
- `src/config/stage3.js` — NEW: hardest finale, same shape.
- `src/entities/Boss.js` — `bullets`/`bulletDamage`/`enrage`, fan `_fire`, enrage interval/count + telegraph recolor.
- `src/Game.js` — `_resolveBossBullets` drain switch, bigger boss-bullet pool, `start(difficulty)` + `_activeStage`, thread tier through `_beginStart`/`_advanceStage`/`restart`, restart→start screen, tier in stats.
- `src/ui/Screens.js` — Normal/Hard buttons → `onStart(difficulty)`, `showStart()`.
- `index.html` — two start buttons + styles.
- `src/main.js` — `Game([STAGE_1, STAGE_2, STAGE_3], audio)`.
- `scripts/verify-balance.mjs` — shared `applyDifficulty`, 3×2 matrix, fan/enrage drain model, Hard-only overlap skip, per-(stage,tier) floors + relative checks.
- `README.md` — difficulty system, fan/enrage boss, count-dependent gates, contract changes.

## 8. Verification

1. [AC1] `npm run verify` exits 0; output shows a 3-stage × 2-tier matrix; verifier imports `applyDifficulty`.
2. [AC2] CLEAN rows show `win=true drain=0` for all 3 stages on Normal and Hard.
3. [AC3] CARELESS and SLOPPY rows lose on both tiers (PASS checks).
4. [AC4/AC5] `clean boss fight > 5s` and `melt > 2.5s` PASS for every (stage,tier).
5. [AC6] clean total < timeLimit PASS for every (stage,tier).
6. [AC7] `undodged sN boss drain > floor` PASS for every (stage,tier).
7. [AC8] `Hard sN tighter margin than Normal` and `Hard sN undodged drain ≥ Normal` PASS (drain computed identically on win/lose/timeout; undodged entry is tier-invariant).
8. [AC9] `stageN Normal no mandatory overlap` PASS; Hard overlap skipped; Hard clean still zero-drain.
9. [AC10/AC11] boss model in verifier uses the SHARED `bossVolley` (bullets × bulletDamage + enrage), so it cannot drift from `Boss.js`; fan spawn keeps origin constants.
10. [AC12] `gateFlips` PASS for every gate in every stage (machine-tested count-dependence), AND each stage header documents the best/worst path.
11. [AC13] no new power-up types; `Powerup.js`/rng untouched (git diff).
12. [AC14] `stage3.js` present; `main.js` lists 3 stages; world sizes to longest.
13. [AC15/AC16] Manual `npm run dev`: start screen shows Normal+Hard; tier applies all stages; Win/Lose show tier; restart returns to start screen. Hard feels tighter (clock + boss).
14. [AC18] README + this doc updated.
