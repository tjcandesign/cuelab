// /hardware — 2D hardware planner. Projector and Camera tabs with live
// coverage / resolution / brightness math, a three-state verdict banner,
// a side-view SVG diagram, and clickable reference hardware.

import { useMemo, useState } from 'react'
import { BALL_D, TABLE_PRESETS } from '../lib/geometry'
import { useStore } from '../store'
import { fmtDensity, fmtDim, fmtFeetIn, fmtHeight, fmtLen, type Units } from '../lib/units'

const ASPECTS: Record<string, number> = { '16:9': 16 / 9, '16:10': 16 / 10, '4:3': 4 / 3 }
const MARGIN_MM = 150 // projector margin beyond the playing surface, per side

interface ProjectorRef {
  name: string
  throw: number
  lumens: number
  resW: number
  aspect: string
}
interface CameraRef {
  name: string
  fov: number
  resW: number
  aspect: string
}

// Reference data — typical published specs, for quick starting points.
const PROJECTORS: ProjectorRef[] = [
  { name: 'BenQ TH671ST', throw: 0.69, lumens: 3000, resW: 1920, aspect: '16:9' },
  { name: 'ViewSonic PS502W', throw: 0.61, lumens: 4000, resW: 1280, aspect: '16:10' },
  { name: 'Epson EB-525W', throw: 0.48, lumens: 2800, resW: 1280, aspect: '16:10' },
  { name: 'Optoma GT1080HDR', throw: 0.5, lumens: 3800, resW: 1920, aspect: '16:9' },
  { name: 'BenQ TK700STi', throw: 0.9, lumens: 3000, resW: 1920, aspect: '16:9' },
  { name: 'Epson Home Cinema 880', throw: 1.27, lumens: 3300, resW: 1920, aspect: '16:9' },
  { name: 'ViewSonic PX701-4K', throw: 1.12, lumens: 3200, resW: 1920, aspect: '16:9' },
  { name: 'Generic standard projector', throw: 1.5, lumens: 3000, resW: 1920, aspect: '16:9' },
]

const CAMERAS: CameraRef[] = [
  { name: 'Logitech C920', fov: 78, resW: 1920, aspect: '16:9' },
  { name: 'Logitech Brio 4K', fov: 90, resW: 3840, aspect: '16:9' },
  { name: 'ELP wide USB', fov: 100, resW: 1920, aspect: '16:9' },
  { name: 'OBSBOT Tiny 2', fov: 85.5, resW: 3840, aspect: '16:9' },
  { name: 'Wyze Cam v3 (RTSP)', fov: 110, resW: 1920, aspect: '16:9' },
  { name: 'Generic 1080p webcam', fov: 70, resW: 1920, aspect: '16:9' },
]

type Verdict = { state: 'green' | 'amber' | 'red'; title: string; details: string[] }

