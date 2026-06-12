import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// One merged soldier geometry — body capsule + a gun box + a helmet box — so the
// follower InstancedMesh (and the enemy InstancedMesh) stay a single draw call each
// while clearly reading as "soldier with a gun" (design 6.3 / Decision 7). Kept
// low-poly on purpose: the gun/helmet ~2–3× the per-instance vertices vs. a bare
// capsule, which is the accepted cost for one draw call. Material/colour is applied
// by the caller (army green, enemy red, leader orange) on the shared geometry.

export function makeSoldierGeometry({ scale = 1 } = {}) {
  const body = new THREE.CapsuleGeometry(0.2 * scale, 0.42 * scale, 4, 8)
  body.translate(0, 0.41 * scale, 0)

  // gun: a short box held forward on the right side, pointing +Z (forward)
  const gun = new THREE.BoxGeometry(0.08 * scale, 0.08 * scale, 0.5 * scale)
  gun.translate(0.2 * scale, 0.5 * scale, 0.2 * scale)

  // helmet
  const helmet = new THREE.BoxGeometry(0.34 * scale, 0.16 * scale, 0.34 * scale)
  helmet.translate(0, 0.86 * scale, 0)

  const merged = mergeGeometries([body, gun, helmet], false)
  body.dispose()
  gun.dispose()
  helmet.dispose()
  return merged
}
