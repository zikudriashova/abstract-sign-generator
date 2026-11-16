import * as THREE from 'three'
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Contour, Outline } from '../types'
import { arcSweep, contourArea, outlineBBox, segLength } from '../geometry/outline'

/** Контур → THREE.Path; дуги остаются дугами (absarc), а не ломаными. */
function pathOf<T extends THREE.Path>(path: T, c: Contour): T {
  path.moveTo(c[0].a.x, c[0].a.y)
  for (const s of c) {
    if (s.t === 'L') path.lineTo(s.b.x, s.b.y)
    else {
      const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x)
      path.absarc(s.c.x, s.c.y, s.r, a0, a0 + arcSweep(s), !s.ccw)
    }
  }
  path.closePath()
  return path
}

/** Внешний контур и его дырки (дырка отдаётся самому маленькому внешнему контуру, в bbox которого лежит). */
function groupContours(o: Outline): { outer: Contour; holes: Contour[] }[] {
  const outers = o.filter((c) => contourArea(c) > 0)
  const groups = outers.map((outer) => ({ outer, holes: [] as Contour[] }))
  const boxes = outers.map((c) => outlineBBox([c]))
  for (const h of o.filter((c) => contourArea(c) < 0)) {
    const hb = outlineBBox([h])
    let best = -1
    boxes.forEach((b, i) => {
      if (hb.x0 >= b.x0 - 1e-9 && hb.y0 >= b.y0 - 1e-9 && hb.x1 <= b.x1 + 1e-9 && hb.y1 <= b.y1 + 1e-9)
        if (best < 0 || contourArea(outers[i]) < contourArea(outers[best])) best = i
    })
    if (best >= 0) groups[best].holes.push(h)
  }
  return groups
}

const shapeOf = (g: { outer: Contour; holes: Contour[] }) => {
  const shape = pathOf(new THREE.Shape(), g.outer)
  for (const h of g.holes) shape.holes.push(pathOf(new THREE.Path(), h))
  return shape
}

/** Outline → набор Shape. Это единственный вход 3D: контуры те же, что идут в SVG. */
export function outlineToShapes(o: Outline): THREE.Shape[] {
  return groupContours(o).map(shapeOf)
}

/** Оценка вписанного радиуса части: 2·площадь / периметр (точна для описанных многоугольников). */
export function inradius(g: { outer: Contour; holes: Contour[] }): number {
  const area = contourArea(g.outer) + g.holes.reduce((s, h) => s + contourArea(h), 0)
  const perimeter = [g.outer, ...g.holes].reduce((s, c) => s + c.reduce((t, seg) => t + segLength(seg), 0), 0)
  return perimeter > 0 ? (2 * area) / perimeter : 0
}

/** Изломы круче этого угла — углы контура, их вершины всегда сохраняются. */
const CORNER_ANGLE = (20 * Math.PI) / 180
/** Изломы положе этого — точка лежит на прямой и ничего не добавляет. */
const FLAT_ANGLE = (0.5 * Math.PI) / 180

/**
 * Упрощает ломаный контур перед экструзией с фаской. Кадры морфинга состоят из
 * сотен точек; точки, стоящие у угла ближе размера фаски, при смещении внутрь
 * перехлёстываются через угол, и фаска складывается «шипами». Углы сохраняются,
 * между ними остаются точки не чаще шага spacing. Контуры с дугами не трогаем.
 */
export function simplifyForBevel(c: Contour, spacing: number): Contour {
  if (c.some((s) => s.t !== 'L') || c.length < 4) return c
  const pts = c.map((s) => s.a)
  const n = pts.length
  const turn = (i: number) => {
    const a = pts[(i - 1 + n) % n],
      p = pts[i],
      b = pts[(i + 1) % n]
    const ux = p.x - a.x,
      uy = p.y - a.y,
      vx = b.x - p.x,
      vy = b.y - p.y
    return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy))
  }
  const corners = pts.map((_, i) => turn(i) > CORNER_ANGLE)
  if (!corners.some(Boolean)) corners[0] = true // гладкий контур: опорная точка — первая
  const start = corners.indexOf(true)
  const kept: typeof pts = []
  const d = (p: (typeof pts)[number], q: (typeof pts)[number]) => Math.hypot(p.x - q.x, p.y - q.y)
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n
    if (corners[i]) {
      kept.push(pts[i])
      continue
    }
    // следующий угол по ходу обхода
    let j = (i + 1) % n
    while (!corners[j]) j = (j + 1) % n
    if (turn(i) > FLAT_ANGLE && d(pts[i], kept[kept.length - 1]) >= spacing && d(pts[i], pts[j]) >= spacing) kept.push(pts[i])
  }
  if (kept.length < 3) return c
  return kept.map((a, i) => ({ t: 'L' as const, a, b: kept[(i + 1) % kept.length] }))
}

export interface ExtrudeOpts {
  depth: number
  bevel: number
  bevelSegments: number
}

/** Часть не глубже DEPTH_PER_INRADIUS вписанных радиусов: самая мелкая статичная часть (квадрат ⅓ Q) не упирается в предел при глубине до N. */
export const DEPTH_PER_INRADIUS = 6
/** Фаска не больше этой доли вписанного радиуса, иначе отрицательный отступ выворачивает её. */
export const BEVEL_PER_INRADIUS = 0.45
/** Порог сглаживания нормалей: изломы круче — острые рёбра, положе — гладкая поверхность. */
const CREASE_ANGLE = (35 * Math.PI) / 180

/**
 * Экструзия с фаской, отдельно для каждой части контура. bevelOffset = −bevelSize
 * втягивает фаску внутрь, поэтому внешний габарит остаётся равным контуру на сетке.
 * Глубина и фаска части ограничены её размером: части, которые при морфинге
 * стягиваются в точку, уменьшаются во всех трёх измерениях, а фаска не выворачивается.
 * Нормали сглаживаются по углу излома: дуги и ломаные кадров морфинга выглядят гладкими.
 */
export function extrudeOutline(o: Outline, { depth, bevel, bevelSegments }: ExtrudeOpts): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (const g of groupContours(o)) {
    const r = inradius(g)
    if (r < 1e-3) continue
    const d = Math.max(0.01, Math.min(depth, DEPTH_PER_INRADIUS * r))
    const b = Math.min(bevel, d / 2, BEVEL_PER_INRADIUS * r)
    const spacing = Math.max(0.02, b * 1.1)
    const clean = { outer: simplifyForBevel(g.outer, spacing), holes: g.holes.map((h) => simplifyForBevel(h, spacing)) }
    const geo = new THREE.ExtrudeGeometry(shapeOf(clean), {
      depth: Math.max(0.005, d - 2 * b),
      bevelEnabled: b > 1e-6 && bevelSegments > 0,
      bevelThickness: b,
      bevelSize: b,
      bevelOffset: -b,
      bevelSegments,
      curveSegments: 32,
    })
    geo.translate(0, 0, -Math.max(0.005, d - 2 * b) / 2)
    parts.push(geo)
  }
  if (!parts.length) return new THREE.BufferGeometry()
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)
  return toCreasedNormals(merged, CREASE_ANGLE)
}