export default function Hardware() {
  const units = useStore((s) => s.units)
  const [tab, setTab] = useState<'projector' | 'camera'>('projector')
  const [tableSize, setTableSize] = useState('8ft')
  const [mountH, setMountH] = useState(1.85) // meters above the table surface

  // projector
  const [throwRatio, setThrowRatio] = useState(0.69)
  const [pAspect, setPAspect] = useState('16:9')
  const [pResW, setPResW] = useState(1920)
  const [lumens, setLumens] = useState(3000)

  // camera
  const [fov, setFov] = useState(78)
  const [cResW, setCResW] = useState(1920)
  const [cAspect, setCAspect] = useState('16:9')

  const dims = TABLE_PRESETS[tableSize] ?? TABLE_PRESETS['8ft']
  const { L, W } = dims
  const hMm = mountH * 1000

  const proj = useMemo(() => {
    const a = ASPECTS[pAspect] ?? 16 / 9
    const imageW = hMm / throwRatio
    const imageH = imageW / a
    const needW = L + MARGIN_MM * 2
    const needH = W + MARGIN_MM * 2
    const covOk = imageW >= needW && imageH >= needH
    const pxPerMm = pResW / imageW
    const areaM2 = (imageW / 1000) * (imageH / 1000)
    const lux = areaM2 > 0 ? lumens / areaM2 : 0
    return { imageW, imageH, needW, needH, covOk, pxPerMm, lux }
  }, [hMm, throwRatio, pAspect, pResW, lumens, L, W])

  const cam = useMemo(() => {
    const a = ASPECTS[cAspect] ?? 16 / 9
    const fpW = 2 * hMm * Math.tan(((fov / 2) * Math.PI) / 180)
    const fpH = fpW / a
    const covOk = fpW >= L && fpH >= W
    const pxPerMm = fpW > 0 ? cResW / fpW : 0
    const pxPerBall = pxPerMm * BALL_D
    return { fpW, fpH, covOk, pxPerMm, pxPerBall }
  }, [hMm, fov, cAspect, cResW, L, W])

  const verdict: Verdict = useMemo(() => {
    if (tab === 'projector') {
      if (!proj.covOk) {
        const shortW = Math.max(0, proj.needW - proj.imageW)
        const shortH = Math.max(0, proj.needH - proj.imageH)
        const parts: string[] = []
        if (shortW > 0) parts.push(`image is ${fmtLen(shortW, units)} too narrow along the table length`)
        if (shortH > 0) parts.push(`image is ${fmtLen(shortH, units)} too short across the table width`)
        parts.push('raise the mount, or use a shorter throw ratio')
        return { state: 'red', title: "This setup won't work", details: parts }
      }
      const caveats: string[] = []
      if (proj.pxPerMm < 0.5) caveats.push(`resolution is marginal: ${fmtDensity(proj.pxPerMm, units)} — fine lines will look soft`)
      if (proj.lux < 350) caveats.push(`brightness is low: ~${Math.round(proj.lux)} lux on the table — dim the room lights`)
      if (throwRatio <= 0.45 || throwRatio >= 2.4) caveats.push('throw ratio is at the edge of the slider range — double-check the projector spec')
      if (caveats.length > 0) return { state: 'amber', title: 'Will work with caveats', details: caveats }
      return {
        state: 'green',
        title: 'This setup works',
        details: [`${fmtDim(proj.imageW, proj.imageH, units)} image · ${fmtDensity(proj.pxPerMm, units)} · ~${Math.round(proj.lux)} lux`],
      }
    }
    // camera
    if (!cam.covOk) {
      const shortW = Math.max(0, L - cam.fpW)
      const shortH = Math.max(0, W - cam.fpH)
      const parts: string[] = []
      if (shortW > 0) parts.push(`footprint is ${fmtLen(shortW, units)} short along the table length`)
      if (shortH > 0) parts.push(`footprint is ${fmtLen(shortH, units)} short across the table width`)
      parts.push('raise the mount or use a wider FOV')
      return { state: 'red', title: "This setup won't work", details: parts }
    }
    const caveats: string[] = []
    if (cam.pxPerMm < 0.35)
      caveats.push(`only ${fmtDensity(cam.pxPerMm, units)} (${Math.round(cam.pxPerBall)} px per ball) — below the ${fmtDensity(0.35, units)} (20 px/ball) detection floor; use a higher resolution or lower mount`)
    else if (cam.pxPerMm < 0.5)
      caveats.push(`${fmtDensity(cam.pxPerMm, units)} (${Math.round(cam.pxPerBall)} px per ball) is workable but marginal for clean detection`)
    if (fov >= 105) caveats.push('very wide FOV — expect lens distortion at the rails; calibrate carefully')
    if (caveats.length > 0) return { state: 'amber', title: 'Will work with caveats', details: caveats }
    return {
      state: 'green',
      title: 'This setup works',
      details: [`${fmtDim(cam.fpW, cam.fpH, units)} footprint · ${fmtDensity(cam.pxPerMm, units)} · ${Math.round(cam.pxPerBall)} px per ball`],
    }
  }, [tab, proj, cam, throwRatio, fov, L, W, units])

  const footprintW = tab === 'projector' ? proj.imageW : cam.fpW

  return (
    <div>
      <h1 className="page-title">Hardware planner</h1>
      <p className="page-sub">Will your projector and camera cover the table from your ceiling height?</p>

      <div className="seg mb16">
        <button className={tab === 'projector' ? 'on' : ''} onClick={() => setTab('projector')}>
          Projector
        </button>
        <button className={tab === 'camera' ? 'on' : ''} onClick={() => setTab('camera')}>
          Camera
        </button>
      </div>

      <div className="hw-layout">
        <div>
          <div className="card">
            <div className="microlabel card-title">Mount</div>
            <div className="formrow">
              <span className="microlabel">Table size</span>
              <select className="field" value={tableSize} onChange={(e) => setTableSize(e.target.value)}>
                {Object.entries(TABLE_PRESETS).map(([key, d]) => (
                  <option key={key} value={key}>
                    {key} — {fmtDim(d.L, d.W, units)}
                  </option>
                ))}
              </select>
            </div>
            <div className="slider-row">
              <div className="top">
                <span className="microlabel">Height above table</span>
                <span className="valtext">{fmtHeight(hMm, units)}</span>
              </div>
              <input type="range" min={0.5} max={3} step={0.05} value={mountH} onChange={(e) => setMountH(Number(e.target.value))} />
            </div>
          </div>

          {tab === 'projector' ? (
            <div className="card">
              <div className="microlabel card-title">Projector</div>
              <div className="slider-row">
                <div className="top">
                  <span className="microlabel">Throw ratio</span>
                  <span className="valtext">{throwRatio.toFixed(2)}</span>
                </div>
                <input type="range" min={0.4} max={2.5} step={0.01} value={throwRatio} onChange={(e) => setThrowRatio(Number(e.target.value))} />
              </div>
              <div className="formrow">
                <span className="microlabel">Aspect</span>
                <div className="seg">
                  {Object.keys(ASPECTS).map((a) => (
                    <button key={a} className={pAspect === a ? 'on' : ''} onClick={() => setPAspect(a)}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <div className="formrow">
                <span className="microlabel">Native resolution width (px)</span>
                <input className="field" type="number" value={pResW} onChange={(e) => setPResW(Math.max(1, Number(e.target.value) || 1))} />
              </div>
              <div className="formrow" style={{ marginBottom: 0 }}>
                <span className="microlabel">Brightness (ANSI lumens)</span>
                <input className="field" type="number" value={lumens} onChange={(e) => setLumens(Math.max(1, Number(e.target.value) || 1))} />
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="microlabel card-title">Camera</div>
              <div className="slider-row">
                <div className="top">
                  <span className="microlabel">Horizontal FOV</span>
                  <span className="valtext">{fov.toFixed(1)}°</span>
                </div>
                <input type="range" min={40} max={120} step={0.5} value={fov} onChange={(e) => setFov(Number(e.target.value))} />
              </div>
              <div className="formrow">
                <span className="microlabel">Aspect</span>
                <div className="seg">
                  {Object.keys(ASPECTS).map((a) => (
                    <button key={a} className={cAspect === a ? 'on' : ''} onClick={() => setCAspect(a)}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <div className="formrow" style={{ marginBottom: 0 }}>
                <span className="microlabel">Resolution width (px)</span>
                <input className="field" type="number" value={cResW} onChange={(e) => setCResW(Math.max(1, Number(e.target.value) || 1))} />
              </div>
            </div>
          )}

          <div className="card">
            <div className="microlabel card-title">Reference {tab === 'projector' ? 'projectors' : 'cameras'} (typical specs)</div>
            {tab === 'projector'
              ? PROJECTORS.map((p) => (
                  <button
                    key={p.name}
                    className="ref-item"
                    onClick={() => {
                      setThrowRatio(p.throw)
                      setLumens(p.lumens)
                      setPResW(p.resW)
                      setPAspect(p.aspect)
                    }}
                  >
                    <span>{p.name}</span>
                    <span className="spec">{p.throw.toFixed(2)} · {p.lumens} lm</span>
                  </button>
                ))
              : CAMERAS.map((c) => (
                  <button
                    key={c.name}
                    className="ref-item"
                    onClick={() => {
                      setFov(c.fov)
                      setCResW(c.resW)
                      setCAspect(c.aspect)
                    }}
                  >
                    <span>{c.name}</span>
                    <span className="spec">{c.fov}° · {c.resW}px</span>
                  </button>
                ))}
          </div>
        </div>

        <div>
          <div className={`banner mb16 ${verdict.state === 'green' ? 'ok' : verdict.state === 'amber' ? 'warn' : 'bad'}`}>
            <strong style={{ fontSize: 15 }}>{verdict.title}</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {verdict.details.map((d, i) => (
                <li key={i} style={{ fontSize: 13 }}>
                  {d}
                </li>
              ))}
            </ul>
          </div>

          <div className="card mb16">
            <div className="microlabel card-title">Side view</div>
            <SideView L={L} hMm={hMm} footprintW={footprintW} kind={tab} units={units} />
          </div>

          <div className="card">
            <div className="microlabel card-title">Numbers</div>
            {tab === 'projector' ? (
              <>
                <div className="kv"><span>Image at table</span><span className="v">{fmtDim(proj.imageW, proj.imageH, units)}</span></div>
                <div className="kv"><span>Required (surface + {fmtLen(MARGIN_MM, units, 0)} margin)</span><span className="v">{fmtDim(proj.needW, proj.needH, units)}</span></div>
                <div className="kv"><span>Coverage</span><span className="v">{proj.covOk ? 'covers table' : 'DOES NOT COVER'}</span></div>
                <div className="kv"><span>Projection density</span><span className="v">{fmtDensity(proj.pxPerMm, units)}</span></div>
                <div className="kv"><span>Illuminance on table (rough)</span><span className="v">~{Math.round(proj.lux)} lux</span></div>
              </>
            ) : (
              <>
                <div className="kv"><span>Footprint at table</span><span className="v">{fmtDim(cam.fpW, cam.fpH, units)}</span></div>
                <div className="kv"><span>Playing surface</span><span className="v">{fmtDim(L, W, units)}</span></div>
                <div className="kv"><span>Coverage</span><span className="v">{cam.covOk ? 'covers table' : 'DOES NOT COVER'}</span></div>
                <div className="kv"><span>Detection density</span><span className="v">{fmtDensity(cam.pxPerMm, units)}</span></div>
                <div className="kv"><span>Pixels per ball (⌀{fmtLen(BALL_D, units, 2)}, want ≥ 20)</span><span className="v">{Math.round(cam.pxPerBall)} px</span></div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SideView({ L, hMm, footprintW, kind, units }: { L: number; hMm: number; footprintW: number; kind: 'projector' | 'camera'; units: Units }) {
  const vw = 720
  const vh = 340
  const surfaceY = 260
  const cx = vw / 2
  const s = Math.min(600 / Math.max(L + 300, footprintW + 200), 200 / Math.max(hMm, 600))
  const tableHalf = (L / 2) * s
  const fpHalf = (footprintW / 2) * s
  const mountY = surfaceY - hMm * s
  const cone = kind === 'projector' ? '#8b5cf6' : '#34d399'

  return (
    <svg viewBox={`0 0 ${vw} ${vh}`} style={{ width: '100%', display: 'block' }}>
      {/* coverage cone */}
      <polygon
        points={`${cx},${mountY} ${cx - fpHalf},${surfaceY} ${cx + fpHalf},${surfaceY}`}
        fill={kind === 'projector' ? 'rgba(139,92,246,0.13)' : 'rgba(52,211,153,0.10)'}
        stroke={cone}
        strokeWidth={1.5}
        strokeDasharray="5 4"
      />
      {/* coverage line on the surface */}
      <line x1={cx - fpHalf} y1={surfaceY} x2={cx + fpHalf} y2={surfaceY} stroke={cone} strokeWidth={4} />
      {/* table cross-section */}
      <rect x={cx - tableHalf} y={surfaceY} width={tableHalf * 2} height={16} fill="#2273c9" />
      <rect x={cx - tableHalf - 12} y={surfaceY} width={12} height={20} fill="#33231a" />
      <rect x={cx + tableHalf} y={surfaceY} width={12} height={20} fill="#33231a" />
      <rect x={cx - tableHalf - 4} y={surfaceY + 16} width={14} height={54} fill="#33231a" />
      <rect x={cx + tableHalf - 10} y={surfaceY + 16} width={14} height={54} fill="#33231a" />
      {/* mount */}
      <line x1={cx} y1={mountY - 26} x2={cx} y2={mountY} stroke="#8b8b98" strokeWidth={2} />
      <rect x={cx - 16} y={mountY - 12} width={32} height={14} rx={3} fill="#e8e8ef" />
      {/* height annotation */}
      <line x1={cx - tableHalf - 44} y1={mountY} x2={cx - tableHalf - 44} y2={surfaceY} stroke="#8b8b98" strokeWidth={1} strokeDasharray="3 4" />
      <text x={cx - tableHalf - 52} y={(mountY + surfaceY) / 2} fill="#8b8b98" fontSize={12} fontFamily="ui-monospace, monospace" textAnchor="end" dominantBaseline="central">
        {units === 'metric' ? `${(hMm / 1000).toFixed(2)}m` : fmtFeetIn(hMm)}
      </text>
      {/* footprint annotation */}
      <text x={cx} y={surfaceY + 96} fill="#8b8b98" fontSize={12} fontFamily="ui-monospace, monospace" textAnchor="middle">
        {kind === 'projector' ? 'image' : 'footprint'} {fmtLen(footprintW, units, 0)} · table {fmtLen(L, units, 0)}
      </text>
    </svg>
  )
}
