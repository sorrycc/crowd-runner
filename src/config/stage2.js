// ── Stage 2 — Normal baseline, the mid finale (design 2026-06-12-difficulty-tiers) ──
// Same shape as stage 1. Entered by auto-advance after the stage-1 boss dies; the army carries
// over floored to startCount. HARD is the shared transform (see difficulty.js). Authoring rule:
// the first growth gate (z24) precedes every full-width block / enemy, so even a floored army
// can grow before it can be threatened.
//
// Count-dependent BOTH-GREEN gates (+N vs ×M; the better side flips with your count).
// Floor-path (best side), start = startCount = 20:
//   z24  +18 vs ×2  -> ×2  => 40
//   z64  ×2  vs +35 -> ×2  => 80
//   z108 +50 vs ×2  -> ×2  => 160
//   z154 ×2  vs +40 -> ×2  => 200 (cap)
//   z204 +30 vs ×2  -> ×2  => 200
//   z252 ×2  vs +25 -> ×2  => 200
// Both the floored army and a big carried army reach the boss at the 200 cap and clear every
// mandatory threat before contact on BOTH tiers. Verified by scripts/verify-balance.mjs.
//
// Difficulty: 52s clock; boss = a 6-bullet fan (4 soldiers each) at a faster 1.2s cadence,
// enraging under 33% HP. Heavier mandatory threats than stage 1; clean still wins, sloppy/
// careless have already lost back in stage 1 (the chain never reaches here on a bad run).

export default {
  id: 'stage-2',
  label: 'STAGE 2',

  timeLimit: 52,
  runSpeed: 18,
  roadHalf: 3.0,
  crowdCap: 200,
  startCount: 20, // carry-over floor
  seed: 4242,
  bossStandoff: 20,

  combat: {
    perSoldierDPS: 0.9,
    fireRange: 22,
  },

  boss: {
    z: 400,
    hp: 1700,
    fireInterval: 1.2,
    bullets: 6,
    bulletDamage: 4,
    bulletSpeed: 25,
    enrage: { below: 0.33, fireIntervalMult: 0.7, bulletsAdd: 2 },
  },

  powerupTuning: {
    rapidMult: 1.5,
    rapidDuration: 5,
    reinforce: 18,
    shieldDuration: 4,
    dmgBoostStep: 0.1,
    dmgCap: 1.3,
  },

  gates: [
    { z: 24, left: ['add', 18], right: ['mul', 2] },
    { z: 64, left: ['mul', 2], right: ['add', 35] },
    { z: 108, left: ['add', 50], right: ['mul', 2] },
    { z: 154, left: ['mul', 2], right: ['add', 40] },
    { z: 204, left: ['add', 30], right: ['mul', 2] },
    { z: 252, left: ['mul', 2], right: ['add', 25] },
  ],

  obstacles: [
    { z: 44, hp: 25, xRange: [-3.0, 0.3] }, // dodge right
    { z: 130, hp: 70, xRange: [-3.0, 3.0], fullWidth: true }, // must shoot
    { z: 170, hp: 40, xRange: [-0.3, 3.0] }, // dodge left
    { z: 240, hp: 120, xRange: [-3.0, 3.0], fullWidth: true }, // must shoot
  ],

  enemies: [
    { z: 210, hp: 80, xRange: [-3.0, 3.0], marchSpeed: 2.5 },
    { z: 300, hp: 110, xRange: [-3.0, 3.0], marchSpeed: 2.5 },
  ],

  powerups: [
    { z: 80, x: -1.5, type: 'reinforce' },
    { z: 170, x: 1.7, type: 'rapid' },
    { z: 240, x: -1.6, type: 'shield' },
    { z: 320, x: 0.0, type: 'damage' },
  ],

  trees: 64,
}
