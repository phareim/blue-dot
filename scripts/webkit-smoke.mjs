// WebKit smoke test (the Safari engine), through Playwright: load, start, play a few seconds, report.
//   PLAYWRIGHT_CORE=<path to playwright-core> node scripts/webkit-smoke.mjs [url] [shot.png]
// On the Mac, nova's checkout carries playwright-core; its WebKit is in ~/Library/Caches/ms-playwright.
import { join } from 'node:path'
import { homedir } from 'node:os'

const core = process.env.PLAYWRIGHT_CORE || join(homedir(), 'sleeper-mirror/github/nova/node_modules/playwright-core/index.mjs')
const { webkit } = await import(core)
const url = process.argv[2] || 'http://127.0.0.1:4181/'
const shot = process.argv[3] || join(homedir(), 'blue-lab/webkit.png')

const browser = await webkit.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(url)
  await page.waitForTimeout(1500)
  const gl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))
  await page.evaluate(() => window.blue.start())
  await page.waitForTimeout(6000)
  const state = await page.evaluate(() => new Promise((res) => {
    let n = 0
    const t0 = performance.now()
    const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res({ mode: window.blue.mode, time: +window.blue.time.toFixed(1), fps: Math.round(n / 2), dpr: window.blue.dpr, audio: window.blue.sound.ctx ? window.blue.sound.ctx.state : 'none' }) }
    requestAnimationFrame(f)
  }))
  await page.screenshot({ path: shot })
  const sizes = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    const g = window.blue
    const buf = g.renderer.getDrawingBufferSize(new (g.rig.camera.position.constructor)())
    return { canvas: [c.width, c.height], client: [c.clientWidth, c.clientHeight], inner: [innerWidth, innerHeight], aspect: +g.rig.camera.aspect.toFixed(3), buffer: [buf.x, buf.y] }
  })
  console.log(JSON.stringify({ webgl2: gl, ...state, sizes, errors: errors.slice(0, 5) }))
} finally {
  await browser.close()
}
