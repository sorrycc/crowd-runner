import * as THREE from 'three'

// Pooled projectiles (design 6.2). One InstancedMesh of Z-stretched boxes (bullets
// always travel along ±Z, so no per-bullet rotation is needed). Used for both the
// army's cosmetic tracers and the boss's harmful orbs — same pool class, different
// instances. Slots are recycled; inactive slots render at scale 0.
//
// Player bullets are visual-only (damage is the continuous DPS formula in Game).
// Boss bullets are gameplay: Game iterates active ones via forEachActive() to test
// the hit against the army point. clear() empties the pool on restart / stage advance.

const _dummy = new THREE.Object3D()
const _zero = new THREE.Vector3(0, 0, 0)

export class BulletPool {
  constructor(scene, { cap = 120, color = 0xfde047, radius = 0.07, length = 0.55 } = {}) {
    this.cap = cap
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(radius * 2, radius * 2, length),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 }),
      cap
    )
    this.mesh.frustumCulled = false
    this.mesh.count = cap
    scene.add(this.mesh)

    // flat per-slot state (no allocation in the hot path)
    this.active = new Array(cap).fill(false)
    this.px = new Float32Array(cap)
    this.py = new Float32Array(cap)
    this.pz = new Float32Array(cap)
    this.vx = new Float32Array(cap)
    this.vy = new Float32Array(cap)
    this.vz = new Float32Array(cap)
    this.life = new Float32Array(cap)
    this._next = 0

    this.clear()
  }

  spawn(x, y, z, vx, vy, vz, life) {
    // find a free slot starting from a rotating cursor (cheap, bounded scan)
    let slot = -1
    for (let n = 0; n < this.cap; n++) {
      const i = (this._next + n) % this.cap
      if (!this.active[i]) {
        slot = i
        this._next = (i + 1) % this.cap
        break
      }
    }
    if (slot < 0) return // pool full — drop (cap is generous; cosmetic loss only)
    this.active[slot] = true
    this.px[slot] = x
    this.py[slot] = y
    this.pz[slot] = z
    this.vx[slot] = vx
    this.vy[slot] = vy
    this.vz[slot] = vz
    this.life[slot] = life
  }

  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      if (this.active[i]) {
        this.px[i] += this.vx[i] * dt
        this.py[i] += this.vy[i] * dt
        this.pz[i] += this.vz[i] * dt
        this.life[i] -= dt
        if (this.life[i] <= 0) this.active[i] = false
      }
      if (this.active[i]) {
        _dummy.position.set(this.px[i], this.py[i], this.pz[i])
        _dummy.scale.set(1, 1, 1)
      } else {
        _dummy.position.copy(_zero)
        _dummy.scale.set(0, 0, 0)
      }
      _dummy.updateMatrix()
      this.mesh.setMatrixAt(i, _dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  // Visit each active bullet (used by Game for boss-bullet collision).
  forEachActive(cb) {
    for (let i = 0; i < this.cap; i++) {
      if (this.active[i]) cb(i, this.px[i], this.py[i], this.pz[i])
    }
  }

  deactivate(i) {
    this.active[i] = false
  }

  clear() {
    this.active.fill(false)
    for (let i = 0; i < this.cap; i++) {
      _dummy.position.copy(_zero)
      _dummy.scale.set(0, 0, 0)
      _dummy.updateMatrix()
      this.mesh.setMatrixAt(i, _dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
