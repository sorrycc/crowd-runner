import * as THREE from 'three'
import { makeTextSprite, updateTextSprite } from '../util/text.js'

// End-of-stage boss (design 6.4/6.8). During the BOSS phase the crowd auto-attacks:
// damage uses the PRE-removal crowd count so the killing blow still lands, then the
// boss removes members via the fractional accumulator. Win when hp<=0 (checked
// before lose, design 6.5).

export class Boss {
  constructor(scene, config) {
    this.z = config.boss.z
    this.maxHp = config.boss.hp
    this.hp = config.boss.hp
    this.perMemberDPS = config.combat.perMemberDPS
    this.removalRate = config.combat.bossRemovalRate
    this._hpShown = -1

    this.group = new THREE.Group()
    this.group.position.set(0, 0, config.boss.z)

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(1.3, 2.4, 6, 14),
      new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.55 })
    )
    body.position.y = 2.1
    this.group.add(body)

    // simple face
    const eyeGeo = new THREE.SphereGeometry(0.22, 10, 10)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111827 })
    for (const sx of [-0.45, 0.45]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(sx, 3.1, -1.15)
      this.group.add(eye)
    }

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

  update(dt, crowd) {
    // damage from the pre-removal crowd value (design 6.4)
    this.hp -= crowd.count * this.perMemberDPS * dt
    crowd.removeContinuous(this.removalRate * dt)

    const shown = Math.max(0, Math.ceil(this.hp))
    if (shown !== this._hpShown) {
      updateTextSprite(this.tag, shown)
      this._hpShown = shown
    }
  }
}
