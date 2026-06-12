// ── Difficulty tiers + shared boss model (redesign 2026-06-12-endless-procedural) ──
// SINGLE SOURCE OF TRUTH for what "Hard" means and for the boss skill/cadence/enrage/frenzy model,
// imported by BOTH the game (src/Game.js, src/entities/Boss.js) and the headless verifier
// (scripts/verify-balance.mjs). It imports ONLY the pure THREE-free `mulberry32` from util/rng.js
// (the seeded skill picker) — never THREE — so it can never pull THREE into the no-THREE verifier
// (or generator), and vice-versa (2026-06-12-boss-seeded-skills AC3).
import { mulberry32 } from '../util/rng.js'
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

// ── Shared seeded boss-SKILL model (2026-06-12-boss-seeded-skills) ──────────────────────────────
// Generalizes the old single-fan `bossVolley` into a depth-scaled, SEEDED random-skill system.
// ONE source for the game (Boss.js) + the verifier (verify-balance.mjs) so neither the cadence nor
// the per-cast skill SEQUENCE can ever drift.
//
// Split-clock discipline (design §6.1): `castCadence` is called EVERY frame to advance the fire
// timer (interval is skill-independent); `bossCast(...,castIndex++,...)` draws the skill ONLY on a
// fire frame. Because the interval never depends on the drawn skill, `castIndex` stays in exact
// lockstep between game and verifier regardless of dt (AC2).
const MIN_FIRE_INTERVAL = 0.45
const CAST_PRIME = 0x9e3779b1
export const PATTERN_MAX = 16 // hard cap on orbs/cast (core + cosmetic) — sizes the bullet pool

// Skill registry. Bullet patterns are ONE verifier family parameterized by `hitMult` (= harmful
// "core" orbs as a fraction of `bullets`); the four are distinct VISUAL/dodge-feel treatments in
// the game. undodgedKill = round(bullets·hitMult)·bulletDamage is EXACT by construction (only the
// core orbs are harmful; all extra silhouette orbs are cosmetic-only — design §6.3).
export const BOSS_SKILLS = {
  fan: { kind: 'bullets', hitMult: 1.0 }, // aimed fan — all core orbs at the army (today)
  wall: { kind: 'bullets', hitMult: 0.5 }, // road-spanning row, off-center gap = the safe lane
  arc: { kind: 'bullets', hitMult: 0.7 }, // orbs released over a sweep
  ring: { kind: 'bullets', hitMult: 0.5 }, // radial fan; core orbs point at the army
  slam: { kind: 'slam' }, // telegraphed aimed X-band
  adds: { kind: 'adds' }, // summoned full-width marching squads
  shield: { kind: 'shield' }, // incoming-dmg time tax
}

// Cadence ONLY (the old bossVolley body): interval = base × enrage × frenzy, floored so the
// enrage×frenzy product can't machine-gun. `boss` needs { fireInterval, enrage }.
export function castCadence(boss, hpFraction, frenzyMult = 1) {
  const e = boss.enrage
  const enraged = hpFraction < e.below
  const interval = Math.max(
    MIN_FIRE_INTERVAL,
    boss.fireInterval * (enraged ? e.fireIntervalMult : 1) * frenzyMult
  )
  return { enraged, interval }
}

function pickType(skills, rng) {
  const total = skills.reduce((s, k) => s + k.weight, 0) || 1
  let r = rng() * total
  for (const k of skills) {
    r -= k.weight
    if (r < 0) return k.type
  }
  return skills[skills.length - 1].type
}

// Draw ONE skill for cast index `k`. Seeded `mulberry32(boss.seed ^ (k·PRIME))` so cast #k is
// byte-identical in game + verifier regardless of dt (AC1/AC2). Returns a descriptor both callers
// consume; `rng` is returned for the GAME's per-cast spatial choices (gap slot, sweep dir, ring
// phase, slam jitter, cosmetic placement) — the verifier never reads it. Enrage adds +bullets to
// BULLET casts only; cadence (shortened interval) is applied separately via castCadence (Decision 3).
export function bossCast(boss, hpFraction, castIndex, frenzyMult = 1) {
  const skills = boss.skills && boss.skills.length ? boss.skills : [{ type: 'fan', weight: 1 }]
  const rng = mulberry32(((boss.seed >>> 0) ^ ((castIndex * CAST_PRIME) >>> 0)) >>> 0)
  const type = pickType(skills, rng)
  const def = BOSS_SKILLS[type] || BOSS_SKILLS.fan
  const { enraged } = castCadence(boss, hpFraction, frenzyMult)
  const t = boss.skillTuning || {}
  const out = { type, kind: def.kind, enraged, undodgedKill: 0, rng }

  if (def.kind === 'bullets') {
    const bullets = boss.bullets + (enraged ? boss.enrage.bulletsAdd : 0)
    out.bullets = bullets
    out.hitCount = Math.max(1, Math.round(bullets * def.hitMult)) // EXACT harmful-orb count
    out.undodgedKill = out.hitCount * boss.bulletDamage
  } else if (def.kind === 'slam') {
    out.halfW = t.slamHalfW ?? 1.1
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
