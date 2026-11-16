import { beforeEach, describe, expect, test } from 'vitest'
import { useSign } from './useSign'
import { initialState } from '../model'
import { CONFIGS, formCount, formOutline } from '../geometry/configs'
import { buildSign } from '../geometry/sign'
import { outlineArea } from '../geometry/outline'
import { parsePreset, serializePreset } from '../export/preset'
import { importSvg } from '../import/svgImport'
import type { Outline } from '../types'

const square = (k: number): Outline => [
  [
    { t: 'L', a: { x: 0, y: 0 }, b: { x: k, y: 0 } },
    { t: 'L', a: { x: k, y: 0 }, b: { x: k, y: k } },
    { t: 'L', a: { x: k, y: k }, b: { x: 0, y: k } },
    { t: 'L', a: { x: 0, y: k }, b: { x: 0, y: 0 } },
  ],
]
const st = () => useSign.getState()

beforeEach(() => useSign.setState({ sign: initialState(12), past: [], future: [] }))

describe('загруженные формы в хранилище', () => {
  test('новая форма добавляется после встроенных, на неё переключаемся, цвета форм не разъезжаются', () => {
    st().setConfig(2)
    st().addCustomForm({ name: 'Box', top: square(0.5), bottom: square(0.25) })
    const s = st().sign
    expect(formCount(s)).toBe(CONFIGS.length + 1)
    expect(s.config).toBe(CONFIGS.length)
    expect(s.color.formPaints.length).toBe(formCount(s))
    expect(outlineArea(buildSign(s).top)).toBeCloseTo(0.25 * 144, 6)
  })
  test('замена детали у встроенной формы создаёт копию, встроенная не меняется', () => {
    st().setConfig(1)
    st().replacePiece('bottom', square(1), 'Full')
    const s = st().sign
    expect(s.config).toBe(CONFIGS.length)
    expect(outlineArea(formOutline(s, s.config, 'bottom', 1))).toBeCloseTo(1, 9)
    expect(outlineArea(formOutline(s, s.config, 'top', 1))).toBeCloseTo(outlineArea(formOutline(s, 1, 'top', 1)), 9)
    expect(outlineArea(formOutline(s, 1, 'bottom', 1))).toBeLessThan(1) // встроенная осталась уголком
  })
  test('замена детали у загруженной формы — на месте, с новым id (геометрия не берётся из кэша)', () => {
    st().addCustomForm({ name: 'Box', top: square(0.5), bottom: square(0.5) })
    const before = st().sign.customForms[0]
    const area0 = outlineArea(buildSign(st().sign).top)
    st().replacePiece('top', square(0.75), 'Bigger')
    const after = st().sign.customForms[0]
    expect(st().sign.customForms.length).toBe(1)
    expect(after.id).not.toBe(before.id)
    expect(outlineArea(buildSign(st().sign).top)).toBeGreaterThan(area0)
  })
  test('удаление: только загруженные; номер формы и цвета остаются согласованными', () => {
    st().setConfig(0)
    st().removeCurrentForm()
    expect(formCount(st().sign)).toBe(CONFIGS.length)
    st().addCustomForm({ name: 'A', top: square(0.5), bottom: square(0.5) })
    st().addCustomForm({ name: 'B', top: square(0.6), bottom: square(0.6) })
    st().removeCurrentForm()
    const s = st().sign
    expect(s.customForms.map((f) => f.name)).toEqual(['A'])
    expect(s.config).toBe(CONFIGS.length)
    expect(s.color.formPaints.length).toBe(formCount(s))
  })
  test('Randomize и undo работают с загруженными формами', () => {
    st().addCustomForm({ name: 'A', top: square(0.5), bottom: square(0.5) })
    const seen = new Set<number>()
    for (let i = 0; i < 60; i++) {
      st().randomize()
      seen.add(st().sign.config)
    }
    expect(seen.has(CONFIGS.length)).toBe(true)
    st().undo()
    expect(st().sign.customForms.length).toBe(1)
  })
  test('загруженная форма сохраняется в пресете и проходит проверку', () => {
    const r = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><circle cx="300" cy="100" r="80"/><rect x="0" y="200" width="200" height="200"/></svg>', 'sign')
    if (!r.ok) throw new Error(r.error)
    st().addCustomForm({ name: 'Circle', top: r.top!, bottom: r.bottom! })
    const p = parsePreset(serializePreset(st().sign))
    expect(p.ok).toBe(true)
    if (p.ok) {
      expect(p.state.customForms[0].name).toBe('Circle')
      expect(p.state.config).toBe(CONFIGS.length)
      expect(outlineArea(buildSign(p.state).top)).toBeCloseTo(outlineArea(buildSign(st().sign).top), 9)
    }
    const bad = JSON.parse(serializePreset(st().sign))
    bad.state.customForms[0].top[0][0].a.x = 1e9
    expect(parsePreset(JSON.stringify(bad)).ok).toBe(false)
  })
})
