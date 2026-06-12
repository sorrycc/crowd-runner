import * as THREE from 'three'
import { makeTextSprite, updateTextSprite, formatCount } from '../util/text.js'
import { makeSoldierMaterial, SOLDIER_ANIM } from '../util/soldier.js'

const LEADER_SCALE = 1.25 // baked-at-1.25 look is gone; applied via leader.scale now

// The army (redesign 2026-06-12-endless-procedural, design §6.4). The 200 cap is GONE: `count`
// is an UNBOUNDED integer (sanity-clamped only to config.crowdCap = MAX_COUNT). Rendering is a
// VISUAL cap: the follower InstancedMesh and every per-instance array are sized to VISUAL_CAP, and
// at most VISUAL_CAP followers ever draw. This is a deliberate VISUAL cap, NOT a truncation — the
// HUD/count plate keep showing the true logical count past the ceiling (tens of thousands of
// humanoids would tank FPS; a true unbounded GPU buffer is impossible).
//
// CRITICAL: VISUAL_CAP — never config.crowdCap (=1e12) — bounds every loop/array here. Using the
// 1e12 sanity clamp as a loop/array bound would allocate/iterate a trillion slots and freeze.

const COLS = 9
const SPACING = 0.34
const MARGIN = 0.45 // keep members this far inside the rail
const LERP_K = 8
const POP_DECAY = 9 // per-second multiplicative decay of the reinforce scale-pop
const VISUAL_CAP = 1500 // max follower instances rendered (the visual ceiling)

// Exported so Game derives the boss-bullet hit radius from the real formation
// half-width (DRY — design 6.2). (COLS-1)/2 * SPACING.
export const FORMATION_HALF_WIDTH = ((COLS - 1) / 2) * SPACING

