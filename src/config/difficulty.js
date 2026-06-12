// ── Difficulty tiers + shared boss model (redesign 2026-06-12-endless-procedural) ──
// SINGLE SOURCE OF TRUTH for what "Hard" means and for the boss volley/enrage/frenzy model,
// imported by BOTH the game (src/Game.js, src/entities/Boss.js) and the headless verifier
// (scripts/verify-balance.mjs). This module imports NOTHING — pure data + pure math — so it can
// never pull THREE into the no-THREE verifier (or generator), and vice-versa.
//
// In the redesign, tiers are a CURVE OFFSET + a small retained multiplier set (design Decision 6):
//  • curveOffset shifts level = index + curveOffset, so Hard plays the difficulty curve ~2 stages
//    ahead at every depth (bigger boss HP-per-army, denser/tankier threats, bigger gate values).
//    The per-index magnitude ramp lives in the generator (src/config/generator.js).
//  • mult applies ONLY the 4 "danger-feel" knobs an index offset can't express. It must NOT touch
//    boss.hp/hpPerArmy, obstacle.hp, enemy.hp, marchSpeed, runSpeed or reinforce — those are
//    already raised by the offset, and double-counting them would break the army-scaled fight-time
//    and clean-clear invariants on Hard (design Decision 2/3/6).

export const BULLET_SPEED_CAP = 34 // dodgeability ceiling — the fan eat-all geometry assumes this

export const PRESETS = {
  normal: { id: 'normal', label: 'NORMAL', curveOffset: 0, mult: null },
  hard: {
    id: 'hard',
    label: 'HARD',
    curveOffset: 2, // Hard ≈ Normal depth +2 on the curve
    mult: {
      timeLimit: 0.9, // tighter clock
      bossFireInterval: 0.85, // fires more often
      bossBulletSpeed: 1.15, // harder to dodge (re-clamped to BULLET_SPEED_CAP)
      bossBulletsAdd: 1, // one extra fan bullet
    },
  },
}

// Pure transform → a NEW stage object every call. Normal applies no multipliers but still returns
// a fresh deep clone tagged with the tier, so there is no asymmetric aliasing. Stage configs are
// pure JSON-serializable data, so structuredClone-via-JSON is safe.
// REWRITTEN for the redesign: ONLY the 4 retained feel-fields (design Decision 6). Everything else
// (HP, density, gate values, runSpeed) is handled by the generator's curve offset.
export function applyDifficulty(stage, preset) {
  const p = preset || PRESETS.normal
  const s = JSON.parse(JSON.stringify(stage))
  s.tier = p.id
  s.tierLabel = p.label
  const m = p.mult
  if (m) {
    s.timeLimit = stage.timeLimit * m.timeLimit
    s.boss.fireInterval = stage.boss.fireInterval * m.bossFireInterval
    s.boss.bullets = stage.boss.bullets + m.bossBulletsAdd
    s.boss.bulletSpeed = Math.min(stage.boss.bulletSpeed * m.bossBulletSpeed, BULLET_SPEED_CAP)
  }
  return s
}

// Shared boss volley/enrage/frenzy model (design Decision 6/12). ONE source for the game + the
// verifier so the offense cadence can never drift. Takes an explicit hpFraction (0..1) so the two
// callers with different "hp" conventions agree: the Boss instance passes `this.hpFraction`
// (= live this.hp / this.maxHp); the verifier passes `hp / maxHp`.
//
// Composition (design Decision 12, reviewer R2 pt1): the interval is the base interval, times the
// enrage multiplier (when under enrage.below HP), times the frenzy multiplier (when a frenzy event
// is active during the boss fight) — floored at MIN_FIRE_INTERVAL so enrage×frenzy can't produce a
// machine-gun spike. `boss` only needs { fireInterval, bullets, enrage }.
const MIN_FIRE_INTERVAL = 0.45

export function bossVolley(boss, hpFraction, frenzyMult = 1) {
  const e = boss.enrage
  const enraged = hpFraction < e.below
  const interval = Math.max(
    MIN_FIRE_INTERVAL,
    boss.fireInterval * (enraged ? e.fireIntervalMult : 1) * frenzyMult
  )
  return {
    enraged,
    interval,
    bullets: enraged ? boss.bullets + e.bulletsAdd : boss.bullets,
  }
}
