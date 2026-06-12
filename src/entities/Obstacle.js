import * as THREE from 'three'
import { makeTextSprite, updateTextSprite, formatCount } from '../util/text.js'

// A destructible road block (design 6.4). `hp` is a float that drains under fire
// while the army is *engaged* (leaderX ∈ xRange). The HP sprite ticks down live
// (shown as ceil(hp)) and the block tints from green→red and crumbles at 0. If the
// army reaches it with hp left, the leftover drains min(count, ceil(hp)) soldiers on
// contact (1 per remaining HP), unless a Shield is active. `fullWidth` blocks span
// the road and cannot be dodged; dodgeable blocks have a sub-range you steer around
// (and are then never engaged → never shot, never contacted).

const TIRE_R = 0.45
const TIRE_H = 0.32
const FULL = new THREE.Color(0x00a800) // NES pipe-green (healthy)
const LOW = new THREE.Color(0xe52521) // NES mario-red (near-dead)
const _white = new THREE.Color(0xffffff)
const DEATH_TIME = 0.26 // cosmetic crumble flash + scale-pop linger before hide (design 6.6)

export class Obstacle {
  constructor(scene, spec) {
    this.z = spec.z
    this.hp = spec.hp
    this.maxHp = spec.hp
    this.xRange = spec.xRange
    this.fullWidth = !!spec.fullWidth
    this.broken = false
    this._dying = 0 // > 0 while the crumble anim plays (design 6.6)
    this._hpShown = -1

    this.group = new THREE.Group()
    this.group.position.z = spec.z

    const [x0, x1] = spec.xRange
    const width = x1 - x0
    const cols = Math.max(1, Math.round(width / 0.95))
    const step = width / cols
    this.mat = new THREE.MeshStandardMaterial({ color: FULL.clone(), roughness: 0.85 })
    const tireGeo = new THREE.CylinderGeometry(TIRE_R, TIRE_R, TIRE_H, 16)

    // Tires are collected so the stack can physically shrink under fire (design #2). Each tire is
    // tagged with its height index k (0 = bottom … 2 = top); _refresh shows ceil(tiersPerCol·hpFrac)
    // per column, hiding the top tier first → the stack reads as taking damage.
    this.tires = []
    this.tiersPerCol = 3
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * step
      for (let k = 0; k < this.tiersPerCol; k++) {
        const tire = new THREE.Mesh(tireGeo, this.mat)
        tire.position.set(x, 0.2 + k * TIRE_H, 0)
        tire.userData.k = k
        this.group.add(tire)
        this.tires.push(tire)
      }
    }

    this.tag = makeTextSprite(formatCount(Math.ceil(this.hp)), {
      scale: 1.5,
      border: '#FCFCFC',
    })
    this.tag.position.set((x0 + x1) / 2, 1.55, 0)
    this.group.add(this.tag)

    scene.add(this.group)
    this._refresh()
  }

  inRange(x) {
    return x >= this.xRange[0] && x <= this.xRange[1]
  }

  // Per-frame death anim tick (no-op unless crumbling). Called for every obstacle from
  // Game's RUN phase; obstacles are static and few (≤ a handful per stage), so this is a
  // bounded loop that does nothing unless exactly one block is mid-crumble.
  update(dt) {
    if (!this._dying) return
    this._dying = Math.max(0, this._dying - dt)
    const p = 1 - this._dying / DEATH_TIME // 0 → 1
    const s = p < 0.3 ? 1 + (p / 0.3) * 0.3 : 1.3 * (1 - (p - 0.3) / 0.7)
    this.group.scale.setScalar(Math.max(0, s))
    this.mat.color.copy(this._baseColor).lerp(_white, 1 - p)
    if (this._dying <= 0) this.group.visible = false
  }

  _refresh() {
    const frac = Math.max(0, this.hp) / this.maxHp
    this.mat.color.copy(LOW).lerp(FULL, frac)
    // physical shrink (design #2): each column keeps its bottom ceil(tiersPerCol·frac) tires, hiding
    // the top tier first. frac > 0 while alive ⇒ at least one tier stays up until the block breaks.
    const shownPerCol = Math.ceil(this.tiersPerCol * frac)
    for (const t of this.tires) t.visible = t.userData.k < shownPerCol
    const shown = Math.max(0, Math.ceil(this.hp))
    if (shown !== this._hpShown) {
      updateTextSprite(this.tag, formatCount(shown))
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
    this.broken = true // gameplay flag flips NOW (targeting/contact unchanged); mesh lingers
    this._dying = DEATH_TIME
    this._baseColor = this.mat.color.clone() // snapshot the current (low/red) tint to flash from
    for (const t of this.tires) t.visible = true // restore the full stack so the crumble pop is whole
    this.tag.visible = false
  }
}
