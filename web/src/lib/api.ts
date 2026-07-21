// Typed REST client for the CueLab server (all routes under /api).
// Every call can reject (server may be offline) — callers handle failures.

import type {
  Calibration,
  Config,
  Drill,
  GameSnapshot,
  Player,
  PlayerStats,
  VerifyResult,
} from './types'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = await res.text()
    } catch {
      // ignore
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

const get = <T,>(path: string) => req<T>(path)
const post = <T,>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const put = <T,>(path: string, body?: unknown) =>
  req<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) })
const patch = <T,>(path: string, body?: unknown) =>
  req<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) })
const del = <T,>(path: string) => req<T>(path, { method: 'DELETE' })

export const api = {
  health: () => get<{ ok: boolean; mode?: string; version?: string }>('/health'),

  getConfig: () => get<Config>('/config'),
  putConfig: (patchBody: Record<string, unknown>) => put<Config>('/config', patchBody),

  getCalibration: () => get<Calibration>('/calibration'),
  calibrateCamera: (points: number[][]) => post<{ H?: number[][] }>('/calibration/camera', { points }),
  calibrateProjector: (corners: number[][]) => post<unknown>('/calibration/projector', { corners }),
  verifyCalibration: () => post<VerifyResult>('/calibration/verify'),

  listPlayers: () => get<Player[]>('/players'),
  createPlayer: (body: { name: string; initials?: string; color?: string }) => post<Player>('/players', body),
  getPlayer: (id: number | string) => get<Player>(`/players/${id}`),
  updatePlayer: (id: number | string, body: Partial<Player>) => patch<Player>(`/players/${id}`, body),
  deletePlayer: (id: number | string) => del<unknown>(`/players/${id}`),
  playerStats: (id: number | string) => get<PlayerStats>(`/players/${id}/stats`),

  listDrills: () => get<Drill[]>('/drills'),
  createDrill: (drill: Drill) => post<Drill>('/drills', drill),
  getDrill: (id: number | string) => get<Drill>(`/drills/${id}`),
  updateDrill: (id: number | string, drill: Drill) => put<Drill>(`/drills/${id}`, drill),
  deleteDrill: (id: number | string) => del<unknown>(`/drills/${id}`),
  importDrill: (raw: unknown) => post<Drill>('/drills/import', raw),

  createSession: (body: { mode: string; playerIds: number[]; rounds?: number; drillId?: number }) =>
    post<GameSnapshot>('/sessions', body),
  getSession: (id: number | string) => get<GameSnapshot>(`/sessions/${id}`),
  sessionAction: (id: number | string, action: string, params?: Record<string, unknown>) =>
    post<GameSnapshot>(`/sessions/${id}/action`, { action, ...(params ?? {}) }),

  simReset: (balls?: { id: string; x: number; y: number }[]) =>
    post<unknown>('/sim/reset', balls ? { balls } : {}),
  simPlace: (id: string, x: number, y: number) => post<unknown>('/sim/place', { id, x, y }),
  simShoot: (ballId: string, angle: number, speed: number) =>
    post<unknown>('/sim/shoot', { ballId, angle, speed }),
  simAdd: (id: string) => post<unknown>('/sim/add', { id }),
  simRemove: (id: string) => post<unknown>('/sim/remove', { id }),

  recordingStart: () => post<unknown>('/recording/start'),
  recordingStop: () => post<{ file?: string }>('/recording/stop'),
  listRecordings: () => get<unknown[]>('/recordings'),

  voiceChat: (text: string) => post<{ reply?: string }>('/voice/chat', { text }),

  statsOverview: () => get<Record<string, unknown>>('/stats/overview'),
}
