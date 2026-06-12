import * as THREE from 'three'
import { SceneManager } from './core/SceneManager.js'
import { Input } from './core/Input.js'
import { Road } from './world/Road.js'
import { Environment } from './world/Environment.js'
import { Track } from './world/Track.js'
import { Crowd, FORMATION_HALF_WIDTH } from './entities/Crowd.js'
import { BulletPool } from './entities/Bullets.js'
import { HUD } from './ui/HUD.js'
import { Screens } from './ui/Screens.js'

// Orchestrator + state machine + game loop (design 6.1/6.4/6.5).
// state: MENU | PLAYING | WIN | LOSE ; phase (while PLAYING): RUN | BOSS.
// Per-frame order (design 6.5): advance+timer -> tick buffs / firepower ->
// fire+combat (ranged) -> crossings/contacts -> win check -> lose check.
//
// Combat is continuous, single-target focus fire: army firepower
// F = count * perSoldierDPS * dmgMult * (rapid ? rapidMult : 1) is applied each frame
// to the NEAREST engaged target ahead within fireRange (a block/enemy in RUN, the
// boss in BOSS). Bullets are cosmetic (player) or harmful+dodgeable (boss).

const MAX_DT = 0.05
const END_PAD = 40 // trackLength = boss.z + END_PAD (single source — design 6.2)
const PICK_RADIUS = 0.9 // power-up pickup x-tolerance

// Boss-bullet hit radius DERIVED from the real formation half-width (DRY, design 6.2).
const HIT_RADIUS = FORMATION_HALF_WIDTH + 0.2

const PLAYER_BULLET_SPEED = 60
const FIRE_CADENCE = 0.05 // seconds between muzzle volleys

export class Game {
  constructor(stages) {
    this.stages = Array.isArray(stages) ? stages : [stages]
    this.stageIndex = 0
    this.config = this.stages[0]
    this.trackLength = this.config.boss.z + END_PAD

    const app = document.getElementById('app')
    this.sm = new SceneManager(app)
    this.input = new Input(this.sm.renderer.domElement, this.config.roadHalf)

    // static world (sized to the longest stage so it fits every stage)
    const worldLen = Math.max(...this.stages.map((s) => s.boss.z)) + END_PAD
    new Road(this.sm.scene, this.config, worldLen)
    new Environment(this.sm.scene, this.config, worldLen)

    // dynamic entities
    this.crowd = new Crowd(this.sm.scene, this.config)
    this.track = new Track(this.sm.scene, this.config)

    // bullet pools
    this.playerBullets = new BulletPool(this.sm.scene, {
      cap: 140,
      color: 0xfde047,
      radius: 0.06,
      length: 0.6,
    })
    this.bossBullets = new BulletPool(this.sm.scene, {
      cap: 32,
      color: 0xf43f5e,
      radius: 0.22,
      length: 0.5,
    })

    this.hud = new HUD()
    this.screens = new Screens({
      onStart: () => this.start(),
      onRestart: () => this.restart(),
    })

    this.state = 'MENU'
    this.phase = 'RUN'
    this.leaderPos = new THREE.Vector3(0, 0, 0)
    this.leaderZ = 0
    this.prevZ = 0
    this.timeRemaining = this.config.timeLimit
    this.combo = 0

    // buffs
    this.dmgMult = 1
    this.rapidLeft = 0
    this.shieldLeft = 0

    this._fireAcc = 0
    this._bulletTick = 0

    this._last = performance.now()
    this._loop = this._loop.bind(this)
    requestAnimationFrame(this._loop)
  }

  // ── lifecycle ──
  start() {
    this.state = 'PLAYING'
    this.config = this.stages[this.stageIndex]
    this._resetStageState(this.config.startCount)
    this.screens.hideAll()
    this.hud.show(this.config.label)
    this.hud.update(this._hudState())
  }

  restart() {
    this.stageIndex = 0
    this.config = this.stages[0]
    this.dmgMult = 1 // full reset of permanent buffs (AC12)
    this.track.reset(this.config)
    this.start()
  }

  _advanceStage() {
    const carried = this.crowd.count
    this.stageIndex++
    this.config = this.stages[this.stageIndex]
    this.trackLength = this.config.boss.z + END_PAD
    this.track.reset(this.config)
    // carry the army, floored to the new stage's baseline (Decision 5); keep dmgMult.
    this._resetStageState(Math.max(carried, this.config.startCount))
    this.hud.show(this.config.label)
    this.hud.flashBanner(this.config.label)
  }

