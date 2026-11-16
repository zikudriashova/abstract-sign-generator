import type { Outline, P } from '../types'
import { arcSweep } from './outline'

const fmt = (n: number) => {
  const s = (Math.round(n * 1000) / 1000).toString()
  return s === '-0' ? '0' : s
}

/**
 * Outline (y вверх, модули) → SVG path d (y вниз, `unit` единиц на модуль).
 * Дуги остаются дугами: команда A.
 */
export function outlineToPathD(o: Outline, unit = 10, ox = 0, oy = 0): string {
  const m = (p: P) => `${fmt(p.x * unit + ox)} ${fmt(-p.y * unit + oy)}`
  const parts: string[] = []
  for (const c of o) {
    parts.push(`M${m(c[0].a)}`)
    for (const s of c) {
      if (s.t === 'L') parts.push(`L${m(s.b)}`)
      else {
        const large = Math.abs(arcSweep(s)) > Math.PI ? 1 : 0
        // после переворота оси Y вращение меняется: ccw (математически) → sweep 0
        parts.push(`A${fmt(s.r * unit)} ${fmt(s.r * unit)} 0 ${large} ${s.ccw ? 0 : 1} ${m(s.b)}`)
      }
    }
    parts.push('Z')
  }
  return parts.join('')
}
