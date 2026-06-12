# Rebalance Difficulty — Bosses Melt, Runs Never Lost

## 1. Background

crowd-runner plays too easy. Two confirmed failure modes:

1. **You almost never lose.** A run reaches the boss nearly every time. The only loss conditions in practice are the timer expiring (60s/65s) or the crowd hitting 0, and neither happens — gates are generous, power-ups are pure upside, enemies/blocks barely threaten the crowd.
2. **Bosses melt instantly.** A capped 200-soldier army with all buffs outputs ~634 DPS and deletes the boss (HP 520/720) in ~1s, so the boss fight has no tension.

The army's DPS into bosses/enemies is `crowd.count · perSoldierDPS(0.9) · dmgMult(≤1.6) · rapid(2.2)`. Tuning lives in `src/config/stage1.js`, `src/config/stage2.js`, and (nominally) a few constants in `src/Game.js`. The balance contract is `scripts/verify-balance.mjs` (`npm run verify`).

## 2. Requirements Summary

**Goal:** Rebalance existing tuning numbers so the boss fight is no longer a ~1s melt and sloppy players reliably lose, while a skillful clean run still clears both stages — encoding the new difficulty bar into the verify contract.

**Scope (in):**
- Numeric tuning in `src/config/stage1.js`, `src/config/stage2.js`.
- Additive edits to `scripts/verify-balance.mjs`: a `sloppy` policy + new assertions (boss-fight-duration floor, buffed-no-melt). Existing `clean`/`careless` simulation math is NOT changed, only extended.

**Scope (out):** New game mechanics, enemy behaviors, stages, power-up types; difficulty selector/modes; changing the existing clean/careless sim logic. The 2-stage structure with army carryover floored to `startCount` is preserved.

## 3. Acceptance Criteria

1. `node scripts/verify-balance.mjs` exits 0 (all checks PASS) after rebalancing.
2. A new `sloppy` policy (worst gate side every gate; dodges dodgeables; shoots mandatory blocks/enemies; no power-ups; eats boss bullets) reliably **LOSES** — via run-wipe, boss-bullet-wipe, or timeout — asserted as a PASS check.
3. The existing `careless` (worst-everything) policy still **LOSES** (retained as sanity floor).
4. A `clean` run still **WINS** both stages — stage1 from start, stage2 from carried army AND from carry-floor `startCount` — each with **ZERO contact drain** (existing checks preserved).
5. The clean run's **actual** boss fight (whatever count it arrives with, no power-ups) lands in ~6–12s; the script asserts a slack floor (**> 5s**, deliberately below the ≈9s achieved so an unrelated gate tweak can't make it tangent) AND that the full clean run finishes within each stage's `timeLimit`.
6. An undodged army that eats **every** boss bullet (best gates, competent run, no power-ups) is crippled by the boss — hard PASS/FAIL **drain-based** anchor for the boss-offense numbers: such a run loses **> 100** soldiers to the boss in stage 1 and **> 120** in stage 2 (`bossDrain = bossEntryCount − finalCount`, computed identically on win or loss). Drain-based, not win/lose-based, on **both** stages so the anchor can't flip on a small entry-count drift (review pt 1/5). At the design's entry counts s1 fully wipes (drain = 134 = death, proving lethality) and s2 drains ~169 (survives at 31/200). (Proves "boss can drain the crowd if the player eats bullets.")
7. A fully-buffed capped army takes **> 2.5s** to kill the boss — hard PASS/FAIL "no 1-second melt" guard. This is a **closed-form** check `boss.hp / (crowdCap · perSoldierDPS · dmgCap · rapidMult) > 2.5`, NOT a `simulate()` call; it conservatively assumes buffs active 100% of the fight.
8. All changes confined to `src/config/stage1.js`, `src/config/stage2.js`, and additive edits to `scripts/verify-balance.mjs`. No new game mechanics, enemy types, stages, power-up types, or difficulty selector. (`src/Game.js` needs no change — all balance values are config-driven.)

## 4. Problem Analysis

The verify contract models only two extremes — `clean` (perfect, no power-ups) and `careless` (worst-everything). Both already behave correctly (clean wins, careless loses). The real "too easy" gap is the **median experience**: a player who mixes gate picks reaches the boss with a healthy army, grabs power-ups, and faces a boss with near-zero counter-threat that melts in ~1s.

Levers evaluated (validated with a throwaway sim mirroring `verify-balance.mjs`):

