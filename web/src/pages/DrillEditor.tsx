// /drills/:id/edit — drill editor. Place balls from a palette, drag to
// position (mm readout), add target rings with draggable radius handles,
// pick a called pocket, define success criteria, save/export/import,
// and send the drill to the table as a session.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { ballColor, initialsOf } from '../lib/colors'
import { BALL_R, clamp, dist, pockets, TABLE_PRESETS } from '../lib/geometry'
import { fmtLen } from '../lib/units'
import type { Drill, DrillBall, Player, TargetSpec } from '../lib/types'
import { useStore } from '../store'

const MARGIN = 90
const DRILL_TYPES = ['target_pool_layout', 'position', 'potting', 'custom']

type Sel = { kind: 'ball'; id: string } | { kind: 'target'; index: number } | null

function emptyDrill(table: string): Drill {
  const dims = TABLE_PRESETS[table] ?? TABLE_PRESETS['8ft']
  return {
    name: 'New drill',
    type: 'custom',
    description: '',
    table,
    balls: [{ id: 'cue', kind: 'cue', number: 0, x: dims.L * 0.25, y: dims.W / 2 }],
    targets: [],
    calledPocket: null,
    successCriteria: { mustPocket: [], cueInTarget: false, maxShots: 1 },
    tags: [],
    published: false,
  }
}

