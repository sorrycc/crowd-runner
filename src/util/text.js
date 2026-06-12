import * as THREE from 'three'

// Single reused helper (design Decision 5) for all in-world text plates:
// gate value labels, obstacle HP, the crowd count plate, and the boss HP number.
// Renders text onto a canvas -> CanvasTexture -> Sprite. The canvas/texture are
// stashed on userData so the text can be cheaply updated in place.
//
// 8-bit NES restyle (2026-06-12-nes-mario-restyle): square plates with a black fill +
// thick hard border (per-entity color), Press Start 2P pixel font (uppercased, with the
// U+2212 minus mapped to ASCII — the font lacks U+2212), a measure-and-shrink so even the
// widest label (e.g. "+12.3K") fits the canvas, and NearestFilter so glyphs stay crisp.

const CANVAS_W = 256
const CANVAS_H = 128
const FONT_FAMILY = '"Press Start 2P", monospace'

// Webfont gate (design Decision 2). Canvas ctx.font ignores a webfont until it is loaded,
// so plates would first-draw in the fallback font. Game.js awaits this alongside the
// soldier model before building Crowd/Track (which create every static plate). The
// .catch keeps a font 404 from ever blocking the game — Verification checks
// document.fonts.check('36px "Press Start 2P"') to catch that case deterministically.
export const fontReady =
  typeof document !== 'undefined' && document.fonts && document.fonts.load
    ? document.fonts.load('36px "Press Start 2P"').catch(() => {})
    : Promise.resolve()

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

export function makeTextSprite(text, opts = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const texture = new THREE.CanvasTexture(canvas)
  // crisp pixel glyphs when the plate is upscaled (the common, near-camera case); keep
  // linear minification so distant plates don't shimmer.
  texture.magFilter = THREE.NearestFilter
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
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)

  const plate = opts.plate !== false
  const bg = opts.bg ?? '#000000'
  const border = opts.border ?? '#FCFCFC'
  const fg = opts.color ?? '#FCFCFC'
  const PAD = 6
  const B = 10
  // Uppercase for the 8-bit read; map U+2212 minus → ASCII hyphen (the font lacks U+2212).
  // Render-only: gate/effects keep their data-keyed green/red selection (op[0]/delta).
  const label = String(text).toUpperCase().replace(/−/g, '-')

  // square plate: black fill + thick hard border (no rounded corners, no accent bar)
  if (plate) {
    ctx.fillStyle = bg
    ctx.fillRect(PAD, 14, W - 2 * PAD, H - 28)
    ctx.lineWidth = B
    ctx.strokeStyle = border
    ctx.strokeRect(PAD + B / 2, 14 + B / 2, W - 2 * PAD - B, H - 28 - B)
  }

  // measure-and-shrink so the widest labels (e.g. "+12.3K", large boss HP) still fit
  const interior = plate ? W - 2 * PAD - 2 * B : W - 16
  let size = opts.fontSize ?? 36
  ctx.font = `${size}px ${FONT_FAMILY}`
  while (size > 12 && ctx.measureText(label).width > interior) {
    size -= 2
    ctx.font = `${size}px ${FONT_FAMILY}`
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // plate-less floating numbers: hard black outline so they read over the bright world
  if (!plate) {
    ctx.lineWidth = 8
    ctx.strokeStyle = '#000000'
    ctx.strokeText(label, W / 2, H / 2)
  }
  ctx.fillStyle = fg
  ctx.fillText(label, W / 2, H / 2)

  texture.needsUpdate = true
}
