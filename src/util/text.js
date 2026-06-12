import * as THREE from 'three'

// Single reused helper (design Decision 5) for all in-world text plates:
// gate value labels, obstacle HP, the crowd count plate, and the boss HP number.
// Renders text onto a canvas -> CanvasTexture -> Sprite. The canvas/texture are
// stashed on userData so the text can be cheaply updated in place.

const CANVAS_W = 256
const CANVAS_H = 128

// Compact formatter for in-world plates/tags (redesign: army + boss HP are unbounded and can reach
// 7–10 digits, which would clip the fixed 256px canvas). The DOM HUD shows the full integer (no
// clip); the 3D sprites use this. < 10k → raw; else 12.3k / 1.4M / 2.1B / 3.0T.
export function formatCount(n) {
  const v = Math.max(0, Math.round(n))
  if (v < 10000) return String(v)
  if (v < 1e6) return (v / 1e3).toFixed(v < 1e5 ? 1 : 0) + 'k'
  if (v < 1e9) return (v / 1e6).toFixed(v < 1e7 ? 1 : 0) + 'M'
  if (v < 1e12) return (v / 1e9).toFixed(1) + 'B'
  return (v / 1e12).toFixed(1) + 'T'
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function makeTextSprite(text, opts = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.anisotropy = 4

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.renderOrder = 999
  sprite.userData = { canvas, texture, opts }

  const scale = opts.scale ?? 2
  sprite.scale.set(scale, scale * (CANVAS_H / CANVAS_W), 1)

  updateTextSprite(sprite, text)
  return sprite
}

export function updateTextSprite(sprite, text) {
  const { canvas, texture, opts } = sprite.userData
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const bg = opts.bg ?? 'rgba(17, 24, 39, 0.92)'
  const fg = opts.color ?? '#ffffff'
  const accent = opts.accent ?? '#22c55e'
  const font = opts.font ?? 'bold 70px system-ui, sans-serif'

  // plate
  roundRect(ctx, 10, 24, canvas.width - 20, canvas.height - 60, 26)
  ctx.fillStyle = bg
  ctx.fill()

  // accent underline (the little green bar in the reference)
  if (opts.accent !== null) {
    roundRect(ctx, 36, canvas.height - 40, canvas.width - 72, 8, 4)
    ctx.fillStyle = accent
    ctx.fill()
  }

  // text
  ctx.fillStyle = fg
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(text), canvas.width / 2, canvas.height / 2 - 4)

  texture.needsUpdate = true
}
