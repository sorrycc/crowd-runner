import * as THREE from 'three'
import { makeTextSprite, updateTextSprite } from '../util/text.js'

// A destructible road block (design 6.4). `hp` is a float that drains under fire
// while the army is *engaged* (leaderX ∈ xRange). The HP sprite ticks down live
// (shown as ceil(hp)) and the block tints from green→red and crumbles at 0. If the
// army reaches it with hp left, the leftover drains min(count, ceil(hp)) soldiers on
// contact (1 per remaining HP), unless a Shield is active. `fullWidth` blocks span
// the road and cannot be dodged; dodgeable blocks have a sub-range you steer around
// (and are then never engaged → never shot, never contacted).

const TIRE_R = 0.45
const TIRE_H = 0.32
const FULL = new THREE.Color(0x22c55e)
const LOW = new THREE.Color(0xef4444)

export class Obstacle {
  constructor(scene, spec) {
    this.z = spec.z
    this.hp = spec.hp
    this.maxHp = spec.hp
    this.xRange = spec.xRange
    this.fullWidth = !!spec.fullWidth
    this.broken = false
    this._hpShown = -1

    this.group = new THREE.Group()
    this.group.position.z = spec.z

    const [x0, x1] = spec.xRange
    const width = x1 - x0
    const cols = Math.max(1, Math.round(width / 0.95))
    const step = width / cols
    this.mat = new THREE.MeshStandardMaterial({ color: FULL.clone(), roughness: 0.85 })
    const tireGeo = new THREE.CylinderGeometry(TIRE_R, TIRE_R, TIRE_H, 16)

    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * step
      for (let k = 0; k < 3; k++) {
        const tire = new THREE.Mesh(tireGeo, this.mat)
        tire.position.set(x, 0.2 + k * TIRE_H, 0)
        this.group.add(tire)
      }
    }

    this.tag = makeTextSprite(String(Math.ceil(this.hp)), {
      scale: 1.5,
      accent: '#ffffff',
      bg: 'rgba(17,24,39,0.95)',
    })
    this.tag.position.set((x0 + x1) / 2, 1.55, 0)
    this.group.add(this.tag)

    scene.add(this.group)
    this._refresh()
  }

  inRange(x) {
    return x >= this.xRange[0] && x <= this.xRange[1]
  }

  _refresh() {
    const frac = Math.max(0, this.hp) / this.maxHp
    this.mat.color.copy(LOW).lerp(FULL, frac)
    const shown = Math.max(0, Math.ceil(this.hp))
    if (shown !== this._hpShown) {
      updateTextSprite(this.tag, shown)
      this._hpShown = shown
    }
  }

  // Continuous ranged damage while engaged (called each frame from Game).
  damage(amount) {
    if (this.broken) return
    this.hp -= amount
    if (this.hp <= 0) {
      this.hp = 0
      this._break()
    } else {
      this._refresh()
    }
  }

  // Reached with hp left → drain leftover (ceil) unless shielded. Returns soldiers lost.
  contact(crowd, shielded) {
    if (this.broken) return 0
    const drained = shielded ? 0 : Math.min(crowd.count, Math.ceil(this.hp))
    if (drained > 0) crowd.sub(drained)
    this.hp = 0
    this._break()
    return drained
  }

  _break() {
    this.broken = true
    this.group.visible = false
  }
}