- **Lower `crowdCap` 200 → 150** — *rejected as primary.* Shrinks max DPS (helps melt guard) but starves clean's stage-2 run-phase DPS so it can't clear a mandatory block/enemy before contact → clean takes contact drain (AC4 fails). To keep clean clean I'd have to *lower* mandatory threat HP, contradicting "enemies bite harder." Disruptive, regression-prone.
- **Bump mandatory enemy/block HP** — *rejected.* Same failure: clean can't kill them in time → contact drain. Bumping *dodgeable* HP only affects `careless` (already loses) since `sloppy` dodges them → low value.
- **Lower `perSoldierDPS`** — not needed once boss HP + buff nerfs do the work; left at 0.9.
- **Chosen: boss HP + boss offense + power-up nerfs (+ meaner sub-gates).** Because the winning `clean` policy *dodges* all boss bullets, boss HP and offense **never threaten the clean contract** — they can be raised freely to make the fight last ~9s and make eating bullets lethal. This fixes BOTH headline complaints with zero run-phase side effects. Power-up nerfs make buffs an edge (and satisfy the melt guard at the cap). Meaner sub-gate values punish bad picks (clean always picks the better non-sub side, so it's contract-safe).

## 5. Decision Log

**1. How to make "sloppy loses" testable**
- Options: A) add an intermediate `sloppy` policy that must lose · B) widen the existing `careless` margin only · C) rely on manual playtesting
- Decision: **A)** — add `sloppy` (worst gates, dodge dodgeables, shoot mandatory, no power-ups, eat boss bullets) that must LOSE; keep `careless` as worst-case sanity floor. Worst-gates alone already run-wipes on stage 1 (z118 mandatory block), so loss is via run-wipe — acceptable per AC2.

**2. Primary difficulty lever**
- Options: A) boss counter-threat · B) run-phase pressure (enemy/block HP, gate subs) · C) `crowdCap` reduction
- Decision: **A)** — boss is primary (raise `hp` so the fight lasts; raise `burst`/lower `fireInterval`/raise `bulletSpeed` so an undodging player drains out). Run-phase support is limited to meaner **sub-gate** values (contract-safe). Power-up nerfs make buffs an edge.
- Revised from Phase-1 suggestion: `crowdCap` is **kept at 200**, not lowered to ~150. Reason discovered during number-crunching: lowering the cap starves clean's stage-2 run-phase DPS → clean takes contact drain (AC4 regression) and would force lowering mandatory threat HP (anti-goal). The melt guard is fully met via boss HP + buff nerfs at cap 200.
- **Coupling note (review pt 7):** the melt guard at cap 200 depends on `dmgCap ≤ 1.3` AND `rapidMult ≤ 1.5` — at the old buff values `1080/(200·0.9·1.6·2.2)=1.70s` would FAIL the > 2.5s guard. So the power-up nerfs are a hard dependency of the melt AC, not just flavor. This is self-enforcing: each stage's melt assertion (AC7) recomputes from that stage's own `dmgCap`/`rapidMult`, so buffing either back up re-fails the build unless `boss.hp` rises in step.

**3. Clean boss-fight duration target**
- Options: A) 4–8s · B) 6–12s · C) 8–15s · D) floor only
- Decision: **B)** — target ~6–12s for the clean (no-power-up) fight (the player's longest/tightest-on-timer fight). Assert a slack floor (> 5s) AND within-timer. Achieved: s1 ≈ 9.0s (enters at ~134), s2 ≈ 8.9s (enters at cap 200).
- **Headroom note (review pt 8):** "raise boss.hp freely" is true for **stage 1** (clean enters at ~134, far below cap, so HP can scale with the eventual army). **Stage 2** is bounded above: clean already arrives at cap 200, so its fight time = `hp / (200·0.9)`; the 12s ceiling pins `boss.hp ≲ 2160`. 1600 sits mid-window with margin; do not push it up believing it's free.

**4. "No melt" guarantee strictness**
- Options: A) hard PASS/FAIL assertion · B) reported diagnostic only
- Decision: **A)** — hard assertion that a fully-buffed capped army takes > 2.5s to kill the boss (conservative, robust "no 1-second melt" guard, not a brittle narrow band). Achieved: s1 ≈ 3.1s, s2 ≈ 4.6s.