export default function DrillEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = id === 'new'
  const config = useStore((s) => s.config)
  const units = useStore((s) => s.units)
  const [drill, setDrill] = useState<Drill | null>(null)
  const [sel, setSel] = useState<Sel>(null)
  const [placingTarget, setPlacingTarget] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<
    | { kind: 'ball'; id: string }
    | { kind: 'target'; index: number }
    | { kind: 'radius'; index: number; ri: number }
    | null
  >(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (isNew) {
      setDrill(emptyDrill(config?.tableSize && TABLE_PRESETS[config.tableSize] ? config.tableSize : '8ft'))
      return
    }
    api
      .getDrill(id ?? '')
      .then((d) => setDrill({ ...emptyDrill(d.table ?? '8ft'), ...d, balls: d.balls ?? [], targets: d.targets ?? [] }))
      .catch((e) => setErr(`Could not load drill: ${String(e)}`))
  }, [id, isNew, config?.tableSize])

  const dims = TABLE_PRESETS[drill?.table ?? '8ft'] ?? TABLE_PRESETS['8ft']
  const { L, W } = dims

  const toMm = useCallback(
    (e: { clientX: number; clientY: number }): [number, number] => {
      const svg = svgRef.current
      if (!svg) return [0, 0]
      const rect = svg.getBoundingClientRect()
      const scale = rect.width / (L + MARGIN * 2)
      return [(e.clientX - rect.left) / scale - MARGIN, (e.clientY - rect.top) / scale - MARGIN]
    },
    [L],
  )

  const update = (fn: (d: Drill) => Drill) => setDrill((d) => (d ? fn(d) : d))

  // ---- ball palette ----
  const presentIds = new Set((drill?.balls ?? []).map((b) => b.id))
  const addBall = (num: number) => {
    const ballId = num === 0 ? 'cue' : `b${num}`
    if (presentIds.has(ballId)) return
    const ball: DrillBall = {
      id: ballId,
      kind: num === 0 ? 'cue' : num === 8 ? 'eight' : num > 8 ? 'stripe' : 'solid',
      number: num,
      x: L / 2 + ((num * 37) % 240) - 120,
      y: W / 2 + ((num * 53) % 160) - 80,
    }
    update((d) => ({ ...d, balls: [...d.balls, ball] }))
    setSel({ kind: 'ball', id: ballId })
  }

  const removeBall = (ballId: string) =>
    update((d) => ({
      ...d,
      balls: d.balls.filter((b) => b.id !== ballId),
      successCriteria: {
        ...d.successCriteria,
        mustPocket: (d.successCriteria?.mustPocket ?? []).filter((x) => x !== ballId),
      },
    }))

  // ---- pointer interaction on the SVG ----
  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drill) return
    const [x, y] = toMm(e)
    if (placingTarget) {
      const t: TargetSpec = { c: [Math.round(x), Math.round(y)], radii: [90, 180, 270], scores: [6, 4, 2] }
      update((d) => ({ ...d, targets: [...(d.targets ?? []), t] }))
      setSel({ kind: 'target', index: drill.targets?.length ?? 0 })
      setPlacingTarget(false)
      return
    }
    // ball hit?
    let hitBall: DrillBall | null = null
    let best = 45
    for (const b of drill.balls) {
      const dd = dist(x, y, b.x, b.y)
      if (dd < best) {
        best = dd
        hitBall = b
      }
    }
    if (hitBall) {
      setSel({ kind: 'ball', id: hitBall.id })
      dragRef.current = { kind: 'ball', id: hitBall.id }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    // target center hit?
    const targets = drill.targets ?? []
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      if (t?.c && dist(x, y, t.c[0], t.c[1]) < 60) {
        setSel({ kind: 'target', index: i })
        dragRef.current = { kind: 'target', index: i }
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
    }
    setSel(null)
  }

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const [x, y] = toMm(e)
    if (drag.kind === 'ball') {
      update((d) => ({
        ...d,
        balls: d.balls.map((b) =>
          b.id === drag.id
            ? { ...b, x: round1(clamp(x, BALL_R, L - BALL_R)), y: round1(clamp(y, BALL_R, W - BALL_R)) }
            : b,
        ),
      }))
    } else if (drag.kind === 'target') {
      update((d) => ({
        ...d,
        targets: (d.targets ?? []).map((t, i) =>
          i === drag.index ? { ...t, c: [Math.round(clamp(x, 0, L)), Math.round(clamp(y, 0, W))] } : t,
        ),
      }))
    } else if (drag.kind === 'radius') {
      update((d) => ({
        ...d,
        targets: (d.targets ?? []).map((t, i) => {
          if (i !== drag.index || !t.c) return t
          const r = Math.max(25, Math.round(dist(x, y, t.c[0], t.c[1])))
          const radii = [...t.radii]
          radii[drag.ri] = r
          return { ...t, radii }
        }),
      }))
    }
  }

  const onSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // not captured
    }
  }

  const onSvgContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault()
    if (!drill) return
    const [x, y] = toMm(e)
    for (const b of drill.balls) {
      if (dist(x, y, b.x, b.y) < 45) {
        removeBall(b.id)
        setSel(null)
        return
      }
    }
  }

  // keyboard delete
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      if (!sel) return
      e.preventDefault()
      if (sel.kind === 'ball') removeBall(sel.id)
      else update((d) => ({ ...d, targets: (d.targets ?? []).filter((_, i) => i !== sel.index) }))
      setSel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  // ---- persistence ----
  const save = async () => {
    if (!drill) return
    setSaving(true)
    setErr(null)
    try {
      if (isNew || drill.id === undefined) {
        const created = await api.createDrill(drill)
        if (created && created.id !== undefined) {
          setDrill(created)
          navigate(`/drills/${created.id}/edit`, { replace: true })
        }
      } else {
        const updated = await api.updateDrill(drill.id, drill)
        if (updated && typeof updated === 'object') setDrill({ ...drill, ...updated })
      }
    } catch (e) {
      setErr(`Save failed: ${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!drill || drill.id === undefined) return
    try {
      await api.deleteDrill(drill.id)
      navigate('/drills')
    } catch (e) {
      setErr(`Delete failed: ${String(e)}`)
    }
  }

  const exportJson = () => {
    if (!drill) return
    const blob = new Blob([JSON.stringify(drill, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(drill.name || 'drill').replace(/[^a-z0-9-_]+/gi, '_')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importJson = (file: File) => {
    void file
      .text()
      .then(async (text) => {
        const parsed = JSON.parse(text) as unknown
        const imported = await api.importDrill(parsed)
        if (imported && imported.id !== undefined) navigate(`/drills/${imported.id}/edit`)
        else setErr('Import returned no drill id')
      })
      .catch((e) => setErr(`Import failed: ${String(e)}`))
  }

  if (err && !drill) return <div className="banner bad">{err}</div>
  if (!drill) return <div className="muted">Loading…</div>

  const selBall = sel?.kind === 'ball' ? drill.balls.find((b) => b.id === sel.id) : undefined
  const selTarget = sel?.kind === 'target' ? (drill.targets ?? [])[sel.index] : undefined
  const pks = pockets(L, W)

  return (
    <div>
      <div className="flex jcb aic mb16">
        <h1 className="page-title" style={{ margin: 0 }}>
          {isNew ? 'New drill' : `Edit — ${drill.name}`}
        </h1>
        <div className="btn-row">
          <button className="btn" onClick={exportJson}>
            Export JSON
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importJson(f)
              e.target.value = ''
            }}
          />
          {!isNew && drill.id !== undefined && (
            <button className="btn danger" onClick={() => void remove()}>
              Delete
            </button>
          )}
          <button className="btn primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {err && <div className="banner bad mb16">{err}</div>}

      <div className="drill-editor">
        <div className="card">
          <div className="flex jcb aic mb8">
            <span className="microlabel">Ball palette — click to place</span>
            <button
              className={`btn small${placingTarget ? ' primary' : ''}`}
              onClick={() => setPlacingTarget((v) => !v)}
            >
              {placingTarget ? 'Click table to place ring…' : '+ Target ring'}
            </button>
          </div>
          <div className="palette mb8">
            {Array.from({ length: 16 }, (_, n) => n).map((n) => (
              <button
                key={n}
                disabled={presentIds.has(n === 0 ? 'cue' : `b${n}`)}
                style={{ background: ballColor(n), color: n === 0 || n === 1 ? '#111' : '#fff' }}
                onClick={() => addBall(n)}
                title={n === 0 ? 'Cue ball' : `Ball ${n}`}
              >
                {n === 0 ? 'C' : n}
              </button>
            ))}
          </div>

          <svg
            ref={svgRef}
            className="editor-svg"
            viewBox={`${-MARGIN} ${-MARGIN} ${L + MARGIN * 2} ${W + MARGIN * 2}`}
            onPointerDown={onSvgPointerDown}
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
            onContextMenu={onSvgContextMenu}
          >
            <rect x={-MARGIN} y={-MARGIN} width={L + MARGIN * 2} height={W + MARGIN * 2} fill="#33231a" rx={40} />
            <rect x={0} y={0} width={L} height={W} fill="#2273c9" />
            {/* pockets */}
            {pks.map((p) => {
              const called = drill.calledPocket === p.id
              return (
                <g
                  key={p.id}
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    update((d) => ({ ...d, calledPocket: called ? null : p.id }))
                  }}
                >
                  <circle cx={p.x} cy={p.y} r={p.r * 0.82} fill="#08080c" />
                  {called && <circle cx={p.x} cy={p.y} r={p.r + 18} fill="none" stroke="#8b5cf6" strokeWidth={10} />}
                </g>
              )
            })}
            {/* targets */}
            {(drill.targets ?? []).map((t, i) => {
              if (!t?.c) return null
              const isSel = sel?.kind === 'target' && sel.index === i
              return (
                <g key={i}>
                  {t.radii.map((r, ri) => (
                    <circle
                      key={ri}
                      cx={t.c[0]}
                      cy={t.c[1]}
                      r={r}
                      fill="none"
                      stroke={isSel ? '#a78bfa' : '#8b5cf6'}
                      strokeWidth={isSel ? 9 : 6}
                      opacity={0.9}
                    />
                  ))}
                  <circle cx={t.c[0]} cy={t.c[1]} r={12} fill={isSel ? '#a78bfa' : '#8b5cf6'} />
                  {isSel &&
                    t.radii.map((r, ri) => (
                      <circle
                        key={`h${ri}`}
                        cx={t.c[0] + r}
                        cy={t.c[1]}
                        r={20}
                        fill="#fff"
                        stroke="#8b5cf6"
                        strokeWidth={5}
                        style={{ cursor: 'ew-resize' }}
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          dragRef.current = { kind: 'radius', index: i, ri }
                          svgRef.current?.setPointerCapture(e.pointerId)
                        }}
                      />
                    ))}
                </g>
              )
            })}
            {/* balls */}
            {drill.balls.map((b) => {
              const isSel = sel?.kind === 'ball' && sel.id === b.id
              const stripe = (b.kind === 'stripe' || (b.number ?? 0) >= 9) && b.kind !== 'cue'
              const color = ballColor(b.number ?? 0, b.kind)
              return (
                <g key={b.id} style={{ cursor: 'grab' }}>
                  {isSel && <circle cx={b.x} cy={b.y} r={BALL_R + 14} fill="none" stroke="#fff" strokeWidth={4} strokeDasharray="8 7" />}
                  {stripe && (
                    <defs>
                      <clipPath id={`ballclip-${b.id}`}>
                        <circle cx={b.x} cy={b.y} r={BALL_R} />
                      </clipPath>
                    </defs>
                  )}
                  <circle cx={b.x} cy={b.y} r={BALL_R} fill={stripe ? '#f2efe2' : color} stroke="rgba(0,0,0,0.45)" strokeWidth={2} />
                  {stripe && (
                    <rect
                      x={b.x - BALL_R}
                      y={b.y - BALL_R * 0.5}
                      width={BALL_R * 2}
                      height={BALL_R}
                      fill={color}
                      clipPath={`url(#ballclip-${b.id})`}
                    />
                  )}
                  {(b.number ?? 0) > 0 && (
                    <>
                      <circle cx={b.x} cy={b.y} r={BALL_R * 0.55} fill="#f5f2e8" />
                      <text x={b.x} y={b.y + 1} fontSize={22} fontWeight={700} fill="#17171d" textAnchor="middle" dominantBaseline="central">
                        {b.number}
                      </text>
                    </>
                  )}
                </g>
              )
            })}
          </svg>

          <div className="table-meta">
            <span className="microlabel">
              {selBall
                ? `${selBall.id} · x ${fmtLen(selBall.x, units)} · y ${fmtLen(selBall.y, units)}`
                : selTarget?.c
                  ? `target · c ${fmtLen(selTarget.c[0], units)}, ${fmtLen(selTarget.c[1], units)} · radii ${selTarget.radii.map((r) => fmtLen(r, units, 0)).join(' / ')}`
                  : 'click a pocket to call it · right-click a ball to remove'}
            </span>
            <span className="microlabel">{drill.table ?? '8ft'} table</span>
          </div>
        </div>

        <EditorSidebar
          drill={drill}
          update={update}
          selTargetIndex={sel?.kind === 'target' ? sel.index : null}
          canSend={!isNew && drill.id !== undefined}
        />
      </div>
    </div>
  )
}

