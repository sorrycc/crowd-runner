# Swarm Run — Combat Juice: Visual Feedback for Gains, Losses & Kills

## 1. Background

Swarm Run is a Three.js + Vite hypercasual crowd-shooter. Today most key combat
moments are silent visually: gates/blocks/enemies just set `group.visible = false`,
the soldier count snaps up/down with no popup, and the boss vanishes on death. This
feature adds pooled, primitives-only visual "juice" so gains, losses, and kills *feel*
like they happened. **Visuals only — no audio** (audio already exists separately in
`src/core/Audio.js`; this feature does not touch it).

## 2. Requirements Summary

**Goal:** Add four pooled, primitives-only effect systems — floating +N/−N numbers,
instanced particle bursts, additive camera shake, and body hit-flash/scale-pop — driven
from the seven combat events the game already detects. Cosmetic only: no change to
gameplay balance, timing (except the explicitly-required brief boss-death celebration
hold), or the count source-of-truth. No new dependencies, no asset files.

**In scope:** the seven events — soldiers gained (gate add/mul, reinforce power-up),
soldiers lost (boss bullet, block contact, enemy contact), boss destroyed, enemy squad
destroyed, block crumbled, gate picked, power-up grabbed.

**Out of scope:** any audio; textures/asset files; new deps; gameplay-balance/timing/
count changes; popup time-window aggregation; per-frame attachment bookkeeping for
transient popups.

## 3. Acceptance Criteria

1. Every discrete count change shows exactly one floating +N (green) / −N (red) popup at
   the leader's world position, rising and fading, using the net delta of that event.
2. Gains (gate add/mul, reinforce power-up) show a green particle puff plus a crowd
   scale-pop.
3. Soldier losses (boss bullet, block contact, enemy contact) show red shards plus a
   light decaying screen shake.
4. Enemy squad destruction and block crumble show a particle burst plus a body
   hit-flash/scale-pop — no longer merely `visible=false` without feedback.
5. Boss death triggers a large multi-stage particle burst plus a heavy screen shake
   before the win screen appears.
6. Power-up pickup shows a distinct grab pop, separate from the gate gain popup.
7. No new dependencies and no asset files; gameplay balance, timing (other than the brief
   boss-death hold), and count source-of-truth unchanged; all effects pooled with no
   per-frame hot-path allocation; on restart and stage advance all in-flight popups,
   particles, and shake are hard-cut (active flags reset, shake → 0, scale-pop reset) with
   no orphaned meshes or leaks.

## 4. Problem Analysis

- **Approach A — thread an `effects` ref into every entity** (Track → Gate/Obstacle/
  Enemy/Boss, entities call effects directly) -> rejected: maximises coupling; entities
  would need scene-space leader position they don't own; Track plumbing churn.
- **Approach B — Game-driven triggers + one `Effects` manager** -> chosen: every event is
  *already* detected in `Game` (`Game.js:206-207` branch on `target.broken`/`target.dead`;
  `_resolveCrossings` has `drained`; `_resolveBossBullets` has the burst; `_applyPowerup`
  has the type). Particles/numbers/shake/crowd-pop trigger from there with zero new entity
  coupling. The only effect that must live *inside* an entity — the multi-frame body
  hit-flash/scale-pop on enemy/block — is self-contained, started from that entity's own
  `_die`/`_break`.
- **Approach C — event bus / observer** -> rejected: YAGNI; one consumer, deterministic
  per-frame order already exists.

## 5. Decision Log

**1. Where effects live / how triggered**
- Options: A) ref threaded into entities · B) Game-driven + `Effects` manager · C) event bus
- Decision: **B)** — all seven events already surface in `Game`; mirrors how SFX already
  fire from the same sites (e.g. `Game.js:206`, `:300`, `:337`, `:346`). Body hit-flash is
  the lone exception and lives inside the entity (`_die`/`_break`), decayed in its own
  `update`.

**2. Particle pool shape**
- Options: A) position + uniform-scale + gravity + per-instance color (mirror BulletPool) ·
  B) add per-instance rotation arrays for tumbling shards
- Decision: **A)** — spec says "mirror the BulletPool pattern." One `InstancedMesh`, flat
  `Float32Array` state, `instanceColor` for per-event tint, gravity + life-based shrink,
  scale-0 inactive. Rotation arrays are YAGNI for the read we need.

