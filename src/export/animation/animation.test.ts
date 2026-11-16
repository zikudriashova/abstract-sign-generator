import { describe, expect, test } from 'vitest'
import { buildTimeline } from './timeline'
import { createGifSink, createMp4Sink } from './sinks'
import { initialState } from '../../model'
import { buildSign } from '../../geometry/sign'
import { outlineArea } from '../../geometry/outline'
import type { SignState } from '../../types'

const base = initialState(12)
const withAnim = (a: Partial<SignState['anim']>, config = 0): SignState => ({ ...base, config, anim: { ...base.anim, ...a } })
const area = (f: ReturnType<ReturnType<typeof buildTimeline>['frameAt']>) => outlineArea(f.outlines.top)

describe('таймлайн анимации', () => {
  test('длительность — по интервалу на каждую из пяти конфигураций', () => {
    const tl = buildTimeline(withAnim({ interval: 2, duration: 600 }), 30)
    expect(tl.duration).toBe(10)
    expect(tl.frameCount).toBe(300)
  })
  test('начинается с текущей конфигурации, проходит все и возвращается (бесшовная петля)', () => {
    const s = withAnim({ interval: 1, duration: 400, easing: 'linear', mode: 'morph' }, 2)
    const tl = buildTimeline(s, 25)
    const start = buildSign(s)
    expect(tl.frameAt(0).outlines).toEqual(start)
    // на «полке» каждой конфигурации — точный контур этой конфигурации
    for (let k = 0; k < 5; k++) expect(tl.frameAt(k * 25).outlines).toEqual(buildSign({ ...s, config: (2 + k) % 5 }))
    // шов петли: «кадр после последнего» — это уже стартовая форма (ломаная её контура)
    expect(area(tl.frameAt(tl.frameCount))).toBeCloseTo(outlineArea(start.top), 0)
  })
  test('morph: в конце каждого интервала — промежуточные кадры-ломаные', () => {
    const tl = buildTimeline(withAnim({ interval: 1, duration: 600, mode: 'morph' }), 30)
    const mid = tl.frameAt(25) // 0.83 c: идёт переход 1 → 2
    expect(mid.outlines.top.flat().every((s) => s.t === 'L')).toBe(true)
  })
  test('hard cut: только точные контуры, смена ровно на границе интервала', () => {
    const s = withAnim({ interval: 1, mode: 'cut' })
    const tl = buildTimeline(s, 30)
    expect(tl.frameAt(29).outlines).toEqual(buildSign({ ...s, config: 0 }))
    expect(tl.frameAt(30).outlines).toEqual(buildSign({ ...s, config: 1 }))
  })
  test('длительность морфинга больше интервала ограничивается интервалом', () => {
    const tl = buildTimeline(withAnim({ interval: 0.5, duration: 2000, mode: 'morph', easing: 'linear' }), 30)
    expect(tl.frameAt(0).outlines.top.flat().some((s) => s.t === 'L')).toBe(true) // переход начинается сразу
    for (let i = 0; i < tl.frameCount; i++) for (const s of tl.frameAt(i).outlines.top.flat()) expect(Number.isFinite(s.a.x + s.a.y)).toBe(true)
  })
})

