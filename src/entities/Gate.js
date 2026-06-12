import * as THREE from 'three'
import { makeTextSprite } from '../util/text.js'

// A gate pair (design 6.4). The road is split at x=0: leader.x < 0 selects the
// left op, else the right op. Ops: ['add',n] +n | ['mul',n] ×n | ['sub',n] −n.
// `sub` panels are tinted red to telegraph bad gates; others green.

function label(op) {
  const [t, v] = op
  if (t === 'add') return '+' + v
  if (t === 'mul') return '×' + v
  return '−' + v
}

function panelColor(op) {
  return op[0] === 'sub' ? 0xef4444 : 0x22c55e
}

export class Gate {
  constructor(scene, spec, roadHalf) {
    this.z = spec.z
    this.left = spec.left
    this.right = spec.right
    this.done = false

    this.group = new THREE.Group()
    this.group.position.z = spec.z

    for (const [op, sign] of [
      [this.left, -1],
      [this.right, 1],
    ]) {
      const color = panelColor(op)
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(roadHalf, 2.6),
        new THREE.MeshStandardMaterial({
          color,
          transparent: true,
          opacity: 0.34,
          side: THREE.DoubleSide,
        })
      )
      panel.position.set(sign * (roadHalf / 2), 1.3, 0)
      this.group.add(panel)

      const tag = makeTextSprite(label(op), {
        scale: 1.7,
        accent: null,
        bg: op[0] === 'sub' ? 'rgba(185,28,28,0.95)' : 'rgba(21,128,61,0.95)',
        font: 'bold 78px system-ui, sans-serif',
      })
      tag.position.set(sign * (roadHalf / 2), 2.75, 0)
      this.group.add(tag)
    }

    scene.add(this.group)
  }

  // resulting (clamped) count for an op against the current count
  _result(crowd, op) {
    const [t, v] = op
    let r = t === 'add' ? crowd.count + v : t === 'mul' ? crowd.count * v : crowd.count - v
    return Math.max(0, Math.min(crowd.cap, Math.round(r)))
  }

  // Apply the chosen side; return { good } for combo (good = chosen result is
  // >= the other side's result; ties — incl. clamped ties — count as good).
  apply(crowd, leaderX) {
    const chosen = leaderX < 0 ? this.left : this.right
    const other = leaderX < 0 ? this.right : this.left
    const good = this._result(crowd, chosen) >= this._result(crowd, other)

    const [t, v] = chosen
    if (t === 'add') crowd.add(v)
    else if (t === 'mul') crowd.mul(v)
    else crowd.sub(v)

    this.done = true
    this.group.visible = false // gate-pass feedback (juice)
    return { good }
  }
}
