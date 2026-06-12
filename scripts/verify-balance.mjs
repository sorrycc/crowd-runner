// ── Statistical balance verifier (redesign 2026-06-12-endless-procedural, design §6.8) ──
// The deterministic single-solution replay is gone: with procedural layouts + seeded random
// events, balance can only be a STATISTICAL contract. This sweeps N seeds × first K depths × both
// tiers × good/bad policies and asserts win/loss RATES + a boss-fight band + monotone difficulty.
//
// It imports the SAME pure generator + events + boss model the game runs (generator.js / events.js
// / difficulty.js), so the contract and the game can never drift. Run: node scripts/verify-balance.mjs
//
// Policies (mirror Game._update at fixed dt = 1/60):
//   clean    — best-side gates (max), dodge dodgeables, shoot mandatory, DODGE the boss fan.
//              Chained across depths (carry floored). Must WIN stages 1-5 with timer margin.
//   sloppy   — worst-side gates (min), dodge dodgeables, shoot mandatory, EAT the fan. Must LOSE.
//   careless — worst-side gates (min), STAND in dodgeables too, eat the fan. Must LOSE.
//   undodged — best-side gates + competent run but EATS every boss volley → boss-drain anchor.

import {
  generateStage,
  nominalArmy,
  applyGate,
  MAX_COUNT,
  CLIMAX_INDEX,
} from '../src/config/generator.js'
import { EVENT_FX } from '../src/config/events.js'
import { PRESETS, castCadence, bossCast } from '../src/config/difficulty.js'

const DT = 1 / 60
const TIERS = ['normal', 'hard']
const SEEDS = 100
const DEPTHS = 12 // depths 1..12 (index 0..11)
const FINITE = CLIMAX_INDEX + 1 // stages 1..5 = index 0..4

