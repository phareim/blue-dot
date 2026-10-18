// Audio probe: start a run, fire every sound effect and every music level, report exceptions.
//   node scripts/probe-audio.mjs [url]
import { launch } from './cdp.mjs'

const url = process.argv[2] || 'http://127.0.0.1:4181/'
const b = await launch({ width: 800, height: 600, flags: ['--autoplay-policy=no-user-gesture-required'] })
try {
  await b.goto(url)
  await b.eval('window.blue.start()')
  await b.sleep(1500)
  const res = await b.eval(`(async () => {
    const s = window.blue.sound
    const out = { state: s.ctx && s.ctx.state, thrown: [] }
    const fx = [['capture', 8, 3], ['capture', 1, 1], ['pop'], ['dust'], ['pickup'], ['hit'], ['cut'], ['jump'], ['land', 1.5], ['launch'], ['lit'], ['boon'], ['blaze'], ['nova', true], ['over']]
    for (const [name, ...args] of fx) { try { s[name](...args) } catch (e) { out.thrown.push(name + ': ' + e.message) } }
    // Peak and RMS on the master bus at each music level (effects first, then music alone).
    const an = s.ctx.createAnalyser()
    an.fftSize = 2048
    s.master.connect(an)
    const buf = new Float32Array(an.fftSize)
    const measure = async (ms) => {
      let peak = 0, sum = 0, n = 0
      const end = performance.now() + ms
      while (performance.now() < end) {
        an.getFloatTimeDomainData(buf)
        for (const v of buf) { peak = Math.max(peak, Math.abs(v)); sum += v * v; n++ }
        await new Promise((r) => setTimeout(r, 40))
      }
      return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / n).toFixed(3) }
    }
    out.effects = await measure(1500)
    // Stop the game loop so it no longer sets the intensity; the music scheduler runs on its own timer.
    cancelAnimationFrame(window.blue.raf)
    window.blue.raf = 0
    s.playing = true
    out.levels = {}
    for (const lvl of [0, 1, 2, 3]) { s.intensity = lvl; await new Promise((r) => setTimeout(r, 600)); out.levels[lvl] = await measure(2000) }
    out.time = s.ctx && s.ctx.currentTime
    return out
  })()`)
  console.log(JSON.stringify(res))
  console.log('errors', JSON.stringify(b.errors.slice(0, 5)))
} finally {
  await b.close()
}
