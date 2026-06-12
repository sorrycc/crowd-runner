# Endless Procedural Stages, Army-Scaled Threats, Random Events, Statistical Verifier

## 1. Background

Three player requests drive this redesign of Swarm Run:
1. "Still not difficult enough" — a skilled player clears every stage taking zero damage.
2. "No 200 max soldiers limit" — the `crowdCap: 200` ceiling feels arbitrary.
3. "Should have random events and stage" — the run is the same 3 scripted stages every time.

These are not tweaks. The current balance **contract** (`scripts/verify-balance.mjs`) PROVES the game is winnable by replaying ONE exact optimal solution where a clean run wins with ZERO contact drain. That contract is *why* it's not hard enough (a perfect player always wins with margin), and it is fundamentally incompatible with randomness (a single deterministic replay can't cover a seeded event pool). The `200` cap is load-bearing in 4 places: `Crowd.js` (InstancedMesh sized to cap), `Gate`/verifier `applyGate` (clamp), the gate authoring (every `+N vs ×M` tuned to land at 200), and boss HP (1500/1700/1950 tuned vs `200×0.9≈180 DPS`). Removing it naively makes more soldiers = more DPS = the boss melts in <2s — which *fights* request #1.

The resolution (locked via Q&A): **scale threats to the army**. Lift the cap to a visual-only ceiling, and make boss HP + mandatory-threat HP + boss offense all scale with the army at entry, so a bigger swarm faces a proportionally bigger fight. Stages become procedural and endless; difficulty rises with depth; a seeded event pool layers randomness on top; the verifier becomes statistical.

## 2. Requirements Summary

**Goal:** One procedural generator produces endless, army-scaled stages plus a seeded random-event layer; a finite stage-5 climax unlocks endless mode; the crowd is logically unbounded with a fixed 1500-instance visual ceiling; the verifier is rewritten to a statistical sweep.

**In scope:**
- New pure (THREE-free) `src/config/generator.js` — `generateStage(index, seed, preset)` returns the existing config shape; owns the difficulty curve + seeded placement; special-cases `index===4` as the finale.
- New pure `src/config/events.js` — seeded event registry + scheduler + pure effect math.
- `src/config/difficulty.js` — tiers become a curve-index **offset** + a small retained multiplier set.
- `src/entities/Crowd.js` — unbounded logical `count`, render arrays sized to a 1500 ceiling.
- `src/entities/Boss.js` + `src/world/Track.js` — army-scaled boss HP at RUN→BOSS; `boss.setHp`.
- `src/Game.js` — on-demand generation; boss-HP scaling; event scheduler; climax→WIN→endless; best depth + peak army to localStorage; random per-run seed.
- `src/ui/HUD.js`, `src/ui/Screens.js`, `index.html` — depth counter, event banners, endless-continue button, game-over best run.
- `scripts/verify-balance.mjs` — full rewrite importing the same generator + events math.
- Delete `src/config/stage1.js`, `stage2.js`, `stage3.js`.

**Out of scope:** per-stage Road/Environment rebuild (length stays bounded → built once); composite score formula; new power-up types; new gate mechanic; persisting anything beyond best depth + peak army.

## 3. Acceptance Criteria

1. `generator.js` exports `generateStage(index, seed, preset)`, imports nothing from THREE, returns an object consumable by Track/Gate/Boss/Crowd with exactly two documented adaptations: Crowd reads `config.crowdCap` (now `MAX_COUNT`) for its sanity clamp; Boss HP is overridden via `Boss.setHp` at RUN→BOSS. No other consumer changes.
2. Generation is deterministic given `(index, seed, preset)` via `mulberry32`: identical inputs → byte-identical configs; differing seeds → differing layouts.
3. Track length / `boss.z` stays within a bounded near-constant band across all depths (no growth with depth).
4. Every **growth** gate (the `gates` list) remains `+N vs ×M` both-green and count-dependent at every depth (winner flips between a small and a large count); magnitudes scale to expected count at depth, not 200. (The toll event is NOT a gate — see AC5 — so it does not appear in this list.)
5. `events.js` exports a pure registry + seeded scheduler + pure effect-math constants; entity-events inject obstacle/enemy entries (ambush wave, elite block); modifier-events (sandstorm runSpeed, frenzy boss fire-rate, bonus cache reinforcements, toll count-cost) reuse the timed-buff pattern. Every balance-relevant effect is reproduced by the verifier; only the sandstorm steer feel is game-only (mild, never blocks a dodge). No THREE import.
6. Event count per stage ramps monotonically (non-decreasing) with depth.
7. `Crowd.count` stores arbitrary large integers; InstancedMesh + `cur`/`init` arrays are sized to 1500; with `count > 1500`, ≤1500 follower instances render and no out-of-bounds access occurs.
8. HUD count shows the true logical count past 1500 (no truncation); the visual cap is documented as deliberate.
9. At RUN→BOSS, boss HP is set to `base + k·armyAtEntry`; mandatory block/enemy HP scale to expected count at depth.
10. Tiers: Normal offset 0; Hard plays the curve shifted +2 AND applies retained multipliers (boss `fireInterval ×0.85`, `bulletSpeed ×1.15`, `bullets +1`, `timeLimit ×0.9`). Both live in `difficulty.js`, imported by game + verifier (no drift).
11. Stage 5 (`index===4`) sets `finale:true` + a higher boss-base via the same `hp=base+k·army` path; clearing it shows a WIN screen ("FINAL BOSS"/"YOU WIN") with a "Continue — Endless" button.
12. "Continue — Endless" advances to stage 6+ via the standard advance path, carrying `max(finishCount, baseline)`, keeping `dmgMult`, with no finale-specific boundary code.
13. Endless stages 6+ generate on demand and rise in difficulty until loss; no stage cap.
14. Base run seed is random per-run (Math.random-derived) at game start, re-rolls on restart; all in-run randomness derives from `seed+index` only.
15. Game-over shows best **depth reached** + best **peak army count** as two numbers, persisted to localStorage and restored across reloads.
16. `verify-balance.mjs` imports the same generator + events math (no duplicated logic) and runs N=100 seeds × depths 1-12 × {Normal,Hard} × {clean,sloppy,careless,undodged} in sub-second time.
17. Verifier asserts for depths 1-5, every sampled seed + both tiers: clean **wins with timer margin** (100%); sloppy + careless **lose** (100%).
18. Verifier asserts every sampled clean boss fight (depths 1-12, measured under the SAME drain model the sim uses) has duration ∈ [5s, 18s] AND total run+fight within the stage timer with margin. The `fightTarget` cap is set to 14s (not 16) to leave headroom below 18s.
19. Verifier asserts difficulty rises with depth via TWO metrics across sampled depths and tiers: (a) `nominalArmy(level)` strictly increases (R>1, provably monotone); (b) TOTAL undodged boss-drain (soldiers lost over the whole fight = `volleys·bullets·bulletDamage`) is non-decreasing **within a small tolerance** (allow a dip ≤2% to absorb the `round()`/step-boundary noise from `bullets`/`fireInterval` saturating at different levels). Endless depths 6+ stay in the boss-fight band without requiring a win.
20. `stage1/2/3.js` deleted; no source/script imports them; the game runs from a single procedural code path.
21. Road + Environment are constructed once at a large fixed world length, never rebuilt on advance.
22. The verifier exits non-zero on any failure and prints a per-check PASS/FAIL report.