// ── one-stage simulation, mirroring Game per-frame order ──
function simulate(cfg, startCount, policy) {
  const best = policy === 'clean' || policy === 'undodged'
  const standDodge = policy === 'careless'
  const eats = policy !== 'clean'
  const dps = cfg.combat.perSoldierDPS
  const fireRange = cfg.combat.fireRange
  const bossEntry = cfg.boss.z - cfg.bossStandoff

  let count = startCount
  let z = 0
  let time = cfg.timeLimit
  let contactDrain = 0 // RUN-phase contact drain (existing AC11)
  let bossContactDrain = 0 // BOSS-phase add-contact drain (new AC11 — must be 0 for clean)
  let sandLeft = 0

  const gates = cfg.gates.map((g) => ({ ...g, done: false })).sort((a, b) => a.z - b.z)
  // Off-lane targeting (design #2): the crowd auto-fires on the NEAREST obstacle ahead by Z, dodgeable
  // or not — so EVERY obstacle is a target candidate. Contact (losing soldiers) is separate: full-width
  // guards always drain on cross; dodgeable side-blocks drain only if the policy stands in them
  // (careless). `contact` flags which blocks can drain; all blocks are still shootable.
  const blocks = cfg.obstacles.map((o) => ({ z: o.z, hp: o.hp, done: false, contact: o.fullWidth || standDodge }))
  const enemies = (cfg.enemies || []).map((e) => ({ z: e.z, hp: e.hp, march: e.marchSpeed || 0, done: false }))
  const mods = (cfg.modifiers || []).map((m) => ({ ...m, done: false })).sort((a, b) => a.z - b.z)

  // ── RUN ──
  let guard = 0
  while (z < bossEntry) {
    if (++guard > 5_000_000) return fail('run-stuck')
    const prevZ = z
    const rs = cfg.runSpeed * (sandLeft > 0 ? EVENT_FX.SANDSTORM_SPEED_MULT : 1)
    z = Math.min(bossEntry, z + rs * DT)
    time -= DT
    if (sandLeft > 0) sandLeft = Math.max(0, sandLeft - DT)

    for (const g of gates)
      if (!g.done && g.z > prevZ && g.z <= z) {
        g.done = true
        const l = applyGate(count, g.left)
        const r = applyGate(count, g.right)
        count = best ? Math.max(l, r) : Math.min(l, r)
      }
    if (count <= 0) return lose('gate-wipe')

    for (const m of mods)
      if (!m.done && m.z > prevZ && m.z <= z) {
        m.done = true
        if (m.type === 'toll') count = Math.max(0, count - Math.round(count * EVENT_FX.TOLL_FRACTION))
        else if (m.type === 'bonus') count = Math.min(MAX_COUNT, count + Math.round(count * EVENT_FX.BONUS_FRACTION))
        else if (m.type === 'sandstorm') sandLeft = EVENT_FX.SANDSTORM_DURATION
      }

    for (const e of enemies) if (!e.done && e.march) e.z -= e.march * DT

    const F = count * dps
    let target = null
    let tz = Infinity
    for (const b of blocks) if (!b.done && b.hp > 0 && b.z > z && b.z <= z + fireRange && b.z < tz) { target = b; tz = b.z }
    for (const e of enemies) if (!e.done && e.hp > 0 && e.z > z && e.z <= z + fireRange && e.z < tz) { target = e; tz = e.z }
    if (target) { target.hp -= F * DT; if (target.hp <= 0) { target.hp = 0; target.done = true } }

    for (const b of blocks)
      if (!b.done && b.z <= z) {
        if (b.contact) { const d = Math.min(count, Math.ceil(b.hp)); count -= d; contactDrain += d } // else dodged/off-lane: slip past, no drain
        b.done = true
      }
    for (const e of enemies)
      if (!e.done && e.z <= z) { const d = Math.min(count, Math.ceil(e.hp)); count -= d; contactDrain += d; e.done = true }

    if (count <= 0) return lose('contact-wipe')
    if (time <= 0) return lose('timeout-run')
  }
  const runTime = cfg.timeLimit - time

  // ── BOSS ── seeded skill system (2026-06-12-boss-seeded-skills §6.6). HP is army-scaled at entry;
  // the per-cast SKILL is drawn from the SAME pure bossCast the game runs, so the cast sequence is
  // byte-identical regardless of dt (AC2). Each family is modelled against its in-game effect:
  //   bullets → eating policies lose cast.undodgedKill;  slam → eating policies lose slamKill at detonate
  //   adds    → boss DPS frozen while any add is nearest; clean clears each wave before contact (0 drain)
  //   shield  → incoming dmg ×shieldMult for the window (clean AND undodged — a pure TIME tax)
  const boss = cfg.boss
  const tune = boss.skillTuning || {}
  const entryCount = count
  const maxHp = Math.round((boss.hpBase || 0) + boss.hpPerArmy * count)
  let hp = maxHp
  let fight = 0
  let fireT = 0
  let castIndex = 0
  let shieldLeft = 0
  let pendingSlam = null
  const adds = []
  let frenzyLeft = boss.frenzy ? EVENT_FX.FRENZY_DURATION : 0
  // Boss-phase exit — always reports the REAL bossDrain (soldiers lost to the boss), whether the
  // boss dies, the army wipes, or the timer runs out. This is the AC14 undodged drain anchor; the
  // generic lose()/fail() (bossDrain:0) is reserved for RUN-phase exits.
  const bossExit = (won, reason) => ({
    win: won, lose: !won, contactDrain, bossContactDrain, endCount: count, reason,
    runTime, fightTime: fight, time, bossDrain: entryCount - count, entryCount,
  })
  // shared freeze predicate — byte-identical to Game._acquireBossAdd (within fireRange, nearer than boss)
  const nearestAdd = () => {
    let best = null
    let bz = Infinity
    for (const a of adds)
      if (!a.dead && a.hp > 0 && a.z > z && a.z <= z + fireRange && a.z < boss.z && a.z < bz) { best = a; bz = a.z }
    return best
  }
  guard = 0
  while (true) {
    if (++guard > 5_000_000) return fail('boss-stuck')
    // frame order mirrors Game._update: (2) tick buffs → (3) combat / cast
    if (shieldLeft > 0) shieldLeft = Math.max(0, shieldLeft - DT)
    if (frenzyLeft > 0) frenzyLeft = Math.max(0, frenzyLeft - DT)
    const fm = frenzyLeft > 0 ? EVENT_FX.FRENZY_FIRE_MULT : 1

    // DPS theft: full army DPS to the nearest add, else the (shielded) boss
    const F = count * dps
    const addTarget = nearestAdd()
    if (!addTarget) hp -= F * DT * (shieldLeft > 0 ? tune.shieldMult : 1)
    else addTarget.hp -= F * DT
    fight += DT
    if (hp <= 0) return bossExit(true, 'boss-down')
    time -= DT

    // march adds; contact drain when an add reaches leaderZ (all policies; clean clears first → 0)
    for (const a of adds)
      if (!a.dead) {
        if (a.hp <= 0) { a.dead = true; continue }
        a.z -= a.march * DT
        if (a.z <= z) { const d = Math.min(count, Math.ceil(a.hp)); count -= d; bossContactDrain += d; a.dead = true }
      }

    // pending slam detonate — eating policies stand in it (the upper-bound anchor)
    if (pendingSlam) {
      pendingSlam.left -= DT
      if (pendingSlam.left <= 0) { if (eats) count = Math.max(0, count - pendingSlam.slamKill); pendingSlam = null }
    }

    // cast clock: cadence EVERY frame (skill-independent), skill drawn ONLY on fire (castIndex++)
    const { interval } = castCadence(boss, hp / maxHp, fm)
    fireT += DT
    if (fireT >= interval) {
      fireT -= interval
      const cast = bossCast(boss, hp / maxHp, castIndex++, fm)
      if (cast.kind === 'bullets') { if (eats) count = Math.max(0, count - cast.undodgedKill) }
      else if (cast.kind === 'slam') pendingSlam = { left: cast.telegraph, slamKill: cast.slamKill }
      else if (cast.kind === 'adds') for (let i = 0; i < cast.addCount; i++) adds.push({ z: boss.z - 2 - i * 0.01, hp: cast.addHp, march: cast.addMarch, dead: false })
      else if (cast.kind === 'shield') shieldLeft = cast.shieldDuration // refresh, non-stacking
    }
    if (count <= 0) return bossExit(false, 'boss-wipe')
    if (time <= 0) return bossExit(false, 'timeout-boss')
  }

  function lose(reason) {
    return { win: false, lose: true, contactDrain, bossContactDrain, endCount: count, reason, runTime: cfg.timeLimit - time, time, bossDrain: 0, entryCount: startCount }
  }
  function fail(reason) {
    return { win: false, lose: true, contactDrain, bossContactDrain, endCount: count, reason, time, bossDrain: 0, entryCount: startCount }
  }
}

