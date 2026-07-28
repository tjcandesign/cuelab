// /sessions/:id/analysis — FusionCue-style shot analysis. Shot timeline strip
// along the bottom (round/shot chips, green dot = made, red = missed);
// selecting a shot renders its recorded per-ball paths over the table plus a
// metrics panel (verdict, first contact, object travel, cue speed, rails,
// pocketed). Live-appends shots via the WS shot_recorded event.

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { ballColor } from '../lib/colors'
import { BALL_R, pockets, tableDims } from '../lib/geometry'
import { fmtSpeed } from '../lib/units'
import type { GameSnapshot, ShotDetail, ShotMetrics, ShotSummary } from '../lib/types'
import { useStore } from '../store'

const MPH_TO_MMS = 447.04

function ballNum(id?: string | null): number {
  if (!id || id === 'cue') return 0
  const n = Number(id.replace(/^b/, ''))
  return Number.isFinite(n) ? n : 0
}

function ballLabel(id?: string | null): string {
  if (!id) return '—'
  if (id === 'cue') return 'Cue ball'
  return `Ball ${ballNum(id)}`
}

const POCKET_NAMES: Record<string, string> = {
  tl: 'top left',
  ts: 'top side',
  tr: 'top right',
  bl: 'bottom left',
  bs: 'bottom side',
  br: 'bottom right',
}

export default function SessionAnalysis() {
  const { id } = useParams()
  const sessionId = Number(id)
  const lastEvent = useStore((s) => s.lastEvent)
  const [session, setSession] = useState<GameSnapshot | null>(null)
  const [shots, setShots] = useState<ShotSummary[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selId, setSelId] = useState<number | null>(null)
  const [detail, setDetail] = useState<ShotDetail | null>(null)

  useEffect(() => {
    if (!id) return
    api.getSession(id).then(setSession).catch(() => undefined)
    api
      .sessionShots(id)
      .then((s) => setShots(Array.isArray(s) ? s : []))
      .catch((e) => {
        setShots([])
        setErr(String(e))
      })
  }, [id])

  // live-append shots recorded while the session runs
  useEffect(() => {
    if (!lastEvent || lastEvent.event !== 'shot_recorded') return
    const data = lastEvent.data ?? {}
    if (Number(data.sessionId) !== sessionId) return
    const shotId = Number(data.shotId)
    if (!Number.isFinite(shotId)) return
    setShots((prev) => {
      const cur = prev ?? []
      if (cur.some((s) => s.id === shotId)) return cur
      return [...cur, { id: shotId, metrics: (data.metrics ?? null) as ShotMetrics | null }]
    })
    setSelId(shotId)
  }, [lastEvent, sessionId])

  // default-select the most recent shot
  useEffect(() => {
    if (selId === null && shots && shots.length > 0) setSelId(shots[shots.length - 1].id)
  }, [shots, selId])

  // fetch full record (paths) for the selected shot
  useEffect(() => {
    if (selId === null) {
      setDetail(null)
      return
    }
    let stale = false
    api
      .getShot(selId)
      .then((d) => {
        if (!stale) setDetail(d ?? null)
      })
      .catch(() => {
        if (!stale) setDetail(null)
      })
    return () => {
      stale = true
    }
  }, [selId])

  const selected = useMemo(() => (shots ?? []).find((s) => s.id === selId) ?? null, [shots, selId])
  const players = session?.players ?? []
  const playerName = (pid?: number | null) => players.find((p) => p.id === pid)?.name ?? null

  return (
    <div>
      <div className="flex jcb aic mb16">
        <div>
          <div className="mb8">
            <Link to="/play" className="microlabel">
              ← play
            </Link>
          </div>
          <h1 className="page-title">Shot analysis</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            {session
              ? `${String(session.mode ?? 'session').replace(/_/g, ' ')} · session #${sessionId}`
              : `session #${Number.isFinite(sessionId) ? sessionId : '—'}`}
          </p>
        </div>
        <span className="microlabel">{shots ? `${shots.length} shots recorded` : 'loading…'}</span>
      </div>

      {err && (
        <div className="banner warn mb16">
          Could not load shots for this session — server offline or shots not recorded yet.
        </div>
      )}

      <div className="analysis-layout">
        <div className="table-wrap">
          <ShotPathsTable detail={detail} />
          <div className="table-meta">
            <span className="microlabel">
              {selected ? `shot ${shotIndexLabel(shots ?? [], selected)}` : 'no shot selected'}
            </span>
            <span className="microlabel">
              {detail?.paths?.length ? `${detail.paths.length} tracked balls` : 'recorded paths'}
            </span>
          </div>
        </div>
        <MetricsPanel shot={selected} playerName={playerName(selected?.playerId)} />
      </div>

      <ShotStrip shots={shots ?? []} selId={selId} onSelect={setSelId} />
    </div>
  )
}

function shotIndexLabel(shots: ShotSummary[], shot: ShotSummary): string {
  const i = shots.findIndex((s) => s.id === shot.id)
  const n = i >= 0 ? i + 1 : shot.id
  return shot.round != null ? `${n} · round ${shot.round}` : String(n)
}

/* ---------------- recorded paths over the table ---------------- */

const RAIL = 90 // visual rail width, mm (matches LiveTable)

