// ── Procedural stage generator (redesign 2026-06-12-endless-procedural, design §6.1/6.2) ──
// PURE — imports only the sibling pure configs (no THREE), so the headless verifier imports the
// EXACT same generator the game runs. generateStage(index, seed, preset) returns the SAME config
// shape Track/Gate/Boss/Crowd already consume, plus a few new fields (boss.hpPerArmy, boss.finale,
// boss.frenzy, modifiers).
//
// THE ARMY-SCALING IDEA (design Decision 2/3/5):
//  • The army is unbounded (the 200 cap is gone). It grows ≥2× per growth gate (the +N vs ×M
//    mechanic always doubles past the flip point), so per-stage growth is set by the GATE COUNT.
//  • nominalArmy(level) = A0·R^level is the expected clean boss-entry army, DERIVED from the gate
//    structure (G0 intro gates, GN per endless stage, avg factor ~2.2). It is used only for the
//    gate-calibration seed (entryArmy), boss-offense scaling, and the monotonicity check.
//  • Threat HP is sized off the generator's ACTUAL per-seed clean/worst trajectories, so it is
//    exact regardless of formula drift: clean clears every mandatory with ≥30% margin (zero drain)
//    while the worst-min army cannot (it drains). The verifier proves the summed sloppy drain wipes.
//  • Boss HP is NOT baked — Game sets hp = hpPerArmy·armyAtEntry at RUN→BOSS, so a bigger army
//    faces a proportionally bigger boss and the fight lasts a roughly CONSTANT time at every depth.

import { applyDifficulty, PRESETS } from './difficulty.js'
import { scheduleEvents, EVENT_FX } from './events.js'
import { mulberry32 } from '../util/rng.js'

// ── world (fixed — "denser, not longer", design Decision 7) ──
export const BOSS_Z = 380
export const END_PAD = 40
export const WORLD_LEN = BOSS_Z + END_PAD
export const BOSS_STANDOFF = 20
export const CLIMAX_INDEX = 4 // stage 5 (0-based) is the scripted finale

// ── unbounded-army sanity clamp (shared by Crowd.count; design Decision 1) ──
// 1e12 ≪ 2^53, so integer arithmetic stays exact, and the trajectory never saturates through the
// sampled depth 12 — which would otherwise flatten the monotonicity check. Render arrays are sized
// to Crowd's VISUAL_CAP, NOT to this, so a huge clamp costs nothing.
export const MAX_COUNT = 1e12

// ── combat / pacing constants ──
const DPS = 0.9 // per-soldier firepower
// FIRE_RANGE is a GLOBAL PACING constant, not just a sight radius: it feeds slot = FIRE_RANGE+GAP
// (threat spacing), the enemy engagement `window` (HP sizing), `maxThreats` (how many mandatory fit),
// and therefore the clean carry army → boss bulletDamage. Raising it respaces + resizes everything.
const FIRE_RANGE = 32
const ROAD_HALF = 3.0
const RUN_START = 14 // ease-in before the first gate
const RUN_END = BOSS_Z - BOSS_STANDOFF // 360 — leaderZ at boss entry

// ── army curve (verifier-tuned; see header) ──
// IMPORTANT: the army curve is INDEX-based (tier-independent). A run always starts at 1 and grows
// through the same gates regardless of tier, so `nominalArmy`/`entryArmy` key on the depth INDEX,
// NOT the offset `level`. The Hard offset makes the BOSS / THREATS / DENSITY as-if-deeper (those
// key on `level`), never the army magnitude — otherwise `entryArmy` would mismatch the real carry
// on Hard's early stages (reviewer R3 pt3, deepened).
const A0 = 50 // ≈ clean boss-entry army at stage 1 (grown 1 → ~50 over G0 gates)
const R = 2.2 // per-stage growth factor (≈ avg gate factor ^ GN)
const G0 = 5 // intro growth gates (index 0)
const GN = 1 // growth gates per later/endless stage (≥2× each → 1 keeps growth sane)

