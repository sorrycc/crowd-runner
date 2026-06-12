import * as THREE from 'three'
import { SceneManager } from './core/SceneManager.js'
import { Input } from './core/Input.js'
import { Road } from './world/Road.js'
import { Environment } from './world/Environment.js'
import { Track } from './world/Track.js'
import { Crowd, FORMATION_HALF_WIDTH } from './entities/Crowd.js'
import { BulletPool } from './entities/Bullets.js'
import { Effects } from './effects/Effects.js'
import { BOSS_DEATH_TIME } from './entities/Boss.js'
import { soldierModelReady } from './util/models.js'
import { tickSoldiers } from './util/soldier.js'
import { HUD } from './ui/HUD.js'
import { Screens } from './ui/Screens.js'
import { PRESETS } from './config/difficulty.js'
import { generateStage, WORLD_LEN, CLIMAX_INDEX } from './config/generator.js'
import { EVENT_FX, EVENT_LABEL } from './config/events.js'

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
const PICK_RADIUS = 0.9 // power-up pickup x-tolerance
const MENU_SEED = 20260612 // fixed seed for the menu backdrop stage
const BEST_DEPTH_KEY = 'swarmrun.bestDepth'
const BEST_PEAK_KEY = 'swarmrun.bestPeak'

// Boss-bullet hit radius DERIVED from the real formation half-width (DRY, design 6.2).
const HIT_RADIUS = FORMATION_HALF_WIDTH + 0.2

const PLAYER_BULLET_SPEED = 60
const FIRE_CADENCE = 0.05 // seconds between muzzle volleys
const SHOOT_SFX_CADENCE = 0.11 // seconds between shoot SFX (slower than the visual volley)

export class Game {
  // No stages array (redesign): stages are generated on demand from a per-run seed via
  // generateStage(index, seed, preset). The constructor builds a fixed menu backdrop.
  constructor(audio = null) {
    this.audio = audio // AudioManager (optional; every call site guards with ?. — AC7)
    this.runSeed = MENU_SEED // real per-run seed picked in start()
    this.preset = PRESETS.normal
    this.stageIndex = 0
    this.config = generateStage(0, MENU_SEED, PRESETS.normal) // menu backdrop stage
    this.trackLength = WORLD_LEN

    const app = document.getElementById('app')
    this.sm = new SceneManager(app)
    this.input = new Input(this.sm.renderer.domElement, this.config.roadHalf)

    // static world — built ONCE at a fixed large length ("denser, not longer", design Decision 7).
    // Track length is bounded/near-constant across all depths, so Road/Environment never rebuild.
    new Road(this.sm.scene, this.config, WORLD_LEN)
    new Environment(this.sm.scene, this.config, WORLD_LEN)

    // dynamic entities — deferred until the soldier model resolves (AC6). First paint is the
    // menu over the static world (road/env/sky), none of which need the model; Crowd + Track
    // (which build the soldier InstancedMeshes + enemy squads) come online a few tens of ms
    // later from the bundled local .glb. start() guards against a Start click before then.
    this.crowd = null
    this.track = null
    this._ready = false
    this._pendingStart = false

    // bullet pools
    this.playerBullets = new BulletPool(this.sm.scene, {
      cap: 140,
      color: 0xfde047,
      radius: 0.06,
      length: 0.6,
    })
    // Cap sized for the fan: worst case ≈ largest base bullets (~6) + Hard(+2) + enrage(+2) = ~10
    // per volley, and at the short enraged Hard interval up to ~2 volleys can be in flight ≈ 20
    // live bullets — 64 leaves comfortable margin (design 6.3).
    this.bossBullets = new BulletPool(this.sm.scene, {
      cap: 64,
      color: 0xf43f5e,
      radius: 0.22,
      length: 0.5,
    })

    // cosmetic effects (floating numbers, particle bursts, camera shake) — pooled,
    // page-lifetime (like the bullet pools); never disposed, only clear()ed on reset.
    this.effects = new Effects(this.sm.scene, this.sm)

    this.hud = new HUD(audio)
    this.screens = new Screens({
      onStart: (difficulty) => this.start(difficulty),
      onRestart: () => this.restart(),
      onContinueEndless: () => this.continueEndless(),
    })

    // active difficulty tier (chosen on the start screen; in-memory only, applies to the whole run)
    this.difficulty = 'normal'

    this.state = 'MENU'
    this.phase = 'RUN'
    this.leaderPos = new THREE.Vector3(0, 0, 0)
    this.leaderZ = 0
    this.prevZ = 0
    this.timeRemaining = this.config.timeLimit
    this.combo = 0

    // boss-death celebration hold (WIN_SEQUENCE) bookkeeping (design 6.8)
    this._winTimer = 0
    this._deathWave = 0

    // buffs + transient modifier-event state (redesign §6.6)
    this.dmgMult = 1
    this.rapidLeft = 0
    this.shieldLeft = 0
    this.sandstormLeft = 0
    this.frenzyLeft = 0
    this._modIndex = 0 // next modifier in cfg.modifiers to fire

    // best-run + peak tracking (persisted; design Decision 10)
    this.peakCount = 0
    this.bestDepth = this._loadBest(BEST_DEPTH_KEY)
    this.bestPeak = this._loadBest(BEST_PEAK_KEY)

    this._fireAcc = 0
    this._bulletTick = 0
    this._shootSfxAcc = 0

    // Build Crowd + Track once the shared soldier geometry is ready, then drain a queued Start.
    soldierModelReady.then((soldierGeo) => {
      this.crowd = new Crowd(this.sm.scene, this.config, soldierGeo)
      this.track = new Track(this.sm.scene, this.config, soldierGeo)
      this._ready = true
      if (this._pendingStart) {
        this._pendingStart = false
        this._beginStart()
      }
    })

    this._last = performance.now()
    this._loop = this._loop.bind(this)
    requestAnimationFrame(this._loop)
  }

