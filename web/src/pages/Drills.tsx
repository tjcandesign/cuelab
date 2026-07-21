// /drills — grid of drill cards + New drill.

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ballColor } from '../lib/colors'
import { TABLE_PRESETS } from '../lib/geometry'
import { api } from '../lib/api'
import type { Drill } from '../lib/types'

export default function Drills() {
  const [drills, setDrills] = useState<Drill[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    api
      .listDrills()
      .then((d) => setDrills(Array.isArray(d) ? d : []))
      .catch((e) => setErr(String(e)))
  }, [])

  return (
    <div>
      <div className="flex jcb aic mb16">
        <div>
          <h1 className="page-title">Drills</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Layouts, targets and success criteria you can send to the table.
          </p>
        </div>
        <button className="btn primary" onClick={() => navigate('/drills/new/edit')}>
          New drill
        </button>
      </div>

      {err && <div className="banner bad mb16">Could not load drills — server offline?</div>}
      {drills && drills.length === 0 && !err && (
        <div className="card muted">No drills yet. Create one to get started.</div>
      )}

      <div className="grid-cards">
        {(drills ?? []).map((d) => (
          <Link key={d.id} to={`/drills/${d.id}/edit`} className="card" style={{ display: 'block' }}>
            <div className="flex jcb aic mb8">
              <strong style={{ fontSize: 15 }}>{d.name || 'Untitled drill'}</strong>
              <span className="tag">{d.type || 'custom'}</span>
            </div>
            <MiniDiagram drill={d} />
            <div className="flex jcb aic mt8">
              <span className="microlabel">{(d.balls ?? []).length} balls</span>
              <span className="flex gap8">
                {(d.tags ?? []).slice(0, 3).map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function MiniDiagram({ drill }: { drill: Drill }) {
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
        <circle key={b.id} cx={b.x} cy={b.y} r={40} fill={ballColor(b.number ?? 0, b.kind)} stroke="rgba(0,0,0,0.4)" strokeWidth={4} />
      ))}
    </svg>
  )
}
