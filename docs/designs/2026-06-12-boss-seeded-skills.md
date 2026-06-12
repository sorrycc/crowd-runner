# Boss: seeded random skills (bullet patterns, AOE slam, summoned adds, damage-shield) + balance-verifier rework

## 1. Background

Today the end-of-stage boss has ONE attack: a horizontal fan of bullets aimed at the army's x on a fixed cadence (`Boss._fire`, `src/entities/Boss.js:263`), with an enrage modifier under 33% HP. The shared offense model is `bossVolley(boss, hpFraction, frenzyMult)` in `src/config/difficulty.js:64`, imported by BOTH the game and the headless statistical verifier (`scripts/verify-balance.mjs`) so the cadence can never drift.

This change generalizes the boss into a **seeded, depth-scaled random-skill system** across four families — more bullet patterns, a telegraphed AOE slam, summoned adds, and a boss damage-shield — and reworks the verifier's boss loop to model each family while preserving the existing balance contract.

**Critical reframe vs. the original issue text.** The issue was written against an older fixed-3-stage architecture (`stage{1,2,3}.js` files, a per-stage deterministic verifier). The codebase has since moved to the **endless procedural** design: there are no per-stage files — `generateStage(index, seed, preset)` (`src/config/generator.js`) builds every stage on demand, difficulty scales with `level = index + curveOffset`, and the verifier is **statistical** (100 seeds × 12 depths × {normal,hard} × {clean,sloppy,careless,undodged}). The issue's intent maps cleanly: "stage 1 small pool → stage 3 full set" becomes a **depth-scaled weighted skill pool generated inside `generateStage`**, keyed on `level`.

## 2. Requirements Summary

**Goal:** Replace the boss's single fan attack with a seeded, reproducible, depth-scaled random-skill system (4 families) and rework the statistical verifier to model each family, keeping the game ↔ verifier single-source-of-truth and the existing balance contract intact.

**Scope (in):**
- Four skill families: (1) bullet patterns — aimed fan (today) + wall-with-gap + sweeping arc + radial ring; (2) telegraphed AOE slam (fixed X-band, ~0.6s wind-up); (3) summoned adds (march + contact only, reuse `Enemy`); (4) boss damage-shield (incoming dmg ×~0.4 for a bounded, non-stacking window; NO player debuff).
- A depth-scaled weighted skill pool generated in `generateStage` (`boss.skills:[{type,weight}]`) with cumulative family unlock + per-family intensity scaling.
- A shared, pure, seeded per-cast selector `bossCast` used identically by game and verifier.
- A reworked verifier boss loop modeling each family's undodged effect + an add-clearing sub-loop, plus new per-family ACs.
- Retuning of `boss.hp`/`hpPerArmy`, `fireInterval`, `timeLimit`, and (if the sweep requires) the verifier fight-band ceiling.

**Scope (out):** player debuffs of any kind; add bullets/ranged attacks; Z-axis dodge geometry (slam is an X-band); enrage/frenzy scaling of slam/adds/shield magnitudes; static per-stage files; pulling THREE into any shared pure module.

## 3. Acceptance Criteria

*Reproducibility / single-source-of-truth (hard invariants — must not regress):*
1. Given `(index, seed, preset)`, `generateStage` produces a byte-identical config including the generated `boss.skills` pool + `boss.skillTuning`; the full skill sequence in a run is deterministic and replayable.
2. The per-cast skill chosen at cast index `k` is identical between game and verifier for the same `(config.seed, k)`, independent of frame `dt`.
3. No shared pure module (`difficulty.js`, `generator.js`, `events.js`, `rng.js`) imports THREE; the verifier imports the exact same generator + `bossCast` the game runs.

*Pool growth & cast model:*
4. At index 0 the pool is bullet-patterns only (parity with today's stage-1 fan behavior at the menu backdrop + stage 1). Slam, adds, shield enter the pool at their unlock levels; from the full-set level all four families are present, weight/intensity scaling with depth.
5. Enrage (`hpFraction < enrage.below`) and frenzy shorten the global inter-cast interval for ALL cast types; the `+bullets` buff applies ONLY to bullet-pattern casts; slam/adds/shield magnitudes are unaffected by enrage/frenzy.

*Per-family undodged invariants (clean dodges/clears → ZERO drain; stationary centered army loses a known amount):*
6. Bullet patterns (fan/wall/arc/ring): a stationary centered army eats a known `undodgedKill = hitCount × bulletDamage` per cast; a clean lateral dodge → 0 drain.
7. AOE slam: a stationary centered army inside a center-marked X-band loses a known `slamKill` per slam at detonate; clean steers out before detonate → 0 drain.
8. Summoned adds: while any add is alive the boss takes zero fire (HP frozen); a full-strength clean army clears each bounded wave before contact (zero drain); an under-strength army (sloppy/careless) fails to clear before march reaches `leaderZ` and takes contact drain via `Enemy.contact` math.
9. Damage-shield: while active, incoming boss damage ×~0.4 for both clean and undodged (pure time tax, not dodgeable); windows are bounded + non-stacking (refresh, not extend); shield measurably lengthens the fight.

*Preserved balance contract (existing ACs, across 100 seeds × 12 depths × {normal,hard}):*
10. Clean wins stages 1-5 with timer margin (100% of seeds).
11. Clean takes ZERO contact drain in the RUN phase (stages 1-5) AND zero boss-phase soldier loss (slam/adds dodged/out-fought; shield taxes TIME only).
12. Sloppy loses by stage 5 (100%); careless loses by stage 5 (100%).
13. Every clean boss fight lands in the retuned fight band, and every clean run+fight is within `timeLimit`.
14. Undodged boss-drain non-decreasing with depth, measured as the **per-depth MEDIAN** `undodged` `bossDrain` across the seed sweep, **asserted over depths 1-5** (the full 100-seed sample at every depth, since clean wins 100% there; depths 6-12 informational), ±5% tolerance — the seeded skill mix makes per-seed drain variable, so the anchor is statistical, not per-seed; `nominalArmy` strictly increasing; every growth gate count-dependent.
15. The verifier passes 100% on BOTH normal and hard after retuning (the sweep is the tuning instrument).

## 4. Problem Analysis

- **Approach A — static per-stage skill files (`stage{1,2,3}.js`) as the issue literally says.** Rejected: those files don't exist; the game is procedural/endless. Re-introducing static stages would fork the architecture.
- **Approach B — depth-scaled pool baked in `generateStage`, shared `bossCast` selector, generator-baked magnitudes.** Chosen: it reuses the established pattern (generator bakes all per-stage magnitudes off `cleanEnd`; `difficulty.js` owns the shared offense math; verifier imports both). Maps the issue's intent onto the real architecture with the least new surface.
- **Single-source granularity — share application code vs. share numbers.** Chosen: **share the NUMBERS** (registry + `bossCast` + generator-baked tuning), let game and verifier each APPLY them in their own loop. This is exactly how `bossVolley` works today (`Game._resolveBossBullets` and the verifier both consume the same `{interval,bullets}` but apply drain independently). Sharing application code would require THREE-free entity simulation in the verifier (rejected — over-engineering).

## 5. Decision Log

**1. Pool growth shape**
- Options: A) cumulative family unlock by depth · B) all families from index 0, intensity-scaled · C) cumulative unlock + intensity scaling
- Decision: **C** — index 0 = bullet patterns only (parity with today); slam unlocks ~level 1, adds ~level 2, shield ~level 3; full set from ~level 3. Intensity already lives in the generator (`generator.js:253-257`); I add a family-unlock gate. Unlock levels are verifier-tuned.

