// /players — grid of player cards + add player.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { initialsOf, PLAYER_COLORS } from '../lib/colors'
import type { Player } from '../lib/types'

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return String(s)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Players() {
  const [players, setPlayers] = useState<Player[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () =>
    api
      .listPlayers()
      .then((p) => setPlayers(Array.isArray(p) ? p : []))
      .catch((e) => setErr(String(e)))

  useEffect(() => {
    void load()
  }, [])

  const add = async () => {
    const nm = name.trim()
    if (!nm) return
    setBusy(true)
    try {
      await api.createPlayer({
        name: nm,
        initials: initialsOf(nm),
        color: PLAYER_COLORS[(players?.length ?? 0) % PLAYER_COLORS.length],
      })
      setName('')
      await load()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex jcb aic mb16" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Players</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Profiles, scores and shot history.
          </p>
        </div>
        <div className="flex gap8">
          <input
            className="field"
            style={{ width: 220 }}
            placeholder="New player name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add()
            }}
          />
          <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void add()}>
            Add player
          </button>
        </div>
      </div>

      {err && <div className="banner bad mb16">Could not reach the server.</div>}
      {players && players.length === 0 && !err && <div className="card muted">No players yet.</div>}

      <div className="grid-cards">
        {(players ?? []).map((p) => (
          <Link key={p.id} to={`/players/${p.id}`} className="card" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <span className="avatar" style={{ background: p.color ?? '#8b5cf6' }}>
              {p.initials ?? initialsOf(p.name)}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 650, fontSize: 15 }}>{p.name}</div>
              <div className="microlabel" style={{ marginTop: 3 }}>
                joined {fmtDate(p.created_at ?? p.createdAt)}
              </div>
              <div className="microlabel" style={{ marginTop: 2 }}>
                last active {fmtDate(p.last_active ?? p.lastActive)}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
