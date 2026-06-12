# Restyle UI to 8-bit NES / Mario aesthetic

## 1. Background

The game ("Swarm Run" / repo `crowd-runner`) currently uses a modern flat-UI look:
translucent dark "pill" chrome with 999px radii, linear-gradient fills, soft drop
shadows, a `backdrop-filter: blur` on screens, rounded in-world canvas plates with a
soft green accent bar, and a soft pastel 3D world. The requirement is a pure
**presentation-layer** restyle to an 8-bit NES / classic Mario aesthetic across three
surfaces — DOM HUD/screens, in-world canvas text plates, and the 3D world — with a
locally bundled pixel font. No gameplay/balance/behavior change.

## 2. Requirements Summary

**Goal:** Recolor + flatten + pixel-font the entire presentation layer to read as
8-bit NES/Mario, with zero functional change.

**Scope (in):**
- DOM UI — `index.html` `<style>` (HUD + screens + buttons) and `src/ui/HUD.js` (the
  two progress-fill color assignments).
- In-world plates — `src/util/text.js` (the shared canvas→sprite text helper) and all
  7 call sites (`Gate`, `Obstacle`, `Enemy`, `Boss`, `Crowd` count, `Powerup`,
  `Effects` floating numbers).
- 3D world recolor + lighting flatten — `src/core/SceneManager.js`,
  `src/world/Environment.js`, `src/world/Road.js`, `src/entities/Gate.js`,
  `Obstacle.js`, `Boss.js`, `Powerup.js`, `Crowd.js`, `Enemy.js`,
  `src/effects/Effects.js`, `src/entities/Bullets.js` + the bullet-pool colors in
  `src/Game.js`.
- Font — vendor Press Start 2P `.woff2` (SIL OFL) at
  `src/assets/fonts/press-start-2p.woff2`, `@font-face` in `index.html`, and gate
  in-world plate creation on `document.fonts` so plates first-draw in the pixel font.

**Scope (out):** full pixelation post-FX / chunky low-res 3D render; app rename (title
stays "SWARM RUN", `<title>` stays "Swarm Run"); any gameplay/balance change; stripping
emoji glyphs; optional 2-band sky.

**Global visual rule:** 4px solid `#000` borders · `border-radius: 0` · no gradients ·
no blur/`backdrop-filter` · no soft/blurred shadows. Pills → flat blocks; gradient/soft
shadows → solid black offset shadows.

**NES palette:** `--nes-sky #5C94FC` · `--coin #FBD000` · `--mario-red #E52521` ·
`--pipe-green #00A800` · `--brick #C84C0C` · `--ink #000000` · `--paper #FCFCFC`.

## 3. Acceptance Criteria

1. `npm run build` (Vite) succeeds with no new errors.
2. No new browser console errors at load or during a normal run.
3. `node scripts/verify-balance.mjs` still passes (regression guard; restyle is
   visual-only and must not affect the pure balance model).
4. A committed local Press Start 2P `.woff2` (no CDN/`@import` at runtime) is referenced
   via a local `@font-face` in `index.html` and is the font used by DOM chrome
   (titles/buttons/HUD chips/banner) and in-world plates. Canonical location is
   `src/assets/fonts/press-start-2p.woff2`; if (and only if) the Vite build cannot emit
   it from there under `base:'./'`, it is relocated to `public/fonts/press-start-2p.woff2`
   and the `@font-face` `url()` updated to match. The build's emitted CSS must actually
   reference the hashed/copied font (verified by grepping `dist`).
5. In-world plates first-render in Press Start 2P (not the system-ui fallback) — plate
   sprite creation is gated on `document.fonts` being ready before the first draw,
   confirmed deterministically via `document.fonts.check('36px "Press Start 2P"') === true`
   after the gate resolves.
6. No DOM element retains `border-radius` (pills/buttons/chips are square), and no
   gradient, blur, `backdrop-filter`, or soft/blurred `box-shadow` remains; offset
   solid-black shadows are used instead.
7. NES palette CSS vars are defined and applied; old `--pill-bg`/`--pill-fg`
   gradient/translucent styling is gone.
