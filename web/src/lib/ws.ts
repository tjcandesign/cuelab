// Reconnecting WebSocket client for /ws.
// Exponential backoff, resubscribes (re-sends hello) on reconnect.

import { useStore } from '../store'
import type { EventMsg, GameSnapshot, SceneItem, StateMsg, WsRole } from './types'

let socket: WebSocket | null = null
let started = false
let role: WsRole = 'control'
let attempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function dispatch(msg: unknown): void {
  if (!msg || typeof msg !== 'object') return
  const m = msg as Record<string, unknown>
  const store = useStore.getState()
  switch (m.type) {
    case 'state': {
      const s = m as unknown as StateMsg
      store.setLiveState(Array.isArray(s.balls) ? s.balls : [], !!s.moving, typeof s.ts === 'number' ? s.ts : Date.now())
      break
    }
    case 'event': {
      const e = m as unknown as EventMsg
      store.setLastEvent(e)
      break
    }
    case 'game': {
      store.setGame((m.game ?? null) as GameSnapshot | null)
      break
    }
    case 'scene': {
      store.setScene(Array.isArray(m.items) ? (m.items as SceneItem[]) : [])
      break
    }
    default:
      break
  }
}

function sendHello(): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify({ type: 'hello', role }))
    } catch {
      // ignore
    }
  }
}

function connect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  useStore.getState().setWsStatus('connecting')
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  let ws: WebSocket
  try {
    ws = new WebSocket(`${proto}://${window.location.host}/ws`)
  } catch {
    scheduleReconnect()
    return
  }
  socket = ws
  ws.onopen = () => {
    attempts = 0
    useStore.getState().setWsStatus('open')
    sendHello()
  }
  ws.onmessage = (ev) => {
    try {
      dispatch(JSON.parse(String(ev.data)))
    } catch {
      // malformed frame — ignore
    }
  }
  ws.onerror = () => {
    try {
      ws.close()
    } catch {
      // ignore
    }
  }
  ws.onclose = () => {
    if (socket === ws) socket = null
    useStore.getState().setWsStatus('closed')
    scheduleReconnect()
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  const delay = Math.min(10000, 500 * 2 ** Math.min(attempts, 6))
  attempts += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

/** Start (or reuse) the singleton socket with the given role. */
export function ensureWs(r: WsRole): void {
  const roleChanged = r !== role
  role = r
  if (!started) {
    started = true
    connect()
  } else if (roleChanged) {
    sendHello()
  }
}
