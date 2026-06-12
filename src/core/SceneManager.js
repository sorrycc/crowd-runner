import * as THREE from 'three'

// Owns the renderer, scene, camera, lights, fog and sky gradient, plus the
// chase-camera behaviour (design 6.2). Forward is +Z; the camera sits behind the
// leader (lower Z) and above, looking toward +Z. Fog fades distant entities into
// the sky for the vanishing-point look.

const SKY_TOP = '#7ec8f0'
const SKY_BOTTOM = '#dff1fb'
const FOG_COLOR = 0xdff1fb

// Engine-feel camera constants (code-side, out of AC16 scope — design 6.7).
const CAM_HEIGHT = 5.2
const CAM_BACK = 8
const LOOK_AHEAD = 7
const CAM_X_FOLLOW = 0.45 // fraction of leader x the camera tracks
const CAM_LERP_K = 6
const SHAKE_DECAY = 6 // per-second multiplicative decay rate (frame-rate independent)

function skyTexture() {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 256
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, SKY_TOP)
  g.addColorStop(1, SKY_BOTTOM)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class SceneManager {
  constructor(parent) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    parent.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = skyTexture()
    this.scene.fog = new THREE.Fog(FOG_COLOR, 55, 190)

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      400
    )
    this.camera.position.set(0, CAM_HEIGHT, -CAM_BACK)
    this.camera.lookAt(0, 1.2, LOOK_AHEAD)

    // lighting — soft hemisphere fill + a key directional (no shadow maps, perf)
    const hemi = new THREE.HemisphereLight(0xffffff, 0x4a7a3a, 1.05)
    this.scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xffffff, 0.9)
    dir.position.set(6, 12, -4)
    this.scene.add(dir)

    this._shake = 0

    this._onResize = () => this.resize()
    window.addEventListener('resize', this._onResize)
  }

  // Additive decaying camera shake (design 6.3). Stacks via Math.max so a weaker new
  // shake never reduces an in-flight one. Light soldier loss ≈ 0.12, heavy boss ≈ 0.6.
  shake(amount) {
    this._shake = Math.max(this._shake, amount)
  }

  resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  // Smoothly trail the leader. Snap=true places the camera instantly (used on start/restart).
  chase(leaderPos, dt, snap = false) {
    const targetX = leaderPos.x * CAM_X_FOLLOW
    const desired = new THREE.Vector3(targetX, CAM_HEIGHT, leaderPos.z - CAM_BACK)
    const t = snap ? 1 : 1 - Math.exp(-CAM_LERP_K * dt)
    this.camera.position.lerp(desired, t)

    // additive decaying shake on top of the lerp (snap hard-cuts it — used on start/
    // restart and after stage advance so a heavy boss shake never bleeds across stages)
    if (snap) {
      this._shake = 0
    } else if (this._shake > 0) {
      const k = this._shake
      this.camera.position.x += (Math.random() * 2 - 1) * k
      this.camera.position.y += (Math.random() * 2 - 1) * k
      this._shake *= Math.exp(-SHAKE_DECAY * dt)
      if (this._shake < 0.002) this._shake = 0
    }

    this.camera.lookAt(targetX, 1.2, leaderPos.z + LOOK_AHEAD)
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}
