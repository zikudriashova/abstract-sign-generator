import type { Contour, Outline, P, Rounding, Seg } from '../types'
import { dist, endTangent, segLength, startTangent } from './outline'

type A = Extract<Seg, { t: 'A' }>
type L = Extract<Seg, { t: 'L' }>

interface Fillet {
  c: P
  ta: P
  tb: P
  trimA: number
  trimB: number
}

const sub = (p: P, q: P): P => ({ x: p.x - q.x, y: p.y - q.y })
const dot = (p: P, q: P) => p.x * q.x + p.y * q.y
const cross = (p: P, q: P) => p.x * q.y - p.y * q.x

/** Смещённая "опорная кривая" элемента: прямая (точка + направление) или окружность. */
type Off = { kind: 'line'; p: P; d: P } | { kind: 'circle'; c: P; r: number }

function offsetOf(s: Seg, side: number, r: number): Off | null {
  if (s.t === 'L') {
    const d = startTangent(s)
    const n = { x: -d.y * side * r, y: d.x * side * r }
    return { kind: 'line', p: { x: s.a.x + n.x, y: s.a.y + n.y }, d }
  }
  // слева у дуги против часовой — центр; у дуги по часовой — наружу
  const R = s.r + side * r * (s.ccw ? -1 : 1)
  return R > 1e-9 ? { kind: 'circle', c: s.c, r: R } : null
}

function intersect(o1: Off, o2: Off, near: P): P | null {
  if (o1.kind === 'line' && o2.kind === 'line') {
    const den = cross(o1.d, o2.d)
    if (Math.abs(den) < 1e-12) return null
    const t = cross(sub(o2.p, o1.p), o2.d) / den
    return { x: o1.p.x + o1.d.x * t, y: o1.p.y + o1.d.y * t }
  }
  if (o1.kind === 'circle' && o2.kind === 'circle') return null // дуга–дуга не скругляем
  const line = (o1.kind === 'line' ? o1 : o2) as Extract<Off, { kind: 'line' }>
  const circ = (o1.kind === 'circle' ? o1 : o2) as Extract<Off, { kind: 'circle' }>
  const w = sub(line.p, circ.c)
  const b = dot(w, line.d)
  const disc = b * b - (dot(w, w) - circ.r * circ.r)
  if (disc < 0) return null
  const sq = Math.sqrt(disc)
  const cands = [-b - sq, -b + sq].map((t) => ({ x: line.p.x + line.d.x * t, y: line.p.y + line.d.y * t }))
  return dist(cands[0], near) <= dist(cands[1], near) ? cands[0] : cands[1]
}

function tangentPoint(s: Seg, c: P): P {
  if (s.t === 'L') {
    const d = startTangent(s)
    const k = dot(sub(c, s.a), d)
    return { x: s.a.x + d.x * k, y: s.a.y + d.y * k }
  }
  const v = sub(c, s.c)
  const l = Math.hypot(v.x, v.y) || 1
  return { x: s.c.x + (v.x / l) * s.r, y: s.c.y + (v.y / l) * s.r }
}

/** Длина участка, который скругление "съедает" у сегмента. null — геометрия невозможна. */
function trimLen(s: Seg, tp: P, vertex: P, atEnd: boolean): number | null {
  if (s.t === 'L') {
    const d = startTangent(s)
    const k = dot(sub(vertex, tp), d) * (atEnd ? 1 : -1)
    return k >= -1e-9 ? Math.abs(k) : null
  }
  const aT = Math.atan2(tp.y - s.c.y, tp.x - s.c.x)
  const aV = Math.atan2(vertex.y - s.c.y, vertex.x - s.c.x)
  const TAU = Math.PI * 2
  const dir = s.ccw ? 1 : -1
  let ang = atEnd ? (aV - aT) * dir : (aT - aV) * dir
  ang = ((ang % TAU) + TAU) % TAU
  if (ang > Math.PI + 1e-9) return null
  return ang * s.r
}

function computeFillet(sa: Seg, sb: Seg, convex: boolean, r: number): Fillet | null {
  const side = convex ? 1 : -1
  const vertex = sa.b
  const oa = offsetOf(sa, side, r)
  const ob = offsetOf(sb, side, r)
  if (!oa || !ob) return null
  const c = intersect(oa, ob, vertex)
  if (!c) return null
  const ta = tangentPoint(sa, c)
  const tb = tangentPoint(sb, c)
  const trimA = trimLen(sa, ta, vertex, true)
  const trimB = trimLen(sb, tb, vertex, false)
  if (trimA === null || trimB === null) return null
  return { c, ta, tb, trimA, trimB }
}

function filletContour(segs: Seg[], rounding: Rounding): Seg[] {
  const n = segs.length
  if (n < 2) return segs
  const lens = segs.map(segLength)
  // тип угла и запрошенный радиус на стыке i (между сегментом i и i+1)
  const want: number[] = new Array(n).fill(0)
  const convexAt: boolean[] = new Array(n).fill(false)
  for (let i = 0; i < n; i++) {
    const sa = segs[i],
      sb = segs[(i + 1) % n]
    const tin = endTangent(sa),
      tout = startTangent(sb)
    const cr = cross(tin, tout)
    if (Math.abs(cr) < 1e-9 && dot(tin, tout) > 0) continue // гладкий стык
    const convex = cr > 0
    convexAt[i] = convex
    const atOrigin = Math.abs(sa.b.x) < 1e-6 && Math.abs(sa.b.y) < 1e-6
    want[i] = convex ? (atOrigin ? rounding.origin : rounding.convex) : rounding.concave
  }
  const rad = want.slice()
  const calc = (i: number, r: number) =>
    r > 1e-9 ? computeFillet(segs[i], segs[(i + 1) % n], convexAt[i], r) : null

  // радиусы урезаем, пока суммарный съём не помещается в длину сегмента
  for (let iter = 0; iter < 8; iter++) {
    const trims: number[] = new Array(n).fill(0)
    const res = rad.map((r, i) => calc(i, r))
    res.forEach((f, i) => {
      if (!f) return
      trims[i] += f.trimA
      trims[(i + 1) % n] += f.trimB
    })
    let changed = false
    for (let j = 0; j < n; j++) {
      if (trims[j] > lens[j] + 1e-9) {
        const k = (lens[j] / trims[j]) * 0.999
        const prev = (j - 1 + n) % n
        if (rad[j] > 0) rad[j] *= k
        if (rad[prev] > 0) rad[prev] *= k
        changed = true
      }
    }
    if (!changed) break
  }
  // невозможные скругления (например дуга–дуга) остаются острыми
  const fil = rad.map((r, i) => calc(i, r))

  const out: Seg[] = []
  for (let j = 0; j < n; j++) {
    const prev = fil[(j - 1 + n) % n]
    const next = fil[j]
    const s = segs[j]
    const a = prev ? prev.tb : s.a
    const b = next ? next.ta : s.b
    if (dist(a, b) > 1e-9) {
      out.push(s.t === 'L' ? ({ t: 'L', a, b } as L) : ({ ...s, a, b } as A))
    }
    if (next) {
      out.push({
        t: 'A',
        a: next.ta,
        b: next.tb,
        c: next.c,
        r: dist(next.c, next.ta),
        ccw: convexAt[j],
      })
    }
  }
  return out
}

export function filletOutline(outline: Outline, rounding: Rounding): Outline {
  if (rounding.convex <= 0 && rounding.concave <= 0 && rounding.origin <= 0) return outline
  return outline.map((c: Contour) => filletContour(c, rounding))
}