**5. `verify-balance.mjs` editability**
- Options: A) in scope (additive) · B) frozen
- Decision: **A)** — it is the balance CONTRACT / `npm run verify` harness, not a game mechanic. Additive only: new `sloppy` + `undodged` policies + new assertions.
- **Refactor honesty (review pt 9):** the new policy flags do *edit* two load-bearing branches (the `clean` bullet-dodge branch and the dodgeable-filter line), so the claim is downgraded from "math untouched" to "**clean/careless outcomes preserved**." Implementation must capture the current CLEAN/CARELESS output lines before the refactor and confirm they print **identically** after (cheap byte-diff insurance, on top of AC3/AC4 asserting the outcomes).

**6. Cross-stage `powerupTuning` sync assertion (reviewer pt 11) — DECLINED**
- Options: A) add a verify check that `STAGE_1.powerupTuning` deep-equals `STAGE_2`'s · B) keep stages independent
- Decision: **B)** — each stage's melt guard (AC7) recomputes from *its own* `dmgCap`/`rapidMult`, so a per-stage buff is caught by that stage's own assertion; there is no silent cross-stage breakage to guard against. A deep-equal check would couple two intentionally-standalone stage files (the stage-1 header states "adding a stage is a new file of the same shape"), adding coupling for zero contract gain. KISS/YAGNI.