  // Reset everything per-stage; clears timed buffs + bullet pools, keeps dmgMult.
  _resetStageState(count) {
    this.phase = 'RUN'
    this.leaderZ = 0
    this.prevZ = 0
    this.timeRemaining = this.config.timeLimit
    this.combo = 0
    this.rapidLeft = 0
    this.shieldLeft = 0
    this._fireAcc = 0

    this.playerBullets.clear()
    this.bossBullets.clear()

    this.input.reset()
    this.crowd.reset(count)
    this.leaderPos.set(0, 0, 0)
    this.crowd.update(0, 0, 0)
    this.sm.chase(this.leaderPos, 0, true) // snap camera behind the start line
  }

  _bossEntryZ() {
    return this.config.boss.z - this.config.bossStandoff
  }

  _firepower() {
    const rapid = this.rapidLeft > 0 ? this.config.powerupTuning.rapidMult : 1
    return this.crowd.count * this.config.combat.perSoldierDPS * this.dmgMult * rapid
  }

  _update(dt) {
    if (this.state !== 'PLAYING') return
    const cfg = this.config

    // 1) advance + decrement timer
    this.input.update(dt)
    this.prevZ = this.leaderZ
    if (this.phase === 'RUN') {
      this.leaderZ += cfg.runSpeed * dt
      if (this.leaderZ >= this._bossEntryZ()) {
        this.leaderZ = this._bossEntryZ()
        this.phase = 'BOSS'
      }
    }
    // Negate input→world-X: the chase camera faces +Z and mirrors world X on
    // screen (see SceneManager), so without this, right input would drift the
    // crowd left. One negation here keeps every leaderX consumer + camera-follow
    // consistent; clamping stays symmetric in Input.x space.
    const leaderX = -this.input.x
    this.leaderPos.set(leaderX, 0, this.leaderZ)
    this.timeRemaining -= dt

    // 2) tick timed buffs
    if (this.rapidLeft > 0) this.rapidLeft = Math.max(0, this.rapidLeft - dt)
    if (this.shieldLeft > 0) this.shieldLeft = Math.max(0, this.shieldLeft - dt)
    const F = this._firepower()
    const shielded = this.shieldLeft > 0

    // 3) ranged combat
    if (this.phase === 'RUN') {
      for (const e of this.track.enemies) e.update(dt)
      for (const p of this.track.powerups) p.update(dt)

      const target = this._acquireTarget(leaderX, cfg.combat.fireRange)
      if (target) {
        target.damage(F * dt)
        const aimX = (target.xRange[0] + target.xRange[1]) / 2
        this._fire(dt, aimX, target.z)
      }
      this._resolveCrossings(leaderX, shielded)
    } else {
      // BOSS phase
      this.track.boss.update(dt, F, leaderX, this.leaderZ, this.bossBullets)
      this._fire(dt, 0, cfg.boss.z - 1.4)
      this._resolveBossBullets(leaderX, shielded)
    }

    // 4) advance projectiles + crowd
    this.playerBullets.update(dt)
    this.bossBullets.update(dt)
    this.crowd.update(dt, leaderX, this.leaderZ)

    // 5) win check (before lose — design 6.5)
    if (this.track.boss.hp <= 0 && this.timeRemaining > 0) {
      if (this.stageIndex < this.stages.length - 1) {
        this._advanceStage()
        return
      }
      return this._end('WIN')
    }
    // 6) lose check
    if (this.timeRemaining <= 0 || this.crowd.count <= 0) return this._end('LOSE')

    this.hud.update(this._hudState())
  }

  // Nearest engaged target ahead within fireRange (block or enemy), ties by lowest Z.
  _acquireTarget(leaderX, fireRange) {
    let best = null
    let bestZ = Infinity
    const far = this.leaderZ + fireRange
    for (const o of this.track.obstacles) {
      if (!o.broken && o.hp > 0 && o.z > this.leaderZ && o.z <= far && o.inRange(leaderX) && o.z < bestZ) {
        best = o
        bestZ = o.z
      }
    }
    for (const e of this.track.enemies) {
      if (!e.dead && e.hp > 0 && e.z > this.leaderZ && e.z <= far && e.inRange(leaderX) && e.z < bestZ) {
        best = e
        bestZ = e.z
      }
    }
    return best
  }

