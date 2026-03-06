const TRACK_MAP = {
  day: '/audio/bgm/calm.mp3',
  evening: '/audio/bgm/calm.mp3',
  night: '/audio/bgm/night.mp3',
}

class AudioManager {
  constructor() {
    this.current = null
    this.next = null
    this.muted = JSON.parse(localStorage.getItem('bgmMuted') || 'false')
    this.currentTime = null
    this.started = false
    this._fadeTimer = null
  }

  setTimeOfDay(time) {
    const src = TRACK_MAP[time]
    if (!src || src === this.currentTime) return
    this.currentTime = src

    if (!this.started) return

    if (!this.current) {
      this._play(src)
      return
    }

    // crossfade
    this._crossfade(src)
  }

  _play(src) {
    const audio = new Audio(src)
    audio.loop = true
    audio.volume = this.muted ? 0 : 0.3
    audio.play().catch(() => {})
    this.current = audio
  }

  _crossfade(src) {
    const old = this.current
    const next = new Audio(src)
    next.loop = true
    next.volume = 0
    next.play().catch(() => {})
    this.next = next

    let step = 0
    const steps = 20
    const interval = 100 // 2s total

    if (this._fadeTimer) clearInterval(this._fadeTimer)
    this._fadeTimer = setInterval(() => {
      step++
      const progress = step / steps
      const targetVol = this.muted ? 0 : 0.3

      if (old) old.volume = Math.max(0, targetVol * (1 - progress))
      next.volume = targetVol * progress

      if (step >= steps) {
        clearInterval(this._fadeTimer)
        this._fadeTimer = null
        if (old) { old.pause(); old.src = '' }
        this.current = next
        this.next = null
      }
    }, interval)
  }

  toggle() {
    this.muted = !this.muted
    localStorage.setItem('bgmMuted', JSON.stringify(this.muted))

    const vol = this.muted ? 0 : 0.3
    if (this.current) this.current.volume = vol
    if (this.next) this.next.volume = this.muted ? 0 : this.next.volume

    return this.muted
  }

  tryAutoPlay() {
    if (this.started) return
    this.started = true
    if (this.currentTime) {
      this._play(this.currentTime)
    }
  }
}

export default new AudioManager()
