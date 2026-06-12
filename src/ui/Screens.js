// Start / Win / Lose overlays (design 6.6). Single Start and Restart buttons wired
// to the Game callbacks.

export class Screens {
  constructor({ onStart, onRestart }) {
    this.start = document.getElementById('screen-start')
    this.win = document.getElementById('screen-win')
    this.lose = document.getElementById('screen-lose')
    this.winStats = document.getElementById('win-stats')
    this.loseStats = document.getElementById('lose-stats')

    document.getElementById('btn-start').addEventListener('click', onStart)
    document.getElementById('btn-restart-win').addEventListener('click', onRestart)
    document.getElementById('btn-restart-lose').addEventListener('click', onRestart)
  }

  hideAll() {
    this.start.classList.remove('show')
    this.win.classList.remove('show')
    this.lose.classList.remove('show')
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
