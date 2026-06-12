# Swarm Run

A Count Masters–style hypercasual **crowd shooter** built with **Three.js + Vite**,
using only simple primitives for the visuals (no external 3D/texture assets), plus a
small set of bundled **CC0 audio** clips for sound effects and looping music. Auto-run
down a 3D road, steer through `+N` / `×N` / `−N` gate pairs to grow a squad of gun-toting
soldiers who **auto-fire** at everything ahead — barricades, marching enemy squads, and
two bosses. More soldiers means more firepower. Clear both stages before the timer runs
out.

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

## How to play

- **Grow your squad** by picking the better side of each `+N` / `×N` / `−N` gate.
- **Shoot down barricades.** Full-width blocks must be destroyed before you reach them;
  if you hit one with HP left, the leftover drains that many soldiers. Narrower blocks
  can be dodged by steering around them.
- **Enemy squads** march toward you — gun them down or they thin your ranks on contact.
- **Grab power-ups** (former coin slots): ⚡ Rapid fire, ➕ Reinforcements, 🛡 Shield,
  and `D` Damage boost. All are pure upside.
- **Bosses shoot back.** Their shots are telegraphed and dodgeable — steer out of the
  line of fire (or hold a Shield). Out-gun them before the clock hits `0:00`.
- **Win:** defeat the **stage-2** boss with time remaining (clearing stage 1 auto-advances
  you into stage 2, carrying your army over).
- **Lose:** the timer hits 0, or your squad reaches 0.

## How it works

- `src/main.js` — the stage-list import site; constructs `Game([STAGE_1, STAGE_2])`.
- `src/Game.js` — state machine (`MENU → PLAYING(run|boss) → WIN/LOSE`), game loop,
  ranged combat, power-up buffs, boss-bullet collision, stage auto-advance, restart.
- `src/config/stage1.js` / `stage2.js` — each **stage as data**: pacing, combat rates,
  and the explicit gate / block / enemy / power-up / boss layout. Adding a stage is a new
  config file plus a one-line change in `main.js` — no engine changes.
- `src/core/` — `SceneManager` (renderer, chase camera, lights, fog, sky), `Input`, and
  `Audio` (`AudioManager`: WebAudio SFX + looping music, master-gain mute).
- `src/world/` — `Road`, `Environment` (seeded deterministic trees), `Track` (builds /
  rebuilds entities per stage).
- `src/entities/` — `Crowd` (soldier InstancedMesh + count math), `Bullets` (pooled
  projectiles, player + boss), `Gate`, `Obstacle` (destructible block), `Enemy`
  (marching squad), `Powerup`, `Boss` (firepower drain + telegraphed return fire).
- `src/util/soldier.js` — merged body+gun+helmet geometry (one draw call per army/enemy).
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

Gameplay/balance lives entirely in the stage configs: `timeLimit`, `runSpeed`,
`crowdCap`, gate values, block/enemy HP & positions (`fullWidth` = mandatory),
power-up placements + `powerupTuning`, `boss.hp` / `fireInterval` / `burst` /
`bulletSpeed`, and combat (`perSoldierDPS`, `fireRange`). `npm run verify` runs a stepped
whole-run simulation proving a clean run clears every block/enemy and both bosses within
the timers (with zero contact loss), while a careless run still loses.

Authoring rules baked into the verifier: mandatory threats (full-width blocks + enemies)
don't have overlapping engagement windows (so focus-fire clears each before contact), and
stage 2's first growth gate precedes any mandatory threat (so the carried-over floor army
can grow before it can be wiped).

Design docs: `docs/designs/2026-06-12-soldiers-shooter-rework.md` and
`docs/designs/2026-06-12-audio-sfx-music-mute.md`.