// chain a policy across depths; carry floored to each stage's startCount
function chain(seed, tier, policy, depths) {
  const preset = PRESETS[tier]
  const out = []
  let carry = 0
  for (let idx = 0; idx < depths; idx++) {
    const cfg = generateStage(idx, seed, preset)
    const start = idx === 0 ? cfg.startCount : Math.max(carry, cfg.startCount)
    const r = simulate(cfg, start, policy)
    out.push({ idx, cfg, start, r })
    if (!r.win) break // chain stops at the first loss
    carry = r.endCount
  }
  return out
}

// ── sweep ──
const checks = []
const add = (name, pass) => checks.push([name, pass])

// Boss fights now carry skill taxes (adds freeze boss DPS; shield is a ×0.4 time tax), so the
// clean-fight band ceiling is raised from 18 to FIGHT_CEIL to make room (2026-06-12-boss-seeded-skills
// Decision 8 — the band is a verifier-internal sanity range, not the user contract).
const FIGHT_CEIL = 30
const median = (a) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[s.length >> 1]
}

const stats = {}
for (const tier of TIERS) {
  let cleanWinAll = 0
  let cleanZeroDrainAll = 0
  let cleanBossZeroDrainAll = 0
  let sloppyLoseBy5 = 0
  let carelessLoseBy5 = 0
  let fightBandFails = 0
  let timerFails = 0
  const fightSamples = [] // [depth][...fightTimes]
  const undodgedSamples = [] // [depth][...undodged bossDrain] — the AC14 anchor (median over seeds)
  for (let d = 0; d < DEPTHS; d++) { fightSamples.push([]); undodgedSamples.push([]) }

  for (let s = 0; s < SEEDS; s++) {
    const cleanChain = chain(s, tier, 'clean', DEPTHS)
    // clean must win every stage 1-5 with timer margin AND take zero contact drain in BOTH the run
    // phase (existing) AND the boss phase (new — slam dodged, adds cleared before contact, shield is
    // a TIME tax only). This is the redesign's zero-drain contract extended to the skill system.
    let okFinite = true
    let zeroDrain = true
    let bossZeroDrain = true
    for (let idx = 0; idx < FINITE; idx++) {
      const c = cleanChain[idx]
      if (!c || !c.r.win || c.r.runTime + c.r.fightTime > c.cfg.timeLimit - 2) okFinite = false
      if (!c || c.r.contactDrain > 0) zeroDrain = false
      if (!c || c.r.bossContactDrain > 0) bossZeroDrain = false
    }
    if (okFinite) cleanWinAll++
    if (zeroDrain) cleanZeroDrainAll++
    if (bossZeroDrain) cleanBossZeroDrainAll++

    // boss-fight band + timer for every clean stage we reached (depths 1-12)
    for (const c of cleanChain) {
      if (c.r.win) {
        fightSamples[c.idx].push(c.r.fightTime)
        if (c.r.fightTime < 5 || c.r.fightTime > FIGHT_CEIL) fightBandFails++
        if (c.r.runTime + c.r.fightTime > c.cfg.timeLimit) timerFails++
      }
    }

    // sloppy + careless chains must lose within stages 1-5
    const sloppy = chain(s, tier, 'sloppy', FINITE)
    const careless = chain(s, tier, 'careless', FINITE)
    if (sloppy.some((x) => !x.r.win) || sloppy.length < FINITE) sloppyLoseBy5++
    if (careless.some((x) => !x.r.win) || careless.length < FINITE) carelessLoseBy5++

    // undodged boss-drain samples for the AC14 median anchor, off the clean carry-in. The seeded
    // skill mix makes per-fight drain variable, so we sample per depth and assert the MEDIAN is
    // monotone (over depths 1-5, where clean wins 100% ⇒ the sample is the full SEEDS at every depth).
    for (const c of cleanChain) undodgedSamples[c.idx].push(simulate(c.cfg, c.start, 'undodged').bossDrain)
  }

  // AC14: per-depth median undodged drain non-decreasing over depths 1-5 (±5%)
  let monoFails = 0
  let prevMed = -1
  for (let d = 0; d < FINITE; d++) {
    const m = median(undodgedSamples[d])
    if (prevMed >= 0 && m < prevMed * 0.95) monoFails++
    prevMed = Math.max(prevMed, m)
  }

  stats[tier] = { cleanWinAll, cleanZeroDrainAll, cleanBossZeroDrainAll, sloppyLoseBy5, carelessLoseBy5, fightBandFails, timerFails, monoFails, fightSamples, undodgedSamples }

  const T = tier.toUpperCase()
  add(`${T} clean wins stages 1-5 with margin (100% of seeds)`, cleanWinAll === SEEDS)
  add(`${T} clean takes zero RUN contact-drain in stages 1-5 (100% of seeds)`, cleanZeroDrainAll === SEEDS)
  add(`${T} clean takes zero BOSS-phase drain in stages 1-5 (100% of seeds)`, cleanBossZeroDrainAll === SEEDS)
  add(`${T} sloppy loses by stage 5 (100% of seeds)`, sloppyLoseBy5 === SEEDS)
  add(`${T} careless loses by stage 5 (100% of seeds)`, carelessLoseBy5 === SEEDS)
  add(`${T} every clean boss fight in [5,${FIGHT_CEIL}]s (no melt/stall)`, fightBandFails === 0)
  add(`${T} every clean run+fight within timer`, timerFails === 0)
  add(`${T} undodged boss-drain median non-decreasing over depths 1-5 (±5%)`, monoFails === 0)
}

