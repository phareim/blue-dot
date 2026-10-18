// Procedural music and sound effects. Nothing is loaded; every note is synthesised.

const CHORDS = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
]
const ROOTS = [45, 41, 48, 43]
const PENTA = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88, 91]
const ARP = [0, 2, 1, 2, 0, 2, 1, 3, 0, 2, 1, 2, 3, 2, 1, 0]

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export class Sound {
  ctx: AudioContext | null = null
  muted = false
  /** 0 calm, 1 driving, 2 busy, 3 blaze. */
  intensity = 0
  private bpm = 124
  private master!: GainNode
  private music!: GainNode
  private sfx!: GainNode
  private musicFilter!: BiquadFilterNode
  private delay!: DelayNode
  private delaySend!: GainNode
  private noise!: AudioBuffer
  private nextTime = 0
  private step = 0
  private startTime = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private lastDust = 0
  private playing = false

  constructor() {
    try {
      this.muted = localStorage.getItem('blue.muted') === '1'
    } catch { /* storage blocked */ }
  }

  /** Create or resume the context. Call from every user gesture (iOS needs it). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      const ctx = new AC()
      this.ctx = ctx
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.ratio.value = 4
      comp.attack.value = 0.004
      comp.release.value = 0.2
      comp.connect(ctx.destination)
      this.master = ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 0.8
      this.master.connect(comp)
      this.musicFilter = ctx.createBiquadFilter()
      this.musicFilter.type = 'lowpass'
      this.musicFilter.frequency.value = 1200
      this.musicFilter.Q.value = 0.7
      this.music = ctx.createGain()
      this.music.gain.value = 0.55
      this.music.connect(this.musicFilter)
      this.musicFilter.connect(this.master)
      this.sfx = ctx.createGain()
      this.sfx.gain.value = 0.7
      this.sfx.connect(this.master)
      this.delay = ctx.createDelay(1)
      this.delay.delayTime.value = (60 / this.bpm) * 0.75
      const fb = ctx.createGain()
      fb.gain.value = 0.38
      const dl = ctx.createBiquadFilter()
      dl.type = 'lowpass'
      dl.frequency.value = 3000
      this.delay.connect(dl)
      dl.connect(fb)
      fb.connect(this.delay)
      this.delaySend = ctx.createGain()
      this.delaySend.gain.value = 0.5
      this.delaySend.connect(this.delay)
      dl.connect(this.master)
      const len = ctx.sampleRate
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = this.noise.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      this.startTime = ctx.currentTime + 0.05
      this.nextTime = this.startTime
      this.timer = setInterval(() => this.schedule(), 25)
    }
    if (this.ctx.state !== 'running') void this.ctx.resume()
  }

  setMuted(m: boolean) {
    this.muted = m
    try { localStorage.setItem('blue.muted', m ? '1' : '0') } catch { /* storage blocked */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05)
  }

  /** Music on (playing) or the quiet title/pause mix. */
  setPlaying(p: boolean) {
    this.playing = p
  }

  /** 1 on each beat, decaying to 0 before the next. */
  beat(): number {
    const t = this.ctx ? this.ctx.currentTime - this.startTime : performance.now() / 1000
    const ph = ((t * this.bpm) / 60) % 1
    return Math.exp(-ph * 5)
  }

  private schedule() {
    const ctx = this.ctx
    if (!ctx) return
    const cutoff = !this.playing ? 900 : this.intensity >= 3 ? 9000 : this.intensity >= 2 ? 4200 : 2600
    this.musicFilter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.4)
    const sixteenth = 60 / this.bpm / 4
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime)
      this.nextTime += sixteenth
      this.step++
    }
  }

  private playStep(step: number, t: number) {
    const s = step % 16
    const bar = Math.floor(step / 16) % 4
    const chord = CHORDS[bar]
    const lvl = this.playing ? this.intensity : -1
    if (s === 0) this.pad(chord, t, (60 / this.bpm) * 4)
    if (lvl >= 0 && s % 4 === 0) this.kick(t, lvl >= 1 ? 0.9 : 0.45)
    if (lvl >= 1 && s % 4 === 2) this.bass(hz(ROOTS[bar]), t)
    if (lvl >= 1 && s === 14) this.bass(hz(ROOTS[bar] + 12), t, 0.5)
    if (lvl >= 2 && s % 2 === 1) this.hat(t, s % 4 === 3 ? 0.07 : 0.035, s % 4 === 3 ? 0.09 : 0.03)
    if (lvl >= 1) {
      const n = chord[ARP[s] % 3] + 12 + (ARP[s] === 3 ? 12 : 0)
      if (lvl >= 2 || s % 2 === 0) this.pluck(hz(n), t, lvl >= 2 ? 0.06 : 0.04)
    }
    if (lvl >= 3) {
      if (s === 4 || s === 12) this.clap(t)
      if (s % 2 === 0) this.lead(hz(PENTA[(s / 2 + bar * 3) % 8] + 12), t)
    }
  }

  // ---- voices -----------------------------------------------------------------------------

  private env(t: number, a: number, peak: number, d: number, dest: AudioNode): GainNode {
    const g = this.ctx!.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a)
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
    g.connect(dest)
    return g
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, dest: AudioNode, detune = 0): OscillatorNode {
    const o = this.ctx!.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f, t)
    o.detune.value = detune
    o.connect(dest)
    o.start(t)
    o.stop(t + dur + 0.05)
    return o
  }

  private noiseSrc(t: number, dur: number, dest: AudioNode): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource()
    s.buffer = this.noise
    s.connect(dest)
    s.start(t, Math.random() * 0.5)
    s.stop(t + dur + 0.05)
    return s
  }

  private pad(chord: number[], t: number, dur: number) {
    const ctx = this.ctx!
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 700
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.045, t + 0.8)
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6)
    f.connect(g)
    g.connect(this.music)
    for (const m of chord) {
      this.osc('sawtooth', hz(m - 12), t, dur + 0.6, f, -7)
      this.osc('sawtooth', hz(m - 12), t, dur + 0.6, f, 7)
    }
  }

  private kick(t: number, v: number) {
    const g = this.env(t, 0.002, v, 0.32, this.music)
    const o = this.osc('sine', 150, t, 0.35, g)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14)
  }

  private bass(f: number, t: number, v = 1) {
    const ctx = this.ctx!
    const flt = ctx.createBiquadFilter()
    flt.type = 'lowpass'
    flt.Q.value = 6
    flt.frequency.setValueAtTime(1600, t)
    flt.frequency.exponentialRampToValueAtTime(180, t + 0.16)
    const g = this.env(t, 0.004, 0.22 * v, 0.2, this.music)
    flt.connect(g)
    this.osc('sawtooth', f, t, 0.22, flt)
    this.osc('square', f / 2, t, 0.22, flt)
  }

  private hat(t: number, v: number, d: number) {
    const ctx = this.ctx!
    const f = ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 7500
    const g = this.env(t, 0.001, v, d, this.music)
    f.connect(g)
    this.noiseSrc(t, d + 0.02, f)
  }

  private clap(t: number) {
    const ctx = this.ctx!
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 1400
    f.Q.value = 1.2
    const g = this.env(t, 0.002, 0.22, 0.14, this.music)
    f.connect(g)
    this.noiseSrc(t, 0.18, f)
  }

  private pluck(f: number, t: number, v: number) {
    const g = this.env(t, 0.003, v, 0.18, this.music)
    g.connect(this.delaySend)
    this.osc('triangle', f, t, 0.22, g)
    this.osc('square', f * 2, t, 0.06, this.env(t, 0.002, v * 0.25, 0.05, g))
  }

  private lead(f: number, t: number) {
    const g = this.env(t, 0.01, 0.05, 0.24, this.music)
    g.connect(this.delaySend)
    this.osc('sawtooth', f, t, 0.26, g, -5)
    this.osc('sawtooth', f, t, 0.26, g, 6)
  }

  // ---- effects ----------------------------------------------------------------------------

  private now(): number | null {
    if (!this.ctx || this.ctx.state !== 'running') return null
    return this.ctx.currentTime
  }

  capture(count: number, chain: number) {
    const t = this.now()
    if (t === null) return
    const notes = Math.min(6, 1 + Math.floor(count / 2))
    const base = Math.min(PENTA.length - 6, chain)
    for (let i = 0; i < notes; i++) {
      const tt = t + i * 0.035
      const g = this.env(tt, 0.004, 0.12, 0.7, this.sfx)
      g.connect(this.delaySend)
      this.osc('sine', hz(PENTA[base + i] + 12), tt, 0.8, g)
      this.osc('triangle', hz(PENTA[base + i]), tt, 0.5, this.env(tt, 0.004, 0.06, 0.4, this.sfx))
    }
    if (count >= 5) {
      const g = this.env(t, 0.005, 0.5, 0.6, this.sfx)
      const o = this.osc('sine', 120, t, 0.7, g)
      o.frequency.exponentialRampToValueAtTime(38, t + 0.5)
    }
  }

  pop() {
    const t = this.now()
    if (t === null) return
    const g = this.env(t, 0.001, 0.06, 0.08, this.sfx)
    const o = this.osc('square', 900 + Math.random() * 600, t, 0.09, g)
    o.frequency.exponentialRampToValueAtTime(200, t + 0.08)
  }

  dust() {
    const t = this.now()
    if (t === null || t - this.lastDust < 0.045) return
    this.lastDust = t
    const g = this.env(t, 0.001, 0.03, 0.05, this.sfx)
    this.osc('sine', hz(PENTA[8 + Math.floor(Math.random() * 6)] + 12), t, 0.06, g)
  }

  pickup() {
    const t = this.now()
    if (t === null) return
    for (let i = 0; i < 4; i++) {
      const g = this.env(t + i * 0.05, 0.003, 0.09, 0.25, this.sfx)
      g.connect(this.delaySend)
      this.osc('triangle', hz(PENTA[6 + i * 2]), t + i * 0.05, 0.3, g)
    }
  }

  hit() {
    const t = this.now()
    if (t === null) return
    const ctx = this.ctx!
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(3000, t)
    f.frequency.exponentialRampToValueAtTime(200, t + 0.4)
    f.connect(this.env(t, 0.002, 0.5, 0.45, this.sfx))
    this.noiseSrc(t, 0.5, f)
    const o = this.osc('square', 320, t, 0.45, this.env(t, 0.002, 0.18, 0.4, this.sfx))
    o.frequency.exponentialRampToValueAtTime(50, t + 0.4)
  }

  cut() {
    const t = this.now()
    if (t === null) return
    const ctx = this.ctx!
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.setValueAtTime(5000, t)
    f.frequency.exponentialRampToValueAtTime(1500, t + 0.2)
    f.Q.value = 4
    f.connect(this.env(t, 0.002, 0.3, 0.22, this.sfx))
    this.noiseSrc(t, 0.25, f)
  }

  jump() {
    const t = this.now()
    if (t === null) return
    const o = this.osc('sine', 280, t, 0.16, this.env(t, 0.004, 0.12, 0.14, this.sfx))
    o.frequency.exponentialRampToValueAtTime(760, t + 0.12)
  }

  land(power = 1) {
    const t = this.now()
    if (t === null) return
    const o = this.osc('sine', 110, t, 0.25, this.env(t, 0.002, 0.25 * power, 0.22, this.sfx))
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2)
  }

  launch() {
    const t = this.now()
    if (t === null) return
    const ctx = this.ctx!
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 2
    f.frequency.setValueAtTime(300, t)
    f.frequency.exponentialRampToValueAtTime(6000, t + 1.4)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.5)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2)
    f.connect(g)
    g.connect(this.sfx)
    this.noiseSrc(t, 2.3, f)
    const o = this.osc('sawtooth', 110, t, 1.6, this.env(t, 0.05, 0.12, 1.4, this.sfx))
    o.frequency.exponentialRampToValueAtTime(880, t + 1.4)
  }

  lit() {
    const t = this.now()
    if (t === null) return
    const notes = [60, 64, 67, 72, 76, 79]
    notes.forEach((m, i) => {
      const g = this.env(t + i * 0.06, 0.01, 0.1, 1.6, this.sfx)
      g.connect(this.delaySend)
      this.osc('sawtooth', hz(m), t + i * 0.06, 1.7, g, i % 2 ? 6 : -6)
    })
  }

  boon() {
    const t = this.now()
    if (t === null) return
    for (let i = 0; i < 6; i++) {
      const g = this.env(t + i * 0.04, 0.003, 0.08, 0.5, this.sfx)
      g.connect(this.delaySend)
      this.osc('sine', hz(PENTA[4 + i] + 12), t + i * 0.04, 0.55, g)
    }
  }

  blaze() {
    const t = this.now()
    if (t === null) return
    for (const m of [45, 52, 57, 64]) this.osc('sawtooth', hz(m), t, 0.9, this.env(t, 0.02, 0.08, 0.8, this.sfx))
    const o = this.osc('square', 220, t, 0.6, this.env(t, 0.01, 0.08, 0.5, this.sfx))
    o.frequency.exponentialRampToValueAtTime(1760, t + 0.5)
  }

  nova(big = false) {
    const t = this.now()
    if (t === null) return
    const ctx = this.ctx!
    const len = big ? 3 : 1.2
    const o = this.osc('sine', 90, t, len, this.env(t, 0.01, 0.8, len, this.sfx))
    o.frequency.exponentialRampToValueAtTime(26, t + len)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(8000, t)
    f.frequency.exponentialRampToValueAtTime(120, t + len)
    f.connect(this.env(t, 0.01, big ? 0.7 : 0.4, len, this.sfx))
    this.noiseSrc(t, len + 0.1, f)
  }

  over() {
    const t = this.now()
    if (t === null) return
    ;[69, 65, 62, 57].forEach((m, i) => {
      this.osc('triangle', hz(m), t + i * 0.18, 0.5, this.env(t + i * 0.18, 0.01, 0.12, 0.45, this.sfx))
    })
  }

  dispose() {
    if (this.timer) clearInterval(this.timer)
    void this.ctx?.close()
    this.ctx = null
  }
}