export class Crowd {
  // `soldierGeo` is the ONE shared, merged humanoid geometry (from models.js); the leader,
  // the followers, and every enemy squad reference the same instance — one draw call each.
  // The march/run motion is a GPU limb swing in the soldier material (per-instance phase via
  // gl_InstanceID); no per-frame CPU animation beyond the existing position lerp.
  constructor(scene, config, soldierGeo) {
    this.cap = config.crowdCap // sanity clamp only (= MAX_COUNT); NEVER a loop/array bound
    this.limit = config.roadHalf - MARGIN
    this.count = 0
    this._removalDebt = 0
    this._plateText = -1
    this._pop = 0 // transient scale-pop on gain (design 6.4)

    // leader (separate single mesh, larger, orange, punchier run animation → distinct)
    this.leader = new THREE.Mesh(soldierGeo, makeSoldierMaterial(0xf87800, SOLDIER_ANIM.leader)) // NES orange leader
    scene.add(this.leader)

    // followers (instanced, green) — sized to the VISUAL ceiling, not the logical cap
    this.mesh = new THREE.InstancedMesh(
      soldierGeo,
      makeSoldierMaterial(0x00a800, SOLDIER_ANIM.follower), // NES pipe-green followers
      VISUAL_CAP
    )
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    scene.add(this.mesh)

    // per-instance lerped positions + "has spawned" flags (sized to the VISUAL ceiling)
    this.cur = Array.from({ length: VISUAL_CAP }, () => new THREE.Vector3())
    this.init = new Array(VISUAL_CAP).fill(false)
    this._dummy = new THREE.Object3D()

    // floating count plate (hidden until the run starts)
    this.plate = makeTextSprite('0', { scale: 2.4, border: '#FBD000', color: '#FBD000' }) // coin-gold count
    this.plate.visible = false
    scene.add(this.plate)

    this._leaderX = 0
    this._leaderZ = 0
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
  removeBurst(n) {
    this.sub(n)
  }
  removeContinuous(amount) {
    this._removalDebt += amount
    const whole = Math.floor(this._removalDebt)
    if (whole > 0) {
      this._removalDebt -= whole
      this.sub(whole)
    }
  }

  // Transient scale punch on the whole crowd when reinforced (cosmetic — design 6.4).
  pop(strength = 0.35) {
    this._pop = Math.max(this._pop, strength)
  }

  reset(count) {
    this.setCount(count)
    this.init.fill(false)
    this._pop = 0
    this._plateText = -1
  }

  // Front-of-army muzzle point for bullet spawns; `lane` (index) spreads guns.
  frontPosition(lane = 0) {
    const span = Math.min(this.limit, FORMATION_HALF_WIDTH)
    const jitter = this.count > 1 ? ((lane % 7) / 6 - 0.5) * 2 * span : 0
    let x = this._leaderX + jitter
    if (x > this.limit) x = this.limit
    else if (x < -this.limit) x = -this.limit
    return { x, y: 0.55, z: this._leaderZ + 0.35 }
  }

  update(dt, leaderX, leaderZ) {
    this._leaderX = leaderX
    this._leaderZ = leaderZ

    // scale-pop: decay toward 0 (baseline follower scale = 1). The bigger leader look now
    // comes from leader.scale = LEADER_SCALE (geometry is shared/unscaled), so the leader
    // composes the pop as LEADER_SCALE * popScale.
    if (this._pop > 0) {
      this._pop *= Math.exp(-POP_DECAY * dt)
      if (this._pop < 0.001) this._pop = 0
    }
    const popScale = 1 + this._pop

    // leader: run motion is the GPU limb swing in its (punchier) soldier material, so no
    // CPU bob here — just position + the composed pop scale.
    this.leader.position.set(leaderX, 0, leaderZ)
    this.leader.scale.setScalar(LEADER_SCALE * popScale)
    this.leader.visible = this.count > 0

    // Logical followers can be millions; only VISUAL_CAP ever render (the visual ceiling).
    const followers = Math.max(0, this.count - 1)
    const rendered = Math.min(followers, VISUAL_CAP)
    const maxX = this.limit
    const a = 1 - Math.exp(-LERP_K * dt)
    this._dummy.scale.setScalar(popScale) // applied to every follower instance below

    for (let i = 0; i < rendered; i++) {
      const col = i % COLS
      const row = (i / COLS) | 0
      let tx = leaderX + (col - (COLS - 1) / 2) * SPACING
      if (tx > maxX) tx = maxX
      else if (tx < -maxX) tx = -maxX
      const tz = leaderZ - (row + 1) * SPACING - 0.45

      const p = this.cur[i]
      if (!this.init[i]) {
        p.set(leaderX, 0, leaderZ) // spawn from the leader (pop)
        this.init[i] = true
      }
      p.x += (tx - p.x) * a
      p.z += (tz - p.z) * a
      // post-lerp clamp: a lagging member can never render off-road (AC4 carry-over)
      if (p.x > maxX) p.x = maxX
      else if (p.x < -maxX) p.x = -maxX

      this._dummy.position.set(p.x, 0, p.z)
      this._dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this._dummy.matrix)
    }
    // de-activated slots respawn at the leader if regained later — bound by VISUAL_CAP, NEVER
    // this.cap (=1e12), which would iterate a trillion times and freeze the frame loop.
    for (let i = rendered; i < VISUAL_CAP; i++) this.init[i] = false
    this.mesh.count = rendered
    this.mesh.instanceMatrix.needsUpdate = true

    // count plate floats above the leader; texture only redrawn when the count changes. The plate
    // shows the COMPACT count (12.3k) so a 7-digit army never clips the sprite; the DOM HUD shows
    // the full integer (no truncation — design §6.4/AC8).
    this.plate.position.set(leaderX, 2.3, leaderZ - 0.2)
    this.plate.visible = this.count > 0
    if (this._plateText !== this.count) {
      updateTextSprite(this.plate, formatCount(this.count))
      this._plateText = this.count
    }
  }
}
