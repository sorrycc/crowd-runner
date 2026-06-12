// DOM HUD overlay (design 6.6). Reads game state each frame and writes the count,
// coins, combo, timer, stage label, and the single phase-switching top bar:
// run-distance fraction during RUN, boss-HP fraction (red) during BOSS (Decision 7).

function formatTime(t) {
  const s = Math.max(0, Math.ceil(t))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function clampPct(p) {
  return Math.max(0, Math.min(100, p))
}

export class HUD {
  constructor() {
    this.root = document.getElementById('hud')
    this.fill = document.getElementById('progress-fill')
    this.count = document.getElementById('hud-count')
    this.stage = document.getElementById('hud-stage')
    this.coins = document.getElementById('hud-coins')
    this.combo = document.getElementById('hud-combo')
    this.timer = document.getElementById('hud-timer')
  }

  show(label) {
    this.stage.textContent = label
    this.root.classList.add('show')
  }

  hide() {
    this.root.classList.remove('show')
  }

  update(s) {
    this.count.textContent = s.count
    this.coins.textContent = s.coins
    this.timer.textContent = formatTime(s.timeRemaining)

    if (s.combo >= 2) {
      this.combo.textContent = `${s.combo} COMBO`
      this.combo.classList.remove('hidden')
    } else {
      this.combo.classList.add('hidden')
    }

    if (s.phase === 'BOSS') {
      this.fill.style.width = clampPct(s.bossHpFrac * 100) + '%'
      this.fill.style.background = 'linear-gradient(90deg, #f87171, #ef4444)'
    } else {
      this.fill.style.width = clampPct(s.runProgress * 100) + '%'
      this.fill.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)'
    }
  }
}