  _fire(dt, aimX, aimZ) {
    this._fireAcc += dt
    while (this._fireAcc >= FIRE_CADENCE) {
      this._fireAcc -= FIRE_CADENCE
      const n = Math.max(1, Math.min(6, Math.ceil(this.crowd.count / 12)))
      for (let k = 0; k < n; k++) {
        const m = this.crowd.frontPosition(this._bulletTick++)
        const dx = aimX - m.x
        const dy = 0.7 - m.y
        const dz = aimZ - m.z
        const dist = Math.hypot(dx, dy, dz) || 1
        const s = PLAYER_BULLET_SPEED / dist
        this.playerBullets.spawn(m.x, m.y, m.z, dx * s, dy * s, dz * s, dist / PLAYER_BULLET_SPEED + 0.12)
      }
    }
  }

  _resolveCrossings(leaderX, shielded) {
    const a = this.prevZ
    const b = this.leaderZ

    for (const g of this.track.gates) {
      if (!g.done && g.z > a && g.z <= b) {
        const { good } = g.apply(this.crowd, leaderX)
        this.combo = good ? this.combo + 1 : 0
      }
    }
    // blocks: reached with hp left while engaged → leftover drains (unless shielded)
    for (const o of this.track.obstacles) {
      if (!o.broken && o.z > a && o.z <= b) {
        if (o.inRange(leaderX) && o.hp > 0) {
          const drained = o.contact(this.crowd, shielded)
          if (drained > 0) this.combo = 0
        }
      }
    }
    // enemies march toward us → contact when they reach the army (z ≤ leaderZ)
    for (const e of this.track.enemies) {
      if (!e.dead && e.z <= b) {
        if (e.inRange(leaderX) && e.hp > 0) {
          const drained = e.contact(this.crowd, shielded)
          if (drained > 0) this.combo = 0
        } else {
          e.dead = true
          e.group.visible = false // dodged / slipped past — no loss
        }
      }
    }
    // power-ups
    for (const p of this.track.powerups) {
      if (!p.collected && p.z > a && p.z <= b && Math.abs(leaderX - p.x) < PICK_RADIUS) {
        p.collect()
        this._applyPowerup(p.type)
      }
    }
  }

  _resolveBossBullets(leaderX, shielded) {
    const burst = this.track.boss.burst
    this.bossBullets.forEachActive((i, x, y, z) => {
      if (z <= this.leaderZ + 0.4) {
        if (Math.abs(x - leaderX) < HIT_RADIUS) {
          if (!shielded) {
            this.crowd.removeBurst(burst)
            this.combo = 0
          }
        }
        this.bossBullets.deactivate(i) // hit, absorbed, or passed
      }
    })
  }

  _applyPowerup(type) {
    const t = this.config.powerupTuning
    if (type === 'rapid') this.rapidLeft = t.rapidDuration
    else if (type === 'reinforce') this.crowd.add(t.reinforce)
    else if (type === 'shield') this.shieldLeft = t.shieldDuration
    else if (type === 'damage') this.dmgMult = Math.min(t.dmgCap, this.dmgMult + t.dmgBoostStep)
  }

  _end(result) {
    this.state = result
    const stats = `Crowd ${this.crowd.count}  ·  Stage ${this.stageIndex + 1}`
    if (result === 'WIN') this.screens.showWin(stats)
    else this.screens.showLose(stats)
  }

  _hudState() {
    return {
      phase: this.phase,
      count: this.crowd.count,
      combo: this.combo,
      timeRemaining: this.timeRemaining,
      runProgress: this.leaderZ / this._bossEntryZ(),
      bossHpFrac: this.track.boss.hpFraction,
      rapidLeft: this.rapidLeft,
      shieldLeft: this.shieldLeft,
      dmgMult: this.dmgMult,
    }
  }

  _loop(now) {
    const dt = Math.min((now - this._last) / 1000, MAX_DT)
    this._last = now
    this._update(dt)
    this.sm.chase(this.leaderPos, dt) // keep trailing on menu/end screens too
    this.sm.render()
    requestAnimationFrame(this._loop)
  }
}
