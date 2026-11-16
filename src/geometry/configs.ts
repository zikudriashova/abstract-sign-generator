import type { Contour, CustomForm, FormEntry, Outline, P, PieceId, Seg } from '../types'

/**
 * Пять конфигураций знака из docs/references/sign-collection-fin.ai.
 * Координаты сняты с векторов файла и нормированы на квадрант: Q = 1
 * (в файле квадрант 200 pt). Субпиксельная неточность отрисовки (≤ 0.5 pt у осей
 * и краёв квадранта) снята; значимые размеры оставлены как нарисованы.
 * Каждая деталь — в своей локальной системе (u,v ≥ 0, угол у O); нижняя потом
 * поворачивается на 180°.
 */

/** Толщина штриха уголка с первого артборда: 56.531 pt из 200. */
export const STROKE = 56.531 / 200
/** Радиус внутреннего скругления верхнего уголка в конфигурации 1 (≈ 86 pt). */
const INNER_R = 0.43

const p = (x: number, y: number): P => ({ x, y })
const ln = (a: P, b: P): Seg => ({ t: 'L', a, b })
const poly = (pts: [number, number][]): Contour => pts.map((q, i) => ln(p(...q), p(...pts[(i + 1) % pts.length])))
const square = (x: number, y: number, s: number) => poly([[x, y], [x + s, y], [x + s, y + s], [x, y + s]])

/** L во весь квадрант с толщиной t, острый. */
const angle = (t: number): Outline => [poly([[0, 0], [1, 0], [1, t], [t, t], [t, 1], [0, 1]])]

/** 1: L во весь квадрант, внутренний угол скруглён дугой. */
function angleRounded(t: number, r: number): Outline {
  return [
    [
      ln(p(0, 0), p(1, 0)),
      ln(p(1, 0), p(1, t)),
      ln(p(1, t), p(t + r, t)),
      { t: 'A', a: p(t + r, t), b: p(t, t + r), c: p(t + r, t + r), r, ccw: false },
      ln(p(t, t + r), p(t, 1)),
      ln(p(t, 1), p(0, 1)),
      ln(p(0, 1), p(0, 0)),
    ],
  ]
}

/** 2: четыре квадрата ⅓ на сетке 3×3 — клетки (0,0), (1,1), (0,2), (2,0); касаются углами. */
const checker = (): Outline => {
  const s = 1 / 3
  return [square(0, 0, s), square(s, s, s), square(0, 2 * s, s), square(2 * s, 0, s)]
}

/** 3: квадрат с треугольным вырезом от левой стороны почти до центра. */
const notched = (): Outline => [poly([[0, 0], [1, 0], [1, 1], [0, 1], [0.4768, 0.5057]])]

/** 4: «капля» — круг диаметром Q и острый угол у O; дуга 270° разбита на три четверти. */
function drop(): Outline {
  const c = p(0.5, 0.5),
    r = 0.5
  const arc = (a: P, b: P): Seg => ({ t: 'A', a, b, c, r, ccw: true })
  return [[ln(p(0, 0), p(0.5, 0)), arc(p(0.5, 0), p(1, 0.5)), arc(p(1, 0.5), p(0.5, 1)), arc(p(0.5, 1), p(0, 0.5)), ln(p(0, 0.5), p(0, 0))]]
}

/** 5: прямоугольный треугольник с катетами Q. */
const wedge = (): Outline => [poly([[0, 0], [1, 0], [0, 1]])]

export interface SignConfig {
  name: string
  top: () => Outline
}

/** Нижняя деталь у всех конфигураций одна — острый уголок с первого артборда, поэтому при смене она не двигается. */
const bottom = (): Outline => angle(STROKE)

export const CONFIGS: SignConfig[] = [
  { name: 'L with inner curve', top: () => angleRounded(STROKE, INNER_R) },
  { name: 'Checker squares', top: checker },
  { name: 'Notched square', top: notched },
  { name: 'Drop', top: drop },
  { name: 'Wedge', top: wedge },
]

const scaleOutline = (o: Outline, N: number): Outline => {
  const s = (q: P): P => ({ x: q.x * N, y: q.y * N })
  return o.map((contour) =>
    contour.map((g): Seg => (g.t === 'L' ? { t: 'L', a: s(g.a), b: s(g.b) } : { ...g, a: s(g.a), b: s(g.b), c: s(g.c), r: g.r * N })),
  )
}

/** Контур детали встроенной конфигурации в локальных координатах, масштаб — N модулей на квадрант. */
export function configOutline(config: number, id: PieceId, N: number): Outline {
  const c = CONFIGS[Math.max(0, Math.min(CONFIGS.length - 1, config))]
  return scaleOutline(id === 'top' ? c.top() : bottom(), N)
}

// ---------- все формы знака: список forms в состоянии ----------

type WithForms = { forms: FormEntry[] }

/** Стартовый список: пять встроенных форм по порядку. */
export const DEFAULT_FORMS: FormEntry[] = CONFIGS.map((_, index) => ({ kind: 'builtin', index }))

export const formCount = (s: WithForms) => s.forms.length
const entry = (s: WithForms, i: number): FormEntry => s.forms[Math.max(0, Math.min(s.forms.length - 1, i))]
export const isCustom = (s: WithForms, i: number) => entry(s, i)?.kind === 'custom'
/** Номер в названии — позиция в списке, поэтому после удаления формы нумерация сдвигается. */
export const formName = (s: WithForms, i: number) => {
  const e = entry(s, i)
  return `${i + 1} · ${e.kind === 'builtin' ? CONFIGS[e.index].name : e.name}`
}
/** Ключ формы для кэша геометрии: встроенные — по номеру в CONFIGS, загруженные — по id. */
export const formKey = (s: WithForms, i: number) => {
  const e = entry(s, i)
  return e.kind === 'builtin' ? `b${e.index}` : `c:${e.id}`
}

/** Контур детали любой формы, масштаб — N модулей на квадрант. */
export function formOutline(s: WithForms, i: number, id: PieceId, N: number): Outline {
  const e = entry(s, i)
  return e.kind === 'builtin' ? configOutline(e.index, id, N) : scaleOutline(e[id], N)
}

/** Детали формы в единицах квадранта — основа, когда в форме заменяют одну деталь файлом. */
export const unitForm = (s: WithForms, i: number): Pick<CustomForm, 'top' | 'bottom'> => ({ top: formOutline(s, i, 'top', 1), bottom: formOutline(s, i, 'bottom', 1) })

export const customCount = (s: WithForms) => s.forms.filter((f) => f.kind === 'custom').length
