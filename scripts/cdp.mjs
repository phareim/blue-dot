// Minimal Chrome DevTools Protocol driver for headless screenshots and
// play-throughs (no puppeteer on Sleeper; copied from phareim.no's zelda-lab). Node 22's global WebSocket talks to
// a headless chromium-browser started with a debugging port.
//
//   const b = await launch({ width: 1440, height: 900, mobile: false })
//   await b.goto('http://localhost:3001/')
//   await b.key('Enter'); await b.hold('ArrowUp', 400)
//   await b.shot('/home/petter/zshots/x.png'); b.errors; await b.close()
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const sleep = ms => new Promise(r => setTimeout(r, ms))

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  KeyK: { key: 'k', code: 'KeyK', keyCode: 75 },
  KeyH: { key: 'h', code: 'KeyH', keyCode: 72 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  KeyW: { key: 'w', code: 'KeyW', keyCode: 87 },
  KeyA: { key: 'a', code: 'KeyA', keyCode: 65 },
  KeyS: { key: 's', code: 'KeyS', keyCode: 83 },
  KeyD: { key: 'd', code: 'KeyD', keyCode: 68 },
  KeyE: { key: 'e', code: 'KeyE', keyCode: 69 },
  KeyF: { key: 'f', code: 'KeyF', keyCode: 70 },
  KeyJ: { key: 'j', code: 'KeyJ', keyCode: 74 },
  KeyQ: { key: 'q', code: 'KeyQ', keyCode: 81 },
  KeyP: { key: 'p', code: 'KeyP', keyCode: 80 },
  KeyN: { key: 'n', code: 'KeyN', keyCode: 78 },
  KeyR: { key: 'r', code: 'KeyR', keyCode: 82 },
  KeyY: { key: 'y', code: 'KeyY', keyCode: 89 },
  KeyT: { key: 't', code: 'KeyT', keyCode: 84 },
  KeyM: { key: 'm', code: 'KeyM', keyCode: 77 },
  ShiftLeft: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
  AltLeft: { key: 'Alt', code: 'AltLeft', keyCode: 18 },
  KeyZ: { key: 'z', code: 'KeyZ', keyCode: 90 },
}

// The browser: $CHROME_BIN, else Chrome for Testing
// (~/.local/share/chrome-for-testing/chrome-current), else snap's
// chromium-browser. Snap Chromium moves itself into its own systemd scope and
// so escapes `heavy`'s memory cap (one took 3.6 GB, 2026-09-27); plain Chrome
// only does that through the session bus, so it runs without one and stays
// inside the cap. Snap Chromium refuses to start without the bus, so it keeps it.
const CFT = join(homedir(), '.local/share/chrome-for-testing/chrome-current')
const BROWSER = process.env.CHROME_BIN || (existsSync(CFT) ? CFT : 'chromium-browser')
const BROWSER_ENV = BROWSER === 'chromium-browser' ? process.env : { ...process.env, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/dev/null' }

export async function launch({ width = 1440, height = 900, dpr = 1, mobile = false, flags = [] } = {}) {
  // A port nobody listens on. (2026-10-12: two jobs on one Mac drew the same number; the second Chrome could not
  // bind it, and its script drove the FIRST job's browser: a run of Palmehuset ended in another game's page.)
  let port = 0
  for (let i = 0; i < 40 && !port; i++) {
    const p = 9300 + Math.floor(Math.random() * 6000)
    const free = await new Promise(r => { const srv = createServer(); srv.once('error', () => r(false)); srv.listen(p, '127.0.0.1', () => srv.close(() => r(true))) })
    if (free) port = p
  }
  if (!port) throw new Error('no free port for the browser')
  // The browser's throwaway profile: under ~/zshots, or under CDP_PROFILES when that names a folder.
  const profiles = process.env.CDP_PROFILES || join(homedir(), 'zshots')
  mkdirSync(profiles, { recursive: true })
  const profile = mkdtempSync(join(profiles, 'prof-'))
  // CDP_GPU=1 (a Mac with a GPU): let the browser use it instead of SwiftShader.
  const proc = spawn(BROWSER, [
    '--headless=new', '--no-sandbox', ...(process.env.CDP_GPU ? [] : ['--disable-gpu']), '--hide-scrollbars', '--mute-audio',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, ...flags, 'about:blank',
  ], { stdio: 'ignore', env: BROWSER_ENV })
  // Each run's profile is ~70-180 MB; left behind, they filled the disk
  // (2026-09-27). Remove it on close, and on Ctrl-C / kill of this script.
  // Snap's chromium-browser is a wrapper: killing it can leave the real browser running on the
  // profile, and it writes the folder back after it is removed. Kill every process on this
  // profile first (found by its command line), then remove the folder.
  const killBrowser = () => {
    // No /proc (macOS): the browser is not wrapped, killing proc is enough.
    if (!existsSync('/proc')) return
    for (const pid of readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue
      try { if (readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(`--user-data-dir=${profile}`)) process.kill(Number(pid), 'SIGKILL') } catch { /* gone */ }
    }
  }
  const dropProfile = () => { killBrowser(); try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ } }
  const onSignal = () => { proc.kill('SIGKILL'); setTimeout(() => { dropProfile(); process.exit(130) }, 500) }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  let targets
  for (let i = 0; i < 160; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* not yet */ }
    await sleep(250)
  }
  const page = targets?.find(t => t.type === 'page')
  if (!page) {
    // A browser that never answered must not be left running.
    proc.kill('SIGKILL')
    setTimeout(dropProfile, 500)
    throw new Error('chromium did not start within 40 s (server busy?)')
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(r => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map()
  const errors = []
  const logs = []
  /** CDP event listeners by method (b.on), e.g. Fetch.requestPaused to fake a server. */
  const listeners = new Map()
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    if (msg.method) for (const fn of listeners.get(msg.method) ?? []) fn(msg.params)
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value ?? a.description).join(' ')
      if (msg.params.type === 'error') errors.push(text)
      logs.push(text)
    }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, m => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile })
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })

  const b = {
    errors,
    logs,
    send,
    on(method, fn) { listeners.set(method, [...(listeners.get(method) ?? []), fn]) },
    async goto(url) { await send('Page.navigate', { url }); await sleep(2500) },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.value },
    async keyDown(name) { const k = KEYS[name]; await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode }) },
    async keyUp(name) { const k = KEYS[name]; await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode }) },
    async key(name, ms = 60) { await b.keyDown(name); await sleep(ms); await b.keyUp(name); await sleep(40) },
    async hold(name, ms) { await b.keyDown(name); await sleep(ms); await b.keyUp(name) },
    async touch(type, points) { await send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) }) },
    async tap(x, y) { await b.touch('touchStart', [{ x, y }]); await sleep(60); await b.touch('touchEnd', []); await sleep(60) },
    async shot(path) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path, Buffer.from(r.data, 'base64')) },
    sleep,
    // Snap's chromium-browser is a wrapper: killing it orphans the real
    // browser, so ask the browser itself to quit first.
    async close() {
      try { await Promise.race([send('Browser.close'), sleep(1500)]) } catch { /* ignore */ }
      try { ws.close() } catch { /* ignore */ }
      proc.kill('SIGKILL')
      await sleep(500)
      dropProfile()
    },
  }
  return b
}