**2. Per-cast selection**
- Options: A) global volley cadence picks one skill · B) separate clocks per family
- Decision: **A** — each cast draws ONE skill from the unlocked weighted pool via `bossCast(boss, hpFraction, castIndex, frenzyMult)`, seeded `mulberry32((boss.seed ^ (castIndex×PRIME)) >>> 0)`, so cast #k is byte-identical in game and verifier regardless of dt (AC2). One global cast clock (today's `_fireTimer`).

**3. Enrage/frenzy composition**
- Options: A) cadence-only global · B) cadence global + `+bullets` bullet-only · C) buff all skill magnitudes
- Decision: **B** — cadence (interval) shortens for ALL casts; `+bullets` applies ONLY to bullet-pattern casts; slam/adds/shield magnitudes are NOT enrage/frenzy-scaled (YAGNI; matches the issue's "cadence/+bullets modifier").

**4. Per-skill effect definition**
- Decision: each registry entry carries a pure `undodgedEffect(boss)` (or closed-form fields) returning its undodged soldier loss / time-tax params, shared by game + verifier. No THREE.

**5. Slam geometry / dodge (revised in R3 — reviewer R3 pt4)**
- Options: A) fixed AIMED X-band, leader-center test · B) x/z disc · C) center-clamped band (rejected — boxed the mechanic into a no-op for edge-parkers)
- Decision: **A, AIMED + leader-center test.** Band `[xc−halfW, xc+halfW]` at the army's frozen Z, `xc = leaderX-at-cast` (NO center clamp — the slam TRACKS the player, so an edge-parked army is targeted and forced to move), FIXED through the ~0.6s wind-up; detonate drains `slamKill` iff `|leaderX − xc| < halfW`. The test is on the LEADER CENTER only (NOT `+ FORMATION_HALF_WIDTH`): `slamKill` is a fixed crowd-burst count (`removeBurst`), so the drain is a BINARY in/out of the band, not a per-soldier-position sum — dropping the formation term keeps the band narrow enough to be a real aimed-dodge while staying exactly mirrorable in the verifier.
- **Dodgeability (reviewer R1 pt5, R3 pt4).** The verifier does NOT simulate steering — for `clean` it sets dodgeable drain to 0 by fiat (TRUSTS the dodge, as for the fan). "A safe X exists AND is reachable in the telegraph" is a GAME-feel invariant, tuned/playtested like `FAN_ANGLE`. One hard constraint: `halfW < limit` (`limit = roadHalf − MARGIN = 2.55`, `Crowd.js:35`) so a safe X always exists on the reachable road for ANY `xc` (band width `2·halfW < 5.1`). Pick `slamHalfW = 1.1` — dodge distance from a center-aimed slam ≈ 1.1 units in the 0.6s telegraph (the playtested steer-rate dial); an edge-aimed slam leaves a WIDE opposite safe side. No `clampXc`, no `DODGE_MARGIN` (both removed — KISS).
- **Eating-policy model = always-connecting upper bound (reviewer R2 pt7).** For EATING policies (`sloppy`/`careless`/`undodged`) the verifier applies full `slamKill` on every slam detonate — `undodged` is DEFINED as "stands in every slam." An intentional UPPER BOUND (the stationary-in-band worst case): makes `undodged` the strict boss-drain anchor and is conservative for the lose-side. Not a per-position match to a steering player — by design.
- **One slam at a time (reviewer R2 pt5).** Both callers hold a SINGLE `_pendingSlam`/`pendingSlam` slot; a slam cast while one is still winding up REPLACES it (telegraph restarts, prior detonation dropped). Deliberate, identical in game + verifier, so no drift.

**6. Add DPS-theft bound**
- Options: A) bounded wave, boss HP frozen while adds alive, clean clears in ≤ T_add · B) fractional theft · C) no freeze (contact-drain only)
- Decision: **A** — boss takes fire only when no add is the nearest target (natural via by-Z targeting). Per-wave `addCount` full-width marching `Enemy` adds, `addHp` baked off `cleanEnd` so a clean army clears within the march-to-contact window (zero drain); under-strength armies eat contact drain. Summon casts bounded by pool weight + cadence.

**7. Shield bound**
- Options: A) explicit per-fight `S_max` ceiling · B) bounded duration + non-stacking, statistical in-band assertion
- Decision: **B** — shield has a bounded duration, windows don't stack (refresh, never extend), frequency bounded by cadence + weight. The statistical sweep asserts every clean fight (incl. drawn shield uptime) stays in-band; retune knobs close any out-of-band case. Matches the project's statistical-not-closed-form philosophy.

