import { beforeEach, describe, expect, test } from 'vitest'
import { useSign } from './useSign'
import { initialState } from '../model'
import { CONFIGS, formCount, formName, formOutline, isCustom } from '../geometry/configs'
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
const custom = () => st().sign.forms.flatMap((f) => (f.kind === 'custom' ? [f] : []))
const consistent = () => {
  const s = st().sign
  expect(s.color.formPaints.length).toBe(formCount(s))
  expect(s.config).toBeGreaterThanOrEqual(0)
  expect(s.config).toBeLessThan(formCount(s))
}

beforeEach(() => useSign.setState({ sign: initialState(12), past: [], future: [] }))

describe('загруженные формы', () => {
  test('новая форма добавляется в конец, на неё переключаемся', () => {
    st().setConfig(2)
    st().addCustomForm({ name: 'Box', top: square(0.5), bottom: square(0.25) })
    const s = st().sign
    expect(formCount(s)).toBe(CONFIGS.length + 1)
    expect(s.config).toBe(CONFIGS.length)
    expect(formName(s, s.config)).toBe('6 · Box')
    expect(outlineArea(buildSign(s).top)).toBeCloseTo(0.25 * 144, 6)
    consistent()
  })
  test('замена детали у встроенной формы создаёт копию, встроенная не меняется', () => {
    st().setConfig(1)
    st().replacePiece('bottom', square(1), 'Full')
    const s = st().sign
    expect(isCustom(s, s.config)).toBe(true)
    expect(outlineArea(formOutline(s, s.config, 'bottom', 1))).toBeCloseTo(1, 9)
    expect(outlineArea(formOutline(s, s.config, 'top', 1))).toBeCloseTo(outlineArea(formOutline(s, 1, 'top', 1)), 9)
    expect(outlineArea(formOutline(s, 1, 'bottom', 1))).toBeLessThan(1)
    consistent()
  })
  test('замена детали у загруженной формы — на месте, с новым id (геометрия не из кэша)', () => {
    st().addCustomForm({ name: 'Box', top: square(0.5), bottom: square(0.5) })
    const before = custom()[0]
    const area0 = outlineArea(buildSign(st().sign).top)
    st().replacePiece('top', square(0.75), 'Bigger')
    expect(custom().length).toBe(1)
    expect(custom()[0].id).not.toBe(before.id)
    expect(outlineArea(buildSign(st().sign).top)).toBeGreaterThan(area0)
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
    expect(custom().length).toBe(1)
  })
})

describe('удаление форм', () => {
  test('встроенную форму можно удалить; номера в названиях сдвигаются', () => {
    st().setConfig(1) // «2 · Checker squares»
    expect(st().removeCurrentForm()).toBe(true)
    const s = st().sign
    expect(formCount(s)).toBe(CONFIGS.length - 1)
    expect(formName(s, 1)).toBe('2 · Notched square')
    expect(s.config).toBe(1) // на место удалённой встала следующая
    consistent()
  })
  test('удаление последней в списке выбирает предыдущую; последнюю оставшуюся удалить нельзя', () => {
    st().setConfig(4)
    st().removeCurrentForm()
    expect(st().sign.config).toBe(3)
    for (let i = 0; i < 10; i++) st().removeCurrentForm()
    expect(formCount(st().sign)).toBe(1)
    expect(st().removeCurrentForm()).toBe(false)
    consistent()
  })
  test('цвета по формам остаются за своими формами после удаления', () => {
    st().update((s) => ({ ...s, color: { ...s.color, perForm: true, formPaints: s.color.formPaints.map((fp, i) => ({ ...fp, top: { ...fp.top, stops: [{ color: `#00000${i}`, at: 0 }, { color: '#000000', at: 1 }] } })) } }))
    st().setConfig(1)
    st().removeCurrentForm()
    expect(st().sign.color.formPaints.map((fp) => fp.top.stops[0].color)).toEqual(['#000000', '#000002', '#000003', '#000004'])
  })
  test('Restore built-in forms возвращает удалённые в начало, текущая остаётся выбранной', () => {
    st().addCustomForm({ name: 'A', top: square(0.5), bottom: square(0.5) })
    st().setConfig(0)
    st().removeCurrentForm()
    st().setConfig(2)
    st().removeCurrentForm()
    st().setConfig(formCount(st().sign) - 1) // загруженная «A»
    expect(st().restoreBuiltins()).toBe(2)
    const s = st().sign
    expect(formCount(s)).toBe(CONFIGS.length + 1)
    expect(formName(s, s.config)).toMatch(/· A$/)
    expect(s.forms.slice(0, 2)).toEqual([{ kind: 'builtin', index: 0 }, { kind: 'builtin', index: 3 }])
    expect(st().restoreBuiltins()).toBe(0)
    consistent()
  })
  test('удаление отменяется undo', () => {
    st().setConfig(3)
    st().removeCurrentForm()
    st().undo()
    expect(formCount(st().sign)).toBe(CONFIGS.length)
    expect(st().sign.config).toBe(3)
  })
})

