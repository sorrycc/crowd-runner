// Headless balance check — a stepped whole-run simulation that mirrors Game.js combat
// (fixed dt = 1/60), chained across all 3 stages, for BOTH difficulty tiers (Normal + Hard).
// It is the balance CONTRACT, not a bit-exact browser replay (the browser uses variable dt);
// a clean run must clear with margin to absorb dt variance. Run: node scripts/verify-balance.mjs
//
// The verifier imports the SHARED applyDifficulty + bossVolley from src/config/difficulty.js,
// so "Hard" and the boss volley/enrage model are defined ONCE for both the game and this
// contract (they cannot drift).
//
// Policies (design Decision 9; difficulty-tiers 6.6):
//  • clean   — best-side gates (max), dodge every dodgeable block, must-shoot every full-width
//              block + enemy, DODGE the boss fan, NO power-ups. Must WIN with ZERO contact drain.
//  • careless— worst-side gates (min), stand in every block + enemy, eat the boss fan, no
//              power-ups. Must LOSE.
//  • sloppy  — worst-side gates (min) but otherwise competent (dodge dodgeables, shoot mandatory
//              blocks/enemies), no power-ups, eats the boss fan. Must LOSE.
//  • undodged— best-side gates + competent run (like clean, zero contact drain) but EATS every
//              boss volley, no power-ups. Anchors the boss HP/offense numbers — must drain hard.
//
// Three orthogonal policy traits:
//   bestGates        = clean | undodged   (else worst-side gates)
//   standInDodgeables= careless           (else dodge dodgeables, like clean)
//   eatsBullets      = anything but clean
import STAGE_1 from '../src/config/stage1.js'
import STAGE_2 from '../src/config/stage2.js'
import STAGE_3 from '../src/config/stage3.js'
import { applyDifficulty, PRESETS, bossVolley } from '../src/config/difficulty.js'

