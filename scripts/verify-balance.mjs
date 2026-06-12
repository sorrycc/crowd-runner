// Headless balance check (AC16) — a stepped whole-run simulation that mirrors
// Game.js combat (fixed dt = 1/60), chained across both stages. It is the balance
// CONTRACT, not a bit-exact browser replay (the browser uses variable dt); a clean
// run must clear with margin to absorb dt variance. Run: node scripts/verify-balance.mjs
//
// Policies (design Decision 9; rebalance 2026-06-12):
//  • clean   — best-side gates, dodge every dodgeable block, must-shoot every
//              full-width block + enemy, dodge boss bullets, NO power-ups assumed
//              (power-ups are pure upside). Must WIN with ZERO contact drain.
//  • careless— worst-side gates, stand in every block + enemy, eat boss bullets,
//              no power-ups. Must LOSE.
//  • sloppy  — worst-side gates but otherwise competent (dodge dodgeables, shoot
//              mandatory blocks/enemies), no power-ups, eats boss bullets. Models bad
//              gate sense + wasted power-ups + sloppy boss dodging. Must LOSE.
//  • undodged— best-side gates + competent run (like clean, zero contact drain) but
//              EATS every boss bullet, no power-ups. Models "perfect run, sloppy at the
//              boss"; anchors the boss HP/offense numbers — must drain heavily at the boss.
//
// Three orthogonal policy traits (so clean/careless behave EXACTLY as before):
//   bestGates        = clean | undodged   (else worst-side gates)
//   standInDodgeables= careless           (else dodge dodgeables, like clean)
//   eatsBullets      = anything but clean
import STAGE_1 from '../src/config/stage1.js'
import STAGE_2 from '../src/config/stage2.js'

const DT = 1 / 60

function applyGate(count, [t, v], cap) {
  const r = t === 'add' ? count + v : t === 'mul' ? count * v : count - v
  return Math.max(0, Math.min(cap, Math.round(r)))
}

