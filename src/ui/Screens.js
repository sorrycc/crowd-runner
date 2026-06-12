// Start / Win / Lose overlays (design 6.6 / difficulty-tiers 6.4). The start screen offers a
// Normal and a Hard button; each calls onStart(difficulty). Restart returns here so the player
// re-picks the tier (Game.restart → showStart).

export class Screens {
  constructor({ onStart, onRestart }) {
    this.start = document.getElementById('screen-start')
    this.win = document.getElementById('screen-win')
    this.lose = document.getElementById('screen-lose')
    this.winStats = document.getElementById('win-stats')
    this.loseStats = document.getElementById('lose-stats')

    document.getElementById('btn-start-normal').addEventListener('click', () => onStart('normal'))
    document.getElementById('btn-start-hard').addEventListener('click', () => onStart('hard'))
    document.getElementById('btn-restart-win').addEventListener('click', onRestart)
    document.getElementById('btn-restart-lose').addEventListener('click', onRestart)
  }

  hideAll() {
    this.start.classList.remove('show')
    this.win.classList.remove('show')
    this.lose.classList.remove('show')
  }

  // Return to the start screen (restart → re-pick tier).
  showStart() {
    this.hideAll()
    this.start.classList.add('show')
  }

  showWin(stats) {
    this.hideAll()
    this.winStats.textContent = stats
    this.win.classList.add('show')
  }

  showLose(stats) {
    this.hideAll()
    this.loseStats.textContent = stats
    this.lose.classList.add('show')
  }
}