8. In-world plates are square (hard corners) with black fill + thick hard border and no
   soft accent bar; per-entity text/border colors follow the Decision-5 NES bucket
   mapping while preserving green=good / red=bad. Floating +N/−N numbers stay
   plate-less (no box) with a hard black outline. Plate glyphs are crisp (canvas texture
   uses `NearestFilter` magnification, not linear), every plate string is uppercased and
   the U+2212 minus is normalized to ASCII `-` (the font lacks U+2212), and all strings
   (incl. worst case `+12.3K` from Effects and the largest boss `formatCount`) fit the
   plate interior via a measure-and-shrink.
9. 3D world reads as flat-shaded NES blocks: sky and fog are `#5C94FC` and match;
   directional light lowered + hemi kept high so MeshStandard materials look near-flat;
   ground/trunk/foliage/road/rails/posts recolored per Decision 10; material types
   unchanged.
10. App title "SWARM RUN" (`index.html`) and `<title>` "Swarm Run" unchanged; emoji
    glyphs on the mute button and buff chips preserved.
11. The `.btn` push-down interaction is preserved (now `radius:0` + a `6px 6px 0 #000`
    offset shadow that collapses on `:active`).
12. Screen overlays are fully opaque with no backdrop blur (start = sky-blue,
    win/lose = near-black).
13. Work is committed and pushed on the current branch (`master`); no branch checkout,
    no worktree.

## 4. Problem Analysis

- **Approach A — global pixel font on `<body>`** → every paragraph/hint in Press Start
  2P. Rejected: the long start-screen instructional paragraph becomes unreadable; hurts
  UX for no aesthetic gain (the 8-bit read comes from chrome + world + plates).
- **Approach B — new render pipeline / pixelation post-FX** → low-res render target +
  nearest upscale. Rejected: explicitly out of scope (YAGNI); ~30 LOC of renderer risk
  for no required AC.
- **Chosen approach — selective recolor + flatten + pixel-font the chrome and plates.**
  Apply Press Start 2P to titles/buttons/HUD chips/banner/plates only; keep readable
  body text; swap color literals and CSS to the NES palette; flatten lights instead of
  switching material types. Smallest, lowest-risk diff that satisfies every AC.

## 5. Decision Log

**1. How to obtain the Press Start 2P `.woff2`?**
- Options: A) assume placed by user · B) implementation downloads + vendors it · C) base64-encode in code
- Decision: **B)** — `curl` the SIL OFL woff2 (verified reachable: jsDelivr `@fontsource/press-start-2p` → HTTP 200, valid 12 512-byte WOFF2; cmap dumped — contains digits/A-Z/`+`/`-`/`×`U+00D7, **lacks** `−`U+2212) into `src/assets/fonts/` and commit it. "No CDN" governs runtime only. Network-fetch fallback: copy from the `@fontsource/press-start-2p` npm package.
- **Reference path:** canonical `src/assets/fonts/press-start-2p.woff2`, referenced from the inline `@font-face` as `url('/src/assets/fonts/press-start-2p.woff2')`. The repo has no `public/` dir and every other binary asset is hashed via `import.meta.glob('?url')` in JS (CSS `url()` is a new path for this project), so the build MUST be checked: after `vite build`, grep `dist` to confirm the font was emitted and the built CSS references it. If Vite does not rewrite/emit the inline-`<style>` `url()` under `base:'./'`, relocate the file to `public/fonts/press-start-2p.woff2` and use `url('./fonts/press-start-2p.woff2')` (public is copied verbatim, correct under `base:'./'`) — and update AC4 + Files-Changed + Verification to that path. Pick the one location that actually ships.

**2. How to gate canvas plates on the webfont?**
- Options: A) ignore (accept fallback-font flash) · B) gate plate creation on `document.fonts`
- Decision: **B)** — export a `fontReady` promise from `text.js`
  (`document.fonts.load('36px "Press Start 2P"')`, `.catch(()=>{})` so a font 404 never
  blocks the game — but a 404 is then caught deterministically in Verification via
  `document.fonts.check('36px "Press Start 2P"')`), and change
  `Game.js:132` from `soldierModelReady.then(...)` to
  `Promise.all([soldierModelReady, fontReady]).then(([geo]) => ...)`. This already-lazy
  `.then()` builds Crowd + Track (every static plate), so one gate covers them all.
  Effects floating-number sprites are pooled empty and redrawn on first use (after font
  is up). KISS/DRY — no new lifecycle.