// Simulate one stage from `startCount` under a policy. Mirrors Game per-frame order.
function simulate(stage, startCount, policy) {
  const bestGates = policy === 'clean' || policy === 'undodged'
  const standInDodgeables = policy === 'careless'
  const eatsBullets = policy !== 'clean'
  const cap = stage.crowdCap
  const d = stage.combat.perSoldierDPS
  const fireRange = stage.combat.fireRange
  const bossEntry = stage.boss.z - stage.bossStandoff

  let count = startCount
  let leaderZ = 0
  let time = stage.timeLimit
  let contactDrain = 0
  let bossEntryCount = startCount // set at boss entry; used for bossDrain

  const gates = stage.gates.map((g) => ({ ...g, done: false })).sort((a, b) => a.z - b.z)
  // only careless stands in dodgeable blocks; everyone else dodges them (full-width are mandatory)
  const blocks = stage.obstacles
    .filter((o) => (standInDodgeables ? true : o.fullWidth))
    .map((o) => ({ z: o.z, hp: o.hp, done: false }))
  const enemies = (stage.enemies || []).map((e) => ({
    z: e.z,
    hp: e.hp,
    marchSpeed: e.marchSpeed || 0,
    done: false,
  }))

  // ── RUN phase ──
  let guard = 0
  while (leaderZ < bossEntry) {
    if (++guard > 5_000_000) return fail('run-stuck')
    const prevZ = leaderZ
    leaderZ = Math.min(bossEntry, leaderZ + stage.runSpeed * DT)
    time -= DT

    for (const g of gates) {
      if (!g.done && g.z > prevZ && g.z <= leaderZ) {
        g.done = true
        const l = applyGate(count, g.left, cap)
        const r = applyGate(count, g.right, cap)
        count = bestGates ? Math.max(l, r) : Math.min(l, r)
      }
    }
    if (count <= 0) return lose('gate-wipe')

    for (const e of enemies) if (!e.done && e.marchSpeed) e.z -= e.marchSpeed * DT

    // single-target focus fire: nearest engaged target ahead within fireRange
    const F = count * d
    let target = null
    let tz = Infinity
    for (const b of blocks)
      if (!b.done && b.hp > 0 && b.z > leaderZ && b.z <= leaderZ + fireRange && b.z < tz) {
        target = b
        tz = b.z
      }
    for (const e of enemies)
      if (!e.done && e.hp > 0 && e.z > leaderZ && e.z <= leaderZ + fireRange && e.z < tz) {
        target = e
        tz = e.z
      }
    if (target) {
      target.hp -= F * DT
      if (target.hp <= 0) {
        target.hp = 0
        target.done = true
      }
    }

    // contacts (reached with hp left → leftover drains ceil(hp))
    for (const b of blocks)
      if (!b.done && b.z <= leaderZ) {
        const drain = Math.min(count, Math.ceil(b.hp))
        count -= drain
        contactDrain += drain
        b.done = true
      }
    for (const e of enemies)
      if (!e.done && e.z <= leaderZ) {
        const drain = Math.min(count, Math.ceil(e.hp))
        count -= drain
        contactDrain += drain
        e.done = true
      }

    if (count <= 0) return lose('contact-wipe')
    if (time <= 0) return lose('timeout-run')
  }
  const runTime = stage.timeLimit - time

  // ── BOSS phase ──
  bossEntryCount = count
  let hp = stage.boss.hp
  let fightTime = 0
  let fireTimer = 0
  guard = 0
  while (true) {
    if (++guard > 5_000_000) return fail('boss-stuck')
    const F = count * d
    hp -= F * DT // damage pre-removal (design 6.5)
    fightTime += DT
    if (hp <= 0)
      return { win: true, lose: false, contactDrain, endCount: count, runTime, fightTime, time, bossDrain: bossEntryCount - count }
    time -= DT
    if (eatsBullets) {
      // eats telegraphed bullets it doesn't dodge (careless/sloppy/undodged)
      fireTimer += DT
      if (fireTimer >= stage.boss.fireInterval) {
        fireTimer -= stage.boss.fireInterval
        count = Math.max(0, count - stage.boss.burst)
      }
      if (count <= 0) return lose('boss-bullets-wipe')
    }
    if (time <= 0) return lose('timeout-boss')
  }

  function lose(reason) {
    return { win: false, lose: true, contactDrain, endCount: count, reason, runTime: stage.timeLimit - time, time, bossDrain: bossEntryCount - count }
  }
  function fail(reason) {
    return { win: false, lose: true, contactDrain, endCount: count, reason, time }
  }
}

function fmt(r) {
  const t = r.win ? `run ${r.runTime.toFixed(1)}s + fight ${r.fightTime.toFixed(1)}s` : `reason=${r.reason}`
  return `win=${r.win} drain=${r.contactDrain} end=${r.endCount} ${t}`
}

// Closed-form "no 1-second melt" guard: a fully-buffed army AT THE CAP (worst case, fastest
// melt) folds in dmgCap × rapidMult. NOT a simulate() call — conservatively assumes buffs
// active 100% of the fight. seconds = boss.hp / (cap · perSoldierDPS · dmgCap · rapidMult).
function meltSeconds(stage) {
  const t = stage.powerupTuning
  const dps = stage.crowdCap * stage.combat.perSoldierDPS * t.dmgCap * t.rapidMult
  return stage.boss.hp / dps
}

console.log('— Swarm Run balance check (stepped whole-run sim) —\n')

// Clean chain
const s1c = simulate(STAGE_1, STAGE_1.startCount, 'clean')
const carried = Math.max(s1c.endCount || 0, STAGE_2.startCount)
const s2carried = simulate(STAGE_2, carried, 'clean')
const s2floor = simulate(STAGE_2, STAGE_2.startCount, 'clean')

console.log('CLEAN:')
console.log(`  stage1 (from ${STAGE_1.startCount}):        ${fmt(s1c)}`)
console.log(`  stage2 (carried ${carried}):     ${fmt(s2carried)}`)
console.log(`  stage2 (floor ${STAGE_2.startCount}):        ${fmt(s2floor)}`)

// Careless chain
const s1w = simulate(STAGE_1, STAGE_1.startCount, 'careless')
let carelessLoses = s1w.lose
let s2w = null
if (!s1w.lose) {
  s2w = simulate(STAGE_2, Math.max(s1w.endCount, STAGE_2.startCount), 'careless')
  carelessLoses = s2w.lose
}
console.log('\nCARELESS:')
console.log(`  stage1: ${fmt(s1w)}`)
if (s2w) console.log(`  stage2: ${fmt(s2w)}`)

