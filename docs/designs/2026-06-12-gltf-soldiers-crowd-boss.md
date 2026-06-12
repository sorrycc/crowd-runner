# GLTF Soldiers, Animated Crowd & Menacing Boss

## 1. Background

Soldiers, crowd and boss currently render as bare primitives: every soldier is a
merged capsule + box gun + box helmet (`src/util/soldier.js`), and the boss is a
capsule + 2 sphere eyes + 1 cylinder barrel (`src/entities/Boss.js`). They read as
abstract blobs and animate with a single global `sin(_bob*…)` bounce shared across the
whole army. This rework makes them **look and feel real** — humanoid GLTF soldiers,
per-instance desynced marching, visible combat feedback, and a multi-state menacing
boss — without regressing the one-draw-call crowd model, gameplay balance, or the
headless verifier.

This intentionally amends the README's "only simple primitives, no external
3D/texture assets" promise: bundled, CC0, self-authored GLTF models are now allowed,
recorded in `CREDITS.md` exactly like the bundled CC0 audio.

## 2. Requirements Summary

**Goal:** Replace bare-primitive soldiers/crowd/boss with a bundled humanoid GLTF +
alive per-instance motion + combat feedback + a menacing multi-state boss, keeping the
crowd one draw call, the balance numbers, and `npm run verify` intact.

**Scope (in):** self-authored low-poly humanoid soldier GLTF (head/torso/arms+gun/legs)
recolored for green followers / orange leader (1.25×) / red enemies; per-instance
vertex-shader limb animation on follower + enemy InstancedMeshes (phase desync);
distinct procedural leader run cycle; muzzle flash, soldier loss poof, enemy hit
reaction; richer boss with pre-shot wind-up telegraph, HP damage states, death collapse;
async model load; README + CREDITS updates; a committed dev-only model generator.

**Scope (out):** gameplay/balance changes, new stages/gates/enemies/power-ups, audio
changes beyond keeping existing event hooks, true skeletal-clip animation (procedural
node animation used instead).

## 3. Acceptance Criteria

1. Leader, followers, and enemies clearly read as humanoid soldiers (head/torso/arms/
   legs + gun) from a bundled, self-authored CC0 GLTF; license + provenance in `CREDITS.md`.
2. Followers render as exactly one `InstancedMesh` (one draw call); each enemy squad
   renders as exactly one `InstancedMesh` — no per-soldier mesh explosion.
3. Followers AND enemy squads are visibly per-instance animated (marching with phase
   desync), replacing the old global `sin(_bob*12)` / `sin(_bob*8)` bobs; the leader has
   a distinct, richer/faster procedural run cycle.
4. Combat feedback present: muzzle flash at the firing front on each volley, soldiers
   visibly fall/poof when count drops, enemies show a hit reaction. Existing SFX still
   fire on the same events (shoot / hurt / enemy-down / boss-shot), hooks unchanged.
5. Boss is visibly more menacing: a pre-shot wind-up telegraph synced to the existing
   `fireInterval` / `_flash` cadence, an HP-driven scorch ramp plus 2 persistent damage
   thresholds (~66% / ~33%), and a death collapse on defeat.
6. GLTF loading is async and does not block first paint or the Start gesture; per-instance
   vertex count stays in today's low-poly ballpark; the one-InstancedMesh-per-group
   invariant holds at full `crowdCap` (200).
7. README's "primitives-only / no external assets" claim amended; `CREDITS.md` records
   the model asset(s), the generator script, and the CC0 license.
8. `npm run verify` (`scripts/verify-balance.mjs`) still passes **unchanged** — gameplay
   numbers, hitboxes, and derived geometry (`FORMATION_HALF_WIDTH`, boss-bullet
   `HIT_RADIUS`) stay valid; this is a visual-only rework.

## 4. Problem Analysis

The central tension: a real GLTF model wants skeletal animation, but per-instance
skeletal animation breaks instancing (would force one mesh per soldier → 200+ draw
calls, regressing AC2/AC6).

