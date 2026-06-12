import * as THREE from 'three'
import { makeTextSprite } from '../util/text.js'

// An HP "tire stack" barrier across an x-range (design 6.4). Crossing it while the
// leader x is inside the range drains 1 member per 1 HP (strict). You can dodge by
// steering out of the range. A single crossing resolves it: it either breaks (crowd
// >= hp) or the crowd is wiped first (-> lose).

const TIRE_R = 0.45
const TIRE_H = 0.32

export class Obstacle {
  constructor(scene, spec) {
    this.z = spec.z
    this.hp = spec.hp
    this.xRange = spec.xRange
    this.broken = false

    this.group = new THREE.Group()
    this.group.position.z = spec.z

    const [x0, x1] = spec.xRange
    const width = x1 - x0
    const cols = Math.max(1, Math.round(width / 0.95))
    const step = width / cols
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.9 })
    const tireGeo = new THREE.CylinderGeometry(TIRE_R, TIRE_R, TIRE_H, 16)

    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * step
      for (let k = 0; k < 3; k++) {
        const tire = new THREE.Mesh(tireGeo, tireMat)
        tire.position.set(x, 0.2 + k * TIRE_H, 0)
        this.group.add(tire)
      }
    }

    this.tag = makeTextSprite(String(this.hp), {
      scale: 1.5,
      accent: '#22c55e',
      bg: 'rgba(17,24,39,0.95)',
    })
    this.tag.position.set((x0 + x1) / 2, 1.55, 0)
    this.group.add(this.tag)

    scene.add(this.group)
  }

  inRange(x) {
    return x >= this.xRange[0] && x <= this.xRange[1]
  }

  hit(crowd) {
    const drained = Math.min(crowd.count, this.hp)
    crowd.sub(drained)
    this.hp -= drained
    this.broken = true
    this.group.visible = false
  }
}
