// Probe: load the game at one size and report what the page is doing, every second, for N seconds.
//   node scripts/probe.mjs [url] [width] [height] [dpr] [mobile 0|1] [seconds]
import { launch } from './cdp.mjs'

const [url = 'http://127.0.0.1:4180/', w = '390', h = '844', dpr = '3', mobile = '1', secs = '12'] = process.argv.slice(2)
const b = await launch({ width: +w, height: +h, dpr: +dpr, mobile: mobile === '1' })
const t0 = Date.now()
try {
  await b.send('Page.navigate', { url })
  for (let i = 0; i < +secs; i++) {
    await b.sleep(1000)
    const s = await Promise.race([
      b.eval(`(() => { const g = window.blue; if (!g) return 'no game'; return { time: +g.time.toFixed(2), mode: g.mode, dpr: g.dpr, w: innerWidth, h: innerHeight, coarse: matchMedia('(pointer: coarse)').matches } })()`),
      b.sleep(4000).then(() => 'eval timed out'),
    ])
    console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(s))
  }
  const s0 = Date.now()
  const shot = await Promise.race([b.shot('/tmp/blue-probe.png').then(() => 'ok'), b.sleep(20000).then(() => 'screenshot timed out')])
  console.log('screenshot', shot, `${Date.now() - s0} ms`)
  console.log('errors', JSON.stringify(b.errors.slice(0, 5)))
} finally {
  await b.close()
}
