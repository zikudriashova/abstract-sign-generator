import type { Contour, Outline, P, Seg } from '../types'

export const EPS = 1e-7

export const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y)

/** Знаковый угол дуги: > 0 против часовой. */
export function arcSweep(s: Extract<Seg, { t: 'A' }>): number {
  const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x)
  const a1 = Math.atan2(s.b.y - s.c.y, s.b.x - s.c.x)
  const TAU = Math.PI * 2
  let d = (((a1 - a0) % TAU) + TAU) % TAU
  if (!s.ccw) d = d - TAU
  if (Math.abs(d) < 1e-12) d = s.ccw ? TAU : -TAU
  return d
}

export function segLength(s: Seg): number {
  return s.t === 'L' ? dist(s.a, s.b) : Math.abs(arcSweep(s)) * s.r
}

export function arcMid(s: Extract<Seg, { t: 'A' }>): P {
  const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x)
  const m = a0 + arcSweep(s) / 2
  return { x: s.c.x + s.r * Math.cos(m), y: s.c.y + s.r * Math.sin(m) }
}

/** Знаковая площадь контура (точная, с дугами): > 0 для обхода против часовой. */
export function contourArea(c: Contour): number {
  let A = 0
  for (const s of c) {
    if (s.t === 'L') {
      A += 0.5 * (s.a.x * s.b.y - s.a.y * s.b.x)
    } else {
      const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x)
      const d = arcSweep(s)
      const a1 = a0 + d
      A +=
        0.5 *
        (s.r * s.r * d +
          s.r * s.c.x * (Math.sin(a1) - Math.sin(a0)) -
          s.r * s.c.y * (Math.cos(a1) - Math.cos(a0)))
    }
  }
  return A
}

export const outlineArea = (o: Outline) => o.reduce((s, c) => s + contourArea(c), 0)

export function reverseContour(c: Contour): Contour {
  return c
    .map((s): Seg => (s.t === 'L' ? { t: 'L', a: s.b, b: s.a } : { ...s, a: s.b, b: s.a, ccw: !s.ccw }))
    .reverse()
}

/** Направление касательной в начале / конце сегмента (единичный вектор). */
export function startTangent(s: Seg): P {
  if (s.t === 'L') return unit(s.b.x - s.a.x, s.b.y - s.a.y)
  const rx = s.a.x - s.c.x
  const ry = s.a.y - s.c.y
  return s.ccw ? unit(-ry, rx) : unit(ry, -rx)
}
export function endTangent(s: Seg): P {
  if (s.t === 'L') return startTangent(s)
  const rx = s.b.x - s.c.x
  const ry = s.b.y - s.c.y
  return s.ccw ? unit(-ry, rx) : unit(ry, -rx)
}
const unit = (x: number, y: number): P => {
  const l = Math.hypot(x, y) || 1
  return { x: x / l, y: y / l }
}

export function mapOutline(o: Outline, f: (p: P) => P, flip = false): Outline {
  return o.map((c) => {
    const m = c.map((s): Seg =>
      s.t === 'L'
        ? { t: 'L', a: f(s.a), b: f(s.b) }
        : { t: 'A', a: f(s.a), b: f(s.b), c: f(s.c), r: s.r, ccw: flip ? !s.ccw : s.ccw },
    )
    return flip ? reverseContour(m) : m
  })
}

/** Ограничивающий прямоугольник с учётом экстремумов дуг. */
export function outlineBBox(o: Outline) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  const add = (p: P) => {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  for (const c of o)
    for (const s of c) {
      add(s.a)
      add(s.b)
      if (s.t === 'A') {
        const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x)
        const d = arcSweep(s)
        for (let k = 0; k < 4; k++) {
          const ang = (k * Math.PI) / 2
          let rel = ((ang - a0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
          if (d < 0) rel = rel - Math.PI * 2
          if (rel * Math.sign(d) > 0 && Math.abs(rel) < Math.abs(d))
            add({ x: s.c.x + s.r * Math.cos(ang), y: s.c.y + s.r * Math.sin(ang) })
        }
      }
    }
  return { x0, y0, x1, y1 }
}
