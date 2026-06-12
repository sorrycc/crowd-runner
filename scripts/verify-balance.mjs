// Headless balance check (AC16) — a stepped whole-run simulation that mirrors
// Game.js combat (fixed dt = 1/60), chained across both stages. It is the balance
// CONTRACT, not a bit-exact browser replay (the browser uses variable dt); a clean
// run must clear with margin to absorb dt variance. Run: node scripts/verify-balance.mjs
//
// Policies (design Decision 9):
//  • clean   — best-side gates, dodge every dodgeable block, must-shoot every
//              full-width block + enemy, dodge boss bullets, NO power-ups assumed
//              (power-ups are pure upside). Must WIN with ZERO contact drain.
//  • careless— worst-side gates, stand in every block + enemy, eat boss bullets,
//              no power-ups. Must LOSE.
import STAGE_1 from '../src/config/stage1.js'
import STAGE_2 from '../src/config/stage2.js'

const DT = 1 / 60

function applyGate(count, [t, v], cap) {
  const r = t === 'add' ? count + v : t === 'mul' ? count * v : count - v
  return Math.max(0, Math.min(cap, Math.round(r)))
}

// Simulate one stage from `startCount` under a policy. Mirrors Game per-frame order.
function simulate(stage, startCount, policy) {
  const clean = policy === 'clean'
  const cap = stage.crowdCap
  const d = stage.combat.perSoldierDPS
  const fireRange = stage.combat.fireRange
  const bossEntry = stage.boss.z - stage.bossStandoff

  let count = startCount
  let leaderZ = 0
  let time = stage.timeLimit
  let contactDrain = 0

  const gates = stage.gates.map((g) => ({ ...g, done: false })).sort((a, b) => a.z - b.z)
  // clean dodges dodgeable blocks (only full-width are mandatory); careless stands in all
  const blocks = stage.obstacles
    .filter((o) => (clean ? o.fullWidth : true))
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
        count = clean ? Math.max(l, r) : Math.min(l, r)
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
  let hp = stage.boss.hp
  let fightTime = 0
  let fireTimer = 0
  guard = 0
  while (true) {
    if (++guard > 5_000_000) return fail('boss-stuck')
    const F = count * d
    hp -= F * DT // damage pre-removal (design 6.5)
    fightTime += DT
    if (hp <= 0) return { win: true, lose: false, contactDrain, endCount: count, runTime, fightTime, time }
    time -= DT
    if (!clean) {
      // careless eats telegraphed bullets it doesn't dodge
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
    return { win: false, lose: true, contactDrain, endCount: count, reason, runTime: stage.timeLimit - time, time }
  }
  function fail(reason) {
    return { win: false, lose: true, contactDrain, endCount: count, reason, time }
  }
}

function fmt(r) {
  const t = r.win ? `run ${r.runTime.toFixed(1)}s + fight ${r.fightTime.toFixed(1)}s` : `reason=${r.reason}`
  return `win=${r.win} drain=${r.contactDrain} end=${r.endCount} ${t}`
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
]

console.log('\nCHECKS:')
let ok = true
for (const [name, pass] of checks) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) ok = false
}

console.log(ok ? '\nPASS: both stages are clean-clearable with margin, and skill matters.' : '\nFAIL: balance broken.')
process.exit(ok ? 0 : 1)