  // ── lifecycle ──
  // The chosen tier sets the curve OFFSET for the whole run (in-memory). A random per-run seed
  // makes every playthrough's layout + events differ (redesign §6.6, Decision 8/9).
  start(difficulty = 'normal') {
    this.difficulty = difficulty
    this.preset = PRESETS[difficulty] || PRESETS.normal
    this.runSeed = (Math.random() * 0xffffffff) >>> 0 // random per-run seed (re-rolls on restart)
    // Audio unlock runs inside the Start-click stack FIRST so the user gesture is preserved
    // (AC6) — even if the soldier model isn't ready yet. playMusic() queues until decode
    // finishes on first run; starts from the top on restart (see AudioManager regimes).
    this.audio?.unlock()
    this.audio?.playMusic()
    // If the model is still loading, queue the start; the soldierModelReady.then drains it
    // the instant Crowd/Track exist, so a click during a slow/cold load never crashes.
    if (!this._ready) {
      this._pendingStart = true
      return
    }
    this._beginStart()
  }

  // Generate stage i on demand from the per-run seed + tier (the single procedural code path).
  _activeStage(i) {
    return generateStage(i, this.runSeed, this.preset)
  }

  _beginStart() {
    this.state = 'PLAYING'
    this.stageIndex = 0
    this.peakCount = 0
    this.config = this._activeStage(this.stageIndex)
    this.trackLength = WORLD_LEN
    // rebuild entities for the freshly generated stage (the constructor's Track only backed the
    // menu) — Track.reset disposes + rebuilds from the passed config.
    this.track.reset(this.config)
    this._resetStageState(this.config.startCount)
    this.screens.hideAll()
    this.hud.show(this.config.label)
    this.hud.update(this._hudState())
  }

  // Restart returns to the start screen so the player re-picks the tier (design Decision 9).
  restart() {
    this.stageIndex = 0
    this.dmgMult = 1 // full reset of permanent buffs
    this.config = generateStage(0, MENU_SEED, PRESETS.normal) // menu backdrop (re-seeded on start)
    this.audio?.stopMusic() // ensure music restarts from the top via start() (AC4)
    this.track.reset(this.config)
    this.state = 'MENU'
    this.hud.hide()
    this.screens.showStart()
  }

  _advanceStage() {
    const carried = this.crowd.count
    this.stageIndex++
    this.config = this._activeStage(this.stageIndex)
    this.trackLength = WORLD_LEN
    this.track.reset(this.config)
    // carry the army, floored to the new stage's baseline (Decision 5/9); keep dmgMult.
    this._resetStageState(Math.max(carried, this.config.startCount))
    this._persistBest() // deep endless progress survives a crash (Decision 10 / reviewer R1 pt14)
    this.hud.show(this.config.label)
    this.hud.flashBanner(this.config.boss.finale ? 'FINAL BOSS' : this.config.label)
    this.state = 'PLAYING' // re-entered from WIN_SEQUENCE; _resetStageState left phase=RUN
    this.audio?.play('stage-advance') // music keeps looping seamlessly across the advance
  }

