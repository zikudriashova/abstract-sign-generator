import { describe, expect, test } from 'vitest'
import { parsePreset, serializePreset } from './preset'
import { svgWithSize } from './png'
import { buildExportScene, exportGlb } from './glb'
import { signToSvg } from '../render2d/svg'
import { PALETTES, initialState } from '../model'
import { validateState } from '../validate'
import type { SignState } from '../types'

const base = initialState(12)

function variants(): SignState[] {
  const out: SignState[] = [base]
  for (let c = 0; c < 5; c++)
    out.push({
      ...base,
      config: c,
      seed: 100 + c,
      gap: (c % 4) - 1,
      top: { ...base.top, paint: PALETTES[c].top, rounding: { convex: c * 0.5, concave: 0, origin: c } },
      anim: { mode: c % 2 ? 'cut' : 'morph', duration: 150 + c * 300, easing: (['linear', 'easeInOut', 'expoOut', 'backOut'] as const)[c % 4], autoplay: c > 2, interval: 0.5 + c },
    })
  for (const N of [6, 8, 16] as const) out.push(initialState(N))
  return out
}

describe('JSON-пресет', () => {
  test('экспорт → импорт возвращает тот же знак, включая настройки анимации', () => {
    for (const s of variants()) {
      const res = parsePreset(serializePreset(s))
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.state).toEqual({ ...s, view: base.view })
    }
  })
  test('в пресете нет состояния интерфейса', () => {
    expect(serializePreset(base)).not.toContain('"build"')
  })
  test('отклоняет мусор и пресеты прошлой версии с понятной причиной', () => {
    const cases: [string, string][] = [
      ['not json', 'JSON'],
      ['{"app":"other"}', 'preset'],
      [JSON.stringify({ app: 'abstract-sign-generator', version: 1, state: {} }), 'previous generator'],
      [JSON.stringify({ app: 'abstract-sign-generator', version: 2, state: { version: 2, grid: { N: 7 }, config: 0 } }), 'grid.N'],
      [JSON.stringify({ app: 'abstract-sign-generator', version: 2, state: { ...base, config: 7 } }), 'config'],
    ]
    for (const [text, part] of cases) {
      const r = parsePreset(text)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain(part)
    }
  })
  test('цвет принимается только как hex — защита от инъекции в SVG', () => {
    const bad = JSON.parse(serializePreset(base))
    bad.state.top.paint.stops[0].color = '"/><script>alert(1)</script>'
    expect(parsePreset(JSON.stringify(bad)).ok).toBe(false)
    const bad2 = JSON.parse(serializePreset(base))
    bad2.state.color.bg = 'red" onload="x'
    expect(parsePreset(JSON.stringify(bad2)).ok).toBe(false)
  })
  test('цвета по формам и вращение сохраняются в пресете и проверяются', () => {
    const s = { ...base, spin: { top: 1.5, bottom: -0.5, formsPerTurn: 4 as const }, color: { ...base.color, perForm: true, formPaints: base.color.formPaints.map((fp, i) => ({ ...fp, top: PALETTES[i].top })) } }
    const r = parsePreset(serializePreset(s))
    expect(r.ok && r.state.spin).toEqual(s.spin)
    expect(r.ok && r.state.color.formPaints[3].top).toEqual(PALETTES[3].top)
    for (const mutate of [(p: any) => (p.state.spin.top = 9), (p: any) => (p.state.spin.formsPerTurn = 3), (p: any) => p.state.color.formPaints.pop(), (p: any) => (p.state.color.formPaints[1].top.stops[0].color = 'red')]) {
      const p = JSON.parse(serializePreset(s))
      mutate(p)
      expect(parsePreset(JSON.stringify(p)).ok).toBe(false)
    }
  })
  test('«Palettes → forms» берёт палитры под яркость общего фона', async () => {
    const { spreadPalettes } = await import('../model')
    const light = spreadPalettes(base) // фон Ink — светлый
    const names = (st: SignState) => st.color.formPaints.map((fp) => PALETTES.find((p) => p.top === fp.top)!.name)
    expect(names(light).every((n) => ['Ink', 'Signal', 'Mint', 'Ember'].includes(n))).toBe(true)
    const dark = spreadPalettes({ ...base, color: { ...base.color, bg: '#101010' } })
    expect(names(dark).every((n) => ['Night', 'Sunset', 'Mono'].includes(n))).toBe(true)
    expect(light.color.perForm).toBe(true)
  })
  test('длительность и интервал анимации ограничены', () => {
    for (const [k, v] of [['duration', 100], ['duration', 2500], ['interval', 0.1], ['easing', 'bounce'], ['mode', 'fade']] as const) {
      const p = JSON.parse(serializePreset(base))
      p.state.anim[k] = v
      expect(parsePreset(JSON.stringify(p)).ok).toBe(false)
    }
  })
  test('validateState достраивает пропущенные необязательные поля', () => {
    const s = validateState({ version: 2, grid: base.grid, config: 2, top: base.top, bottom: base.bottom })
    expect(s.view3d.depth).toBeGreaterThan(0)
    expect(s.anim.duration).toBe(600)
    expect(s.config).toBe(2)
  })
})

describe('PNG', () => {
  test('размер подставляется в корневой svg, остальное не меняется', () => {
    const svg = signToSvg(base, { build: false, bg: false, fixedSize: true })
    const out = svgWithSize(svg, 2048)
    expect(out).toMatch(/^<svg [^>]*width="2048" height="2048"/)
    expect(out.replace(/width="2048" height="2048"/, '')).toBe(svg.replace(/width="\d+" height="\d+"/, ''))
  })
})

describe('GLB', () => {
  test('сцена: две детали с нужными именами и Z-сдвигом', () => {
    const scene = buildExportScene({ ...base, top: { ...base.top, zShift: 1.5 } })
    expect(scene.children.map((c) => c.name)).toEqual(['top', 'bottom'])
    expect(scene.getObjectByName('top')!.position.z).toBe(1.5)
  })
  test('бинарный glTF: заголовок glTF, версия 2, есть геометрия', async () => {
    for (let c = 0; c < 5; c++) {
      const buf = await (await exportGlb({ ...base, config: c })).arrayBuffer()
      const dv = new DataView(buf)
      expect(String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3))).toBe('glTF')
      expect(dv.getUint32(4, true)).toBe(2)
      expect(dv.getUint32(8, true)).toBe(buf.byteLength)
    }
  })
})
