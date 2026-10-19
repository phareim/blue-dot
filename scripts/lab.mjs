// Lab run: drive the built game in headless Chrome and save stills.
//   node scripts/lab.mjs [url] [outdir] [size]      size: desktop | phone | small | all (default all)
// On Sleeper, WebGL needs SwiftShader: CHROME_BIN=<wrapper> heavy -x chrome -- node scripts/lab.mjs
// The game is slow there, so every wait is in game time (window.blue.time), not wall time.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from './cdp.mjs'

const url = process.argv[2] || 'http://localhost:4173/'
const out = process.argv[3] || join(process.env.HOME, 'zshots/blue')
const which = process.argv[4] || 'all'
mkdirSync(out, { recursive: true })

const SIZES = {
  desktop: { width: 1280, height: 800, dpr: 1, mobile: false },
  phone: { width: 390, height: 844, dpr: 2, mobile: true },
  // iPhone Safari with its toolbars showing.
  safari: { width: 390, height: 664, dpr: 2, mobile: true },
  small: { width: 375, height: 667, dpr: 2, mobile: true },
}

/** Resolve after `secs` of game time, or `maxMs` of wall time. */
const gameWait = (secs, maxMs = 90000) => `new Promise((res) => {
  const t0 = window.blue.time, w0 = performance.now()
  const tick = () => (window.blue.time - t0 >= ${secs} || performance.now() - w0 > ${maxMs}) ? res(window.blue.time - t0) : setTimeout(tick, 50)
  tick()
})`

async function run(name, size) {
  const b = await launch(size)
  const log = (...a) => console.log(`[${name}]`, ...a)
  try {
    await b.goto(url)
    await b.eval(gameWait(1.5, 30000))
    await b.shot(join(out, `${name}-1-title.png`))
    await b.eval('window.blue.start()')
    await b.eval(gameWait(0.6, 40000))
    await b.shot(join(out, `${name}-2-intro.png`))
    // Skip the rest of the intro flight.
    await b.eval('window.blue.flight && (window.blue.flight.time = window.blue.flight.duration)')
    await b.eval(gameWait(1.2, 40000))
    await b.shot(join(out, `${name}-3-landed.png`))
    const before = await b.eval('({ mode: window.blue.mode, world: window.blue.worldIdx, enemies: window.blue.swarm.list.length, fps: 0 })')
    log('after landing', JSON.stringify(before))

    if (size.mobile) {
      // Touch spin: swipe left with a negative id, then rest the finger. The ground follows the finger,
      // so the comet should run right on screen and keep running right while the finger rests.
      const pos = await b.eval(`(() => { const g = window.blue; const v = g.comet.pos.clone().project(g.rig.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight } })()`)
      const heading = `(() => { const g = window.blue; const e = g.rig.camera.matrixWorld.elements; return g.comet.facing.x * e[0] + g.comet.facing.y * e[1] + g.comet.facing.z * e[2] })()`
      // A touch that wobbles 8 px is still a tap, not a swipe: it must not set a heading. (Whether it jumps
      // can't be checked here: SwiftShader takes over a second between touchStart and touchEnd, past TAP_MS.)
      await b.touch('touchStart', [{ x: pos.x + 60, y: pos.y + 200, id: -5 }])
      await b.touch('touchMove', [{ x: pos.x + 66, y: pos.y + 205, id: -5 }])
      await b.eval(gameWait(0.1, 20000))
      const wobbleSwiped = await b.eval('window.blue.spin.on')
      await b.touch('touchEnd', [])
      log(`touch wobble: became a swipe ${wobbleSwiped} (${wobbleSwiped ? 'FAIL' : 'PASS'})`)
      const headingBefore = await b.eval(heading)
      const fx = Math.min(size.width - 20, pos.x + 70)
      const fy = Math.min(size.height - 20, pos.y + 160)
      await b.touch('touchStart', [{ x: fx, y: fy, id: -7 }])
      await b.eval(gameWait(0.03, 8000))
      for (let i = 1; i <= 6; i++) {
        await b.touch('touchMove', [{ x: fx - i * 24, y: fy, id: -7 }])
        await b.eval(gameWait(0.03, 8000))
      }
      await b.eval(gameWait(1.0, 40000))
      const headingRest = await b.eval(heading)
      await b.eval(gameWait(0.6, 30000))
      const headingLater = await b.eval(heading)
      await b.touch('touchEnd', [])
      const ok = headingRest > 0.8 && headingLater > 0.8
      log(`touch spin: screen-right component of heading ${headingBefore.toFixed(2)} -> ${headingRest.toFixed(2)} -> ${headingLater.toFixed(2)} resting (${ok ? 'PASS' : 'FAIL'})`)
      // Draw a loop with the finger: circling it spins the planet in a circle, so the comet runs one too.
      // The finger goes round at a fixed rate in game time, under the comet's turn rate, so the loop fits the trail.
      const rate = 3.2
      const t0 = await b.eval('window.blue.time')
      await b.touch('touchStart', [{ x: pos.x, y: pos.y - 120, id: -3 }])
      for (let spun = 0; spun < Math.PI * 2.4;) {
        spun = Math.min(Math.PI * 2.4, ((await b.eval('window.blue.time')) - t0) * rate)
        const a = -Math.PI / 2 + spun
        await b.touch('touchMove', [{ x: pos.x + Math.cos(a) * 120, y: pos.y + Math.sin(a) * 120, id: -3 }])
        await b.eval(gameWait(0.04, 8000))
      }
      await b.touch('touchEnd', [])
    } else {
      // Keyboard loop: hold left for most of a turn.
      await b.eval(`window.blue.input.keys.add('ArrowLeft')`)
      await b.eval(gameWait(1.9, 60000))
      await b.eval(`window.blue.input.keys.delete('ArrowLeft')`)
    }
    await b.eval(gameWait(0.12, 20000))
    await b.shot(join(out, `${name}-4-loop.png`))
    await b.eval(gameWait(0.5, 30000))
    await b.shot(join(out, `${name}-5-after.png`))
    const after = await b.eval('({ mode: window.blue.mode, score: window.blue.score, paint: window.blue.world.coverage(), caught: window.blue.summaryStats.captured, hearts: window.blue.hearts })')
    log('after loop', JSON.stringify(after))
    log('errors', JSON.stringify(b.errors.slice(0, 8)))
  } finally {
    await b.close()
  }
}

for (const [name, size] of Object.entries(SIZES)) {
  if (which !== 'all' && which !== name) continue
  await run(name, size)
}
