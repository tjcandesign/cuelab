// Live table canvas — 60fps render of cloth, rails, pockets, balls and the
// current scene overlays. In sim mode it is also the interaction surface:
//   drag ball        -> POST /api/sim/place on drop
//   shift+drag (cue) -> aim arrow, POST /api/sim/shoot on release
//   double-click     -> add next object ball at point
//   right-click ball -> remove
//   phase call_pocket: click a pocket -> session action call_pocket

import { useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { ballColor, isStripe, sceneColor, UI } from '../lib/colors'
import { BALL_R, clamp, dist, pocketCenter, pockets, tableDims } from '../lib/geometry'
import { fmtSpeed } from '../lib/units'
import type { Ball, SceneItem } from '../lib/types'
import { useStore } from '../store'

const RAIL = 90 // visual rail width, mm

interface DragState {
  id: string
  x: number
  y: number
}

interface AimState {
  fromX: number
  fromY: number
  x: number
  y: number
  ballId: string
}

export default function LiveTable({ interactive = true }: { interactive?: boolean }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const aimRef = useRef<AimState | null>(null)
  const sizeRef = useRef({ w: 800, h: 430 })

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    const dpr = window.devicePixelRatio || 1

    const resize = () => {
      const { L, W } = tableDims(useStore.getState().config)
      const totalW = L + RAIL * 2
      const totalH = W + RAIL * 2
      const cssW = wrap.clientWidth - 2 // padding compensation
      const cssH = Math.max(120, cssW * (totalH / totalW))
      sizeRef.current = { w: cssW, h: cssH }
      canvas.style.height = `${cssH}px`
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const st = useStore.getState()
      const { L, W } = tableDims(st.config)
      const totalW = L + RAIL * 2
      const { w: cssW, h: cssH } = sizeRef.current
      const scale = cssW / totalW
      const mx = (x: number) => (x + RAIL) * scale
      const my = (y: number) => (y + RAIL) * scale

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)

      // rails
      ctx.fillStyle = '#33231a'
      roundRect(ctx, 0, 0, cssW, cssH, 10)
      ctx.fill()
      ctx.strokeStyle = '#4a3526'
      ctx.lineWidth = 1
      roundRect(ctx, 0.5, 0.5, cssW - 1, cssH - 1, 10)
      ctx.stroke()

      // cloth
      ctx.fillStyle = UI.cloth
      ctx.fillRect(mx(0), my(0), L * scale, W * scale)
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.strokeRect(mx(0) + 0.5, my(0) + 0.5, L * scale - 1, W * scale - 1)

      // spots + head string
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      for (const fx of [0.25, 0.5, 0.75]) {
        ctx.beginPath()
        ctx.arc(mx(L * fx), my(W / 2), 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.setLineDash([4, 6])
      ctx.beginPath()
      ctx.moveTo(mx(L * 0.25), my(0))
      ctx.lineTo(mx(L * 0.25), my(W))
      ctx.stroke()
      ctx.setLineDash([])

      // pockets
      const pks = pockets(L, W)
      for (const p of pks) {
        ctx.fillStyle = '#08080c'
        ctx.beginPath()
        ctx.arc(mx(p.x), my(p.y), p.r * 0.82 * scale, 0, Math.PI * 2)
        ctx.fill()
      }

      // clip to cloth for scene overlays
      ctx.save()
      ctx.beginPath()
      ctx.rect(mx(0), my(0), L * scale, W * scale)
      ctx.clip()
      drawScene(ctx, st.scene, mx, my, scale, L, W)
      ctx.restore()

      // balls (drag override applied)
      const drag = dragRef.current
      for (const b of st.balls) {
        const bx = drag && drag.id === b.id ? drag.x : b.x
        const by = drag && drag.id === b.id ? drag.y : b.y
        drawBall(ctx, b, mx(bx), my(by), BALL_R * scale)
      }

      // aim arrow
      const aim = aimRef.current
      if (aim) {
        const ax = mx(aim.fromX)
        const ay = my(aim.fromY)
        const bx2 = mx(aim.x)
        const by2 = my(aim.y)
        const lenMm = dist(aim.fromX, aim.fromY, aim.x, aim.y)
        const speed = aimSpeed(lenMm)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.setLineDash([6, 5])
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx2, by2)
        ctx.stroke()
        ctx.setLineDash([])
        // arrowhead
        const ang = Math.atan2(by2 - ay, bx2 - ax)
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.moveTo(bx2, by2)
        ctx.lineTo(bx2 - 11 * Math.cos(ang - 0.42), by2 - 11 * Math.sin(ang - 0.42))
        ctx.lineTo(bx2 - 11 * Math.cos(ang + 0.42), by2 - 11 * Math.sin(ang + 0.42))
        ctx.closePath()
        ctx.fill()
        // speed label
        ctx.font = '600 12px ui-monospace, monospace'
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        ctx.fillText(fmtSpeed(speed, useStore.getState().units), bx2 + 10, by2 - 6)
      }

      // call_pocket affordance
      const game = st.game
      if (game && game.phase === 'call_pocket') {
        for (const p of pks) {
          ctx.strokeStyle = UI.accent
          ctx.lineWidth = 2
          ctx.setLineDash([3, 4])
          ctx.beginPath()
          ctx.arc(mx(p.x), my(p.y), (p.r * 0.82 + 14) * scale + 4, 0, Math.PI * 2)
          ctx.stroke()
          ctx.setLineDash([])
        }
      }
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  // ---- interaction ----
  const toMm = (e: { clientX: number; clientY: number }): [number, number] => {
    const canvas = canvasRef.current
    if (!canvas) return [0, 0]
    const rect = canvas.getBoundingClientRect()
    const { L } = tableDims(useStore.getState().config)
    const totalW = L + RAIL * 2
    const scale = rect.width / totalW
    return [(e.clientX - rect.left) / scale - RAIL, (e.clientY - rect.top) / scale - RAIL]
  }

  const ballAt = (x: number, y: number): Ball | null => {
    const balls = useStore.getState().balls
    let best: Ball | null = null
    let bestD = 45 // pick radius, mm
    for (const b of balls) {
      const d = dist(x, y, b.x, b.y)
      if (d < bestD) {
        bestD = d
        best = b
      }
    }
    return best
  }

  const isSim = () => useStore.getState().config?.mode !== 'camera'

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return
    if (e.button !== 0) return
    const [x, y] = toMm(e)
    const st = useStore.getState()
    const { L, W } = tableDims(st.config)

    // call a pocket during call_pocket phase
    const game = st.game
    if (game && game.phase === 'call_pocket') {
      for (const p of pockets(L, W)) {
        if (dist(x, y, p.x, p.y) < p.r + 60) {
          void api.sessionAction(game.sessionId, 'call_pocket', { pocket: p.id }).catch(() => undefined)
          return
        }
      }
    }

    if (!isSim()) return
    const ball = ballAt(x, y)
    if (!ball) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // synthetic events / lost pointers have no capturable id
    }
    if (e.shiftKey && (ball.kind === 'cue' || ball.id === 'cue')) {
      aimRef.current = { fromX: ball.x, fromY: ball.y, x, y, ballId: ball.id }
    } else {
      dragRef.current = { id: ball.id, x: ball.x, y: ball.y }
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return
    const [x, y] = toMm(e)
    const { L, W } = tableDims(useStore.getState().config)
    if (dragRef.current) {
      dragRef.current = {
        ...dragRef.current,
        x: clamp(x, BALL_R, L - BALL_R),
        y: clamp(y, BALL_R, W - BALL_R),
      }
    } else if (aimRef.current) {
      aimRef.current = { ...aimRef.current, x, y }
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return
    const drag = dragRef.current
    const aim = aimRef.current
    dragRef.current = null
    aimRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // not captured
    }
    if (drag) {
      void api.simPlace(drag.id, round1(drag.x), round1(drag.y)).catch(() => undefined)
    } else if (aim) {
      const dx = aim.x - aim.fromX
      const dy = aim.y - aim.fromY
      const len = Math.hypot(dx, dy)
      if (len > 15) {
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI
        void api.simShoot(aim.ballId, round1(angle), Math.round(aimSpeed(len))).catch(() => undefined)
      }
    }
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive || !isSim()) return
    const [x, y] = toMm(e)
    const st = useStore.getState()
    const { L, W } = tableDims(st.config)
    if (x < BALL_R || y < BALL_R || x > L - BALL_R || y > W - BALL_R) return
    if (ballAt(x, y)) return
    const present = new Set(st.balls.map((b) => b.number))
    let next = 0
    for (let n = 1; n <= 15; n++) {
      if (!present.has(n)) {
        next = n
        break
      }
    }
    if (!next) return
    const id = `b${next}`
    void api
      .simAdd(id)
      .then(() => api.simPlace(id, round1(x), round1(y)))
      .catch(() => undefined)
  }

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive) return
    e.preventDefault()
    if (!isSim()) return
    const [x, y] = toMm(e)
    const ball = ballAt(x, y)
    if (ball) void api.simRemove(ball.id).catch(() => undefined)
  }

  return (
    <div ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      />
    </div>
  )
}

