import * as THREE from 'three'

// Pooled particle bursts (design 6.1) — a faithful sibling of BulletPool. One
// InstancedMesh of small boxes (primitives only), flat Float32Array state, a rotating
// free-slot cursor, scale-0 when inactive. Extends BulletPool in exactly two ways the
// effects need: gravity on the velocity, and a PER-INSTANCE colour (so a green gain puff
// and red death shards read distinctly).
//
// Material is MeshBasicMaterial (UNLIT) so the final colour is material.color ×
// instanceColor with no lighting/emissive dependency — an emissive material would tint
// every particle the same hue regardless of instanceColor. clear() empties the pool on
// restart / stage advance (mirrors BulletPool).

const _dummy = new THREE.Object3D()
const _color = new THREE.Color()
const _zero = new THREE.Vector3(0, 0, 0)

export class ParticlePool {
  constructor(scene, { cap = 300, size = 0.16, gravity = 9 } = {}) {
    this.cap = cap
    this.gravity = gravity

    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      cap
    )
    // per-instance colour buffer (BulletPool never needs this; particles do)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3)
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
    this.maxLife = new Float32Array(cap)
    this.size = new Float32Array(cap)
    this._next = 0

    this.clear()
  }

  _spawn(x, y, z, vx, vy, vz, life, size, r, g, b) {
    let slot = -1
    for (let n = 0; n < this.cap; n++) {
      const i = (this._next + n) % this.cap
      if (!this.active[i]) {
        slot = i
        this._next = (i + 1) % this.cap
        break
      }
    }
    if (slot < 0) return // pool full — drop (cosmetic loss only)
    this.active[slot] = true
    this.px[slot] = x
    this.py[slot] = y
    this.pz[slot] = z
    this.vx[slot] = vx
    this.vy[slot] = vy
    this.vz[slot] = vz
    this.life[slot] = life
    this.maxLife[slot] = life
    this.size[slot] = size
    this.mesh.setColorAt(slot, _color.setRGB(r, g, b))
  }

  // Emit `count` particles from (x,y,z) in a randomized cone biased upward by `up`.
  burst(x, y, z, opts = {}) {
    const {
      count = 14,
      color = 0xffffff,
      speed = 6,
      up = 0.6,
      size = 0.16,
      life = 0.5,
      sizeJitter = 0.5,
    } = opts
    _color.set(color)
    const r = _color.r
    const g = _color.g
    const b = _color.b
    for (let k = 0; k < count; k++) {
      // random direction on a hemisphere-ish cone, biased up
      const dx = Math.random() * 2 - 1
      const dz = Math.random() * 2 - 1
      const dy = Math.random() * (1 + up) - (1 - up) // skew positive
      const len = Math.hypot(dx, dy, dz) || 1
      const s = (speed * (0.5 + Math.random() * 0.5)) / len
      const sz = size * (1 - sizeJitter + Math.random() * sizeJitter * 2)
      this._spawn(x, y, z, dx * s, dy * s + up * 1.5, dz * s, life * (0.7 + Math.random() * 0.6), sz, r, g, b)
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      if (this.active[i]) {
        this.vy[i] -= this.gravity * dt
        this.px[i] += this.vx[i] * dt
        this.py[i] += this.vy[i] * dt
        this.pz[i] += this.vz[i] * dt
        this.life[i] -= dt
        if (this.life[i] <= 0) this.active[i] = false
      }
      if (this.active[i]) {
        const s = this.size[i] * Math.max(0, this.life[i] / this.maxLife[i])
        _dummy.position.set(this.px[i], this.py[i], this.pz[i])
        _dummy.scale.set(s, s, s)
      } else {
        _dummy.position.copy(_zero)
        _dummy.scale.set(0, 0, 0)
      }
      _dummy.updateMatrix()
      this.mesh.setMatrixAt(i, _dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  // Reset active flags + zero matrices (scale-0 hides any stale instanceColor — no need
  // to wipe the colour buffer).
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
