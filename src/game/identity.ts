export interface Identity {
  nickname: string
  color: string // hex '#rrggbb'
}

const KEY = 'blue-dot-identity-v1'

const PALETTE = [
  '#38bdf8', '#f472b6', '#fb923c', '#a78bfa',
  '#34d399', '#facc15', '#f87171', '#60a5fa',
  '#c084fc', '#4ade80', '#fbbf24', '#fb7185',
]

function randomNickname(): string {
  const n = Math.floor(1000 + Math.random() * 9000)
  return `blue-dot-${n}`
}

function randomColor(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)]
}

export function loadIdentity(): Identity {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>
      if (typeof parsed.nickname === 'string' && typeof parsed.color === 'string') {
        return { nickname: parsed.nickname, color: parsed.color }
      }
    }
  } catch {
    // fall through to fresh identity
  }
  const fresh: Identity = { nickname: randomNickname(), color: randomColor() }
  saveIdentity(fresh)
  return fresh
}

export function saveIdentity(id: Identity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(id))
  } catch {
    // localStorage unavailable; identity is ephemeral this session
  }
}

export function sanitizeNickname(input: string): string {
  const trimmed = input.trim().slice(0, 24)
  return trimmed.length > 0 ? trimmed : randomNickname()
}