- **Per-instance skinning** — true skeletal animation per soldier -> rejected: breaks
  the single InstancedMesh; massive draw-call/CPU cost at `crowdCap` 200.
- **Morph targets per instance** — three's instanced morph support is limited and still
  needs uniform/attribute plumbing -> rejected: more complex than needed for a march bob.
- **Chosen: baked geometry + vertex-shader limb swing.** Build one InstancedMesh from
  the GLTF's merged geometry; bake a per-vertex `aLimb` id (which limb each vertex
  belongs to) and add a per-instance `aPhase` attribute. A small `onBeforeCompile` patch
  swings each limb around its joint pivot by `sin(uTime·freq + aPhase)`, desynced per
  instance. One draw call, GPU-cheap, visibly alive. Leader + boss are single meshes, so
  they get richer **procedural node-rotation** animation (no skeleton needed).

Offline asset sourcing mirrors the audio precedent (`CREDITS.md:30-41`,
`scripts/gen-audio.sh`): a committed **dev-only** Node script generates the binary `.glb`
and is never run in build/verify/CI; the committed asset is what ships.

## 5. Decision Log

**1. How to source the bundled GLTF (offline env)**
- Options: A) self-author via a committed dev-only Node generator using three's
  `GLTFExporter` · B) hand-place a real third-party CC0 `.glb` · C) fetch at build time
- Decision: **A)** — mirrors the audio precedent (committed asset + dev-only regen
  script, never run in CI); verified feasible (`GLTFExporter` produces a valid binary
  `.glb` headless in Node with a one-line `FileReader` polyfill). Self-authored = CC0,
  zero network. B is infeasible (no offline third-party asset available); C violates the
  offline ethos.

**2. Instancing vs. skeletal animation for the crowd**
- Options: A) per-instance skinning · B) instanced morph targets · C) baked merged
  geometry + vertex-shader limb swing keyed on a baked `aLimb` attr
- Decision: **C)** — the only option that keeps one InstancedMesh per group (AC2/AC6).

**2b. Per-instance phase source (Revised in Phase 4 review)**
- Options: A) a per-instance `aPhase` `InstancedBufferAttribute` (lives on geometry → forces
  one geometry per mesh, or clobbers phases if geometry is shared) · B) derive phase from
  `gl_InstanceID` via a hash in the vertex shader (no attribute)
- Decision: **B)** — three r169 is WebGL2-only, so `gl_InstanceID` is always available in the
  vertex shader (and is `0` for a non-instanced draw, fine for the single-mesh leader). A
  per-instance phase `= hash(gl_InstanceID)` needs **no geometry-level attribute**, which lets
  **one shared, read-only merged geometry** back the followers, the leader, and every enemy
  squad — `instanceMatrix` is mesh-level (not a geometry attribute), so multiple InstancedMeshes
  share one geometry safely. This collapses the reviewer's swap/aPhase/per-mesh-geometry cluster.
  (Fallback if `gl_InstanceID` ever misbehaves: a per-mesh `aPhase` attribute on a per-mesh
  geometry clone — not chosen.)

**3. Leader animation (Revised in Phase 4 review)**
- Options: A) a separate procedural node-rotation **rig** (`makeLeaderRig`/`animateLeaderRig`,
  named-node cloning) · B) the **same vertex-anim shader material** as followers, tuned with
  punchier `uFreq`/`uSwing` uniforms, on a single `Mesh` of the shared geometry
- Decision: **B)** — DRY: one animation path, no second rig system, no named-node/fallback-rig
  contract. "Distinct" (AC3) comes from leader-tuned uniforms (faster cadence, bigger swing) +
  the 1.25× size + orange color. Leader scale: the shared geometry is **unscaled**, so 1.25 is
  applied via `leader.scale`, composed with the reinforce pop as `setScalar(1.25 * popScale)`
  (the `Crowd.js:120-121` "baked at 1.25, do not multiply" comment is updated to match).