**3. Plate font size + casing.**
- Options: A) keep 70/78px · B) fixed ~32–40px + uppercase · C) base ~36px + measure-and-shrink
- Decision: **C)** — Press Start 2P glyphs render ~1.1–1.25em wide with side bearings, so
  a fixed size is unsafe: the Effects worst case `+12.3K` is 6 glyphs (~240px) and would
  overflow the ~224px plate interior, and boss `formatCount` can be large too. So use a
  numeric `fontSize` opt (default 36) + a centralized measure-and-shrink in
  `updateTextSprite`: while `ctx.measureText(label).width > interiorWidth` and
  `size > 12`, drop `size` by 2 and re-set the font. Covers count/gate/obstacle/enemy/
  boss/powerup/floating-number in one place (DRY). `updateTextSprite` also uppercases
  (`String(text).toUpperCase()`) and normalizes U+2212 `−` → ASCII `-`.

**4. Plate shape.**
- Options: A) keep rounded + accent bar · B) square black fill + thick hard border
- Decision: **B)** — delete `roundRect` (now unused) and the accent-bar block; draw a
  filled black rect + a hard `strokeRect` border (color = per-entity). Hard corners.

**5. Plate color coding (snap to NES buckets, keep good/bad).**
- Options: A) nearest-NES remap · B) keep exact hex · C) per-entity bucket snap
- Decision: **C)** — border/text carries the entity color; plate body uniform black:
  gate good → `#00A800` / bad → `#E52521`; obstacle HP lerp FULL `#00A800` → LOW
  `#E52521`; enemy → `#E52521`; boss → `#E52521`; army count → coin `#FBD000`; floating
  +N → `#00A800` / −N → `#E52521`; powerup letter border = its (NES-snapped) type color.
  **Render-only minus fix:** the U+2212 normalization lives in `updateTextSprite` (text
  layer) only; the good/bad border selection keys on the op DATA (`op[0]==='sub'` in
  Gate.js, `delta > 0` in Effects) and is untouched — never "fix" the minus by rewriting
  op tuples or the source literals, or the red/green selection breaks.

**6. NES palette CSS vars.**
- Decision: replace `--pill-bg`/`--pill-fg` (`index.html:8-11`) with the 7 NES vars;
  reference them throughout the stylesheet.

**7. Global DOM visual rule.**
- Decision: 4px solid `#000`, `border-radius:0`, no gradients/blur/soft-shadow; pills →
  flat blocks; soft shadows → solid offset (`.btn` = `6px 6px 0 #000`). Applies to
  `#progress(-fill)`, `#hud-count`, `.pill`, `.buff`, `#btn-mute`, `#hud-banner`,
  `.screen`, `h1`, `.btn`/`.btn-hard`/`.btn-ghost`.

**8. Emoji glyphs.**
- Options: A) keep (system-emoji fallback) · B) strip to text · C) ASCII symbols
- Decision: **A)** — keep 🔊/🔇 and ⚡/🛡; per-glyph fallback renders them next to the
  pixel font. Stripping is out of restyle scope; trivial follow-up if undesired.

**9. Screen backgrounds.**
- Options: A) fully opaque (world hidden) · B) translucent, no blur
- Decision: **A)** — drop `backdrop-filter` entirely; start bg = `#5C94FC`, win/lose =
  near-black so coin-gold/colored titles pop.

**10. 3D recolor + lighting.**
- Decision: flat sky `#5C94FC` + fog `#5C94FC` (entities fade uniformly into sky;
  2-band sky YAGNI-skipped); flatten lighting by keeping hemi high (~1.0) and dropping
  directional `0.9 → 0.25`, material types unchanged. Concrete hexes:
  - ground `0x6cbf53 → 0x00A800`; trunk `0x7a5230 → 0xC84C0C`; foliage `0x3f9d4f → 0x00A800`.
  - road `0x9aa3ad → 0xE0A864` (tan, distinct from brick trunks); road edge lines stay
    white `0xFCFCFC`; centre dashes → coin `0xFBD000` (yellow road dashes); rail
    `0xf3f4f6 → 0xFCFCFC`; post `0xcbd5e1 → 0xC84C0C` (brick).
  - gate panel good `0x22c55e → 0x00A800` / bad `0xef4444 → 0xE52521`.
  - obstacle FULL `0x22c55e → 0x00A800` / LOW `0xef4444 → 0xE52521`.
  - powerups: rapid `0xf97316 → 0xF87800` · reinforce `0x22c55e → 0x00A800` · shield
    `0x38bdf8 → 0x3CBCFC` · damage `0xef4444 → 0xE52521`.
  - bullets: player `0xfde047 → 0xFBD000` (Game.js pool) · boss `0xf43f5e → 0xE52521`.
  - Effects floating-number constants GREEN `#4ade80 → #00A800`, RED `#f87171 → #E52521`;
    snap the obvious gain/loss/gate green & red particle bursts to the same.
  - Boss body left as-is (already on-theme dark red) — "minor brightening" satisfied via
    its NES-red plate + brighter bullets (YAGNI on geometry).

