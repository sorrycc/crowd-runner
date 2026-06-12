// ── Difficulty transform + shared boss model (design 2026-06-12-difficulty-tiers) ──
// SINGLE SOURCE OF TRUTH for what "Hard" means and for the boss volley/enrage model,
// imported by BOTH the game (src/Game.js, src/entities/Boss.js) and the headless verifier
// (scripts/verify-balance.mjs). This module imports NOTHING — it is pure data + pure math,
// so importing it on the THREE side (Boss.js) can never pull THREE into the no-THREE
// verifier, and vice-versa (design Decision 1/6, reviewer R2 pt 2).

// Stage files stay the NORMAL baseline. HARD is a runtime multiplier transform — no
// duplicated per-tier config files (DRY). Multipliers are verifier-tuned.
export const PRESETS = {
  normal: { id: 'normal', label: 'NORMAL', mult: null }, // identity (still deep-clones)
  hard: {
    id: 'hard',
    label: 'HARD',
    mult: {
      timeLimit: 0.85, // tighter clock
      runSpeed: 1.12, // faster auto-run
      bossHp: 1.3, // tankier boss
      bossFireInterval: 0.85, // fires more often
      bossBulletSpeed: 1.15, // harder to dodge
      bossBulletsAdd: 2, // wider fan
      obstacleHp: 1.2, // beefier blocks
      enemyHp: 1.2, // beefier squads
      marchSpeed: 1.15, // squads close faster
      reinforce: 0.8, // power-up reinforcements weaker
    },
  },
}

// Pure transform → a NEW stage object every call (design Decision 2, reviewer R2 pt 8).
// Normal applies no multipliers but still returns a fresh deep clone tagged with the tier,
// so there is no asymmetric aliasing of the imported stage singleton. Stage configs are pure
// JSON-serializable data (no functions), so structuredClone-via-JSON is safe.
// NOT transformed: boss.z (track length is tier-invariant), crowdCap, perSoldierDPS, gate
// values (gate math identical across tiers), boss.bulletDamage, boss.enrage, bossStandoff.
export function applyDifficulty(stage, preset) {
  const p = preset || PRESETS.normal
  const s = JSON.parse(JSON.stringify(stage))
  s.tier = p.id
  s.tierLabel = p.label
  const m = p.mult
  if (m) {
    s.timeLimit = stage.timeLimit * m.timeLimit
    s.runSpeed = stage.runSpeed * m.runSpeed
    s.boss.hp = Math.round(stage.boss.hp * m.bossHp)
    s.boss.fireInterval = stage.boss.fireInterval * m.bossFireInterval
    s.boss.bulletSpeed = stage.boss.bulletSpeed * m.bossBulletSpeed
    s.boss.bullets = stage.boss.bullets + m.bossBulletsAdd
    for (const o of s.obstacles) o.hp = Math.round(o.hp * m.obstacleHp)
    for (const e of s.enemies) {
      e.hp = Math.round(e.hp * m.enemyHp)
      if (e.marchSpeed) e.marchSpeed *= m.marchSpeed
    }
    s.powerupTuning.reinforce = Math.round(stage.powerupTuning.reinforce * m.reinforce)
  }
  return s
}

// Shared boss volley/enrage model (design Decision 6). ONE source for the game + the verifier
// so the offense math can never drift. Takes an explicit hpFraction (0..1) so the two callers
// with different "hp" conventions agree (reviewer R2 pt 1): the Boss instance passes
// `this.hpFraction` (= live this.hp / this.maxHp); the verifier passes `hp / boss.hp`
// (live / config-max). `boss` only needs { fireInterval, bullets, enrage }.
// Enrage (under boss.enrage.below HP fraction): shorter interval + extra bullets.
export function bossVolley(boss, hpFraction) {
  const e = boss.enrage
  const enraged = hpFraction < e.below
  return {
    enraged,
    interval: enraged ? boss.fireInterval * e.fireIntervalMult : boss.fireInterval,
    bullets: enraged ? boss.bullets + e.bulletsAdd : boss.bullets,
  }
}