function EditorSidebar({
  drill,
  update,
  selTargetIndex,
  canSend,
}: {
  drill: Drill
  update: (fn: (d: Drill) => Drill) => void
  selTargetIndex: number | null
  canSend: boolean
}) {
  const units = useStore((s) => s.units)
  const sc = drill.successCriteria ?? {}
  const objectBalls = drill.balls.filter((b) => b.id !== 'cue')
  const selTarget = selTargetIndex !== null ? (drill.targets ?? [])[selTargetIndex] : undefined

  return (
    <div>
      <div className="card">
        <div className="microlabel card-title">Drill</div>
        <div className="formrow">
          <span className="microlabel">Name</span>
          <input className="field" value={drill.name} onChange={(e) => update((d) => ({ ...d, name: e.target.value }))} />
        </div>
        <div className="formrow">
          <span className="microlabel">Description</span>
          <textarea
            className="field"
            rows={2}
            value={drill.description ?? ''}
            onChange={(e) => update((d) => ({ ...d, description: e.target.value }))}
          />
        </div>
        <div className="formrow">
          <span className="microlabel">Type</span>
          <select className="field" value={drill.type} onChange={(e) => update((d) => ({ ...d, type: e.target.value }))}>
            {DRILL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="formrow">
          <span className="microlabel">Tags (comma separated)</span>
          <input
            className="field"
            value={(drill.tags ?? []).join(', ')}
            onChange={(e) =>
              update((d) => ({
                ...d,
                tags: e.target.value
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              }))
            }
          />
        </div>
        <div className="formrow" style={{ marginBottom: 0 }}>
          <span className="microlabel">Table</span>
          <select className="field" value={drill.table ?? '8ft'} onChange={(e) => update((d) => ({ ...d, table: e.target.value }))}>
            <option value="7ft">7ft</option>
            <option value="8ft">8ft</option>
            <option value="9ft">9ft</option>
          </select>
        </div>
      </div>

      {selTarget && selTargetIndex !== null && (
        <div className="card">
          <div className="microlabel card-title">Selected target — ring scores</div>
          {selTarget.radii.map((r, ri) => (
            <div key={ri} className="flex gap8 aic mb8">
              <span className="microlabel" style={{ width: 90 }}>
                r {fmtLen(r, units, 1)}
              </span>
              <input
                className="field"
                type="number"
                style={{ width: 80 }}
                value={selTarget.scores?.[ri] ?? 0}
                onChange={(e) =>
                  update((d) => ({
                    ...d,
                    targets: (d.targets ?? []).map((t, i) => {
                      if (i !== selTargetIndex) return t
                      const scores = [...(t.scores ?? t.radii.map(() => 0))]
                      scores[ri] = Number(e.target.value)
                      return { ...t, scores }
                    }),
                  }))
                }
              />
              <span className="microlabel">pts</span>
            </div>
          ))}
          <button
            className="btn small danger"
            onClick={() => update((d) => ({ ...d, targets: (d.targets ?? []).filter((_, i) => i !== selTargetIndex) }))}
          >
            Remove target
          </button>
        </div>
      )}

      <div className="card">
        <div className="microlabel card-title">Success criteria</div>
        <div className="formrow">
          <span className="microlabel">Must pocket</span>
          <div className="flex gap8" style={{ flexWrap: 'wrap' }}>
            {objectBalls.length === 0 && <span className="muted" style={{ fontSize: 12.5 }}>Place object balls first</span>}
            {objectBalls.map((b) => {
              const on = (sc.mustPocket ?? []).includes(b.id)
              return (
                <button
                  key={b.id}
                  className={`chip${on ? ' on' : ''}`}
                  onClick={() =>
                    update((d) => {
                      const cur = d.successCriteria?.mustPocket ?? []
                      return {
                        ...d,
                        successCriteria: {
                          ...d.successCriteria,
                          mustPocket: on ? cur.filter((x) => x !== b.id) : [...cur, b.id],
                        },
                      }
                    })
                  }
                >
                  {b.id}
                </button>
              )
            })}
          </div>
        </div>
        <label className="flex gap8 aic mb8" style={{ cursor: 'pointer', fontSize: 13.5 }}>
          <input
            type="checkbox"
            checked={!!sc.cueInTarget}
            onChange={(e) =>
              update((d) => ({ ...d, successCriteria: { ...d.successCriteria, cueInTarget: e.target.checked } }))
            }
          />
          Cue ball must finish in target
        </label>
        <div className="flex gap8 aic">
          <span className="microlabel">Max shots</span>
          <input
            className="field"
            type="number"
            min={1}
            style={{ width: 80 }}
            value={sc.maxShots ?? 1}
            onChange={(e) =>
              update((d) => ({
                ...d,
                successCriteria: { ...d.successCriteria, maxShots: Math.max(1, Number(e.target.value) || 1) },
              }))
            }
          />
        </div>
        <div className="mt8 microlabel">
          Called pocket: {drill.calledPocket ? drill.calledPocket.toUpperCase() : 'none — click a pocket on the table'}
        </div>
      </div>

      <SendToTable drill={drill} canSend={canSend} />
    </div>
  )
}

function SendToTable({ drill, canSend }: { drill: Drill; canSend: boolean }) {
  const navigate = useNavigate()
  const [players, setPlayers] = useState<Player[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [rounds, setRounds] = useState(3)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api.listPlayers().then((p) => setPlayers(Array.isArray(p) ? p : [])).catch(() => undefined)
  }, [])

  const send = async () => {
    if (drill.id === undefined) return
    setErr(null)
    try {
      const snap = await api.createSession({ mode: 'drill', playerIds: selected, rounds, drillId: drill.id })
      if (snap && typeof snap === 'object') useStore.getState().setGame(snap)
      navigate('/play')
    } catch (e) {
      setErr(String(e))
    }
  }

  return (
    <div className="card">
      <div className="microlabel card-title">Send to table</div>
      <div className="flex gap8 mb8" style={{ flexWrap: 'wrap' }}>
        {players.map((p) => (
          <button
            key={p.id}
            className={`chip${selected.includes(p.id) ? ' on' : ''}`}
            onClick={() => setSelected((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}
          >
            <span className="avatar" style={{ width: 18, height: 18, fontSize: 9, background: p.color ?? '#8b5cf6' }}>
              {p.initials ?? initialsOf(p.name)}
            </span>
            {p.name}
          </button>
        ))}
      </div>
      <div className="flex gap8 aic mb8">
        <span className="microlabel">Attempts</span>
        <div className="stepper">
          <button onClick={() => setRounds((r) => Math.max(1, r - 1))}>−</button>
          <span className="val">{rounds}</span>
          <button onClick={() => setRounds((r) => Math.min(30, r + 1))}>+</button>
        </div>
      </div>
      {err && <div className="banner bad mb8">{err}</div>}
      <button className="btn primary w100" disabled={!canSend || selected.length === 0} onClick={() => void send()}>
        Start drill session
      </button>
      {!canSend && <div className="microlabel mt8">Save the drill first</div>}
    </div>
  )
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