## 3b. Revised during implementation

Small refinements found while making the verifier pass (the contract is the authority — design §6.8):
- **Army curve is INDEX-based, not level-based.** A run always starts at 1 and grows through the same gates regardless of tier, so `nominalArmy`/`entryArmy` key on the depth index; the Hard offset makes the boss/threats/density as-if-deeper (level-based), never the army magnitude (else `entryArmy` mismatches the real carry on Hard's early stages). Final curve `A0=50, R=2.2, G0=5, GN=1` (one growth gate per endless stage keeps growth sane; stage 5 ≈ 1.2k, depth 12 ≈ 290k). `MAX_COUNT = 1e12`.
- **`entryArmy` = the ACTUAL recursive clean carry** (memoized `expectedCleanEnd`), not a formula — eliminates chain-drift entirely. Threats are sized off the real per-seed clean/worst trajectories.
- **Elite blocks are tanky-but-clearable** (β raised toward a 0.9 clean-clear ceiling), never `×1.5` past it (which made clean drain).
- **Marching squads use a conservative engagement window** (`MARCH_SPEED=1.2`, window ×0.6) so focus-fire contention never makes a clean run drain; sloppy still loses at the boss by eating the fan.
- Result: 100% clean-win (stages 1-5) + 100% sloppy/careless-lose + fight-band + monotonicity, both tiers, 100 seeds.

## 4. Problem Analysis

- **Deterministic single-solution verifier** — proves balance by replaying one optimal line with zero drain → makes the game beatable-with-margin by a perfect player and can't survive seeded randomness. *Rejected.* → Replace with statistical sweep.
- **Lift cap, keep fixed boss HP** — more soldiers = more DPS = boss melts <2s. *Rejected — fights request #1.* → Scale boss HP + offense with army at entry.
- **Per-stage world rebuild (variable track length)** — needs Road/Environment dispose+rebuild and co-scaling the clock with length. *Rejected (YAGNI).* → Fixed near-constant length; ramp difficulty via HP/density/speed/events ("denser, not longer").
- **Chosen approach** — A pure `nominalArmy(level)` backbone curve anchors everything; gates are engineered to hit it; threat HP, boss HP, and boss offense all scale off it. Boss HP `= hpPerArmy·armyAtEntry` makes fight duration *army-independent* and provably in-band. Generator + events are pure so the verifier imports the exact same math.

## 5. Decision Log

**1. Logical cap vs visual ceiling**
- Options: A) unbounded int + 1500 ceiling · B) unbounded + 2000 · C) hard 100k + 1500
- Decision: **A** — `count` is a plain integer sanity-clamped to a single shared `MAX_COUNT = 1e8` constant (exported from `generator.js`, imported by `Crowd` AND used as the generator's trajectory clamp, so both clamp identically → AC2). The generator emits `crowdCap: MAX_COUNT` so `Crowd` stays config-driven (`this.cap = config.crowdCap`). InstancedMesh + `cur`/`init` arrays sized to `VISUAL_CAP = 1500`; HUD shows true count. 1500 over 2000 for mobile FPS safety. **Critical (reviewer R1 pt7):** `this.cap` (1e8) is used ONLY in count-clamp arithmetic, NEVER as a loop/array bound — every `this.cap`-bound loop in `Crowd.update` (notably the dead-slot reset at the old `Crowd.js:163`) and the `cur`/`init` allocations switch to `VISUAL_CAP`, else the frame loop iterates 1e8× and freezes.

**2. Boss-HP scaling shape**
- Options: A) flat base(index) · B) pure `k·army` · C) `base + k·army`
- Decision: **C with base=0** — `hp = hpPerArmy·armyAtEntry`, `hpPerArmy = dps·min((finale?8:5.5) + 0.6·level, 14)`. The fight-time-in-band property: a clean run **dodges the fan** (the verifier's `clean` policy has `eatsBullets=false`), so there is NO boss-phase drain → `count` is constant during the fight → `fight = hp/(count·dps) = hpPerArmy/dps = min(...,14)s`, **independent of army magnitude**. RUN-phase drain (toll/mandatory residual, Decision 11) reduces the entry army but does NOT change fight time, because both `hp` and DPS scale with the same entry army — they cancel. So Decision 2 and Decision 11 are consistent: dropping the zero-RUN-drain bar does not threaten the band. The cap is **14s** (not 16) to leave headroom below the 18s AC18 ceiling for dt-discretization noise. The verifier measures fight time under its real drain model (AC18).

**3. Mandatory-threat HP scaling (corrected contact model — reviewer R1 pt1/pt2)**
- Options: A) fixed per-depth · B) scale to expected clean count at the threat's z
- Decision: **B**, with the ACTUAL contact mechanic. `Obstacle.contact`/`Enemy.contact` drain `min(count, ceil(remainingHp))` — soldiers lost = remaining HP at contact, one-per-HP, NOT a function of dps/window. The `window = fireRange/(runSpeed + marchSpeed)` (static block: `marchSpeed=0`) only decides whether the army out-DPSes the threat BEFORE contact: a threat is cleared iff `count·dps·window ≥ hp`. Set `hp = β · expectedCountAt(z) · dps · window`, `β≈0.7`. Then a clean army (`count = expectedCountAt(z)`) clears with margin `1−β` (zero drain); a sloppy army (`count = sloppyCountAt(z) < expectedCountAt(z)`) leaves residual `ceil(hp − sloppyCount·dps·window)` which drains. The sloppy-loses guarantee (AC17) is NOT proven closed-form — it is **tuned against the statistical verifier**, which simulates the real `min(count, ceil(hp))` drain across all seeds; `β` and threat density are the tuning knobs. **Hard invariant (reviewer R1 pt2/pt11):** mandatory-threat engagement windows `[z−fireRange, z]` must NOT overlap at ANY depth (focus fire is single-target nearest-z, so overlap would starve the farther threat of DPS and make even a clean run eat contact). Overlap is allowed only for DODGEABLE blocks (which need no DPS). See §6.2 step 4 for the placement budget that enforces this.

