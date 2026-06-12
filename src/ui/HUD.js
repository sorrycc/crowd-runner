// DOM HUD overlay (design 6.8). Reads game state each frame and writes the count,
// combo, timer, stage label, the single phase-switching top bar (run-distance →
// boss-HP red), and the active power-up chips (replacing the old coin pill). A
// transient banner announces stage advances.

function formatTime(t) {
  const s = Math.max(0, Math.ceil(t))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function clampPct(p) {
  return Math.max(0, Math.min(100, p))
}

export class HUD {
  constructor(audio = null) {
    this.audio = audio
    this.root = document.getElementById('hud')
    this.fill = document.getElementById('progress-fill')
    this.count = document.getElementById('hud-count')
    this.stage = document.getElementById('hud-stage')
    this.combo = document.getElementById('hud-combo')
    this.timer = document.getElementById('hud-timer')
    this.banner = document.getElementById('hud-banner')

    this.buffRapid = document.getElementById('buff-rapid')
    this.buffShield = document.getElementById('buff-shield')
    this.buffDamage = document.getElementById('buff-damage')

    this._bannerTimer = null

    // Mute toggle (HUD corner; in-game only). Default unmuted, state persisted by the
    // AudioManager to localStorage; clicking silences SFX + music live via the master gain.
    this.muteBtn = document.getElementById('btn-mute')
    if (this.muteBtn && this.audio) {
      this.muteBtn.addEventListener('click', () => {
        this.audio.setMuted(!this.audio.isMuted())
        this._renderMute()
      })
      this._renderMute() // reflect persisted state on load
    }
  }

  _renderMute() {
    if (!this.muteBtn || !this.audio) return
    const muted = this.audio.isMuted()
    this.muteBtn.textContent = muted ? '🔇' : '🔊'
    this.muteBtn.classList.toggle('is-muted', muted)
    this.muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute')
    this.muteBtn.setAttribute('aria-pressed', String(muted))
  }

  show(label) {
    this.stage.textContent = label
    this.root.classList.add('show')
  }

  hide() {
    this.root.classList.remove('show')
  }

  flashBanner(text) {
    this.banner.textContent = text
    this.banner.classList.add('show')
    clearTimeout(this._bannerTimer)
    this._bannerTimer = setTimeout(() => this.banner.classList.remove('show'), 1100)
  }

  update(s) {
    this.count.textContent = s.count
    this.timer.textContent = formatTime(s.timeRemaining)

    if (s.combo >= 2) {
      this.combo.textContent = `${s.combo} COMBO`
      this.combo.classList.remove('hidden')
    } else {
      this.combo.classList.add('hidden')
    }

    // active power-up chips
    this._chip(this.buffRapid, s.rapidLeft > 0, `⚡ RAPID ${Math.ceil(s.rapidLeft)}s`)
    this._chip(this.buffShield, s.shieldLeft > 0, `🛡 SHIELD ${Math.ceil(s.shieldLeft)}s`)
    this._chip(this.buffDamage, s.dmgMult > 1.0001, `DMG ×${s.dmgMult.toFixed(2)}`)

    if (s.phase === 'BOSS') {
      this.fill.style.width = clampPct(s.bossHpFrac * 100) + '%'
      this.fill.style.background = 'linear-gradient(90deg, #f87171, #ef4444)'
    } else {
      this.fill.style.width = clampPct(s.runProgress * 100) + '%'
      this.fill.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)'
    }
  }

  _chip(el, active, text) {
    if (active) {
      el.textContent = text
      el.classList.remove('hidden')
    } else {
      el.classList.add('hidden')
    }
  }
}