**11. Soldier body colors.**
- Options: A) leave as-is · B) snap to NES while keeping leader/follower/enemy distinct
- Decision: **B)** — section 4's header is "recolor to flat NES palette"; 3 literal
  swaps, reversible, improves cohesion, keeps gameplay-critical distinctness: leader
  `0xf97316 → 0xF87800` (NES orange), follower `0x22c55e → 0x00A800` (pipe-green), enemy
  `0xdc2626 → 0xE52521` (mario-red). Three readably-distinct hues retained.

**12. Pixel font reach.**
- Options: A) whole body · B) chrome + plates only
- Decision: **B)** — apply Press Start 2P to `h1`, `.btn`, `.pill`, `#hud-count`,
  `#hud-banner`, `.buff`, and plates; paragraphs/hints stay system-ui (readable). Drop
  `.btn` font-size (~22→16px) and `h1` clamp (~32–64 → ~20–40px) so wide pixel glyphs
  don't overflow.

**13. `#hud-count` coin "× N" look.**
- Decision: black panel + 4px white border + coin-gold pixel number; add a `::before`
  `content:"×"` in coin-gold for the Mario coin-counter read (reversible, CSS-only).

## 6. Design

### 6.1 Font bundling + load gate

- `src/assets/fonts/press-start-2p.woff2` (vendored, committed).
- `index.html` adds, before `:root`:
  ```css
  @font-face {
    font-family: 'Press Start 2P';
    font-style: normal;
    font-weight: 400;
    font-display: block;            /* avoid fallback-font flash on DOM chrome */
    src: url('/src/assets/fonts/press-start-2p.woff2') format('woff2');
  }
  ```
  (If `vite build` does not rewrite/copy the inline-`<style>` `url()`, fall back to
  `public/fonts/press-start-2p.woff2` + `url('./fonts/press-start-2p.woff2')`.)
- `src/util/text.js` exports:
  ```js
  export const fontReady =
    (typeof document !== 'undefined' && document.fonts && document.fonts.load)
      ? document.fonts.load('10px "Press Start 2P"').catch(() => {})
      : Promise.resolve()
  ```
- `src/Game.js`: `import { fontReady } from './util/text.js'` and
  ```js
  Promise.all([soldierModelReady, fontReady]).then(([soldierGeo]) => { /* build Crowd+Track */ })
  ```

### 6.2 `src/util/text.js` helper rewrite

New `opts`: `{ scale, plate=true, bg='#000000', border='#FCFCFC', color='#FCFCFC',
fontSize=36 }` (numeric size so the shrink loop can adjust it; family is a constant).
Delete `roundRect` + accent bar. In `makeTextSprite`, set the texture to crisp-pixel
sampling: `texture.magFilter = THREE.NearestFilter` (keep `minFilter = LinearFilter` to
avoid distant-plate shimmer); the old `anisotropy = 4` may stay or go (harmless).

