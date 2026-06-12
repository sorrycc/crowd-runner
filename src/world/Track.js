import { Gate } from '../entities/Gate.js'
import { Obstacle } from '../entities/Obstacle.js'
import { Coin } from '../entities/Coin.js'
import { Boss } from '../entities/Boss.js'

// Builds all gameplay entities from the stage config (design 6.1). reset()
// disposes and REBUILDS from config, so every per-entity flag (gate.done,
// obstacle.broken, coin.collected) and the boss hp start clean (AC14/AC15).
// Collision resolution itself lives in Game (design 6.4); Track just owns the lists.

function disposeMaterial(material) {
  if (!material) return
  const mats = Array.isArray(material) ? material : [material]
  for (const m of mats) {
    m.map?.dispose?.()
    m.dispose?.()
  }
}

export class Track {
  constructor(scene, config) {
    this.scene = scene
    this.config = config
    this.build()
  }

  build() {
    const cfg = this.config
    this.gates = cfg.gates.map((s) => new Gate(this.scene, s, cfg.roadHalf))
    this.obstacles = cfg.obstacles.map((s) => new Obstacle(this.scene, s))
    this.coins = cfg.coins.map((s) => new Coin(this.scene, s))
    this.boss = new Boss(this.scene, cfg)
  }

  _removeObject(obj) {
    this.scene.remove(obj)
    obj.traverse?.((o) => {
      o.geometry?.dispose?.()
      disposeMaterial(o.material)
    })
    if (!obj.traverse) {
      obj.geometry?.dispose?.()
      disposeMaterial(obj.material)
    }
  }

  dispose() {
    for (const g of this.gates) this._removeObject(g.group)
    for (const o of this.obstacles) this._removeObject(o.group)
    for (const c of this.coins) this._removeObject(c.mesh)
    this._removeObject(this.boss.group)
  }

  reset() {
    this.dispose()
    this.build()
  }
}
