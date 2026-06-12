# Swarm Run

A Count Masters–style hypercasual **crowd shooter** built with **Three.js + Vite**. The
visuals are mostly simple primitives, plus a bundled, **self-authored CC0 humanoid GLTF**
model for the soldiers (the leader, the follower army, and the enemy squads) and a small
set of bundled **CC0 audio** clips for sound effects and looping music. Auto-run down a 3D
road, steer through count-dependent `+N` / `×N` gate pairs to grow a squad of gun-toting
soldiers who **auto-fire** at everything ahead — barricades, marching enemy squads, and three
bosses that fire **fans** of dodgeable bullets. More soldiers means more firepower. Clear all
**three stages** before the clock runs out — on **Normal**, or take the tighter **Hard** tier.

> The original "only simple primitives, no external 3D/texture assets" promise is
> intentionally amended: bundled, permissively-licensed (CC0) model assets are now allowed,
> recorded in `CREDITS.md` like the audio. The army still renders as **one `InstancedMesh`**
> per group (one draw call); its marching/running motion is a GPU vertex animation, not
> per-soldier skinning, so the performance model is unchanged.

## Run

```bash
npm install
npm run dev      # open the printed localhost URL
```

Build / preview a production bundle:

```bash
npm run build
npm run preview
```

Check the stage balance (headless, no browser):

```bash
npm run verify
```

## Controls

- **Steer:** drag / swipe left–right, or arrow keys / `A` `D`.
- **Soldiers fire automatically** at the nearest thing in front of them — you steer, they shoot.

## Difficulty

Pick **Normal** or **Hard** on the start screen. Normal plays about as before; **Hard** is a
single transform applied to every stage — tighter clock (×0.85), faster run (×1.12), a tankier
boss (HP ×1.3) that fires more often (interval ×0.85), faster (bullet speed ×1.15) and **+2**
bullets per fan, beefier blocks/squads (HP ×1.2), faster marchers (×1.15) and weaker
reinforcements (×0.8). The tier is chosen once, applies to all three stages, and is shown on the
win/lose screen. Restart returns to the start screen so you can re-pick. The transform lives in
`src/config/difficulty.js` and is imported by **both** the game and the balance verifier, so
"Hard" means exactly one thing.

## How to play

- **Grow your squad** by picking the better side of each gate — but the gates are
  **count-dependent**: every pair is `+N` vs `×M` (both green, no obvious "bad" side), so
  `×M` only beats `+N` once your count passes `N / (M−1)`. **Track your count** and pick the
  side that's bigger *right now*.
- **Shoot down barricades.** Full-width blocks must be destroyed before you reach them;
  if you hit one with HP left, the leftover drains that many soldiers. Narrower blocks
  can be dodged by steering around them.
- **Enemy squads** march toward you — gun them down or they thin your ranks on contact.
- **Grab power-ups:** ⚡ Rapid fire, ➕ Reinforcements, 🛡 Shield, and `D` Damage boost. They're
  pure upside but **positioned** as a tradeoff — tucked behind a dodgeable block or on the worse
  gate side, so reaching one costs you army or position.
- **Bosses fire a fan.** Each volley is a spread of telegraphed, dodgeable bullets centred where
  you stand — steer off the band to clear the whole fan (or hold a Shield). Under ~33% HP the
  boss **enrages**: it fires faster, adds bullets, and its telegraph glows hotter. Out-gun it
  before the clock hits `0:00`.
