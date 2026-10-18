// Tour: play through every stage of a run in headless Chrome, with stills and frame rates.
//   node scripts/tour.mjs [url] [outdir] [desktop|phone]
// On a Mac with a GPU: CHROME_BIN=".../Google Chrome" CDP_GPU=1 node scripts/tour.mjs
// Forces progress through window.blue (paints the world, moves the comet onto the star), so it
// checks that the stages work and look right, not how hard they are. Local server only: never
// point it at a deployed site.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from './cdp.mjs'

const url = process.argv[2] || 'http://localhost:4173/'
const out = process.argv[3] || join(process.env.HOME, 'zshots/blue')
const kind = process.argv[4] || 'desktop'
mkdirSync(out, { recursive: true })
// Phone at 2×: headless Chrome on the Mac hangs on screenshots at 3× (2026-10-18). The game caps its own ratio at 1.6 on touch screens anyway.
const size = kind === 'phone' ? { width: 390, height: 844, dpr: 2, mobile: true } : { width: 1440, height: 900, dpr: 1, mobile: false }

const b = await launch(size)
const log = (...a) => console.log(`[${kind}]`, ...a)
const gameWait = (secs, maxMs = 60000) => b.eval(`new Promise((res) => {
  const t0 = window.blue.time, w0 = performance.now()
  const tick = () => (window.blue.time - t0 >= ${secs} || performance.now() - w0 > ${maxMs}) ? res(window.blue.time - t0) : setTimeout(tick, 30)
  tick()
})`)
const until = (cond, maxMs = 60000) => b.eval(`new Promise((res) => {
  const w0 = performance.now()
  const tick = () => { let ok = false; try { ok = !!(${cond}) } catch (e) {} ; (ok || performance.now() - w0 > ${maxMs}) ? res(ok) : setTimeout(tick, 30) }
  tick()
})`)
const fps = (ms = 3000) => b.eval(`new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ${ms}) requestAnimationFrame(f); else r(Math.round(n * 1000 / (performance.now() - t0))) }; requestAnimationFrame(f) })`)
const state = () => b.eval(`(() => { const g = window.blue; return { mode: g.mode, world: g.worldIdx, system: g.system.index, score: g.score, hearts: g.hearts, paint: +g.world.coverage().toFixed(3), enemies: g.swarm.list.length, particles: g.particles.alive, dpr: g.dpr, boons: [...g.boonCounts.keys()] } })()`)
let n = 0
const shot = async (label) => { await b.shot(join(out, `tour-${kind}-${String(++n).padStart(2, '0')}-${label}.png`)) }

// A bot that draws loops: turn hard, then straight, then the other way.
const autopilot = `(() => {
  const g = window.blue
  clearInterval(window.__bot)
  let t = 0
  window.__bot = setInterval(() => {
    t += 0.1
    const ph = t % 3.2
    g.input.keys.delete('ArrowLeft'); g.input.keys.delete('ArrowRight')
    if (ph < 1.9) g.input.keys.add('ArrowLeft')
    // The tour checks stages, not survival.
    g.invulnerable = 1e9
  }, 100)
})()`

const lightAndLaunch = async (label) => {
  // Paint the world past its target, wait for the star, then put the comet on it.
  await b.eval(`(() => { const g = window.blue; const w = g.world; let i = 0; while (w.coverage() < w.paintTarget + 0.02 && i++ < 60) { const body = w.bodies[i % w.bodies.length]; const d = body.center.clone().set(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize(); body.paintSplat(d, 0.32) } })()`)
  const armed = await until('window.blue.launchOn', 20000)
  await gameWait(0.4)
  await shot(`${label}-ignition`)
  log('ignition armed', armed)
  await b.eval(`(() => { const g = window.blue; g.comet.place(g.launchBody, g.launchN.clone(), g.comet.facing.clone()) })()`)
  const flying = await until(`window.blue.mode === 'flight'`, 20000)
  log('flying', flying)
  await until('window.blue.flight && window.blue.flight.progress > 0.38', 30000)
  await shot(`${label}-flight`)
  log('flight fps', await fps(2000))
  await until(`window.blue.mode === 'play' || window.blue.mode === 'nova'`, 60000)
}

try {
  await b.goto(url)
  await gameWait(1)
  await shot('title')
  log('title fps', await fps(2000))
  await b.eval('window.blue.start()')
  await until(`window.blue.mode === 'play'`, 60000)
  await gameWait(1.2)
  await shot('azure-landed')
  await b.eval(autopilot)
  await gameWait(6)
  await shot('azure-play')
  log('play fps', await fps(3000), JSON.stringify(await state()))
  await gameWait(6)
  await shot('azure-play2')
  log('play fps', await fps(3000), JSON.stringify(await state()))

  for (const name of ['azure', 'ember', 'rime', 'mote']) {
    await lightAndLaunch(name)
    const s = await state()
    log('arrived', JSON.stringify(s))
    if (s.mode === 'nova') break
    await gameWait(1.5)
    await shot(`${['azure', 'ember', 'rime', 'mote', 'sun'][s.world]}-landed`)
    await gameWait(5)
    await shot(`${['azure', 'ember', 'rime', 'mote', 'sun'][s.world]}-play`)
    log('play fps', await fps(2000), JSON.stringify(await state()))
  }
  await until(`window.blue.mode === 'nova'`, 30000)
  await gameWait(0.3)
  await shot('supernova-a')
  await gameWait(0.6)
  await shot('supernova-b')
  await until(`window.blue.mode === 'play' && window.blue.system.index === 1`, 60000)
  await gameWait(2)
  await shot('system2-landed')
  log('system 2', JSON.stringify(await state()))
  await gameWait(5)
  await shot('system2-play')
  log('play fps', await fps(2000), JSON.stringify(await state()))
  // Powers: drop one of each next to the comet and take it.
  for (const p of ['singularity', 'prism', 'nova', 'blaze']) {
    await b.eval(`(() => { const g = window.blue; const body = g.comet.body; g.spawnPower(body); const o = g.orbs[g.orbs.length - 1]; o.kind = '${p}'; g.takePower(o) })()`)
    await gameWait(1.2)
    await shot(`power-${p}`)
  }
  log('powers', JSON.stringify(await state()))
  await b.eval(`clearInterval(window.__bot); window.blue.invulnerable = 0; window.blue.hearts = 1; window.blue.die()`)
  await until(`window.blue.mode === 'over'`, 30000)
  await gameWait(0.8)
  await shot('game-over')
  log('errors', JSON.stringify(b.errors.slice(0, 10)))
} finally {
  await b.close()
}
