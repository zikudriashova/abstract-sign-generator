import { describe, expect, test } from 'vitest'
import { importSvg, parsePathData } from './svgImport'
import { configOutline } from '../geometry/configs'
import { contourArea, outlineArea, outlineBBox } from '../geometry/outline'
import { outlineToPathD } from '../geometry/serialize'
import type { Outline } from '../types'

const svg = (body: string, vb = '0 0 400 400') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>`
const ok = (r: ReturnType<typeof importSvg>) => {
  if (!r.ok) throw new Error(r.error)
  return r
}
const closed = (o: Outline) => {
  for (const c of o)
    for (let i = 0; i < c.length; i++) {
      const s = c[i],
        n = c[(i + 1) % c.length]
      expect(Math.hypot(s.b.x - n.a.x, s.b.y - n.a.y)).toBeLessThan(1e-9)
    }
}

/** Артборды 1 и 4 из sign-collection-fin.ai — те же пути и система координат, что в PDF внутри .ai. */
const PDF = 'matrix(1 0 0 -1 0 400)'
const ARTBOARD_1 = svg(`<g transform="${PDF}">
  <path transform="translate(256.5314 200.355)" d="M0 0 L143.106 0 L143.106 56.531 L85.946 56.531 C38.482 56.531 0 95.013 0 142.478 L0 199.637 L-56.531 199.637 L-56.531 0 Z"/>
  <path transform="translate(143.4686 143.6182)" d="M0 0 L0 -143.626 L56.531 -143.626 L56.531 0 L56.531 56.737 L0 56.737 L-143.106 56.737 L-143.106 0 Z"/>
</g>`)
const ARTBOARD_4 = svg(`<g transform="${PDF}">
  <path transform="translate(299.3686 400)" d="M0 0 C55.527 0 100.541 -45.014 100.541 -100.541 C100.541 -153.996 58.824 -197.705 6.17 -200.893 L6.17 -201.444 L-100.541 -201.444 L-100.541 -96.185 L-100.445 -96.185 C-98.165 -42.678 -54.068 0 0 0 Z"/>
  <path transform="translate(142.4213 142.8484)" d="M0 0 0 -142.848 56.225 -142.848 56.225 0 56.225 56.43 0 56.43 -142.331 56.43 -142.331 0z"/>