function aimSpeed(lenMm: number): number {
  return clamp(lenMm * 4, 150, 6000)
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawBall(ctx: CanvasRenderingContext2D, b: Ball, px: number, py: number, r: number) {
  const color = b.color && b.color.startsWith('#') ? b.color : ballColor(b.number, b.kind)
  const stripe = isStripe(b.number, b.kind)
  ctx.save()
  ctx.beginPath()
  ctx.arc(px, py, r, 0, Math.PI * 2)
  ctx.clip()
  if (stripe) {
    ctx.fillStyle = '#f2efe2'
    ctx.fillRect(px - r, py - r, r * 2, r * 2)
    ctx.fillStyle = color
    ctx.fillRect(px - r, py - r * 0.55, r * 2, r * 1.1)
  } else {
    ctx.fillStyle = color
    ctx.fillRect(px - r, py - r, r * 2, r * 2)
  }
  // number circle
  if (b.number > 0) {
    ctx.fillStyle = '#f5f2e8'
    ctx.beginPath()
    ctx.arc(px, py, r * 0.55, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#17171d'
    ctx.font = `700 ${Math.max(7, r * 0.72)}px -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(b.number), px, py + 0.5)
  }
  // sheen
  const g = ctx.createRadialGradient(px - r * 0.4, py - r * 0.45, r * 0.1, px, py, r)
  g.addColorStop(0, 'rgba(255,255,255,0.34)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.05)')
  g.addColorStop(1, 'rgba(0,0,0,0.25)')
  ctx.fillStyle = g
  ctx.fillRect(px - r, py - r, r * 2, r * 2)
  ctx.restore()
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(px, py, r, 0, Math.PI * 2)
  ctx.stroke()
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: SceneItem[],
  mx: (x: number) => number,
  my: (y: number) => number,
  scale: number,
  L: number,
  W: number,
) {
  for (const item of scene) {
    if (!item || typeof item !== 'object') continue
    switch (item.kind) {
      case 'ring': {
        if (!item.c || !Array.isArray(item.radii)) break
        const color = sceneColor(item.color)
        ctx.strokeStyle = color
        ctx.lineWidth = Math.max(1.5, 5 * scale)
        for (const r of item.radii) {
          ctx.beginPath()
          ctx.arc(mx(item.c[0]), my(item.c[1]), r * scale, 0, Math.PI * 2)
          ctx.stroke()
        }
        if (item.labels && item.labels.length) {
          const sorted = [...item.radii].sort((a, b) => a - b)
          ctx.fillStyle = color
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          item.labels.forEach((lab, i) => {
            const inner = i === 0 ? 0 : sorted[i - 1] ?? 0
            const outer = sorted[i] ?? inner
            const mid = (inner + outer) / 2
            ctx.font = `700 ${Math.max(9, 40 * scale)}px ui-monospace, monospace`
            ctx.fillText(String(lab), mx(item.c[0]), my(item.c[1] - mid))
          })
        }
        break
      }
      case 'ghost': {
        if (!item.c) break
        const r = (item.r ?? BALL_R) * scale
        ctx.strokeStyle = sceneColor(item.color ?? 'white')
        ctx.lineWidth = Math.max(1.2, 4 * scale)
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.arc(mx(item.c[0]), my(item.c[1]), r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
        if (item.label) {
          ctx.fillStyle = sceneColor(item.color ?? 'white')
          ctx.font = `600 ${Math.max(8, 26 * scale)}px ui-monospace, monospace`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillText(item.label, mx(item.c[0]), my(item.c[1]) + r + 3)
        }
        break
      }
      case 'line': {
        if (!item.a || !item.b) break
        ctx.strokeStyle = sceneColor(item.color)
        ctx.lineWidth = Math.max(1, (item.width ?? 6) * scale)
        if (item.dash) ctx.setLineDash([7, 6])
        ctx.beginPath()
        ctx.moveTo(mx(item.a[0]), my(item.a[1]))
        ctx.lineTo(mx(item.b[0]), my(item.b[1]))
        ctx.stroke()
        ctx.setLineDash([])
        break
      }
      case 'text': {
        if (!item.c || !item.text) break
        ctx.save()
        ctx.translate(mx(item.c[0]), my(item.c[1]))
        if (item.rot) ctx.rotate((item.rot * Math.PI) / 180)
        ctx.fillStyle = sceneColor(item.color ?? 'white')
        ctx.font = `650 ${Math.max(8, (item.size ?? 60) * scale)}px -apple-system, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(item.text, 0, 0)
        ctx.restore()
        break
      }
      case 'pocket': {
        if (!item.pocket) break
        const [pxm, pym] = pocketCenter(item.pocket, L, W)
        const color = sceneColor(item.color)
        for (let i = 0; i < 3; i++) {
          ctx.strokeStyle = color
          ctx.globalAlpha = 0.85 - i * 0.28
          ctx.lineWidth = Math.max(1.5, (6 - i) * scale * 1.5)
          ctx.beginPath()
          ctx.arc(mx(pxm), my(pym), (95 + i * 26) * scale, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        break
      }
      case 'countdown': {
        if (!item.c || item.value === undefined || item.value === null) break
        ctx.fillStyle = '#ffffff'
        ctx.font = `800 ${Math.max(20, 240 * scale)}px -apple-system, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.globalAlpha = 0.9
        ctx.fillText(String(item.value), mx(item.c[0]), my(item.c[1]))
        ctx.globalAlpha = 1
        break
      }
      case 'poly': {
        if (!Array.isArray(item.points) || item.points.length < 2) break
        const color = sceneColor(item.color)
        ctx.beginPath()
        item.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(mx(p[0]), my(p[1]))
          else ctx.lineTo(mx(p[0]), my(p[1]))
        })
        ctx.closePath()
        if (item.fill) {
          ctx.fillStyle = color
          ctx.globalAlpha = 0.25
          ctx.fill()
          ctx.globalAlpha = 1
        }
        ctx.strokeStyle = color
        ctx.lineWidth = Math.max(1, 4 * scale)
        ctx.stroke()
        break
      }
      default:
        break
    }
  }
}
