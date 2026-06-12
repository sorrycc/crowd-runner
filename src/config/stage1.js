// ── Stage 1 — the entire stage authored as data (design 6.7) ──────────────────
// Track/Crowd/Boss/Environment read ONLY from this object, so adding a "stage 2"
// is a new file with the same shape + a one-line swap in main.js (AC16).
//
// Gate ops: ['add', n] -> +n | ['mul', n] -> ×n | ['sub', n] -> −n  (no division)
// Best-path simulation (always pick the higher-result side), start count = 1:
//   1@z28  ×2 vs +6   -> +6  => 7
//   2@z62  +14 vs ×2  -> +14 => 21
//   3@z98  ×2 vs +12  -> ×2  => 42
//   4@z134 −12 vs +18 -> +18 => 60
//   5@z172 +25 vs −10 -> +25 => 85
//   6@z212 +20 vs +10 -> +20 => 105   (all-positive pair, like the reference +15/+5)
// A clean run that dodges every obstacle reaches the boss with ~105 crowd — well
// above the ~49 win threshold (see boss-solvability note in design 6.8). Hitting
// obstacles drains members, so careless runs can dip below the threshold and lose.
//
// Combat solvability (design 6.8): total damage the crowd can deal before being
// drained is perMemberDPS·c0²/(2·bossRemovalRate). For c0=49 that is ~294 ≈ boss.hp,
// so ~49 is the break-even; ~105 wins with large margin.

export default {
  id: 'stage-1',
  label: 'STAGE 1',

  // ── pacing / world ──
  timeLimit: 90, // seconds (single authoritative countdown)
  runSpeed: 14, // forward units / second
  roadHalf: 3.0, // road spans x ∈ [-roadHalf, roadHalf]
  crowdCap: 200, // hard max crowd, clamp at cap
  startCount: 1,
  seed: 1337, // decorative scatter seed (deterministic visuals)
  bossStandoff: 4, // leader stops this far before boss.z to fight

  // ── combat (retuned in Phase 4 review for solvability) ──
  combat: {
    perMemberDPS: 1.0, // damage/sec per crowd member at the boss
    bossRemovalRate: 4, // crowd members/sec the boss removes during the fight
  },

  boss: { z: 360, hp: 300 },

  // ── gameplay entities (explicit positions => deterministic, AC15) ──
  // No `sub` gate or obstacle sits in the final approach band [bossZ-standoff, bossZ].
  gates: [
    { z: 28, left: ['mul', 2], right: ['add', 6] },
    { z: 62, left: ['add', 14], right: ['mul', 2] },
    { z: 98, left: ['mul', 2], right: ['add', 12] },
    { z: 134, left: ['sub', 12], right: ['add', 18] },
    { z: 172, left: ['add', 25], right: ['sub', 10] },
    { z: 212, left: ['add', 20], right: ['add', 10] },
  ],

  // Obstacles occupy an x-range; you can dodge by steering out of the range,
  // or plow through and lose `hp` members (1 member per 1 HP).
  obstacles: [
    { z: 115, hp: 20, xRange: [-3.0, 0.2] }, // dodge right
    { z: 192, hp: 30, xRange: [-0.2, 3.0] }, // dodge left
    { z: 250, hp: 40, xRange: [-1.4, 1.4] }, // dodge to either edge
  ],

  coins: [
    { z: 45, x: -1.4 },
    { z: 80, x: 1.2 },
    { z: 120, x: 2.0 },
    { z: 160, x: -1.6 },
    { z: 205, x: 0.6 },
    { z: 245, x: -2.0 },
    { z: 300, x: 0.0 },
  ],

  trees: 56, // count; positions from the seeded rng along both shoulders
}
