import type { Contour, Outline, P, PieceId, Seg } from '../types'
import { arcSweep, contourArea, outlineBBox, segLength } from '../geometry/outline'
import { MAX_SEGMENTS, MAX_SVG_BYTES } from './limits'

/**
 * Импорт фигур из SVG. Файл не вставляется в страницу: из него читается только
 * геометрия залитых фигур (path, rect, circle, ellipse, polygon, polyline) с учётом
 * transform. Все кривые сводятся к кубическим Безье; те, что лежат на окружности,
 * становятся настоящими дугами, остальные дробятся на короткие отрезки.
 *
 * Режим «знак»: центр артборда (viewBox) — точка O, правая верхняя четверть —
 * верхняя деталь, левая нижняя — нижняя; квадрант = половина меньшей стороны.
 * Режим «деталь»: всё содержимое файла вписывается в квадрант по габариту.
 */

export type ImportResult =
  | { ok: true; top?: Outline; bottom?: Outline; warnings: string[] }
  | { ok: false; error: string }

type Mat = [number, number, number, number, number, number] // x' = a x + c y + e; y' = b x + d y + f
const ID: Mat = [1, 0, 0, 1, 0, 0]
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]
const apply = (m: Mat, p: P): P => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })

function parseTransform(str: string | null): Mat {
  let m = ID
  if (!str) return m
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  for (let r = re.exec(str); r; r = re.exec(str)) {
    const a = r[2].trim().split(/[\s,]+/).filter(Boolean).map(Number)
    let t: Mat = ID
    const rad = ((a[0] ?? 0) * Math.PI) / 180
    switch (r[1]) {
      case 'matrix':
        if (a.length === 6) t = a as Mat
        break
      case 'translate':
        t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]
        break
      case 'scale':
        t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]
        break
      case 'rotate': {
        const c = Math.cos(rad),
          s = Math.sin(rad)
        t = [c, s, -s, c, 0, 0]
        if (a.length >= 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]])
        break
      }
      case 'skewX':
        t = [1, 0, Math.tan(rad), 1, 0, 0]
        break
      case 'skewY':
        t = [1, Math.tan(rad), 0, 1, 0, 0]
        break
    }
    if (t.some((v) => !Number.isFinite(v))) continue
    m = mul(m, t)
  }
  return m
}

// ---------- path data → подпути из отрезков и кубических Безье ----------

type Item = { k: 'L'; p: P } | { k: 'C'; c1: P; c2: P; p: P }
interface Sub {
  start: P
  items: Item[]
}

/** Дуга SVG (endpoint-параметризация) → кубические Безье по ≤ 90°. */
function arcToCubics(p0: P, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, p1: P): Item[] {
  if (rx === 0 || ry === 0 || (p0.x === p1.x && p0.y === p1.y)) return [{ k: 'L', p: p1 }]
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const phi = (phiDeg * Math.PI) / 180
  const cp = Math.cos(phi),
    sp = Math.sin(phi)
  const dx = (p0.x - p1.x) / 2,
    dy = (p0.y - p1.y) / 2
  const x1 = cp * dx + sp * dy,
    y1 = -sp * dx + cp * dy
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lam > 1) {
    rx *= Math.sqrt(lam)
    ry *= Math.sqrt(lam)
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const cxp = (co * rx * y1) / ry,
    cyp = (-co * ry * x1) / rx
  const cx = cp * cxp - sp * cyp + (p0.x + p1.x) / 2,
    cy = sp * cxp + cp * cyp + (p0.y + p1.y) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
  let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  if (sweep && dt < 0) dt += 2 * Math.PI
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9))
  const step = dt / n
  const k = (4 / 3) * Math.tan(step / 4)
  const pt = (t: number): P => ({ x: cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, y: cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp })
  const der = (t: number): P => ({ x: -rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, y: -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp })
  const out: Item[] = []
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step,
      b = a + step
    const pa = i === 0 ? p0 : pt(a),
      pb = i === n - 1 ? p1 : pt(b)
    const da = der(a),
      db = der(b)
    out.push({ k: 'C', c1: { x: pa.x + k * da.x, y: pa.y + k * da.y }, c2: { x: pb.x - k * db.x, y: pb.y - k * db.y }, p: pb })
  }
  return out
}

