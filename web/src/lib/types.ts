// Contract types — see CONTRACT.md. Everything renders defensively against
// missing/null fields, so most non-key fields are optional.

export type BallKind = 'cue' | 'solid' | 'stripe' | 'eight' | 'unknown'

export interface Ball {
  id: string
  number: number
  kind: BallKind
  x: number
  y: number
  vx?: number
  vy?: number
  settled?: boolean
  color?: string
}

export interface StateMsg {
  type: 'state'
  ts: number
  moving: boolean
  balls: Ball[]
}

export interface EventMsg {
  type: 'event'
  event: string
  data?: Record<string, unknown>
}

export interface GamePlayer {
  id: number
  name: string
  initials?: string
  color?: string
  score?: number
  shots?: number
}

export interface TargetSpec {
  c: [number, number]
  radii: number[]
  scores?: number[]
}

export interface LastResult {
  playerId?: number
  points?: number
  pocketed?: boolean
  ring?: number | null
  scratch?: boolean
}

export interface GameSnapshot {
  sessionId: number
  mode: 'target_pool' | 'nine_ball' | 'drill' | 'free' | string
  phase: string
  round?: number
  totalRounds?: number
  players?: GamePlayer[]
  currentPlayerId?: number | null
  setterId?: number | null
  message?: string | null
  countdown?: number | null
  calledPocket?: string | null
  target?: TargetSpec | null
  layout?: { ballId: string; x: number; y: number }[] | null
  lastResult?: LastResult | null
  extra?: Record<string, unknown>
}

export type SceneItem =
  | { kind: 'ring'; c: [number, number]; radii: number[]; labels?: string[]; color?: string }
  | { kind: 'ghost'; c: [number, number]; r?: number; color?: string; label?: string }
  | { kind: 'line'; a: [number, number]; b: [number, number]; width?: number; dash?: boolean; color?: string }
  | { kind: 'text'; c: [number, number]; text: string; size?: number; rot?: number; color?: string }
  | { kind: 'pocket'; pocket: string; color?: string }
  | { kind: 'countdown'; c: [number, number]; value: number }
  | { kind: 'poly'; points: [number, number][]; color?: string; fill?: boolean }

export interface CameraConfig {
  source?: number | string
  width?: number
  height?: number
}

export interface ProjectorConfig {
  width?: number
  height?: number
}

export interface Config {
  mode: 'sim' | 'camera'
  tableSize?: string
  tableL?: number
  tableW?: number
  camera?: CameraConfig
  projector?: ProjectorConfig
}

export interface Calibration {
  camera?: { points?: number[][] | null; H?: number[][] | null } | null
  projector?: { corners?: number[][] | null } | null
}

export interface VerifyResult {
  ok?: boolean
  errorsMm?: number[] | null
  note?: string | null
}

export interface Player {
  id: number
  name: string
  initials?: string
  color?: string
  created_at?: string
  createdAt?: string
  last_active?: string
  lastActive?: string
}

export interface RecentSession {
  id?: number
  sessionId?: number
  mode?: string
  started_at?: string
  startedAt?: string
  ended_at?: string | null
  endedAt?: string | null
  score?: number
  shots?: number
  rounds?: number
  [k: string]: unknown
}

export interface PlayerStats {
  attempts?: number
  successRate?: number
  shotAccuracy?: number
  bestStreak?: number
  shotsFired?: number
  ballsPocketed?: number
  ballsMissed?: number
  scratches?: number
  recentSessions?: RecentSession[]
}

export interface DrillBall {
  id: string
  kind?: BallKind
  number?: number
  x: number
  y: number
}

export interface SuccessCriteria {
  mustPocket?: string[]
  cueInTarget?: boolean
  maxShots?: number
}

export interface Drill {
  id?: number
  name: string
  type: string
  description?: string
  table?: string
  balls: DrillBall[]
  targets?: TargetSpec[]
  calledPocket?: string | null
  successCriteria?: SuccessCriteria
  tags?: string[]
  published?: boolean
}

export type WsStatus = 'connecting' | 'open' | 'closed'
export type WsRole = 'control' | 'projector' | 'viewer'