**4. Gate magnitude + count-dependence**
- Options: A) target a fixed cap (old) · B) scale `N` to running clean count
- Decision: **B** — each gate is `+N vs ×2` (occasionally `×3`), `N = max(2, round(cleanC·f))`, `f∈[0.5,1.5]` seeded. Any such pair flips winner between count=1 and count=large → count-dependent by construction (verifier checks `winner(1) ≠ winner(LARGE)`). No 200 clamp.

**5. Boss offense scaling + eat-all invariant (reviewer R1 pt5)**
- Options: A) fixed bulletDamage · B) scale bulletDamage with nominalArmy
- Decision: **B** — `bulletDamage = max(1, round(δ · nominalArmy · fireInterval / (fightTarget · bullets)))`, `δ≈1.2`, so undodged total drain ≈ `δ·nominalArmy` (wipes if eaten) at any depth → careless/undodged keep losing as the army grows. The **eat-all fan geometry** (`Boss.js` FAN_ANGLE=0.13 at `bossStandoff=20` → outermost bullet lands ≈1.30 < HIT_RADIUS≈1.56) is PRESERVED: `bossStandoff` and `FAN_ANGLE` are unchanged, and the covered band depends only on standoff·tan(angle) — independent of `bulletSpeed` and `bullets` count (extra bullets fill the same angle). To keep dodging humanly possible, `bulletSpeed` is **capped at 34** (its per-level ramp + Hard ×1.15 never exceeds this). The verifier's `count − bullets·bulletDamage` eat-all model therefore stays faithful.

**6. Tier → curve mapping + rewritten `applyDifficulty`**
- Options: A) offset only · B) multipliers only · C) both
- Decision: **C** — `preset.curveOffset` (Normal 0, Hard 2) shifts `level = index + curveOffset` for ALL magnitude ramps (boss HP-per-army, threat HP, density, gate values, runSpeed). On top, a small retained multiplier set handles danger-*feel* the offset can't express. `applyDifficulty(stage, preset)` is **rewritten** to apply ONLY these and NOTHING else (reviewer R2 pt2 — the old one also scaled `boss.hp/obstacle.hp/enemy.hp/marchSpeed/runSpeed/reinforce`, which now double-counts the offset and breaks Decisions 2 & 3 on Hard):
  - `timeLimit ×= 0.9`
  - `boss.fireInterval ×= 0.85`
  - `boss.bullets += 1`
  - `boss.bulletSpeed = min(boss.bulletSpeed × 1.15, 34)` (re-clamp — reviewer R2 pt3)
  It must NOT touch `boss.hp`, `boss.hpPerArmy`, `obstacle.hp`, `enemy.hp`, `marchSpeed`, `runSpeed`, `reinforce`. `PRESETS = { normal:{curveOffset:0, mult:null}, hard:{curveOffset:2, mult:{…the 4 above}} }`. Both live in `difficulty.js`, imported by game + verifier.

