# Credits & Asset Provenance

## Models (`src/assets/models/*.glb`)

The soldier model is **self-authored** and dedicated to the **public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)**. No third-party meshes,
rigs, or textures are used — the humanoid is assembled from primitive boxes in code and
exported to glTF. You owe no attribution to use, modify, or redistribute it.

### Files

- `soldier.glb` — a low-poly humanoid soldier (head / torso / arms-with-gun / legs), reused
  and recolored for the green follower army, the orange leader, and the red enemy squads. It
  is merged into one shared geometry at load and animated by a per-instance GPU limb swing,
  so each crowd renders as a single `InstancedMesh` (one draw call). It carries **no
  textures** (solid material colours only).

### Reproducing the asset

The `.glb` is committed to the repo, so the normal build/dev/CI flow never regenerates it.
To regenerate it identically (requires only the project's `three` dependency):

```bash
node scripts/gen-models.mjs
```

`scripts/gen-models.mjs` is the authoritative, reproducible source: it builds the humanoid
via `buildSoldierParts()` in `src/util/soldier.js` (the single geometry source shared with
the runtime fallback), strips UVs, and exports a binary GLB via three's `GLTFExporter`. It
is a **dev-only** tool — never invoked by `npm run build`, `npm run verify`, or CI.

### Swapping in another model

To use a different soldier (e.g. a real CC0 model from [Kenney](https://kenney.nl/assets),
[Quaternius](https://quaternius.com), or [OpenGameArt](https://opengameart.org)), drop a
`soldier.glb` into `src/assets/models/` — `models.js` discovers it by name via Vite's glob.
The loader tags limbs by mesh name (`legL` / `legR` / `armL` / `armR`; everything else is
the static "core"), so a replacement animates if it follows that naming. If you swap it,
document the new source + license here and confirm it is CC0 / royalty-free.

## Audio (`src/assets/audio/*.mp3`)

All audio in Swarm Run is **self-authored** and dedicated to the **public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)**. No third-party samples,
recordings, or library assets are used — every clip is synthesized from `ffmpeg` signal
primitives (sine / square / brown-noise / frequency sweeps). You owe no attribution to use,
modify, or redistribute these files.

### Files

12 sound effects + 1 looping music bed:

- `shoot.mp3` — auto-fire weapon volley
- `gate-good.mp3` — picking the better gate side
- `gate-bad.mp3` — picking the worse gate side
- `powerup.mp3` — power-up pickup
- `block-break.mp3` — barricade destroyed
- `enemy-down.mp3` — enemy squad wiped out
- `hurt.mp3` — soldiers lost (contact drain / boss-bullet hit)
- `boss-shot.mp3` — boss telegraphed shot
- `boss-down.mp3` — boss defeated
- `stage-advance.mp3` — advancing to the next stage
- `win.mp3` — victory sting
- `lose.mp3` — defeat sting
- `music-loop.mp3` — seamless 16s background-music loop (plays during gameplay)

### Reproducing the assets

The files are committed to the repo, so the normal build/dev/CI flow never needs `ffmpeg`.
To regenerate them identically (requires a local `ffmpeg`):

```bash
bash scripts/gen-audio.sh
```

The script (`scripts/gen-audio.sh`) is the authoritative, reproducible source for the exact
synthesis parameters of each clip. It is a **dev-only** tool — it is never invoked by
`npm run build`, `npm run verify`, or CI.

### Swapping in other assets

To use different audio (e.g. real CC0 clips from
[freesound.org](https://freesound.org), [Kenney](https://kenney.nl/assets), or
[OpenGameArt](https://opengameart.org)), drop a `.mp3` with the **same filename** into
`src/assets/audio/`. No code change is required — `AudioManager` discovers files by name via
Vite's glob import. If you do, document the new source + license here and confirm it is
CC0 / royalty-free.
