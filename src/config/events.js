// ── Random event layer (redesign 2026-06-12-endless-procedural, design §6.3) ──
// PURE — imports nothing (no THREE), so the generator AND the headless verifier can both import it
// and the effect math can never drift between the game and the contract.
//
// Two families (the user's six events):
//  • Entity-events inject extra mandatory threats into the obstacle/enemy lists (reusing the
//    existing Obstacle/Enemy code). HP is sized by the GENERATOR in its z-order pass.
//      - ambush  → an extra marching Enemy squad
//      - elite   → an extra full-width Obstacle, ELITE_MULT× a normal mandatory's HP
//  • Modifier-events are transient state Game ticks like the rapid/shield buffs:
//      - toll      → instant count cost  (NOT a red gate — keeps the both-green gate invariant)
//      - bonus     → instant free reinforcements
//      - sandstorm → timed runSpeed penalty (+ a mild, feel-only steer reduction, Game-only)
//      - frenzy    → a BOSS-fight modifier (the boss opens aggressive); armed at fight start, NOT
//                    a z-crossing, because leaderZ is frozen at bossEntry during the boss fight.
//
// scheduleEvents() only PLACES events (types + z) and sets the boss frenzy flag; the generator
// computes magnitudes (which need the running expected count) during its single z-order pass.

// Effect-math constants — the single source shared by Game + verifier (DRY).
export const EVENT_FX = {
  TOLL_FRACTION: 0.1, // toll removes 10% of the current army
  BONUS_FRACTION: 0.2, // bonus adds 20% of the current army
  SANDSTORM_SPEED_MULT: 0.7, // runSpeed during a sandstorm (balance-relevant, verifier-modeled)
  SANDSTORM_STEER_MULT: 0.8, // steer sensitivity during a sandstorm (mild, feel-only, NOT modeled)
  SANDSTORM_DURATION: 4,
  FRENZY_FIRE_MULT: 0.7, // boss fire-interval multiplier while frenzied
  FRENZY_DURATION: 5,
  ELITE_MULT: 1.5, // elite block HP vs a normal mandatory at that z
  AMBUSH_MULT: 0.9, // ambush enemy HP factor (sized off expected count in the pass)
}

// HUD banner copy when an event fires.
export const EVENT_LABEL = {
  toll: 'TOLL!',
  bonus: 'BONUS CACHE',
  sandstorm: 'SANDSTORM',
  frenzy: 'BOSS FRENZY',
  ambush: 'AMBUSH!',
  elite: 'ELITE BLOCK',
}

// Monotonic non-decreasing event count with depth (AC6).
export function eventCount(level) {
  return Math.max(0, Math.min(4, Math.floor(level / 2)))
}

// Weighted pool of event types. frenzy is a boss-fight flag (placed separately).
const POOL = ['ambush', 'elite', 'toll', 'bonus', 'sandstorm', 'frenzy']

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length]
}

// Place `eventCount(level)` events. `ctx` = { runStart, runEnd } (the run-phase z span available
// for z-placed events). Returns:
//   { entityEvents: [{kind:'ambush'|'elite', z}], modifiers: [{type, z}] (sorted by z), frenzy }
// The generator assigns HP/magnitudes; Game/verifier apply EVENT_FX.
export function scheduleEvents(level, rng, ctx) {
  const n = eventCount(level)
  const entityEvents = []
  const modifiers = []
  let frenzy = false

  const lo = ctx.runStart
  const hi = ctx.runEnd
  for (let i = 0; i < n; i++) {
    const type = pick(rng, POOL)
    if (type === 'frenzy') {
      frenzy = true
      continue
    }
    // Spread events across the run span with per-slot jitter so they don't stack.
    const z = lo + ((i + 0.5) / n) * (hi - lo) + (rng() - 0.5) * ((hi - lo) / (n + 1)) * 0.6
    if (type === 'ambush' || type === 'elite') entityEvents.push({ kind: type, z })
    else modifiers.push({ type, z })
  }

  modifiers.sort((a, b) => a.z - b.z)
  entityEvents.sort((a, b) => a.z - b.z)
  return { entityEvents, modifiers, frenzy }
}
