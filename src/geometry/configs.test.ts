import { describe, expect, test } from 'vitest'
import { CONFIGS, STROKE, configOutline } from './configs'
import { buildPiece, buildSign } from './sign'
import { outlineArea, outlineBBox, contourArea } from './outline'
import { outlineToPathD } from './serialize'
import { initialState, nextConfig } from '../model'
import { GRID_SIZES } from './grid'
import type { Outline } from '../types'

const EPS = 1e-6
const T = STROKE
const L_AREA = (t: number) => 2 * t - t * t

/** Площади верхней детали каждой конфигурации при Q = 1 (из геометрии файла). */
const TOP_AREA = [
  L_AREA(T) + 0.43 ** 2 * (1 - Math.PI / 4), // L + вогнутая «закладка» во внутреннем углу
  4 / 9,
  1 - 0.5 * 0.4768,
  (3 / 4) * Math.PI * 0.25 + 0.25, // три четверти круга r=½ + квадрант ½×½ у O
  0.5,
]
const BOTTOM_AREA = [L_AREA(T), L_AREA(T), L_AREA(T), L_AREA(T), L_AREA(T)]

function closed(o: Outline) {
  for (const c of o)
    for (let i = 0; i < c.length; i++) {
      const s = c[i],
        n = c[(i + 1) % c.length]
      expect(Math.hypot(s.b.x - n.a.x, s.b.y - n.a.y)).toBeLessThan(EPS)
    }
}

describe('пять конфигураций из sign-collection-fin.ai', () => {
  test('их ровно пять', () => expect(CONFIGS.length).toBe(5))
  for (const N of GRID_SIZES)
    CONFIGS.forEach((c, i) =>
      test(`${c.name}, N=${N}: площадь, квадрант, касание O, замкнутость`, () => {
        for (const id of ['top', 'bottom'] as const) {
          const o = configOutline(i, id, N)
          closed(o)
          expect(o.every((cc) => contourArea(cc) > 0)).toBe(true) // все контуры внешние, против часовой
          expect(outlineArea(o) / (N * N)).toBeCloseTo((id === 'top' ? TOP_AREA : BOTTOM_AREA)[i], 6)
          const bb = outlineBBox(o)
          expect(bb.x0).toBeGreaterThan(-EPS)
          expect(bb.y0).toBeGreaterThan(-EPS)
          expect(bb.x1).toBeLessThan(N + EPS)
          expect(bb.y1).toBeLessThan(N + EPS)
          // деталь касается O: в контуре есть вершина (0,0)
          expect(o.some((cc) => cc.some((s) => Math.abs(s.a.x) < EPS && Math.abs(s.a.y) < EPS))).toBe(true)
        }
      }),
    )
  test('нижняя деталь одна и та же во всех конфигурациях (как на первом артборде)', () => {
    const first = JSON.stringify(configOutline(0, 'bottom', 12))
    for (let i = 1; i < CONFIGS.length; i++) expect(JSON.stringify(configOutline(i, 'bottom', 12))).toBe(first)
    expect(T * 200).toBeCloseTo(56.531, 6)
  })
  test('дуги остаются дугами в SVG (конфигурации 1 и 4)', () => {
    for (const i of [0, 3]) {
      const d = outlineToPathD(configOutline(i, 'top', 12))
      expect(d).toContain('A')
      expect(d).not.toMatch(/C/)
    }
  })
  test('нижняя деталь в III квадранте, верхняя — в I; зазор g сдвигает каждую на g/2', () => {
    const s = initialState(12)
    const { top, bottom } = buildSign(s)
    expect(outlineBBox(top)).toMatchObject({ x0: 0, y0: 0, x1: 12, y1: 12 })
    expect(outlineBBox(bottom)).toMatchObject({ x0: -12, y0: -12, x1: 0, y1: 0 })
    const g = buildSign({ ...s, gap: 2 })
    expect(outlineBBox(g.top).x0).toBeCloseTo(1, 9)
    expect(outlineBBox(g.bottom).x1).toBeCloseTo(-1, 9)
  })
  test('скругления по-прежнему применяются к контурам конфигураций', () => {
    const r = { rounding: { convex: 1, concave: 0, origin: 2 } }
    for (let i = 0; i < CONFIGS.length; i++) {
      const plain = outlineArea(buildPiece({ customForms: [] }, i, 'top', { rounding: { convex: 0, concave: 0, origin: 0 } }, 12))
      const round = outlineArea(buildPiece({ customForms: [] }, i, 'top', r, 12))
      expect(round).toBeLessThan(plain) // выпуклые скругления снимают материал
      closed(buildPiece({ customForms: [] }, i, 'top', r, 12))
    }
  })
})

describe('выбор следующей конфигурации', () => {
  test('всегда другая и детерминирована по seed', () => {
    for (let cur = 0; cur < 5; cur++)
      for (let seed = 0; seed < 50; seed++) {
        const n = nextConfig(cur, seed)
        expect(n).not.toBe(cur)
        expect(n).toBeGreaterThanOrEqual(0)
        expect(n).toBeLessThan(5)
        expect(nextConfig(cur, seed)).toBe(n)
      }
  })
  test('за много шагов встречаются все конфигурации', () => {
    const seen = new Set<number>()
    let c = 0
    for (let seed = 0; seed < 100; seed++) seen.add((c = nextConfig(c, seed)))
    expect(seen.size).toBe(5)
  })
})
