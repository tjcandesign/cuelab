// /projector — the physical projector output. Pure black, no chrome.
// The table-space SVG (mm coordinates) is warped onto the stored projector
// corners with a CSS matrix3d homography. "c" toggles calibration mode,
// "b" toggles the live ball-outline layer, arrows nudge the selected corner.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { sceneColor } from '../lib/colors'
import { BALL_R, clamp, pocketCenter, tableDims } from '../lib/geometry'
import { cornersToMatrix3d, type Pt } from '../lib/homography'
import type { SceneItem } from '../lib/types'
import { useStore } from '../store'

const LS_KEY = 'cuelab.projector.corners'
const BASE_W = 1000
const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL']

function defaultCorners(): Pt[] {
  const w = window.innerWidth
  const h = window.innerHeight
  const mx = w * 0.12
  const my = h * 0.12
  return [
    [mx, my],
    [w - mx, my],
    [w - mx, h - my],
    [mx, h - my],
  ]
}

function loadCorners(): Pt[] | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (
      Array.isArray(parsed) &&
      parsed.length === 4 &&
      parsed.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number'))
    ) {
      return parsed as Pt[]
    }
  } catch {
    // ignore
  }
  return null
}

export default function Projector() {
  const [params] = useSearchParams()
  const scene = useStore((s) => s.scene)
  const balls = useStore((s) => s.balls)
  const config = useStore((s) => s.config)
  const { L, W } = tableDims(config)
  const baseH = (BASE_W * W) / L

  const [corners, setCorners] = useState<Pt[]>(() => loadCorners() ?? defaultCorners())
  const [calibrate, setCalibrate] = useState(() => params.get('calibrate') === '1')
  const [showBalls, setShowBalls] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  const postTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragIdx = useRef<number | null>(null)
  const fetchedServer = useRef(false)

  // if nothing stored locally, adopt the server's calibration once
  useEffect(() => {
    if (fetchedServer.current || loadCorners()) return
    fetchedServer.current = true
    api
      .getCalibration()
      .then((cal) => {
        const c = cal?.projector?.corners
        if (Array.isArray(c) && c.length === 4) {
          setCorners(c.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0] as Pt))
        }
      })
      .catch(() => undefined)
  }, [])

  const persist = useCallback((next: Pt[]) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next))
    } catch {
      // storage full/blocked — POST still happens
    }
    if (postTimer.current) clearTimeout(postTimer.current)
    postTimer.current = setTimeout(() => {
      void api.calibrateProjector(next.map((p) => [p[0], p[1]])).catch(() => undefined)
    }, 500)
  }, [])

  const updateCorner = useCallback(
    (idx: number, x: number, y: number) => {
      setCorners((prev) => {
        const next = prev.map((p, i) => (i === idx ? ([x, y] as Pt) : p))
        persist(next)
        return next
      })
    },
    [persist],
  )

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'c' || e.key === 'C') {
        setCalibrate((v) => !v)
        return
      }
      if (e.key === 'b' || e.key === 'B') {
        setShowBalls((v) => !v)
        return
      }
      if (!calibrate || selected === null) return
      const step = e.shiftKey ? 10 : 1
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = -step
      else if (e.key === 'ArrowDown') dy = step
      else if (e.key === 'Escape') {
        setSelected(null)
        return
      } else return
      e.preventDefault()
      const c = corners[selected]
      updateCorner(selected, c[0] + dx, c[1] + dy)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [calibrate, selected, corners, updateCorner])

  const transform = useMemo(() => {
    try {
      return cornersToMatrix3d(BASE_W, baseH, corners)
    } catch {
      return 'none'
    }
  }, [corners, baseH])

  const onHandleDown = (idx: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    setSelected(idx)
    dragIdx.current = idx
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragIdx.current === null) return
    updateCorner(
      dragIdx.current,
      clamp(e.clientX, -200, window.innerWidth + 200),
      clamp(e.clientY, -200, window.innerHeight + 200),
    )
  }
  const onHandleUp = () => {
    dragIdx.current = null
  }

  return (
    <div className="projector-root">
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: BASE_W,
          height: baseH,
          transform,
          transformOrigin: '0 0',
        }}
      >
        <svg
          viewBox={`0 0 ${L} ${W}`}
          width={BASE_W}
          height={baseH}
          style={{ overflow: 'visible', display: 'block' }}
        >
          <defs>
            <clipPath id="tableClip">
              <rect x={0} y={0} width={L} height={W} />
            </clipPath>
          </defs>

          {calibrate && (
            <g>
              <rect x={0} y={0} width={L} height={W} fill="none" stroke="#8b5cf6" strokeWidth={6} />
              <line x1={L / 2 - 90} y1={W / 2} x2={L / 2 + 90} y2={W / 2} stroke="#8b5cf6" strokeWidth={5} />
              <line x1={L / 2} y1={W / 2 - 90} x2={L / 2} y2={W / 2 + 90} stroke="#8b5cf6" strokeWidth={5} />
              <circle cx={L / 2} cy={W / 2} r={40} fill="none" stroke="#8b5cf6" strokeWidth={4} />
            </g>
          )}

          {showBalls && (
            <g opacity={0.55}>
              {balls.map((b) => (
                <circle
                  key={b.id}
                  cx={b.x}
                  cy={b.y}
                  r={BALL_R}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={4}
                />
              ))}
            </g>
          )}

          <SceneLayer scene={scene} L={L} W={W} />
        </svg>
      </div>

      {calibrate && (
        <>
          {corners.map((c, i) => (
            <div
              key={i}
              className={`corner-handle${selected === i ? ' sel' : ''}`}
              style={{ left: c[0], top: c[1] }}
              onPointerDown={onHandleDown(i)}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
            >
              {CORNER_LABELS[i]}
            </div>
          ))}
          <div className="proj-help">
            <div style={{ marginBottom: 6 }}>
              <b>PROJECTOR CALIBRATION</b>
            </div>
            Drag the four corner handles onto the physical corners of the playing surface.
            <div style={{ marginTop: 8, lineHeight: 1.9 }}>
              <b>click</b> select corner · <b>arrows</b> nudge 1px · <b>shift+arrows</b> nudge 10px
              <br />
              <b>c</b> exit calibration · <b>b</b> toggle ball outlines · <b>esc</b> deselect
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SceneLayer({ scene, L, W }: { scene: SceneItem[]; L: number; W: number }) {
  return (
    <g>
      {scene.map((item, i) => (
        <ScenePrimitive key={i} item={item} L={L} W={W} />
      ))}
    </g>
  )
}

function ScenePrimitive({ item, L, W }: { item: SceneItem; L: number; W: number }) {
  if (!item || typeof item !== 'object') return null
  switch (item.kind) {
    case 'ring': {
      if (!item.c || !Array.isArray(item.radii)) return null
      const color = sceneColor(item.color)
      const sorted = [...item.radii].sort((a, b) => a - b)
      return (
        <g>
          {item.radii.map((r, i) => (
            <circle key={i} cx={item.c[0]} cy={item.c[1]} r={r} fill="none" stroke={color} strokeWidth={6} />
          ))}
          {(item.labels ?? []).map((lab, i) => {
            const inner = i === 0 ? 0 : sorted[i - 1] ?? 0
            const outer = sorted[i] ?? inner
            const mid = (inner + outer) / 2
            return (
              <text
                key={`l${i}`}
                x={item.c[0]}
                y={item.c[1] - mid}
                fill={color}
                fontSize={46}
                fontFamily="ui-monospace, monospace"
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {lab}
              </text>
            )
          })}
        </g>
      )
    }
    case 'ghost': {
      if (!item.c) return null
      const color = sceneColor(item.color ?? 'white')
      const r = item.r ?? BALL_R
      return (
        <g>
          <circle
            cx={item.c[0]}
            cy={item.c[1]}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={5}
            strokeDasharray="14 10"
          />
          {item.label && (
            <text
              x={item.c[0]}
              y={item.c[1] + r + 34}
              fill={color}
              fontSize={30}
              fontFamily="ui-monospace, monospace"
              fontWeight={600}
              textAnchor="middle"
            >
              {item.label}
            </text>
          )}
        </g>
      )
    }
    case 'line': {
      if (!item.a || !item.b) return null
      return (
        <line
          x1={item.a[0]}
          y1={item.a[1]}
          x2={item.b[0]}
          y2={item.b[1]}
          stroke={sceneColor(item.color)}
          strokeWidth={item.width ?? 6}
          strokeDasharray={item.dash ? '18 14' : undefined}
          strokeLinecap="round"
        />
      )
    }
    case 'text': {
      if (!item.c || !item.text) return null
      const rot = item.rot ?? 0
      return (
        <text
          x={item.c[0]}
          y={item.c[1]}
          fill={sceneColor(item.color ?? 'white')}
          fontSize={item.size ?? 60}
          fontWeight={650}
          textAnchor="middle"
          dominantBaseline="central"
          transform={rot ? `rotate(${rot} ${item.c[0]} ${item.c[1]})` : undefined}
        >
          {item.text}
        </text>
      )
    }
    case 'pocket': {
      if (!item.pocket) return null
      const [px, py] = pocketCenter(item.pocket, L, W)
      const color = sceneColor(item.color)
      return (
        <g clipPath="url(#tableClip)">
          <circle cx={px} cy={py} r={100} fill="none" stroke={color} strokeWidth={10} opacity={0.95} />
          <circle cx={px} cy={py} r={130} fill="none" stroke={color} strokeWidth={7} opacity={0.55} />
          <circle cx={px} cy={py} r={160} fill="none" stroke={color} strokeWidth={5} opacity={0.28} />
        </g>
      )
    }
    case 'countdown': {
      if (!item.c || item.value === undefined || item.value === null) return null
      return (
        <text
          key={item.value}
          className="cd-digit"
          x={item.c[0]}
          y={item.c[1]}
          fill="#ffffff"
          fontSize={320}
          fontWeight={800}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {item.value}
        </text>
      )
    }
    case 'poly': {
      if (!Array.isArray(item.points) || item.points.length < 2) return null
      const color = sceneColor(item.color)
      const pts = item.points.map((p) => `${p[0]},${p[1]}`).join(' ')
      return (
        <polygon
          points={pts}
          fill={item.fill ? color : 'none'}
          fillOpacity={item.fill ? 0.25 : undefined}
          stroke={color}
          strokeWidth={5}
        />
      )
    }
    default:
      return null
  }
}
