import type { Contour, Easing, Outline, P } from '../types'
import { arcSweep, contourArea, segLength } from '../geometry/outline'

/**
 * Морфинг контуров. Каждый контур сэмплируется в кольцо из RING_N точек (вершины
 * углов сохраняются), кольца двух форм попарно сопоставляются (лишние стягиваются
 * в точку / вырастают из точки), начало колец выравнивается, затем — линейная
 * интерполяция точек. Промежуточные кадры — ломаные; в конце показывается точный контур с дугами.
 */

export type Ring = P[]
export const RING_N = 192

const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const d2 = (a: P, b: P) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2

function pointOnSeg(s: Contour[number], f: number): P {
  if (s.t === 'L') return lerp(s.a, s.b, f)
  const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x) + arcSweep(s) * f
  return { x: s.c.x + s.r * Math.cos(a0), y: s.c.y + s.r * Math.sin(a0) }
}

/** Кольцо из n точек по длине контура; каждая вершина (начало сегмента) попадает в кольцо. */
export function sampleContour(c: Contour, n = RING_N): Ring {
  const lens = c.map(segLength)
  const total = lens.reduce((a, b) => a + b, 0) || 1
  const counts = lens.map((l) => Math.max(1, Math.round((n * l) / total)))
  // подгоняем сумму к n за счёт самых длинных сегментов
  let diff = n - counts.reduce((a, b) => a + b, 0)
  const order = lens.map((l, i) => [l, i] as const).sort((x, y) => y[0] - x[0])
  for (let k = 0; diff !== 0 && k < 10 * n; k++) {
    const i = order[k % order.length][1]
    if (diff > 0) {
      counts[i]++
      diff--
    } else if (counts[i] > 1) {
      counts[i]--
      diff++
    }
  }
  const ring: Ring = []
  c.forEach((s, i) => {
    for (let j = 0; j < counts[i]; j++) ring.push(pointOnSeg(s, j / counts[i]))
  })
  return ring.slice(0, n)
}

export const ringArea = (r: Ring) => {
  let a = 0
  for (let i = 0; i < r.length; i++) {
    const p = r[i],
      q = r[(i + 1) % r.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}
const centroid = (r: Ring): P => ({ x: r.reduce((s, p) => s + p.x, 0) / r.length, y: r.reduce((s, p) => s + p.y, 0) / r.length })

export function outlineToRings(o: Outline, n = RING_N): Ring[] {
  return o.filter((c) => c.length && Math.abs(contourArea(c)) > 1e-9).map((c) => sampleContour(c, n))
}

/** Сдвиг начала кольца b, при котором точки ближе всего к кольцу a. */
function align(a: Ring, b: Ring): Ring {
  const n = b.length
  let best = 0,
    bestCost = Infinity
  for (let k = 0; k < n; k++) {
    let cost = 0
    for (let i = 0; i < n && cost < bestCost; i++) cost += d2(a[i], b[(i + k) % n])
    if (cost < bestCost) {
      bestCost = cost
      best = k
    }
  }
  return b.map((_, i) => b[(i + best) % n])
}

function nearestPoint(rings: Ring[], to: P): P {
  let best = to,
    bd = Infinity
  for (const r of rings)
    for (const p of r) {
      const d = d2(p, to)
      if (d < bd) {
        bd = d
        best = p
      }
    }
  return best
}

const pointRing = (p: P, n: number): Ring => Array.from({ length: n }, () => ({ ...p }))

/** Пары колец одной группы (внешние или дырки); лишние кольца стягиваются в ближайшую точку другой формы. */
function matchGroup(from: Ring[], to: Ring[], n: number): [Ring, Ring][] {
  const cost: [number, number, number][] = []
  from.forEach((a, i) => to.forEach((b, j) => cost.push([d2(centroid(a), centroid(b)), i, j])))
  cost.sort((x, y) => x[0] - y[0])
  const usedA = new Set<number>(),
    usedB = new Set<number>()
  const pairs: [Ring, Ring][] = []
  for (const [, i, j] of cost) {
    if (usedA.has(i) || usedB.has(j)) continue
    usedA.add(i)
    usedB.add(j)
    pairs.push([from[i], align(from[i], to[j])])
  }
  from.forEach((a, i) => {
    if (usedA.has(i)) return
    const target = to.length ? nearestPoint(to, centroid(a)) : centroid(a)
    pairs.push([a, pointRing(target, n)])
  })
  to.forEach((b, j) => {
    if (usedB.has(j)) return
    const source = from.length ? nearestPoint(from, centroid(b)) : centroid(b)
    pairs.push([pointRing(source, n), b])
  })
  return pairs
}

/** Сопоставляет кольца двух форм; внешние контуры — с внешними, дырки — с дырками. */
export function matchRings(from: Ring[], to: Ring[], n = RING_N): [Ring, Ring][] {
  const outer = (rs: Ring[]) => rs.filter((r) => ringArea(r) >= 0)
  const holes = (rs: Ring[]) => rs.filter((r) => ringArea(r) < 0)
  return [...matchGroup(outer(from), outer(to), n), ...matchGroup(holes(from), holes(to), n)]
}

export function lerpRings(pairs: [Ring, Ring][], t: number): Ring[] {
  return pairs.map(([a, b]) => a.map((p, i) => lerp(p, b[i], t)))
}

/** Кольца → Outline из отрезков (для SVG и 3D); вырожденные кольца отбрасываются. */
export function ringsToOutline(rings: Ring[]): Outline {
  return rings
    .filter((r) => Math.abs(ringArea(r)) > 1e-6)
    .map((r) => r.map((p, i) => ({ t: 'L' as const, a: p, b: r[(i + 1) % r.length] })))
}

export const EASINGS: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  expoOut: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  backOut: (t) => {
    const c1 = 1.70158,
      c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
  },
}