**4. Boss model source**
- Options: A) a second bundled boss `.glb` · B) richer procedural primitive assembly in `Boss.js`
- Decision: **B)** — AC1's "from a bundled GLTF" lists only leader/followers/enemies; AC5
  only requires a "more menacing model," not a GLTF. A richer procedural boss avoids a
  second asset and keeps the muzzle origin aligned with `_fire` (YAGNI).

**5. Boss damage states**
- Options: A) color ramp only · B) color/scorch ramp + 2 persistent thresholds · C) 3+ thresholds
- Decision: **B)** — AC5 says "states" (plural); a continuous scorch/darken ramp on
  `hpFraction` PLUS persistent damage revealed at ~66% / ~33% (crack/scorch emissive +
  structural droop + attached smoke puffs), layered on the existing red wind-up flash.
  Two thresholds, not three (YAGNI).

**6. Async load + first-paint (AC6) (Revised in Phase 4 review)**
- Options: A) build a synchronous fallback humanoid + hot-swap geometry on ready ·
  B) build the static world + UI synchronously for instant first paint, then build `Crowd`
  + `Track` once `soldierModelReady` resolves (no fallback model, no swap)
- Decision: **B)** — KISS. The model is a small **bundled local** `.glb`; the load is kicked
  at module import and resolves in tens of ms, long before the user reads the menu and clicks
  Start. First paint is the menu over the static world (road / environment / sky) — none of
  which need the soldier model. `Crowd` and `Track` (which build the soldier InstancedMeshes
  and the enemy squads) are constructed in `soldierModelReady.then(...)`; `start()` calls
  `audio.unlock()`/`playMusic()` **synchronously first** (preserving the Start gesture for
  autoplay), then proceeds once entities exist (in practice already true). This deletes the
  fallback humanoid, the named-node fallback rig, and all swap/dispose/re-attach machinery
  that the reviewer flagged (points 1, 2, 4, 8, 11, 12). **Graceful degradation:** if the
  `.glb` fails to load, `models.js` resolves the geometry from `buildSoldierParts()` (the same
  builder the generator uses) — an alternate *source at construction time*, still no swap.

**7. Enemy desync scope (AC3)**
- Options: A) followers only · B) followers + enemies
- Decision: **B)** — the issue groups "followers + enemies" on the same vertex-anim path;
  desync is free and replaces the global `sin(_bob*8)` bob (`Enemy.js:97`).

**8. Muzzle flash / loss-poof mechanism**
- Options: A) new dedicated pooled systems · B) reuse the existing `ParticlePool` via new
  `Effects` methods
- Decision: **B)** — `Effects`/`ParticlePool` already pool instanced sparks; add
  `Effects.muzzleFlash()` (2-3 bright sparks) and `Effects.soldierPoof()` (olive puff
  alongside the existing `lossShards`). No new system (KISS/DRY). Muzzle flash fires **at
  most once per `_fire(...)` call** — outside the `while (_fireAcc >= FIRE_CADENCE)` loop,
  gated on a volley having actually spawned — so it never multi-bursts on frame catch-up and
  stays inside the 320 particle budget (mirrors how `shoot` SFX uses its own cadence,
  `Game.js:291-296`). (Revised in Phase 4 review — was "per volley tick".)

**9. Shared soldier geometry lifetime / disposal (Phase 4 review)**
- The shared merged soldier geometry is **page-lifetime** (like the bullet/particle pools and
  the decoded audio buffers) — referenced by `Crowd` (page-lifetime) and by enemy squads
  (rebuilt every stage). `Track.dispose()` currently disposes every entity geometry
  (`Track.js:38-48`); it must **not** dispose the shared geometry. `mergeSoldierGeometry`
  marks it `geometry.userData.shared = true`, and `Track._removeObject` guards with
  `if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose()` (review point 2) —
  the exact same memoized geometry object from `models.js` is what every enemy mesh holds, so
  the flag is present; the boss group's own geometry is **not** flagged → still disposed.
  This must hold across every `restart()` / `_advanceStage()` rebuild (`Game.js:127,135`).
  Enemy materials stay per-instance and are still disposed. Per-group size differs via the
  instance transform, not the geometry: enemy 0.95 via the `_dummy` scale (`Enemy.js:67-68`),
  leader 1.25 via `leader.scale` (Decision 3) — shared geometry stays unscaled.

