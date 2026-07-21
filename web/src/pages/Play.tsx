// /play — control screen / TV scoreboard. Live table canvas on the left,
// phase-aware game panel on the right. Actions via REST; state via WS pushes.

import { useEffect, useRef, useState } from 'react'
import LiveTable from '../components/LiveTable'
import { api } from '../lib/api'
import { initialsOf, PLAYER_COLORS } from '../lib/colors'
import type { Drill, GamePlayer, GameSnapshot, Player } from '../lib/types'
import { useStore } from '../store'

export default function Play() {
  const game = useStore((s) => s.game)
  const config = useStore((s) => s.config)

  return (
    <div className="play-layout">
      <div>
        <div className="table-wrap">
          <LiveTable interactive />
          <div className="table-meta">
            <span className="microlabel">
              {config?.mode === 'camera' ? 'camera' : 'sim'} · {config?.tableSize ?? '8ft'}
            </span>
            <span className="microlabel">
              {config?.mode !== 'camera'
                ? 'drag ball to place · shift+drag cue to shoot · dbl-click add · right-click remove'
                : 'live camera tracking'}
            </span>
          </div>
        </div>
        <VoiceControl />
      </div>
      <div>{game ? <Scoreboard game={game} /> : <SessionSetup />}</div>
    </div>
  )
}

/* ---------------- session setup ---------------- */

const MODES = [
  { id: 'target_pool', label: 'Target Pool' },
  { id: 'nine_ball', label: '9-Ball' },
  { id: 'drill', label: 'Drill' },
  { id: 'free', label: 'Free play' },
]