export function parsePathData(d: string): Sub[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []
  const subs: Sub[] = []
  let i = 0
  let cur: P = { x: 0, y: 0 }
  let start: P = cur
  let sub: Sub | null = null
  let cmd = ''
  let lastCtrl: P | null = null // для S/T
  let lastCmd = ''
  const isNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])
  const n = () => Number(tokens[i++])
  const flag = () => {
    // флаги дуги могут идти слитно: «a1 1 0 01 10 10»
    const t = tokens[i]
    if (t.length > 1 && (t[0] === '0' || t[0] === '1') && !t.includes('.')) {
      tokens[i] = t.slice(1)
      return t[0] === '1'
    }
    i++
    return t === '1'
  }
  const begin = (p: P) => {
    sub = { start: p, items: [] }
    subs.push(sub)
    start = p
  }
  const ensure = () => {
    if (!sub) begin(cur)
    return sub!
  }
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++]
    else if (!cmd) {
      i++
      continue
    }
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    const off = (x: number, y: number): P => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y })
    if (C === 'Z') {
      if (sub) {
        cur = start
        sub = null
      }
      lastCtrl = null
      lastCmd = 'Z'
      continue
    }
    if (!isNum()) break
    if (C === 'M') {
      cur = off(n(), n())
      begin(cur)
      cmd = rel ? 'l' : 'L' // следующие пары — неявные lineto
    } else if (C === 'L') {
      cur = off(n(), n())
      ensure().items.push({ k: 'L', p: cur })
    } else if (C === 'H') {
      const x = n()
      cur = { x: rel ? cur.x + x : x, y: cur.y }
      ensure().items.push({ k: 'L', p: cur })
    } else if (C === 'V') {
      const y = n()
      cur = { x: cur.x, y: rel ? cur.y + y : y }
      ensure().items.push({ k: 'L', p: cur })
    } else if (C === 'C' || C === 'S') {
      let c1: P
      if (C === 'C') c1 = off(n(), n())
      else c1 = lastCtrl && /[CS]/.test(lastCmd) ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur
      const c2 = off(n(), n())
      const p = off(n(), n())
      ensure().items.push({ k: 'C', c1, c2, p })
      lastCtrl = c2
      cur = p
    } else if (C === 'Q' || C === 'T') {
      const q: P = C === 'Q' ? off(n(), n()) : lastCtrl && /[QT]/.test(lastCmd) ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur
      const p = off(n(), n())
      // квадратичная → кубическая
      const c1 = { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) }
      const c2 = { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }
      ensure().items.push({ k: 'C', c1, c2, p })
      lastCtrl = q
      cur = p
    } else if (C === 'A') {
      const rx = n(),
        ry = n(),
        phi = n()
      const large = flag(),
        sw = flag()
      const p = off(n(), n())
      ensure().items.push(...arcToCubics(cur, rx, ry, phi, large, sw, p))
      cur = p
    } else {
      i++
      continue
    }
    if (!/[CSQT]/.test(C)) lastCtrl = null
    lastCmd = C
  }
  return subs.filter((s) => s.items.length > 0)
}

// ---------- кубика → дуги и отрезки ----------

const bez = (v: P[], t: number): P => {
  const u = 1 - t
  return {
    x: u * u * u * v[0].x + 3 * u * u * t * v[1].x + 3 * u * t * t * v[2].x + t * t * t * v[3].x,
    y: u * u * u * v[0].y + 3 * u * u * t * v[1].y + 3 * u * t * t * v[2].y + t * t * t * v[3].y,
  }
}
const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const split = (v: P[]): [P[], P[]] => {
  const [p0, p1, p2, p3] = v
  const a = mid(p0, p1),
    b = mid(p1, p2),
    c = mid(p2, p3),
    ab = mid(a, b),
    bc = mid(b, c),
    m = mid(ab, bc)
  return [
    [p0, a, ab, m],
    [m, bc, c, p3],
  ]
}
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y)
const lineDist = (p: P, a: P, b: P) => {
  const l = dist(a, b)
  if (l < 1e-12) return dist(p, a)
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / l
}
function circumcircle(a: P, b: P, c: P): { c: P; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < 1e-14) return null
  const a2 = a.x * a.x + a.y * a.y,
    b2 = b.x * b.x + b.y * b.y,
    c2 = c.x * c.x + c.y * c.y
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
  return { c: { x, y }, r: Math.hypot(a.x - x, a.y - y) }
}

