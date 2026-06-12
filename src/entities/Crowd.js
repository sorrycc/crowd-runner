import * as THREE from 'three'
import { makeTextSprite, updateTextSprite } from '../util/text.js'

// The crowd (design 6.3). `count` is the integer source of truth in [0, cap].
// The leader is a separate orange capsule; followers (= count-1) are one
// InstancedMesh (one draw call) packed in a centred rectangular block behind the
// leader, lerping toward their slots and re-packing as the count changes.
//
// Count mutations: gates use integer add/mul/sub; the boss drain uses the
// fractional accumulator removeContinuous() so sub-1-per-frame removal still bites.

const COLS = 9
const SPACING = 0.34
const MARGIN = 0.45 // keep members this far inside the rail
const FOLLOWER_Y = 0.5
const LEADER_Y = 0.62
const LERP_K = 8

export class Crowd {
  constructor(scene, config) {
    this.cap = config.crowdCap
    this.limit = config.roadHalf - MARGIN
    this.count = 0
    this._removalDebt = 0
    this._plateText = -1
    this._bob = 0

    // leader
    this.leader = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.62, 4, 10),
      new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6 })
    )
    scene.add(this.leader)

    // followers (instanced)
    this.mesh = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.22, 0.5, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.6 }),
      this.cap
    )
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    scene.add(this.mesh)

    // per-instance lerped positions + "has spawned" flags
    this.cur = Array.from({ length: this.cap }, () => new THREE.Vector3())
    this.init = new Array(this.cap).fill(false)
    this._dummy = new THREE.Object3D()

    // floating count plate (hidden until the run starts)
    this.plate = makeTextSprite('0', { scale: 2.4, accent: '#22c55e' })
    this.plate.visible = false
    scene.add(this.plate)
  }

  // ── count mutations ──
  setCount(n) {
    this.count = Math.max(0, Math.min(this.cap, Math.round(n)))
    this._removalDebt = 0
  }
  add(n) {
    this.count = Math.min(this.cap, this.count + n)
  }
  mul(n) {
    this.count = Math.min(this.cap, Math.round(this.count * n))
  }
  sub(n) {
    this.count = Math.max(0, this.count - n)
  }
  removeContinuous(amount) {
    this._removalDebt += amount
    const whole = Math.floor(this._removalDebt)
    if (whole > 0) {
      this._removalDebt -= whole
      this.sub(whole)
    }
  }

  reset(count) {
    this.setCount(count)
    this.init.fill(false)
    this._bob = 0
    this._plateText = -1
  }

  update(dt, leaderX, leaderZ) {
    // leader (with a little run bob)
    this._bob += dt
    this.leader.position.set(leaderX, LEADER_Y + Math.sin(this._bob * 12) * 0.05, leaderZ)
    this.leader.visible = this.count > 0

    const followers = Math.max(0, this.count - 1)
    const maxX = this.limit
    const a = 1 - Math.exp(-LERP_K * dt)

    for (let i = 0; i < followers; i++) {
      const col = i % COLS
      const row = (i / COLS) | 0
      let tx = leaderX + (col - (COLS - 1) / 2) * SPACING
      if (tx > maxX) tx = maxX
      else if (tx < -maxX) tx = -maxX
      const tz = leaderZ - (row + 1) * SPACING - 0.45

      const p = this.cur[i]
      if (!this.init[i]) {
        p.set(leaderX, FOLLOWER_Y, leaderZ) // spawn from the leader (pop)
        this.init[i] = true
      }
      p.x += (tx - p.x) * a
      p.z += (tz - p.z) * a
      // post-lerp clamp: a lagging member can never render off-road (AC4)
      if (p.x > maxX) p.x = maxX
      else if (p.x < -maxX) p.x = -maxX

      this._dummy.position.set(p.x, FOLLOWER_Y, p.z)
      this._dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this._dummy.matrix)
    }
    // de-activated slots respawn at the leader if regained later
    for (let i = followers; i < this.cap; i++) this.init[i] = false
    this.mesh.count = followers
    this.mesh.instanceMatrix.needsUpdate = true

    // count plate floats above the leader; texture only redrawn when count changes
    this.plate.position.set(leaderX, 2.3, leaderZ - 0.2)
    this.plate.visible = this.count > 0
    if (this._plateText !== this.count) {
      updateTextSprite(this.plate, this.count)
      this._plateText = this.count
    }
  }
}
