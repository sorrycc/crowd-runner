// ── Stage 3 — Normal baseline, the hardest finale (design 2026-06-12-difficulty-tiers) ──
// Same shape as stages 1–2; entered by auto-advance after the stage-2 boss dies, army carried
// over floored to startCount. Highest boss.z (longest track → the world auto-sizes to this
// stage), tankiest boss, tightest clock, densest threats with the closest back-to-back spacing
// (so even Normal pressures target priority, and HARD genuinely forces it). HARD is the shared
// transform (difficulty.js).
//
// Count-dependent BOTH-GREEN gates (+N vs ×M; better side flips with your count).
// Floor-path (best side), start = startCount = 25:
//   z24  +20 vs ×2  -> ×2  => 50
//   z66  ×2  vs +40 -> ×2  => 100
//   z112 +55 vs ×2  -> ×2  => 200 (cap)
//   z160 ×2  vs +35 -> ×2  => 200
//   z212 +30 vs ×2  -> ×2  => 200
//   z264 ×2  vs +25 -> ×2  => 200
// Clean reaches the boss at the 200 cap and clears the back-to-back z134/z170/z200 mandatory
// wall before contact on BOTH tiers (the verifier's Hard clean-zero-drain check is the proof).
//
// Difficulty: 56s clock; boss = a 6-bullet fan (4 soldiers each) at a 1.1s cadence, enraging
// under 33% HP into the fastest, widest fan of the game.

export default {
  id: 'stage-3',
  label: 'STAGE 3',

  timeLimit: 56,
  runSpeed: 18,
  roadHalf: 3.0,
  crowdCap: 200,
  startCount: 25, // carry-over floor
  seed: 9001,
  bossStandoff: 20,

  combat: {
    perSoldierDPS: 0.9,
    fireRange: 22,
  },

  boss: {
    z: 430,
    hp: 1950,
    fireInterval: 1.1,
    bullets: 6,
    bulletDamage: 4,
    bulletSpeed: 26,
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
    { z: 24, left: ['add', 20], right: ['mul', 2] },
    { z: 66, left: ['mul', 2], right: ['add', 40] },
    { z: 112, left: ['add', 55], right: ['mul', 2] },
    { z: 160, left: ['mul', 2], right: ['add', 35] },
    { z: 212, left: ['add', 30], right: ['mul', 2] },
    { z: 264, left: ['mul', 2], right: ['add', 25] },
  ],

  obstacles: [
    { z: 44, hp: 30, xRange: [-3.0, 0.3] }, // dodge right
    { z: 134, hp: 80, xRange: [-3.0, 3.0], fullWidth: true }, // must shoot (start of the wall)
    { z: 170, hp: 70, xRange: [-3.0, 3.0], fullWidth: true }, // must shoot (back-to-back wall)
    { z: 260, hp: 130, xRange: [-3.0, 3.0], fullWidth: true }, // must shoot
    { z: 300, hp: 40, xRange: [-0.3, 3.0] }, // dodge left
  ],

  enemies: [
    { z: 210, hp: 90, xRange: [-3.0, 3.0], marchSpeed: 2.5 },
    { z: 330, hp: 120, xRange: [-3.0, 3.0], marchSpeed: 2.5 },
  ],

  powerups: [
    { z: 90, x: 1.6, type: 'reinforce' },
    { z: 188, x: -1.7, type: 'rapid' },
    { z: 290, x: -1.7, type: 'shield' }, // behind the z290 dodge block
    { z: 350, x: 0.4, type: 'damage' },
  ],

  trees: 70,
}
