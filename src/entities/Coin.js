import * as THREE from 'three'

// A collectible coin (design 6.4). Cosmetic — collecting it just increments the
// HUD coin counter. Spins for shimmer; hides on collect.

export class Coin {
  constructor(scene, spec) {
    this.z = spec.z
    this.x = spec.x
    this.collected = false

    this.mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.07, 18),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.5, roughness: 0.35 })
    )
    this.mesh.rotation.x = Math.PI / 2 // face the player
    this.mesh.position.set(spec.x, 0.9, spec.z)
    scene.add(this.mesh)
  }

  update(dt) {
    if (!this.collected) this.mesh.rotation.y += dt * 3.2
  }

  collect() {
    this.collected = true
    this.mesh.visible = false
  }
}
