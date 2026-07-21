// Display-unit formatting. All internal math stays in millimeters (per
// CONTRACT.md); these helpers only change how values are shown. "standard"
// (US inches/feet) is the default, "metric" is the toggle.

export type Units = 'standard' | 'metric'

export const UNITS_KEY = 'cuelab.units'

export function loadUnits(): Units {
  return localStorage.getItem(UNITS_KEY) === 'metric' ? 'metric' : 'standard'
}

const MM_PER_IN = 25.4

export const mmToIn = (mm: number): number => mm / MM_PER_IN

/** Single length: 88.0″ | 2235 mm */
export function fmtLen(mm: number, units: Units, decimals = 1): string {
  if (units === 'metric') return `${Math.round(mm)} mm`
  return `${mmToIn(mm).toFixed(decimals)}″`
}

/** Dimension pair: 88″ × 44″ | 2235 × 1118 mm */
export function fmtDim(wMm: number, hMm: number, units: Units): string {
  if (units === 'metric') return `${Math.round(wMm)} × ${Math.round(hMm)} mm`
  return `${Math.round(mmToIn(wMm))}″ × ${Math.round(mmToIn(hMm))}″`
}

/** Feet-and-inches: 5′ 3″ */
export function fmtFeetIn(mm: number): string {
  const totalIn = Math.round(mmToIn(mm))
  const ft = Math.floor(totalIn / 12)
  const inch = totalIn % 12
  if (ft <= 0) return `${inch}″`
  return `${ft}′ ${inch}″`
}

/** Mount height, FusionCue style: 63″ (5′ 3″) · 160 cm  |  1.60 m · 63″ */
export function fmtHeight(mm: number, units: Units): string {
  const inches = Math.round(mmToIn(mm))
  const cm = Math.round(mm / 10)
  if (units === 'metric') return `${(mm / 1000).toFixed(2)} m · ${inches}″`
  return `${inches}″ (${fmtFeetIn(mm)}) · ${cm} cm`
}

/** Ball/target speed: 4.2 mph | 1.9 m/s */
export function fmtSpeed(mmPerS: number, units: Units): string {
  if (units === 'metric') return `${(mmPerS / 1000).toFixed(1)} m/s`
  return `${(mmPerS * 0.00223694).toFixed(1)} mph`
}

/** Pixel density: 30.5 px/in | 1.20 px/mm */
export function fmtDensity(pxPerMm: number, units: Units): string {
  if (units === 'metric') return `${pxPerMm.toFixed(2)} px/mm`
  return `${(pxPerMm * MM_PER_IN).toFixed(1)} px/in`
}

/** Small offsets like calibration errors: 0.7 mm stays useful, standard shows 0.03″ */
export function fmtOffset(mm: number, units: Units): string {
  if (units === 'metric') return `${mm.toFixed(1)} mm`
  return `${mmToIn(mm).toFixed(2)}″`
}
