import STAGE_1 from './config/stage1.js'
import { Game } from './Game.js'

// Single stage import site (design 6.1, AC16): swapping/adding a stage is a
// one-line change here — the engine never imports a specific stage file.
new Game(STAGE_1)
