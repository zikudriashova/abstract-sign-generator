import type { Outline, Paint, PieceId, SignState } from '../types'
import { buildSign } from '../geometry/sign'
import { renderPaint } from '../model'
import { outlineBBox } from '../geometry/outline'
import { outlineToPathD } from '../geometry/serialize'

export interface RenderOpts {
  /** режим построения: контуры без заливки, оси, сетка модулей */
  build: boolean
  /** рисовать ли фон */
  bg: boolean
  /** единиц SVG на модуль */
  unit?: number
  /** задать width/height (для экспорта) вместо адаптивного размера */
  fixedSize?: boolean
  /** префикс id градиентов, чтобы несколько SVG на одной странице не конфликтовали */
  idPrefix?: string
  /** готовые контуры (кадр анимации); по умолчанию — точные контуры текущего знака */
  outlines?: Record<PieceId, Outline>
  /** заливки кадра анимации (цвета перетекают при смене формы); по умолчанию — заливки текущей формы */
  paints?: Record<PieceId, Paint>
}

const f = (n: number) => String(Math.round(n * 1000) / 1000)

interface BB {
  x0: number
  y0: number
  x1: number
  y1: number
}

function paintDef(id: string, paint: Paint, bb: BB): { defs: string; fill: string } {
  if (paint.type === 'solid') return { defs: '', fill: paint.stops[0].color }
  const stops = paint.stops
    .map((s) => `<stop offset="${f(s.at)}" stop-color="${s.color}"/>`)
    .join('')
  const cx = (bb.x0 + bb.x1) / 2,
    cy = (bb.y0 + bb.y1) / 2,
    w = bb.x1 - bb.x0,
    h = bb.y1 - bb.y0
  if (paint.type === 'linear') {
    const th = (paint.angle * Math.PI) / 180
    const dx = Math.cos(th),
      dy = -Math.sin(th) // экранная ось Y смотрит вниз
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
    return {
      defs: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(cx - dx * half)}" y1="${f(cy - dy * half)}" x2="${f(cx + dx * half)}" y2="${f(cy + dy * half)}">${stops}</linearGradient>`,
      fill: `url(#${id})`,
    }
  }
  const r = Math.hypot(w, h) / 2
  return {
    defs: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}">${stops}</radialGradient>`,
    fill: `url(#${id})`,
  }
}

const toScreenBB = (o: Outline, unit: number): BB => {
  const b = outlineBBox(o)
  return { x0: b.x0 * unit, x1: b.x1 * unit, y0: -b.y1 * unit, y1: -b.y0 * unit }
}
const union = (a: BB, b: BB): BB => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
})

/** Единственный источник 2D-картинки: экран, SVG-экспорт и (позже) PNG рисуются из этой строки. */
export function signToSvg(s: SignState, opts: RenderOpts): string {
  const unit = opts.unit ?? 10
  const o = opts.outlines ?? buildSign(s)
  const bbT = toScreenBB(o.top, unit)
  const bbB = toScreenBB(o.bottom, unit)
  const bbAll = union(bbT, bbB)

  // вид вокруг O зависит только от сетки и зазора, поэтому не дрожит во время морфинга
  const N = s.grid.N
  const ext = N + Math.max(0, s.gap) / 2 + (opts.build ? 1 : Math.max(1, N / 6))
  const size = 2 * ext * unit
  const vb = `${f(-ext * unit)} ${f(-ext * unit)} ${f(size)} ${f(size)}`
  const dim = opts.fixedSize ? ` width="${f(size)}" height="${f(size)}"` : ''

  const defs: string[] = []
  const body: string[] = []
  const bg = opts.build ? '#0b0b0c' : s.color.bg
  if (opts.bg || opts.build)
    body.push(`<rect x="${f(-ext * unit)}" y="${f(-ext * unit)}" width="${f(size)}" height="${f(size)}" fill="${bg}"/>`)

  if (opts.build) {
    const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, w = 1) =>
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" vector-effect="non-scaling-stroke"/>`
    const grid: string[] = []
    for (let i = -N; i <= N; i++) {
      if (i === 0) continue
      grid.push(line(i * unit, -N * unit, i * unit, N * unit, '#26262a'), line(-N * unit, i * unit, N * unit, i * unit, '#26262a'))
    }
    body.push(`<g id="grid">${grid.join('')}</g>`)
    body.push(
      `<g id="axes">${line(-ext * unit, 0, ext * unit, 0, '#8a8a90')}${line(0, -ext * unit, 0, ext * unit, '#8a8a90')}</g>`,
    )
    body.push(
      `<rect x="${-N * unit}" y="${-N * unit}" width="${2 * N * unit}" height="${2 * N * unit}" fill="none" stroke="#3a3a40" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`,
    )
  }

  const ids: PieceId[] = ['top', 'bottom']
  const bbs = { top: bbT, bottom: bbB }
  const groups = ids.map((id) => {
    const d = outlineToPathD(o[id], unit)
    if (opts.build)
      return `<g id="${id}"><path d="${d}" fill="none" stroke="#f4f4f4" stroke-width="1.5" vector-effect="non-scaling-stroke"/></g>`
    // «один градиент на весь знак»: краска верхней детали, bbox всего знака
    const paint = opts.paints?.[s.color.singleGradient ? 'top' : id] ?? renderPaint(s, id)
    const pd = paintDef(`${opts.idPrefix ?? ''}g-${id}`, paint, s.color.singleGradient ? bbAll : bbs[id])
    if (pd.defs) defs.push(pd.defs)
    // nonzero: внешние контуры против часовой, дырки по часовой; перекрытия кадров морфинга не дают «дыр»
    return `<g id="${id}"><path d="${d}" fill="${pd.fill}" fill-rule="nonzero"/></g>`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${dim}>${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body.join('')}${groups.join('')}</svg>`
}

export function downloadText(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
