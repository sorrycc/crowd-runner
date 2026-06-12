import { makeTextSprite, updateTextSprite } from '../util/text.js'
import { ParticlePool } from './ParticlePool.js'

// Cosmetic effects facade (design 6.2), owned by Game. Bundles the pooled particle
// system, a pooled set of floating +N/−N text sprites, and a passthrough to the camera
// shake on SceneManager. Game calls the high-level per-event methods; nothing here
// touches gameplay state. clear() hard-cuts everything on restart / stage advance.
//
// Everything is pooled and page-lifetime (like the bullet pools): the particle
// InstancedMesh and the text sprites are added to the scene once and only ever have their
// state reset — never removed/re-added.

const GREEN = '#4ade80'
const RED = '#f87171'
const TEXT_CAP = 16
const TEXT_RISE = 1.9 // world units / s
const TEXT_LIFE = 0.85

export class Effects {
  constructor(scene, sceneManager) {
    this.sm = sceneManager
    this.particles = new ParticlePool(scene, { cap: 320, gravity: 9 })

    // floating-number sprite pool — plate-less (transparent bg, no accent) so it reads as
    // clean rising text. Reused in place: opts.color is swapped per pop.
    this.texts = []
    for (let i = 0; i < TEXT_CAP; i++) {
      const sprite = makeTextSprite('', {
        accent: null,
        bg: 'rgba(0,0,0,0)',
        color: GREEN,
        font: 'bold 90px system-ui, sans-serif',
        scale: 1.8,
      })
      sprite.visible = false
      sprite.userData.fx = { active: false, life: 0, maxLife: TEXT_LIFE }
      scene.add(sprite)
      this.texts.push(sprite)
    }
  }

  // ── floating +N / −N numbers ──
  number(delta, x, y, z) {
    if (!delta) return
    const sprite = this.texts.find((s) => !s.userData.fx.active)
    if (!sprite) return // pool full — drop (cap sized for worst-case concurrency)
    const text = (delta > 0 ? '+' : '−') + Math.abs(delta)
    sprite.userData.opts.color = delta > 0 ? GREEN : RED
    updateTextSprite(sprite, text) // canvas redraw — only here, never per frame
    sprite.position.set(x + (Math.random() - 0.5) * 0.4, y, z)
    sprite.material.opacity = 1
    sprite.visible = true
    const fx = sprite.userData.fx
    fx.active = true
    fx.life = TEXT_LIFE
  }

  // ── particle bursts (tuned per event) ──
  gainPuff(x, y, z) {
    this.particles.burst(x, y, z, { count: 16, color: 0x4ade80, speed: 5, up: 0.9, size: 0.16, life: 0.5 })
  }
  lossShards(x, y, z) {
    this.particles.burst(x, y, z, { count: 18, color: 0xef4444, speed: 8, up: 0.4, size: 0.14, life: 0.45 })
  }
  gatePick(x, y, z, good) {
    this.particles.burst(x, y, z, { count: 10, color: good ? 0x4ade80 : 0xef4444, speed: 4, up: 0.7, size: 0.18, life: 0.45 })
  }
  blockBreak(x, y, z) {
    this.particles.burst(x, y, z, { count: 22, color: 0x9ca3af, speed: 6, up: 0.5, size: 0.2, life: 0.6 })
  }
  enemyDeath(x, y, z) {
    this.particles.burst(x, y, z, { count: 20, color: 0xdc2626, speed: 7, up: 0.6, size: 0.16, life: 0.55 })
  }
  powerupGrab(x, y, z, color) {
    this.particles.burst(x, y, z, { count: 16, color, speed: 6, up: 1.0, size: 0.17, life: 0.5 })
  }
  // Combat feedback (AC4). Muzzle flash: a few bright, short-lived sparks at the firing front
  // (≤1 per _fire volley → negligible concurrent count). Soldier poof: an olive puff selling
  // soldiers dropping, fired alongside the red lossShards on every soldier-loss event.
  muzzleFlash(x, y, z) {
    this.particles.burst(x, y, z, { count: 3, color: 0xfff1a8, speed: 3, up: 0.25, size: 0.13, life: 0.07, sizeJitter: 0.4 })
  }
  soldierPoof(x, y, z) {
    this.particles.burst(x, y, z, { count: 10, color: 0x4d7c2a, speed: 5, up: 0.6, size: 0.16, life: 0.42 })
  }
  // Boss death is a multi-stage burst; Game fires waves 0/1/2 over the WIN_SEQUENCE hold.
  bossDeathWave(x, y, z, stage) {
    const tunings = [
      { count: 46, color: 0xfca5a5, speed: 13, size: 0.32, life: 0.9 },
      { count: 38, color: 0xfbbf24, speed: 16, size: 0.26, life: 0.8 },
      { count: 34, color: 0xfde047, speed: 19, size: 0.22, life: 0.75 },
    ]
    const t = tunings[Math.min(stage, tunings.length - 1)]
    this.particles.burst(x, y, z, { ...t, up: 0.7 })
  }

  update(dt) {
    this.particles.update(dt)
    for (const sprite of this.texts) {
      const fx = sprite.userData.fx
      if (!fx.active) continue
      sprite.position.y += TEXT_RISE * dt
      fx.life -= dt
      const k = Math.max(0, fx.life / fx.maxLife)
      sprite.material.opacity = k
      const s = 1.8 * (0.85 + 0.15 * k) // tiny ease, no canvas work
      sprite.scale.set(s, s * 0.5, 1)
      if (fx.life <= 0) {
        fx.active = false
        sprite.visible = false
      }
    }
  }

  // Hard-cut: clear particles + deactivate all floating numbers (restart / stage advance).
  clear() {
    this.particles.clear()
    for (const sprite of this.texts) {
      sprite.userData.fx.active = false
      sprite.visible = false
    }
  }
}