/**
 * Кубика → сегменты. tol — допуск в единицах файла. Дуга окружности (с точностью
 * tol) становится настоящей дугой; почти прямая — отрезком; иначе делим пополам.
 */
function cubicToSegs(v: P[], tol: number, size: number, depth = 0): Seg[] {
  const [p0, , , p3] = v
  if (Math.max(lineDist(v[1], p0, p3), lineDist(v[2], p0, p3)) < tol) return [{ t: 'L', a: p0, b: p3 }]
  const m = bez(v, 0.5)
  const cc = circumcircle(p0, m, p3)
  if (cc && cc.r < size * 20) {
    const ok = [0.1, 0.25, 0.4, 0.6, 0.75, 0.9].every((t) => Math.abs(dist(bez(v, t), cc.c) - cc.r) < Math.min(tol, 2e-3 * cc.r))
    const cross = (m.x - p0.x) * (p3.y - m.y) - (m.y - p0.y) * (p3.x - m.x)
    // дуга не больше полуокружности: середина кривой лежит по ту же сторону хорды, что и дуга меньше 180°
    const minor = dist(m, mid(p0, p3)) <= cc.r + 1e-12
    if (ok && minor && Math.abs(cross) > 1e-15) return [{ t: 'A', a: p0, b: p3, c: cc.c, r: cc.r, ccw: cross > 0 }]
  }
  if (depth >= 14) return [{ t: 'L', a: p0, b: p3 }]
  const [l, r] = split(v)
  return [...cubicToSegs(l, tol, size, depth + 1), ...cubicToSegs(r, tol, size, depth + 1)]
}

function subToContour(sub: Sub, tol: number, size: number): Contour {
  const segs: Seg[] = []
  let cur = sub.start
  for (const it of sub.items) {
    if (it.k === 'L') segs.push({ t: 'L', a: cur, b: it.p })
    else segs.push(...cubicToSegs([cur, it.c1, it.c2, it.p], tol, size))
    cur = it.p
  }
  if (dist(cur, sub.start) > 1e-12) segs.push({ t: 'L', a: cur, b: sub.start }) // заливка замыкает контур
  return tidy(segs)
}

/** Убирает нулевые сегменты и склеивает коллинеарные отрезки; концы сегментов сшиваются. */
function tidy(segs: Seg[]): Contour {
  const out: Seg[] = []
  for (const s of segs) {
    if (segLength(s) < 1e-9) continue
    const prev = out[out.length - 1]
    if (prev && prev.t === 'L' && s.t === 'L') {
      const ux = prev.b.x - prev.a.x,
        uy = prev.b.y - prev.a.y,
        vx = s.b.x - s.a.x,
        vy = s.b.y - s.a.y
      if (Math.abs(ux * vy - uy * vx) < 1e-9 * Math.hypot(ux, uy) * Math.hypot(vx, vy) && ux * vx + uy * vy > 0) {
        out[out.length - 1] = { t: 'L', a: prev.a, b: s.b }
        continue
      }
    }
    out.push(s)
  }
  for (let i = 0; i < out.length; i++) {
    const n = out[(i + 1) % out.length]
    out[i] = { ...out[i], b: n.a } as Seg
  }
  return out
}

// ---------- обход документа ----------

const SKIP = new Set(['defs', 'clipPath', 'mask', 'symbol', 'marker', 'pattern', 'style', 'script', 'title', 'desc', 'metadata', 'linearGradient', 'radialGradient', 'filter', 'foreignObject'])

