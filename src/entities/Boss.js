import * as THREE from 'three'
import { makeTextSprite, updateTextSprite, formatCount } from '../util/text.js'
import { castCadence, bossCast, PATTERN_MAX } from '../config/difficulty.js'

// End-of-stage boss (design 6.6 / 2026-06-12-gltf-soldiers-crowd-boss §6.7). The army's
// firepower drains the boss each frame; its only threat is telegraphed projectiles fired on
// a cadence (aimed at the army's x, so steering dodges them). Game owns the boss-bullet pool
// and the collision test; Boss just requests a shot via bossBullets.spawn() and runs its
// menace cosmetics.
//
// Menace (visual-only — gameplay numbers untouched):
//  • a hulking procedural model (broad torso, pauldrons + spikes, visor + glowing eyes, a big
//    cannon arm) — larger/scarier than the old capsule + 2 eyes + barrel;
//  • a WIND-UP telegraph: a charge ramp over the ~0.45s before each shot (cannon core glows,
//    eyes brighten, the boss rears back), synced to the existing fireInterval, releasing into
//    the red muzzle flash + recoil at fire;
//  • HP-based DAMAGE STATES: a continuous scorch/darken + ember-crack ramp on hpFraction, plus
//    2 persistent thresholds (~66% / ~33%) that fade in smoke and a structural slump;
//  • a death COLLAPSE: scale punch → topple → sink, driven by Game's WIN_SEQUENCE hold.
//
// The projectile spawn (_fire) keeps FIXED origin/trajectory constants, so the boss-bullet
// path that HIT_RADIUS reasoning depends on is unchanged (AC8). All wind-up / slump / recoil
// motion is cosmetic group rotation and never feeds the spawn point.

const _flashColor = new THREE.Color(0xfca5a5)
const _white = new THREE.Color(0xffffff)
const _charred = new THREE.Color(0x140a0a)

const WINDUP = 0.45 // seconds of telegraph before each shot
const RECOIL_TIME = 0.18

// Total angular spread of the bullet fan (radians). Geometry (design Decision 5): at the
// ~20-unit standoff the outermost bullet lands ~20·tan(0.065) ≈ 1.30 < HIT_RADIUS ≈ 1.56, so a
// stationary centred army eats the WHOLE volley — keeping the verifier's eat-all model faithful
// — while the ~2.6-unit covered band still forces a real lateral dodge across the 6-unit road.
const FAN_ANGLE = 0.13

// Enrage telegraph hues (cosmetic): the boss flips eyes/core to a hotter glow under enrage.
const _eyeCalm = 0xff2200
const _eyeRage = 0xff8a1e
const _coreCalm = 0xff4400
const _coreRage = 0xffb347

// Cosmetic boss-death hold (design 6.5). Game freezes into WIN_SEQUENCE for this long while
// the multi-stage burst + heavy shake + collapse play, then advances / shows the win screen.
export const BOSS_DEATH_TIME = 1.1

