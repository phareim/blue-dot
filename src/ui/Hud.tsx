import type { Game } from '../blue/game'
import type { HudState } from '../blue/store'
import './hud.css'

interface Props {
  hud: HudState
  game: Game | null
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

function Hearts({ n, max }: { n: number; max: number }) {
  return (
    <div className="hearts" aria-label={`${n} of ${max} hearts`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < n ? 'heart heart--on' : 'heart'} />
      ))}
    </div>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  )
}

const PauseIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg>
)
const SoundIcon = ({ muted }: { muted: boolean }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
    {muted ? <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /> : <path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />}
  </svg>
)

function Controls({ touch }: { touch: boolean }) {
  return touch ? (
    <ul className="controls">
      <li><b>Hold and drag</b> to steer toward your finger</li>
      <li><b>Tap</b> or a second finger to jump</li>
      <li><b>Cross your own trail</b> to close a loop</li>
    </ul>
  ) : (
    <ul className="controls">
      <li><b>Mouse</b> steers toward the cursor, or <b>A / D</b></li>
      <li><b>Click</b> or <b>Space</b> to jump</li>
      <li><b>Cross your own trail</b> to close a loop</li>
    </ul>
  )
}

function Title({ hud, game }: Props) {
  return (
    <div className="screen screen--title" onClick={() => game?.start()}>
      <h1 className="wordmark">BLUE</h1>
      <p className="tagline">Loop the swarm. Paint the worlds. Light the sun.</p>
      <button type="button" className="play-btn" onClick={(e) => { e.stopPropagation(); game?.start() }}>Play</button>
      <Controls touch={hud.touch} />
      {hud.best > 0 && <p className="best">Best {fmt(hud.best)}</p>}
    </div>
  )
}

function Over({ hud, game }: Props) {
  const s = hud.summary
  if (!s) return null
  const mins = Math.floor(s.time / 60)
  const secs = Math.floor(s.time % 60).toString().padStart(2, '0')
  return (
    <div className="screen screen--over">
      <p className="over-kicker">The light went out</p>
      <p className="over-score">{fmt(s.score)}</p>
      {s.newBest ? <p className="over-best over-best--new">New best</p> : <p className="over-best">Best {fmt(s.best)}</p>}
      <dl className="over-stats">
        <div><dt>Worlds lit</dt><dd>{s.worlds}</dd></div>
        <div><dt>Suns gone nova</dt><dd>{s.systems}</dd></div>
        <div><dt>Biggest loop</dt><dd>{s.biggestLoop}</dd></div>
        <div><dt>Caught</dt><dd>{s.captured}</dd></div>
        <div><dt>Time</dt><dd>{mins}:{secs}</dd></div>
      </dl>
      <button type="button" className="play-btn" onClick={() => game?.start()}>Again</button>
      <button type="button" className="text-btn" onClick={() => game?.toTitle()}>Title</button>
    </div>
  )
}

function Paused({ hud, game }: Props) {
  return (
    <div className="screen screen--paused">
      <p className="over-kicker">Paused</p>
      {hud.boons.length > 0 && (
        <ul className="boon-list">
          {hud.boons.map((b) => (
            <li key={b.id} style={{ color: b.color }}>{b.name}{b.count > 1 ? ` ×${b.count}` : ''}</li>
          ))}
        </ul>
      )}
      <button type="button" className="play-btn" onClick={() => game?.togglePause(false)}>Resume</button>
      <button type="button" className="text-btn" onClick={() => game?.toTitle()}>Quit to title</button>
    </div>
  )
}

export function Hud({ hud, game }: Props) {
  const muteBtn = (
    <IconButton label={hud.muted ? 'Sound on (M)' : 'Mute (M)'} onClick={() => game?.setMuted(!hud.muted)}>
      <SoundIcon muted={hud.muted} />
    </IconButton>
  )
  if (hud.screen === 'title') {
    return (
      <>
        <div className="corner">{muteBtn}</div>
        <Title hud={hud} game={game} />
      </>
    )
  }
  if (hud.screen === 'over') {
    return (
      <>
        <div className="corner">{muteBtn}</div>
        <Over hud={hud} game={game} />
      </>
    )
  }
  const paintPct = Math.min(1, hud.paint / Math.max(0.01, hud.target * 1.5))
  const targetPct = 1 / 1.5
  const reached = hud.paint >= hud.target
  return (
    <>
      <div className="hud-top">
        <div className="score-block">
          <div className="score">{fmt(hud.score)}</div>
          <div className="score-sub">
            {hud.chain > 1 && <span className="chain">Chain ×{hud.chain}</span>}
            {hud.mult > 1 && <span className="mult">Score ×{hud.mult}</span>}
          </div>
        </div>
        <div className="top-right">
          <Hearts n={hud.hearts} max={hud.maxHearts} />
          <div className="buttons">
            {muteBtn}
            <IconButton label="Pause (Esc)" onClick={() => game?.togglePause()}><PauseIcon /></IconButton>
          </div>
        </div>
      </div>
      <div className={hud.flying ? 'hud-bottom hud-bottom--away' : 'hud-bottom'}>
        <div className={hud.blaze ? 'flux flux--blaze' : 'flux'} aria-label="Flux">
          <div className="flux__fill" style={{ transform: `scaleX(${hud.flux})` }} />
          <span className="flux__label">{hud.blaze ? 'BLAZE' : 'FLUX'}</span>
        </div>
        <div className="paint">
          <div className="paint__row">
            <span className="paint__world">{hud.worldName}</span>
            <span className={reached ? 'paint__pct paint__pct--done' : 'paint__pct'}>
              {reached ? (hud.launchReady ? 'Reach the star' : 'Lit') : `${Math.floor(hud.paint * 100)}% of ${Math.round(hud.target * 100)}%`}
            </span>
          </div>
          <div className="paint__bar">
            <div className="paint__fill" style={{ transform: `scaleX(${paintPct})` }} />
            <div className="paint__target" style={{ left: `${targetPct * 100}%` }} />
          </div>
          <div className="worlds" aria-label={`World ${hud.worldIndex + 1} of ${hud.worldCount}, system ${hud.system}`}>
            {Array.from({ length: hud.worldCount }, (_, i) => (
              <span key={i} className={i < hud.worldIndex ? 'world world--lit' : i === hud.worldIndex ? 'world world--here' : 'world'} />
            ))}
            <span className="sun-dot" />
            {hud.system > 1 && <span className="system">System {hud.system}</span>}
          </div>
        </div>
      </div>
      {hud.screen === 'paused' && <Paused hud={hud} game={game} />}
    </>
  )
}
