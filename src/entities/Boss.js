import * as THREE from 'three'
import { makeTextSprite, updateTextSprite } from '../util/text.js'

// End-of-stage boss (design 6.6). The army's firepower (count × perSoldierDPS ×
// dmgMult × rapid, computed in Game) drains the boss each frame. The boss no longer
// drains the crowd at a fixed rate — its only threat is telegraphed projectiles it
// fires at the army on a cadence (aimed at the army's current x, so steering dodges
// them). Game owns the boss-bullet pool and the collision test; Boss just requests a
// shot via bossBullets.spawn() and flashes a muzzle telegraph.

const _flashColor = new THREE.Color(0xfca5a5)
const _white = new THREE.Color(0xffffff)

// Cosmetic boss-death hold (design 6.5). Game freezes into WIN_SEQUENCE for this long
// while the multi-stage burst + heavy shake play, then advances / shows the win screen.
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
    this._dying = 0 // > 0 while the death sequence plays (design 6.5)

    this.group = new THREE.Group()
    this.group.position.set(0, 0, config.boss.z)

    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.55 })
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 2.4, 6, 14), this.bodyMat)
    body.position.y = 2.1
    this.group.add(body)
    this._baseColor = this.bodyMat.color.clone()

    const eyeGeo = new THREE.SphereGeometry(0.22, 10, 10)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111827 })
    for (const sx of [-0.45, 0.45]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(sx, 3.1, -1.15)
      this.group.add(eye)
    }
    // gun barrel pointing toward the player (−Z)
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 1.6, 12),
      new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.5 })
    )
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 1.9, -1.4)
    this.group.add(barrel)

    this.tag = makeTextSprite(String(this.hp), {
      scale: 2.2,
      accent: '#ef4444',
      bg: 'rgba(17,24,39,0.95)',
    })
    this.tag.position.set(0, 4.7, 0)
    this.group.add(this.tag)

    scene.add(this.group)
  }

  get hpFraction() {
    return Math.max(0, this.hp) / this.maxHp
  }

  // `firepower` already folds in count, dmgMult and rapid-fire (computed by Game).
  // Fires into the supplied boss-bullet pool, aimed at (armyX, armyZ).
  // Returns true on the frame it fires a telegraphed shot (a pure signal so Game can play
  // the boss-shot SFX without coupling Boss to the AudioManager — design Decision 4).
  update(dt, firepower, armyX, armyZ, bossBullets) {
    this.hp -= firepower * dt

    let fired = false
    if (this.hp > 0) {
      this._fireTimer += dt
      if (this._fireTimer >= this.fireInterval) {
        this._fireTimer -= this.fireInterval
        this._fire(armyX, armyZ, bossBullets)
        fired = true
      }
    }

    // muzzle-flash telegraph decay
    if (this._flash > 0) {
      this._flash = Math.max(0, this._flash - dt)
      this.bodyMat.color.copy(this._baseColor).lerp(_flashColor, this._flash / 0.18)
    }

    const shown = Math.max(0, Math.ceil(this.hp))
    if (shown !== this._hpShown) {
      updateTextSprite(this.tag, shown)
      this._hpShown = shown
    }

    return fired
  }

  // ── death sequence (cosmetic — design 6.5) ──
  // Begins a brief flash + scale-punch-then-collapse; Game drives updateDeath() during the
  // WIN_SEQUENCE hold. Gameplay (hp<=0) was already decided by Game's win check.
  playDeath() {
    this._dying = BOSS_DEATH_TIME
    this.tag.visible = false
  }

  updateDeath(dt) {
    if (this._dying <= 0) return
    this._dying = Math.max(0, this._dying - dt)
    const p = 1 - this._dying / BOSS_DEATH_TIME // 0 → 1 progress
    // scale: quick punch up over the first 20%, then collapse toward 0
    const s = p < 0.2 ? 1 + (p / 0.2) * 0.4 : 1.4 * (1 - (p - 0.2) / 0.8)
    this.group.scale.setScalar(Math.max(0, s))
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