const styleProp = (el: Element, prop: string) => {
  const m = (el.getAttribute('style') ?? '').match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))
  return m ? m[1].trim() : null
}
const prop = (el: Element, name: string) => styleProp(el, name) ?? el.getAttribute(name)
const nums = (el: Element, ...names: string[]) => names.map((n) => parseFloat(el.getAttribute(n) ?? '0') || 0)

function shapeToPath(el: Element): string | null {
  switch (el.localName) {
    case 'path':
      return el.getAttribute('d')
    case 'rect': {
      const [x, y, w, h] = nums(el, 'x', 'y', 'width', 'height')
      if (w <= 0 || h <= 0) return null
      let rx = parseFloat(el.getAttribute('rx') ?? '') || 0
      let ry = parseFloat(el.getAttribute('ry') ?? '') || 0
      if (!rx) rx = ry
      if (!ry) ry = rx
      rx = Math.min(rx, w / 2)
      ry = Math.min(ry, h / 2)
      if (!rx) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
    }
    case 'circle': {
      const [cx, cy, r] = nums(el, 'cx', 'cy', 'r')
      return r > 0 ? `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z` : null
    }
    case 'ellipse': {
      const [cx, cy, rx, ry] = nums(el, 'cx', 'cy', 'rx', 'ry')
      return rx > 0 && ry > 0 ? `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z` : null
    }
    case 'polygon':
    case 'polyline': {
      const pts = (el.getAttribute('points') ?? '').trim()
      return pts ? `M${pts}Z` : null
    }
    default:
      return null
  }
}

interface Shape {
  subs: Sub[]
  evenOdd: boolean
}

function collect(el: Element, m: Mat, fill: string, rule: string, out: Shape[], warn: Set<string>) {
  const tag = el.localName
  if (SKIP.has(tag)) return
  if (prop(el, 'display') === 'none' || prop(el, 'visibility') === 'hidden') return
  const local = mul(m, parseTransform(el.getAttribute('transform')))
  const f = prop(el, 'fill') ?? fill
  const r = prop(el, 'fill-rule') ?? rule
  if (tag === 'svg' || tag === 'g' || tag === 'a' || tag === 'switch') {
    for (const c of Array.from(el.children)) collect(c, local, f, r, out, warn)
    return
  }
  if (tag === 'text' || tag === 'tspan') return void warn.add('text was skipped — convert it to outlines first')
  if (tag === 'image') return void warn.add('raster images were skipped')
  if (tag === 'use') return void warn.add('<use> references were skipped — expand symbols before exporting')
  if (tag === 'line') return void warn.add('lines without fill were skipped')
  const d = shapeToPath(el)
  if (!d) return
  if (f === 'none' || f === 'transparent') return void warn.add('stroke-only shapes were skipped — outline strokes (Object → Path → Outline Stroke)')
  const subs = parsePathData(d).map((s) => ({
    start: apply(local, s.start),
    items: s.items.map((it): Item => (it.k === 'L' ? { k: 'L', p: apply(local, it.p) } : { k: 'C', c1: apply(local, it.c1), c2: apply(local, it.c2), p: apply(local, it.p) })),
  }))
  if (subs.length) out.push({ subs, evenOdd: r === 'evenodd' })
}

// ---------- дырки и ориентация ----------

/** Точки контура для проверок вложенности (вершины и середины дуг). */
function samples(c: Contour): P[] {
  const out: P[] = []
  for (const s of c) {
    out.push(s.a)
    if (s.t === 'A') {
      const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x) + arcSweep(s) / 2
      out.push({ x: s.c.x + s.r * Math.cos(a0), y: s.c.y + s.r * Math.sin(a0) })
    }
  }
  return out
}
function inside(p: P, poly: P[]) {
  let inn = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inn = !inn
  }
  return inn
}
const reverse = (c: Contour): Contour =>
  c.map((s): Seg => (s.t === 'L' ? { t: 'L', a: s.b, b: s.a } : { ...s, a: s.b, b: s.a, ccw: !s.ccw })).reverse()

