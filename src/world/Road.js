import * as THREE from 'three'

// The road surface + markings + guardrails, covering z ∈ [0, trackLength]
// (design 6.2; trackLength is derived once in Game from boss.z and passed in).
// All static geometry, built once. Primitives only.

const DASH_LEN = 1.4
const DASH_GAP = 1.4
const POST_GAP = 4

export class Road {
  constructor(scene, config, trackLength) {
    this.group = new THREE.Group()
    const half = config.roadHalf
    const len = trackLength

    // road surface
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2, len),
      new THREE.MeshStandardMaterial({ color: 0xe0a864, roughness: 0.95 }) // NES tan path
    )
    road.rotation.x = -Math.PI / 2
    road.position.set(0, 0, len / 2)
    this.group.add(road)

    // solid edge lines (flat NES paper-white)
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xfcfcfc, roughness: 0.6 })
    for (const sx of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, len), edgeMat)
      edge.position.set(sx * (half - 0.12), 0.02, len / 2)
      this.group.add(edge)
    }

    // dashed centre line (one InstancedMesh) — coin-gold road dashes
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xfbd000, roughness: 0.6 })
    const dashCount = Math.floor(len / (DASH_LEN + DASH_GAP))
    const dashes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 0.02, DASH_LEN),
      dashMat,
      dashCount
    )
    const m = new THREE.Object3D()
    for (let i = 0; i < dashCount; i++) {
      m.position.set(0, 0.02, (i + 0.5) * (DASH_LEN + DASH_GAP))
      m.updateMatrix()
      dashes.setMatrixAt(i, m.matrix)
    }
    this.group.add(dashes)

    // guardrails: a continuous rail + evenly spaced posts on each shoulder
    const railMat = new THREE.MeshStandardMaterial({ color: 0xfcfcfc, roughness: 0.5 }) // flat paper-white rail
    const postMat = new THREE.MeshStandardMaterial({ color: 0xc84c0c, roughness: 0.6 }) // NES brick posts
    const postCount = Math.floor(len / POST_GAP)
    for (const sx of [-1, 1]) {
      const railX = sx * (half + 0.18)
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, len), railMat)
      rail.position.set(railX, 0.62, len / 2)
      this.group.add(rail)

      const posts = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.1, 0.62, 0.1),
        postMat,
        postCount
      )
      for (let i = 0; i < postCount; i++) {
        m.position.set(railX, 0.31, (i + 0.5) * POST_GAP)
        m.rotation.set(0, 0, 0)
        m.updateMatrix()
        posts.setMatrixAt(i, m.matrix)
      }
      this.group.add(posts)
    }

    scene.add(this.group)
  }
}