**7. World sizing**
- Options: A) per-stage rebuild · B) large fixed length
- Decision: **B** — `boss.z = BOSS_Z` constant (≈360); world built once to `BOSS_Z + END_PAD`. Difficulty ramps via HP/density/speed/events, not length. Avoids Road/Environment disposal code; keeps the clock meaningful.

**8. Run seed source**
- Decision: random per-run base seed `(Math.random()*0xffffffff)>>>0` at game start; re-roll on restart. Per-stage RNG = `mulberry32((seed + index·STAGE_STRIDE)>>>0)`. Verifier sweeps fixed seeds `0..N-1`, never `Math.random`.

**9. Climax → endless carry**
- Decision: exact stage-5 finish count floored to stage-6 baseline (`Math.max(carried, baseline)`) — the standard advance path; "Continue — Endless" just calls `_advanceStage()`.

**10. Best-run tracking**
- Decision: best **depth** + best **peak army**, two numbers, persisted to localStorage (reuse the mute-persistence pattern, keys `swarmrun.bestDepth`/`swarmrun.bestPeak`). No composite formula. Persisted BOTH on every `_advanceStage` (so a deep endless run survives a tab crash — reviewer R1 pt14) and on `_end`.

**11. Verifier contract scope**
- Decision: stages 1-5 deterministic per-seed (clean wins w/ margin 100%, sloppy+careless lose 100%); endless depths 6+ held only to the boss-fight band + monotonicity. "Zero contact drain" clean bar dropped (events impose bounded unavoidable drain) → clean's bar is "wins with margin."