**3. Floating-text: reuse `util/text.js` or modify it**
- Options: A) reuse `makeTextSprite` as-is (transparent bg + `accent:null`, mutate
  `userData.opts.color` per pop) · B) add a new variant to `util/text.js`
- Decision: **A)** — `updateTextSprite` already reads `bg`/`accent`/`color` from
  `userData.opts` (text.js:51-53); transparent bg + null accent yields clean plate-less
  floating text with zero changes to the shared helper.

**4. Boss death "before the win screen"**
- Options: A) immediate win (burst fizzles after screen shows) · B) brief `WIN_SEQUENCE`
  hold (~1.1s) that freezes `_update`, ticks multi-stage burst waves + heavy shake + boss
  flash/scale, then runs the original advance / `_end('WIN')`
- Decision: **B)** — AC5 requires the burst "before the win screen." The hold is the only
  timing change and is purely cosmetic (boss already dead, lose-check frozen); does not
  touch balance or count.

**5. Death-lingering for enemy/block (so the hit-flash is visible)**
- Options: A) keep instant `visible=false`, external particles only · B) flip the gameplay
  flag (`dead`/`broken`) immediately, keep the *group* visible ~0.25s for a flash + scale
  punch, then hide
- Decision: **B)** — AC4 wants "a burst + hit-flash, not just disappearing." Gameplay flags
  flip at the same instant they do today (targeting/collision already skip `dead`/`broken`),
  so balance is untouched; only the mesh lingers. Enemies already `update(dt)` each frame
  (`Game.js:194`); obstacles get a new `o.update(dt)` loop in the RUN phase.

**6. Effects update cadence**
- Options: A) update particles/popups inside `_update` (only when PLAYING) · B) update in
  `_loop` every frame regardless of state
- Decision: **B)** — `_loop` already calls `sm.chase` + `sm.render` every frame
  (`Game.js:381-382`); effects must keep animating during the `WIN_SEQUENCE` hold and on
  end screens. `effects.update(dt)` goes in `_loop`.

## 6. Design

### 6.1 New module: `src/effects/ParticlePool.js`

A faithful sibling of `BulletPool`. One `InstancedMesh` of a small box geometry
(primitives only), `cap` slots, flat `Float32Array` state. Adds gravity + life-based
shrink + per-instance color (`instanceColor`).

State arrays: `active[]`, `px/py/pz`, `vx/vy/vz`, `life`, `maxLife`, `size`. Rotating
free-slot cursor (`_next`) exactly like BulletPool.

**Material / per-instance colour (the one place we extend past BulletPool — review item
6):** BulletPool uses `MeshStandardMaterial`+emissive and never sets `instanceColor`. Here
we need per-particle colour (green puff vs red shards must read distinctly — AC2/AC3), so:
- Material is `MeshBasicMaterial({ color: 0xffffff, toneMapped: false })` — **unlit**, so
  the final fragment colour is `material.color × instanceColor` with no light/emissive
  dependency. This guarantees pure, vivid green/red/debris regardless of scene lighting and
  sidesteps the emissive trap (emissive is *not* modulated by `instanceColor`, so an
  emissive material would tint every particle the same hue — review item 6).
- The ctor allocates the instance colour buffer explicitly:
  `this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap*3), 3)`.

```
spawn(x,y,z, vx,vy,vz, life, size, r,g,b)   // one particle
burst(x,y,z, opts)                            // N particles, randomized cone
update(dt)                                    // integrate + gravity + shrink, scale-0 dead
clear()                                       // reset active flags + zero matrices (NOT colors)
```

`burst(x,y,z,{count,color,speed,spread,up,gravity,size,life,sizeJitter})`: for each of
`count`, pick a random direction (spherical, biased upward by `up`), magnitude
`speed*(0.5..1)`, write velocity + colour (a single module-scratch `THREE.Color` → r,g,b
into the slot's `instanceColor`). `gravity` stored on the pool (single constructor value,
default 9; all current events share one g). Per-particle scale each frame =
`size * (life/maxLife)` so they shrink out. `Math.random()` is fine here (browser runtime,
not a workflow script).