  // "Continue — Endless" button after the stage-5 climax WIN screen (design §6.6, AC12). Just the
  // standard advance path — index 4→5, carrying max(finishCount, baseline), no special boundary.
  continueEndless() {
    this.screens.hideAll()
    this._advanceStage()
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
    this.sandstormLeft = 0
    this.frenzyLeft = 0
    this._modIndex = 0
    this._fireAcc = 0
    this._shootSfxAcc = 0
    this._winTimer = 0
    this._deathWave = 0
    this.input.sensMult = 1

    this.playerBullets.clear()
    this.bossBullets.clear()
    this.effects.clear() // hard-cut in-flight popups/particles (shake resets on the snap below)

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

  // Fire any modifier-events whose z the leader just crossed (toll / bonus / sandstorm). frenzy is
  // armed separately at boss entry (it's a boss-fight window — §6.6).
  _tickModifiers(leaderX) {
    const mods = this.config.modifiers
    if (!mods) return
    while (this._modIndex < mods.length && mods[this._modIndex].z <= this.leaderZ) {
      this._fireModifier(mods[this._modIndex], leaderX)
      this._modIndex++
    }
  }

  _fireModifier(m, leaderX) {
    if (m.type === 'toll') {
      const before = this.crowd.count
      this.crowd.sub(Math.round(this.crowd.count * EVENT_FX.TOLL_FRACTION))
      const lost = before - this.crowd.count
      this.combo = 0
      this.audio?.play('hurt')
      if (lost > 0) {
        this.effects.number(-lost, leaderX, 1.8, this.leaderZ)
        this.effects.lossShards(leaderX, 0.8, this.leaderZ)
        this.effects.soldierPoof(leaderX, 0.6, this.leaderZ)
        this.sm.shake(0.15)
      }
    } else if (m.type === 'bonus') {
      const before = this.crowd.count
      this.crowd.add(Math.round(this.crowd.count * EVENT_FX.BONUS_FRACTION))
      const gain = this.crowd.count - before
      this.audio?.play('powerup')
      if (gain > 0) {
        this.effects.number(gain, leaderX, 1.8, this.leaderZ)
        this.effects.gainPuff(leaderX, 0.8, this.leaderZ)
        this.crowd.pop()
      }
    } else if (m.type === 'sandstorm') {
      this.sandstormLeft = EVENT_FX.SANDSTORM_DURATION
      this.audio?.play('hurt', { volume: 0.4 })
    }
    this.hud.flashBanner(EVENT_LABEL[m.type] || 'EVENT')
  }

  // ── best-run persistence (Decision 10) ──
  _loadBest(key) {
    try {
      return parseInt(localStorage.getItem(key), 10) || 0
    } catch {
      return 0
    }
  }

  _saveBest(key, v) {
    try {
      localStorage.setItem(key, String(v))
    } catch {
      /* best-effort */
    }
  }

  _persistBest() {
    const depth = this.stageIndex + 1
    if (depth > this.bestDepth) { this.bestDepth = depth; this._saveBest(BEST_DEPTH_KEY, depth) }
    if (this.peakCount > this.bestPeak) { this.bestPeak = this.peakCount; this._saveBest(BEST_PEAK_KEY, this.peakCount) }
  }

  _update(dt) {
    if (this.state !== 'PLAYING') return
    const cfg = this.config

    // modifier-event feel: sandstorm slows the auto-run + dampens steering (Game-only feel)
    const sandstorm = this.sandstormLeft > 0
    this.input.sensMult = sandstorm ? EVENT_FX.SANDSTORM_STEER_MULT : 1

    // 1) advance + decrement timer
    this.input.update(dt)
    this.prevZ = this.leaderZ
    if (this.phase === 'RUN') {
      const runSpeed = cfg.runSpeed * (sandstorm ? EVENT_FX.SANDSTORM_SPEED_MULT : 1)
      this.leaderZ += runSpeed * dt
      if (this.leaderZ >= this._bossEntryZ()) {
        this.leaderZ = this._bossEntryZ()
        this.phase = 'BOSS'
        // #1 fix: army-scaled boss HP set at RUN→BOSS from the LIVE army at entry.
        this.track.boss.setHp(Math.round(cfg.boss.hpBase + cfg.boss.hpPerArmy * this.crowd.count))
        // frenzy event arms the boss fight (a fight-time window, not a z-crossing — §6.3/§6.6)
        this.frenzyLeft = cfg.boss.frenzy ? EVENT_FX.FRENZY_DURATION : 0
        if (cfg.boss.frenzy) this.hud.flashBanner(EVENT_LABEL.frenzy)
      }
    }
    // Negate input→world-X: the chase camera faces +Z and mirrors world X on
    // screen (see SceneManager), so without this, right input would drift the
    // crowd left. One negation here keeps every leaderX consumer + camera-follow
    // consistent; clamping stays symmetric in Input.x space.
    const leaderX = -this.input.x
    this.leaderPos.set(leaderX, 0, this.leaderZ)
    this.timeRemaining -= dt

    // 2) tick timed buffs + modifier events
    if (this.rapidLeft > 0) this.rapidLeft = Math.max(0, this.rapidLeft - dt)
    if (this.shieldLeft > 0) this.shieldLeft = Math.max(0, this.shieldLeft - dt)
    if (this.sandstormLeft > 0) this.sandstormLeft = Math.max(0, this.sandstormLeft - dt)
    if (this.frenzyLeft > 0) this.frenzyLeft = Math.max(0, this.frenzyLeft - dt)
    if (this.phase === 'RUN') this._tickModifiers(leaderX)
    const F = this._firepower()
    const shielded = this.shieldLeft > 0
    this.peakCount = Math.max(this.peakCount, this.crowd.count)

    // 3) ranged combat
    if (this.phase === 'RUN') {
      for (const e of this.track.enemies) e.update(dt)
      for (const o of this.track.obstacles) o.update(dt) // ticks crumble anim (no-op otherwise)
      for (const p of this.track.powerups) p.update(dt)

      const target = this._acquireTarget(leaderX, cfg.combat.fireRange)
      if (target) {
        target.damage(F * dt)
        const aimX = (target.xRange[0] + target.xRange[1]) / 2
        this._fire(dt, aimX, target.z)
        // death edge: target is an Obstacle (.broken) or an Enemy (.dead) — mutually
        // exclusive props, so the absent one reads falsy. enemy-down fires only from this
        // focus-fire kill, never the slip-past path in _resolveCrossings.
        if (target.broken) {
          this.audio?.play('block-break')
          this.effects.blockBreak(aimX, 0.6, target.z) // debris burst (flash is on the block)
        } else if (target.dead) {
          this.audio?.play('enemy-down')
          this.effects.enemyDeath(aimX, 0.8, target.z)
        }
      }
      this._resolveCrossings(leaderX, shielded)
    } else {
      // BOSS phase — pass the active frenzy multiplier through the shared volley model
      const frenzyMult = this.frenzyLeft > 0 ? EVENT_FX.FRENZY_FIRE_MULT : 1
      const bossFired = this.track.boss.update(dt, F, leaderX, this.leaderZ, this.bossBullets, frenzyMult)
      if (bossFired) {
        this.audio?.play('boss-shot', { volume: 0.6 })
        this.effects.muzzleFlash(0, 1.95, cfg.boss.z - 1.7) // flash at the boss cannon muzzle
      }
      this._fire(dt, 0, cfg.boss.z - 1.4)
      this._resolveBossBullets(leaderX, shielded)
    }

    // 4) advance projectiles + crowd
    this.playerBullets.update(dt)
    this.bossBullets.update(dt)
    this.crowd.update(dt, leaderX, this.leaderZ)

    // 5) win check (before lose — design 6.5/6.8)
    if (this.track.boss.hp <= 0 && this.timeRemaining > 0) {
      // boss-down fires exactly once: _beginBossDeath switches state out of PLAYING, so
      // _update early-returns and never re-enters this branch (no lose transition either).
      this.audio?.play('boss-down')
      this._beginBossDeath()
      return
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
    let volleyed = false
    this._fireAcc += dt
    while (this._fireAcc >= FIRE_CADENCE) {
      this._fireAcc -= FIRE_CADENCE
      volleyed = true
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
    // Muzzle flash at the firing front — at most once per call (not per volley tick), so it
    // never multi-bursts on frame catch-up and stays inside the particle budget (AC4).
    if (volleyed && this.crowd.count > 0) {
      const f = this.crowd.frontPosition(0)
      this.effects.muzzleFlash(f.x, f.y + 0.1, f.z)
    }
    // Shoot SFX on its own slower cadence (the 0.05s volley rate would machine-gun audio).
    this._shootSfxAcc += dt
    if (this._shootSfxAcc >= SHOOT_SFX_CADENCE) {
      this._shootSfxAcc = 0
      this.audio?.play('shoot', { volume: 0.5 })
    }
  }

  _resolveCrossings(leaderX, shielded) {
    const a = this.prevZ
    const b = this.leaderZ

    for (const g of this.track.gates) {
      if (!g.done && g.z > a && g.z <= b) {
        const before = this.crowd.count
        const { good } = g.apply(this.crowd, leaderX)
        const delta = this.crowd.count - before
        this.combo = good ? this.combo + 1 : 0
        this.audio?.play(good ? 'gate-good' : 'gate-bad')
        // juice: floating +N/−N (skip a no-op gate at cap), gate-pick puff, then gain
        // pop / loss shards. No shake — a gate choice isn't a hit.
        if (delta !== 0) this.effects.number(delta, leaderX, 1.8, this.leaderZ)
        this.effects.gatePick(leaderX, 1.8, g.z, good)
        if (delta > 0) {
          this.effects.gainPuff(leaderX, 0.8, this.leaderZ)
          this.crowd.pop()
        } else if (delta < 0) {
          this.effects.lossShards(leaderX, 0.8, this.leaderZ)
        }
      }
    }
    // blocks: reached with hp left while engaged → leftover drains (unless shielded)
    for (const o of this.track.obstacles) {
      if (!o.broken && o.z > a && o.z <= b) {
        if (o.inRange(leaderX) && o.hp > 0) {
          const drained = o.contact(this.crowd, shielded)
          if (drained > 0) {
            this.combo = 0
            this.audio?.play('hurt')
            this.effects.number(-drained, leaderX, 1.8, this.leaderZ)
            this.effects.lossShards(leaderX, 0.8, this.leaderZ)
            this.effects.soldierPoof(leaderX, 0.6, this.leaderZ) // soldiers fall on contact (AC4)
            this.sm.shake(0.12)
          }
          if (o.broken) this.effects.blockBreak((o.xRange[0] + o.xRange[1]) / 2, 0.6, o.z)
        }
      }
    }
    // enemies march toward us → contact when they reach the army (z ≤ leaderZ)
    for (const e of this.track.enemies) {
      if (!e.dead && e.z <= b) {
        if (e.inRange(leaderX) && e.hp > 0) {
          const drained = e.contact(this.crowd, shielded)
          if (drained > 0) {
            this.combo = 0
            this.audio?.play('hurt')
            this.effects.number(-drained, leaderX, 1.8, this.leaderZ)
            this.effects.lossShards(leaderX, 0.8, this.leaderZ)
            this.effects.soldierPoof(leaderX, 0.6, this.leaderZ) // soldiers fall on contact (AC4)
            this.sm.shake(0.12)
          }
          if (e.dead) this.effects.enemyDeath((e.xRange[0] + e.xRange[1]) / 2, 0.8, e.z)
        } else {
          e.dead = true
          e.group.visible = false // dodged / slipped past — no loss (silent, no _dying)
        }
      }
    }
    // power-ups
    for (const p of this.track.powerups) {
      if (!p.collected && p.z > a && p.z <= b && Math.abs(leaderX - p.x) < PICK_RADIUS) {
        p.collect()
        this.effects.powerupGrab(p.x, 0.95, p.z, p.color) // distinct grab pop in its colour
        this._applyPowerup(p.type)
      }
    }
  }

  _resolveBossBullets(leaderX, shielded) {
    // Each connecting fan bullet drains bulletDamage soldiers; a full fan of N landing = N ×
    // bulletDamage (matches the verifier's volley model — design 6.3).
    const bulletDamage = this.track.boss.bulletDamage
    this.bossBullets.forEachActive((i, x, y, z) => {
      if (z <= this.leaderZ + 0.4) {
        if (Math.abs(x - leaderX) < HIT_RADIUS) {
          if (!shielded) {
            const before = this.crowd.count
            this.crowd.removeBurst(bulletDamage)
            const lost = before - this.crowd.count
            this.combo = 0
            this.audio?.play('hurt') // multi-bullet frames collapse to one hit via guard
            if (lost > 0) {
              this.effects.number(-lost, leaderX, 1.8, this.leaderZ)
              this.effects.lossShards(leaderX, 0.8, this.leaderZ)
              this.effects.soldierPoof(leaderX, 0.6, this.leaderZ) // soldiers fall on the hit (AC4)
              this.sm.shake(0.12) // light shake on soldier loss
            }
          }
        }
        this.bossBullets.deactivate(i) // hit, absorbed, or passed
      }
    })
  }

  _applyPowerup(type) {
    this.audio?.play('powerup')
    const t = this.config.powerupTuning
    if (type === 'rapid') this.rapidLeft = t.rapidDuration
    else if (type === 'reinforce') {
      const before = this.crowd.count
      this.crowd.add(t.reinforce)
      const delta = this.crowd.count - before // clamped at cap → may be 0
      if (delta > 0) {
        this.effects.number(delta, this.leaderPos.x, 1.8, this.leaderZ)
        this.effects.gainPuff(this.leaderPos.x, 0.8, this.leaderZ)
        this.crowd.pop()
      }
    } else if (type === 'shield') this.shieldLeft = t.shieldDuration
    else if (type === 'damage') this.dmgMult = Math.min(t.dmgCap, this.dmgMult + t.dmgBoostStep)
  }

  // Boss-death celebration hold (design 6.8). The boss is already dead (win check decided
  // it); we freeze out of PLAYING for BOSS_DEATH_TIME and play a multi-stage burst + heavy
  // shake before advancing / showing the win screen. Cosmetic-only timing.
  _beginBossDeath() {
    this.state = 'WIN_SEQUENCE'
    this._winTimer = BOSS_DEATH_TIME
    this._deathWave = 0
    this.track.boss.playDeath()
    this.effects.bossDeathWave(0, 2.5, this.config.boss.z, 0) // first, largest wave
    this.sm.shake(0.6) // heavy
  }

  _tickWinSequence(dt) {
    this._winTimer -= dt
    this.track.boss.updateDeath(dt)
    const elapsed = BOSS_DEATH_TIME - this._winTimer
    const bz = this.config.boss.z
    // two staggered follow-up waves (the "multi-stage" burst)
    if (this._deathWave < 1 && elapsed >= 0.32) {
      this._deathWave = 1
      this.effects.bossDeathWave(0, 3.0, bz, 1)
      this.sm.shake(0.35)
    } else if (this._deathWave < 2 && elapsed >= 0.64) {
      this._deathWave = 2
      this.effects.bossDeathWave(0, 2.0, bz, 2)
      this.sm.shake(0.25)
    }
    if (this._winTimer <= 0) {
      // Climax (stage 5 / index 4) → WIN screen + "Continue — Endless". Every other cleared boss
      // (stages 1-4 and endless 6+) auto-advances. Endless ends only on a loss (Decision 11/AC13).
      if (this.stageIndex === CLIMAX_INDEX) this._end('WIN')
      else this._advanceStage()
    }
  }

  _end(result) {
    this.state = result
    this._persistBest()
    this.audio?.stopMusic() // music stops on WIN/LOSE; the sting plays clean over silence
    this.audio?.play(result === 'WIN' ? 'win' : 'lose')
    const tier = this.preset?.label || 'NORMAL'
    const depthWord = this.stageIndex < 5 ? `Stage ${this.stageIndex + 1}` : `Depth ${this.stageIndex + 1}`
    const stats = `Crowd ${this.crowd.count}  ·  ${depthWord}  ·  ${tier}`
    const best = `Best — Depth ${this.bestDepth}  ·  Peak ${this.bestPeak}`
    if (result === 'WIN') this.screens.showWin(stats, this.config.boss.finale) // finale → endless btn
    else this.screens.showLose(stats, best)
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
    tickSoldiers(dt) // advance the shared soldier-animation clock (every soldier material reads it)
    this._update(dt)
    this.effects.update(dt) // animate particles/popups every frame (incl. WIN_SEQUENCE/end)
    if (this.state === 'WIN_SEQUENCE') this._tickWinSequence(dt)
    this.sm.chase(this.leaderPos, dt) // keep trailing on menu/end screens too
    this.sm.render()
    requestAnimationFrame(this._loop)
  }
}