describe('таймлайн: цвета по формам и вращение', () => {
  const perForm = (s: SignState): SignState => ({
    ...s,
    color: {
      ...s.color,
      perForm: true,
      formPaints: s.color.formPaints.map((_, i) => ({ top: { type: 'solid' as const, angle: 0, stops: [{ color: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff'][i], at: 0 }, { color: '#000000', at: 1 }] }, bottom: s.color.formPaints[i].bottom })),
    },
  })
  test('цвета форм на «полках» точные, в переходе — смешиваются', () => {
    const s = perForm(withAnim({ interval: 1, duration: 500, mode: 'morph', easing: 'linear' }))
    const tl = buildTimeline(s, 20)
    expect(tl.frameAt(0).paints.top.stops[0].color).toBe('#ff0000')
    expect(tl.frameAt(20).paints.top.stops[0].color).toBe('#00ff00')
    expect(tl.frameAt(15).paints.top.stops[0].color).toBe('#808000') // середина перехода красный → зелёный
  })
  test('в 2D вращения нет', () => {
    const s = { ...withAnim({}), spin: { top: 1, bottom: 0.5, formsPerTurn: 2 as const } }
    expect(buildTimeline(s, 25).frameAt(10).spin).toBeUndefined()
  })
  test('3D: смена форм от вращения — целое число оборотов, кратное пяти, петля сходится', () => {
    const s: SignState = { ...withAnim({ mode: 'cut' }, 1), view: { ...base.view, mode: '3d' }, spin: { top: 1, bottom: 0, formsPerTurn: 2 } }
    const tl = buildTimeline(s, 40)
    expect(tl.duration).toBe(5) // 5 оборотов по 1 с
    expect(tl.frameAt(0).outlines).toEqual(buildSign(s))
    expect(tl.frameAt(0).spin!.top).toBe(0)
    // первая смена — на четверти оборота (деталь ребром): до неё форма стартовая, после — следующая
    expect(tl.frameAt(9).outlines).toEqual(buildSign(s)) // 0.225 c
    expect(tl.frameAt(11).outlines).toEqual(buildSign({ ...s, config: 2 })) // 0.275 c
    // вторая смена — ещё через пол-оборота
    expect(tl.frameAt(31).outlines).toEqual(buildSign({ ...s, config: 3 })) // 0.775 c
    // к концу петли форма вернулась к стартовой, угол — к целому числу оборотов
    expect(tl.frameAt(tl.frameCount - 1).outlines).toEqual(buildSign(s))
    expect((tl.frameAt(tl.frameCount).spin!.top / (2 * Math.PI)) % 1).toBeCloseTo(0, 9)
  })
  test('3D: длина подбирается так, чтобы и нижняя деталь сделала целое число оборотов', () => {
    const s: SignState = { ...withAnim({}), view: { ...base.view, mode: '3d' }, spin: { top: 2, bottom: 0.3, formsPerTurn: 1 } }
    const tl = buildTimeline(s, 30)
    const bottomTurns = (tl.frameAt(tl.frameCount).spin!.bottom) / (2 * Math.PI)
    expect(bottomTurns).toBeCloseTo(Math.round(bottomTurns), 6)
    expect(tl.duration * 2 % 5).toBeCloseTo(0, 9) // целое число оборотов верхней, кратное 5
  })
})

describe('кодировщики', () => {
  test('GIF: корректный заголовок, повтор бесконечный, все кадры записаны', async () => {
    const w = 64,
      h = 36
    const gif = createGifSink(w, h, 25)
    for (let f = 0; f < 5; f++) {
      const rgba = new Uint8ClampedArray(w * h * 4)
      for (let i = 0; i < w * h; i++) rgba.set([f * 50, 255 - f * 50, i % 256, 255], i * 4)
      gif.addRGBA(rgba)
    }
    const bytes = new Uint8Array(await (await gif.finish()).arrayBuffer())
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a')
    expect(bytes[6] | (bytes[7] << 8)).toBe(w)
    expect(bytes[8] | (bytes[9] << 8)).toBe(h)
    expect(String.fromCharCode(...bytes.slice(0, 200)).includes('NETSCAPE2.0')).toBe(true)
    // 5 дескрипторов кадров (0x2C) после графических расширений (0x21 0xF9)
    let frames = 0
    for (let i = 0; i < bytes.length - 1; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) frames++
    expect(frames).toBe(5)
  })
  test('MP4: без WebCodecs — понятная ошибка с подсказкой про GIF', async () => {
    await expect(createMp4Sink(1280, 720, 30)).rejects.toThrow(/GIF/)
  })
})