**12. Event set (reviewer R1 pt9/pt10 — keep the user's 6, but make every balance effect verifier-modeled)**
- The issue explicitly enumerates 6 events; they are the spec, not gold-plating. All 6 are kept, but each balance-relevant effect is reproduced by the verifier; only sandstorm's steer feel is game-only.
  - *ambush wave* (entity) → extra `Enemy` injected into `enemies` (verifier models via the normal enemy sim).
  - *elite block* (entity) → tanky full-width `Obstacle` injected into `obstacles` (verifier models via the normal block sim). Counts toward the mandatory-threat non-overlap budget.
  - *toll* (modifier, NOT a gate) → instant count cost `crowd.sub(round(expectedCountAt(z)·TOLL_FRACTION))` at z. **Reclassified from a gate** because a both-`sub` gate is red/red and would violate the both-green gate invariant (AC4) + pollute the `gateFlips` check. As a count-cost modifier it sits outside the `gates` list. Verifier models it (`count -= toll`).
  - *bonus cache* (modifier) → instant `crowd.add(round(expectedCountAt(z)·BONUS_FRACTION))` at z. Verifier models it.
  - *sandstorm* (modifier) → timed `runSpeed ×= SANDSTORM_SPEED_MULT` (verifier models — affects engagement windows + clock) + a MILD steer-sensitivity reduction that is feel-only and never large enough to block a dodge (NOT modeled, NOT part of the contract).
  - *frenzy* (BOSS-fight modifier, NOT a RUN z-event — reviewer R2 pt6) → if the stage rolled a frenzy event, the boss opens aggressive: `frenzyLeft = FRENZY_DURATION` is armed at boss-fight START and ticked by fight time (a z-crossing can't fire it — `leaderZ` is frozen at `bossEntryZ` during BOSS). Applied through the SHARED model: `bossVolley(boss, hpFraction, frenzyMult)` composes as `interval = base · (enraged ? e.fireIntervalMult : 1) · frenzyMult`, floored at `MIN_FIRE_INTERVAL = 0.45` (reviewer R2 pt1 — caps the enrage×frenzy ≈0.49× spike). Game's `Boss.update` and the verifier both call `bossVolley` with the same active `frenzyMult`, so there is no drift. Frenzy speeds fire RATE only; the fan ANGLE (FAN_ANGLE) is unchanged, so a clean run still dodges every frenzied volley (no game-vs-contract asymmetry).

## 6. Design

### 6.1 The backbone: `nominalArmy(level)`

Everything scales off one curve. `level = index + preset.curveOffset`.

```
nominalArmy(level) = Math.min(MAX_COUNT, round(A0 * pow(R, level)))   // A0≈200, R≈1.6
```

`nominalArmy(level)` is the design target for the clean army AT BOSS ENTRY for that level. **Implementation note (gate-growth reality):** the `+N vs ×M` (M≥2) mechanic grows the clean army by **≥2× per growth gate** (clean always passes the flip point), so per-stage growth is set by the GATE COUNT, not a free dial. The generator uses `G0≈5` growth gates on the index-0 intro (1 → ≈`A0`) and `Gn≈2` per endless stage, with an average per-gate factor `f0≈2.4`. This makes `A0 = f0^G0 ≈ 64` and `R = f0^Gn ≈ 5.8` — i.e. `nominalArmy(level) ≈ A0·R^level` is DERIVED from the gate structure, so the real clean trajectory lands near it (within β headroom). The army blows past the old 200 cap by stage 2 and reaches thousands by stage 5; the 1500 visual cap engages in mid-endless. `MAX_COUNT = 1e12` (not 1e8) so the trajectory never saturates through the sampled depth 12 (`A0·R^12 ≈ 1.5e10 ≪ 1e12 ≪ 2^53`), which would otherwise break AC19(a); it costs nothing since render arrays are sized to `VISUAL_CAP`, not `MAX_COUNT`. All of `A0/R/G0/Gn/f0` are verifier-tuned. The formula is used ONLY for `entryArmy` (gate calibration), boss-offense scaling, and AC19(a); threat HP is sized off the generator's ACTUAL per-seed `cleanCountAt`/`worstCountAt`, so it is exact regardless of formula drift.

**`entryArmy` vs `startCount` (the carry reconciliation — reviewer R2 pt4):** these are DECOUPLED, and the fresh-start base case keys on **`index`**, NOT `level` (reviewer R3 pt3 — on Hard, index 0 → level 2, but the run still begins at count 1 with no carry):
- `entryArmy(index, level)` = the EXPECTED CLEAN army entering the stage = `index===0 ? 1 : nominalArmy(level-1)`. The first stage of EITHER tier starts at 1; its gates simulate clean-max FROM 1 and grow it to `nominalArmy(level)` (Hard's bigger `level` just means a bigger intro-growth + bigger threats). For index>0 the anchor is the prior boss-entry army. A real clean run carries ≈ `nominalArmy(level-1)` → enters at ≈ `entryArmy`, matching the baked threats.
- `startCount(index, level)` = a SMALL runtime floor (`index===0 ? 1 : max(1, round(entryArmy·0.15))`) used only in `Math.max(carried, startCount)`. Deliberately well below `entryArmy` so it NEVER rescues a sloppy/under-grown run up to the clean threshold. Threat HP is NOT sized off `startCount`.

**Chain-drift headroom (reviewer R3 pt1):** `entryArmy` is the SIZING SEED, not an exact value. Because gates are multiplicative, a small per-stage clean drain (toll, sandstorm-narrowed windows) can compound an entry-army deficit across the 12-stage chain. To absorb this, the per-threat `β` is clamped to **[0.5, 0.7]** (not 0.8) — leaving ≥30% margin for drift — and the **statistical verifier's chained-clean sim (with real toll/sandstorm drain) is the AUTHORITY**: `β` is tuned DOWN until chained-clean wins with margin at all 12 sampled depths on both tiers. The baked HP is intentionally a conservative approximation backed by the sweep.

### 6.2 `generateStage(index, seed, preset)` → config (THREE-free)

Returns the SAME shape the entities already consume (`id`, `label`, `timeLimit`, `runSpeed`, `roadHalf`, `startCount`, `seed`, `bossStandoff`, `combat`, `boss`, `powerupTuning`, `gates`, `obstacles`, `enemies`, `powerups`, `trees`), plus new fields: `boss.hpBase`, `boss.hpPerArmy`, `boss.finale`, and `modifiers` (the modifier-event schedule).

Generation steps (pure, `mulberry32(seed + index·STAGE_STRIDE)`):
1. `level = index + preset.curveOffset`. Compute `runSpeed = 18 + 0.4·level` (capped), `roadHalf = 3.0`, `boss.z = BOSS_Z`, `bossStandoff = 20`.
2. `entryArmy(level)` and `startCount(index)` per §6.1 (decoupled — entryArmy anchors threat sizing, startCount is the small runtime floor).
3. **Gates** (5-6, z-jittered across the run): simulate BOTH a clean-max and a worst-min trajectory starting from `entryArmy` (NOT startCount) in z-order; for each gate, with running clean count `C`, set `M=2` (seeded `3` occasionally) and `N = max(2, round(C·f))`, `f∈[0.5,1.5]`, so clean grows `entryArmy → nominalArmy(level)` over the stage. Record both `cleanCountAt(z)` and `worstCountAt(z)`. **Modifier folding (reviewer R3 pt2):** `cleanCountAt`/`expectedCountAt` fold BOTH toll and bonus (in z-order). `worstCountAt` is the PESSIMISTIC count: it folds **toll** (makes the worst army weaker → conservative, safe) but NOT **bonus** (a sloppy player may skip the positional bonus; crediting it would under-size threats). The **`expectedCountAt(z)` step function** = ordered breakpoints `(z_i, cleanCountAfter_i)`; value = last breakpoint with `z_i ≤ z`, else `entryArmy`. **The verifier never recomputes either trajectory** — the generator BAKES the resulting HP and the verifier reads it + simulates actual play. The generator's `worstCountAt` is a conservative SIZING aid (it may overestimate the real sloppy army, which only makes the baked separation safer); the verifier's chained sim is the authority for AC17.
4. **Mandatory threats** (full-width blocks + marching enemies + elite-block/ambush events): each `hp = β·expectedCountAt(z)·dps·window`, `window = fireRange/(runSpeed+marchSpeed)`, `β≈0.7`. **The generator additionally enforces the sloppy-loses gap** (reviewer R2 pt4): it picks `β` (per threat, clamped to [0.5, 0.7] — see chain-drift headroom in §6.1) so that `hp > worstCountAt(z)·dps·window` — i.e. the worst-min army CANNOT clear it and takes residual drain — while `hp < cleanCountAt(z)·dps·window` (clean clears with ≥30% margin). This bakes the clean-clears / sloppy-drains separation into the config, then the verifier proves the summed sloppy drain wipes (AC17). **Placement budget (hard invariant):** each mandatory reserves `fireRange + GAP` units (`GAP≈4`), laid out front-to-back so engagement windows `[z−fireRange, z]` NEVER overlap. Run span ≈300 usable units / `fireRange+GAP`≈26 caps mandatory count at ≈11; target density `= clamp(2 + floor(level/2), 2, MANDATORY_CAP=10)`. Beyond the cap, depth difficulty comes from HP/boss/offense, not more mandatories. Dodgeable blocks may overlap freely.
5. **Dodgeable blocks + powerups**: seeded placement (sub-range xRanges, positional powerups), same flavor as today.
6. **Boss**: `hpPerArmy = dps·min((finale?8:5.5) + 0.6·level, 14)`, `hpBase = 0`, `fireInterval = max(0.7, 1.4 − 0.05·level)`, `bullets = min(5 + floor(level/3), 9)`, `bulletSpeed = min(23 + level, 29.6)` (pre-Hard cap so post-`applyDifficulty` ×1.15 stays ≤34 — Decision 5/6), `enrage` per-level; `bulletDamage` from Decision 5; `frenzy` flag from events (a boss-fight modifier, §6.3). `crowdCap = MAX_COUNT`. `boss.hp = round(nominalArmy(level)·hpPerArmy)` is a placeholder for the menu tag — Game overrides it at entry with the LIVE army. `finale = (index===4)`.
7. **Events**: call `events.js` `scheduleEvents(level, rng)` to pick event types + z positions FIRST. Then the generator does ONE z-ordered pass over all positioned entries (gates, tolls, bonuses, mandatory threats) maintaining the running clean count: at a gate apply clean-max; at a toll `count −= round(count·TOLL_FRACTION)`; at a bonus `count += round(count·BONUS_FRACTION)`; at a threat, set `hp` from the current running count (step 4). This single pass resolves the toll/bonus↔threat-sizing dependency with no circularity and IS the `expectedCountAt` step function (step 3). Ambush/elite entity-events are injected into `obstacles`/`enemies` and counted in the step-4 budget; toll/bonus/sandstorm/frenzy go into the `modifiers` array.
8. Apply `preset.mult` via the **rewritten** `applyDifficulty` transform — see Decision 6. CRITICAL (reviewer R2 pt2): the curve offset already raised every magnitude, so `applyDifficulty` must touch ONLY the 4 retained feel-fields and must NOT scale `boss.hp`/`hpPerArmy`, `obstacle.hp`, `enemy.hp`, `marchSpeed`, `runSpeed`, or `reinforce` (the old transform did — that would double-count and re-break Decisions 2 & 3 on Hard). After applying `bulletSpeed ×1.15` it re-clamps `bulletSpeed = min(result, 34)` (reviewer R2 pt3 — keeps the dodge invariant on Hard).

`label = index < 5 ? "STAGE "+(index+1) : "DEPTH "+(index+1)`.

### 6.3 `events.js` (pure)

```
EVENT_FX = { SANDSTORM_SPEED_MULT: 0.7, SANDSTORM_DURATION: 4, SANDSTORM_STEER_MULT: 0.8,
             FRENZY_FIRE_MULT: 0.7, FRENZY_DURATION: 5, BONUS_FRACTION: 0.2, TOLL_FRACTION: 0.1 }
eventCount(level) = clamp(floor(level/2), 0, 4)        // monotonic non-decreasing (AC6)
scheduleEvents(level, rng) -> { entities: {obstacles, enemies}, modifiers: [{type, z, ...}] }
```
- **Entity-events** (injected into the obstacle/enemy lists; reuse existing entity code, counted in the mandatory budget §6.2 step 4):
  - *ambush wave* → extra `Enemy` at z, `hp` sized in the z-order pass, `marchSpeed`.
  - *elite block* → full-width `Obstacle`, `hp = ELITE_MULT(≈1.5)×` a normal mandatory at that z.
- **Modifier-events** (`modifiers` array, sorted by z; reuse the timed-buff pattern):
  - *toll* → instant `crowd.sub(round(expectedCountAt(z)·TOLL_FRACTION))` at z. (A count-cost modifier, NOT a red gate — preserves AC4's both-green gate invariant.)
  - *bonus cache* → instant `crowd.add(round(expectedCountAt(z)·BONUS_FRACTION))` at z.
  - *sandstorm* → RUN z-event, timed: `runSpeed ×= SANDSTORM_SPEED_MULT` (balance-relevant, verifier-modeled) + steer-sensitivity `×SANDSTORM_STEER_MULT` (mild, Game-only feel, NEVER blocks a dodge → not in the contract).
  - *frenzy* → BOSS-fight modifier (NOT z-placed): a per-stage `boss.frenzy` flag; armed at boss-fight start for `FRENZY_DURATION`, applied through `bossVolley(boss, hpFraction, frenzyMult)` (Decision 12, floored composition, no drift).

`scheduleEvents` returns toll/bonus/sandstorm in `modifiers` (sorted by z, fired on RUN z-crossing) and sets the boss `frenzy` flag separately. The FX constants live here, imported by BOTH Game and the verifier (DRY). The verifier models toll/bonus (count delta at z-crossing), sandstorm (runSpeed during its window), and frenzy (interval during the boss fight); ambush/elite flow through the normal block/enemy sim.

### 6.4 `Crowd.js` — visual cap (AC7/AC8)

- `VISUAL_CAP = 1500` (module const). `this.cap = config.crowdCap` (= `MAX_COUNT = 1e8`) used **only** for the count-clamp arithmetic in `setCount`/`add`/`mul`/`sub`.
- InstancedMesh size, and the `cur`/`init` array allocations, switch from `this.cap` to `VISUAL_CAP`.
- **Every loop that was bound by `this.cap` switches to `VISUAL_CAP`** — in particular the dead-slot reset loop (old `Crowd.js:163` `for (i=followers; i<this.cap; i++)`), which at `this.cap=1e8` would iterate 100M× per frame and FREEZE (reviewer R1 pt7). It becomes `for (i=rendered; i<VISUAL_CAP; i++)`.
- In `update`: `const followers = Math.max(0, this.count - 1); const rendered = Math.min(followers, VISUAL_CAP);` loop to `rendered`; `mesh.count = rendered`; reset `init[i]` for `i ∈ [rendered, VISUAL_CAP)`.
- Comment block documents the visual cap as deliberate (not truncation). HUD shows real `count`.
- **Large-number rendering (reviewer R2 pt7):** the in-world count `plate` and the boss HP `tag` can reach 7-10 digits (`hp ≈ hpPerArmy·1e8`). They use a shared `formatCompact(n)` helper (`< 1e4` → raw; else `12.3k` / `1.4M` / `2.1B`) so the fixed-canvas `makeTextSprite` never clips. The **DOM HUD count** (AC8 "no truncation") shows the FULL integer — a DOM pill that never clips — so the true logical count is always exactly visible.

### 6.5 `Boss.js` + `Track.js` — `setHp` (AC9)

- `Boss.setHp(hp)`: `this.maxHp = hp; this.hp = hp;` refresh `_hpShown`/tag. Boss constructor still reads `config.boss.hp` for the initial/menu value.
- Frenzy goes through the SHARED model: `bossVolley(boss, hpFraction, frenzyMult=1)` in `difficulty.js` multiplies `interval` by `frenzyMult`. `Boss.update(dt, firepower, armyX, armyZ, bossBullets, frenzyMult=1)` passes it through to `bossVolley`; Game supplies the active frenzy value. No `frenzyMult` field on the Boss instance (avoids a second application site → no drift, reviewer R1 pt8).
- `Track` unchanged (passes config through; tolerates injected obstacle/enemy entries — they're plain specs).

### 6.6 `Game.js`

**Remove the `this.stages` array entirely.** The constructor signature becomes `constructor(audio)` (no stages arg — `main.js` change §7). Every current `this.stages` reference is replaced (reviewer R1 pt12 — miss one → crash on restart):
- ctor `this.stages = ...` / `this.config = this.stages[0]` → `this.config = generateStage(0, MENU_SEED, PRESETS.normal)` (menu backdrop).
- ctor `worldLen = Math.max(...this.stages.map(s=>s.boss.z)) + END_PAD` → `worldLen = BOSS_Z + END_PAD` (fixed const).
- `_activeStage(i)` → `generateStage(i, this.runSeed, this.preset)`.
- `restart()` `this.config = this.stages[0]` → `this.config = generateStage(0, MENU_SEED, PRESETS.normal)`.
- `_tickWinSequence` `stageIndex < this.stages.length-1` branch → climax check (below).
- `_end` `Stage ${stageIndex+1}` label → depth label (below).

Other changes:
- `start(difficulty)`: `this.runSeed = (Math.random()*0xffffffff)>>>0`; `this.preset = PRESETS[difficulty]`.
- `_advanceStage`/`_beginStart`: keep the carry logic; also reset the event scheduler pointer `this._modIndex=0`, `this.sandstormLeft=0`, `this.frenzyLeft=0`; **persist best on every advance** (Decision 10). Track `this.peakCount`.
- RUN→BOSS transition: `const army = this.crowd.count; this.track.boss.setHp(Math.round(cfg.boss.hpBase + cfg.boss.hpPerArmy * army))`.
- `_update` RUN: effective `runSpeed = cfg.runSpeed · (this.sandstormLeft>0 ? SANDSTORM_SPEED_MULT : 1)`; effective steer sensitivity ×`SANDSTORM_STEER_MULT` when active (feel-only). Tick `sandstormLeft`. RUN modifier scheduler: while `leaderZ` crosses `cfg.modifiers[this._modIndex].z`, fire it — toll→`crowd.sub`, bonus→`crowd.add`+pop, sandstorm→`sandstormLeft=DURATION` — then `hud.flashBanner(EVENT_LABEL[type])` + advance `_modIndex` (a `while`, since multiple modifiers can fall in one frame's z-step).
- RUN→BOSS transition: in addition to `setHp`, arm frenzy: `this.frenzyLeft = cfg.boss.frenzy ? FRENZY_DURATION : 0` (+ banner if armed).
- `_update` BOSS: tick `frenzyLeft` by dt; pass the active frenzy to the boss: `const frenzy = this.frenzyLeft>0 ? FRENZY_FIRE_MULT : 1; this.track.boss.update(dt, F, leaderX, this.leaderZ, this.bossBullets, frenzy)`.
- `_tickWinSequence` end:
  ```
  if (this.stageIndex === CLIMAX_INDEX) this._end('WIN')   // finale (index 4) → WIN + endless button
  else this._advanceStage()                                 // stages 1-4 and endless 6+ auto-advance
  ```
- New `continueEndless()` (wired to the WIN screen's endless button): `this.screens.hideAll(); this._advanceStage();` (advances index 4→5, state PLAYING).
- `this.peakCount = Math.max(this.peakCount, crowd.count)` each frame; `_persistBest()` reads/writes localStorage `swarmrun.bestDepth`/`swarmrun.bestPeak` (try/catch like AudioManager), called on advance + on `_end`.
- `_end`: stats show current depth + peak; lose screen also shows persisted best depth + best peak.

### 6.7 UI

- `index.html`: repurpose `#hud-stage` to show `STAGE n` / `DEPTH n`. Add a `#btn-continue-endless` button to the win screen + a `#best-run` line to the lose screen. Event banner reuses `#hud-banner`.
- `Screens.js`: wire `onContinueEndless`; `showWin(stats, isFinale)` toggles the endless button + "FINAL BOSS" copy; `showLose(stats, best)` shows best run.
- `HUD.js`: `flashBanner` already exists — used for event announces. Depth label via `show(label)`.

### 6.8 `verify-balance.mjs` (rewrite)

- Import `generateStage` + `events.js` FX + `applyDifficulty`/`bossVolley`/`PRESETS`.
- For each `tier ∈ {normal,hard}`, `seed ∈ 0..99`: chain clean across depths 1-12 (carry floored), and run sloppy + careless + undodged.
- `simulate(stage, startCount, policy)` mirrors `_update`: gate picks (max/min), focus fire (single-target nearest-z), contacts (`min(count, ceil(hp))`), modifier events at z-crossing (toll `count−=`, bonus `count+=`, sandstorm `runSpeed×=`, frenzy `frenzyMult` into `bossVolley`), boss phase with `setHp(army)` at entry + volley/enrage. `clean` dodges the fan (`eatsBullets=false`); `undodged`/`sloppy`/`careless` eat it.
- Assertions:
  - AC17 — depths 1-5, every seed, both tiers: clean WINS with timer margin (100%); sloppy LOSES (100%); careless LOSES (100%).
  - AC18 — every clean boss fight, depths 1-12: `5 ≤ fightTime ≤ 18` (measured under the sim's real drain) AND `runTime+fightTime < timeLimit` with margin.
  - AC19 — for each tier, across sampled depths: metric (a) `nominalArmy(level)` strictly increasing; metric (b) TOTAL undodged fight drain non-decreasing within a 2% tolerance; endless depths 6-12 stay in the [5,18]s band (no melt, no stall) without a win requirement.
  - AC4 — for every generated growth gate, `winner(count=1) ≠ winner(count=1e6)` (count-dependent).
- Per-check PASS/FAIL report (preserve the existing style); aggregate rates printed; `process.exit(non-zero)` on any failure.

## 7. Files Changed

- `src/config/generator.js` — NEW. Pure `generateStage`; backbone curve; seeded placement; threat/boss scaling; finale special-case.
- `src/config/events.js` — NEW. Pure event registry + scheduler + FX constants.
- `src/config/difficulty.js` — `PRESETS` become `{id,label,curveOffset,mult}`; keep `applyDifficulty` (mult transform); `bossVolley(boss, hpFraction, frenzyMult=1)` gains the frenzy param (shared offense knob, no drift).
- `src/entities/Crowd.js` — visual cap (1500), unbounded logical count via `config.crowdCap`/`MAX_COUNT`, ALL cap-bound loops/arrays → `VISUAL_CAP`.
- `src/entities/Boss.js` — `setHp(hp)`; `update(...)` gains a trailing `frenzyMult=1` arg forwarded to `bossVolley` (no instance frenzy field).
- `src/world/Track.js` — pass-through (no structural change; tolerates injected obstacle/enemy specs).
- `src/Game.js` — on-demand generation, fixed world, boss-HP scaling at entry, event scheduler, climax→WIN→endless, peak/best tracking, random seed.
- `src/ui/HUD.js` — depth label, event banner usage.
- `src/ui/Screens.js` — endless-continue button, finale win copy, best-run on lose.
- `index.html` — endless button, best-run line, depth label.
- `src/main.js` — drop stage imports; `new Game(audio)` (no stages array).
- `scripts/verify-balance.mjs` — full statistical rewrite.
- DELETE `src/config/stage1.js`, `stage2.js`, `stage3.js`.

## 8. Verification

1. [AC1-2] `node -e "import('./src/config/generator.js')"` — imports with no THREE; same `(index,seed,preset)` yields identical JSON; different seeds differ.
2. [AC3] Generated `boss.z` constant across depths 1-12.
3. [AC4] Verifier gate-flip check passes for every generated gate.
4. [AC5-6] `events.js` imports pure; event count non-decreasing with depth.
5. [AC7-8] In-browser: grow count past 1500 (reinforce/gates) — ≤1500 instances render, HUD shows true count, no console errors.
6. [AC9] Boss tag HP at entry ≈ `hpPerArmy·army`; bigger army → bigger HP, similar fight time.
7. [AC10] Hard configs show offset+multiplier effects; verifier imports both.
8. [AC11-13] Clear stage 5 → "FINAL BOSS"/"YOU WIN" + endless button → continue → DEPTH 6+ rising until loss.
9. [AC14] Two runs differ; restart re-rolls; verifier uses fixed seeds.
10. [AC15] Game-over shows best depth + peak; reload preserves them.
11. [AC16-19,22] `npm run verify` runs sub-second, prints PASS/FAIL, exits non-zero on failure, all assertions green.
12. [AC20-21] `grep -r stage1` finds nothing; Road/Environment built once.
13. `npm run build` succeeds.