function SessionSetup() {
  const [mode, setMode] = useState('target_pool')
  const [rounds, setRounds] = useState(5)
  const [players, setPlayers] = useState<Player[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [newName, setNewName] = useState('')
  const [drills, setDrills] = useState<Drill[]>([])
  const [drillId, setDrillId] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api.listPlayers().then((p) => setPlayers(Array.isArray(p) ? p : [])).catch(() => undefined)
    api.listDrills().then((d) => setDrills(Array.isArray(d) ? d : [])).catch(() => undefined)
  }, [])

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const addPlayer = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      const p = await api.createPlayer({
        name,
        initials: initialsOf(name),
        color: PLAYER_COLORS[players.length % PLAYER_COLORS.length],
      })
      setPlayers((ps) => [...ps, p])
      if (p && typeof p.id === 'number') setSelected((s) => [...s, p.id])
      setNewName('')
    } catch (e) {
      setErr(String(e))
    }
  }

  const start = async () => {
    setBusy(true)
    setErr(null)
    try {
      const body: { mode: string; playerIds: number[]; rounds: number; drillId?: number } = {
        mode,
        playerIds: selected,
        rounds,
      }
      if (mode === 'drill' && drillId !== '') body.drillId = Number(drillId)
      const snap = await api.createSession(body)
      if (snap && typeof snap === 'object') useStore.getState().setGame(snap)
    } catch (e) {
      setErr(`Could not start session: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const canStart = !busy && (mode === 'free' || selected.length > 0) && (mode !== 'drill' || drillId !== '')

  return (
    <div className="card">
      <div className="microlabel card-title">New session</div>

      <div className="formrow">
        <span className="microlabel">Mode</span>
        <div className="seg">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'drill' && (
        <div className="formrow">
          <span className="microlabel">Drill</span>
          <select className="field" value={drillId} onChange={(e) => setDrillId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Select a drill…</option>
            {drills.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="formrow">
        <span className="microlabel">Rounds</span>
        <div className="stepper">
          <button onClick={() => setRounds((r) => Math.max(1, r - 1))}>−</button>
          <span className="val">{rounds}</span>
          <button onClick={() => setRounds((r) => Math.min(30, r + 1))}>+</button>
        </div>
      </div>

      <div className="formrow">
        <span className="microlabel">Players</span>
        <div className="flex gap8" style={{ flexWrap: 'wrap' }}>
          {players.map((p) => (
            <button key={p.id} className={`chip${selected.includes(p.id) ? ' on' : ''}`} onClick={() => toggle(p.id)}>
              <span
                className="avatar"
                style={{ width: 18, height: 18, fontSize: 9, background: p.color ?? '#8b5cf6' }}
              >
                {p.initials ?? initialsOf(p.name)}
              </span>
              {p.name}
            </button>
          ))}
          {players.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No players yet — add one below.</span>}
        </div>
        <div className="flex gap8 mt8">
          <input
            className="field"
            placeholder="Add player…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addPlayer()
            }}
          />
          <button className="btn" onClick={() => void addPlayer()} disabled={!newName.trim()}>
            Add
          </button>
        </div>
      </div>

      {err && <div className="banner bad mb16">{err}</div>}

      <button className="btn primary w100" disabled={!canStart} onClick={() => void start()}>
        Start
      </button>
    </div>
  )
}

/* ---------------- scoreboard ---------------- */

function Scoreboard({ game }: { game: GameSnapshot }) {
  const players = game.players ?? []
  const [showRescore, setShowRescore] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)

  const act = (action: string, params?: Record<string, unknown>) =>
    api
      .sessionAction(game.sessionId, action, params)
      .then((snap) => {
        if (snap && typeof snap === 'object') useStore.getState().setGame(snap)
      })
      .catch(() => undefined)

  const last = game.lastResult
  const phase = game.phase ?? ''

  return (
    <div>
      <div className="card">
        <div className="flex jcb aic mb16">
          <span className="microlabel">
            {String(game.mode ?? '').replace('_', ' ')} · round {game.round ?? 1}
            {game.totalRounds ? ` / ${game.totalRounds}` : ''}
          </span>
          <span className="microlabel">{phase.replace(/_/g, ' ')}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {players.map((p) => (
            <PlayerRow
              key={p.id}
              p={p}
              current={game.currentPlayerId === p.id}
              setter={game.mode === 'target_pool' && game.setterId === p.id}
            />
          ))}
        </div>

        {game.message && <div className="phase-line mt16">{game.message}</div>}

        {typeof game.countdown === 'number' && game.countdown > 0 && (
          <div className="countdown-big mt16">{game.countdown}</div>
        )}

        {last && (phase === 'result' || phase === 'round_done') && (
          <div className={`toast-result mt16 ${last.scratch ? 'bad' : (last.points ?? 0) > 0 ? 'good' : 'bad'}`}>
            {last.scratch
              ? 'SCRATCH'
              : `${(last.points ?? 0) > 0 ? '+' : ''}${last.points ?? 0} pts${
                  last.pocketed ? ' · pocketed' : ' · missed'
                }${typeof last.ring === 'number' && last.ring > 0 ? ` · ring ${last.ring}` : ''}`}
          </div>
        )}

        <div className="btn-row mt16">
          {phase === 'setting' && (
            <button className="btn primary" onClick={() => void act('lock_layout')}>
              Lock layout
            </button>
          )}
          {phase === 'call_pocket' && (
            <span className="chip static">Click a pocket on the table to call it</span>
          )}
          <button className="btn" onClick={() => void act('next')}>
            Next
          </button>
          <button className="btn" onClick={() => setShowRescore((v) => !v)}>
            Rescore
          </button>
          {!confirmEnd ? (
            <button className="btn danger" onClick={() => setConfirmEnd(true)}>
              End session
            </button>
          ) : (
            <>
              <button
                className="btn danger"
                onClick={() => {
                  setConfirmEnd(false)
                  void act('end').then(() => useStore.getState().setGame(null))
                }}
              >
                Confirm end
              </button>
              <button className="btn" onClick={() => setConfirmEnd(false)}>
                Keep playing
              </button>
            </>
          )}
        </div>

        {showRescore && (
          <RescoreForm
            players={players}
            onApply={(playerId, points) => {
              void act('rescore', { playerId, points })
              setShowRescore(false)
            }}
          />
        )}
      </div>
    </div>
  )
}

function PlayerRow({ p, current, setter }: { p: GamePlayer; current: boolean; setter: boolean }) {
  return (
    <div className={`playercard${current ? ' current' : ''}`}>
      <span className="avatar" style={{ background: p.color ?? '#8b5cf6' }}>
        {p.initials ?? initialsOf(p.name)}
      </span>
      <div className="pname">
        <span className="nm">{p.name}</span>
        {setter && <span className="badge">setter</span>}
      </div>
      <div className="pscore">
        <div className="bigscore">{p.score ?? 0}</div>
        <div className="microlabel">{p.shots ?? 0} shots</div>
      </div>
    </div>
  )
}

function RescoreForm({
  players,
  onApply,
}: {
  players: GamePlayer[]
  onApply: (playerId: number, points: number) => void
}) {
  const [playerId, setPlayerId] = useState<number>(players[0]?.id ?? 0)
  const [points, setPoints] = useState(0)
  return (
    <div className="flex gap8 mt16 aic">
      <select className="field" style={{ width: 'auto', flex: 1 }} value={playerId} onChange={(e) => setPlayerId(Number(e.target.value))}>
        {players.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input
        className="field"
        style={{ width: 84 }}
        type="number"
        value={points}
        onChange={(e) => setPoints(Number(e.target.value))}
      />
      <button className="btn" onClick={() => onApply(playerId, points)}>
        Apply
      </button>
    </div>
  )
}

/* ---------------- voice control ---------------- */

interface VoiceHit {
  heard: string
  action: string
}

function VoiceControl() {
  const supported = typeof window !== 'undefined' && !!window.webkitSpeechRecognition
  const [on, setOn] = useState(false)
  const [hit, setHit] = useState<VoiceHit | null>(null)
  const recRef = useRef<CueLabSpeechRecognition | null>(null)
  const onRef = useRef(false)

  useEffect(() => {
    onRef.current = on
    if (!supported) return
    if (on && !recRef.current) {
      const Ctor = window.webkitSpeechRecognition
      if (!Ctor) return
      const rec = new Ctor()
      rec.continuous = true
      rec.interimResults = false
      rec.lang = 'en-US'
      rec.onresult = (ev) => {
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i]
          if (!res || !res.isFinal) continue
          const text = res[0]?.transcript ?? ''
          if (text.trim()) handlePhrase(text.trim(), setHit)
        }
      }
      rec.onend = () => {
        recRef.current = null
        if (onRef.current) {
          // restart — continuous recognition times out on some platforms
          setOn(false)
          setTimeout(() => setOn(true), 100)
        }
      }
      rec.onerror = () => undefined
      try {
        rec.start()
        recRef.current = rec
      } catch {
        recRef.current = null
      }
    } else if (!on && recRef.current) {
      try {
        recRef.current.stop()
      } catch {
        // ignore
      }
      recRef.current = null
    }
    return () => {
      if (recRef.current) {
        try {
          recRef.current.abort()
        } catch {
          // ignore
        }
        recRef.current = null
      }
    }
  }, [on, supported])

  return (
    <div className="card mt16">
      <div className="flex jcb aic">
        <div className="mic-chip">
          <button className={`btn small${on ? ' primary' : ''}`} disabled={!supported} onClick={() => setOn((v) => !v)}>
            {on ? 'Mic on' : 'Mic off'}
          </button>
          {!supported && <span>Voice control needs Chrome (webkitSpeechRecognition unavailable)</span>}
          {supported && hit && (
            <span className="mic-transcript">
              “{hit.heard}” → {hit.action}
            </span>
          )}
          {supported && !hit && on && <span>Listening… try “next”, “lock layout”, “end game”</span>}
        </div>
        <span className="microlabel">voice</span>
      </div>
    </div>
  )
}

function handlePhrase(text: string, setHit: (h: VoiceHit) => void) {
  const t = text.toLowerCase()
  const game = useStore.getState().game
  const trigger = (action: string, fn: () => Promise<unknown>) => {
    setHit({ heard: text, action })
    void fn().catch(() => undefined)
  }
  if (t.includes('lock layout')) {
    if (game) trigger('lock_layout', () => api.sessionAction(game.sessionId, 'lock_layout'))
    else setHit({ heard: text, action: 'no active session' })
  } else if (t.includes('new ball') || t.includes('reset balls')) {
    trigger('sim reset', () => api.simReset())
  } else if (t.includes('start recording')) {
    trigger('recording start', () => api.recordingStart())
  } else if (t.includes('stop recording')) {
    trigger('recording stop', () => api.recordingStop())
  } else if (t.includes('end game')) {
    if (game) {
      trigger('end session', () =>
        api.sessionAction(game.sessionId, 'end').then(() => useStore.getState().setGame(null)),
      )
    } else setHit({ heard: text, action: 'no active session' })
  } else if (t.includes('next')) {
    if (game) trigger('next', () => api.sessionAction(game.sessionId, 'next'))
    else setHit({ heard: text, action: 'no active session' })
  } else {
    setHit({ heard: text, action: 'ignored' })
  }
}
