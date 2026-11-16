import { describe, expect, test } from 'vitest'
import { EASINGS, RING_N, lerpRings, matchRings, outlineToRings, ringArea, ringsToOutline, sampleContour } from './morph'
import { MorphEngine } from './engine'
import { configOutline } from '../geometry/configs'
import { buildSign } from '../geometry/sign'
import { outlineArea } from '../geometry/outline'
import { initialState } from '../model'
import type { Easing, Outline, PieceId } from '../types'

const ids: PieceId[] = ['top', 'bottom']
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

describe('сэмплирование', () => {
  test('кольцо из RING_N точек, вершины углов сохраняются, ориентация против часовой', () => {
    const o = configOutline(4, 'top', 12) // треугольник
    const r = sampleContour(o[0])
    expect(r.length).toBe(RING_N)
    for (const v of [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 0, y: 12 }]) expect(Math.min(...r.map((p) => near(p, v)))).toBeLessThan(1e-9)
    expect(ringArea(r)).toBeGreaterThan(0)
  })
  test('дуги сэмплируются по окружности', () => {
    const r = outlineToRings(configOutline(3, 'top', 12))[0]
    // точки дуги капли лежат на окружности с центром (6,6) и радиусом 6
    const onArc = r.filter((p) => p.x > 6.01 || p.y > 6.01)
    expect(onArc.length).toBeGreaterThan(RING_N / 2)
    for (const p of onArc) expect(near(p, { x: 6, y: 6 })).toBeCloseTo(6, 9)
  })
})

describe('сопоставление колец', () => {
  for (let a = 0; a < 5; a++)
    for (let b = 0; b < 5; b++)
      test(`конфигурация ${a + 1} → ${b + 1}: t=0 даёт исходную форму, t=1 — целевую`, () => {
        for (const id of ids) {
          const from = outlineToRings(configOutline(a, id, 12))
          const to = outlineToRings(configOutline(b, id, 12))
          const pairs = matchRings(from, to)
          expect(pairs.length).toBe(Math.max(from.length, to.length))
          for (const [p, q] of pairs) expect(p.length).toBe(q.length)
          const area = (rs: ReturnType<typeof lerpRings>) => rs.reduce((s, r) => s + Math.abs(ringArea(r)), 0)
          expect(area(lerpRings(pairs, 0))).toBeCloseTo(area(from), 6)
          expect(area(lerpRings(pairs, 1))).toBeCloseTo(area(to), 6)
          // кадры остаются конечными и рисуемыми
          for (const t of [0.25, 0.5, 0.75]) for (const r of lerpRings(pairs, t)) for (const p of r) expect(Number.isFinite(p.x + p.y)).toBe(true)
        }
      })
  test('4 квадрата → уголок: лишние квадраты стягиваются в точку на уголке', () => {
    const from = outlineToRings(configOutline(1, 'top', 12))
    const to = outlineToRings(configOutline(0, 'top', 12))
    const pairs = matchRings(from, to)
    expect(pairs.length).toBe(4)
    const collapsed = pairs.filter(([, q]) => q.every((p) => near(p, q[0]) < 1e-12))
    expect(collapsed.length).toBe(3)
    expect(ringsToOutline(lerpRings(pairs, 1)).length).toBe(1) // вырожденные кольца в конце отбрасываются
  })
})

test('при смене конфигурации нижняя деталь не двигается ни в одном кадре', () => {
  for (let a = 0; a < 5; a++)
    for (let b = 0; b < 5; b++) {
      const from = outlineToRings(configOutline(a, 'bottom', 12))
      const to = outlineToRings(configOutline(b, 'bottom', 12))
      const pairs = matchRings(from, to)
      for (const t of [0, 0.3, 0.7, 1.1]) for (const [r, i] of [[lerpRings(pairs, t)[0], 0]] as const) for (const [k, p] of r.entries()) expect(near(p, from[i][k])).toBeLessThan(1e-9)
    }
})

