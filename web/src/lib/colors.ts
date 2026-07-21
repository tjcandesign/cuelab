// UI tokens + ball colors. Tokens match CONTRACT.md exactly.

export const UI = {
  bg: '#0b0b10',
  panel: '#15151c',
  border: '#26262f',
  text: '#e8e8ef',
  dim: '#8b8b98',
  accent: '#8b5cf6',
  success: '#34d399',
  danger: '#f87171',
  cloth: '#2273c9',
} as const

const BASE_BALL: Record<number, string> = {
  1: '#f2c114', // yellow
  2: '#2b5eda', // blue
  3: '#e04343', // red
  4: '#8a4fd8', // purple
  5: '#ef8332', // orange
  6: '#2f9e57', // green
  7: '#a03a3a', // maroon
  8: '#17171d', // black
}

export const CUE_COLOR = '#f2efe2'

/** Base color for a ball number (stripes share the color of number-8 siblings). */
export function ballColor(num: number, kind?: string): string {
  if (kind === 'cue' || num === 0) return CUE_COLOR
  if (kind === 'eight' || num === 8) return BASE_BALL[8]
  const base = BASE_BALL[((num - 1) % 8) + 1]
  return base ?? '#8b8b98'
}

export function isStripe(num: number, kind?: string): boolean {
  if (kind === 'stripe') return true
  if (kind && kind !== 'unknown') return false
  return num >= 9 && num <= 15
}

/** Resolve a scene-primitive color token ("accent"|"white"|"dim"|"success"|"danger") or #hex. */
export function sceneColor(c?: string | null): string {
  switch (c) {
    case 'accent': return UI.accent
    case 'white': return '#ffffff'
    case 'dim': return UI.dim
    case 'success': return UI.success
    case 'danger': return UI.danger
    case undefined:
    case null:
    case '': return UI.accent
    default: return c
  }
}

export const PLAYER_COLORS = [
  '#8b5cf6', '#34d399', '#60a5fa', '#f472b6',
  '#fbbf24', '#f87171', '#2dd4bf', '#a3e635',
]

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