## 6. Design

### 6.1 Soldier model & limb tagging (`scripts/gen-models.mjs`, `src/util/soldier.js`)

The humanoid is a low-poly assembly of boxes, **feet at y=0** (matches today's footprint
so formation packing at `SPACING 0.34` and the `y:0.55` muzzle stay valid). Parts and
their baked `aLimb` ids (shared constants in `soldier.js`, imported by the generator):

- `CORE` (0): hips + torso + head + helmet + backpack — body bob only, no swing.
- `LEG_L` (1) / `LEG_R` (2): swing about `HIP_Y` (~0.42), contralateral phase.
- `ARM_L` (3) / `ARM_R` (4): swing about `SHOULDER_Y` (~0.70), opposite the same-side leg.
- The gun is parented to the right arm group (`ARM_R`) so it tracks the arm.

`gen-models.mjs` builds the humanoid via the shared `buildSoldierParts()` (below),
strips UVs (solid colors, no textures), and exports `src/assets/models/soldier.glb`
(binary, via `GLTFExporter` + a one-line `FileReader` polyfill). It **logs the merged
triangle count** so the AC6 budget is checkable. Dev-only; never run in build/CI.

The humanoid is built from **boxes only** (no high-segment capsule), so the per-instance
triangle count lands well under the AC6 budget (target **≤ ~300 tris/soldier**, i.e. within
~3× of today's capsule+2-box soldier — see §8). `buildSoldierParts()` is the single source
of geometry + node names + `aLimb` tagging, shared by the generator and the load-error path.

`soldier.js` exports (pure, Node-importable — imports only `three` + `BufferGeometryUtils`,
no DOM, no `GLTFLoader`):
- limb constants + pivot Ys (`LIMB`, `HIP_Y`, `SHOULDER_Y`, `LIMB_BY_NAME`) — single source
  of truth for both the generator and the merge step.
- `buildSoldierParts()` → the named-part humanoid `Group` (used by the generator and the
  load-error fallback source).
- `mergeSoldierGeometry(object3D)` → bakes each mesh's world matrix + a per-vertex `aLimb`
  attribute (from the mesh name) and merges to one `BufferGeometry` (position, normal,
  aLimb); marks `geometry.userData.shared = true` (Decision 9).
- `makeSoldierMaterial(color, { freq, swing, bob })` → `MeshStandardMaterial` with the
  vertex-anim `onBeforeCompile` installed; per-material `uFreq/uSwing/uBob` uniforms (the
  leader passes punchier values for its distinct cadence) and the **shared** `uTime`.
- `SOLDIER_TIME = { value: 0 }` + `tickSoldiers(dt)` — one shared clock. Each material's
  `onBeforeCompile` does `shader.uniforms.uTime = SOLDIER_TIME` (assigns the **shared
  object**, not a copy); `tickSoldiers` mutates only `SOLDIER_TIME.value`. This is the
  supported three pattern (Phase 4 review point 9 — no per-material value copies).

**Vertex shader patch (`onBeforeCompile`) — TWO injections (review point 3):**
- (a) **Prepend to `shader.vertexShader` (top scope)** the attribute, uniforms, and a
  helper function (GLSL forbids nested functions, so this must NOT go inside `begin_vertex`):
```glsl
attribute float aLimb;                 // per-vertex limb id (baked)
uniform float uTime, uSwing, uBob, uFreq;
float phaseHash(int id){               // pseudo-random 0..2π; non-degenerate at id==0
  uint h = uint(id)*747796405u + 2891336453u; h ^= h>>16;
  return float(h & 0xffffu)/65535.0 * 6.2831853;
}
```
- (b) **Replace `#include <begin_vertex>`** with the transform body:
```glsl
vec3 transformed = vec3(position);
float ph = uTime*uFreq + phaseHash(gl_InstanceID);   // gl_InstanceID==0 for the leader mesh
transformed.y += uBob * abs(sin(ph));                 // body bob
// per-limb swing about its pivotY (pivotY/sign chosen by aLimb; legs↔arms contralateral),
// also applied to objectNormal for lighting.
```
`transformed` is local/object space *before* `instanceMatrix` is applied in
`project_vertex` (verified: `project_vertex.glsl:10-12`), so the same patch works for
instanced followers/enemies and the single-mesh leader. The hash mixes a constant so it is
**not degenerate at `id==0`** (review point 4) — the leader's distinctness still comes from
its punchier `uFreq/uSwing`, not the phase. No `aPhase` attribute → the geometry carries no
per-instance data → **one shared geometry backs every soldier mesh** (Decision 2b).

`uFreq/uSwing/uBob` are **closure-captured** from `makeSoldierMaterial(color, opts)` and
written as fresh `{value}` uniform objects per material inside `onBeforeCompile` (review
point 5) — distinct tuning per material while three still shares one compiled program
(keyed on the identical `onBeforeCompile` source). Only `uTime` is the shared `SOLDIER_TIME`
object.

### 6.2 Async model load (`src/util/models.js`)

New browser-only module. At import it kicks off `GLTFLoader.loadAsync(url)` where `url`
comes from the existing Vite glob pattern (`import.meta.glob('../assets/models/*.glb',
{ query: '?url', import: 'default', eager: true })` — same shape as `Audio.js:33-48`).
It builds the **shared merged geometry once** (memoized) and exports
`soldierModelReady: Promise<THREE.BufferGeometry>` resolving to that geometry. On load
error it resolves to `mergeSoldierGeometry(buildSoldierParts())` (graceful degradation —
still a single construction-time source, no swap). No top-level `await`; nothing blocks
the first frame or the Start gesture. **Purity contract (review point 7):** both
`models.js` and `gen-models.mjs` import the geometry builders (`buildSoldierParts`,
`mergeSoldierGeometry`) from the pure `soldier.js`; `models.js` is the **only** file that
imports `GLTFLoader`, so the Node generator never drags in DOM-dependent loader code.

### 6.3 Crowd (`src/entities/Crowd.js`)

`Crowd` is constructed (by `Game`) only after `soldierModelReady` resolves, so it receives
the shared geometry directly — no fallback geometry, no swap.
- Followers: `InstancedMesh(sharedGeo, makeSoldierMaterial(0x22c55e), cap)`. `mesh.count` /
  `instanceMatrix` / packing logic **unchanged** → still exactly one draw call. The limb
  march is entirely in the shader (phase from `gl_InstanceID`), so **zero extra per-follower
  CPU**.
- Leader: a single `Mesh(sharedGeo, makeSoldierMaterial(0xf97316, {leader-tuned freq/swing}))`
  — the same shader path, punchier uniforms = the distinct, faster run cycle (Decision 3).
  Replace the global `this.leader.position.y = sin(_bob*12)` bob (shader-driven now). Apply
  1.25 via `leader.scale`; change the pop to `setScalar(1.25 * popScale)` and update the
  `Crowd.js:120-121` comment.
- Keep `FORMATION_HALF_WIDTH`, `frontPosition`, all count math **unchanged** (AC8).

### 6.4 Enemy (`src/entities/Enemy.js`)

`Track` (and thus `Enemy`) is built after the model is ready (Decision 6), so each squad
gets the shared geometry directly — no swap, no per-instance pop.
- `InstancedMesh(sharedGeo, makeSoldierMaterial(0xdc2626), maxVisible)`, replacing
  `makeSoldierGeometry({scale:0.95})`. The 0.95 size is applied via the `_dummy` scale in
  `_layout` (`Enemy.js:67-68`), not the (shared) geometry. Drop the global `sin(_bob*8)` bob
  and remove the now-dead `_bob` field (review point 6). Do **not** dispose the shared
  geometry (Decision 9). Note: the shader bob lives in object space (before `instanceMatrix`),
  so a 0.95-scaled enemy bobs ~5% less than a follower — acceptable, no gameplay/AC8 impact.
- Hit reaction: a `_hitFlash` timer set on every `damage(amount>0)` call (continuous focus
  fire keeps it lit → the squad flashes while under fire) and a tiny z-shudder; decays in
  `update`. Material color lerps base→white by `_hitFlash`. Death flash/scale-pop and the
  visible-count shrink (`_refresh`) are unchanged.

### 6.5 Game hooks (`src/Game.js`)

- Build `Crowd` + `Track` inside `soldierModelReady.then(geo => { … this._ready = true;
  if (this._pendingStart) this._beginStart() })`; render the static world + menu immediately
  before then (Decision 6). **Start-before-ready guard (review point 1):** `start()` ALWAYS
  runs `audio.unlock()/playMusic()` synchronously first (preserve the autoplay gesture even
  if entities aren't built); then if `this._ready` it calls `_beginStart()` (the existing
  `_resetStageState`/HUD path), else it sets `this._pendingStart = true` and the `.then`
  drains it. So a Start click during a slow/cold model load never touches `undefined`
  `crowd`/`track`. (The static-world render loop doesn't reference `crowd`/`track` until
  `_update` runs in PLAYING, so the menu is safe meanwhile.)
- Call `tickSoldiers(dt)` once per frame in `_loop` to advance the shared soldier clock.
- `_fire`: **at most once per call** (outside the `while` loop, gated on a volley having
  spawned and `crowd.count>0`), `effects.muzzleFlash(m.x, m.y, m.z)` at the front muzzle.
  In BOSS phase the same hook flashes at the army front.
- On every soldier-loss event that already fires `lossShards` (`_resolveCrossings`
  block/enemy contact, `_resolveBossBullets`), also fire `effects.soldierPoof(...)`.
  Existing SFX (`hurt`, `enemy-down`, `shoot`, `boss-shot`) and all gameplay are untouched.

### 6.6 Effects (`src/effects/Effects.js`)

- `muzzleFlash(x, y, z)` → `particles.burst` with ~3 bright-yellow sparks, low speed,
  short life (~0.07s), forward bias. Negligible concurrent count.
- `soldierPoof(x, y, z)` → olive/green puff (~10 particles) selling falling soldiers,
  fired alongside `lossShards`.

### 6.7 Boss (`src/entities/Boss.js`)

Richer procedural model (single `Group`): hulking shouldered torso, visored head with
emissive red eyes, shoulder pauldrons, a large cannon arm, spikes/horns. Larger overall.
**Muzzle origin is unchanged:** `_fire` keeps its fixed spawn constants (`ox=0, oy=1.9,
oz=this.z-1.4`, `Boss.js:126-128`) and the same trajectory math — so the boss-bullet path
that `HIT_RADIUS` reasoning depends on stays identical (AC8). All wind-up / droop motion
below is **cosmetic on child nodes only** and never moves the spawn point.

- **Wind-up telegraph (AC5):** each frame compute
  `charge = clamp((_fireTimer - (fireInterval - WINDUP)) / WINDUP, 0, 1)`. As `charge`
  rises over the last ~0.4s before a shot: cannon emissive ramps up, eyes brighten, and a
  child "charge" core glows / the torso leans back slightly (the barrel-tip spawn point is
  fixed regardless). At fire (`_fire`) release: existing red `_flash` + a brief recoil on a
  child node + muzzle flash. Synced to the existing `fireInterval` cadence.
- **Damage states (AC5):** `bodyMat` lerps base red → charred as `hpFraction` drops
  (continuous). `_damageStage` 0→1 at `hpFraction<0.66`, 1→2 at `<0.33`: reveal persistent
  scorch (emissive crack glow), add a structural droop/tilt, and fade in attached dark
  smoke-puff meshes that slowly rise/loop (self-contained — no `Effects` coupling, keeping
  the Boss↔Game decoupling at `Boss.js:74`).
- **Death collapse (AC5):** extend `updateDeath` — keep the scale punch + white flash, add
  a topple (rotate the group over on X) and sink, driven by `Game`'s existing
  `WIN_SEQUENCE` hold (`BOSS_DEATH_TIME`). `update()` signature, `hpFraction`,
  fire timing, and the `fired` return signal are unchanged (AC8).

### 6.8 Verifier & balance (`scripts/verify-balance.mjs`)

Untouched. This is visual-only: no config numbers, hitboxes, `FORMATION_HALF_WIDTH`,
`HIT_RADIUS`, fire cadence, or combat math change. `npm run verify` must pass as-is (AC8).

## 7. Files Changed

- `scripts/gen-models.mjs` — NEW dev-only generator: builds the humanoid, exports `soldier.glb`.
- `src/assets/models/soldier.glb` — NEW committed CC0 binary asset (generated).
- `src/util/models.js` — NEW async `GLTFLoader` preload path (Vite `?url` glob); memoizes the
  shared merged geometry; error-path falls back to `mergeSoldierGeometry(buildSoldierParts())`.
- `src/util/soldier.js` — REPLACE `makeSoldierGeometry` (update its 3 call sites): limb
  constants, `buildSoldierParts`, `mergeSoldierGeometry` (bake+tag+`userData.shared`),
  `makeSoldierMaterial(color, opts)` vertex-anim material, `SOLDIER_TIME`/`tickSoldiers`.
- `src/entities/Crowd.js` — followers + leader use the shared geometry + shader material
  (leader = single mesh, punchier uniforms, `1.25 * popScale`); drop the global leader bob.
- `src/entities/Enemy.js` — instanced shared geometry + shader material (0.95 via dummy
  scale); hit-flash reaction; don't dispose the shared geometry.
- `src/entities/Boss.js` — richer model, wind-up telegraph, damage states, topple collapse
  (muzzle-origin constants unchanged).
- `src/world/Track.js` — `_removeObject` skips disposing geometry flagged `userData.shared`.
- `src/Game.js` — build `Crowd`/`Track` on `soldierModelReady`; `tickSoldiers(dt)`;
  `muzzleFlash` (≤1/`_fire`); `soldierPoof` on loss.
- `src/effects/Effects.js` — `muzzleFlash()` + `soldierPoof()`.
- `README.md` — amend the "primitives-only / no external assets" claim; note the model asset.
- `CREDITS.md` — record `soldier.glb` (self-authored CC0) + `scripts/gen-models.mjs`.

## 8. Verification

1. [AC1] Run `npm run dev`; leader/followers/enemies read as humanoid soldiers with
   head/torso/arms/gun/legs; confirm the model is loaded from `soldier.glb` (Network tab).
2. [AC2] In the running scene, followers = one InstancedMesh, each enemy squad = one
   InstancedMesh (one draw call each); no per-soldier `Mesh` is created at `crowdCap` 200.
   All soldier meshes share one `BufferGeometry` instance.
3. [AC3] The army marches with visible per-instance phase desync (not a single global
   bob); enemies too; the leader has a distinct, richer/faster run cycle.
3b. [AC6] The generator logs the merged soldier triangle count; confirm it is **≤ ~300
   tris** (within ~3× of today's soldier) — the concrete per-instance budget.
4. [AC4] Muzzle flashes appear at the firing front each volley; soldiers poof on loss;
   enemies flash/recoil under fire; `shoot`/`hurt`/`enemy-down`/`boss-shot` SFX still fire.
5. [AC5] Boss shows a pre-shot wind-up synced to its fire cadence; scorches + reveals
   damage at ~66%/33%; topples/collapses on defeat.
6. [AC6] First paint (menu over the static world) + the Start gesture are not blocked by
   model loading; `Crowd`/`Track` build on `soldierModelReady` (resolves in tens of ms from
   the bundled local `.glb`); full `crowdCap` army runs smoothly.
7. [AC7] README claim amended; CREDITS records the model + generator + CC0.
8. [AC8] `npm run verify` passes unchanged; `npm run build` succeeds with `soldier.glb`
   emitted as a bundled asset.
