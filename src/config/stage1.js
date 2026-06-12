// ── Stage 1 — Normal baseline (design 2026-06-12-difficulty-tiers) ───────────────
// Track/Crowd/Boss/Enemy read ONLY from this object. This file is the NORMAL tier; HARD is
// the runtime transform in src/config/difficulty.js (timeLimit ×0.85, runSpeed ×1.12, boss
// hp ×1.3 / fireInterval ×0.85 / bulletSpeed ×1.15 / bullets +2, obstacle+enemy hp ×1.2,
// marchSpeed ×1.15, reinforce ×0.8). Verified for BOTH tiers by scripts/verify-balance.mjs.
//
// Count-dependent BOTH-GREEN gates (design Decision 7): every pair is +N vs ×M, so the better
// side FLIPS with your count (×M beats +N only past count = N/(M−1)) — you must track your
// count, there is no red "bad" side. The verifier's clean picks max() (perfect count-tracker),
// the worst path picks min() (deliberately under-grows).
//
// Best-path (always the higher side), start = 1:
//   z24  +10 vs ×3  -> +10 => 11
//   z62  ×2  vs +26 -> +26 => 37
//   z104 +34 vs ×2  -> ×2  => 74
//   z150 ×2  vs +60 -> ×2  => 148
//   z200 +50 vs ×2  -> ×2  => 200 (cap)
//   z250 ×2  vs +40 -> tie => 200
// Clean reaches the boss at the 200 cap; every mandatory threat is tuned so a clean run
// destroys it before contact (zero soldier loss) on BOTH tiers.
//
// Worst-path (always the lower side), start = 1:
//   z24  -> ×3=3   z62 -> ×2=6   z104 -> ×2=12
// reaches the z118 full-width block (hp 40) with ~12 soldiers; ~11 DPS over the engagement
// window can't out-shoot 40, so the leftover block drains the whole 12-soldier army -> WIPE.
// (careless wipes even earlier, standing in the z44 dodgeable block.) Verified.
//
// Difficulty: tighter 48s clock (was 60). Boss = a FAN of 5 bullets/volley (4 soldiers each)
// that ENRAGES under 33% HP (fires faster, +2 bullets); dodge the fan by steering off its band.
// Power-ups are nerfed to an edge (dmgCap 1.3 × rapid 1.5 -> no buffed-cap melt) and POSITIONAL
// (placed so grabbing one costs army or position).

export default {
  id: 'stage-1',
  label: 'STAGE 1',

  // ── pacing / world ──
  timeLimit: 48,
  runSpeed: 18,
  roadHalf: 3.0,
  crowdCap: 200,
  startCount: 1,
  seed: 1337,
  bossStandoff: 20, // big standoff so the boss fan has a real dodge window

  // ── combat ──
  combat: {
    perSoldierDPS: 0.9, // firepower per soldier per second
    fireRange: 22, // how far ahead the army can engage a target
  },

  // bullets = fan projectiles per volley; bulletDamage = soldiers lost per connecting bullet;
  // enrage = under `below` HP fraction, fire interval ×fireIntervalMult and +bulletsAdd bullets.
  boss: {
    z: 380,
    hp: 1500,
    fireInterval: 1.3,
    bullets: 5,
    bulletDamage: 4,
    bulletSpeed: 23,
    enrage: { below: 0.33, fireIntervalMult: 0.7, bulletsAdd: 2 },
  },

  // ── power-up tuning — nerfed so buffs are an edge, not an auto-win ──
  powerupTuning: {
    rapidMult: 1.5,
    rapidDuration: 5,
    reinforce: 18,
    shieldDuration: 4,
    dmgBoostStep: 0.1,
    dmgCap: 1.3,
  },

  // gate pairs: ['add',n] +n | ['mul',n] ×n — every pair is count-dependent (both green)
  gates: [
    { z: 24, left: ['add', 10], right: ['mul', 3] },
    { z: 62, left: ['mul', 2], right: ['add', 26] },
    { z: 104, left: ['add', 34], right: ['mul', 2] },
    { z: 150, left: ['mul', 2], right: ['add', 60] },
    { z: 200, left: ['add', 50], right: ['mul', 2] },
    { z: 250, left: ['mul', 2], right: ['add', 40] },
  ],

  // fullWidth => spans the road (mandatory, must shoot). Others are dodgeable. Mandatory
  // threats are spaced so their engagement windows ([z−fireRange, z]) never overlap on Normal,
  // and mandatory enemies sit AFTER the army caps so the full firepower clears them in the
  // marching window on both tiers (zero clean drain).
  obstacles: [
    { z: 44, hp: 20, xRange: [-3.0, 0.3] }, // dodge right
    { z: 118, hp: 40, xRange: [-3.0, 3.0], fullWidth: true }, // must shoot (wipes the worst path)
    { z: 210, hp: 30, xRange: [-0.3, 3.0] }, // dodge left
    { z: 250, hp: 100, xRange: [-3.0, 3.0], fullWidth: true }, // must shoot
  ],

  // marching enemy squads (full-lane, mandatory) — shoot down or lose soldiers
  enemies: [
    { z: 290, hp: 90, xRange: [-3.0, 3.0], marchSpeed: 2.5 },
    { z: 330, hp: 120, xRange: [-3.0, 3.0], marchSpeed: 2.5 },
  ],

  // power-ups — POSITIONAL tradeoffs: each sits on the worse gate side or behind a dodgeable
  // block, so grabbing it costs position/army (no new types — pure upside if you can reach it).
  powerups: [
    { z: 70, x: -1.4, type: 'rapid' }, // off the z62 ×2 (better) side
    { z: 150, x: 1.6, type: 'reinforce' }, // pulls you onto the z150 +60 (worse) side
    { z: 210, x: 1.8, type: 'shield' }, // tucked behind the z210 dodge block
    { z: 280, x: 0.6, type: 'damage' },
    { z: 320, x: -1.0, type: 'damage' },
  ],

  trees: 56,
}
