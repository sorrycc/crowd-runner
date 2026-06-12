import * as THREE from 'three'
import { mulberry32, range } from '../util/rng.js'

// Ground plane + decorative trees scattered on both shoulders (design 6.2/6.8).
// Tree positions come from a FRESH mulberry32(config.seed) every build, so the
// scatter is byte-identical across runs/restarts (AC15). Trees are two
// InstancedMeshes (trunks + foliage) for one draw call each.

export class Environment {
  constructor(scene, config, trackLength) {
    this.group = new THREE.Group()

    // ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, trackLength + 200),
      new THREE.MeshStandardMaterial({ color: 0x6cbf53, roughness: 1 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.set(0, -0.06, trackLength / 2)
    this.group.add(ground)

    // trees
    const n = config.trees | 0
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.1, 6)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 })
    const foliageGeo = new THREE.ConeGeometry(1.0, 2.2, 7)
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x3f9d4f, roughness: 1 })

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n)
    const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, n)
    const rng = mulberry32(config.seed)
    const m = new THREE.Object3D()
    const half = config.roadHalf

    for (let i = 0; i < n; i++) {
      const side = rng() < 0.5 ? -1 : 1
      const x = side * range(rng, half + 2.5, half + 13)
      const z = range(rng, 4, trackLength - 4)
      const s = range(rng, 0.7, 1.5)

      m.position.set(x, 0.55 * s, z)
      m.scale.setScalar(s)
      m.rotation.set(0, 0, 0)
      m.updateMatrix()
      trunks.setMatrixAt(i, m.matrix)

      m.position.set(x, (1.1 + 1.0) * s, z)
      m.updateMatrix()
      foliage.setMatrixAt(i, m.matrix)
    }
    this.group.add(trunks, foliage)

    scene.add(this.group)
  }
}