const DT = 1 / 60
const BASE_STAGES = [STAGE_1, STAGE_2, STAGE_3]
const TIERS = ['normal', 'hard']
// undodged boss-drain lethal floors per stage (absolute slack floors, reused for both tiers —
// design Decision 11). Undodged entry is tier-invariant (same gate path), Hard drains ≥ Normal.
const DRAIN_FLOOR = [100, 110, 120]

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
  let bossEntryCount = startCount

  const gates = stage.gates.map((g) => ({ ...g, done: false })).sort((a, b) => a.z - b.z)
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

  // ── BOSS phase ── (shared volley model: drain = bullets × bulletDamage, with enrage)
  bossEntryCount = count
  const boss = stage.boss
  let hp = boss.hp
  let fightTime = 0
  let fireTimer = 0
  guard = 0
  while (true) {
    if (++guard > 5_000_000) return fail('boss-stuck')
    const F = count * d
    hp -= F * DT // damage pre-removal
    fightTime += DT
    if (hp <= 0)
      return { win: true, lose: false, contactDrain, endCount: count, runTime, fightTime, time, bossDrain: bossEntryCount - count }
    time -= DT
    if (eatsBullets) {
      const v = bossVolley(boss, hp / boss.hp) // SHARED model (live/config-max fraction)
      fireTimer += DT
      if (fireTimer >= v.interval) {
        fireTimer -= v.interval
        count = Math.max(0, count - v.bullets * boss.bulletDamage)
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

// Closed-form "no 1-second melt" guard: a fully-buffed army AT THE CAP folds in dmgCap × rapidMult.
function meltSeconds(stage) {
  const t = stage.powerupTuning
  const dps = stage.crowdCap * stage.combat.perSoldierDPS * t.dmgCap * t.rapidMult
  return stage.boss.hp / dps
}

// Mandatory-threat engagement-window overlap (design Decision 10). Mandatory = full-width blocks
// + enemies; window = [z − fireRange, z]. Enforced on Normal (authoring discipline); skipped on
// Hard (relaxed Hard-only — the clean zero-drain bar still applies on both tiers).
function hasMandatoryOverlap(stage) {
  const r = stage.combat.fireRange
  const wins = [
    ...stage.obstacles.filter((o) => o.fullWidth).map((o) => [o.z - r, o.z]),
    ...(stage.enemies || []).map((e) => [e.z - r, e.z]),
  ].sort((a, b) => a[0] - b[0])
  for (let i = 1; i < wins.length; i++) if (wins[i][0] < wins[i - 1][1]) return true
  return false
}

// A gate pair is count-dependent iff its winner FLIPS somewhere in [1, cap] (design Decision 12 /
// AC12) — neither side dominates the whole range.
function gateFlips(left, right, cap) {
  let leftWins = false
  let rightWins = false
  for (let c = 1; c <= cap; c++) {
    const l = applyGate(c, left, cap)
    const rr = applyGate(c, right, cap)
    if (l > rr) leftWins = true
    else if (rr > l) rightWins = true
    if (leftWins && rightWins) return true
  }
  return false
}

function fmt(r) {
  const t = r.win ? `run ${r.runTime.toFixed(1)}s + fight ${r.fightTime.toFixed(1)}s` : `reason=${r.reason}`
  return `win=${r.win} drain=${r.contactDrain} end=${r.endCount} ${t}`
}

// ── run a full tier: clean chain across 3 stages + careless/sloppy chains + per-stage undodged ──
function runTier(tierId) {
  const stages = BASE_STAGES.map((s) => applyDifficulty(s, PRESETS[tierId]))

  // clean chain (carry the army, floored to each stage's startCount)
  const cleanStart = []
  const clean = []
  let carry = 0
  for (let i = 0; i < stages.length; i++) {
    const start = i === 0 ? stages[i].startCount : Math.max(carry, stages[i].startCount)
    cleanStart.push(start)
    const r = simulate(stages[i], start, 'clean')
    clean.push(r)
    carry = r.endCount || 0
  }
  // clean from each stage's own floor (solvable from carry-floor)
  const cleanFloor = stages.map((s) => simulate(s, s.startCount, 'clean'))

  // careless + sloppy chains — must LOSE somewhere
  const chainLoses = (policy) => {
    let c = 0
    for (let i = 0; i < stages.length; i++) {
      const start = i === 0 ? stages[i].startCount : Math.max(c, stages[i].startCount)
      const r = simulate(stages[i], start, policy)
      if (r.lose) return { lost: true, stage: i + 1, r }
      c = r.endCount
    }
    return { lost: false }
  }
  const careless = chainLoses('careless')
  const sloppy = chainLoses('sloppy')

  // undodged per stage from the clean carry-in (eats every volley → boss-drain anchor)
  const undodged = stages.map((s, i) => simulate(s, cleanStart[i], 'undodged'))

  return { stages, cleanStart, clean, cleanFloor, careless, sloppy, undodged }
}

console.log('— Swarm Run balance check (3 stages × {Normal, Hard}, shared applyDifficulty) —')

const results = {}
for (const tier of TIERS) results[tier] = runTier(tier)

const checks = []

for (const tier of TIERS) {
  const R = results[tier]
  const T = tier.toUpperCase()
  console.log(`\n══ ${T} ══`)
  for (let i = 0; i < 3; i++) {
    const s = R.stages[i]
    const c = R.clean[i]
    const cf = R.cleanFloor[i]
    const u = R.undodged[i]
    const total = c.win ? (c.runTime + c.fightTime) : NaN
    console.log(`  stage${i + 1} (entry ${R.cleanStart[i]} → ${c.endCount}):`)
    console.log(`    clean:    ${fmt(c)}  total ${isNaN(total) ? '—' : total.toFixed(1)}/${s.timeLimit.toFixed(1)}s`)
    console.log(`    floor(${s.startCount}): ${fmt(cf)}`)
    console.log(`    undodged: ${fmt(u)}  bossDrain=${u.bossDrain}`)
    console.log(`    melt=${meltSeconds(s).toFixed(1)}s`)

    checks.push([`${T} s${i + 1} clean wins`, c.win])
    checks.push([`${T} s${i + 1} clean zero contact drain`, c.contactDrain === 0])
    checks.push([`${T} s${i + 1} clean (floor) wins`, cf.win])
    checks.push([`${T} s${i + 1} clean (floor) zero contact drain`, cf.contactDrain === 0])
    checks.push([`${T} s${i + 1} clean within timer`, c.win && c.runTime + c.fightTime < s.timeLimit])
    checks.push([`${T} s${i + 1} clean boss fight > 5s (no melt)`, c.win && c.fightTime > 5])
    checks.push([`${T} s${i + 1} no 1s melt (buffed cap > 2.5s)`, meltSeconds(s) > 2.5])
    checks.push([`${T} s${i + 1} undodged boss drain > ${DRAIN_FLOOR[i]} (boss lethal)`, u.bossDrain > DRAIN_FLOOR[i]])
    // overlap authoring rule: enforced on Normal, SKIPPED on Hard (design Decision 10 / AC9)
    if (tier === 'normal') checks.push([`${T} s${i + 1} no mandatory-threat overlap`, !hasMandatoryOverlap(s)])
    // gate count-dependence (AC12) — tier-invariant, checked per tier for completeness
    const allFlip = s.gates.every((g) => gateFlips(g.left, g.right, s.crowdCap))
    checks.push([`${T} s${i + 1} all gates count-dependent`, allFlip])
  }
  const cL = R.careless
  const sL = R.sloppy
  console.log(`  careless: ${cL.lost ? `LOSES at stage ${cL.stage} (${cL.r.reason})` : 'WINS (bad!)'}`)
  console.log(`  sloppy:   ${sL.lost ? `LOSES at stage ${sL.stage} (${sL.r.reason})` : 'WINS (bad!)'}`)
  checks.push([`${T} careless run loses (skill matters)`, cL.lost])
  checks.push([`${T} sloppy run loses (gate sense + boss dodging matter)`, sL.lost])
}

// ── relative "Hard is tighter than Normal" checks (design Decision 11 / AC8) ──
console.log('\n══ HARD vs NORMAL (relative) ══')
for (let i = 0; i < 3; i++) {
  const cn = results.normal.clean[i]
  const ch = results.hard.clean[i]
  const sn = results.normal.stages[i]
  const sh = results.hard.stages[i]
  const un = results.normal.undodged[i]
  const uh = results.hard.undodged[i]
  const marginN = sn.timeLimit - (cn.runTime + cn.fightTime)
  const marginH = sh.timeLimit - (ch.runTime + ch.fightTime)
  console.log(`  stage${i + 1}: clean margin  Normal ${marginN.toFixed(1)}s  →  Hard ${marginH.toFixed(1)}s`)
  console.log(`           undodged drain Normal ${un.bossDrain}  →  Hard ${uh.bossDrain}`)
  checks.push([`s${i + 1} Hard clean margin tighter than Normal`, cn.win && ch.win && marginH < marginN])
  checks.push([`s${i + 1} Hard undodged drain ≥ Normal`, uh.bossDrain >= un.bossDrain])
}

console.log('\nCHECKS:')
let ok = true
for (const [name, pass] of checks) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) ok = false
}

console.log(
  ok
    ? '\nPASS: all 3 stages clean-clearable with margin on both tiers; Hard is tighter; skill matters.'
    : '\nFAIL: balance broken.'
)
process.exit(ok ? 0 : 1)