</g>`)

describe('импорт целого знака из файлов Illustrator', () => {
  test('артборд 1 → совпадает со встроенной конфигурацией 1; скругление стало настоящей дугой', () => {
    const r = ok(importSvg(ARTBOARD_1, 'sign'))
    const top = r.top!,
      bottom = r.bottom!
    closed(top)
    closed(bottom)
    expect(outlineArea(top)).toBeCloseTo(outlineArea(configOutline(0, 'top', 1)), 2)
    expect(outlineArea(bottom)).toBeCloseTo(outlineArea(configOutline(0, 'bottom', 1)), 2)
    // деталь касается O и лежит в своём квадранте; края подравнены к осям и границе
    expect(outlineBBox(top)).toMatchObject({ x0: 0, y0: 0, x1: 1, y1: 1 })
    expect(outlineBBox(bottom)).toMatchObject({ x0: 0, y0: 0, x1: 1, y1: 1 })
    const arcs = top.flat().filter((s) => s.t === 'A')
    expect(arcs.length).toBe(1)
    expect(arcs[0].t === 'A' && arcs[0].r).toBeCloseTo(0.43, 2)
    expect(r.warnings).toEqual([])
  })
  test('артборд 4 (капля) → площадь как у конфигурации 4, контур замкнут, без лишних сегментов', () => {
    const r = ok(importSvg(ARTBOARD_4, 'sign'))
    closed(r.top!)
    expect(outlineArea(r.top!)).toBeCloseTo(outlineArea(configOutline(3, 'top', 1)), 1)
    expect(r.top!.flat().length).toBeLessThan(80)
    expect(outlineToPathD(r.top!)).not.toContain('NaN')
  })
})

describe('фигуры и кривые', () => {
  test('круг → две настоящие полуокружности', () => {
    const r = ok(importSvg(svg('<circle cx="300" cy="100" r="80"/>'), 'sign'))
    const segs = r.top!.flat()
    expect(segs.every((s) => s.t === 'A')).toBe(true)
    expect(outlineArea(r.top!)).toBeCloseTo(Math.PI * 0.4 * 0.4, 6)
  })
  test('прямоугольник со скруглением: rx → дуги, прямые — отрезки', () => {
    const r = ok(importSvg(svg('<rect x="200" y="0" width="200" height="200" rx="40"/>'), 'sign'))
    const segs = r.top!.flat()
    expect(segs.filter((s) => s.t === 'A').length).toBe(4)
    expect(segs.filter((s) => s.t === 'L').length).toBe(4)
    expect(outlineArea(r.top!)).toBeCloseTo(1 - 4 * 0.04 * (1 - Math.PI / 4), 6)
  })
  test('составной путь с дыркой (evenodd и nonzero): дырка — по часовой, площадь вычитается', () => {
    for (const rule of ['evenodd', 'nonzero']) {
      // внутренний квадрат обходится в обратную сторону — дырка при обоих правилах
      const d = 'M200 0H400V200H200Z M250 50V150H350V50Z'
      const r = ok(importSvg(svg(`<path fill-rule="${rule}" d="${d}"/>`), 'sign'))
      expect(r.top!.length).toBe(2)
      expect(r.top!.filter((c) => contourArea(c) < 0).length).toBe(1)
      expect(outlineArea(r.top!)).toBeCloseTo(1 - 0.25, 6)
    }
  })
  test('свободная кривая Безье дробится: контур замкнут, площадь точная, сегментов разумно', () => {
    // «капля» из двух несимметричных кубик
    const r = ok(importSvg(svg('<path d="M200 200 C260 40 380 20 390 120 C395 170 320 210 200 200Z"/>'), 'sign'))
    closed(r.top!)
    expect(r.top!.flat().length).toBeLessThan(400)
    expect(outlineArea(r.top!)).toBeGreaterThan(0.1)
  })
  test('transform: rotate и scale учитываются', () => {
    const r = ok(importSvg(svg('<g transform="rotate(90 300 100)"><rect x="250" y="50" width="100" height="100"/></g>'), 'sign'))
    expect(outlineArea(r.top!)).toBeCloseTo(0.25, 6)
    const s = ok(importSvg(svg('<g transform="translate(200 0) scale(2)"><rect width="100" height="100"/></g>'), 'sign'))
    expect(outlineBBox(s.top!)).toMatchObject({ x0: 0, y0: 0, x1: 1, y1: 1 })
  })
  test('разбор path: относительные команды, H/V, S, Q/T, A со слитными флагами', () => {
    const subs = parsePathData('m10 10h20v20h-20z M0 0 c1 1 2 2 3 3 s4 4 5 5 q1 1 2 2 t3 3 a5 5 0 0110 0')
    expect(subs.length).toBe(2)
    expect(subs[0].items.length).toBe(3)
    expect(subs[1].items.filter((i) => i.k === 'C').length).toBeGreaterThanOrEqual(5)
  })
})

describe('что пропускается и чем ругается', () => {
  test('обводки без заливки, текст и картинки пропускаются с предупреждением', () => {
    const r = ok(
      importSvg(svg('<rect x="200" y="0" width="200" height="200"/><rect x="0" y="0" width="100" height="100" fill="none" stroke="#000"/><text x="0" y="10">hi</text><image href="x.png"/>'), 'sign'),
    )
    expect(r.warnings.join(' ')).toMatch(/stroke-only/)
    expect(r.warnings.join(' ')).toMatch(/text/)
    expect(r.warnings.join(' ')).toMatch(/raster/)
  })
  test('фигуры во второй и четвёртой четвертях пропускаются; пустая четверть — предупреждение', () => {
    const r = ok(importSvg(svg('<rect x="220" y="20" width="100" height="100"/><rect x="20" y="20" width="100" height="100"/>'), 'sign'))
    expect(r.top).toBeDefined()
    expect(r.bottom).toBeUndefined()
    expect(r.warnings.join(' ')).toMatch(/1 shape/)
    expect(r.warnings.join(' ')).toMatch(/bottom-left quarter is empty/)
  })
  test('скрипты и обработчики не исполняются и не влияют на геометрию', () => {
    const r = ok(importSvg(svg('<script>alert(1)</script><rect x="200" y="0" width="200" height="200" onload="alert(1)"/>'), 'sign'))
    expect(outlineArea(r.top!)).toBeCloseTo(1, 9)
  })
  test('ошибки: не SVG, нет фигур, нет артборда, всё вне нужных четвертей', () => {
    expect(importSvg('<html></html>', 'sign').ok).toBe(false)
    expect(importSvg('не xml <<<', 'sign').ok).toBe(false)
    expect(importSvg(svg('<g/>'), 'sign').ok).toBe(false)
    expect(importSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="5" height="5"/></svg>', 'sign').ok).toBe(false)
    expect(importSvg(svg('<rect x="20" y="20" width="100" height="100"/>'), 'sign').ok).toBe(false)
  })
})

describe('одна деталь из файла', () => {
  test('верхняя: габарит вписывается в квадрант, левый нижний угол — в O', () => {
    const r = ok(importSvg(svg('<path d="M50 300 L150 300 L150 200 L120 200 L120 270 L50 270 Z"/>', '0 0 1000 1000'), 'top'))
    expect(outlineBBox(r.top!)).toMatchObject({ x0: 0, y0: 0, x1: 1 })
    expect(r.bottom).toBeUndefined()
  })
  test('нижняя: в O приходится правый верхний угол габарита (как деталь стоит в знаке)', () => {
    // уголок ┐ : правый верхний угол — внешний угол детали
    const r = ok(importSvg(svg('<path d="M0 0H100V100H70V30H0Z"/>', '0 0 100 100'), 'bottom'))
    const o = r.bottom!
    expect(outlineBBox(o)).toMatchObject({ x0: 0, y0: 0, x1: 1, y1: 1 })
    // в локальных координатах нижней детали внешний угол — в точке O
    expect(o.some((c) => c.some((s) => Math.abs(s.a.x) < 1e-9 && Math.abs(s.a.y) < 1e-9))).toBe(true)
    expect(outlineArea(o)).toBeCloseTo(1 - 0.7 * 0.7, 6)
  })
})