// Sloppy chain (worst gates, competent run, eats boss bullets) — must LOSE
const s1sl = simulate(STAGE_1, STAGE_1.startCount, 'sloppy')
let sloppyLoses = s1sl.lose
let s2sl = null
if (!s1sl.lose) {
  s2sl = simulate(STAGE_2, Math.max(s1sl.endCount, STAGE_2.startCount), 'sloppy')
  sloppyLoses = s2sl.lose
}
console.log('\nSLOPPY (worst gates, dodge dodgeables, no power-ups, eats boss bullets):')
console.log(`  stage1: ${fmt(s1sl)}`)
if (s2sl) console.log(`  stage2: ${fmt(s2sl)}`)

// Undodged probe (best gates + clean run, but eats EVERY boss bullet) — boss must drain hard.
// s2 carries the clean army (best-run carry), since undodged s1 may be wiped.
const s1ud = simulate(STAGE_1, STAGE_1.startCount, 'undodged')
const s2ud = simulate(STAGE_2, carried, 'undodged')
console.log('\nUNDODGED (best gates, eats EVERY boss bullet, no power-ups) — boss-lethality anchor:')
console.log(`  stage1: ${fmt(s1ud)} bossDrain=${s1ud.bossDrain}`)
console.log(`  stage2: ${fmt(s2ud)} bossDrain=${s2ud.bossDrain}`)

// No-melt closed-form guard
const melt1 = meltSeconds(STAGE_1)
const melt2 = meltSeconds(STAGE_2)
console.log('\nNO-MELT GUARD (buffed cap army, closed form):')
console.log(`  stage1: ${melt1.toFixed(1)}s   stage2: ${melt2.toFixed(1)}s   (must be > 2.5s)`)

// Time budgets
const s1Total = (s1c.runTime + s1c.fightTime).toFixed(1)
const s2Total = (s2carried.runTime + s2carried.fightTime).toFixed(1)
console.log('\nTIME BUDGET:')
console.log(`  stage1 clean total: ${s1Total}s / ${STAGE_1.timeLimit}s`)
console.log(`  stage2 clean total: ${s2Total}s / ${STAGE_2.timeLimit}s`)

const checks = [
  ['stage1 clean wins', s1c.win],
  ['stage1 clean zero contact drain', s1c.contactDrain === 0],
  ['stage2 clean (carried) wins', s2carried.win],
  ['stage2 clean (carried) zero contact drain', s2carried.contactDrain === 0],
  ['stage2 clean (floor) wins — solvable from carry-floor', s2floor.win],
  ['stage2 clean (floor) zero contact drain', s2floor.contactDrain === 0],
  ['stage1 clean within timer', s1c.win && s1c.runTime + s1c.fightTime < STAGE_1.timeLimit],
  ['stage2 clean within timer', s2carried.win && s2carried.runTime + s2carried.fightTime < STAGE_2.timeLimit],
  ['careless run loses (skill matters)', carelessLoses],
  ['sloppy run loses (gate sense + boss dodging matter)', sloppyLoses],
  ['stage1 clean boss fight > 5s (no instant melt)', s1c.win && s1c.fightTime > 5],
  ['stage2 clean boss fight > 5s (no instant melt)', s2carried.win && s2carried.fightTime > 5],
  ['undodged stage1 boss drain > 100 (boss is lethal)', s1ud.bossDrain > 100],
  ['undodged stage2 boss drain > 120 (boss is lethal)', s2ud.bossDrain > 120],
  ['no 1s melt: stage1 buffed cap > 2.5s', melt1 > 2.5],
  ['no 1s melt: stage2 buffed cap > 2.5s', melt2 > 2.5],
]

console.log('\nCHECKS:')
let ok = true
for (const [name, pass] of checks) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) ok = false
}

console.log(ok ? '\nPASS: both stages are clean-clearable with margin, and skill matters.' : '\nFAIL: balance broken.')
process.exit(ok ? 0 : 1)
