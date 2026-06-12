// Dev-only model generator (mirrors scripts/gen-audio.sh): authors the bundled, self-
// authored CC0 soldier model and writes src/assets/models/soldier.glb. It is NEVER run by
// `npm run build`, `npm run verify`, or CI — the committed .glb is what ships. Regenerate
// identically with:  node scripts/gen-models.mjs
//
// The humanoid geometry is defined ONCE in src/util/soldier.js (buildSoldierParts), so the
// asset and the runtime fallback can never drift. We strip UVs (solid colours, no textures)
// and export a binary GLB via three's GLTFExporter, which needs a tiny FileReader polyfill
// under Node.
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as THREE from 'three'

// GLTFExporter (binary path) reads the packed Blob via FileReader, which Node lacks.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf
      this.onloadend && this.onloadend()
    })
  }
}

const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
const { buildSoldierParts } = await import('../src/util/soldier.js')

const parts = buildSoldierParts()
let tris = 0
parts.traverse((o) => {
  if (!o.isMesh) return
  o.geometry.deleteAttribute('uv') // no textures → keep the runtime geometry lean
  const g = o.geometry
  tris += (g.index ? g.index.count : g.attributes.position.count) / 3
})
console.log(`soldier merged triangles: ${tris}  (budget <= ~300)`) // AC6 vertex-budget check

const scene = new THREE.Scene()
scene.add(parts)

const glb = await new Promise((res, rej) =>
  new GLTFExporter().parse(scene, res, rej, { binary: true })
)

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../src/assets/models')
mkdirSync(outDir, { recursive: true })
const outPath = resolve(outDir, 'soldier.glb')
writeFileSync(outPath, Buffer.from(glb))
console.log(`wrote ${outPath}  (${glb.byteLength} bytes)`)