// ── boss curve ──
const FIGHT_BASE = 5.5 // fight-seconds floor at level 0
const FIGHT_FINALE = 8.0 // bigger floor for the stage-5 finale (epic)
const FIGHT_SLOPE = 0.6 // +seconds per level
const FIGHT_CAP = 14 // capped below the 18s AC ceiling for dt headroom
const OFFENSE = 1.2 // bulletDamage factor → undodged total drain ≈ OFFENSE·army (wipes if eaten)
const BULLET_SPEED_PRECAP = 29.6 // pre-Hard so post-×1.15 stays ≤ 34 (dodge geometry)

// ── threat curve ──
const BETA_MIN = 0.5 // clean clears with ≥30% margin; verifier tunes β down on chain-drift
const BETA_MAX = 0.7
const GAP = 6 // min gap between mandatory engagement windows (non-overlap invariant)
const MANDATORY_BASE = 2
const MANDATORY_CAP = 10
const MARCH_SPEED = 1.2 // gentle: a fast march compresses the engagement window past the budget
const CHASE_SPEED = 3.5 // X-homing rate (units/s) — squads track the player's lane (design 6.1)
const ENEMY_HALF_WIDTH = 1.2 // narrow homing squad (~2.4 wide) that slides within the 6-wide road
// Marching threats get a conservative engagement window so focus-fire contention (the army is busy
// with a nearer threat while a squad marches into close range) never makes a CLEAN run drain.
const ENEMY_WINDOW_SAFETY = 0.6

const POWERUP_TUNING = {
  rapidMult: 1.5,
  rapidDuration: 5,
  reinforce: 18,
  shieldDuration: 4,
  dmgBoostStep: 0.1,
  dmgCap: 1.3,
}

// nominalArmy(index) — the expected clean army at boss entry for that DEPTH index (design §6.1).
// Index-based / tier-independent: the army grows the same on Normal and Hard.
export function nominalArmy(index) {
  return Math.min(MAX_COUNT, Math.round(A0 * Math.pow(R, index)))
}

// Shared gate math (no cap clamp now — only the MAX_COUNT sanity clamp). The verifier imports this
// so the game + contract apply gates identically (design Decision 4).
export function applyGate(count, [t, v]) {
  const r = t === 'add' ? count + v : t === 'mul' ? count * v : count - v
  return Math.max(0, Math.min(MAX_COUNT, Math.round(r)))
}

// Fight-seconds target at this level (design Decision 2). hpPerArmy = DPS·this → fight ≈ this,
// independent of army magnitude.
function fightTarget(level, finale) {
  return Math.min((finale ? FIGHT_FINALE : FIGHT_BASE) + FIGHT_SLOPE * level, FIGHT_CAP)
}

// A count-dependent both-green gate (design Decision 4). Clean (count C) picks the bigger side;
// the loser side makes it flip for a smaller count (so tracking your count matters).
function makeGate(z, C, rng) {
  let win, lose
  if (rng() < 0.6) {
    // clean picks ×2 (factor 2); the +N loser wins only below the flip (N < C)
    win = ['mul', 2]
    lose = ['add', Math.max(2, Math.round(C * (0.5 + rng() * 0.3)))]
  } else {
    // clean picks +N (factor ~2.1–2.5); ×2 wins only above the flip (a larger count)
    win = ['add', Math.max(2, Math.round(C * (1.1 + rng() * 0.4)))]
    lose = ['mul', 2]
  }
  const leftIsWin = rng() < 0.5
  return { z, left: leftIsWin ? win : lose, right: leftIsWin ? lose : win }
}

