// /setup — 3-step calibration wizard (camera corners -> projector corners ->
// verify) plus mode / table / camera-source configuration.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { VerifyResult } from '../lib/types'
import { useStore } from '../store'

const CORNER_ORDER = ['TL', 'TR', 'BR', 'BL']

export default function Setup() {
  const calibration = useStore((s) => s.calibration)
  const loadCalibration = useStore((s) => s.loadCalibration)
  const [step, setStep] = useState(1)

  useEffect(() => {
    void loadCalibration()
  }, [loadCalibration])

  const cameraDone = !!calibration?.camera?.H
  const projectorDone = !!calibration?.projector?.corners

  const steps = [
    { n: 1, label: 'Camera', done: cameraDone },
    { n: 2, label: 'Projector', done: projectorDone },
    { n: 3, label: 'Verify', done: false },
  ]

  return (
    <div>
      <h1 className="page-title">Setup</h1>
      <p className="page-sub">Calibrate the camera and projector into table space, then verify the loop.</p>

      <div className="wizard">
        <div className="steprail">
          {steps.map((s) => (
            <button
              key={s.n}
              className={`${step === s.n ? 'on' : ''} ${s.done ? 'done' : ''}`}
              onClick={() => setStep(s.n)}
            >
              <span className="idx">{s.done ? '✓' : s.n}</span>
              {s.label}
            </button>
          ))}
        </div>

        <div>
          {step === 1 && <CameraStep onSolved={() => void loadCalibration()} onNext={() => setStep(2)} />}
          {step === 2 && <ProjectorStep onNext={() => setStep(3)} />}
          {step === 3 && <VerifyStep />}
          <ModeCard />
        </div>
      </div>
    </div>
  )
}

/* ---------------- step 1: camera ---------------- */

