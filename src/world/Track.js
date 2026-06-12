import { Gate } from '../entities/Gate.js'
import { Obstacle } from '../entities/Obstacle.js'
import { Enemy } from '../entities/Enemy.js'
import { Powerup } from '../entities/Powerup.js'
import { Boss } from '../entities/Boss.js'

// Builds all gameplay entities for the current stage from config (design 6.1).
// reset(config) disposes and REBUILDS, so every per-entity flag (gate.done,
// obstacle.broken, enemy.dead, powerup.collected) and the boss hp start clean
// (AC14/AC15). Collision/firing resolution lives in Game (design 6.4); Track just
// owns the lists. Coins are gone — replaced by power-ups (design 6.7).

function disposeMaterial(material) {
  if (!material) return
  const mats = Array.isArray(material) ? material : [material]
  for (const m of mats) {
    m.map?.dispose?.()
    m.dispose?.()
  }
}

export class Track {
  // `soldierGeo` is the shared soldier geometry (from models.js) handed to enemy squads.
  constructor(scene, config, soldierGeo) {
    this.scene = scene
    this.config = config
    this.soldierGeo = soldierGeo
    this.build()
  }

  build() {
    const cfg = this.config
    this.gates = cfg.gates.map((s) => new Gate(this.scene, s, cfg.roadHalf))
    this.obstacles = (cfg.obstacles || []).map((s) => new Obstacle(this.scene, s))
    this.enemies = (cfg.enemies || []).map((s) => new Enemy(this.scene, s, this.soldierGeo))
    this.powerups = (cfg.powerups || []).map((s) => new Powerup(this.scene, s))
    this.boss = new Boss(this.scene, cfg)
  }

  // Never dispose the shared soldier geometry (page-lifetime singleton from models.js,
  // referenced by Crowd + every enemy squad) — it is marked userData.shared. The boss group's
  // own geometry is not flagged, so it is still freed on rebuild.
  _disposeGeometry(geometry) {
    if (geometry && !geometry.userData?.shared) geometry.dispose?.()
  }

  _removeObject(obj) {
    this.scene.remove(obj)
    obj.traverse?.((o) => {
      this._disposeGeometry(o.geometry)
      disposeMaterial(o.material)
    })
    if (!obj.traverse) {
      this._disposeGeometry(obj.geometry)
      disposeMaterial(obj.material)
    }
  }

  dispose() {
    for (const g of this.gates) this._removeObject(g.group)
    for (const o of this.obstacles) this._removeObject(o.group)
    for (const e of this.enemies) this._removeObject(e.group)
    for (const p of this.powerups) this._removeObject(p.group)
    this._removeObject(this.boss.group)
  }

  // Rebuild for a (possibly new) stage config.
  reset(config) {
    this.dispose()
    if (config) this.config = config
    this.build()
  }
}
