// Start / Win / Lose overlays (redesign 2026-06-12-endless-procedural). The start screen offers a
// Normal and a Hard button; each calls onStart(difficulty). The WIN screen appears only at the
// stage-5 climax ("FINAL BOSS") and gains a "Continue — Endless" button (onContinueEndless). The
// LOSE screen shows the run + the persisted best (depth + peak army). Restart re-picks the tier.

export class Screens {
  constructor({ onStart, onRestart, onContinueEndless }) {
    this.start = document.getElementById('screen-start')
    this.win = document.getElementById('screen-win')
    this.lose = document.getElementById('screen-lose')
    this.winStats = document.getElementById('win-stats')
    this.loseStats = document.getElementById('lose-stats')
    this.loseBest = document.getElementById('lose-best')
    this.continueBtn = document.getElementById('btn-continue-endless')

    document.getElementById('btn-start-normal').addEventListener('click', () => onStart('normal'))
    document.getElementById('btn-start-hard').addEventListener('click', () => onStart('hard'))
    document.getElementById('btn-restart-win').addEventListener('click', onRestart)
    document.getElementById('btn-restart-lose').addEventListener('click', onRestart)
    if (this.continueBtn && onContinueEndless) this.continueBtn.addEventListener('click', onContinueEndless)
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

  showWin(stats, isFinale = true) {
    this.hideAll()
    this.winStats.textContent = stats
    // The endless-continue button only makes sense after the finite climax.
    if (this.continueBtn) this.continueBtn.style.display = isFinale ? '' : 'none'
    this.win.classList.add('show')
  }

  showLose(stats, best = '') {
    this.hideAll()
    this.loseStats.textContent = stats
    if (this.loseBest) this.loseBest.textContent = best
    this.lose.classList.add('show')
  }
}
