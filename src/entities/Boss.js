import * as THREE from 'three'
import { makeTextSprite, updateTextSprite } from '../util/text.js'

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

// Cosmetic boss-death hold (design 6.5). Game freezes into WIN_SEQUENCE for this long while
// the multi-stage burst + heavy shake + collapse play, then advances / shows the win screen.
export const BOSS_DEATH_TIME = 1.1

export class Boss {
  constructor(scene, config) {
    this.z = config.boss.z
    this.maxHp = config.boss.hp
    this.hp = config.boss.hp
    this.fireInterval = config.boss.fireInterval ?? 1.6
    this.burst = config.boss.burst ?? 6
    this.bulletSpeed = config.boss.bulletSpeed ?? 20
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

    this.tag = makeTextSprite(String(this.hp), {
      scale: 2.2,
      accent: '#ef4444',
      bg: 'rgba(17,24,39,0.95)',
    })
    this.tag.position.set(0, 6.0, 0)
    this.group.add(this.tag)

    scene.add(this.group)
  }

  get hpFraction() {
    return Math.max(0, this.hp) / this.maxHp
  }

  // `firepower` already folds in count, dmgMult and rapid-fire (computed by Game). Fires into
  // the supplied boss-bullet pool, aimed at (armyX, armyZ). Returns true on the frame it fires
  // (a pure signal so Game plays the boss-shot SFX + muzzle flash without coupling Boss to the
  // AudioManager / Effects — design Decision 4).
  update(dt, firepower, armyX, armyZ, bossBullets) {
    this.hp -= firepower * dt
    this._t += dt

    let fired = false
    if (this.hp > 0) {
      this._fireTimer += dt
      // wind-up charge over the last WINDUP seconds before the shot
      this._charge = THREE.MathUtils.clamp(1 - (this.fireInterval - this._fireTimer) / WINDUP, 0, 1)
      if (this._fireTimer >= this.fireInterval) {
        this._fireTimer -= this.fireInterval
        this._fire(armyX, armyZ, bossBullets)
        fired = true
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

    // wind-up cosmetics: eyes + core brighten, boss rears back; recoil kick after a shot
    this.eyeMat.emissiveIntensity = 1.2 + this._charge * 2.2 + this._flash
    this.coreMat.emissiveIntensity = this._charge * 3.2
    this.core.scale.setScalar(0.5 + this._charge * 0.9)
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
      updateTextSprite(this.tag, shown)
      this._hpShown = shown
    }

    return fired
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

  _fire(armyX, armyZ, bossBullets) {
    if (!bossBullets) return
    this._flash = 0.18
    const ox = 0
    const oy = 1.9
    const oz = this.z - 1.4
    const tx = armyX
    const ty = 0.6
    const tz = armyZ
    const dx = tx - ox
    const dy = ty - oy
    const dz = tz - oz
    const dist = Math.hypot(dx, dy, dz) || 1
    const s = this.bulletSpeed / dist
    const life = dist / this.bulletSpeed + 0.4
    bossBullets.spawn(ox, oy, oz, dx * s, dy * s, dz * s, life)
  }
}