**8. AC contract**
- Decision: keep every existing balance AC verbatim; clean takes ZERO boss-phase drain; shield is a pure TIME tax absorbed into the retuned fight band + timer; add per-family undodged invariants. Fight-band ceiling + `timeLimit` are verifier-internal knobs, not the user contract.

**9. Bullet-pool cap**
- Decision: bump `bossBullets` cap 64 → 128 (`Game.js:82`). Worst-case live-orb arithmetic (reviewer R1 pt7): per cast = `hitCount` core + `spread` decorative, capped at `PATTERN_MAX = 16` orbs/cast (each pattern's spawn is bounded). Orb life ≈ `dist/bulletSpeed + 0.4 ≈ 20/25 + 0.4 ≈ 1.2s`; at the enraged floor `MIN_FIRE_INTERVAL = 0.45s`, casts-in-flight ≈ `1.2/0.45 ≈ 2.7 → 3`; peak live ≈ `3 × 16 ≈ 48`. 64 is marginal, **128 gives ~2.7× margin** so no pattern ever drops orbs (a dropped orb would desync game vs. verifier drain). Each pattern's total spawn (core + spread) is explicitly capped at `PATTERN_MAX`.

**10. `bossVolley` fate (reviewer R1 pt10)**
- Decision: factor today's cadence math into an exported `castCadence(boss, hpFraction, frenzyMult)`; **REMOVE `bossVolley` outright** — both callers (`Boss.js:3`, `verify-balance.mjs:24`) are in-repo and both migrate to `castCadence` (timer) + `bossCast` (skill draw). No deprecated re-export (dead code, YAGNI).

**11. Verifier boss-phase powerup buffs (reviewer R1 pt4)**
- Decision: the verifier intentionally IGNORES `dmgMult` + rapid-fire in the boss phase — exactly as the EXISTING boss-HP-drain model already does (`verify-balance.mjs:116-117` uses raw `count·dps`, no `dmgMult`/rapid). This is CONSERVATIVE for `clean` (the game, with buffs, clears adds + the boss strictly FASTER than the verifier predicts), so a verifier "clean clears in time" guarantee is a lower bound on the game. The sloppy/careless lose-margin is large (worst gates → tiny army) and does not flip under the ≤1.3 `dmgMult` cap; the sweep confirms it. No game-feel change (buffs are not force-cleared at BOSS entry).

**12. `skillTuning` Hard-offset scaling (reviewer R1 pt13)**
- Decision: `skillTuning` (`slamKill`, `addCount`, `addHp`, `shieldDuration`, …) is baked off `level = index + curveOffset` and `cleanEnd` in the generator, BEFORE `applyDifficulty`. So on Hard these magnitudes ARE deeper-feeling (Hard plays the curve ~2 stages ahead) — this is INTENDED and consistent with how every other threat scales (`generator.js:127-137`). `applyDifficulty` only additionally mutates `boss.fireInterval`/`bullets`/`bulletSpeed` (cadence + bullet-cast `+bullets`), never `skillTuning`. Scope-out item "enrage/frenzy scaling of slam/adds/shield" is a DIFFERENT axis (the per-cast enrage buff), unaffected.

## 6. Design

### 6.1 `difficulty.js` — registry + `bossCast` (the design surface)

Import `mulberry32` from the pure `rng.js` (THREE-free; already in the verifier's import graph via the generator — so this does NOT pull THREE into the verifier; the module header's "imports NOTHING" caveat was specifically about THREE).

**`castCadence` and `bossCast` are SEPARATE, and the cast-clock discipline is identical in both callers (reviewer R1 pt1/pt2):** `castCadence` (cadence only, today's `bossVolley` body) is called EVERY frame to advance the fire timer; `bossCast` (the seeded skill draw) is called ONLY on the frame the boss fires, with `castIndex++` read-then-increment. Because `interval` does not depend on the drawn skill, this keeps `castIndex` in exact lockstep between game and verifier regardless of `dt`. Each side also decrements `frenzyLeft` at the SAME point in the frame relative to the cast (mirror `Game.js:360-363`: buffs tick in step 2, before the BOSS-branch fire in step 3).

```
export const BOSS_SKILLS = {
  // Bullet patterns are ONE verifier family (parameterized by hitMult); the four are distinct
  // VISUAL/dodge-feel treatments in the game (reviewer R1 pt9). hitMult = core orbs as a fraction
  // of `bullets`; the game spawns exactly that many CORE orbs aimed at army-x-at-cast (eaten iff
  // the army stands; missed if it moves) + decorative SPREAD orbs aimed AWAY (never hit a centered
  // army). So undodgedKill = hitCount × bulletDamage is EXACT — no geometric fraction to reverse-
  // engineer, zero game↔verifier drift (reviewer R1 pt6).
  fan:    { kind: 'bullets', hitMult: 1.0 },   // aimed fan — all core orbs at army
  wall:   { kind: 'bullets', hitMult: 0.5 },   // road-spanning row, gap = the safe lane
  arc:    { kind: 'bullets', hitMult: 0.7 },   // orbs released over a sweep
  ring:   { kind: 'bullets', hitMult: 0.5 },   // radial fan; core orbs point at the army
  slam:   { kind: 'slam' },                     // telegraphed X-band
  adds:   { kind: 'adds' },                     // summoned marching squads
  shield: { kind: 'shield' },                   // incoming-dmg time tax
}

const MIN_FIRE_INTERVAL = 0.45
const CAST_PRIME = 0x9e3779b1
const PATTERN_MAX = 16   // hard cap on orbs/cast (core + spread) — sizes the bullet pool (Decision 9)

// cadence ONLY — called every frame by both callers to advance the fire timer (was bossVolley)
export function castCadence(boss, hpFraction, frenzyMult = 1) {
  const e = boss.enrage
  const enraged = hpFraction < e.below
  const interval = Math.max(MIN_FIRE_INTERVAL,
    boss.fireInterval * (enraged ? e.fireIntervalMult : 1) * frenzyMult)
  return { enraged, interval }
}

function pickType(skills, rng) {
  const total = skills.reduce((s, k) => s + k.weight, 0) || 1
  let r = rng() * total
  for (const k of skills) { r -= k.weight; if (r < 0) return k.type }
  return skills[skills.length - 1].type
}

// the seeded skill draw — called ONLY on a fire frame, with castIndex++ (read-then-increment).
export function bossCast(boss, hpFraction, castIndex, frenzyMult = 1) {
  const skills = (boss.skills && boss.skills.length) ? boss.skills : [{ type: 'fan', weight: 1 }]
  const rng = mulberry32(((boss.seed >>> 0) ^ ((castIndex * CAST_PRIME) >>> 0)) >>> 0)
  const type = pickType(skills, rng)
  const def = BOSS_SKILLS[type] || BOSS_SKILLS.fan
  const { enraged } = castCadence(boss, hpFraction, frenzyMult)
  const t = boss.skillTuning || {}
  const out = { type, kind: def.kind, enraged, undodgedKill: 0, rng }

  if (def.kind === 'bullets') {
    const bullets = boss.bullets + (enraged ? boss.enrage.bulletsAdd : 0)
    const hitCount = Math.max(1, Math.round(bullets * def.hitMult))   // EXACT core-orb count
    out.bullets = bullets
    out.hitCount = hitCount
    out.undodgedKill = hitCount * boss.bulletDamage
  } else if (def.kind === 'slam') {
    out.halfW = t.slamHalfW ?? 0.8
    out.telegraph = t.slamTelegraph ?? 0.6
    out.slamKill = t.slamKill ?? boss.bulletDamage * 4
    out.undodgedKill = out.slamKill
  } else if (def.kind === 'adds') {
    out.addCount = t.addCount ?? 2
    out.addHp = t.addHp ?? Math.max(1, boss.bulletDamage * 6)
    out.addMarch = t.addMarch ?? 3.0
  } else if (def.kind === 'shield') {
    out.shieldMult = t.shieldMult ?? 0.4
    out.shieldDuration = t.shieldDuration ?? 2.5
  }
  return out
}
```

`boss` here is a lightweight bag the two callers build: the `Boss` instance exposes `{ seed, skills, skillTuning, fireInterval, bullets, bulletDamage, enrage }` — reading `seed` from `config.boss.seed` (NOT top-level `config.seed`); the verifier passes `cfg.boss` (which carries the identical `cfg.boss.seed`). **Both callers MUST key `mulberry32` off the SAME field `boss.seed` (reviewer R1 pt11).** `rng` is returned for the GAME's per-cast spatial randomness (wall gap slot, arc direction, ring phase, slam `xc` jitter, cosmetic placement). Because each cast re-seeds `mulberry32` fresh from `(boss.seed ^ castIndex·PRIME)`, that spatial stream is deterministic per cast regardless of how many draws prior casts made — guaranteeing the in-game replay (AC1). The VERIFIER never reads `cast.rng` (it only consumes `undodgedKill`/`slamKill`/`addCount`/durations), so the game's spatial draws can't desync the shared cast-TYPE sequence (AC2).

### 6.2 `generator.js` — depth-scaled pool + baked tuning

In the boss-config block (`generator.js:251-286`), after the existing intensity scaling, build the pool + tuning from `level` and `cleanEnd`:

```
// cumulative family unlock (verifier-tuned thresholds)
const skills = [{ type: 'fan', weight: 3 }]
if (level >= 1) { skills.push({ type: 'wall', weight: 2 }, { type: 'arc', weight: 2 }) }
if (level >= 2) { skills.push({ type: 'ring', weight: 2 }) }
if (level >= 1) skills.push({ type: 'slam', weight: 2 })
if (level >= 2) skills.push({ type: 'adds', weight: 2 })
if (level >= 3) skills.push({ type: 'shield', weight: 1 })

// add HP sized so a clean army (≈cleanEnd) clears the WHOLE wave before the SHARED contact
// deadline (zero drain), while an under-strength army can't. All adds in a wave spawn at the SAME
// Z (reviewer R1 pt3) so "nearest" is unambiguous and the contact deadline is shared:
//   total wave hp = cleanEnd · DPS · clearWindow          (clean clears the wave in ~clearWindow s)
//   marchDeadline = (spawnZ − leaderZ) / addMarch         (time for the wave to reach the army)
//   INVARIANT: clearWindow < marchDeadline · CLEAR_SAFETY  (clean clears with margin → zero drain)
// spawnZ = boss.z − 2, leaderZ = boss.z − BOSS_STANDOFF(20) ⇒ marchDeadline = 18/addMarch = 6.0s at
// addMarch 3.0 ≫ clearWindow 1.4s ✓. The verifier proves the inequality holds for every seed/depth.
const addCount = Math.min(3, 1 + Math.floor(level / 3))
const clearWindow = 1.4                                   // total DPS-theft seconds per wave (tuned)
const addHp = Math.max(1, Math.round((cleanEnd * DPS * clearWindow) / addCount))
const slamKill = Math.max(1, Math.round(bulletDamage * 4))   // tuned (verifier authority)
const skillTuning = {
  addCount, addHp, addMarch: 3.0, clearWindow,
  slamKill, slamHalfW: 1.1, slamTelegraph: 0.6,        // halfW < limit(2.55): aimed, dodgeable (Decision 5)
  shieldMult: 0.4, shieldDuration: 2.5,
}
```

`config.boss` gains `seed: config.seed`, `skills`, `skillTuning`. **`config.boss.seed` is the ONE seed field both callers read** (reviewer R1 pt11) — the game's `Boss` and the verifier both key `mulberry32` off `cfg.boss.seed`, never top-level `config.seed`. `timeLimit` / `fightTarget` grow to budget the new taxes (slam wind-ups, `summonCasts × clearWindow`, shield uptime) — retuned against the sweep. All values are baked off `cleanEnd` exactly like every other threat (`generator.js:127-137,242`), so a smaller (sloppy) army faces the same absolute HP and fails to clear → loses.

`applyDifficulty` (`difficulty.js:38`) is unchanged except it must NOT deep-break the new nested `skills`/`skillTuning` (the `JSON.parse(JSON.stringify())` clone already handles them; Hard's `bossBulletsAdd`/`bossFireInterval` still apply to bullet casts + global cadence).

### 6.3 `Boss.js` — skill dispatch, patterns, telegraphs, shield

- ctor: read `this.seed = config.boss.seed ?? 0` (**same field as the verifier — reviewer R1 pt11**), `this.skills = config.boss.skills`, `this.skillTuning = config.boss.skillTuning`; init `this._castIndex = 0`, `this._fireTimer = 0`, `this._shieldLeft = 0`, `this._shieldMult = 1`, `this._pendingSlam = null`.
- `setHp(hp)` (called at EVERY RUN→BOSS, `Game.js:345`, always BEFORE the first BOSS-branch tick): also reset `_castIndex = 0`, `_fireTimer = 0`, `_shieldLeft = 0`, `_pendingSlam = null` so each fight replays from cast 0 (AC1/AC2). **Reset convergence (reviewer R1 pt8):** `_resetStageState` clears `track.bossAdds`; `_pendingSlam`/`_shieldLeft`/`_castIndex` are guaranteed reset by this `setHp` at the next RUN→BOSS; the menu-backdrop boss never casts slam/adds (index-0 pool is bullets-only, AC4), so its stale state is inert. All three reset paths converge before any drain can fire.
- `update(dt, firepower, armyX, armyZ, bossBullets, frenzyMult)` returns an **events array** (replacing the `fired` bool — one call site in Game). It uses the split clock (reviewer R1 pt1/pt2):
  - Apply shield to own HP drain: `this.hp -= firepower * dt * (this._shieldLeft > 0 ? this._shieldMult : 1)`.
  - Tick `_shieldLeft`, tick `_pendingSlam.left`; on slam expiry push `{kind:'slam', xc, halfW, slamKill}` (detonate event) and clear the marker.
  - Advance the timer EVERY frame with cadence only: `const { interval } = castCadence(this, this.hpFraction, frenzyMult); this._fireTimer += dt`.
  - Only on the fire frame (`this._fireTimer >= interval`): `this._fireTimer -= interval; const cast = bossCast(this, this.hpFraction, this._castIndex++, frenzyMult)`; dispatch by `cast.kind`:
    - `bullets`: `this._fireFan/_fireWall/_fireArc/_fireRing(cast, armyX, armyZ, bossBullets)` (per `cast.type`) → push `{kind:'bullets'}`.
    - `slam`: set `_pendingSlam = {xc: armyX, halfW: cast.halfW, slamKill: cast.slamKill, left: cast.telegraph}` (AIMED at the army, no clamp), show marker → push `{kind:'slam-begin', xc, halfW}`.
    - `adds`: push `{kind:'adds', count: cast.addCount, hp: cast.addHp, march: cast.addMarch}` (Game/Track spawn).
    - `shield`: `this._shieldLeft = cast.shieldDuration; this._shieldMult = cast.shieldMult` (refresh, non-stacking) → push `{kind:'shield'}`; show shield bubble.
- **Bullet patterns — only HARMFUL orbs are modeled; decorative orbs are cosmetic-only (reviewer R1 pt6 + R2 pt10/pt11).** Collision is generic `|x−leaderX| < HIT_RADIUS` at `z ≤ leaderZ` (`Game._resolveBossBullets` UNCHANGED). Each pattern spawns EXACTLY `cast.hitCount` **HARMFUL** orbs into `bossBullets`, arranged so a stationary army at `armyX`(=leaderX-at-cast) eats ALL of them and a clean dodge avoids ALL of them. So the realized drain == `cast.undodgedKill = hitCount × bulletDamage` EXACTLY (no fraction to reverse-engineer, zero drift). Any extra orbs for the full silhouette are **COSMETIC-ONLY**: drawn in a separate non-colliding visual layer (or aimed wide, final `|x| ≥ roadHalf + HIT_RADIUS ≈ 4.6`, so generic collision can never charge them for any on-road army) — they are OUT of the balance model. Two valid harmful-orb constructions (implementer's choice per pattern, both exact + drift-free):
  - (i) **AIMED** — all `hitCount` harmful orbs aimed within `HIT_RADIUS` of `armyX`; dodge = move off `armyX` so they miss (the fan's discipline).
  - (ii) **GAP** — harmful orbs span the army's lane at `armyX` with a seeded clear gap elsewhere of width ≥ `2·HIT_RADIUS + margin` (so a dodging army sits cleanly in the gap → 0); dodge = steer INTO the gap. `hitMult` is chosen so `round(bullets·hitMult)` equals the geometric eat-count for the orb spacing (a FAN_ANGLE-style one-time tuning), keeping the registry value == the realized count.
  - The four patterns (visual variety + telegraph feel; the verifier treats them as one family):
    - `_fireFan` = today's `_fire` (fixed muzzle origin, FAN_ANGLE) — AIMED, all `hitCount = bullets` orbs harmful (hitMult 1.0).
    - `_fireWall` — GAP construction; the off-center clear gap is "the safe lane."
    - `_fireArc` — AIMED; harmful orbs released across a short sweep, cosmetic trails off the sides.
    - `_fireRing` — AIMED; harmful orbs at `armyX`, cosmetic orbs radiate elsewhere.
  - Each `_fireX` clamps total spawned orbs (harmful + cosmetic) ≤ `PATTERN_MAX = 16` (reviewer R2 pt11), so the pool-cap arithmetic (Decision 9) holds and no orb is ever dropped.
- **Determinism rule (reviewer R2 pt9):** ALL pattern spatial randomness (wall gap slot, arc sweep direction, ring phase, cosmetic placement, slam `xc` jitter) MUST draw from `cast.rng` — NEVER `Math.random()` — or the in-game seeded replay (AC1) breaks. The verifier never reads `cast.rng` (it only needs `undodgedKill`/`slamKill`/`addCount`/durations), so these draws are game-only and don't affect the shared cast-type sequence.
- Visuals: slam marker = a flat ring/disc mesh added to the scene (not the boss group), grown + reddened over the wind-up, flash on detonate, hidden after. Shield = a translucent bubble around the boss group, visible while `_shieldLeft > 0`. Both cosmetic; gameplay numbers come from `bossCast`.

### 6.4 `Game.js` — BOSS-phase rework

Bump `bossBullets` cap 64 → 128 (`Game.js:82`). In `_resetStageState`, clear boss-phase adds + pending slam (`this.track.clearBossAdds()`).

Replace the BOSS branch (`Game.js:392-402`):

```
} else {
  const frenzyMult = this.frenzyLeft > 0 ? EVENT_FX.FRENZY_FIRE_MULT : 1
  // adds: march + retarget (DPS theft) — boss eats fire only when no add is engaged
  for (const a of this.track.bossAdds) a.update(dt, leaderX)
  const add = this._acquireBossAdd(cfg.combat.fireRange)
  const bossF = add ? 0 : F
  if (add) {
    add.damage(F * dt)
    this._fire(dt, (add.xRange[0] + add.xRange[1]) / 2, add.z)
    if (add.dead) { this.audio?.play('enemy-down'); this.effects.enemyDeath(...) }
  } else {
    this._fire(dt, 0, cfg.boss.z - 1.4)
  }
  const events = this.track.boss.update(dt, bossF, leaderX, this.leaderZ, this.bossBullets, frenzyMult)
  for (const ev of events) {
    if (ev.kind === 'bullets') { this.audio?.play('boss-shot', {volume:0.6}); this.effects.muzzleFlash(...) }
    else if (ev.kind === 'adds') this.track.spawnBossAdds(ev.count, ev.hp, ev.march, cfg.boss.z, this._bossEntryZ(), cfg.roadHalf)
    else if (ev.kind === 'slam') this._resolveSlam(ev, leaderX, shielded)      // detonate → drain
    else if (ev.kind === 'slam-begin') this.audio?.play('hurt', {volume:0.3})
    else if (ev.kind === 'shield') this.audio?.play('powerup', {volume:0.4})
  }
  this._resolveBossBullets(leaderX, shielded)
  this._resolveBossAddContact(leaderX, shielded)   // add.z ≤ leaderZ → Enemy.contact drain
}
```

- `_acquireBossAdd(fireRange)`: nearest live add ahead within `fireRange` by Z (mirrors `_acquireTarget` over `track.bossAdds`). **Shared freeze predicate (reviewer R1 pt12):** an add diverts fire from the boss iff it is alive AND `add.z > leaderZ` AND `add.z ≤ leaderZ + fireRange` AND `add.z < boss.z` (nearer than the boss). The verifier's `nearestAdd` applies the IDENTICAL predicate so the boss-freeze condition is byte-identical (adds spawn at `boss.z−2 < boss.z` and within range, so they always satisfy it until killed/contact). 
- `_resolveSlam(ev, leaderX, shielded)`: `if (!shielded && Math.abs(leaderX − ev.xc) < ev.halfW) crowd.removeBurst(ev.slamKill)` + juice (leader-center test, AIMED `xc`, no clamp/formation term — Decision 5). (Player-Shield powerup still negates it, like bullets.)
- `_resolveBossAddContact`: for each add with `z ≤ leaderZ` and not dead → `add.contact(crowd, shielded)` drain + juice (reuse the RUN enemy-contact block).
- Adds are full-width (`xRange = [−roadHalf, roadHalf]`) marching `Enemy` (chaseSpeed 0) so "kill before contact" — not steering — is the only out.
- **Frenzy decrement ordering (reviewer R1 pt1):** the BOSS branch reads `frenzyMult` from `this.frenzyLeft` AFTER the step-2 buff tick (`Game.js:360-363` already decrements `frenzyLeft` in step 2, before step-3 combat) — the verifier mirrors this exact order so the cast cadence near the frenzy on/off boundary matches.

### 6.5 `Track.js` — own boss-phase adds

```
build() { ...; this.bossAdds = [] }
spawnBossAdds(count, hp, march, bossZ, leaderZ, roadHalf) {
  for (let i = 0; i < count; i++) {
    const z = bossZ - 2 - i * ADD_DZ                 // ADD_DZ = 0.01 — see below
    const e = new Enemy(this.scene, { z, hp, xRange: [-roadHalf, roadHalf], marchSpeed: march, chaseSpeed: 0 }, this.soldierGeo)
    e.group.position.x += (i - (count - 1) / 2) * 0.6 // COSMETIC-ONLY render offset; e.z/xRange unchanged
    this.bossAdds.push(e)
  }
}
clearBossAdds() { for (const e of this.bossAdds) this._removeObject(e.group); this.bossAdds = [] }
```

**Same-Z adds + deterministic tie-break (reviewer R3 pt1/pt2).** All adds in a wave spawn at essentially the SAME gameplay Z with a tiny deterministic stagger `z = bossZ − 2 − i·ADD_DZ` (`ADD_DZ = 0.01`), used in BOTH `spawnBossAdds` AND the verifier (§6.6) — byte-identical. The 0.01 stagger is gameplay-negligible (even `addCount=3` ⇒ rear add 0.02 units / ~0.007s closer, vs the ~4.6s clear-before-contact margin) but breaks the nearest-target Z-tie DETERMINISTICALLY so `_acquireBossAdd` and the verifier's `nearestAdd` focus-fire the SAME add first (lowest index = `i=0`, the rear-most by the −i·ADD_DZ). The ±0.6 X offset is COSMETIC-only (applied to `group.position.x`, NOT to `e.z`/`e.xRange`), so adds don't visually stack while the full-width contact/targeting math is unchanged. `dispose()` and `reset()` also clear `bossAdds` (so a stage advance / restart starts clean — AC14/AC15 parity).

### 6.6 `verify-balance.mjs` — boss loop model

Import `castCadence` + `bossCast` (replace `bossVolley`). In `simulate`, the BOSS loop (`verify-balance.mjs:105-131`) maintains a seeded cast stream + an add sub-loop, using the SAME split clock + frame order as the game (reviewer R1 pt1/pt2/pt12):

```
const boss = { ...cfg.boss }                        // carries seed + skills + skillTuning
const t = boss.skillTuning || {}
let castIndex = 0, fireT = 0, shieldLeft = 0
let pendingSlam = null, bossContactDrain = 0
const adds = []
// shared freeze predicate — byte-identical to Game._acquireBossAdd (reviewer R1 pt12)
const nearestAdd = () => {
  let best = null, bz = Infinity
  for (const a of adds)
    if (!a.dead && a.hp > 0 && a.z > z && a.z <= z + fireRange && a.z < boss.z && a.z < bz) { best = a; bz = a.z }
  return best
}
while (true) {
  // frame order mirrors Game._update: (2) tick buffs → (3) combat/fire
  if (shieldLeft > 0) shieldLeft = Math.max(0, shieldLeft - DT)
  if (frenzyLeft > 0) frenzyLeft = Math.max(0, frenzyLeft - DT)
  const fm = frenzyLeft > 0 ? EVENT_FX.FRENZY_FIRE_MULT : 1

  // DPS theft: full army DPS hits the nearest add, else the boss (shielded)
  const addTarget = nearestAdd()
  if (!addTarget) hp -= count * dps * DT * (shieldLeft > 0 ? t.shieldMult : 1)
  else addTarget.hp -= count * dps * DT
  fight += DT
  if (hp <= 0) return { win:true, lose:false, contactDrain, bossContactDrain, endCount:count, runTime, fightTime:fight, time, bossDrain:entryCount-count, entryCount }
  time -= DT

  // march adds; contact drain when an add reaches leaderZ (all policies; clean clears first → 0)
  for (const a of adds) if (!a.dead) {
    if (a.hp <= 0) { a.dead = true; continue }
    a.z -= a.march * DT
    if (a.z <= z) { const d = Math.min(count, Math.ceil(a.hp)); count -= d; bossContactDrain += d; a.dead = true }
  }

  // pending slam detonate (eating policies stand in it; clean dodges → 0)
  if (pendingSlam) { pendingSlam.left -= DT
    if (pendingSlam.left <= 0) { if (eats) count = Math.max(0, count - pendingSlam.slamKill); pendingSlam = null } }

  // cast clock: cadence EVERY frame (castCadence), skill draw ONLY on fire (bossCast, castIndex++)
  const { interval } = castCadence(boss, hp / maxHp, fm)
  fireT += DT
  if (fireT >= interval) {
    fireT -= interval
    const cast = bossCast(boss, hp / maxHp, castIndex++, fm)   // type identical to the game (AC2)
    if (cast.kind === 'bullets') { if (eats) count = Math.max(0, count - cast.undodgedKill) }
    else if (cast.kind === 'slam') pendingSlam = { left: cast.telegraph, slamKill: cast.slamKill }
    else if (cast.kind === 'adds') for (let i = 0; i < cast.addCount; i++) adds.push({ z: boss.z - 2 - i * 0.01, hp: cast.addHp, march: cast.addMarch, dead: false })  // SAME formula as spawnBossAdds (reviewer R3 pt1/2)
    else if (cast.kind === 'shield') shieldLeft = cast.shieldDuration   // refresh, non-stacking
  }
  if (count <= 0) return lose('boss-wipe')
  if (time <= 0) return lose('timeout-boss')
}
```

The `lose(...)`/`fail(...)` helpers ALSO add `bossContactDrain` (0 on a run/boss timeout that wasn't add-contact) so every return shape carries BOTH `contactDrain` (run phase) and `bossContactDrain` (boss phase) as SEPARATE fields — the existing run-phase AC11 check (`verify-balance.mjs:184`, reading `c.r.contactDrain`) is unaffected (reviewer R2 pt2).

Key fidelity points:
- **Split clock = exact castIndex lockstep (reviewer R1 pt2):** `castCadence` advances `fireT` every frame; `bossCast(...,castIndex++,...)` is drawn ONLY on a fire frame — identical to `Boss.update`. Since `interval` is skill-independent, `castIndex` is byte-identical to the game regardless of `dt` (AC2). The frenzy tick happens at the same step as the game (reviewer R1 pt1).
- **Verifier ignores boss-phase `dmgMult`/rapid (Decision 11):** add-DPS + boss-HP use raw `count·dps` — conservative for `clean` (the game clears strictly faster), matching the existing model.
- `clean`/best policy: `eats=false` ⇒ no bullet/slam drain; full army DPS clears each same-Z wave before the shared contact deadline ⇒ `bossContactDrain` stays 0 (AC11); only adds-freeze + shield lengthen `fight` (AC13).
- `undodged` (eats, best gates): eats every bullet `undodgedKill` + every `slamKill` (stands in every slam, the upper-bound model — Decision 5) ⇒ the boss-drain anchor (AC14), summed across the seeded skill mix.
- `sloppy`/`careless`: eat bullets/slam + can't clear adds (smaller army) ⇒ contact drain ⇒ wipe by stage 5 (AC12).

New/updated checks (added to the sweep, both tiers):
- **AC11 boss-phase zero-drain (reviewer R1 pt14 + R2 pt2):** a dedicated `bossContactDrain === 0` check for every clean stage 1-5 across all seeds, read from the new `c.r.bossContactDrain` field — separate from the existing run-phase `contactDrain` check (both asserted 0).
- **AC14 monotonicity under seeded variance (reviewer R2 pt3 + R3 pt3):** the seeded skill mix + variable add-freeze makes the `undodged` per-fight `bossDrain` SEED-DEPENDENT at a fixed depth, so the old per-seed `prevDrain` comparison (`verify-balance.mjs:204-210`) would fail on variance, not bugs. REPLACE it with a per-depth MEDIAN across the seed sweep, **restricted to depths 1-5**, asserted non-decreasing (±5% tolerance). Depths 1-5 are where clean wins 100% of seeds (AC10), so the depth-d undodged sample is the FULL 100 seeds at every depth — NOT a depth-shrinking survivor set (the undodged anchor is `simulate(c.cfg, c.start, 'undodged')` off the clean carry-in `c.start`, which exists for all seeds only where the clean chain reached depth d; restricting to 1-5 guarantees a stable 100-seed sample). Depths 6-12 are reported as INFORMATIONAL (median trend printed, not asserted). This matches the project's statistical philosophy (the fight-band already uses medians, `verify-balance.mjs:253-258`).
- AC13 band retune (raise the ceiling as needed) + AC15 (100% green both tiers). Per-family smoke assertion: for a representative deep stage, a centered-stationary `undodged` run loses >0 to each unlocked family (model-wired sanity).

### 6.7 Retuning loop (Phase 5)

The verifier is the instrument. Iterate: run `npm run verify`; if clean melts/stalls or sloppy survives, adjust knobs in `generator.js` (`fightTarget` base/slope, `addHp`/`clearWindow`/`addCount`, `slamKill`, `shieldDuration`, pool weights/unlock levels, `timeLimit` margin) and the verifier fight-band ceiling. The AC14 anchor is the per-depth MEDIAN undodged `bossDrain` over depths 1-5 (±5%, full 100-seed sample), so depth scaling of `bulletDamage`/`slamKill`/`addHp` (all off `cleanEnd`·`level`) keeps the median monotone even though individual seeds vary. Repeat until 100% on both tiers (AC15).

**Final tuned values (verifier green, 100% both tiers):** `clearWindow=0.8`, `addMarch=3.0`, `addCount = min(3, 1+⌊level/3⌋)`, `slamKill = bulletDamage·4`, `slamHalfW=1.1`, `slamTelegraph=0.6`, `shieldMult=0.5`, `shieldDuration=1.4`; `timeLimit = (RUN_END/runSpeed)·1.35 + ft·1.8 + 12`; pool unlock fan(L0) → wall/arc/slam(L1) → ring/adds(L2) → shield(L3); verifier `FIGHT_CEIL=30`, `bossBullets` cap `128`. Observed clean-fight medians stay ≤ ~18.5s (both tiers); undodged median drain rises 61 → 344,779 across depths 1-12.

## 7. Files Changed

- `src/config/difficulty.js` — add `BOSS_SKILLS` registry + exported `bossCast` + exported `castCadence` + internal `pickType`; import `mulberry32`; **REMOVE `bossVolley` outright** (both callers migrate — Decision 10).
- `src/config/generator.js` — build depth-scaled `boss.skills` pool + `boss.skillTuning`; set `boss.seed`; grow `fightTarget`/`timeLimit` to budget the new taxes.
- `src/entities/Boss.js` — `_castIndex` + `bossCast` dispatch; `_fireFan` (rename) + `_fireWall`/`_fireArc`/`_fireRing`; slam marker mesh + pending-slam timing; shield bubble + internal `_shieldLeft` damage-mult; `update` returns an events array; `setHp` resets cast state.
- `src/Game.js` — BOSS-phase rework (add retarget/DPS-theft, add-contact, slam detonate drain, consume Boss events, spawn adds via Track); bump `bossBullets` cap 64→128; clear adds/slam in `_resetStageState`.
- `src/world/Track.js` — own `bossAdds`; `spawnBossAdds` / `clearBossAdds`; dispose on reset.
- `scripts/verify-balance.mjs` — seed the same cast stream via `bossCast`; per-family undodged model + add sub-loop + shield time tax; retune; new ACs.

## 8. Verification

1. [AC1/AC2] Determinism check: generate a stage twice → identical `boss.skills`/`skillTuning`; the verifier's cast-type sequence (`bossCast` types for `castIndex` 0..K) is identical on a re-run AND independent of `DT` (run the boss loop at two `DT` values, assert the same type sequence). In-game, a fixed seed replays the same skill order.
2. [AC3] `node scripts/verify-balance.mjs` runs (proves no THREE leaked into the shared modules — it would crash on import otherwise, since it now imports `castCadence`/`bossCast`). `grep -rn "from 'three'" src/config src/util/rng.js` returns nothing.
3. [AC4/AC5] Inspect generated configs at index 0/1/2/3 (normal+hard): pool families present per the unlock ladder; enrage shortens interval for all casts; `+bullets` only on bullet casts.
4. [AC6] Exact-drain check: because each bullet pattern spawns exactly `hitCount` core orbs aimed at a stationary centered army, the realized in-game drain equals `cast.undodgedKill` by construction — no separate geometry-vs-fraction tuning. (Spread orbs are aimed `> HIT_RADIUS` away and verified harmless to a centered army.)
5. [AC6-9] Verifier per-family smoke assertion (centered-stationary undodged loses >0 to each unlocked family; clean → 0). Manual playtest (`npm run dev`): fan/wall/arc/ring dodge laterally → 0; slam telegraph → steer out → 0; adds → kill before contact → 0; shield → boss visibly tankier for the window.
6. [AC11] Dedicated boss-phase zero-drain: the new `bossContactDrain` accumulator is 0 for every clean stage 1-5 across all 100 seeds × both tiers (asserted as its own check line, separate from run-phase `contactDrain`).
7. [AC10-15] `npm run verify` PASSES 100% on BOTH normal and hard (clean wins 1-5 + zero drain run AND boss phase, sloppy/careless lose, fight band, timer, monotonicity, gate count-dependence).
8. Pool-cap: confirm `bossBullets` cap=128 absorbs wall+ring+enrage bursts (each pattern's spawn ≤ `PATTERN_MAX=16`; no dropped orbs in a deep enraged fight playtest).