describe('цвета и вращение', () => {
  test('lerpPaint: одинаковая структура — плавно, разная — переключение на середине', async () => {
    const { lerpPaint, lerpColor } = await import('./paint')
    expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(lerpColor('#f00', '#00f', 1)).toBe('#0000ff')
    const a = { type: 'solid' as const, angle: 0, stops: [{ color: '#ff0000', at: 0 }, { color: '#ff0000', at: 1 }] }
    const b = { type: 'linear' as const, angle: 90, stops: [{ color: '#0000ff', at: 0 }, { color: '#00ff00', at: 1 }] }
    expect(lerpPaint(a, b, 0.4)).toBe(a)
    expect(lerpPaint(a, b, 0.6)).toBe(b)
    const c = { ...b, type: 'solid' as const, angle: 0, stops: [{ color: '#0000ff', at: 0 }, { color: '#0000ff', at: 1 }] }
    expect(lerpPaint(a, c, 0.5).stops[0].color).toBe('#800080')
  })
  test('ось вращения — вертикаль через O: на полуобороте деталь уходит влево, на четверти — встаёт ребром', async () => {
    const THREE = await import('three')
    const { SPIN_AXIS } = await import('./spin')
    const q = new THREE.Quaternion()
    const p = () => new THREE.Vector3(6, 4, 0) // точка верхней детали
    const half = p().applyQuaternion(q.setFromAxisAngle(SPIN_AXIS, Math.PI))
    expect(half.x).toBeCloseTo(-6, 9)
    expect(half.y).toBeCloseTo(4, 9)
    const quarter = p().applyQuaternion(q.setFromAxisAngle(SPIN_AXIS, Math.PI / 2))
    expect(quarter.x).toBeCloseTo(0, 9) // деталь в плоскости YZ: для фронтальной камеры — ребром
  })
  test('formSlot: смены формы на π/2 + j·2π/k, первая — ребром', async () => {
    const { formSlot } = await import('./spin')
    const q = Math.PI / 2
    expect(formSlot(q - 0.01, 2)).not.toBe(formSlot(q + 0.01, 2))
    expect(formSlot(q + 0.01, 2)).toBe(formSlot(3 * q - 0.01, 2))
    expect(formSlot(3 * q - 0.01, 2)).not.toBe(formSlot(3 * q + 0.01, 2))
    expect(formSlot(5, 0)).toBe(0)
    // в обратную сторону смены тоже срабатывают
    expect(formSlot(-q + 0.01, 2)).not.toBe(formSlot(-q - 0.01, 2))
  })
  test('движок: при смене формы цвета перетекают, при правке цвета — сразу', () => {
    const red = { type: 'solid' as const, angle: 0, stops: [{ color: '#ff0000', at: 0 }, { color: '#ff0000', at: 1 }] }
    const blue = { ...red, stops: [{ color: '#0000ff', at: 0 }, { color: '#0000ff', at: 1 }] }
    let now = 0
    const queue: (() => void)[] = []
    const s = initialState(12)
    const engine = new MorphEngine(buildSign(s), { top: red, bottom: red }, () => now, (cb) => (queue.push(cb), queue.length), () => {})
    engine.setTarget(buildSign({ ...s, config: 2 }), 'shape', { mode: 'morph', duration: 400, easing: 'linear' }, { top: blue, bottom: red })
    now = 200
    queue.splice(0).forEach((cb) => cb())
    expect(engine.get().paints!.top.stops[0].color).toBe('#800080')
    now = 500
    queue.splice(0).forEach((cb) => cb())
    expect(engine.get().paints!.top).toBe(blue)
    engine.setTarget(buildSign({ ...s, config: 2 }), 'other', { mode: 'morph', duration: 400, easing: 'linear' }, { top: red, bottom: red })
    expect(engine.get().paints!.top).toBe(red)
  })
})

describe('easing', () => {
  for (const [name, f] of Object.entries(EASINGS))
    test(`${name}: 0 → 0, 1 → 1`, () => {
      expect(f(0)).toBeCloseTo(0, 9)
      expect(f(1)).toBeCloseTo(1, 9)
    })
  test('back-out перелетает цель, expo-out быстрее линейной в начале', () => {
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => EASINGS.backOut(i / 49)))).toBeGreaterThan(1)
    expect(EASINGS.expoOut(0.2)).toBeGreaterThan(0.5)
    expect(EASINGS.easeInOut(0.5)).toBeCloseTo(0.5, 9)
  })
})

/** Движок с ручными часами: проверяем без реального requestAnimationFrame. */
function makeEngine(initial: Record<PieceId, Outline>) {
  let now = 0
  const queue: (() => void)[] = []
  const engine = new MorphEngine(initial, undefined, () => now, (cb) => (queue.push(cb), queue.length), () => {})
  const advance = (ms: number) => {
    now += ms
    const cbs = queue.splice(0)
    cbs.forEach((cb) => cb())
  }
  return { engine, advance }
}

describe('движок анимации', () => {
  const s = initialState(12)
  const settings = (mode: 'cut' | 'morph', duration = 400, easing: Easing = 'linear') => ({ mode, duration, easing })

  test('hard cut: форма меняется сразу, без промежуточных кадров', () => {
    const { engine } = makeEngine(buildSign(s))
    const target = buildSign({ ...s, config: 4 })
    engine.setTarget(target, 'shape', settings('cut'))
    expect(engine.get().animating).toBe(false)
    expect(engine.get().outlines).toBe(target)
  })

  test('morph: промежуточные кадры, в конце — точный контур с дугами', () => {
    const { engine, advance } = makeEngine(buildSign(s))
    const target = buildSign({ ...s, config: 3 })
    engine.setTarget(target, 'shape', settings('morph', 400))
    advance(200)
    const mid = engine.get()
    expect(mid.animating).toBe(true)
    expect(mid.outlines.top.flat().every((g) => g.t === 'L')).toBe(true)
    advance(250)
    expect(engine.get().animating).toBe(false)
    expect(engine.get().outlines).toBe(target)
  })

  test('новая команда стартует с текущего промежуточного кадра', () => {
    const { engine, advance } = makeEngine(buildSign(s))
    engine.setTarget(buildSign({ ...s, config: 4 }), 'shape', settings('morph', 400))
    advance(200)
    const mid = engine.get().outlines.top
    const midArea = outlineArea(mid)
    engine.setTarget(buildSign({ ...s, config: 1 }), 'shape', settings('morph', 400))
    // сразу после новой команды кадр не прыгает: площадь та же, что в момент прерывания
    advance(0)
    expect(outlineArea(engine.get().outlines.top)).toBeCloseTo(midArea, 6)
    advance(500)
    expect(engine.get().animating).toBe(false)
  })

  test('изменение зазора во время морфинга подхватывается без перезапуска длительности', () => {
    const { engine, advance } = makeEngine(buildSign(s))
    engine.setTarget(buildSign({ ...s, config: 2 }), 'shape', settings('morph', 400))
    advance(300)
    const target = buildSign({ ...s, config: 2, gap: 2 })
    engine.setTarget(target, 'other', settings('morph', 400))
    advance(120) // до конца исходной анимации оставалось 100 мс
    expect(engine.get().animating).toBe(false)
    expect(engine.get().outlines).toBe(target)
  })
})
