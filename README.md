# Swarm Run

A Count Masters–style hypercasual crowd-runner built with **Three.js + Vite**, using
only simple primitives (no external assets, no audio). Auto-run down a 3D road, steer
through `+N` / `×N` / `−N` gate pairs to grow your crowd, dodge or smash HP tire
obstacles, and defeat the end-of-stage boss before the timer runs out.

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

## Controls

- **Steer:** drag / swipe left–right, or arrow keys / `A` `D`.
- **Goal:** pick the better gate side to grow your crowd, dodge obstacles (or pay
  crowd members to smash them), then overwhelm the boss before the clock hits `0:00`.
- **Win:** boss HP reaches 0 before the timer expires.
- **Lose:** the timer hits 0, or your crowd reaches 0.

## How it works

- `src/main.js` — the single stage import site; constructs `Game(STAGE_1)`.
- `src/Game.js` — state machine (`MENU → PLAYING(run|boss) → WIN/LOSE`), game loop,
  collision/combat, win/lose, restart.
- `src/config/stage1.js` — the **entire stage as data**: pacing, combat rates, and the
  explicit gate / obstacle / coin / boss layout. Adding a stage is a new config file of
  the same shape plus a one-line swap in `main.js` — no engine changes.
- `src/core/` — `SceneManager` (renderer, chase camera, lights, fog, sky) and `Input`
  (pointer + touch + keyboard steering).
- `src/world/` — `Road`, `Environment` (seeded deterministic trees), `Track` (builds /
  rebuilds entities from config).
- `src/entities/` — `Crowd` (InstancedMesh formation, count math), `Gate`, `Obstacle`,
  `Coin`, `Boss`.
- `src/ui/` — `HUD` (count, combo, coins, timer, stage, top bar) and `Screens`.

## Tuning

Gameplay/balance lives entirely in `src/config/stage1.js`: `timeLimit`, `runSpeed`,
`crowdCap`, gate values, obstacle HP/positions, coin placements, `boss.hp`, and combat
rates (`perMemberDPS`, `bossRemovalRate`). Boss solvability requires
`perMemberDPS · c0² / (2 · bossRemovalRate) ≥ boss.hp`, where `c0` is the crowd size at
the boss; the shipped numbers give a win threshold of ~49 crowd.

Design doc: `docs/designs/2026-06-12-crowd-runner-game.md`.