**Colour-buffer contract (review items 6/7):** `spawn`/`burst` write `instanceColor` and set
`this.mesh.instanceColor.needsUpdate = true`. `update()` sets `instanceMatrix.needsUpdate`
(not colour — colour only changes on spawn). `clear()` only resets active flags + zeroes
matrices (scale-0 hides any stale colour); it does **not** wipe the colour buffer (would be
redundant O(cap) writes).

### 6.2 New module: `src/effects/Effects.js`

Facade owned by `Game`. Holds:
- a `ParticlePool` (cap ~300),
- a small **floating-text pool**: 16 pre-built sprites from `makeTextSprite('',
  {accent:null, bg:'rgba(0,0,0,0)', font:'bold 90px system-ui, sans-serif', scale:1.8})`,
  added to the scene, `visible=false`. Per-slot state: `active`, `life`, `maxLife`, `vy`,
  `x/y/z`. Reuse on pop: set `sprite.userData.opts.color`, `updateTextSprite(sprite, text)`,
  position, `material.opacity=1`, `visible=true`.
  - **Cap justification (review item 8):** distinct count-change events that can co-occur in
    one frame are bounded — at most one gate cross + one block/enemy contact + one boss-bullet
    hit ≈ 3 (the per-frame order in `Game._update` resolves them sequentially). With a ~0.8s
    life and 16 slots, ~20 events would have to land inside one lifetime to overflow, which the
    level pacing never produces. So AC1's "exactly one popup per event" holds; overflow policy
    is the same bounded free-slot scan as BulletPool (drop on full) but is unreachable in
    practice.
  - **No per-frame canvas work (review item 9):** `updateTextSprite` (a full 256×128 canvas
    redraw + texture upload) is called **only** on `number()` spawn. The per-frame `update`
    mutates **only** `position.y`, `material.opacity`, and `scale` — never the canvas/texture.
- a back-reference to `SceneManager` for shake.

High-level event methods (called from `Game`), each a thin composition of
number/burst/shake/pop:

```
number(delta, x, y, z)         // +N green / −N red, rising+fading popup
gainPuff(x,y,z)                // green puff (gate gain / reinforce)
lossShards(x,y,z)              // red shards + (caller also shakes light)
gatePick(x,y,z, good)          // small green/red puff at the gate
blockBreak(x,y,z)              // brown/grey debris burst
enemyDeath(x,y,z)              // red burst
powerupGrab(x,y,z, color)      // distinct grab pop in the powerup colour
bossDeathWave(x,y,z, stage)    // one wave of the multi-stage boss burst
update(dt)                     // advance particles + floating text
clear()                        // hard-cut: particle clear + all popups off
```

`number()`: `text = (delta>0?'+':'−') + Math.abs(delta)`, color green `#22c55e` for gains /
red `#f87171` for losses; spawn ~0.5u above the leader; `vy≈1.6`, `maxLife≈0.8s`. In
`update`, `y += vy*dt`, `life -= dt`, `material.opacity = max(0, life/maxLife)`, slight
scale ease-in; deactivate + `visible=false` at `life<=0`.

### 6.3 `SceneManager` — additive camera shake

Add `this._shake = 0`. New method `shake(amount){ this._shake = Math.max(this._shake,
amount) }`. In `chase(leaderPos, dt, snap)`, after the existing `lerp`:

```
if (snap) this._shake = 0
else if (this._shake > 0) {
  const k = this._shake
  this.camera.position.x += (Math.random()*2-1) * k
  this.camera.position.y += (Math.random()*2-1) * k
  this._shake *= Math.exp(-SHAKE_DECAY * dt)        // single constant RATE, not k0-derived
  if (this._shake < 0.002) this._shake = 0          // hard floor → exactly 0
}
```

**Decay is a single frame-rate-independent constant rate (review item 13):**
`SHAKE_DECAY ≈ 6` (per second), applied multiplicatively so the result is independent of
frame timing. It is **not** derived from the initial amount `k0` — heavier shakes therefore
ring slightly longer than light ones, which is the desired feel (AC3 light vs AC5 heavy).
The `<0.002 → 0` floor guarantees it reaches exactly 0. Offset is applied to
`camera.position` *after* the lerp toward `desired`, so the next frame's lerp naturally
re-centres (decaying shake on top of the existing follow). `lookAt` is unchanged (positional
jitter alone reads as a shake). Light loss `shake(0.12)`, heavy boss `shake(0.6)`; `shake()`
combines via `Math.max` so an in-flight shake is never reduced by a weaker new one.