describe('пресеты', () => {
  test('список форм (с удалёнными встроенными и загруженной) сохраняется и проверяется', () => {
    const r = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><circle cx="300" cy="100" r="80"/><rect x="0" y="200" width="200" height="200"/></svg>', 'sign')
    if (!r.ok) throw new Error(r.error)
    st().addCustomForm({ name: 'Circle', top: r.top!, bottom: r.bottom! })
    st().setConfig(0)
    st().removeCurrentForm()
    st().setConfig(formCount(st().sign) - 1)
    const p = parsePreset(serializePreset(st().sign))
    expect(p.ok).toBe(true)
    if (p.ok) {
      expect(p.state.forms).toEqual(st().sign.forms)
      expect(outlineArea(buildSign(p.state).top)).toBeCloseTo(outlineArea(buildSign(st().sign).top), 9)
    }
    for (const mutate of [
      (x: any) => (x.state.forms[0] = { kind: 'builtin', index: 9 }),
      (x: any) => x.state.forms.push({ kind: 'builtin', index: 1 }), // дубль встроенной
      (x: any) => (x.state.forms = []),
      (x: any) => (x.state.forms.at(-1).top[0][0].a.x = 1e9),
    ]) {
      const bad = JSON.parse(serializePreset(st().sign))
      mutate(bad)
      expect(parsePreset(JSON.stringify(bad)).ok).toBe(false)
    }
  })
  test('старый пресет с customForms читается: пять встроенных + загруженные', () => {
    const legacy = JSON.parse(serializePreset(st().sign))
    delete legacy.state.forms
    legacy.state.customForms = [{ id: 'abc', name: 'Old', top: square(0.5), bottom: square(0.5) }]
    legacy.state.config = 5
    legacy.state.color.formPaints = [...legacy.state.color.formPaints, legacy.state.color.formPaints[0]]
    const p = parsePreset(JSON.stringify(legacy))
    expect(p.ok).toBe(true)
    if (p.ok) {
      expect(formCount(p.state)).toBe(6)
      expect(formName(p.state, 5)).toBe('6 · Old')
    }
  })
})

describe('порядок смены форм', () => {
  const setOrder = (order: 'sequence' | 'random') => st().update((s) => ({ ...s, anim: { ...s.anim, order } }))
  test('по умолчанию — по порядку 1-2-3…, после последней снова первая; ← идёт назад', () => {
    expect(st().sign.anim.order).toBe('sequence')
    const seen = [st().sign.config]
    for (let i = 0; i < CONFIGS.length; i++) {
      st().next()
      seen.push(st().sign.config)
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 0])
    st().prev()
    expect(st().sign.config).toBe(CONFIGS.length - 1)
  })
  test('вращение тоже идёт по порядку и не пишет в историю', () => {
    st().setConfig(3)
    const past = st().past.length
    st().advanceForm()
    expect(st().sign.config).toBe(4)
    st().advanceForm()
    expect(st().sign.config).toBe(0)
    expect(st().past.length).toBe(past)
  })
  test('случайный порядок: каждый раз другая форма', () => {
    setOrder('random')
    for (let i = 0; i < 20; i++) {
      const before = st().sign.config
      i % 2 ? st().next() : st().advanceForm()
      expect(st().sign.config).not.toBe(before)
      consistent()
    }
  })
  test('порядок сохраняется в пресете; в старом пресете его нет — по порядку', () => {
    setOrder('random')
    const order = (text: string) => {
      const p = parsePreset(text)
      if (!p.ok) throw new Error(p.error)
      return p.state.anim.order
    }
    expect(order(serializePreset(st().sign))).toBe('random')
    const old = JSON.parse(serializePreset(st().sign))
    delete old.state.anim.order
    expect(order(JSON.stringify(old))).toBe('sequence')
  })
})
