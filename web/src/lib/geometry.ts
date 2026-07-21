// Table geometry per CONTRACT.md. All coordinates in table space (mm),
// origin top-left of the playing surface, +x along the long rail.

import type { Config } from './types'

export interface TableDims {
  L: number
  W: number
}

export const TABLE_PRESETS: Record<string, TableDims> = {
  '7ft': { L: 1981.2, W: 990.6 },
  '8ft': { L: 2235.2, W: 1117.6 },
  '9ft': { L: 2540, W: 1270 },
}

export const DEFAULT_TABLE: TableDims = TABLE_PRESETS['8ft']

export const BALL_D = 57.15
export const BALL_R = 28.575

export type PocketId = 'tl' | 'ts' | 'tr' | 'bl' | 'bs' | 'br'
export const POCKET_IDS: PocketId[] = ['tl', 'ts', 'tr', 'bl', 'bs', 'br']

export const CORNER_CAPTURE_R = 85
export const SIDE_CAPTURE_R = 75

export interface Pocket {
  id: PocketId
  x: number
  y: number
  r: number
  corner: boolean
}

export function pocketCenter(id: string, L: number, W: number): [number, number] {
  switch (id) {
    case 'tl': return [0, 0]
    case 'ts': return [L / 2, 0]
    case 'tr': return [L, 0]
    case 'bl': return [0, W]
    case 'bs': return [L / 2, W]
    case 'br': return [L, W]
    default: return [0, 0]
  }
}

export function pockets(L: number, W: number): Pocket[] {
  return POCKET_IDS.map((id) => {
    const [x, y] = pocketCenter(id, L, W)
    const corner = id !== 'ts' && id !== 'bs'
    return { id, x, y, r: corner ? CORNER_CAPTURE_R : SIDE_CAPTURE_R, corner }
  })
}

/** Resolve table dims from config, falling back to the 8ft default. */
export function tableDims(config?: Config | null): TableDims {
  if (config) {
    if (typeof config.tableL === 'number' && typeof config.tableW === 'number' && config.tableL > 0 && config.tableW > 0) {
      return { L: config.tableL, W: config.tableW }
    }
    if (config.tableSize && TABLE_PRESETS[config.tableSize]) return TABLE_PRESETS[config.tableSize]
  }
  return DEFAULT_TABLE
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay)
}
