// Plane homography via the standard 8x8 DLT linear system, solved with
// Gaussian elimination (partial pivoting). No dependencies.
//
// solveHomography(src, dst) returns row-major 3x3 H with h33 = 1 such that
//   [x', y', w']^T = H · [x, y, 1]^T,  point' = (x'/w', y'/w')
// Identity check: src === dst yields the identity matrix, and
// homographyToMatrix3d(identity) is the identity matrix3d.

export type Pt = [number, number]
export type Mat3 = number[][] // row-major 3x3

/** Solve the n×n linear system A·x = b via Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length
  // augmented working copy
  const M: number[][] = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    // partial pivot
    let piv = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    }
    if (Math.abs(M[piv][col]) < 1e-12) {
      throw new Error('Degenerate homography: singular linear system')
    }
    if (piv !== col) {
      const tmp = M[col]
      M[col] = M[piv]
      M[piv] = tmp
    }
    const pivot = M[col][col]
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / pivot
      if (f === 0) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  // back substitution
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r][n]
    for (let c = r + 1; c < n; c++) sum -= M[r][c] * x[c]
    x[r] = sum / M[r][r]
  }
  return x
}

/** Homography mapping four src points onto four dst points. */
export function solveHomography(src: Pt[], dst: Pt[]): Mat3 {
  if (src.length !== 4 || dst.length !== 4) throw new Error('solveHomography needs exactly 4 point pairs')
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]
    const [X, Y] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X])
    b.push(X)
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y])
    b.push(Y)
  }
  const h = solveLinear(A, b)
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ]
}

/** Apply homography H to a point. */
export function applyH(H: Mat3, pt: Pt): Pt {
  const [x, y] = pt
  const w = H[2][0] * x + H[2][1] * y + H[2][2]
  const X = (H[0][0] * x + H[0][1] * y + H[0][2]) / w
  const Y = (H[1][0] * x + H[1][1] * y + H[1][2]) / w
  return [X, Y]
}

/**
 * Convert a 3x3 homography into a CSS matrix3d() string.
 * Embeds H into a 4x4 (z passes through), emitted column-major as CSS expects.
 * Requires transform-origin: 0 0 on the element.
 */
export function homographyToMatrix3d(H: Mat3): string {
  const m = [
    H[0][0], H[1][0], 0, H[2][0], // column 1
    H[0][1], H[1][1], 0, H[2][1], // column 2
    0, 0, 1, 0, //                   column 3
    H[0][2], H[1][2], 0, H[2][2], // column 4
  ]
  return `matrix3d(${m.map((v) => (Math.abs(v) < 1e-12 ? 0 : v)).join(',')})`
}

/**
 * matrix3d that warps a w×h element (top-left origin) onto four destination
 * corners in order tl, tr, br, bl.
 */
export function cornersToMatrix3d(w: number, h: number, corners: Pt[]): string {
  const H = solveHomography(
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
    corners,
  )
  return homographyToMatrix3d(H)
}
