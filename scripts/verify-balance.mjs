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
import { PRESETS, bossVolley } from '../src/config/difficulty.js'

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
  let contactDrain = 0
  let sandLeft = 0

  const gates = cfg.gates.map((g) => ({ ...g, done: false })).sort((a, b) => a.z - b.z)
  const blocks = cfg.obstacles
    .filter((o) => (standDodge ? true : o.fullWidth))
    .map((o) => ({ z: o.z, hp: o.hp, done: false }))
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
      if (!b.done && b.z <= z) { const d = Math.min(count, Math.ceil(b.hp)); count -= d; contactDrain += d; b.done = true }
    for (const e of enemies)
      if (!e.done && e.z <= z) { const d = Math.min(count, Math.ceil(e.hp)); count -= d; contactDrain += d; e.done = true }

    if (count <= 0) return lose('contact-wipe')
    if (time <= 0) return lose('timeout-run')
  }
  const runTime = cfg.timeLimit - time

  // ── BOSS ── (HP is army-scaled at entry — the #1 fix)
  const boss = cfg.boss
  const entryCount = count
  const maxHp = Math.round((boss.hpBase || 0) + boss.hpPerArmy * count)
  let hp = maxHp
  let fight = 0
  let fireT = 0
  let frenzyLeft = boss.frenzy ? EVENT_FX.FRENZY_DURATION : 0
  guard = 0
  while (true) {
    if (++guard > 5_000_000) return fail('boss-stuck')
    const F = count * dps
    hp -= F * DT
    fight += DT
    if (hp <= 0)
      return { win: true, lose: false, contactDrain, endCount: count, runTime, fightTime: fight, time, bossDrain: entryCount - count, entryCount }
    time -= DT
    if (frenzyLeft > 0) frenzyLeft = Math.max(0, frenzyLeft - DT)
    if (eats) {
      const fm = frenzyLeft > 0 ? EVENT_FX.FRENZY_FIRE_MULT : 1
      const v = bossVolley(boss, hp / maxHp, fm)
      fireT += DT
      if (fireT >= v.interval) { fireT -= v.interval; count = Math.max(0, count - v.bullets * boss.bulletDamage) }
      if (count <= 0) return lose('boss-wipe')
    }
    if (time <= 0) return lose('timeout-boss')
  }

  function lose(reason) {
    return { win: false, lose: true, contactDrain, endCount: count, reason, runTime: cfg.timeLimit - time, time, bossDrain: 0, entryCount: startCount }
  }
  function fail(reason) {
    return { win: false, lose: true, contactDrain, endCount: count, reason, time, bossDrain: 0, entryCount: startCount }
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

const stats = {}
for (const tier of TIERS) {
  let cleanWinAll = 0
  let sloppyLoseBy5 = 0
  let carelessLoseBy5 = 0
  let fightBandFails = 0
  let timerFails = 0
  let monoFails = 0
  const fightSamples = [] // [depth][...fightTimes]
  for (let d = 0; d < DEPTHS; d++) fightSamples.push([])

  for (let s = 0; s < SEEDS; s++) {
    const cleanChain = chain(s, tier, 'clean', DEPTHS)
    // clean must win every stage 1-5 with timer margin
    let okFinite = true
    for (let idx = 0; idx < FINITE; idx++) {
      const c = cleanChain[idx]
      if (!c || !c.r.win || c.r.runTime + c.r.fightTime > c.cfg.timeLimit - 2) okFinite = false
    }
    if (okFinite) cleanWinAll++

    // boss-fight band + timer for every clean stage we reached (depths 1-12)
    for (const c of cleanChain) {
      if (c.r.win) {
        fightSamples[c.idx].push(c.r.fightTime)
        if (c.r.fightTime < 5 || c.r.fightTime > 18) fightBandFails++
        if (c.r.runTime + c.r.fightTime > c.cfg.timeLimit) timerFails++
      }
    }

    // sloppy + careless chains must lose within stages 1-5
    const sloppy = chain(s, tier, 'sloppy', FINITE)
    const careless = chain(s, tier, 'careless', FINITE)
    if (sloppy.some((x) => !x.r.win) || sloppy.length < FINITE) sloppyLoseBy5++
    if (careless.some((x) => !x.r.win) || careless.length < FINITE) carelessLoseBy5++

    // monotone undodged boss-drain across depth (AC19b), using the clean carry-in
    let prevDrain = -1
    for (const c of cleanChain) {
      const u = simulate(c.cfg, c.start, 'undodged')
      const drain = u.bossDrain
      if (prevDrain >= 0 && drain < prevDrain * 0.98) monoFails++
      prevDrain = Math.max(prevDrain, drain)
    }
  }

  stats[tier] = { cleanWinAll, sloppyLoseBy5, carelessLoseBy5, fightBandFails, timerFails, monoFails, fightSamples }

  const T = tier.toUpperCase()
  add(`${T} clean wins stages 1-5 with margin (100% of seeds)`, cleanWinAll === SEEDS)
  add(`${T} sloppy loses by stage 5 (100% of seeds)`, sloppyLoseBy5 === SEEDS)
  add(`${T} careless loses by stage 5 (100% of seeds)`, carelessLoseBy5 === SEEDS)
  add(`${T} every clean boss fight in [5,18]s (no melt/stall)`, fightBandFails === 0)
  add(`${T} every clean run+fight within timer`, timerFails === 0)
  add(`${T} undodged boss-drain non-decreasing with depth (±2%)`, monoFails === 0)
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
  console.log(`  clean wins 1-5: ${st.cleanWinAll}/${SEEDS}  ·  sloppy loses: ${st.sloppyLoseBy5}/${SEEDS}  ·  careless loses: ${st.carelessLoseBy5}/${SEEDS}`)
  console.log(`  fight-band fails: ${st.fightBandFails}  ·  timer fails: ${st.timerFails}  ·  mono fails: ${st.monoFails}`)
  const med = st.fightSamples.map((a) => {
    if (!a.length) return '—'
    const s = [...a].sort((x, y) => x - y)
    return s[s.length >> 1].toFixed(1)
  })
  console.log(`  median clean fight by depth: ${med.join(' ')}`)
}

console.log('\nCHECKS:')
let ok = true
for (const [name, pass] of checks) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) ok = false
}
console.log(ok ? '\nPASS: procedural balance holds across the sweep.' : '\nFAIL: balance broken.')
process.exit(ok ? 0 : 1)
