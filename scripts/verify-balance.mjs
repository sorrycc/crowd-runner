// Headless balance check for AC5/AC6/AC8/AC17 — mirrors Game.js combat math against
// the shipped stage config, no browser needed. Run: node scripts/verify-balance.mjs
import CFG from '../src/config/stage1.js'

const cap = CFG.crowdCap
const clamp = (n) => Math.max(0, Math.min(cap, Math.round(n)))
const apply = (count, [t, v]) =>
  clamp(t === 'add' ? count + v : t === 'mul' ? count * v : count - v)

// Best-path gate simulation: always pick the strictly-higher resulting side.
function bestPath() {
  let count = CFG.startCount
  const trail = []
  for (const g of CFG.gates) {
    const l = apply(count, g.left)
    const r = apply(count, g.right)
    const pick = l >= r ? g.left : g.right
    count = Math.max(l, r)
    trail.push(`z${g.z}: ${g.left.join('')}|${g.right.join('')} -> ${count}`)
  }
  return { count, trail }
}

// Boss fight — same per-frame order as Game/Boss: damage (pre-removal) -> remove.
function fight(c0) {
  const dt = 1 / 60
  const { perMemberDPS: d, bossRemovalRate: r } = CFG.combat
  let hp = CFG.boss.hp
  let count = c0
  let debt = 0
  let t = 0
  while (true) {
    hp -= count * d * dt
    if (hp <= 0) return { win: true, t, left: count }
    debt += r * dt
    const whole = Math.floor(debt)
    debt -= whole
    count = Math.max(0, count - whole)
    if (count <= 0) return { win: false, t, left: 0 }
    t += dt
    if (t > 600) return { win: false, t, left: count }
  }
}

const runTime = (CFG.boss.z - CFG.bossStandoff) / CFG.runSpeed
const bp = bestPath()
const clean = fight(bp.count)
const totalClean = runTime + clean.t

// solvability break-even: d*c0^2/(2r) = hp  =>  c0 = sqrt(2*r*hp/d)
const threshold = Math.sqrt((2 * CFG.combat.bossRemovalRate * CFG.boss.hp) / CFG.combat.perMemberDPS)

// worst careless run: pick the lower side every gate, then hit every obstacle.
function worstPath() {
  let count = CFG.startCount
  for (const g of CFG.gates) count = Math.min(apply(count, g.left), apply(count, g.right))
  for (const o of CFG.obstacles) count = Math.max(0, count - o.hp)
  return count
}
const worst = worstPath()
const worstFight = fight(worst)

console.log('— Swarm Run balance check —')
bp.trail.forEach((s) => console.log('  ' + s))
console.log(`best-path crowd at boss:      ${bp.count}`)
console.log(`win threshold (break-even):   ~${threshold.toFixed(1)} crowd`)
console.log(`run-to-boss time:             ${runTime.toFixed(1)}s`)
console.log(`clean boss fight:             win=${clean.win}  fight=${clean.t.toFixed(1)}s  left=${clean.left}`)
console.log(`clean total time:             ${totalClean.toFixed(1)}s / ${CFG.timeLimit}s budget`)
console.log(`worst-path crowd at boss:     ${worst}  -> win=${worstFight.win} (skill matters)`)

const ok =
  clean.win &&
  bp.count > threshold &&
  totalClean < CFG.timeLimit &&
  !worstFight.win // a careless run should NOT trivially win
console.log(ok ? '\nPASS: stage is completable by a clean run, and skill matters.' : '\nFAIL: balance broken.')
process.exit(ok ? 0 : 1)
