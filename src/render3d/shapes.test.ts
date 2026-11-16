import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { extrudeOutline, outlineToShapes, simplifyForBevel } from './shapes'
import { sampleContour } from '../anim/morph'
import { configOutline } from '../geometry/configs'
import { initialState } from '../model'
import { buildSign } from '../geometry/sign'
import { outlineArea } from '../geometry/outline'
import { lerpRings, matchRings, outlineToRings, ringsToOutline } from '../anim/morph'

const area = (s: THREE.Shape) => Math.abs(THREE.ShapeUtils.area(s.getPoints(32))) - s.holes.reduce((a, h) => a + Math.abs(THREE.ShapeUtils.area(h.getPoints(32))), 0)

describe('Outline → THREE', () => {
  const s = initialState(12)
  test('площадь Shape совпадает с площадью контура для всех конфигураций', () => {
    for (let c = 0; c < 5; c++) {
      const o = buildSign({ ...s, config: c })
      for (const id of ['top', 'bottom'] as const) {
        const total = outlineToShapes(o[id]).reduce((a, sh) => a + area(sh), 0)
        expect(total).toBeCloseTo(outlineArea(o[id]), 1) // дуги в Shape аппроксимируются ломаной
      }
    }
  })
  test('4 квадрата дают 4 отдельные Shape', () => {
    expect(outlineToShapes(buildSign({ ...s, config: 1 }).top).length).toBe(4)
  })
  test('экструзия: глубина по Z и габарит XY не растут от фаски', () => {
    const geo = extrudeOutline(buildSign(s).top, { depth: 2, bevel: 0.4, bevelSegments: 3 })
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    expect(bb.max.z - bb.min.z).toBeCloseTo(2, 5)
    expect(bb.max.x).toBeCloseTo(12, 5)
    expect(bb.min.x).toBeCloseTo(0, 5)
  })
  test('кадры морфинга экструдируются без ошибок', () => {
    const a = buildSign({ ...s, config: 1 }).top,
      b = buildSign({ ...s, config: 3 }).top
    const pairs = matchRings(outlineToRings(a), outlineToRings(b))
    for (const t of [0.1, 0.5, 0.9]) {
      const geo = extrudeOutline(ringsToOutline(lerpRings(pairs, t)), { depth: 1, bevel: 0.2, bevelSegments: 2 })
      expect(geo.getAttribute('position').count).toBeGreaterThan(0)
    }
  })

  const bbox = (geo: THREE.BufferGeometry) => {
    geo.computeBoundingBox()
    return geo.boundingBox!
  }
  const square = (x: number, y: number, side: number) => [
    [
      { t: 'L' as const, a: { x, y }, b: { x: x + side, y } },
      { t: 'L' as const, a: { x: x + side, y }, b: { x: x + side, y: y + side } },
      { t: 'L' as const, a: { x: x + side, y: y + side }, b: { x, y: y + side } },
      { t: 'L' as const, a: { x, y: y + side }, b: { x, y } },
    ],
  ]
  test('статичные конфигурации получают полную глубину во всём диапазоне ползунка (до N)', () => {
    for (const N of [6, 12, 16])
      for (let c = 0; c < 5; c++)
        for (const id of ['top', 'bottom'] as const) {
          const bb = bbox(extrudeOutline(configOutline(c, id, N), { depth: N, bevel: 0.3, bevelSegments: 3 }))
          expect(bb.max.z - bb.min.z).toBeCloseTo(N, 4)
        }
  })
  test('часть, стягивающаяся в точку, уменьшается и по глубине, а не остаётся «столбиком»', () => {
    const depths = [4, 0.4, 0.1, 0.02].map((side) => {
      const bb = bbox(extrudeOutline(square(0, 0, side), { depth: 3, bevel: 0.5, bevelSegments: 3 }))
      return bb.max.z - bb.min.z
    })
    expect(depths[0]).toBeCloseTo(3, 4)
    for (let i = 1; i < depths.length; i++) expect(depths[i]).toBeLessThan(depths[i - 1])
    expect(depths[3]).toBeLessThan(0.2)
  })
  test('фаска не выворачивается на маленькой части: габарит XY не выходит за контур', () => {
    for (const side of [0.3, 0.8, 1.5]) {
      const bb = bbox(extrudeOutline(square(2, 2, side), { depth: 2, bevel: 3, bevelSegments: 4 }))
      expect(bb.min.x).toBeGreaterThan(2 - 1e-6)
      expect(bb.max.x).toBeLessThan(2 + side + 1e-6)
      expect(bb.min.y).toBeGreaterThan(2 - 1e-6)
      expect(bb.max.y).toBeLessThan(2 + side + 1e-6)
    }
  })
  test('нормали сглажены и корректны (единичной длины, без NaN)', () => {
    const geo = extrudeOutline(configOutline(3, 'top', 12), { depth: 2, bevel: 0.4, bevelSegments: 3 })
    const n = geo.getAttribute('normal')
    for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4)
    // на дуге капли соседние боковые грани делят нормаль: уникальных нормалей заметно меньше, чем вершин
    const uniq = new Set<string>()
    for (let i = 0; i < n.count; i++) uniq.add(`${n.getX(i).toFixed(3)},${n.getY(i).toFixed(3)},${n.getZ(i).toFixed(3)}`)
    expect(uniq.size).toBeLessThan(n.count / 3)
  })

  test('кадр морфинга: квадрат из 192 точек упрощается до 4 углов, круг сохраняет форму', () => {
    const ring = sampleContour(configOutline(1, 'top', 12)[3]).map((p) => ({ x: 10 + (p.x - 10) * 0.45, y: 2 + (p.y - 2) * 0.45 }))
    const poly = ring.map((a, i) => ({ t: 'L' as const, a, b: ring[(i + 1) % ring.length] }))
    const simple = simplifyForBevel(poly, 0.44)
    expect(simple.length).toBe(4)
    const drop = sampleContour(configOutline(3, 'top', 12)[0])
    const dropPoly = drop.map((a, i) => ({ t: 'L' as const, a, b: drop[(i + 1) % drop.length] }))
    const sd = simplifyForBevel(dropPoly, 0.44)
    expect(sd.length).toBeGreaterThan(40) // дуга радиуса 6 остаётся гладкой
    expect(sd.length).toBeLessThan(dropPoly.length)
    // ни одна оставшаяся точка не стоит ближе шага к соседней, кроме пар «угол — угол»
    for (let i = 0; i < sd.length; i++) {
      const p = sd[i].a, q = sd[i].b
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(0.2)
    }
  })
  test('контуры с дугами не упрощаются', () => {
    const c = configOutline(3, 'top', 12)[0]
    expect(simplifyForBevel(c, 1)).toBe(c)
  })
})