// HP for a mandatory threat so the worst-min army CANNOT clear it (drains) while the clean army
// clears with margin (design Decision 3). `window` = engagement seconds the army gets to shoot it.
// `tanky` (elite blocks) raises the HP toward the clean ceiling but NEVER past it — an elite is the
// beefiest must-shoot wall, not an unclearable one (the ×mult-after-clamp version made clean drain).
function sizeThreat(cleanC, worstC, window, rng, tanky = false) {
  const CLEAR_CEIL = 0.85 // clean always clears with ≥15% margin (absorbs FR=32 chain-drift; was 0.9)
  const cleanDmg = cleanC * DPS * window // damage a clean army deals in the window
  const worstDmg = worstC * DPS * window
  const lo = tanky ? 0.7 : BETA_MIN
  const hi = tanky ? CLEAR_CEIL : BETA_MAX
  let hp = (lo + rng() * (hi - lo)) * cleanDmg
  if (hp <= worstDmg * 1.1) hp = Math.min(worstDmg * 1.2, cleanDmg * CLEAR_CEIL) // worst must drain
  hp = Math.min(hp, cleanDmg * CLEAR_CEIL) // ...clean must still clear
  return Math.max(1, Math.round(hp))
}

// Expected clean army at THIS stage's boss entry — the ACTUAL recursive clean carry (not a formula),
// so threat sizing never drifts from what a real chained-clean run carries in (reviewer R3 pt1,
// deepened). Memoized; the carry is tier-independent up to the (army-neutral) Hard feel-mults.
const _cleanCache = new Map()
function expectedCleanEnd(index, seed, preset) {
  const key = `${seed >>> 0}:${preset.id}:${index}`
  if (_cleanCache.has(key)) return _cleanCache.get(key)
  const v = generateStage(index, seed, preset)._cleanEnd
  _cleanCache.set(key, v)
  return v
}