/** Контуры одной фигуры → внешние (против часовой) и дырки (по часовой) по вложенности и fill-rule. */
function orient(contours: Contour[], evenOdd: boolean): { outer: Contour; holes: Contour[] }[] {
  const polys = contours.map(samples)
  const areas = contours.map(contourArea)
  const parent = contours.map((_, i) => {
    let best = -1
    contours.forEach((_, j) => {
      if (i !== j && Math.abs(areas[j]) > Math.abs(areas[i]) && inside(polys[i][0], polys[j]))
        if (best < 0 || Math.abs(areas[j]) < Math.abs(areas[best])) best = j
    })
    return best
  })
  const depth = (i: number): number => (parent[i] < 0 ? 0 : 1 + depth(parent[i]))
  const isHole = contours.map((_, i) => {
    if (depth(i) % 2 === 0) return false
    // nonzero: вложенный контур — дырка, только если обход противоположен родителю
    return evenOdd || Math.sign(areas[i]) !== Math.sign(areas[parent[i]])
  })
  const groups = new Map<number, { outer: Contour; holes: Contour[] }>()
  contours.forEach((c, i) => {
    if (!isHole[i]) groups.set(i, { outer: areas[i] > 0 ? c : reverse(c), holes: [] })
  })
  contours.forEach((c, i) => {
    if (!isHole[i]) return
    let p = parent[i]
    while (p >= 0 && isHole[p]) p = parent[p]
    groups.get(p)?.holes.push(areas[i] < 0 ? c : reverse(c))
  })
  return [...groups.values()]
}

// ---------- нормировка в квадрант ----------

/** Подобие: масштаб k и сдвиг (u = k·x + tx, v = k·y + ty), затем при нужде поворот на 180°. */
function transformOutline(o: Outline, k: number, tx: number, ty: number, rotate180: boolean): Outline {
  const f = (p: P): P => {
    const x = k * p.x + tx,
      y = k * p.y + ty
    return rotate180 ? { x: -x, y: -y } : { x, y }
  }
  return o.map((c) => c.map((s): Seg => (s.t === 'L' ? { t: 'L', a: f(s.a), b: f(s.b) } : { ...s, a: f(s.a), b: f(s.b), c: f(s.c), r: s.r * k })))
}

/** Подравнивает неаккуратные края возле осей и границы квадранта (как при ручной чистке .ai). */
function snapEdges(o: Outline, eps = 0.01): Outline {
  const v = (x: number) => (Math.abs(x) < eps ? 0 : Math.abs(x - 1) < eps ? 1 : x)
  const f = (p: P): P => ({ x: v(p.x), y: v(p.y) })
  return o.map((c) => tidy(c.map((s): Seg => (s.t === 'L' ? { t: 'L', a: f(s.a), b: f(s.b) } : { ...s, a: f(s.a), b: f(s.b) }))))
}

const finish = (o: Outline): Outline => snapEdges(o).filter((c) => c.length >= 2 && Math.abs(contourArea(c)) > 1e-6)
const segCount = (o: Outline) => o.reduce((s, c) => s + c.length, 0)

// ---------- вход ----------

export type ImportTarget = 'sign' | PieceId