function CameraStep({ onSolved, onNext }: { onSolved: () => void; onNext: () => void }) {
  const [nonce, setNonce] = useState(() => Date.now())
  const [points, setPoints] = useState<[number, number][]>([])
  const [solved, setSolved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const onImgClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (solved) return
    const img = imgRef.current
    if (!img || points.length >= 4) return
    const rect = img.getBoundingClientRect()
    const nx = ((e.clientX - rect.left) / rect.width) * (img.naturalWidth || rect.width)
    const ny = ((e.clientY - rect.top) / rect.height) * (img.naturalHeight || rect.height)
    setPoints((p) => [...p, [Math.round(nx), Math.round(ny)]])
  }

  const removePoint = (i: number) => {
    if (solved) return
    setPoints((p) => p.filter((_, idx) => idx !== i))
  }

  const solve = async () => {
    setBusy(true)
    setErr(null)
    try {
      await api.calibrateCamera(points.map((p) => [p[0], p[1]]))
      setSolved(true)
      onSolved()
    } catch (e) {
      setErr(`Solve failed: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const redo = () => {
    setPoints([])
    setSolved(false)
    setNonce(Date.now())
  }

  const img = imgRef.current
  const natW = img?.naturalWidth || 1920
  const natH = img?.naturalHeight || 1080

  return (
    <div className="card">
      <div className="flex jcb aic mb8">
        <span className="microlabel">Step 1 — camera corners</span>
        <button className="btn small" onClick={() => setNonce(Date.now())}>
          Refresh frame
        </button>
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
        Click the four corners of the <strong>playing surface</strong> in order: top-left, top-right,
        bottom-right, bottom-left. Click a numbered marker to remove and re-place it.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: solved ? '1fr 1fr' : '1fr', gap: 14 }}>
        <div>
          <div className="snapshot-box">
            <img
              ref={imgRef}
              src={`/api/camera/snapshot.jpg?t=${nonce}`}
              alt="camera snapshot"
              onClick={onImgClick}
              onError={() => setErr('No camera frame — is the server running?')}
            />
            {points.map((p, i) => (
              <span
                key={i}
                className="corner-marker"
                style={{ left: `${(p[0] / natW) * 100}%`, top: `${(p[1] / natH) * 100}%` }}
                onClick={(e) => {
                  e.stopPropagation()
                  removePoint(i)
                }}
                title={`${CORNER_ORDER[i]} — click to re-place`}
              >
                {i + 1}
              </span>
            ))}
          </div>
          <div className="microlabel mt8">
            {points.length < 4
              ? `next click: ${CORNER_ORDER[points.length]} (${points.length}/4)`
              : 'all four corners placed'}
          </div>
        </div>

        {solved && (
          <div>
            <div className="snapshot-box">
              <img src={`/api/calibration/camera/preview.jpg?t=${Date.now()}`} alt="corrected top-down view" />
            </div>
            <div className="microlabel mt8">corrected top-down view</div>
          </div>
        )}
      </div>

      {err && <div className="banner bad mt16">{err}</div>}

      <div className="btn-row mt16">
        {!solved ? (
          <>
            <button className="btn primary" disabled={points.length !== 4 || busy} onClick={() => void solve()}>
              {busy ? 'Solving…' : 'Solve'}
            </button>
            <button className="btn" disabled={points.length === 0} onClick={() => setPoints([])}>
              Clear points
            </button>
          </>
        ) : (
          <>
            <button className="btn primary" onClick={onNext}>
              Looks right — continue
            </button>
            <button className="btn" onClick={redo}>
              Redo
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------------- step 2: projector ---------------- */

function ProjectorStep({ onNext }: { onNext: () => void }) {
  const config = useStore((s) => s.config)
  const [corners, setCorners] = useState<number[][] | null>(null)

  const poll = useCallback(() => {
    api
      .getCalibration()
      .then((cal) => setCorners(cal?.projector?.corners ?? null))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    poll()
    const t = setInterval(poll, 2000)
    return () => clearInterval(t)
  }, [poll])

  const pw = config?.projector?.width ?? 1920
  const ph = config?.projector?.height ?? 1080

  return (
    <div className="card">
      <div className="microlabel card-title">Step 2 — projector corners</div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
        Open the projector output on the projector display, then drag its four corner handles until the
        outline sits exactly on the physical playing surface. Drag with mouse or touch; click a handle
        and use <span className="mono">arrow keys</span> to nudge 1px (<span className="mono">shift</span> = 10px).
      </p>
      <div className="btn-row mb16">
        <button
          className="btn primary"
          onClick={() => window.open('/projector?calibrate=1', 'cuelab-projector')}
        >
          Open projector output
        </button>
        <button className="btn small" onClick={poll}>
          Refresh preview
        </button>
      </div>

      <div className="microlabel mb8">live corner geometry ({pw}×{ph})</div>
      <svg
        viewBox={`0 0 ${pw} ${ph}`}
        style={{ width: '100%', maxWidth: 560, display: 'block', background: '#000', borderRadius: 8, border: '1px solid var(--border)' }}
      >
        <rect x={0} y={0} width={pw} height={ph} fill="#000" />
        {corners && corners.length === 4 ? (
          <>
            <polygon
              points={corners.map((c) => `${c[0]},${c[1]}`).join(' ')}
              fill="rgba(139,92,246,0.15)"
              stroke="#8b5cf6"
              strokeWidth={Math.max(2, pw / 300)}
            />
            {corners.map((c, i) => (
              <g key={i}>
                <circle cx={c[0]} cy={c[1]} r={pw / 90} fill="#8b5cf6" />
                <text x={c[0] + pw / 70} y={c[1]} fill="#8b8b98" fontSize={pw / 45} fontFamily="ui-monospace, monospace">
                  {CORNER_ORDER[i]}
                </text>
              </g>
            ))}
          </>
        ) : (
          <text x={pw / 2} y={ph / 2} fill="#8b8b98" fontSize={pw / 40} textAnchor="middle">
            no projector calibration stored yet
          </text>
        )}
      </svg>

      <div className="btn-row mt16">
        <button className="btn primary" onClick={onNext}>
          Continue to verify
        </button>
      </div>
    </div>
  )
}

/* ---------------- step 3: verify ---------------- */

function VerifyStep() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setErr(null)
    setResult(null)
    try {
      setResult(await api.verifyCalibration())
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="microlabel card-title">Step 3 — verify</div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
        The server projects markers, detects them through the camera, and reports the offsets.
      </p>
      <button className="btn primary" disabled={busy} onClick={() => void run()}>
        {busy ? 'Verifying…' : 'Run verification'}
      </button>

      {err && <div className="banner bad mt16">Verification request failed: {err}</div>}

      {result && (
        <div className={`banner mt16 ${result.ok ? 'ok' : 'bad'}`}>
          <strong>{result.ok ? 'PASS — calibration verified' : 'FAIL — calibration is off'}</strong>
          {Array.isArray(result.errorsMm) && result.errorsMm.length > 0 && (
            <div className="mono mt8" style={{ fontSize: 12.5 }}>
              errors: {result.errorsMm.map((e) => `${Number(e).toFixed(1)}mm`).join(' · ')}
            </div>
          )}
          {result.note && <div className="mt8" style={{ fontSize: 13 }}>{result.note}</div>}
        </div>
      )}
    </div>
  )
}

/* ---------------- mode / table / camera config ---------------- */

function ModeCard() {
  const config = useStore((s) => s.config)
  const loadConfig = useStore((s) => s.loadConfig)
  const [source, setSource] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (config?.camera?.source !== undefined) setSource(String(config.camera.source))
  }, [config?.camera?.source])

  const put = async (patch: Record<string, unknown>) => {
    setErr(null)
    try {
      const next = await api.putConfig(patch)
      if (next && typeof next === 'object') useStore.getState().setConfig(next)
      else await loadConfig()
    } catch (e) {
      setErr(`Config update failed: ${String(e)}`)
    }
  }

  const applySource = () => {
    const asNum = Number(source)
    void put({ camera: { ...(config?.camera ?? {}), source: source !== '' && !Number.isNaN(asNum) ? asNum : source } })
  }

  return (
    <div className="card">
      <div className="microlabel card-title">Engine</div>

      <div className="formrow">
        <span className="microlabel">Mode</span>
        <div className="seg">
          <button className={config?.mode !== 'camera' ? 'on' : ''} onClick={() => void put({ mode: 'sim' })}>
            Sim
          </button>
          <button className={config?.mode === 'camera' ? 'on' : ''} onClick={() => void put({ mode: 'camera' })}>
            Camera
          </button>
        </div>
      </div>

      <div className="formrow">
        <span className="microlabel">Table size</span>
        <select
          className="field"
          style={{ maxWidth: 200 }}
          value={config?.tableSize ?? '8ft'}
          onChange={(e) => void put({ tableSize: e.target.value })}
        >
          <option value="7ft">7ft — 1981 × 991 mm</option>
          <option value="8ft">8ft — 2235 × 1118 mm</option>
          <option value="9ft">9ft — 2540 × 1270 mm</option>
        </select>
      </div>

      <div className="formrow" style={{ marginBottom: 0 }}>
        <span className="microlabel">Camera source</span>
        <div className="flex gap8" style={{ maxWidth: 420 }}>
          <input
            className="field"
            placeholder="0, 1, or rtsp://…"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applySource()
            }}
          />
          <button className="btn" onClick={applySource}>
            Apply
          </button>
        </div>
      </div>

      {err && <div className="banner bad mt16">{err}</div>}
    </div>
  )
}
