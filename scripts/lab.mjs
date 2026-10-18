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
      // Touch drag: hold a finger right of the comet, a negative id, and check the comet turned toward it.
      const pos = await b.eval(`(() => { const g = window.blue; const v = g.comet.pos.clone().project(g.rig.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight } })()`)
      const fx = Math.min(size.width - 10, pos.x + 140)
      const fy = pos.y
      const headingBefore = await b.eval(`(() => { const g = window.blue; const e = g.rig.camera.matrixWorld.elements; return g.comet.facing.x * e[0] + g.comet.facing.y * e[1] + g.comet.facing.z * e[2] })()`)
      await b.touch('touchStart', [{ x: fx, y: fy, id: -7 }])
      await b.eval(gameWait(0.8, 40000))
      await b.touch('touchMove', [{ x: fx, y: fy + 4, id: -7 }])
      await b.eval(gameWait(0.4, 20000))
      const headingAfter = await b.eval(`(() => { const g = window.blue; const e = g.rig.camera.matrixWorld.elements; return g.comet.facing.x * e[0] + g.comet.facing.y * e[1] + g.comet.facing.z * e[2] })()`)
      await b.touch('touchEnd', [])
      log(`touch drag: screen-right component of heading ${headingBefore.toFixed(2)} -> ${headingAfter.toFixed(2)} (${headingAfter > 0.8 ? 'PASS' : 'FAIL'})`)
      // Draw a loop with the finger: circle around the comet.
      await b.touch('touchStart', [{ x: pos.x, y: pos.y - 120, id: -3 }])
      for (let i = 0; i <= 24; i++) {
        const a = -Math.PI / 2 + (i / 24) * Math.PI * 2.4
        await b.touch('touchMove', [{ x: pos.x + Math.cos(a) * 120, y: pos.y + Math.sin(a) * 120, id: -3 }])
        await b.eval(gameWait(0.09, 8000))
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
