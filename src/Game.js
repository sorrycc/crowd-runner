import * as THREE from 'three'
import { SceneManager } from './core/SceneManager.js'
import { Input } from './core/Input.js'
import { Road } from './world/Road.js'
import { Environment } from './world/Environment.js'
import { Track } from './world/Track.js'
import { Crowd } from './entities/Crowd.js'
import { HUD } from './ui/HUD.js'
import { Screens } from './ui/Screens.js'

// Orchestrator + state machine + game loop (design 6.1/6.4/6.5).
// state: MENU | PLAYING | WIN | LOSE ; phase (while PLAYING): RUN | BOSS.
// Per-frame order (design 6.5): advance+timer -> collisions/combat -> win check -> lose check.

const MAX_DT = 0.05
const END_PAD = 40 // trackLength = boss.z + END_PAD (single source — design 6.2)
const PICK_RADIUS = 0.9 // coin pickup x-tolerance (engine-feel constant)

export class Game {
  constructor(config) {
    this.config = config
    this.trackLength = config.boss.z + END_PAD

    const app = document.getElementById('app')
    this.sm = new SceneManager(app)
    this.input = new Input(this.sm.renderer.domElement, config.roadHalf)

    // static world
    new Road(this.sm.scene, config, this.trackLength)
    new Environment(this.sm.scene, config, this.trackLength)

    // dynamic entities
    this.crowd = new Crowd(this.sm.scene, config)
    this.track = new Track(this.sm.scene, config)

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
    this.timeRemaining = config.timeLimit
    this.coins = 0
    this.combo = 0

    this._last = performance.now()
    this._loop = this._loop.bind(this)
    requestAnimationFrame(this._loop)
  }

  start() {
    const cfg = this.config
    this.state = 'PLAYING'
    this.phase = 'RUN'
    this.leaderZ = 0
    this.prevZ = 0
    this.timeRemaining = cfg.timeLimit
    this.coins = 0
    this.combo = 0

    this.input.reset()
    this.crowd.reset(cfg.startCount)
    this.leaderPos.set(0, 0, 0)
    this.crowd.update(0, 0, 0)
    this.sm.chase(this.leaderPos, 0, true) // snap camera behind the start line

    this.screens.hideAll()
    this.hud.show(cfg.label)
    this.hud.update(this._hudState())
  }

  restart() {
    this.track.reset() // rebuild deterministic track, clearing all flags (AC14/AC15)
    this.start()
  }

  _bossEntryZ() {
    return this.config.boss.z - this.config.bossStandoff
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
    const leaderX = this.input.x
    this.leaderPos.set(leaderX, 0, this.leaderZ)
    this.timeRemaining -= dt

    // 2) collisions / combat
    this._resolveCrossings(leaderX)
    if (this.phase === 'BOSS') this.track.boss.update(dt, this.crowd)
    for (const c of this.track.coins) c.update(dt)
    this.crowd.update(dt, leaderX, this.leaderZ)

    // 3) win check (before lose — design 6.5)
    if (this.track.boss.hp <= 0 && this.timeRemaining > 0) return this._end('WIN')
    // 4) lose check
    if (this.timeRemaining <= 0 || this.crowd.count <= 0) return this._end('LOSE')

    this.hud.update(this._hudState())
  }

  _resolveCrossings(leaderX) {
    const a = this.prevZ
    const b = this.leaderZ

    for (const g of this.track.gates) {
      if (!g.done && g.z > a && g.z <= b) {
        const { good } = g.apply(this.crowd, leaderX)
        this.combo = good ? this.combo + 1 : 0
      }
    }
    for (const o of this.track.obstacles) {
      if (!o.broken && o.z > a && o.z <= b && o.inRange(leaderX)) {
        o.hit(this.crowd)
        this.combo = 0
      }
    }
    for (const c of this.track.coins) {
      if (!c.collected && c.z > a && c.z <= b && Math.abs(leaderX - c.x) < PICK_RADIUS) {
        c.collect()
        this.coins++
      }
    }
  }

  _end(result) {
    this.state = result
    const stats = `Crowd ${this.crowd.count}  ·  Coins ${this.coins}`
    if (result === 'WIN') this.screens.showWin(stats)
    else this.screens.showLose(stats)
  }

  _hudState() {
    return {
      phase: this.phase,
      count: this.crowd.count,
      coins: this.coins,
      combo: this.combo,
      timeRemaining: this.timeRemaining,
      runProgress: this.leaderZ / this._bossEntryZ(),
      bossHpFrac: this.track.boss.hpFraction,
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