export function generateStage(index, seed, preset) {
  const p = preset || PRESETS.normal
  const rng = mulberry32((((seed >>> 0) + index * 0x9e3779b1) >>> 0) >>> 0)
  const level = index + (p.curveOffset || 0)
  const finale = index === CLIMAX_INDEX

  const runSpeed = Math.min(18 + 0.4 * level, 30)
  // army anchor = the ACTUAL recursive clean carry (tier-independent), so threat sizing tracks the
  // real chained-clean run with no formula drift.
  const entryArmy = index === 0 ? 1 : expectedCleanEnd(index - 1, seed, p)
  const startCount = index === 0 ? 1 : Math.max(1, Math.round(entryArmy * 0.15))

  // ── 1) place growth gates in the front zone ──
  const gateCount = index === 0 ? G0 : GN
  const gateSpacing = 16
  const gateZoneEnd = RUN_START + gateCount * gateSpacing

  // ── 2) schedule events (types + z); frenzy is a boss flag ──
  const ev = scheduleEvents(level, rng, { runStart: RUN_START, runEnd: RUN_END })

  // ── 3) place mandatory threats (non-overlapping windows) after the gate zone ──
  const entityCount = ev.entityEvents.length
  let mandatoryCount = Math.max(MANDATORY_BASE, Math.min(MANDATORY_CAP, MANDATORY_BASE + Math.floor(level / 2)))
  const threatStart = gateZoneEnd + 10
  const slot = FIRE_RANGE + GAP
  const maxThreats = Math.max(1, Math.floor((RUN_END - threatStart - FIRE_RANGE) / slot) + 1)
  const totalMandatory = Math.min(mandatoryCount + entityCount, maxThreats)

  // Build a typed slot list: mandatory threats + the entity-events, laid out non-overlapping.
  const mandSlots = []
  for (let i = 0; i < totalMandatory; i++) {
    const z = threatStart + FIRE_RANGE + i * slot
    if (z > RUN_END - 2) break
    mandSlots.push(z)
  }
  // assign kinds: interleave block / enemy; entity-events claim slots first (so they always fit)
  const kinds = []
  for (const e of ev.entityEvents) kinds.push(e.kind) // 'ambush'|'elite'
  while (kinds.length < mandSlots.length) kinds.push(kinds.length % 2 === 0 ? 'block' : 'enemy')
  kinds.length = mandSlots.length

  // ── 4) the unified z-order trajectory pass: defines gate ops + bakes threat HP ──
  // entries: gates (gate zone), modifiers (toll/bonus/sandstorm), mandatory threats. Walk in z
  // order maintaining clean + worst counts; size each threat off the running counts.
  const gates = []
  const obstacles = []
  const enemies = []
  const modifiers = []

  const entries = []
  for (let i = 0; i < gateCount; i++) entries.push({ z: RUN_START + (i + 0.5) * gateSpacing, kind: 'gate' })
  for (const m of ev.modifiers) entries.push({ z: m.z, kind: 'mod', type: m.type })
  for (let i = 0; i < mandSlots.length; i++) entries.push({ z: mandSlots[i], kind: 'threat', tkind: kinds[i] })
  entries.sort((a, b) => a.z - b.z)

  let cleanC = entryArmy
  let worstC = entryArmy
  for (const e of entries) {
    if (e.kind === 'gate') {
      const g = makeGate(e.z, cleanC, rng)
      gates.push(g)
      cleanC = Math.max(applyGate(cleanC, g.left), applyGate(cleanC, g.right))
      worstC = Math.min(applyGate(worstC, g.left), applyGate(worstC, g.right))
    } else if (e.kind === 'mod') {
      modifiers.push({ type: e.type, z: e.z })
      if (e.type === 'toll') {
        cleanC = Math.max(0, cleanC - Math.round(cleanC * EVENT_FX.TOLL_FRACTION))
        worstC = Math.max(0, worstC - Math.round(worstC * EVENT_FX.TOLL_FRACTION)) // conservative
      } else if (e.type === 'bonus') {
        cleanC = Math.min(MAX_COUNT, cleanC + Math.round(cleanC * EVENT_FX.BONUS_FRACTION))
        // worstC unchanged: a sloppy player may skip the positional cache (design §6.2 step 3)
      }
    } else {
      // threat — size off the running clean/worst counts. elite = tanky-but-clearable block.
      const isEnemy = e.tkind === 'enemy' || e.tkind === 'ambush'
      const march = isEnemy ? MARCH_SPEED : 0
      // conservative window for marching squads absorbs focus-fire contention (no clean drain)
      const window = (FIRE_RANGE / (runSpeed + march)) * (isEnemy ? ENEMY_WINDOW_SAFETY : 1)
      const hp = sizeThreat(cleanC, worstC, window, rng, e.tkind === 'elite')
      if (isEnemy) enemies.push({ z: e.z, hp, xRange: [-ENEMY_HALF_WIDTH, ENEMY_HALF_WIDTH], marchSpeed: march, chaseSpeed: CHASE_SPEED })
      else obstacles.push({ z: e.z, hp, xRange: [-ROAD_HALF, ROAD_HALF], fullWidth: true })
    }
  }
  const cleanEnd = cleanC // expected clean army at boss entry (this seed)

  // ── 5) dodgeable blocks (sub-range, may overlap freely) + positional powerups ──
  const dodgeCount = 2 + (level % 2)
  for (let i = 0; i < dodgeCount; i++) {
    const z = RUN_START + 8 + rng() * (RUN_END - RUN_START - 16)
    const left = rng() < 0.5
    const xRange = left ? [-ROAD_HALF, -0.3] : [0.3, ROAD_HALF]
    obstacles.push({ z, hp: Math.max(8, Math.round(cleanEnd * DPS * 0.1)), xRange })
  }
  const puTypes = ['rapid', 'reinforce', 'shield', 'damage']
  const powerups = []
  for (let i = 0; i < 4; i++) {
    const z = RUN_START + 20 + (i + 0.5) * ((RUN_END - RUN_START - 30) / 4)
    powerups.push({ z, x: (rng() * 2 - 1) * (ROAD_HALF - 1), type: puTypes[i % puTypes.length] })
  }

  // ── 6) boss (army-scaled; HP set live by Game at RUN→BOSS) ──
  const ft = fightTarget(level, finale)
  const bullets = Math.min(5 + Math.floor(level / 3), 9)
  const fireInterval = Math.max(0.7, 1.4 - 0.05 * level)
  const bulletSpeed = Math.min(23 + level, BULLET_SPEED_PRECAP)
  const hpPerArmy = DPS * ft
  const bulletDamage = Math.max(1, Math.round((OFFENSE * cleanEnd * fireInterval) / (ft * bullets)))

  // ── seeded boss-skill pool (2026-06-12-boss-seeded-skills) ──
  // Cumulative family unlock by depth (Decision 1): index 0 = bullet-patterns only (parity with the
  // old single fan); slam/wall/arc enter ~level 1, ring/adds ~level 2, shield ~level 3 (full set).
  const skills = [{ type: 'fan', weight: 3 }]
  if (level >= 1) skills.push({ type: 'wall', weight: 2 }, { type: 'arc', weight: 2 }, { type: 'slam', weight: 2 })
  if (level >= 2) skills.push({ type: 'ring', weight: 2 }, { type: 'adds', weight: 2 })
  if (level >= 3) skills.push({ type: 'shield', weight: 1 })

  // Per-skill tuning, baked off `level` + `cleanEnd` (Decision 12: Hard-offset-scaled like every
  // other threat). addHp sizes one same-Z wave so a clean army (≈cleanEnd) clears it in ~clearWindow
  // seconds (≪ the 18/addMarch ≈ 6s march-to-contact deadline) → zero clean drain (AC8/AC11); an
  // under-strength army can't clear and eats contact drain.
  const addCount = Math.min(3, 1 + Math.floor(level / 3))
  const clearWindow = 0.8 // total DPS-theft seconds per summon wave (verifier-tuned)
  const skillTuning = {
    addCount,
    addHp: Math.max(1, Math.round((cleanEnd * DPS * clearWindow) / addCount)),
    addMarch: 3.0,
    clearWindow,
    slamKill: Math.max(1, Math.round(bulletDamage * 4)),
    slamHalfW: 1.1, // < limit (roadHalf-MARGIN ≈ 2.55): aimed + dodgeable (Decision 5)
    slamTelegraph: 0.6,
    shieldMult: 0.5, // incoming dmg ×0.5 = pure time tax (verifier-tuned)
    shieldDuration: 1.4,
  }

  const config = {
    id: `stage-${index + 1}`,
    label: index < 5 ? `STAGE ${index + 1}` : `DEPTH ${index + 1}`,

    // run (sandstorm buffer) + fight + margin. The fight now carries skill taxes (adds freeze boss
    // DPS for clearWindow per summon; shield = a ×0.4 time tax), so the fight budget grows from `ft`
    // to ~ft·1.8 + a fixed pad (2026-06-12-boss-seeded-skills §6.7, verifier-tuned).
    timeLimit: (RUN_END / runSpeed) * 1.35 + ft * 1.8 + 12,
    runSpeed,
    roadHalf: ROAD_HALF,
    crowdCap: MAX_COUNT, // Crowd reads this for its sanity clamp (stays config-driven)
    startCount,
    seed: (seed >>> 0) ^ (index * 2654435761),
    bossStandoff: BOSS_STANDOFF,

    combat: { perSoldierDPS: DPS, fireRange: FIRE_RANGE },

    boss: {
      z: BOSS_Z,
      hp: Math.round(hpPerArmy * cleanEnd), // menu placeholder; Game overrides with live army
      hpBase: 0,
      hpPerArmy,
      fireInterval,
      bullets,
      bulletDamage,
      bulletSpeed,
      enrage: { below: 0.33, fireIntervalMult: 0.7, bulletsAdd: 2 },
      finale,
      frenzy: ev.frenzy,
      crowdCap: MAX_COUNT,
      // seeded skill system — `seed` is the ONE field both Boss.js + the verifier key mulberry32 off
      seed: (seed >>> 0) ^ (index * 2654435761),
      skills,
      skillTuning,
    },

    powerupTuning: { ...POWERUP_TUNING },
    gates,
    obstacles,
    enemies,
    powerups,
    modifiers,
    trees: 56 + (index % 4) * 6,
    _cleanEnd: cleanEnd, // expected clean boss-entry army (recursive carry anchor; survives clone)
  }

  return applyDifficulty(config, p) // ONLY the 4 retained feel-multipliers (design Decision 6)
}