### 6.4 `Crowd` — scale-pop on gain

Add `this._pop = 0`. Method `pop(strength=0.35){ this._pop = Math.max(this._pop,
strength) }`. In `update`, decay `this._pop` toward 0 (`this._pop *= Math.exp(-POP_DECAY*dt)`
with a `<0.001 → 0` floor), then `s = 1 + this._pop` and (review item 12):
- **Leader** baseline scale is exactly 1 (the larger leader look comes from its geometry
  baked at `scale:1.25`, Crowd.js:37) — so `this.leader.scale.setScalar(s)` (NOT `1.25*s`;
  do not double-scale).
- **Followers** are re-written from `_dummy` every frame, so multiply: before
  `setMatrixAt`, `this._dummy.scale.setScalar(s)` (today it's implicitly 1).

`reset()` sets `this._pop = 0`; the next `update` then uses `s = 1`, restoring baseline (and
the advance frame's `crowd.update(0,0,0)` at Game.js:151 self-heals any mid-pop advance). No
allocation.

### 6.5 `Boss` — death sequence visual

Add `playDeath()` → sets `this._dying = BOSS_DEATH_TIME (~1.1s)`, hides the HP `tag`. Add
`updateDeath(dt)`: decays `_dying`; drives a scale-pop (quick punch up then collapse toward
0) on `this.group.scale` and a white flash on `bodyMat` (lerp `_baseColor`↔white by
`_dying` phase), and sets `group.visible=false` at the end. Called by `Game` during
`WIN_SEQUENCE`. The existing `_flash` muzzle-telegraph logic is untouched.

### 6.6 `Enemy` / `Obstacle` — death flash + scale-pop (linger then hide)

Both keep flipping their gameplay flag immediately (`dead`/`broken`) so targeting and
collision are byte-for-byte unchanged. Instead of `group.visible=false` *now*, start a
death anim (`_dying` initialised to `0` in the ctor so it's always a number):

- `Enemy._die()`: `this.dead = true; this._dying = DEATH_TIME (~0.28s); this.tag.visible =
  false`. The **precise new `update(dt)` guard (review item 11)**:
  - `if (this.dead && this._dying <= 0) return` — fully dead + hidden: do nothing (this
    catches the silent slip-past path below, which sets `dead` with `_dying` still 0).
  - `else if (this._dying > 0)` — tick the death anim only: decay `_dying`, flash the
    instanced material toward white, scale-punch `this.group.scale`, and at `_dying<=0` set
    `group.visible=false`. Do **not** run bob/march here.
  - `else` (alive) — run the existing bob + `marchSpeed` movement unchanged.
  The "dodged/slipped past" silent path in `Game` (`Game.js:315-316`) sets `dead=true;
  group.visible=false` with `_dying` left 0 → the first guard returns immediately, so a
  slipped-past enemy never keeps mutating `z` (review item 11). Keep it instant + silent.
- `Obstacle._break()`: same shape with the tire `this.mat`. Obstacle gains an `update(dt)`:
  `if (!this._dying) return; else { decay, flash, scale-punch, hide at 0 }`. `Game` adds
  `for (const o of this.track.obstacles) o.update(dt)` in the RUN phase. **Cost note (review
  item 10):** obstacles are static and few (≤4/stage); this is a bounded per-frame loop that
  no-ops unless exactly one block is mid-death — accepted as KISS over adding a Track-level
  dying counter.

Material flash reuses the boss idea: lerp `mat.emissive`/`color` toward white by the
normalized `_dying` phase; restore is moot because the group hides at the end. (`Enemy`/
`Obstacle` materials are per-instance, disposed by `Track.reset` — Enemy.js:34 / Obstacle.js:34
— so mutating them is leak-safe.)

### 6.7 `Powerup` — expose colour

Store `this.color = def.color` so `Game` can tint the grab pop in the power-up's colour
without re-deriving the type→colour map.

### 6.8 `Game` — wiring (the orchestration)

Constructor: `this.effects = new Effects(this.sm.scene, this.sm)` (after pools).

`_resetStageState`: add `this.effects.clear()` next to the bullet `clear()`s, **and reset the
win-sequence bookkeeping** `this._winTimer = 0; this._deathWave = 0` (review item 3 — so a
`restart()` mid-hold, which routes through `start()`→`_resetStageState`, can't strand stale
timer fields; `Track.reset` rebuilds the boss mesh, and `state` is set to `'PLAYING'` by
`start()`).

`_loop`: add `this.effects.update(dt)` and tick the win sequence **before** `sm.chase`:
```
this.effects.update(dt)
if (this.state === 'WIN_SEQUENCE') this._tickWinSequence(dt)
this.sm.chase(this.leaderPos, dt)
this.sm.render()
```
Ordering matters (review item 2): `_tickWinSequence` may call `sm.shake(...)` (applied by the
trailing `chase`) and, on completion, `_advanceStage()` whose `_resetStageState` does a
`sm.chase(...,snap=true)` that zeroes `_shake` — so the trailing non-snap `chase` runs with
`_shake===0` and the heavy boss shake is correctly hard-cut on advance (AC7).

Event triggers (all cosmetic, after the existing source-of-truth mutation):
- **Gate** (`_resolveCrossings`): capture `before=crowd.count`; after `g.apply`, `delta=
  crowd.count-before`; **`if (delta !== 0) effects.number(delta, leaderPos…)`** (review item 5
  — a no-op gate at cap, e.g. `mul`/`add` already at `crowdCap`, shows no popup, honouring
  AC1's "every count *change*"); `effects.gatePick(0, 2.6, g.z, good)` fires on every cross;
  if `delta>0` → `effects.gainPuff(leader…)` + `crowd.pop()`; if `delta<0` →
  `effects.lossShards(leader…)` (no shake — a gate choice isn't a hit).
- **Block contact** (`_resolveCrossings`): on `drained>0` → `number(-drained)`,
  `lossShards`, `sm.shake(LIGHT)`. On `o.broken` (always true after contact) →
  `blockBreak(o…)`.
- **Enemy contact** (`_resolveCrossings`): on `drained>0` → `number(-drained)`,
  `lossShards`, `sm.shake(LIGHT)`. On `e.dead` after contact → `enemyDeath(e…)`.
- **Focus-fire kills** (`_update` step 3): existing `if (target.broken)` → `blockBreak`;
  `else if (target.dead)` → `enemyDeath`. (The entity's own `_break`/`_die` already started
  its flash.)
- **Boss bullet** (`_resolveBossBullets`): wrap the `removeBurst`: capture before/after,
  `lost = before-after`; if `lost>0` → `number(-lost)`, `lossShards`, `sm.shake(LIGHT)`.
- **Power-up** (`_resolveCrossings`): after `p.collect()` → `effects.powerupGrab(p.x, 0.95,
  p.z, p.color)`. **Reinforce gain** stays in `_applyPowerup`: for `reinforce`, capture
  before/after, `delta=after-before`; if `delta>0` → `number(+delta)`, `gainPuff`,
  `crowd.pop()`.
- **Boss death** (`_update` win check, Game.js:223-234): the trigger stays **inside the
  existing `if (this.track.boss.hp <= 0 && this.timeRemaining > 0)` branch** so the
  win-before-lose precedence (win check at step 5 precedes the lose check at step 6) is
  byte-for-byte unchanged (review item 1). That branch, which today plays the SFX then
  advances/ends, becomes: **`this.audio?.play('boss-down')`** (preserved exactly — the
  feature must not drop existing audio; review item 4) then `this._beginBossDeath()`.
  - `_beginBossDeath()`: sets `state='WIN_SEQUENCE'`, `_winTimer=BOSS_DEATH_TIME (~1.1s)`,
    `_deathWave=0`, calls `boss.playDeath()`, fires the first `effects.bossDeathWave(boss…,0)`
    and `sm.shake(HEAVY=0.6)`. (Fires once: next frames `state!=='PLAYING'`, so `_update`
    early-returns at Game.js:165 and never re-enters this branch — same once-only guarantee as
    the old comment at Game.js:224-225. No lose transition can occur while in `WIN_SEQUENCE`.)
  - `_tickWinSequence(dt)` (called from `_loop`): `_winTimer -= dt`; `boss.updateDeath(dt)`;
    fire waves 1 & 2 as `_winTimer` crosses thresholds (each a smaller burst + light shake),
    tracking `_deathWave`; at `_winTimer<=0` run the original branch:
    `stageIndex < stages.length-1 ? this._advanceStage() : this._end('WIN')`.
  - `_advanceStage` adds `this.state = 'PLAYING'` at its end (it previously relied on state
    already being PLAYING; now it's re-entered from `WIN_SEQUENCE`). `_end('WIN')` already sets
    `state='WIN'`.

### 6.9 Pooling / no-leak guarantees

- `ParticlePool` mesh + the 16 floating-text sprites are **page-lifetime scene children**,
  created once in the `Effects` ctor and never disposed/removed — exactly like the bullet
  pools. Restart and stage advance only `clear()` their state (reset active flags, scale-0 /
  `visible=false`); they are **never** removed and re-added (doing so would reintroduce the
  churn Approach B avoids — review item 14). They are not `Track`-owned, so `Track.reset()`
  correctly leaves them alone. `clear()` is called from `_resetStageState` (restart + stage
  advance). No per-frame allocation: `update`/`burst` reuse a module `_dummy` `Object3D` and a
  module `THREE.Color` scratch.
- Entity flash/death state resets naturally because `Track.reset()` disposes + rebuilds
  every entity per stage (Track.js:59-63).
- Shake resets to 0 on camera `snap` (start/restart, `Game.js:152`) and decays to 0
  otherwise. Crowd `_pop` resets in `crowd.reset`.

## 7. Files Changed

- `src/effects/ParticlePool.js` — **new**: pooled instanced-box particle system (mirror of
  BulletPool) with gravity, per-instance colour, life-shrink, `burst()`, `clear()`.
- `src/effects/Effects.js` — **new**: facade owning the particle pool + floating-text
  sprite pool; high-level per-event methods; `update()` + `clear()`.
- `src/core/SceneManager.js` — add `shake(amount)` + additive decaying offset in `chase`.
- `src/entities/Crowd.js` — add `pop()` + scale-pop in `update`, reset in `reset`.
- `src/entities/Boss.js` — add `playDeath()` + `updateDeath(dt)` death sequence visual.
- `src/entities/Enemy.js` — death flash + scale-pop linger before hide; `update` ticks
  `_dying`.
- `src/entities/Obstacle.js` — death flash + scale-pop linger; new `update(dt)`.
- `src/entities/Powerup.js` — expose `this.color`.
- `src/Game.js` — construct `Effects`; trigger all event effects; boss-death
  `WIN_SEQUENCE`; `effects.update` in `_loop`; `effects.clear()` in `_resetStageState`;
  `o.update(dt)` loop; `_advanceStage` sets `state='PLAYING'`.

## 8. Verification

1. [AC1] `npm run dev`; cross each gate, take a bullet hit, block/enemy contact — confirm a
   single +N (green) / −N (red) rises and fades at the leader each time.
2. [AC2] Cross an `add`/`mul` gain gate and grab the reinforce power-up — confirm green puff
   + a visible crowd scale-pop.
3. [AC3] Stand in a boss bullet / reach a block or enemy with HP — confirm red shards + a
   brief light camera shake.
4. [AC4] Let a block crumble under fire and an enemy squad die — confirm a burst + white
   flash/scale-pop, not an instant disappear.
5. [AC5] Kill the boss — confirm a large multi-stage burst + heavy shake play, then the win
   screen appears (or the stage advances).
6. [AC6] Grab each power-up — confirm a distinct coloured grab pop separate from the gate
   popup.
7. [AC7] `npm run build` (no new deps/assets); `npm run verify` still passes (balance
   unchanged); restart and advance a stage mid-effect — confirm popups/particles/shake are
   cut instantly with no stray meshes; `git status` shows no asset files added.
8. [AC1 edge] Cross a gate while at `crowdCap` so the net delta is 0 — confirm **no** popup
   appears (the gate-pick puff still fires). (review item 5)
9. [AC1 edge] Take a boss-bullet hit on the same frame as a gate cross — confirm **both**
   popups appear and none are dropped (validates the 16-slot pool cap). (review item 8)
10. [AC4/regression] Confirm `boss-down` SFX still plays once on boss death (preserved, not
    dropped) while the death burst plays. (review item 4)
