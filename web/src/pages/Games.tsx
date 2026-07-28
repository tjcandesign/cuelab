// /games — stat tiles (games overview), a card per game with personal best +
// Launch, and a grid of published layout drills rendered as mini table maps
// with dashed numbered circles (FusionCue look).

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { TABLE_PRESETS } from '../lib/geometry'
import type { Drill, GamesOverview } from '../lib/types'

const GAME_CARDS: { mode: string; name: string; desc: string; bestKey: 'instantRecallBest' | 'targetPoolHigh' }[] = [
  {
    mode: 'instant_recall',
    name: 'Instant Recall',
    desc: 'Capture one layout, then keep returning to it until you can clear the table without a miss.',
    bestKey: 'instantRecallBest',
  },
  {
    mode: 'target_pool',
    name: 'Target Pool',
    desc: 'Pocket the called object ball and land the cue ball inside the bullseye.',
    bestKey: 'targetPoolHigh',
  },
]

function num(v?: number | null): string {
  return v === undefined || v === null || Number.isNaN(v) ? '—' : String(v)
}

export default function Games() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<GamesOverview | null>(null)
  const [drills, setDrills] = useState<Drill[] | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    api.gamesOverview().then(setOverview).catch(() => setErr(true))
    api.listDrills().then((d) => setDrills(Array.isArray(d) ? d : [])).catch(() => setDrills([]))
  }, [])

  const layouts = (drills ?? []).filter(
    (d) => d.published && (d.type === 'target_pool_layout' || d.type === 'position'),
  )

  const tiles = [
    { label: 'Games played', value: num(overview?.gamesPlayed) },
    { label: 'Target Pool high', value: num(overview?.targetPoolHigh) },
    { label: 'Instant Recall best', value: num(overview?.instantRecallBest) },
    { label: 'Last score', value: num(overview?.lastSession?.score) },
  ]

  return (
    <div>
      <h1 className="page-title">Games</h1>
      <p className="page-sub">Projected games, personal bests and published layout maps.</p>

      {err && <div className="banner warn mb16">Could not load game stats — server offline?</div>}

      <div className="statgrid mb16">
        {tiles.map((t) => (
          <div key={t.label} className="statcard">
            <div className="microlabel">{t.label}</div>
            <div className="num">{t.value}</div>
          </div>
        ))}
      </div>

      <div className="games-grid mb16">
        {GAME_CARDS.map((g) => (
          <div key={g.mode} className="card">
            <div className="flex jcb aic mb8">
              <strong style={{ fontSize: 16 }}>{g.name}</strong>
              <span className="tag">{g.mode.replace(/_/g, ' ')}</span>
            </div>
            <p className="muted" style={{ margin: '0 0 14px', fontSize: 13.5 }}>
              {g.desc}
            </p>
            <div className="kv" style={{ borderBottom: 0, padding: '0 0 14px' }}>
              <span className="microlabel">personal best</span>
              <span className="v" style={{ fontSize: 20, fontWeight: 750 }}>
                {num(overview?.[g.bestKey])}
              </span>
            </div>
            <div className="btn-row">
              <button
                className="btn primary"
                onClick={() => navigate('/play', { state: { mode: g.mode } })}
              >
                Launch Game
              </button>
              <Link to="/players" className="btn">
                My Stats
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="flex jcb aic mb8">
        <span className="microlabel">layout maps</span>
        <Link to="/drills" className="microlabel">
          all drills →
        </Link>
      </div>
      {drills !== null && layouts.length === 0 && (
        <div className="card muted">
          No published layout drills yet — publish a <span className="mono">target_pool_layout</span> or{' '}
          <span className="mono">position</span> drill and it will show up here.
        </div>
      )}
      <div className="grid-cards">
        {layouts.map((d) => (
          <Link key={d.id} to={`/drills/${d.id}/edit`} className="card" style={{ display: 'block' }}>
            <div className="flex jcb aic mb8">
              <strong style={{ fontSize: 14.5 }}>{d.name || 'Untitled layout'}</strong>
              <span className="tag">{d.type}</span>
            </div>
            <LayoutMap drill={d} />
            <div className="flex jcb aic mt8">
              <span className="microlabel">{(d.balls ?? []).length} balls</span>
              {d.calledPocket && <span className="microlabel">pocket {d.calledPocket}</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

/** Mini table map: dashed numbered circles at ball positions. */
function LayoutMap({ drill }: { drill: Drill }) {
  const dims = TABLE_PRESETS[drill.table ?? '8ft'] ?? TABLE_PRESETS['8ft']
  const { L, W } = dims
  return (
    <svg viewBox={`-40 -40 ${L + 80} ${W + 80}`} style={{ width: '100%', display: 'block', borderRadius: 6 }}>
      <rect x={-40} y={-40} width={L + 80} height={W + 80} fill="#33231a" rx={26} />
      <rect x={0} y={0} width={L} height={W} fill="#1c5da3" />
      {(drill.targets ?? []).map((t, i) =>
        t?.c && Array.isArray(t.radii) ? (
          <g key={`t${i}`}>
            {t.radii.map((r, j) => (
              <circle key={j} cx={t.c[0]} cy={t.c[1]} r={r} fill="none" stroke="#8b5cf6" strokeWidth={10} opacity={0.8} />
            ))}
          </g>
        ) : null,
      )}
      {(drill.balls ?? []).map((b) => (
        <g key={b.id}>
          <circle
            cx={b.x}
            cy={b.y}
            r={46}
            fill="none"
            stroke={b.kind === 'cue' || b.number === 0 ? '#ffffff' : '#e8e8ef'}
            strokeWidth={8}
            strokeDasharray="20 14"
          />
          <text
            x={b.x}
            y={b.y}
            fill="#ffffff"
            fontSize={52}
            fontFamily="ui-monospace, monospace"
            fontWeight={700}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {b.kind === 'cue' || b.number === 0 ? 'C' : b.number ?? '?'}
          </text>
        </g>
      ))}
    </svg>
  )
}
