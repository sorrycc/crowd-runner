// AudioManager (design 2026-06-12-audio-sfx-music-mute). WebAudio playback for the game's
// SFX + looping music bed. Each sound is decoded ONCE into a cached, reused AudioBuffer
// (this.buffers); play() spawns a fresh short-lived BufferSource off that cached buffer
// through a single master GainNode — so overlapping SFX (e.g. gunshots) never cut each
// other off, and the master gain gives instant live mute/volume. (AudioBufferSourceNodes
// are single-use by spec; the *buffer* is the pooled resource, not the source node.)
//
// Autoplay policy (AC6): no AudioContext is created until unlock() runs inside the Start
// click handler — before that we only fetch raw ArrayBuffers, which trips no warning and
// makes no sound. decodeAudioData runs once, lazily, in unlock().

const MUTE_KEY = 'swarmrun.muted'
const MIN_INTERVAL = 0.06 // s — per-sound min gap; collapses machine-gun bursts
const MUSIC_VOL = 0.5
const RAMP = 0.015 // s — click-free mute ramp

export class AudioManager {
  constructor() {
    this.ctx = null
    this.master = null
    this.musicGain = null
    this.musicSource = null
    this.buffers = new Map() // name -> AudioBuffer (decoded once, reused)
    this.pending = new Map() // name -> Promise<ArrayBuffer | null>
    this._last = new Map() // name -> ctx.currentTime of last play (spam guard)
    this._wantMusic = false
    this.unlocked = false
    this.muted = this._loadMuted()
    this._fetchAll() // eager ArrayBuffer fetch — no AudioContext yet (AC6)
  }

  // Fingerprinted asset URLs via Vite glob (DRY — drop a file in to add a sound).
  _fetchAll() {
    const mods = import.meta.glob('../assets/audio/*.mp3', {
      eager: true,
      query: '?url',
      import: 'default',
    })
    for (const [path, url] of Object.entries(mods)) {
      const name = path.split('/').pop().replace(/\.mp3$/, '')
      this.pending.set(
        name,
        fetch(url)
          .then((r) => r.arrayBuffer())
          .catch(() => null)
      )
    }
  }

  // Called from the Start gesture. Creates the context + decodes on first call; thereafter
  // only resumes (cheap, gesture-preserving). See the two music start-up regimes below.
  async unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      this.ctx = new Ctx()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 1
      this.master.connect(this.ctx.destination)
      // Resume synchronously inside the gesture stack (don't await before this) so the
      // autoplay policy reliably honors it — esp. Safari (AC6). Decode happens after.
      if (this.ctx.state === 'suspended') this.ctx.resume()
      await this._decodeAll()
      this.unlocked = true
      if (this._wantMusic) this.playMusic() // first-run: queued music starts here
      return
    }
    // subsequent calls (restart): page has sticky activation, plain resume is fine
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume()
      } catch {
        /* best-effort */
      }
    }
  }

  async _decodeAll() {
    await Promise.all(
      [...this.pending].map(async ([name, p]) => {
        const buf = await p
        if (!buf) return
        try {
          // slice(0): decodeAudioData detaches its input; pass a copy so the cached
          // ArrayBuffer stays re-decodable.
          this.buffers.set(name, await this.ctx.decodeAudioData(buf.slice(0)))
        } catch {
          /* skip undecodable asset */
        }
      })
    )
  }

  // One-shot SFX. No-op before unlock, when muted, when the buffer isn't ready, or when the
  // same sound played < MIN_INTERVAL ago (anti machine-gun).
  play(name, { volume = 1, rate = 1 } = {}) {
    if (!this.ctx || this.muted) return
    const buf = this.buffers.get(name)
    if (!buf) return
    const now = this.ctx.currentTime
    if (now - (this._last.get(name) ?? -1) < MIN_INTERVAL) return
    this._last.set(name, now)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = rate
    const g = this.ctx.createGain()
    g.gain.value = volume
    src.connect(g).connect(this.master)
    src.start()
  }

  // Looping music bed. Idempotent (won't stack a second loop). Two start-up regimes:
  //  • first run  — called from start() before decode finishes → queues via _wantMusic;
  //                 unlock()'s post-decode call actually starts it.
  //  • restart    — ctx + buffer already exist → starts synchronously here.
  playMusic() {
    if (!this.ctx) {
      this._wantMusic = true
      return
    }
    if (this.musicSource) return
    const buf = this.buffers.get('music-loop')
    if (!buf) {
      this._wantMusic = true
      return
    }
    this.musicGain = this.ctx.createGain()
    this.musicGain.gain.value = MUSIC_VOL
    this.musicGain.connect(this.master)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.connect(this.musicGain)
    src.start()
    this.musicSource = src
    this._wantMusic = false
  }

  stopMusic() {
    this._wantMusic = false
    if (this.musicSource) {
      try {
        this.musicSource.stop()
      } catch {
        /* already stopped */
      }
      this.musicSource = null
    }
  }

  // Live mute via the master gain (silences SFX + music immediately); persisted to storage.
  setMuted(muted) {
    this.muted = muted
    this._saveMuted(muted)
    if (this.master && this.ctx) {
      const t = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(t)
      this.master.gain.setValueAtTime(this.master.gain.value, t)
      this.master.gain.linearRampToValueAtTime(muted ? 0 : 1, t + RAMP)
    }
  }

  isMuted() {
    return this.muted
  }

  _loadMuted() {
    try {
      return localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      return false // storage unavailable (private mode) — default unmuted
    }
  }

  _saveMuted(m) {
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0')
    } catch {
      /* persistence is best-effort */
    }
  }
}
