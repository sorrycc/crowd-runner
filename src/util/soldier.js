import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Humanoid soldier model + a one-draw-call vertex-animation system
// (design 2026-06-12-gltf-soldiers-crowd-boss). The runtime loads a bundled GLTF
// (src/assets/models/soldier.glb, authored by scripts/gen-models.mjs) and merges it into
// ONE shared BufferGeometry that backs the follower InstancedMesh, the leader mesh, and
// every enemy InstancedMesh — one draw call each. Liveliness is a GPU limb swing driven
// by a per-instance phase derived from gl_InstanceID (no per-instance attribute → the
// geometry stays shareable across meshes; instanceMatrix is mesh-level, not geometry-level).
//
// This file is PURE / Node-importable (only `three` + BufferGeometryUtils — no DOM, no
// GLTFLoader): scripts/gen-models.mjs imports buildSoldierParts() from here to author the
// asset, and src/util/models.js imports the merge helper. soldier.glb is the canonical
// runtime model; buildSoldierParts() is its single source (also the load-error fallback).

// ── limb tagging (single source of truth, shared by the generator + the merge step) ──
export const LIMB = { CORE: 0, LEG_L: 1, LEG_R: 2, ARM_L: 3, ARM_R: 4 }
export const LIMB_BY_NAME = {
  core: LIMB.CORE,
  legL: LIMB.LEG_L,
  legR: LIMB.LEG_R,
  armL: LIMB.ARM_L,
  armR: LIMB.ARM_R, // the gun mesh is also named 'armR' so it swings with the right arm
}
export const HIP_Y = 0.42 // leg swing pivot
export const SHOULDER_Y = 0.7 // arm swing pivot

// Per-material animation tunings (the leader is punchier → "distinct" per AC3).
export const SOLDIER_ANIM = {
  follower: { freq: 9.0, swing: 0.5, bob: 0.05 },
  enemy: { freq: 8.0, swing: 0.45, bob: 0.04 },
  leader: { freq: 12.5, swing: 0.72, bob: 0.07 },
}

// One shared clock for every soldier material's `uTime` uniform (Game ticks it once/frame).
export const SOLDIER_TIME = { value: 0 }
export function tickSoldiers(dt) {
  SOLDIER_TIME.value += dt
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)

// Low-poly humanoid, boxes only (no high-segment capsule → ~110 tris, well under budget),
// feet at y=0 so the formation footprint + the y:0.55 muzzle from Crowd stay valid. Each
// part is a named Mesh; the name maps to a baked aLimb id (LIMB_BY_NAME). Forward = +Z;
// the gun points +Z. Used by the generator (export) and the load-error fallback.
export function buildSoldierParts() {
  const g = new THREE.Group()
  const add = (geo, name) => {
    const m = new THREE.Mesh(geo)
    m.name = name
    g.add(m)
  }
  // legs (swing about HIP_Y)
  add(box(0.12, 0.42, 0.14, 0.085, 0.21, 0), 'legL')
  add(box(0.12, 0.42, 0.14, -0.085, 0.21, 0), 'legR')
  // core (body bob only): torso, backpack, head, helmet
  add(box(0.3, 0.36, 0.18, 0, 0.6, 0), 'core')
  add(box(0.22, 0.24, 0.1, 0, 0.6, -0.15), 'core')
  add(box(0.17, 0.17, 0.17, 0, 0.87, 0), 'core')
  add(box(0.23, 0.1, 0.23, 0, 0.95, 0), 'core')
  // arms (swing about SHOULDER_Y, contralateral to the same-side leg)
  add(box(0.1, 0.34, 0.12, 0.235, 0.62, 0.03), 'armL')
  add(box(0.1, 0.34, 0.12, -0.235, 0.62, 0.03), 'armR')
  // gun held forward on the right (swings with the right arm)
  add(box(0.07, 0.09, 0.5, -0.17, 0.66, 0.3), 'armR')
  return g
}