export function importSvg(text: string, target: ImportTarget): ImportResult {
  if (text.length > MAX_SVG_BYTES) return { ok: false, error: `the file is larger than ${Math.round(MAX_SVG_BYTES / 1048576)} MB` }
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.documentElement
  if (doc.getElementsByTagName('parsererror').length || root.localName !== 'svg') return { ok: false, error: 'this is not a valid SVG file' }

  // артборд: viewBox, иначе width/height
  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  let frame: { x: number; y: number; w: number; h: number } | null = null
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) frame = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] }
  else {
    const w = parseFloat(root.getAttribute('width') ?? ''),
      h = parseFloat(root.getAttribute('height') ?? '')
    if (w > 0 && h > 0) frame = { x: 0, y: 0, w, h }
  }

  const warn = new Set<string>()
  const shapes: Shape[] = []
  // ось Y файла смотрит вниз, у нас — вверх: переворачиваем сразу, до распознавания дуг
  for (const c of Array.from(root.children)) collect(c, [1, 0, 0, -1, 0, 0], 'black', 'nonzero', shapes, warn)
  if (!shapes.length) return { ok: false, error: 'no filled shapes found in the file' }

  // допуск дробления — от размера знака / детали
  const all = shapes.flatMap((s) => s.subs.flatMap((sub) => [sub.start, ...sub.items.map((it) => it.p)]))
  const xs = all.map((p) => p.x),
    ys = all.map((p) => p.y)
  const hull = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1
  const size = target === 'sign' && frame ? Math.min(frame.w, frame.h) / 2 : hull
  const tol = size * 0.0015

  const groups = shapes.flatMap((s) => orient(s.subs.map((sub) => subToContour(sub, tol, size)).filter((c) => c.length >= 2), s.evenOdd))
  const flat = (gs: typeof groups): Outline => gs.flatMap((g) => [g.outer, ...g.holes])

  const pieces: Partial<Record<PieceId, Outline>> = {}
  if (target === 'sign') {
    if (!frame) return { ok: false, error: 'the SVG has no artboard size (viewBox) — export it with the artboard' }
    const Q = Math.min(frame.w, frame.h) / 2
    const cx = frame.x + frame.w / 2
    const cy = -(frame.y + frame.h / 2) // в перевёрнутых координатах
    const top: typeof groups = [],
      bottom: typeof groups = []
    let skipped = 0
    for (const g of groups) {
      // четверть — по центру масс точек контура: края, чуть залезающие за ось, не мешают
      const pts = samples(g.outer)
      const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length - cx
      const my = pts.reduce((a, p) => a + p.y, 0) / pts.length - cy
      if (mx > 0 && my > 0) top.push(g)
      else if (mx < 0 && my < 0) bottom.push(g)
      else skipped++
    }
    if (skipped) warn.add(`${skipped} shape(s) outside the top-right and bottom-left quarters were skipped`)
    if (top.length) pieces.top = finish(transformOutline(flat(top), 1 / Q, -cx / Q, -cy / Q, false))
    if (bottom.length) pieces.bottom = finish(transformOutline(flat(bottom), 1 / Q, -cx / Q, -cy / Q, true))
    if (!pieces.top && !pieces.bottom) return { ok: false, error: 'nothing found in the top-right or bottom-left quarter of the artboard' }
    if (!pieces.top) warn.add('the top-right quarter is empty — the top piece is kept from the current form')
    if (!pieces.bottom) warn.add('the bottom-left quarter is empty — the bottom piece is kept from the current form')
  } else {
    // одна деталь: вписываем по габариту; у нижней в точку O приходится правый верхний угол габарита
    const o = flat(groups)
    const bb = outlineBBox(o)
    const S = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0)
    if (!(S > 0)) return { ok: false, error: 'the shapes in the file have no size' }
    pieces[target] =
      target === 'top'
        ? finish(transformOutline(o, 1 / S, -bb.x0 / S, -bb.y0 / S, false))
        : finish(transformOutline(o, 1 / S, -bb.x1 / S, -bb.y1 / S, true))
  }

  for (const id of ['top', 'bottom'] as const) {
    const o = pieces[id]
    if (!o) continue
    if (!o.length) return { ok: false, error: `the ${id} piece came out empty` }
    if (segCount(o) > MAX_SEGMENTS) return { ok: false, error: `the ${id} piece is too detailed (${segCount(o)} segments, limit ${MAX_SEGMENTS}) — simplify the paths` }
    const bb = outlineBBox(o)
    if (bb.x0 < -1.5 || bb.y0 < -1.5 || bb.x1 > 2.5 || bb.y1 > 2.5) return { ok: false, error: `the ${id} piece is far outside its quarter` }
  }
  return { ok: true, top: pieces.top, bottom: pieces.bottom, warnings: [...warn] }
}
