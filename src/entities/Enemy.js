import * as THREE from 'three'
import { makeTextSprite, updateTextSprite, formatCount } from '../util/text.js'
import { makeSoldierMaterial, SOLDIER_ANIM } from '../util/soldier.js'

// A marching enemy squad (design 6.5). Rows of red soldiers (one InstancedMesh, one
// draw call) with `hp`, an `xRange`, and a fixed deterministic `marchSpeed` toward
// the player (−Z). Shot down like a block while engaged; if it reaches the army
// (z ≤ leaderZ) alive it drains leftover soldiers on contact. No return fire. The
// visible soldier count shrinks with remaining HP so it reads as taking casualties.
// Geometry is the SHARED soldier singleton (from models.js) — march/bob is the GPU limb
// swing in the material, and Track.dispose() must NOT free it (it is marked userData.shared).

const _white = new THREE.Color(0xffffff)
const DEATH_TIME = 0.28 // cosmetic death flash + scale-pop linger before hide (design 6.6)
const HIT_FLASH_TIME = 0.13 // squad flashes white + recoils briefly while under fire (AC4)
const ENEMY_SCALE = 0.95 // enemies are slightly smaller; applied via the instance transform

export class Enemy {
  constructor(scene, spec, soldierGeo) {
    this.z = spec.z
    this.hp = spec.hp
    this.maxHp = spec.hp
    this.xRange = spec.xRange
    this.marchSpeed = spec.marchSpeed ?? 0
    this.dead = false
    this._dying = 0 // > 0 only on a real kill (the silent slip-past leaves this 0)
    this._hpShown = -1
    this._hitFlash = 0 // > 0 while reacting to incoming fire (AC4)

    const [x0, x1] = spec.xRange
    const width = Math.max(0.5, x1 - x0)
    this.cols = Math.max(2, Math.min(9, Math.round(width / 0.5)))
    this.maxVisible = Math.max(this.cols, Math.min(40, Math.round(this.hp / 8)))
    this.rows = Math.ceil(this.maxVisible / this.cols)
    this.spacing = width / this.cols

    this.group = new THREE.Group()
    this.group.position.set(0, 0, spec.z)

    this.mesh = new THREE.InstancedMesh(
      soldierGeo,
      makeSoldierMaterial(0xe52521, SOLDIER_ANIM.enemy), // NES mario-red enemy
      this.maxVisible
    )
    this._baseColor = this.mesh.material.color.clone()
    this.mesh.frustumCulled = false
    this._dummy = new THREE.Object3D()
    this._x0 = x0
    this.group.add(this.mesh)
    this._layout(this.maxVisible)

    this.tag = makeTextSprite(formatCount(Math.ceil(this.hp)), {
      scale: 1.4,
      border: '#E52521',
    })
    this.tag.position.set((x0 + x1) / 2, 1.7, 0)
    this.group.add(this.tag)

    scene.add(this.group)
  }

  _layout(visible) {
    let i = 0
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols && i < this.maxVisible; c++, i++) {
        const x = this._x0 + (c + 0.5) * this.spacing
        const z = r * 0.42 // rows extend back (+local z), front faces the player
        this._dummy.position.set(i < visible ? x : 0, 0, z)
        this._dummy.scale.setScalar(i < visible ? ENEMY_SCALE : 0)
        this._dummy.updateMatrix()
        this.mesh.setMatrixAt(i, this._dummy.matrix)
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  inRange(x) {
    return x >= this.xRange[0] && x <= this.xRange[1]
  }

  update(dt) {
    // fully dead + hidden (incl. the silent slip-past path in Game): do nothing
    if (this.dead && this._dying <= 0) return
    // death anim only (flash + scale-pop), then hide
    if (this._dying > 0) {
      this._dying = Math.max(0, this._dying - dt)
      const p = 1 - this._dying / DEATH_TIME // 0 → 1
      const s = p < 0.3 ? 1 + (p / 0.3) * 0.3 : 1.3 * (1 - (p - 0.3) / 0.7)
      this.group.scale.setScalar(Math.max(0, s))
      this.mesh.material.color.copy(this._baseColor).lerp(_white, 1 - p)
      if (this._dying <= 0) this.group.visible = false
      return
    }
    // alive: march forward; the per-soldier bob + limb swing is the GPU animation in the
    // material, so the group itself no longer bobs.
    if (this.marchSpeed) this.z -= this.marchSpeed * dt
    // hit reaction (AC4): flash white + recoil while under fire. Continuous focus fire keeps
    // _hitFlash topped up, so the squad glows the whole time it's being shot, then resets.
    const k = this._hitFlash > 0 ? this._hitFlash / HIT_FLASH_TIME : 0
    this.mesh.material.color.copy(this._baseColor).lerp(_white, 0.55 * k)
    this.group.position.z = this.z + 0.05 * k
    if (this._hitFlash > 0) this._hitFlash = Math.max(0, this._hitFlash - dt)
  }

  _refresh() {
    const frac = Math.max(0, this.hp) / this.maxHp
    const visible = Math.max(1, Math.round(this.maxVisible * frac))
    this._layout(visible)
    const shown = Math.max(0, Math.ceil(this.hp))
    if (shown !== this._hpShown) {
      updateTextSprite(this.tag, formatCount(shown))
      this._hpShown = shown
    }
  }

  damage(amount) {
    if (this.dead) return
    this.hp -= amount
    if (amount > 0) this._hitFlash = HIT_FLASH_TIME // visible hit reaction (AC4)
    if (this.hp <= 0) {
      this.hp = 0
      this._die()
    } else {
      this._refresh()
    }
  }

  contact(crowd, shielded) {
    if (this.dead) return 0
    const drained = shielded ? 0 : Math.min(crowd.count, Math.ceil(this.hp))
    if (drained > 0) crowd.sub(drained)
    this.hp = 0
    this._die()
    return drained
  }

  _die() {
    this.dead = true // gameplay flag flips NOW (targeting/contact unchanged); mesh lingers
    this._dying = DEATH_TIME
    this.tag.visible = false
  }
}