// AC19a — nominalArmy strictly increasing with depth (the difficulty backbone)
let monoArmy = true
for (let d = 1; d < DEPTHS; d++) if (nominalArmy(d) <= nominalArmy(d - 1)) monoArmy = false
add('nominalArmy strictly increasing with depth', monoArmy)

// AC4 — every generated growth gate is count-dependent (winner flips between small + large count)
let allFlip = true
for (const tier of TIERS)
  for (let s = 0; s < 10; s++)
    for (let idx = 0; idx < DEPTHS; idx++) {
      const cfg = generateStage(s, s * 7 + 1, PRESETS[tier])
      for (const g of cfg.gates) {
        const lo = applyGate(1, g.left) > applyGate(1, g.right) ? 'L' : applyGate(1, g.right) > applyGate(1, g.left) ? 'R' : 'T'
        const hiL = applyGate(1e6, g.left), hiR = applyGate(1e6, g.right)
        const hi = hiL > hiR ? 'L' : hiR > hiL ? 'R' : 'T'
        if (lo === hi) allFlip = false
      }
    }
add('every growth gate count-dependent (winner flips 1 → 1e6)', allFlip)

// ── report ──
console.log('— Swarm Run statistical balance check —')
console.log(`  ${SEEDS} seeds × depths 1-${DEPTHS} × {Normal, Hard} × {clean, sloppy, careless, undodged}\n`)
for (const tier of TIERS) {
  const st = stats[tier]
  console.log(`══ ${tier.toUpperCase()} ══`)
  console.log(`  clean wins 1-5: ${st.cleanWinAll}/${SEEDS}  ·  run zero-drain: ${st.cleanZeroDrainAll}/${SEEDS}  ·  boss zero-drain: ${st.cleanBossZeroDrainAll}/${SEEDS}  ·  sloppy loses: ${st.sloppyLoseBy5}/${SEEDS}  ·  careless loses: ${st.carelessLoseBy5}/${SEEDS}`)
  console.log(`  fight-band fails: ${st.fightBandFails}  ·  timer fails: ${st.timerFails}  ·  mono fails: ${st.monoFails}`)
  console.log(`  median clean fight by depth: ${st.fightSamples.map((a) => (a.length ? median(a).toFixed(1) : '—')).join(' ')}`)
  console.log(`  median undodged drain by depth: ${st.undodgedSamples.map((a) => (a.length ? Math.round(median(a)) : '—')).join(' ')}`)
}

console.log('\nCHECKS:')
let ok = true
for (const [name, pass] of checks) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) ok = false
}
console.log(ok ? '\nPASS: procedural balance holds across the sweep.' : '\nFAIL: balance broken.')
process.exit(ok ? 0 : 1)
