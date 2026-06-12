# Fix Inverted Steering Controls (left/right reversed)

## 1. Background
Horizontal steering is inverted. Pressing Right / `D` (or dragging/swiping right)
moves the crowd left on screen, and vice-versa. This affects both keyboard and
pointer/touch input, because both feed the same steering axis.

## 2. Requirements Summary
- **Goal:** Make horizontal steering match the screen — input right → crowd moves
  right on screen; input left → left. Holds for arrows, `A`/`D`, and drag/swipe.
- **Root cause (confirmed in code):** The chase camera is `+Z`-facing — it sits at
  `(0, CAM_HEIGHT, -CAM_BACK)` and `lookAt`s a `+Z` target
  (`src/core/SceneManager.js:52-53`, `:80`). In Three.js right-handed space a
  `+Z`-facing camera mirrors world X on screen: world `+X` renders on the screen's
  *left*. `Input.x` increases for rightward input (`src/core/Input.js:34` drag,
  `:74` keyboard) and is fed directly as the leader's world X via
  `leaderX = this.input.x` (`src/Game.js:167`). So rightward input → world `+X` →
  drawn on screen *left*. Keyboard and drag share that one axis, so they invert
  together.
- **Fix (agreed, KISS):** Negate the input→world-X mapping in exactly one place:
  `leaderX = -this.input.x` at `src/Game.js:167`.
- **Scope:** Only the player's horizontal control sign. Keep the `+Z` camera and all
  world/gate/obstacle/coin layout untouched. Forward (`+Z`) motion unchanged.

## 3. Acceptance Criteria
1. Right / `D` / rightward drag move the crowd visibly **right** on screen; left
   input moves it **left**.
2. Keyboard and pointer/touch agree in direction.
3. Clamping to the road edges still works on **both** sides.
4. No change to gate/obstacle/coin placement or to forward (`+Z`) motion.

## 4. Problem Analysis
- **Approach A — negate once at the world-mapping boundary** (`leaderX = -this.input.x`,
  `Game.js:167`) -> `Input.x` stays a pure raw-input axis with symmetric clamping;
  `leaderX` is the single derived world coordinate consumed by target acquisition,
  crossings, gates, boss-bullet hit tests, fire aim, crowd update, and (via
  `leaderPos.x`) camera X-follow. One negation flips screen direction while keeping
  every consumer mutually consistent. **Chosen.**
- **Approach B — flip the sign at accumulation in `Input.js`** (`pointermove` `:34`
  and `update` `:74`) -> needs two edits across the drag and keyboard paths; more
  sites to keep in sync; no upside. **Rejected (KISS).**
- **Approach C — rebuild the scene on a conventional `-Z`-forward camera** -> large
  blast radius across world/gate/obstacle layout for a one-line bug. **Rejected
  (overkill; explicitly out of scope).**

## 5. Decision Log

**1. Where to apply the sign flip?**
- Options: A) `leaderX = -this.input.x` in `Game.js:167` · B) flip sign at
  accumulation in `Input.js` (two sites) · C) rebuild scene on `-Z`-forward camera
- Decision: **A)** — single negation at the world-mapping boundary; `leaderX` is the
  one derived world coordinate, so all downstream consumers and camera-follow stay
  consistent automatically. KISS, reversible, isolated.

**2. Keep clamping behavior?**
- Options: A) leave `Input._clamp` symmetric (`[-limit, limit]`) · B) adjust clamp
- Decision: **A)** — clamping stays in `Input.x` space and is symmetric, so
  `leaderX = -this.input.x` is still within `[-limit, limit]`. Both road edges clamp
  correctly with no change. (AC3)

## 6. Design
Single-line change in `src/Game.js`, inside `_update(dt)`:

```js
// before
const leaderX = this.input.x
// after
const leaderX = -this.input.x // screen-direction fix: +Z camera mirrors world X (see SceneManager)
```

Data flow after the change:
- Rightward input → `Input.x` increases → `leaderX = -Input.x` becomes more negative
  → leader/crowd placed at world `-X` → `+Z` camera mirrors → drawn on screen
  **right**. ✓ (AC1)
- `leaderPos.set(leaderX, 0, leaderZ)` → `SceneManager.chase` tracks `leaderPos.x`,
  so the camera X-follow stays consistent with the crowd automatically.
- All world-space consumers of `leaderX` (`_acquireTarget`, `_resolveCrossings`,
  gate `apply`, `_resolveBossBullets`, `_fire`, `crowd.update`) receive the same
  negated value, so gameplay collisions/aim remain self-consistent — only the
  player's controllable position sign changes; static world layout is untouched.
- Keyboard and drag both flow through `Input.x` and then this single mapping, so they
  agree in direction. ✓ (AC2)

No change to `SceneManager`, `Input` clamping, or any world/gate/obstacle/coin layout
or forward-motion code. ✓ (AC4)

## 7. Files Changed
- `src/Game.js` — negate the input→world-X mapping: `const leaderX = -this.input.x`
  (line 167), with a short explanatory comment.

## 8. Verification
1. [AC1] `npm run dev`, start a run; press Right/`D` and drag right → crowd visibly
   moves **right** on screen; Left/`A`/drag-left moves it **left**.
2. [AC2] Confirm keyboard and pointer/touch produce the same on-screen direction.
3. [AC3] Steer fully to each side; crowd stops at both road edges (symmetric clamp
   preserved).
4. [AC4] Gates/obstacles/coins appear in the same positions as before; forward
   progress (`+Z`) speed unchanged. `npm run verify` (balance check) still passes.