```js
const FONT_FAMILY = '"Press Start 2P", monospace'

export function updateTextSprite(sprite, text) {
  const { canvas, texture, opts } = sprite.userData
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)

  const plate  = opts.plate !== false
  const bg     = opts.bg ?? '#000000'
  const border = opts.border ?? '#FCFCFC'
  const fg     = opts.color ?? '#FCFCFC'
  const PAD = 6, B = 10
  // font lacks U+2212; map to ASCII hyphen. Uppercase for the 8-bit read.
  const label = String(text).toUpperCase().replace(/−/g, '-')

  if (plate) {
    ctx.fillStyle = bg
    ctx.fillRect(PAD, 14, W - 2 * PAD, H - 28)
    ctx.lineWidth = B
    ctx.strokeStyle = border
    ctx.strokeRect(PAD + B / 2, 14 + B / 2, W - 2 * PAD - B, H - 28 - B)
  }

  // measure-and-shrink so even +12.3K / large boss HP fit the interior
  const interior = plate ? W - 2 * PAD - 2 * B : W - 16
  let size = opts.fontSize ?? 36
  ctx.font = `${size}px ${FONT_FAMILY}`
  while (size > 12 && ctx.measureText(label).width > interior) {
    size -= 2
    ctx.font = `${size}px ${FONT_FAMILY}`
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (!plate) {                      // plate-less floating numbers: hard black outline
    ctx.lineWidth = 8
    ctx.strokeStyle = '#000000'
    ctx.strokeText(label, W / 2, H / 2)
  }
  ctx.fillStyle = fg
  ctx.fillText(label, W / 2, H / 2)

  texture.needsUpdate = true
}
```

### 6.3 Call-site updates (per Decision 5/11)

All call sites drop the old `bg`/`accent`/`font`-string overrides and rely on the new
default `fontSize:36` + autoshrink (so the previous 70/78/80/90px overrides simply go away):
- `Gate.js:46` → `{ scale:1.7, border: op[0]==='sub' ? '#E52521' : '#00A800', color:'#FCFCFC' }`;
  panel color `Gate.js:16` → `0xE52521 : 0x00A800`.
- `Obstacle.js:49` → `{ scale:1.5, border:'#FCFCFC' }`; FULL/LOW `0x00A800`/`0xE52521`.
- `Enemy.js:52` → `{ scale:1.4, border:'#E52521' }`; soldier mat `0xdc2626 → 0xE52521`.
- `Boss.js:137` → `{ scale, border:'#E52521' }` (keep its scale; autoshrink handles long
  HP); body geometry left.
- `Crowd.js:61` → `{ scale:2.4, border:'#FBD000', color:'#FBD000' }`; leader/follower
  mats `0xF87800`/`0x00A800`.
- `Powerup.js:40` → `{ scale:0.9, border: def.color, color:'#FCFCFC' }`; `TYPES` colors
  snapped (Decision 10).
- `Effects.js:28` → `{ plate:false, color: GREEN }`; `GREEN`/`RED` constants snapped;
  gain/loss/gate green & red bursts snapped. (The `−N` minus is normalized inside
  `updateTextSprite`, not here.)

### 6.4 DOM CSS (`index.html`)

`:root` → 7 NES vars. Then, element-by-element (square, 4px `#000`, no radius/gradient/
blur/soft-shadow):
- `#progress`: square, 4px solid `#000`, dark track; `#progress-fill` flat (set live by
  HUD.js).
- `HUD.js:88` boss fill → `this.fill.style.background = 'var(--mario-red)'` (or
  `'#E52521'`); `HUD.js:91` run fill → `'#FBD000'` (coin). Remove gradients.
- `#hud-count`: black panel, 4px white border, coin-gold pixel text, `::before{content:"×"}`.
- `.pill`: black block, 4px solid white border, white pixel text; `#hud-combo` → coin gold.
- `.buff`: square, 4px solid `#000`, black pixel text; `.buff-rapid #F87800`,
  `.buff-shield #3CBCFC`, `.buff-damage #E52521`.
- `#btn-mute`: square block, 4px solid `#000`, no soft shadow.
- `#hud-banner`: pixel font, white, `text-shadow: 2px 2px 0 #000` (hard offset, no blur).
- `.screen`: drop `backdrop-filter`; opaque bg (`#5C94FC` start; near-black win/lose).
- `h1`: pixel font, coin-gold, stacked hard shadows e.g.
  `text-shadow: 3px 3px 0 #000, 6px 6px 0 #C84C0C`; reduce clamp; `#screen-win h1`
  `#00A800`, `#screen-lose h1` `#E52521`.
- `.btn`: `border-radius:0`, 4px solid `#000`, flat `--pipe-green`, white pixel text
  (~16px), `box-shadow: 6px 6px 0 #000`; `:active` → `translateY(4px)` +
  `box-shadow: 2px 2px 0 #000`. `.btn-hard` flat `--mario-red`; `.btn-ghost` flat
  neutral (`#6B6B6B`). Keep push-down mechanic.

