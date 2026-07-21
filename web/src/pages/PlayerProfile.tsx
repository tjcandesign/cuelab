// /players/:id — profile page: header card, 4x2 stat grid, recent sessions.

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { initialsOf } from '../lib/colors'
import type { Player, PlayerStats, RecentSession } from '../lib/types'

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return String(s)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function pct(v?: number): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—'
  // accept either 0..1 or 0..100 from the server
  const p = v <= 1 ? v * 100 : v
  return `${Math.round(p)}%`
}

function num(v?: number): string {
  return v === undefined || v === null || Number.isNaN(v) ? '—' : String(v)
}

export default function PlayerProfile() {
  const { id } = useParams()
  const [player, setPlayer] = useState<Player | null>(null)
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    api.getPlayer(id).then(setPlayer).catch((e) => setErr(String(e)))
    api.playerStats(id).then(setStats).catch(() => undefined)
  }, [id])

  if (err) return <div className="banner bad">Could not load player — server offline?</div>
  if (!player) return <div className="muted">Loading…</div>

  const cards: { label: string; value: string }[] = [
    { label: 'Attempts', value: num(stats?.attempts) },
    { label: 'Success rate', value: pct(stats?.successRate) },
    { label: 'Shot accuracy', value: pct(stats?.shotAccuracy) },
    { label: 'Best streak', value: num(stats?.bestStreak) },
    { label: 'Shots fired', value: num(stats?.shotsFired) },
    { label: 'Balls pocketed', value: num(stats?.ballsPocketed) },
    { label: 'Balls missed', value: num(stats?.ballsMissed) },
    { label: 'Scratches', value: num(stats?.scratches) },
  ]

  return (
    <div className="page-narrow" style={{ margin: '0 auto' }}>
      <div className="mb16">
        <Link to="/players" className="microlabel">
          ← players
        </Link>
      </div>

      <div className="card mb16" style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        <span className="avatar big" style={{ background: player.color ?? '#8b5cf6' }}>
          {player.initials ?? initialsOf(player.name)}
        </span>
        <div>
          <h1 className="page-title" style={{ marginBottom: 6 }}>
            {player.name}
          </h1>
          <div className="microlabel">
            joined {fmtDate(player.created_at ?? player.createdAt)} · last active{' '}
            {fmtDate(player.last_active ?? player.lastActive)}
          </div>
        </div>
      </div>

      <div className="statgrid mb16">
        {cards.map((c) => (
          <div key={c.label} className="statcard">
            <div className="microlabel">{c.label}</div>
            <div className="num">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="microlabel card-title">Recent sessions</div>
        <RecentSessions sessions={stats?.recentSessions} />
      </div>
    </div>
  )
}

function RecentSessions({ sessions }: { sessions?: RecentSession[] }) {
  if (!sessions || sessions.length === 0) {
    return <div className="muted" style={{ fontSize: 13.5 }}>No sessions yet.</div>
  }
  return (
    <div>
      {sessions.map((s, i) => (
        <div key={s.id ?? s.sessionId ?? i} className="kv">
          <span>
            {String(s.mode ?? 'session').replace('_', ' ')}
            <span className="muted"> · {fmtDate(s.started_at ?? s.startedAt)}</span>
          </span>
          <span className="v">
            {s.score !== undefined ? `${s.score} pts` : ''}
            {s.shots !== undefined ? ` · ${s.shots} shots` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}
