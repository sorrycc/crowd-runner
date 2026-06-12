// Steering input (design 6.1). Unifies pointer-drag (mouse), touch-drag and
// keyboard (arrows / A-D) into a single desired leader x (`this.x`), clamped to the
// road. Pointer events cover both mouse and touch. Keyboard is velocity-based and
// applied in update(dt); drag adjusts `this.x` directly.

const KEY_SPEED = 9 // units/sec for keyboard steering
const DRAG_SENS = 1.9 // screen-width drag -> world units multiplier

export class Input {
  constructor(domElement, roadHalf, margin = 0.35) {
    this.el = domElement
    this.limit = roadHalf - margin
    this.x = 0
    this.keys = { left: false, right: false }
    this.dragging = false
    this.lastClientX = 0
    this.sensMult = 1 // steer-sensitivity multiplier (sandstorm event drops it — feel-only)

    this._bind()
  }

  _bind() {
    const el = this.el

    el.addEventListener('pointerdown', (e) => {
      this.dragging = true
      this.lastClientX = e.clientX
      el.setPointerCapture?.(e.pointerId)
    })
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return
      const dx = e.clientX - this.lastClientX
      this.lastClientX = e.clientX
      const rect = el.getBoundingClientRect()
      this.x += (dx / rect.width) * (this.limit * 2) * DRAG_SENS * this.sensMult
      this._clamp()
    })
    const end = (e) => {
      this.dragging = false
      el.releasePointerCapture?.(e.pointerId)
    }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('lostpointercapture', () => (this.dragging = false))

    window.addEventListener('keydown', (e) => this._key(e, true))
    window.addEventListener('keyup', (e) => this._key(e, false))
  }

  _key(e, down) {
    switch (e.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        this.keys.left = down
        break
      case 'ArrowRight':
      case 'd':
      case 'D':
        this.keys.right = down
        break
      default:
        return
    }
    e.preventDefault()
  }

  _clamp() {
    if (this.x > this.limit) this.x = this.limit
    if (this.x < -this.limit) this.x = -this.limit
  }

  update(dt) {
    if (this.keys.left) this.x -= KEY_SPEED * dt * this.sensMult
    if (this.keys.right) this.x += KEY_SPEED * dt * this.sensMult
    this._clamp()
  }

  reset() {
    this.x = 0
    this.dragging = false
    this.keys.left = this.keys.right = false
    this.sensMult = 1
  }
}
