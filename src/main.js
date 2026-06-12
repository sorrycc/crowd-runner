import { Game } from './Game.js'
import { AudioManager } from './core/Audio.js'

// Single procedural code path (redesign 2026-06-12-endless-procedural): there are no hand-authored
// stage files anymore — Game generates every stage on demand via src/config/generator.js. The run
// is a finite 5-stage climax that unlocks an endless mode (stages 6+ rising until you lose).
//
// AudioManager is injected into the Game (constructor DI). It only fetches raw audio ArrayBuffers
// now; no AudioContext exists until the Start gesture calls unlock().
const audio = new AudioManager()
new Game(audio)
