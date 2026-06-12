import STAGE_1 from './config/stage1.js'
import STAGE_2 from './config/stage2.js'
import { Game } from './Game.js'

// Stage list import site (design 6.9, AC11): adding/reordering stages is a one-line
// change here — the engine never imports a specific stage file. Stages auto-advance;
// clearing the final stage's boss wins.
new Game([STAGE_1, STAGE_2])
