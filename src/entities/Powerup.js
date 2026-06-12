import * as THREE from 'three'
import { makeTextSprite } from '../util/text.js'

// A power-up pickup (design 6.7) — replaces the old cosmetic Coin. Spec is
// { z, x, type } with type ∈ {rapid, reinforce, shield, damage}. Each type gets a
// distinct primitive + colour + letter so it reads at a glance. Collected by
// steering within PICK_RADIUS (handled in Game); the effect is applied there.

// Colors snapped to NES hues, kept distinct per type (Decision 10).
const TYPES = {
  rapid: { color: 0xf87800, letter: 'R', geo: () => new THREE.ConeGeometry(0.34, 0.7, 16) },
  reinforce: { color: 0x00a800, letter: '+', geo: () => new THREE.BoxGeometry(0.5, 0.5, 0.5) },
  shield: { color: 0x3cbcfc, letter: 'S', geo: () => new THREE.SphereGeometry(0.36, 16, 12) },
  damage: { color: 0xe52521, letter: 'D', geo: () => new THREE.OctahedronGeometry(0.42) },
}

export class Powerup {
  constructor(scene, spec) {
    this.z = spec.z
    this.x = spec.x
    this.type = spec.type
    this.collected = false

    const def = TYPES[spec.type] || TYPES.reinforce
    this.color = def.color // exposed so Game can tint the grab-pop in the power-up's colour
    this.group = new THREE.Group()
    this.group.position.set(spec.x, 0.95, spec.z)

    this.mesh = new THREE.Mesh(
      def.geo(),
      new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: def.color,
        emissiveIntensity: 0.35,
        roughness: 0.4,
        metalness: 0.2,
      })
    )
    this.group.add(this.mesh)

    const tag = makeTextSprite(def.letter, {
      scale: 0.9,
      border: '#' + def.color.toString(16).padStart(6, '0'), // hard border in the type's NES color
      color: '#FCFCFC',
    })
    tag.position.set(0, 1.0, 0)
    this.group.add(tag)

    scene.add(this.group)
  }

  update(dt) {
    if (!this.collected) {
      this.mesh.rotation.y += dt * 2.4
      this.mesh.rotation.x += dt * 1.1
    }
  }

  collect() {
    this.collected = true
    this.group.visible = false
  }
}