// Bake each mesh's world matrix + a per-vertex `aLimb` attribute (from its name) and merge
// to ONE BufferGeometry (position, normal, aLimb). Marked userData.shared so Track.dispose
// never frees this page-lifetime singleton. Accepts the GLTF scene or buildSoldierParts().
export function mergeSoldierGeometry(root) {
  root.updateMatrixWorld(true)
  const geos = []
  root.traverse((o) => {
    if (!o.isMesh) return
    // GLTFExporter de-dupes repeated node names with a _N suffix (core_1, armR_1=gun); strip
    // it so the limb tag still resolves on the round-tripped asset.
    const code = LIMB_BY_NAME[o.name.replace(/_\d+$/, '')] ?? LIMB.CORE
    // non-indexed so a mixed indexed/non-indexed GLTF still merges cleanly (low-poly: cheap)
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
    geo.applyMatrix4(o.matrixWorld)
    for (const k of Object.keys(geo.attributes)) {
      if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k)
    }
    const n = geo.attributes.position.count
    geo.setAttribute('aLimb', new THREE.BufferAttribute(new Float32Array(n).fill(code), 1))
    geos.push(geo)
  })
  const merged = mergeGeometries(geos, false)
  geos.forEach((geo) => geo.dispose())
  merged.userData.shared = true
  return merged
}

// ── vertex-animation material (onBeforeCompile) ──
// Per-instance phase from gl_InstanceID (three r169 is WebGL2 → always available; 0 for the
// non-instanced leader). `uTime` is the shared SOLDIER_TIME; uFreq/uSwing/uBob are captured
// per material so each colour variant tunes its own motion while sharing one program.
const VERT_HEADER = `
attribute float aLimb;
uniform float uTime;
uniform float uFreq;
uniform float uSwing;
uniform float uBob;
float soldierPhase() {
  uint h = uint(gl_InstanceID) * 747796405u + 2891336453u; // non-degenerate at id==0
  h ^= h >> 16u;
  return float(h & 0xffffu) / 65535.0 * 6.2831853;
}
void soldierSwing(inout vec3 p, float pivotY, float c, float s) {
  float dy = p.y - pivotY;
  float pz = p.z;
  p.y = pivotY + dy * c - pz * s;
  p.z = dy * s + pz * c;
}
`

const VERT_POSITION = `
{
  float ph = uTime * uFreq + soldierPhase();
  transformed.y += uBob * abs(sin(ph));
  float pivotY = 0.0;
  float sgn = 0.0;
  float amp = uSwing;
  if (aLimb > 0.5) {
    if (aLimb < 2.5) { pivotY = ${HIP_Y.toFixed(3)}; sgn = aLimb < 1.5 ? 1.0 : -1.0; }
    else { pivotY = ${SHOULDER_Y.toFixed(3)}; sgn = aLimb < 3.5 ? -1.0 : 1.0; amp = uSwing * 0.8; }
  }
  if (sgn != 0.0) {
    float ang = sgn * amp * sin(ph);
    soldierSwing(transformed, pivotY, cos(ang), sin(ang));
  }
}
`

const VERT_NORMAL = `
{
  float ph = uTime * uFreq + soldierPhase();
  float sgn = 0.0;
  float amp = uSwing;
  if (aLimb > 0.5) {
    if (aLimb < 2.5) { sgn = aLimb < 1.5 ? 1.0 : -1.0; }
    else { sgn = aLimb < 3.5 ? -1.0 : 1.0; amp = uSwing * 0.8; }
  }
  if (sgn != 0.0) {
    float ang = sgn * amp * sin(ph);
    soldierSwing(objectNormal, 0.0, cos(ang), sin(ang)); // rotate the direction (pivot 0)
  }
}
`

export function makeSoldierMaterial(color, anim = SOLDIER_ANIM.follower) {
  const { freq, swing, bob } = anim
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.62 })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = SOLDIER_TIME // shared object (mutated by tickSoldiers)
    shader.uniforms.uFreq = { value: freq }
    shader.uniforms.uSwing = { value: swing }
    shader.uniforms.uBob = { value: bob }
    shader.vertexShader =
      VERT_HEADER +
      shader.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>' + VERT_NORMAL)
        .replace('#include <begin_vertex>', '#include <begin_vertex>' + VERT_POSITION)
  }
  // All soldier materials share one compiled program (identical injected source); only the
  // uniform VALUES differ — keep the cache key constant so colour variants don't fork programs.
  mat.customProgramCacheKey = () => 'soldier-anim'
  return mat
}
