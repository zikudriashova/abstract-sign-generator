import { describe, expect, test } from 'vitest'
import { signToSvg } from './svg'
import { initialState, PALETTES } from '../model'
import { buildSign } from '../geometry/sign'
import { ringsToOutline, lerpRings, matchRings, outlineToRings } from '../anim/morph'

const base = initialState(12)

describe('SVG-экспорт', () => {
  test('две группы top/bottom, дуги командой A, без NaN и кривых Безье', () => {
    const svg = signToSvg(base, { build: false, bg: false, fixedSize: true })
    expect(svg).toContain('<g id="top">')
    expect(svg).toContain('<g id="bottom">')
    expect(svg).not.toContain('NaN')
    expect(svg).not.toMatch(/ d="[^"]*C/)
    expect(svg).toMatch(/ d="[^"]*A/)
    expect(svg).not.toContain('<rect') // фон выключен — прозрачный
  })
  test('фон добавляется по флагу', () => {
    expect(signToSvg(base, { build: false, bg: true })).toContain('<rect')
  })
  test('градиенты: у каждой детали свои defs, у singleGradient — общий bbox', () => {
    const sunset = PALETTES.find((p) => p.name === 'Sunset')!
    const s = { ...base, top: { ...base.top, paint: sunset.top }, bottom: { ...base.bottom, paint: sunset.bottom } }
    const svg = signToSvg(s, { build: false, bg: false })
    expect(svg).toContain('<linearGradient id="g-top"')
    expect(svg).toContain('fill="url(#g-top)"')
    const single = signToSvg({ ...s, color: { ...s.color, singleGradient: true } }, { build: false, bg: false })
    const attrs = (id: string) => single.match(new RegExp(`<linearGradient id="${id}"[^>]*>`))![0].replace(id, '')
    expect(attrs('g-top')).toBe(attrs('g-bottom'))
  })
  test('режим построения: без заливки, с осями и сеткой', () => {
    const svg = signToSvg(base, { build: true, bg: true })
    expect(svg).toContain('id="axes"')
    expect(svg).toContain('id="grid"')
    expect(svg).toContain('fill="none"')
  })
  test('вид не меняется между конфигурациями и кадрами морфинга', () => {
    const vb = (s: string) => s.match(/viewBox="([^"]+)"/)![1]
    const views = new Set<string>()
    for (let c = 0; c < 5; c++) views.add(vb(signToSvg({ ...base, config: c }, { build: false, bg: false })))
    const a = buildSign({ ...base, config: 1 }),
      b = buildSign({ ...base, config: 3 })
    const pairs = matchRings(outlineToRings(a.top), outlineToRings(b.top))
    const frame = { top: ringsToOutline(lerpRings(pairs, 1.1)), bottom: b.bottom } // кадр back-out с перелётом
    views.add(vb(signToSvg(base, { build: false, bg: false, outlines: frame })))
    expect(views.size).toBe(1)
  })
})