function ShotPathsTable({ detail }: { detail: ShotDetail | null }) {
  const config = useStore((s) => s.config)
  const { L, W } = tableDims(config)
  const paths = (detail?.paths ?? []).filter((p) => p && Array.isArray(p.pts) && p.pts.length > 0)

  return (
    <svg
      viewBox={`${-RAIL} ${-RAIL} ${L + RAIL * 2} ${W + RAIL * 2}`}
      style={{ width: '100%', display: 'block', borderRadius: 8 }}
    >
      {/* rails + cloth */}
      <rect x={-RAIL} y={-RAIL} width={L + RAIL * 2} height={W + RAIL * 2} fill="#33231a" rx={26} />
      <rect x={0} y={0} width={L} height={W} fill="#2273c9" />
      <rect x={0} y={0} width={L} height={W} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={3} />
      {/* pockets */}
      {pockets(L, W).map((p) => (
        <circle key={p.id} cx={p.x} cy={p.y} r={p.r * 0.82} fill="#08080c" />
      ))}
      {/* spots */}
      {[0.25, 0.5, 0.75].map((fx) => (
        <circle key={fx} cx={L * fx} cy={W / 2} r={7} fill="rgba(255,255,255,0.35)" />
      ))}

      {/* recorded per-ball paths */}
      {paths.map((p) => {
        const color = ballColor(ballNum(p.id), p.id === 'cue' ? 'cue' : undefined)
        const start = p.pts[0]
        const end = p.pts[p.pts.length - 1]
        return (
          <g key={p.id}>
            <polyline
              points={p.pts.map((pt) => `${pt[0]},${pt[1]}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={10}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.9}
            />
            <circle cx={start[0]} cy={start[1]} r={12} fill={color} stroke="rgba(0,0,0,0.45)" strokeWidth={3} />
            <circle
              cx={end[0]}
              cy={end[1]}
              r={BALL_R}
              fill="none"
              stroke={color}
              strokeWidth={7}
              strokeDasharray="16 12"
            />
          </g>
        )
      })}

      {paths.length === 0 && (
        <text
          x={L / 2}
          y={W / 2}
          fill="rgba(255,255,255,0.55)"
          fontSize={54}
          fontFamily="ui-monospace, monospace"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {detail ? 'NO PATH DATA FOR THIS SHOT' : 'SELECT A SHOT BELOW'}
        </text>
      )}
    </svg>
  )
}

/* ---------------- metrics panel ---------------- */

function MetricsPanel({ shot, playerName }: { shot: ShotSummary | null; playerName: string | null }) {
  const units = useStore((s) => s.units)
  const m: ShotMetrics = shot?.metrics ?? {}

  const verdict = m.made === true ? 'MADE' : m.made === false ? 'MISSED' : 'NO CALL'
  const verdictCls = m.made === true ? 'made' : m.made === false ? 'missed' : 'na'

  const pocketed = Array.isArray(m.pocketed) ? m.pocketed.filter((p) => p && p.ballId) : []
  const pocketedText =
    pocketed.length > 0
      ? pocketed.map((p) => `${ballLabel(p.ballId)} → ${POCKET_NAMES[p.pocket ?? ''] ?? p.pocket ?? '?'}`).join(', ')
      : 'none'

  return (
    <div className="card">
      <div className="flex jcb aic mb8">
        <span className="microlabel">shot metrics</span>
        {playerName && <span className="microlabel">{playerName}</span>}
      </div>

      {!shot ? (
        <div className="muted" style={{ fontSize: 13.5 }}>
          No shots recorded yet — take a shot during a session and it will appear here.
        </div>
      ) : (
        <>
          <div className={`verdict ${verdictCls}`}>{verdict}</div>
          {m.scratch && <div className="banner bad mb16" style={{ padding: '8px 12px' }}>Scratch</div>}

          <div className="kv">
            <span>First contact</span>
            <span className="v">{m.firstContact ? ballLabel(m.firstContact) : '—'}</span>
          </div>
          <div className="kv">
            <span>Object travel</span>
            <span className="v">
              {m.objectTravelPct != null ? `${m.objectTravelPct}% table` : '—'}
              {m.trackedFrames != null ? ` · ${m.trackedFrames} frames` : ''}
            </span>
          </div>
          <div className="kv">
            <span>Cue-ball speed</span>
            <span className="v">{m.cueSpeedMph != null ? fmtSpeed(m.cueSpeedMph * MPH_TO_MMS, units) : '—'}</span>
          </div>
          <div className="kv">
            <span>Rail contact</span>
            <span className="v">
              {m.railContacts != null ? `${m.railContacts} rail${m.railContacts === 1 ? '' : 's'}` : '—'}
            </span>
          </div>
          <div className="kv">
            <span>Pocketed</span>
            <span className="v" style={{ maxWidth: 180 }}>
              {pocketedText}
            </span>
          </div>
          {shot.round != null && (
            <div className="kv">
              <span>Round</span>
              <span className="v">{shot.round}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ---------------- shot timeline strip ---------------- */

function ShotStrip({
  shots,
  selId,
  onSelect,
}: {
  shots: ShotSummary[]
  selId: number | null
  onSelect: (id: number) => void
}) {
  const groups = useMemo(() => {
    const map = new Map<number, { shot: ShotSummary; index: number }[]>()
    shots.forEach((s, i) => {
      const r = s.round ?? 0
      const arr = map.get(r) ?? []
      arr.push({ shot: s, index: i + 1 })
      map.set(r, arr)
    })
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [shots])

  return (
    <div className="shot-strip">
      <span className="microlabel" style={{ flex: 'none' }}>
        shot timeline
      </span>
      {shots.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No shots recorded.</span>}
      {groups.map(([round, items]) => (
        <div key={round} className="shot-round">
          {round > 0 && <span className="microlabel">r{round}</span>}
          <div className="shot-round-chips">
            {items.map(({ shot, index }) => {
              const made = shot.metrics?.made
              const dot = made === true ? 'made' : made === false ? 'missed' : 'na'
              return (
                <button
                  key={shot.id}
                  className={`shot-chip${shot.id === selId ? ' on' : ''}`}
                  onClick={() => onSelect(shot.id)}
                  title={`Shot ${index}`}
                >
                  <span className={`dot ${dot}`} />
                  {index}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
