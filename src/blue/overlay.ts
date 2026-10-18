// Things drawn over the canvas that move every frame: score callouts, world cards, boon labels, the
// arrow to the launch star. Plain DOM, outside React, so a busy frame never re-renders the HUD.

export interface Callout {
  text: string
  sub?: string
  x: number
  y: number
  color: string
  size: number
}

export class Overlay {
  private pool: HTMLDivElement[] = []
  private labels: HTMLDivElement[] = []
  readonly arrow: HTMLDivElement
  private card: HTMLDivElement
  private cardTimer: ReturnType<typeof setTimeout> | null = null

  constructor(readonly root: HTMLElement) {
    for (let i = 0; i < 14; i++) {
      const d = document.createElement('div')
      d.className = 'callout'
      root.appendChild(d)
      this.pool.push(d)
    }
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div')
      d.className = 'boon-label'
      root.appendChild(d)
      this.labels.push(d)
    }
    this.arrow = document.createElement('div')
    this.arrow.className = 'star-arrow'
    root.appendChild(this.arrow)
    this.card = document.createElement('div')
    this.card.className = 'world-card'
    root.appendChild(this.card)
  }

  callout(c: Callout) {
    const d = this.pool.shift()!
    this.pool.push(d)
    d.innerHTML = ''
    const main = document.createElement('span')
    main.textContent = c.text
    d.appendChild(main)
    if (c.sub) {
      const s = document.createElement('small')
      s.textContent = c.sub
      d.appendChild(s)
    }
    d.style.left = `${c.x}px`
    d.style.top = `${c.y}px`
    d.style.color = c.color
    d.style.fontSize = `${c.size}px`
    d.classList.remove('go')
    void d.offsetWidth
    d.classList.add('go')
  }

  /** A big title across the middle (world names, "SUPERNOVA"). */
  showCard(title: string, sub: string, color = '#ffffff', ms = 2200) {
    const c = this.card
    c.innerHTML = ''
    const h = document.createElement('div')
    h.className = 'world-card__title'
    h.textContent = title
    h.style.color = color
    const s = document.createElement('div')
    s.className = 'world-card__sub'
    s.textContent = sub
    c.append(h, s)
    c.classList.remove('go')
    void c.offsetWidth
    c.classList.add('go')
    if (this.cardTimer) clearTimeout(this.cardTimer)
    this.cardTimer = setTimeout(() => c.classList.remove('go'), ms)
  }

  label(i: number, visible: boolean, x = 0, y = 0, name = '', text = '', color = '#fff', near = false) {
    const d = this.labels[i]
    if (!visible) {
      d.style.opacity = '0'
      return
    }
    if (d.dataset.name !== name) {
      d.dataset.name = name
      d.innerHTML = ''
      const n = document.createElement('b')
      n.textContent = name
      const t = document.createElement('span')
      t.textContent = text
      d.append(n, t)
    }
    d.style.opacity = '1'
    d.style.transform = `translate(${x}px, ${y}px) translate(-50%, -130%) scale(${near ? 1.12 : 1})`
    d.style.setProperty('--c', color)
  }

  pointArrow(visible: boolean, x = 0, y = 0, angle = 0) {
    const a = this.arrow
    a.style.opacity = visible ? '1' : '0'
    if (visible) a.style.transform = `translate(${x}px, ${y}px) rotate(${angle}rad)`
  }

  dispose() {
    if (this.cardTimer) clearTimeout(this.cardTimer)
    for (const d of [...this.pool, ...this.labels, this.arrow, this.card]) d.remove()
  }

  clear() {
    for (const d of this.pool) d.classList.remove('go')
    for (let i = 0; i < this.labels.length; i++) this.label(i, false)
    this.pointArrow(false)
    this.card.classList.remove('go')
  }
}
