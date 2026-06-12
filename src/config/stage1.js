// ── Stage 1 — authored as data (design 6.10) ─────────────────────────────────
// Track/Crowd/Boss/Enemy/Track read ONLY from this object; adding a stage is a new
// file of the same shape + a one-line swap in main.js (AC11/AC15).
//
// Combat is ranged: army firepower = count · perSoldierDPS · dmgMult · (rapid?·)
// hits the nearest ENGAGED target ahead within fireRange. Full-width blocks and
// enemies are mandatory (must be shot down before contact); dodgeable blocks have a
// sub-range you steer around (then they're never engaged → no fire, no loss).
//
// Best-path gate sim (always the higher side), start = 1:
//   z26  ×3 vs +8  -> +8 => 9
//   z58  +20 vs ×2 -> +20 => 29
//   z96  ×2 vs +16 -> ×2 => 58
//   z140 −18 vs +24-> +24 => 82
//   z186 +30 vs −12-> +30 => 112
//   z232 +22 vs +12-> +22 => 134
// A clean run reaches the boss with ~134 soldiers; mandatory threats are tuned so a
// clean run destroys each before contact (zero soldier loss). Worst-path picks the
// lower side every gate and is wiped by z140 (−25 on 12 → 0). Verified by
// scripts/verify-balance.mjs.
//
// Difficulty (rebalance 2026-06-12): boss hp 1080 + offense (burst 11 @ 1.3s) make the
// fight last ~9s and lethal if you eat bullets — at the ~134-soldier entry it drains
// 1 soldier per HP per hit. Power-ups are nerfed to an edge (dmgCap 1.3 × rapid 1.5), so
// even a buffed capped army can't melt the boss faster than ~3s. A clean run still wins;
// sloppy gate picks or eating boss bullets lose.

export default {
  id: 'stage-1',
  label: 'STAGE 1',

  // ── pacing / world ──
  timeLimit: 60,
  runSpeed: 16,
  roadHalf: 3.0,
  crowdCap: 200,
  startCount: 1,
  seed: 1337,
  bossStandoff: 20, // big standoff so boss bullets have a real dodge window

  // ── combat ──
  combat: {
    perSoldierDPS: 0.9, // firepower per soldier per second
    fireRange: 22, // how far ahead the army can engage a target
  },

  boss: { z: 360, hp: 1080, fireInterval: 1.3, burst: 11, bulletSpeed: 23 },

  // ── power-up tuning (all four types) — nerfed so buffs are an edge, not an auto-win ──
  powerupTuning: {
    rapidMult: 1.5,
    rapidDuration: 5,
    reinforce: 18,
    shieldDuration: 4,
    dmgBoostStep: 0.1,
    dmgCap: 1.3,
  },

  // gate pairs: ['add',n] +n | ['mul',n] ×n | ['sub',n] −n
  gates: [
    { z: 26, left: ['mul', 3], right: ['add', 8] },
    { z: 58, left: ['add', 20], right: ['mul', 2] },
    { z: 96, left: ['mul', 2], right: ['add', 16] },
    { z: 140, left: ['sub', 25], right: ['add', 24] },
    { z: 186, left: ['add', 30], right: ['sub', 20] },
    { z: 232, left: ['add', 22], right: ['add', 12] },
  ],

  // fullWidth => spans the road (mandatory, must shoot). Others are dodgeable.
  obstacles: [
    { z: 44, hp: 20, xRange: [-3.0, 0.3] }, // dodge right
    { z: 118, hp: 50, xRange: [-3.0, 3.0], fullWidth: true }, // must shoot
    { z: 210, hp: 30, xRange: [-0.3, 3.0] }, // dodge left
    { z: 256, hp: 70, xRange: [-3.0, 3.0], fullWidth: true }, // must shoot
  ],

  // marching enemy squads (full-lane, mandatory) — shoot down or lose soldiers
  enemies: [
    { z: 170, hp: 55, xRange: [-3.0, 3.0], marchSpeed: 4 },
    { z: 305, hp: 80, xRange: [-3.0, 3.0], marchSpeed: 5 },
  ],

  // power-ups (former coin slots): rapid | reinforce | shield | damage — pure upside
  powerups: [
    { z: 70, x: -1.4, type: 'rapid' },
    { z: 150, x: 1.6, type: 'reinforce' },
    { z: 200, x: -1.8, type: 'shield' },
    { z: 280, x: 0.6, type: 'damage' },
    { z: 320, x: -1.0, type: 'damage' },
  ],

  trees: 56,
}