**7. `src/Game.js` constant changes**
- Options: A) tune some Game.js constants · B) none needed
- Decision: **B)** — `_firepower()` and the constants (`HIT_RADIUS`, `PICK_RADIUS`, bullet speeds) just consume config or are cosmetic; every balance value lives in the stage configs. Confining changes to configs + verify is lower-risk and satisfies the goal. (The issue's "a couple of constants in Game.js" was descriptive of where tuning *can* live, not a requirement.)

## 6. Design — Final Numbers

Validated by a stepped whole-run sim mirroring `verify-balance.mjs` (fixed dt = 1/60), chained across both stages, with `clean` / `careless` / `sloppy` / `undodged` policies.

### `src/config/stage1.js`
- `boss`: `hp` 520 → **1080**, `fireInterval` 1.6 → **1.3**, `burst` 6 → **11**, `bulletSpeed` 20 → **23**
- `powerupTuning`: `rapidMult` 2.2 → **1.5**, `rapidDuration` 6 → **5**, `reinforce` 25 → **18**, `shieldDuration` 7 → **4**, `dmgBoostStep` 0.15 → **0.1**, `dmgCap` 1.6 → **1.3**
- `gates`: z140 left `['sub',18]` → **`['sub',25]`**; z186 right `['sub',12]` → **`['sub',20]`**
- `crowdCap` 200, `perSoldierDPS` 0.9, `timeLimit` 60 — **unchanged**
- **Header edit scope (review pt 10):** the best-path gate table and "reaches boss with ~134" are **unchanged** — clean always picks the better *non-sub* side at z140/z186, so growth is identical. Edit ONLY: (a) the worst-path sentence "wiped by z140 (−18 on 12 → 0)" → **(−25 on 12 → 0)**, and (b) the boss/melt sentence to reflect the new HP and the longer fight. Do not recompute the best-path table.

### `src/config/stage2.js`
- `boss`: `hp` 720 → **1600**, `fireInterval` 1.3 → **1.1**, `burst` 8 → **13**, `bulletSpeed` 22 → **25**
- `powerupTuning`: same nerfs as stage 1 (`rapidMult` 1.5, `rapidDuration` 5, `reinforce` 18, `shieldDuration` 4, `dmgBoostStep` 0.1, `dmgCap` 1.3)
- `gates`: z108 right `['sub',20]` → **`['sub',30]`**; z206 right `['sub',15]` → **`['sub',25]`**
- `crowdCap` 200, `perSoldierDPS` 0.9, `timeLimit` 65 — **unchanged**
- **Header edit scope:** the floor-path gate table is **unchanged** — clean picks the *add* side at z108/z206, not the sub. Edit ONLY the boss/melt sentence to reflect the new HP and longer fight. Do not recompute the gate table.

### `scripts/verify-balance.mjs` (additive)
Refactor the policy flags so a policy can eat boss bullets and dodge dodgeables independently of gate choice (clean/careless outcomes must print identically — see Decision 5):
- `eatsBullets = policy !== 'clean'` (clean dodges; careless/sloppy/undodged eat). Replaces the current `if (!clean)` bullet branch.
- `standInDodgeables = policy === 'careless'` so `sloppy`/`undodged` dodge dodgeables (mandatory-only block list, like `clean`) while `careless` still stands in them. Replaces the current `clean ? o.fullWidth : true` filter with `!standInDodgeables ? true : o.fullWidth`.
- Gate side: `clean`/`undodged` pick `max`; `careless`/`sloppy` pick `min`.

Two new policies:
- `sloppy`: worst gates (`min`), dodge dodgeables, shoot mandatory blocks/enemies, no power-ups, eat boss bullets.
- `undodged`: **best** gates (`max`) + competent run (zero contact drain, like clean) but **eats every boss bullet**, no power-ups. Models "perfect run, sloppy at the boss" — anchors the boss-offense numbers.

New PASS/FAIL checks:
- `sloppy run loses` (chained s1→s2): PASS if it loses anywhere. (Record the actual reason+z — review pt 4.)
- `careless run loses` (existing, kept).
- `clean boss fight > 5s` for s1 and s2 (slack meaningful-fight floor — review pt 1), reading the actual chained clean `fightTime`.
- `undodged s1 boss drain > 100` (hard anchor for stage-1 boss HP+offense; drain = full 134 = wipe). **Drain-based, not loss-based**, so it can't flip to a FAIL if a future gate tweak nudges best-path entry past the ~138 win-threshold (review pt 1).
- `undodged s2 boss drain > 120` (hard anchor for stage-2 boss HP+offense; it drains ~169 and survives at 31/200 — also drain-based for the same robustness, review pt 5).
- `bossDrain` is computed `bossEntryCount − finalCount` identically on win or loss (on a wipe, finalCount = 0 → drain = full entry).
- `no 1s melt`: closed-form `boss.hp / (crowdCap · perSoldierDPS · dmgCap · rapidMult) > 2.5` for s1 and s2 (NOT a sim call — review pt 3).

### Resulting balance (sim)
- CLEAN s1: win, boss entry ≈134, fight ≈9.0s, total ≈30.2s/60, zero drain.
- CLEAN s2 (carried & floor): win, entry 200, fight ≈8.9s, total ≈30.1s/65, zero drain.
- SLOPPY: loses in stage 1 — `reason=contact-wipe`, drain 12, end 0. The worst-gate army (1→3→6→12) reaches the z118 mandatory full-width block (hp 50) unable to out-DPS it in the engagement window, then the leftover block contacts the 12-soldier army → wipe. (Confirmed by `npm run verify`.)
- CARELESS: loses.
- UNDODGED (eat ALL boss bullets, best gates, no power-ups): s1 **fully wiped** by boss bullets (drain 134 = death); s2 survives at ~31/200 (drain ~169) — boss is genuinely lethal to undodged play.
- BUFFED MELT at cap (closed-form): s1 ≈3.1s, s2 ≈4.6s (> 2.5s).

## 7. Files Changed
- `src/config/stage1.js` — boss HP/offense up, power-ups nerfed, two sub-gates meaner, comment header refreshed.
- `src/config/stage2.js` — boss HP/offense up, power-ups nerfed, two sub-gates meaner, comment header refreshed.
- `scripts/verify-balance.mjs` — add `sloppy` + `undodged` policies + boss-duration, undodged-drain, and no-melt assertions (additive; clean/careless outcomes preserved per Decision 5).

## 8. Verification
1. [AC1] `npm run verify` exits 0, all checks PASS.
2. [AC2] verify output shows `PASS  sloppy run loses`.
3. [AC3] verify output shows `PASS  careless run loses`.
4. [AC4] verify output shows clean s1, s2(carried), s2(floor) all win with `drain=0`.
5. [AC5] verify prints clean fight times (~9s each), `PASS  clean boss fight > 5s` for both stages, and clean totals within `timeLimit`.
6. [AC6] verify shows `PASS  undodged s1 boss drain > 100` and `PASS  undodged s2 boss drain > 120`.
7. [AC7] verify shows `PASS  no 1s melt (sN)` with computed melt > 2.5s for both stages.
8. [AC8] `git diff --stat` touches only `src/config/stage1.js`, `src/config/stage2.js`, `scripts/verify-balance.mjs` (+ this design doc). `src/Game.js` untouched.
9. [Refactor safety, Decision 5] CLEAN/CARELESS output lines printed identically before vs after the verify refactor.
10. Manual sanity (optional): `npm run dev`, confirm the boss fight lasts several seconds and eating bullet volleys visibly drains the crowd; a deliberately bad run loses.
