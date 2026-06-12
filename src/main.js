import STAGE_1 from './config/stage1.js'
import STAGE_2 from './config/stage2.js'
import STAGE_3 from './config/stage3.js'
import { Game } from './Game.js'
import { AudioManager } from './core/Audio.js'

// Stage list import site (design 6.9, AC11): adding/reordering stages is a one-line
// change here — the engine never imports a specific stage file. Stages auto-advance;
// clearing the final stage's boss wins.
//
// AudioManager is injected into the Game (constructor DI). It only fetches raw audio
// ArrayBuffers now; no AudioContext exists until the Start gesture calls unlock() (AC6).
const audio = new AudioManager()
new Game([STAGE_1, STAGE_2, STAGE_3], audio)