- **Win:** defeat the **stage-3** boss with time remaining (clearing a stage auto-advances you
  into the next, carrying your army over, floored to the next stage's baseline).
- **Lose:** the timer hits 0, or your squad reaches 0.

## How it works

- `src/main.js` — the stage-list import site; constructs `Game([STAGE_1, STAGE_2, STAGE_3])`.
- `src/Game.js` — state machine (`MENU → PLAYING(run|boss) → WIN/LOSE`), game loop,
  ranged combat, power-up buffs, boss-bullet collision, stage auto-advance, restart, and the
  difficulty tier (`start(difficulty)` runs each stage through `applyDifficulty`).
- `src/config/difficulty.js` — the `NORMAL`/`HARD` presets + the pure `applyDifficulty(stage,
  preset)` transform **and** the shared `bossVolley(boss, hpFraction)` model (fan size + enrage
  cadence). Imports nothing; consumed by both the game and the verifier (single source of truth).
- `src/config/stage1.js` / `stage2.js` / `stage3.js` — each **stage as data** (the Normal
  baseline): pacing, combat rates, count-dependent gate values, block / enemy / power-up layout,
  and the boss (`hp`, `fireInterval`, `bullets`, `bulletDamage`, `bulletSpeed`, `enrage`). Adding
  a stage is a new config file plus a one-line change in `main.js` — no engine changes.
- `src/core/` — `SceneManager` (renderer, chase camera, lights, fog, sky), `Input`, and
  `Audio` (`AudioManager`: WebAudio SFX + looping music, master-gain mute).
- `src/world/` — `Road`, `Environment` (seeded deterministic trees), `Track` (builds /
  rebuilds entities per stage).
- `src/entities/` — `Crowd` (soldier InstancedMesh + count math), `Bullets` (pooled
  projectiles, player + boss), `Gate`, `Obstacle` (destructible block), `Enemy`
  (marching squad), `Powerup`, `Boss` (firepower drain + a telegraphed, enraging **fan** of
  return fire).
- `src/util/soldier.js` — the humanoid soldier model + its one-draw-call vertex-animation
  material: merges the loaded GLTF into one shared geometry (baked per-vertex limb ids) and a
  `MeshStandardMaterial` whose `onBeforeCompile` swings the limbs per-instance (phase from
  `gl_InstanceID`). Also `buildSoldierParts()` — the single geometry source shared by the
  model generator and the load-error fallback.
- `src/util/models.js` — async `GLTFLoader` preload of `src/assets/models/soldier.glb`
  (bundled via Vite); resolves the shared soldier geometry without blocking first paint.
- `scripts/gen-models.mjs` — **dev-only** generator that authors `soldier.glb` from
  `buildSoldierParts()` (never run by build/CI; see `CREDITS.md`).
- `src/ui/` — `HUD` (count, combo, timer, stage, top bar, active-buff chips, mute toggle)
  and `Screens`.

## Audio

The game plays bundled **CC0** `.mp3` clips (`src/assets/audio/`): SFX on every gameplay
event (weapon fire, gates, power-ups, blocks/enemies down, soldier hurt, boss shots, boss
defeat, stage advance, win/lose) plus a looping background-music bed during play.

- **`AudioManager`** (`src/core/Audio.js`) uses WebAudio — each clip is decoded once into a
  cached buffer and played via a fresh per-shot `BufferSource` through a master `GainNode`,
  so overlapping gunshots never cut each other off. The master gain is the live mute/volume.
- **Autoplay:** the `AudioContext` is created/resumed only on the **Start** gesture, so
  nothing plays (and no autoplay warnings appear) before you press Start.
- **Mute:** the 🔊/🔇 toggle in the HUD corner mutes SFX + music instantly and persists
  across reloads (`localStorage`). Default unmuted.
- **Assets** are self-authored and dedicated to the public domain — see `CREDITS.md` and
  the reproducible generator `scripts/gen-audio.sh`. They can be swapped for any other CC0
  clips of the same filename with no code change.

## Combat model

Army firepower `= count × perSoldierDPS × dmgMult × (rapid ? rapidMult : 1)` is applied
each frame to the **nearest engaged target ahead** within `fireRange` (single-target
focus fire). A target is *engaged* only when the leader's x is inside its x-range, so
dodging a narrow block both avoids its damage and stops you wasting fire on it. Player
bullets are visual tracers; boss bullets are simulated projectiles you dodge by steering.

## Tuning

The **Normal baseline** lives entirely in the stage configs: `timeLimit`, `runSpeed`,
`crowdCap`, count-dependent gate values, block/enemy HP & positions (`fullWidth` = mandatory),
power-up placements + `powerupTuning`, the boss (`hp` / `fireInterval` / `bullets` /
`bulletDamage` / `bulletSpeed` / `enrage`), and combat (`perSoldierDPS`, `fireRange`). **Hard**
is the single `applyDifficulty` transform in `src/config/difficulty.js` — no duplicated configs.

`npm run verify` runs a stepped whole-run simulation across **all three stages on both tiers**,
proving a clean run clears every block/enemy and every boss within the timers (with zero contact
loss), while careless and sloppy runs still lose — and that the boss fan stays lethal if you eat
it, no buffed-cap melt happens, and **Hard is measurably tighter than Normal** (clock margin +
boss drain). The verifier imports the same `applyDifficulty` / `bossVolley` the game does, so the
contract can't drift from the engine.

Authoring rules checked by the verifier: every gate pair is **count-dependent** (its winner
flips with your count — no dominant side); mandatory threats (full-width blocks + enemies) don't
have overlapping engagement windows **on Normal** (relaxed on Hard, where higher HP + a tighter
clock force target priority instead); and each carry-over stage's first growth gate precedes any
mandatory threat (so the floored army can grow before it can be wiped).

Design docs: `docs/designs/2026-06-12-difficulty-tiers-fan-boss-stage3.md` (this overhaul —
difficulty transform, fan/enrage boss, count-dependent gates, Stage 3, verifier contract),
`docs/designs/2026-06-12-rebalance-difficulty.md`,
`docs/designs/2026-06-12-soldiers-shooter-rework.md`,
`docs/designs/2026-06-12-audio-sfx-music-mute.md`, and
`docs/designs/2026-06-12-gltf-soldiers-crowd-boss.md` (the GLTF soldiers / animated crowd /
menacing boss rework).
