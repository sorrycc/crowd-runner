import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { buildSoldierParts, mergeSoldierGeometry } from './soldier.js'

// Async model preload path (design 6.2). Kicks the bundled soldier.glb load at import
// (like AudioManager's eager fetch) and exposes a Promise resolving to the ONE shared,
// merged BufferGeometry that backs every soldier mesh. Nothing here blocks first paint or
// the Start gesture — Game builds Crowd/Track when this resolves (a small local asset, so
// it lands in tens of ms). This is the ONLY file that imports GLTFLoader, keeping soldier.js
// pure/Node-importable for the generator.
//
// The .glb URL comes from Vite's glob (fingerprinted asset URL), mirroring the audio bundle
// path in src/core/Audio.js. On any load/parse failure we fall back to the same
// buildSoldierParts() the generator uses — a construction-time source, never a hot-swap.

const urls = import.meta.glob('../assets/models/*.glb', {
  query: '?url',
  import: 'default',
  eager: true,
})
const soldierUrl = Object.entries(urls).find(([path]) => path.includes('soldier'))?.[1]

export const soldierModelReady = (async () => {
  if (soldierUrl) {
    try {
      const gltf = await new GLTFLoader().loadAsync(soldierUrl)
      return mergeSoldierGeometry(gltf.scene)
    } catch (err) {
      console.warn('soldier.glb load failed; using procedural fallback', err)
    }
  }
  return mergeSoldierGeometry(buildSoldierParts())
})()
