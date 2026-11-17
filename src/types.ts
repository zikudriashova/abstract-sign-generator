// Чистые типы данных. Геометрия считается в модулях сетки, в локальной системе
// квадранта: u,v >= 0, деталь касается начала координат O = (0,0).

export interface P {
  x: number
  y: number
}

export type Seg =
  | { t: 'L'; a: P; b: P }
  | { t: 'A'; a: P; b: P; c: P; r: number; ccw: boolean }

/** Замкнутый контур; материал слева по ходу обхода. */
export type Contour = Seg[]
/** Внешние контуры (площадь > 0) и дырки (площадь < 0). */
export type Outline = Contour[]

export interface GridState {
  /** число модулей на сторону квадранта */
  N: 6 | 8 | 12 | 16
}

export interface Rounding {
  /** радиус выпуклых углов, модули */
  convex: number
  /** радиус вогнутых углов, модули */
  concave: number
  /** радиус выпуклого угла в точке O (переопределяет convex) */
  origin: number
}

export interface Stop {
  color: string
  at: number
}
export interface Paint {
  type: 'solid' | 'linear' | 'radial'
  /** градусы, 0 — вправо, 90 — вверх */
  angle: number
  stops: Stop[]
}

export type MaterialPreset = 'matte' | 'glossy' | 'metal' | 'glass' | 'clay' | 'emissive'
export type EnvPreset = 'studio' | 'warm' | 'cool' | 'contrast'

export interface View3D {
  /** глубина экструзии, модули */
  depth: number
  /** размер фаски, модули */
  bevel: number
  bevelSegments: number
  env: EnvPreset
  shadows: boolean
  ortho: boolean
  camera: 'front' | 'iso'
  autoRotate: boolean
}

/** Оформление детали; форма задаётся конфигурацией знака. */
export interface PieceState {
  material: MaterialPreset
  /** сдвиг детали по Z, модули */
  zShift: number
  rounding: Rounding
  paint: Paint
}

export type PieceId = 'top' | 'bottom'

export type Easing = 'linear' | 'easeInOut' | 'expoOut' | 'backOut'

export interface AnimSettings {
  /** резкая смена формы или плавный морфинг */
  mode: 'cut' | 'morph'
  /** длительность морфинга, мс (150–2000) */
  duration: number
  easing: Easing
  /** новая конфигурация каждые interval секунд */
  autoplay: boolean
  interval: number
  /** как автоплей и вращение выбирают следующую форму: по порядку списка (по кругу) или случайно */
  order: 'sequence' | 'random'
}

/** Вращение деталей вокруг вертикали через O (только 3D). Скорость — обороты в секунду, знак — направление. */
export interface SpinSettings {
  top: number
  bottom: number
  /** сколько раз за оборот меняется форма верхней детали (0 — не меняется); первая смена — когда деталь стоит ребром */
  formsPerTurn: 0 | 1 | 2 | 4
}

/** Форма, загруженная из SVG: контуры деталей в локальных координатах квадранта, квадрант = 1. */
export interface CustomForm {
  id: string
  name: string
  top: Outline
  bottom: Outline
}

/** Форма в списке знака: встроенная (ссылка на CONFIGS) или загруженная из SVG. */
export type FormEntry = { kind: 'builtin'; index: number } | ({ kind: 'custom' } & CustomForm)

export interface SignState {
  version: 2
  seed: number
  grid: GridState
  /** номер текущей формы в списке forms */
  config: number
  /** формы знака по порядку: встроенные и загруженные; любую можно удалить, кроме последней */
  forms: FormEntry[]
  gap: number
  top: PieceState
  bottom: PieceState
  color: {
    bg: string
    singleGradient: boolean
    palette: string
    /** свои цвета деталей у каждой конфигурации (иначе — общие из top/bottom.paint) */
    perForm: boolean
    /** заливки деталей по конфигурациям, длина = числу конфигураций */
    formPaints: Record<PieceId, Paint>[]
  }
  view: { build: boolean; mode: '2d' | '3d' }
  view3d: View3D
  anim: AnimSettings
  spin: SpinSettings
}
