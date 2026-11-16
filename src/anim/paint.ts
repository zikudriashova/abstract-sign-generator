import type { Paint } from '../types'

const hex = (c: string): [number, number, number] => {
  let h = c.slice(1)
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((x) => x + x).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')

export function lerpColor(a: string, b: string, t: number): string {
  if (a === b) return a
  const x = hex(a),
    y = hex(b)
  return toHex(x.map((v, i) => v + (y[i] - v) * t))
}

/**
 * Перетекание заливки. Если у заливок одинаковый тип и число стопов — плавно смешиваем
 * цвета, позиции и угол; иначе (solid ↔ gradient) переключаемся на середине перехода.
 */
export function lerpPaint(a: Paint, b: Paint, t: number): Paint {
  const k = Math.min(1, Math.max(0, t))
  if (a === b || k <= 0) return a
  if (k >= 1) return b
  if (a.type !== b.type || a.stops.length !== b.stops.length) return k < 0.5 ? a : b
  return {
    type: a.type,
    angle: a.angle + (b.angle - a.angle) * k,
    stops: a.stops.map((s, i) => ({ color: lerpColor(s.color, b.stops[i].color, k), at: s.at + (b.stops[i].at - s.at) * k })),
  }
}