### 6.5 3D world (`SceneManager`, `Environment`, `Road`, `Game` pools)

Per Decision 10/11 — color-literal swaps + `SKY_TOP=SKY_BOTTOM='#5C94FC'`,
`FOG_COLOR=0x5C94FC`, `HemisphereLight(..., 1.0)`, `DirectionalLight(..., 0.25)`.

## 7. Files Changed

- `index.html` — `@font-face`, NES `:root` vars, full HUD/screen/button CSS restyle.
- `src/assets/fonts/press-start-2p.woff2` — **new** vendored font (binary, committed).
- `src/util/text.js` — `fontReady` export; `makeTextSprite` texture `magFilter =
  NearestFilter`; helper rewrite (square plate + hard border, uppercase, U+2212→`-`
  normalize, numeric `fontSize` + measure-and-shrink, plate-less black outline); delete
  `roundRect`/accent bar.
- `src/Game.js` — gate plate build on `Promise.all([soldierModelReady, fontReady])`;
  bullet-pool colors (player → coin, boss → mario-red).
- `src/ui/HUD.js` — flat progress-fill colors (boss → mario-red, run → coin).
- `src/core/SceneManager.js` — flat sky + matching fog; flattened lighting.
- `src/world/Environment.js` — ground/trunk/foliage hexes.
- `src/world/Road.js` — road/edge/dash/rail/post hexes.
- `src/entities/Gate.js` — panel colors + plate opts.
- `src/entities/Obstacle.js` — FULL/LOW colors + plate opts.
- `src/entities/Enemy.js` — soldier color + plate opts.
- `src/entities/Boss.js` — plate opts (border mario-red).
- `src/entities/Crowd.js` — leader/follower colors + count-plate opts (coin).
- `src/entities/Powerup.js` — type colors + letter-plate opts.
- `src/effects/Effects.js` — GREEN/RED + burst color snaps; floating-number `plate:false`.

(`src/entities/Bullets.js` is intentionally NOT changed: both pools — `Game.js:72` player,
`Game.js:81` boss — pass explicit `color`, so the constructor default is never used;
editing it would be dead churn against the smallest-diff thesis. Verified by grep: only
those two `new BulletPool` sites exist.)

## 8. Verification

1. [AC1/AC4] `npm run build` → exits 0, no errors; then grep `dist` (e.g.
   `grep -ro 'press-start-2p[^")]*' dist` / inspect `dist/index.html` + emitted CSS) to
   confirm the woff2 was actually copied/hashed into the build AND the built `@font-face`
   `url()` points at it. If not, relocate the font to `public/fonts/` (Decision 1) and
   rebuild until this holds.
2. [AC3] `node scripts/verify-balance.mjs` → still passes (unchanged balance model).
3. [AC2/AC5] `npm run dev`, load: no console errors; in the console assert
   `document.fonts.check('36px "Press Start 2P"') === true` after load (deterministic —
   catches a font 404 that the `.catch` would otherwise hide); visually confirm in-world
   plates render in Press Start 2P from the first frame they appear (no system-font
   flash), and that a subtract-gate label `-N` and a loss number `-N` render the minus in
   the SAME pixel font as the digits (U+2212→ASCII normalization working).
4. [AC4] `git status` shows `src/assets/fonts/press-start-2p.woff2` tracked; `index.html`
   has a local `@font-face` and no CDN `@import`/`<link>` to fonts.googleapis.com.
5. [AC6/AC7] grep the final `index.html` for `border-radius`, `gradient`, `blur`,
   `backdrop-filter` → none remain (except `border-radius:0`); `--pill-bg`/`--pill-fg`
   gone.
6. [AC8] Visual: gate/obstacle/enemy/boss/count/powerup plates are square with hard
   borders, correct per-entity colors; floating +N/−N are plate-less with black outline.
7. [AC9] Visual: sky + fog flat `#5C94FC`; world reads as flat blocks (ground green,
   trunks brick, road tan, etc.).
8. [AC10/AC11/AC12] Visual: title text unchanged; emoji present; buttons square with
   `6px 6px 0 #000` shadow that collapses on press; screens opaque, no blur.
9. [AC13] `git add -A && git commit && git push` on `master`; no branch/worktree.