export class Boss {
  constructor(scene, config) {
    this.scene = scene
    this.z = config.boss.z
    this.maxHp = config.boss.hp
    this.hp = config.boss.hp
    this.fireInterval = config.boss.fireInterval ?? 1.6
    // bullets-per-volley (fan count) and soldiers-lost-per-connecting-bullet. Required in
    // every stage config (design Decision 13); these ?? fallbacks are crash-safety only.
    this.bullets = config.boss.bullets ?? 5
    this.bulletDamage = config.boss.bulletDamage ?? 3
    this.enrage = config.boss.enrage ?? { below: 0.33, fireIntervalMult: 0.7, bulletsAdd: 2 }
    this._enraged = false
    this.bulletSpeed = config.boss.bulletSpeed ?? 20
    // ── seeded skill system (2026-06-12-boss-seeded-skills) ──
    this.seed = config.boss.seed ?? 0 // SAME field the verifier keys mulberry32 off (AC2)
    this.skills = config.boss.skills ?? [{ type: 'fan', weight: 1 }]
    this.skillTuning = config.boss.skillTuning ?? {}
    this._castIndex = 0
    this._shieldLeft = 0
    this._shieldMult = 1
    this._pendingSlam = null // { xc, halfW, slamKill, left } during a slam wind-up
    this._hpShown = -1
    this._fireTimer = 0
    this._flash = 0
    this._charge = 0 // 0→1 wind-up telegraph
    this._recoil = 0 // 1→0 after a shot
    this._t = 0 // smoke clock
    this._dying = 0 // > 0 while the death sequence plays (design 6.5)

    this.group = new THREE.Group()
    this.group.position.set(0, 0, config.boss.z)

    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x7f1d1d,
      roughness: 0.55,
      metalness: 0.35,
      emissive: 0xff3300,
      emissiveIntensity: 0,
    })
    this._baseColor = this.bodyMat.color.clone()
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5, metalness: 0.5 })
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4, metalness: 0.6 })

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      m.rotation.set(rx, ry, rz)
      this.group.add(m)
      return m
    }

    // legs + hips (broad base)
    add(new THREE.BoxGeometry(0.9, 1.2, 1.0), darkMat, 0.9, 0.6, 0)
    add(new THREE.BoxGeometry(0.9, 1.2, 1.0), darkMat, -0.9, 0.6, 0)
    add(new THREE.BoxGeometry(2.6, 0.9, 1.7), this.bodyMat, 0, 1.5, 0)
    // torso, tapering up to broad shoulders
    add(new THREE.BoxGeometry(2.4, 1.9, 1.5), this.bodyMat, 0, 2.7, 0)
    add(new THREE.BoxGeometry(3.4, 0.7, 1.7), this.bodyMat, 0, 3.7, 0)
    // shoulder pauldrons + upward spikes
    for (const sx of [-1.55, 1.55]) {
      add(new THREE.BoxGeometry(0.9, 0.8, 1.2), darkMat, sx, 3.7, 0)
      add(new THREE.ConeGeometry(0.34, 0.9, 6), spikeMat, sx, 4.4, 0)
      add(new THREE.ConeGeometry(0.26, 0.7, 6), spikeMat, sx, 4.15, 0.55, Math.PI * 0.12)
    }
    // head with visor + horns
    add(new THREE.BoxGeometry(1.2, 1.0, 1.0), darkMat, 0, 4.55, 0.05)
    add(new THREE.BoxGeometry(1.05, 0.26, 0.2), spikeMat, 0, 4.6, 0.52) // visor band
    add(new THREE.ConeGeometry(0.2, 0.7, 6), spikeMat, -0.45, 5.3, 0, 0, 0, 0.5)
    add(new THREE.ConeGeometry(0.2, 0.7, 6), spikeMat, 0.45, 5.3, 0, 0, 0, -0.5)
    // glowing eyes (brighten on wind-up)
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 1.2 })
    for (const sx of [-0.3, 0.3]) add(new THREE.SphereGeometry(0.16, 12, 12), this.eyeMat, sx, 4.62, 0.55)

    // cannon arm — housing + barrel pointing toward the player (−Z), muzzle tip at ~z-1.4
    add(new THREE.BoxGeometry(1.0, 1.0, 1.2), darkMat, 0, 1.95, 0.2)
    add(new THREE.CylinderGeometry(0.42, 0.5, 1.6, 16), darkMat, 0, 1.95, -0.6, Math.PI / 2)
    add(new THREE.CylinderGeometry(0.34, 0.34, 0.5, 16), spikeMat, 0, 1.95, -1.35, Math.PI / 2) // muzzle
    // charge core at the muzzle (glows during the wind-up telegraph)
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff4400, emissiveIntensity: 0 })
    this.core = add(new THREE.SphereGeometry(0.3, 14, 14), this.coreMat, 0, 1.95, -1.4)

    // smoke puffs revealed by damage thresholds (self-contained — no Effects coupling)
    this.smoke = []
    const smokeMat = () =>
      new THREE.MeshBasicMaterial({ color: 0x1f2024, transparent: true, opacity: 0, depthWrite: false })
    const smokeSpots = [
      [-1.4, 3.9, -0.6, 0.0],
      [1.3, 4.0, -0.5, 0.45],
      [0.2, 3.4, -0.8, 0.8],
      [-0.6, 4.3, -0.4, 0.27],
    ]
    for (const [sx, sy, sz, phase] of smokeSpots) {
      const mat = smokeMat()
      const mesh = add(new THREE.SphereGeometry(0.42, 8, 8), mat, sx, sy, sz)
      this.smoke.push({ mesh, mat, ox: sx, oy: sy, oz: sz, phase })
    }

    this.tag = makeTextSprite(formatCount(this.hp), {
      scale: 2.2,
      border: '#E52521', // NES mario-red boss plate (autoshrink handles long HP)
    })
    this.tag.position.set(0, 6.0, 0)
    this.group.add(this.tag)

    // ── damage-shield bubble (cosmetic; visible while the boss shield window is up) ──
    this.shieldMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.shieldBubble = new THREE.Mesh(new THREE.SphereGeometry(3.4, 18, 14), this.shieldMat)
    this.shieldBubble.position.set(0, 3.0, 0)
    this.group.add(this.shieldBubble)

    // ── telegraphed slam marker (flat ground ring at the army's z; lives in world space) ──
    this.slamMat = new THREE.MeshBasicMaterial({
      color: 0xff3b30,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.slamMarker = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.0, 28), this.slamMat)
    this.slamMarker.rotation.x = -Math.PI / 2 // lay flat on the ground
    this.slamMarker.position.set(0, 0.05, config.boss.z)
    this.slamMarker.visible = false
    scene.add(this.slamMarker)

    scene.add(this.group)
  }

  get hpFraction() {
    return Math.max(0, this.hp) / this.maxHp
  }

  // Army-scaled boss HP (redesign #1). Game calls this at RUN→BOSS with hp = base + k·armyAtEntry,
  // so a bigger army faces a proportionally bigger boss and the fight lasts a ~constant time.
  setHp(hp) {
    this.maxHp = Math.max(1, hp)
    this.hp = this.maxHp
    this._hpShown = -1 // force the tag to redraw on the next update
    // Reset the cast clock so every fight replays from cast 0 (AC1/AC2). This runs at every
    // RUN→BOSS, always before the first BOSS-branch tick, so _pendingSlam/_shieldLeft can never
    // carry across fights (design §6.3 reset-convergence).
    this._castIndex = 0
    this._fireTimer = 0
    this._shieldLeft = 0
    this._shieldMult = 1
    this._pendingSlam = null
    this.slamMarker.visible = false
    this.slamMat.opacity = 0
    this.shieldMat.opacity = 0
  }

  // `firepower` already folds in count, dmgMult and rapid-fire (computed by Game). Drains the boss
  // (shield-taxed), advances the seeded cast clock, fires into the supplied boss-bullet pool aimed
  // at (armyX, armyZ), and keeps Boss decoupled from Audio/Effects (Game reacts to the events).
  // Returns an array of GAMEPLAY EVENTS that happened this frame (Game consumes them):
  //   { kind:'bullets' }                          — a bullet pattern fired (Game: SFX + flash)
  //   { kind:'slam-begin', xc, halfW }            — a slam started winding up
  //   { kind:'slam', xc, halfW, slamKill }        — a slam DETONATED (Game: drain if leader in band)
  //   { kind:'adds', count, hp, march }           — summon a wave (Game/Track spawn Enemy adds)
  //   { kind:'shield' }                           — boss shield window opened
  // Cadence advances EVERY frame (castCadence); the skill is DRAWN only on a fire frame
  // (bossCast, _castIndex++), so _castIndex stays in lockstep with the verifier (AC2).
  update(dt, firepower, armyX, armyZ, bossBullets, frenzyMult = 1) {
    // Shield window taxes incoming damage (×shieldMult) for both clean + undodged play (a pure
    // TIME tax — single source with the verifier via skillTuning).
    if (this._shieldLeft > 0) this._shieldLeft = Math.max(0, this._shieldLeft - dt)
    this.hp -= firepower * dt * (this._shieldLeft > 0 ? this._shieldMult : 1)
    this._t += dt

    const events = []

    // Pending slam wind-up: tick down; detonate (emit the drain event) when it elapses.
    if (this._pendingSlam) {
      this._pendingSlam.left -= dt
      if (this._pendingSlam.left <= 0) {
        const s = this._pendingSlam
        events.push({ kind: 'slam', xc: s.xc, halfW: s.halfW, slamKill: s.slamKill })
        this._pendingSlam = null
        this._flash = 0.18 // detonate flash
      }
    }

    // Cadence (enrage <33% HP fires faster; frenzy shortens) — single source with the verifier.
    const { enraged, interval } = castCadence(this, this.hpFraction, frenzyMult)
    this._enraged = enraged
    if (this.hp > 0) {
      this._fireTimer += dt
      // wind-up charge over the last WINDUP seconds before the shot
      this._charge = THREE.MathUtils.clamp(1 - (interval - this._fireTimer) / WINDUP, 0, 1)
      if (this._fireTimer >= interval) {
        this._fireTimer -= interval
        const cast = bossCast(this, this.hpFraction, this._castIndex++, frenzyMult)
        this._dispatchCast(cast, armyX, armyZ, bossBullets, events)
        this._charge = 0
        this._recoil = 1
      }
    } else {
      this._charge = 0
    }

    // ── damage states (continuous scorch + 2 persistent thresholds) ──
    const frac = this.hpFraction
    const dmg = 1 - frac
    const stage = frac < 0.33 ? 2 : frac < 0.66 ? 1 : 0

    // body colour: base → charred by damage, then → flash red while the muzzle flash decays
    this.bodyMat.color.copy(this._baseColor).lerp(_charred, dmg * 0.5)
    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt)
      this.bodyMat.color.lerp(_flashColor, this._flash / 0.18)
    }
    this.bodyMat.emissiveIntensity = dmg * 0.4 // ember glow through cracks

    // wind-up cosmetics: eyes + core brighten, boss rears back; recoil kick after a shot.
    // Enrage (<33% HP) recolors the telegraph to a hotter hue + brighter glow (cosmetic only).
    const rage = this._enraged ? 1 : 0
    this.eyeMat.color.setHex(this._enraged ? _eyeRage : _eyeCalm)
    this.eyeMat.emissive.setHex(this._enraged ? _eyeRage : _eyeCalm)
    this.coreMat.emissive.setHex(this._enraged ? _coreRage : _coreCalm)
    this.eyeMat.emissiveIntensity = 1.2 + this._charge * 2.2 + this._flash + rage * 1.4
    this.coreMat.emissiveIntensity = this._charge * 3.2 + rage * 1.1
    this.core.scale.setScalar((0.5 + this._charge * 0.9) * (1 + rage * 0.25))
    if (this._recoil > 0) this._recoil = Math.max(0, this._recoil - dt / RECOIL_TIME)
    const slump = stage === 2 ? 0.07 : 0
    this.group.rotation.x = slump - this._charge * 0.1 + this._recoil * 0.09

    // smoke: fade in at thresholds, drift up and loop (persistent once damaged)
    const smokeOpacity = stage === 2 ? 0.5 : stage === 1 ? 0.26 : 0
    for (const p of this.smoke) {
      const f = (this._t * 0.5 + p.phase) % 1
      p.mesh.position.set(p.ox, p.oy + f * 1.6, p.oz)
      p.mesh.scale.setScalar(0.5 + f * 1.1)
      p.mat.opacity = smokeOpacity * Math.sin(f * Math.PI)
    }

    const shown = Math.max(0, Math.ceil(this.hp))
    if (shown !== this._hpShown) {
      updateTextSprite(this.tag, formatCount(shown))
      this._hpShown = shown
    }

    // ── skill cosmetics ──
    // shield bubble pulses while the shield window is up
    this.shieldMat.opacity = this._shieldLeft > 0 ? 0.18 + 0.1 * Math.sin(this._t * 9) : 0
    this.shieldBubble.visible = this._shieldLeft > 0
    // slam marker: grow + redden over the wind-up, brightest at detonate
    if (this._pendingSlam) {
      const s = this._pendingSlam
      const p = 1 - THREE.MathUtils.clamp(s.left / (this.skillTuning.slamTelegraph ?? 0.6), 0, 1) // 0→1
      this.slamMarker.visible = true
      this.slamMarker.position.x = s.xc
      this.slamMarker.scale.setScalar(s.halfW * (0.5 + 0.8 * p))
      this.slamMat.opacity = 0.25 + 0.55 * p
    } else if (this.slamMarker.visible) {
      // fade out the spent marker for a couple frames after detonate
      this.slamMat.opacity = Math.max(0, this.slamMat.opacity - dt * 3)
      if (this.slamMat.opacity <= 0) this.slamMarker.visible = false
    }

    return events
  }

  // Route a drawn cast to its pattern/telegraph and append the matching gameplay event.
  _dispatchCast(cast, armyX, armyZ, bossBullets, events) {
    if (cast.kind === 'bullets') {
      if (cast.type === 'wall') this._fireWall(cast, armyX, armyZ, bossBullets)
      else if (cast.type === 'arc') this._fireArc(cast, armyX, armyZ, bossBullets)
      else if (cast.type === 'ring') this._fireRing(cast, armyX, armyZ, bossBullets)
      else this._fireFan(cast, armyX, armyZ, bossBullets)
      events.push({ kind: 'bullets' })
    } else if (cast.kind === 'slam') {
      // AIMED at the army's x-at-cast (tracks the player, no clamp — Decision 5).
      this._pendingSlam = { xc: armyX, halfW: cast.halfW, slamKill: cast.slamKill, left: cast.telegraph }
      events.push({ kind: 'slam-begin', xc: armyX, halfW: cast.halfW })
    } else if (cast.kind === 'adds') {
      events.push({ kind: 'adds', count: cast.addCount, hp: cast.addHp, march: cast.addMarch })
    } else if (cast.kind === 'shield') {
      this._shieldLeft = cast.shieldDuration // refresh, non-stacking
      this._shieldMult = cast.shieldMult
      events.push({ kind: 'shield' })
    }
  }

  // The slam marker lives in scene space (not the boss group), so Track.dispose can't free it via
  // the group walk — release it here.
  dispose() {
    if (this.slamMarker) {
      this.scene.remove(this.slamMarker)
      this.slamMarker.geometry?.dispose?.()
      this.slamMat?.dispose?.()
    }
  }

  // ── death sequence (cosmetic — design 6.5) ──
  // Scale punch → topple → sink + white flash; Game drives updateDeath() during WIN_SEQUENCE.
  // Gameplay (hp<=0) was already decided by Game's win check.
  playDeath() {
    this._dying = BOSS_DEATH_TIME
    this._charge = 0
    this.coreMat.emissiveIntensity = 0
    this.group.rotation.x = 0
    this.tag.visible = false
  }

  updateDeath(dt) {
    if (this._dying <= 0) return
    this._dying = Math.max(0, this._dying - dt)
    const p = 1 - this._dying / BOSS_DEATH_TIME // 0 → 1 progress
    // scale: quick punch up over the first 20%, then collapse toward 0
    const s = p < 0.2 ? 1 + (p / 0.2) * 0.4 : 1.4 * (1 - (p - 0.2) / 0.8)
    this.group.scale.setScalar(Math.max(0, s))
    // topple over (rotate about the base) once the punch peaks
    const topple = p < 0.2 ? 0 : (p - 0.2) / 0.8
    this.group.rotation.z = topple * 1.4
    // white flash, strongest at the start, fading as it collapses
    this.bodyMat.color.copy(this._baseColor).lerp(_white, 1 - p)
    if (this._dying <= 0) this.group.visible = false
  }

  // ── bullet patterns (2026-06-12-boss-seeded-skills §6.3) ──────────────────────────────────────
  // INVARIANT for every pattern: spawn EXACTLY cast.hitCount HARMFUL orbs aimed within CORE_SPREAD
  // (< HIT_RADIUS) of armyX-at-cast, so a stationary centred army eats ALL of them (realized drain
  // == cast.undodgedKill EXACTLY — the verifier reads the same number) and a lateral dodge makes
  // them miss (aimed at the stale x). Any extra silhouette orbs are COSMETIC-ONLY: spawned with a
  // SHORT life so they fizzle ~7-9 units out, well before the army's z-line (~18 units away), so
  // generic collision never charges them for ANY on-road army. Game._resolveBossBullets is UNCHANGED.

  // Aim one orb at (targetX, ty, targetZ), speed-preserving. `life` controls reach (full = harmful,
  // short = cosmetic fizzle).
  _spawnOrb(ox, oy, oz, targetX, targetZ, bossBullets, life) {
    const ty = 0.6
    const dx = targetX - ox
    const dy = ty - oy
    const dz = targetZ - oz
    const dist = Math.hypot(dx, dy, dz) || 1
    const s = this.bulletSpeed / dist
    bossBullets.spawn(ox, oy, oz, dx * s, dy * s, dz * s, life)
  }

  _harmfulLife(armyX, armyZ) {
    const dist = Math.hypot(armyX, 0.6 - 1.9, armyZ - (this.z - 1.4)) || 1
    return dist / this.bulletSpeed + 0.4
  }

  // Today's aimed FAN — fixed muzzle origin + yaw-fan within FAN_ANGLE (unchanged geometry, AC: the
  // fan path that HIT_RADIUS reasoning depends on is preserved). All hitCount orbs are harmful.
  _fireFan(cast, armyX, armyZ, bossBullets) {
    if (!bossBullets) return
    this._flash = 0.18
    const ox = 0
    const oy = 1.9
    const oz = this.z - 1.4
    const dy = 0.6 - oy
    const dz = armyZ - oz
    const dist = Math.hypot(armyX - ox, dy, dz) || 1
    const s = this.bulletSpeed / dist
    const life = dist / this.bulletSpeed + 0.4
    const horiz = Math.hypot(armyX - ox, dz) || 1
    const baseYaw = Math.atan2(armyX - ox, dz)
    const n = Math.max(1, cast.hitCount | 0)
    for (let i = 0; i < n; i++) {
      const off = n > 1 ? (i / (n - 1) - 0.5) * FAN_ANGLE : 0
      const yaw = baseYaw + off
      bossBullets.spawn(ox, oy, oz, Math.sin(yaw) * horiz * s, dy * s, Math.cos(yaw) * horiz * s, life)
    }
  }

  // hitCount harmful orbs clustered within CORE_SPREAD of armyX + `cosmeticX[]` short-life decoy
  // orbs (capped so total ≤ PATTERN_MAX). `ox` lets a pattern choose its muzzle origin.
  _fireBulletPattern(cast, armyX, armyZ, bossBullets, ox, cosmeticX) {
    if (!bossBullets) return
    this._flash = 0.18
    const oy = 1.9
    const oz = this.z - 1.4
    const life = this._harmfulLife(armyX, armyZ)
    const n = Math.max(1, cast.hitCount | 0)
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? (i / (n - 1) - 0.5) * 2 : 0 // −1..1
      this._spawnOrb(ox, oy, oz, armyX + t * CORE_SPREAD, armyZ, bossBullets, life)
    }
    const budget = Math.min(cosmeticX.length, PATTERN_MAX - n)
    for (let i = 0; i < budget; i++) {
      this._spawnOrb(ox, oy, oz, cosmeticX[i], armyZ, bossBullets, COSMETIC_LIFE)
    }
  }

  // WALL — cosmetic decoys spread across the road leaving a visible gap around armyX so it reads as
  // a wall-with-gap (the deadly part still tracks armyX; the gap is purely visual flavour).
  _fireWall(cast, armyX, armyZ, bossBullets) {
    const cos = []
    for (let x = -3; x <= 3; x += 1) if (Math.abs(x - armyX) > 1.2) cos.push(x)
    this._fireBulletPattern(cast, armyX, armyZ, bossBullets, 0, cos)
  }

  // ARC — cosmetic decoys sweep across the road at staggered offsets (a moving-wall feel).
  _fireArc(cast, armyX, armyZ, bossBullets) {
    const dir = cast.rng && cast.rng() < 0.5 ? -1 : 1
    const cos = [dir * 1.8, dir * 2.6, -dir * 1.0, dir * 3.0]
    this._fireBulletPattern(cast, armyX, armyZ, bossBullets, 0, cos)
  }

  // RING — cosmetic decoys radiate to both sides (a radial burst); core still aimed at the army.
  _fireRing(cast, armyX, armyZ, bossBullets) {
    const cos = [-3, -2, -1, 1, 2, 3]
    this._fireBulletPattern(cast, armyX, armyZ, bossBullets, 0, cos)
  }
}

// Harmful-orb |targetX − armyX| ceiling (< HIT_RADIUS ≈ 1.56 ⇒ a centred army eats every core orb).
const CORE_SPREAD = 1.0
// Cosmetic orbs fizzle ~7-9 units out (well before the army's ~18-unit z-line) → harmless to any
// on-road army regardless of their aim (2026-06-12-boss-seeded-skills §6.3).
const COSMETIC_LIFE = 0.3
