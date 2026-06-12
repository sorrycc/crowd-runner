#!/usr/bin/env bash
# Reproducible audio generator for Swarm Run (design 2026-06-12-audio-sfx-music-mute, AC1).
#
# All sounds are SELF-AUTHORED and dedicated to the PUBLIC DOMAIN (CC0) — synthesized from
# ffmpeg primitives (sine/square/noise/sweeps), no third-party samples. Dev-only tool:
# requires a local `ffmpeg`. NEVER invoked by `npm run build`, `npm run verify`, or CI —
# the build consumes the committed .mp3 files directly. Re-run to regenerate identical
# assets:  bash scripts/gen-audio.sh
#
# Output: src/assets/audio/*.mp3  (12 SFX + 1 looping music bed).
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="src/assets/audio"
mkdir -p "$OUT"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found — install it (brew install ffmpeg) to regenerate audio." >&2
  exit 1
fi

# Shared encode: mono, 44.1k, small CBR mp3. $1=output name, $2=ffmpeg -af filtergraph,
# $3=duration seconds. Source is a silent base we shape with aevalsrc/anoisesrc per call.
sfx() { # name  lavfi-source  duration
  local name="$1" src="$2" dur="$3"
  ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i "$src" -t "$dur" \
    -ac 1 -ar 44100 -c:a libmp3lame -b:a 96k "$OUT/$name.mp3"
  echo "  $name.mp3"
}

echo "Generating SFX -> $OUT"

# Weapon fire — short bright square blip with fast decay.
sfx shoot \
  "aevalsrc='(0.5*sgn(sin(2*PI*620*t))+0.3*sin(2*PI*1240*t))*exp(-28*t)':s=44100:d=0.16" 0.16

# Gate — good pick: pleasant rising two-tone (C5 -> E5).
sfx gate-good \
  "aevalsrc='(sin(2*PI*523*t)*exp(-6*t))+(sin(2*PI*659*t)*exp(-6*(t-0.09))*gt(t,0.09))*0.9':s=44100:d=0.35" 0.35

# Gate — bad pick: low descending buzz.
sfx gate-bad \
  "aevalsrc='(0.5*sgn(sin(2*PI*(180-90*t)*t)))*exp(-7*t)':s=44100:d=0.30" 0.30

# Power-up pickup — quick rising arpeggio (G5 B5 D6).
sfx powerup \
  "aevalsrc='sin(2*PI*784*t)*exp(-9*t)+sin(2*PI*988*t)*exp(-9*(t-0.07))*gt(t,0.07)+sin(2*PI*1175*t)*exp(-9*(t-0.14))*gt(t,0.14)':s=44100:d=0.36" 0.36

# Block destroyed — filtered noise thud.
sfx block-break \
  "anoisesrc=color=brown:amplitude=0.7:d=0.28" 0.28

# Enemy squad down — descending blip (square, falling pitch).
sfx enemy-down \
  "aevalsrc='0.5*sgn(sin(2*PI*(440-260*t)*t))*exp(-9*t)':s=44100:d=0.26" 0.26

# Soldier loss / hurt — short low body-hit.
sfx hurt \
  "aevalsrc='(sin(2*PI*150*t)+0.5*sin(2*PI*90*t))*exp(-20*t)':s=44100:d=0.16" 0.16

# Boss shot fired — laser zap (fast downward sweep).
sfx boss-shot \
  "aevalsrc='0.5*sin(2*PI*(1200-1500*t)*t)*exp(-10*t)':s=44100:d=0.22" 0.22

# Boss defeated — big explosive noise sweep + low boom.
sfx boss-down \
  "aevalsrc='(0.7*random(0)-0.35)*exp(-5*t)+0.5*sin(2*PI*70*t)*exp(-3.5*t)':s=44100:d=0.70" 0.70

# Stage advance — bright fanfare (C5 -> G5).
sfx stage-advance \
  "aevalsrc='sin(2*PI*523*t)*exp(-5*t)+sin(2*PI*784*t)*exp(-5*(t-0.12))*gt(t,0.12)':s=44100:d=0.45" 0.45

# Win — triumphant major triad swell (C5 E5 G5 held).
sfx win \
  "aevalsrc='(sin(2*PI*523*t)+sin(2*PI*659*t)+sin(2*PI*784*t))*0.33*(1-exp(-12*t))*exp(-1.6*t)':s=44100:d=1.10" 1.10

# Lose — sad descending minor (A4 -> F4 -> D4).
sfx lose \
  "aevalsrc='sin(2*PI*440*t)*exp(-3*t)+sin(2*PI*349*t)*exp(-3*(t-0.25))*gt(t,0.25)+sin(2*PI*294*t)*exp(-3*(t-0.5))*gt(t,0.5)':s=44100:d=1.10" 1.10

# Background music — seamless 16s loop: a steady pulsing two-note bass with a soft pad.
# Built to wrap cleanly (period divides the duration) so loop=true has no audible seam.
echo "Generating music bed (16s loop) -> $OUT"
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "aevalsrc='0.22*sin(2*PI*110*t)*(0.6+0.4*sgn(sin(2*PI*2*t)))+0.16*sin(2*PI*220*t)*(0.5+0.5*sin(2*PI*0.25*t))+0.10*sin(2*PI*330*t)*(0.5+0.5*sin(2*PI*0.5*t)):s=44100:d=16'" \
  -t 16 -ac 1 -ar 44100 -c:a libmp3lame -b:a 80k "$OUT/music-loop.mp3"
echo "  music-loop.mp3"

echo "Done. $(ls "$OUT"/*.mp3 | wc -l | tr -d ' ') files in $OUT"
