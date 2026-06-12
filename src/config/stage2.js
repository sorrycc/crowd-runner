// ── Stage 2 — the harder finale (design 6.9/6.10) ────────────────────────────
// Same shape as stage 1. Entered by auto-advance after the stage-1 boss dies; the
// army carries over floored to startCount (Decision 5). Authoring rule: the first
// growth gate (z24) precedes every full-width block / enemy, and pre-growth mandatory
// drain is 0, so even a floored army (startCount) can grow before it can be wiped.
//
// Floor-path gate sim (best side), start = startCount = 15:
//   z24  +12 vs ×2 -> ×2 => 30
//   z64  ×2 vs +30 -> tie 60 => 60
//   z108 +40 vs −20-> +40 => 100
//   z156 ×2 vs +25 -> ×2 => 200 (cap)
//   z206 +20 vs −15-> +20 => 200
//   z252 +30 vs +15-> +30 => 200
// Both the floored army and a big carried army clear every mandatory threat before
// contact and beat the boss in time. Verified by scripts/verify-balance.mjs.
//
// Difficulty (rebalance 2026-06-12): the finale boss has hp 1600 + heavier offense
// (burst 13 @ 1.1s, faster bullets) so the capped 200-army fight lasts ~9s and an
// undodged army is drained to ~31. Power-ups nerfed to an edge (dmgCap 1.3 × rapid 1.5)
// → no instant melt (~4.6s even buffed at cap). Clean run still wins; eating bullets loses.

export default {
  id: 'stage-2',
  label: 'STAGE 2',

  timeLimit: 65,
  runSpeed: 16,
  roadHalf: 3.0,
  crowdCap: 200,
  startCount: 15, // carry-over floor
  seed: 4242,
  bossStandoff: 20,

  combat: {
    perSoldierDPS: 0.9,
    fireRange: 22,
  },

  boss: { z: 360, hp: 1600, fireInterval: 1.1, burst: 13, bulletSpeed: 25 },

  powerupTuning: {
    rapidMult: 1.5,
    rapidDuration: 5,
    reinforce: 18,
    shieldDuration: 4,
    dmgBoostStep: 0.1,
    dmgCap: 1.3,
  },

  gates: [
    { z: 24, left: ['add', 12], right: ['mul', 2] },
    { z: 64, left: ['mul', 2], right: ['add', 30] },
    { z: 108, left: ['add', 40], right: ['sub', 30] },
    { z: 156, left: ['mul', 2], right: ['add', 25] },
    { z: 206, left: ['add', 20], right: ['sub', 25] },
    { z: 252, left: ['add', 30], right: ['add', 15] },
  ],

  obstacles: [
    { z: 40, hp: 25, xRange: [-3.0, 0.3] }, // dodge right
    { z: 132, hp: 90, xRange: [-3.0, 3.0], fullWidth: true }, // must shoot
    { z: 276, hp: 40, xRange: [-0.3, 3.0] }, // dodge left
    { z: 230, hp: 130, xRange: [-3.0, 3.0], fullWidth: true }, // must shoot
  ],

  enemies: [
    { z: 184, hp: 70, xRange: [-3.0, 3.0], marchSpeed: 5 },
    { z: 300, hp: 150, xRange: [-3.0, 3.0], marchSpeed: 6 },
  ],

  powerups: [
    { z: 80, x: -1.5, type: 'reinforce' },
    { z: 170, x: 1.7, type: 'rapid' },
    { z: 240, x: -1.6, type: 'shield' },
    { z: 320, x: 0.0, type: 'damage' },
  ],

  trees: 64,
}
