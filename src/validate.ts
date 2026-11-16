import type { AnimSettings, Contour, CustomForm, Easing, EnvPreset, MaterialPreset, Outline, P, Paint, PieceState, Seg, SignState } from './types'
import { CONFIGS } from './geometry/configs'
import { MAX_CUSTOM_FORMS, MAX_SEGMENTS } from './import/limits'
import { GRID_SIZES } from './geometry/grid'
import { ANIM_LIMITS, DEFAULT_ANIM, DEFAULT_SPIN, DEFAULT_VIEW3D, SPIN_LIMIT, initialState } from './model'

type Obj = Record<string, unknown>

const MATERIALS: MaterialPreset[] = ['matte', 'glossy', 'metal', 'glass', 'clay', 'emissive']
const ENVS: EnvPreset[] = ['studio', 'warm', 'cool', 'contrast']
const EASINGS: Easing[] = ['linear', 'easeInOut', 'expoOut', 'backOut']

const fail = (msg: string): never => {
  throw new Error(msg)
}
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function num(v: unknown, lo: number, hi: number, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return fail(`${name}: expected a number from ${lo} to ${hi}`)
  return v
}
const int = (v: unknown, lo: number, hi: number, name: string) => Math.round(num(v, lo, hi, name))
const bool = (v: unknown, name: string): boolean => (typeof v === 'boolean' ? v : fail(`${name}: expected true or false`))
function oneOf<T extends string | number>(v: unknown, list: readonly T[], name: string): T {
  return list.includes(v as T) ? (v as T) : fail(`${name}: allowed values: ${list.join(', ')}`)
}
/** Цвета попадают в SVG как строки, поэтому принимаем только hex — это закрывает инъекцию разметки. */
function color(v: unknown, name: string): string {
  return typeof v === 'string' && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : fail(`${name}: expected a hex color like #rrggbb`)
}

function paint(raw: unknown, name: string): Paint {
  if (!isObj(raw)) return fail(`${name}: expected an object`)
  const stops = raw.stops
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > 3) return fail(`${name}.stops: 2–3 stops required`)
  return {
    type: oneOf(raw.type, ['solid', 'linear', 'radial'] as const, `${name}.type`),
    angle: num(raw.angle, -720, 720, `${name}.angle`),
    stops: stops.map((s, i) => {
      if (!isObj(s)) return fail(`${name}.stops[${i}]: expected an object`)
      return { color: color(s.color, `${name}.stops[${i}].color`), at: num(s.at, 0, 1, `${name}.stops[${i}].at`) }
    }),
  }
}

function point(v: unknown, name: string): P {
  if (!isObj(v)) return fail(`${name}: expected a point`)
  return { x: num(v.x, -4, 4, `${name}.x`), y: num(v.y, -4, 4, `${name}.y`) }
}

/** Контуры загруженной детали: только отрезки и дуги с конечными координатами в разумных пределах. */
function outline(raw: unknown, name: string): Outline {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500) return fail(`${name}: expected 1–500 contours`)
  let total = 0
  const out = raw.map((c, i): Contour => {
    if (!Array.isArray(c) || c.length < 2) return fail(`${name}[${i}]: expected a contour of 2+ segments`)
    total += c.length
    if (total > MAX_SEGMENTS) fail(`${name}: more than ${MAX_SEGMENTS} segments`)
    return c.map((sg, j): Seg => {
      const n = `${name}[${i}][${j}]`
      if (!isObj(sg)) return fail(`${n}: expected a segment`)
      if (sg.t === 'L') return { t: 'L', a: point(sg.a, `${n}.a`), b: point(sg.b, `${n}.b`) }
      if (sg.t === 'A')
        return { t: 'A', a: point(sg.a, `${n}.a`), b: point(sg.b, `${n}.b`), c: point(sg.c, `${n}.c`), r: num(sg.r, 1e-6, 8, `${n}.r`), ccw: bool(sg.ccw, `${n}.ccw`) }
      return fail(`${n}.t: L or A`)
    })
  })
  return out
}

function customForm(raw: unknown, name: string): CustomForm {
  if (!isObj(raw)) return fail(`${name}: expected an object`)
  const id = typeof raw.id === 'string' && /^[a-z0-9]{1,16}$/.test(raw.id) ? raw.id : fail(`${name}.id: expected a short id`)
  const title = typeof raw.name === 'string' ? raw.name.slice(0, 60) : fail(`${name}.name: expected a string`)
  return { id, name: title, top: outline(raw.top, `${name}.top`), bottom: outline(raw.bottom, `${name}.bottom`) }
}

function piece(raw: unknown, base: PieceState, name: string): PieceState {
  if (!isObj(raw)) return fail(`${name}: expected an object`)
  const r = isObj(raw.rounding) ? raw.rounding : fail(`${name}.rounding: expected an object`)
  return {
    material: raw.material === undefined ? base.material : oneOf(raw.material, MATERIALS, `${name}.material`),
    zShift: raw.zShift === undefined ? base.zShift : num(raw.zShift, -64, 64, `${name}.zShift`),
    rounding: {
      convex: num(r.convex, 0, 64, `${name}.rounding.convex`),
      concave: num(r.concave, 0, 64, `${name}.rounding.concave`),
      origin: num(r.origin, 0, 64, `${name}.rounding.origin`),
    },
    paint: paint(raw.paint, `${name}.paint`),
  }
}

/**
 * Строго проверяет произвольный JSON и собирает из него SignState (недостающие необязательные поля — по умолчанию).
 * Бросает Error с понятным сообщением. Используется для импорта пресетов, избранного и автосохранения.
 */
export function validateState(raw: unknown): SignState {
  if (!isObj(raw)) return fail('state: expected an object')
  if (raw.version !== 2) return fail(`version: ${String(raw.version)} is from an older generator; only 2 is supported`)
  if (!isObj(raw.grid)) return fail('grid: expected an object')
  const N = oneOf(raw.grid.N, GRID_SIZES, 'grid.N')
  const base = initialState(N)

  const cf = raw.customForms
  if (cf !== undefined && (!Array.isArray(cf) || cf.length > MAX_CUSTOM_FORMS)) fail(`customForms: expected up to ${MAX_CUSTOM_FORMS} forms`)
  const customForms = Array.isArray(cf) ? cf.map((f, i) => customForm(f, `customForms[${i}]`)) : []
  const count = CONFIGS.length + customForms.length

  const out: SignState = {
    ...base,
    seed: raw.seed === undefined ? base.seed : int(raw.seed, 0, 2 ** 32, 'seed'),
    config: int(raw.config, 0, count - 1, 'config'),
    customForms,
    gap: raw.gap === undefined ? 0 : num(raw.gap, -64, 64, 'gap'),
    top: piece(raw.top, base.top, 'top'),
    bottom: piece(raw.bottom, base.bottom, 'bottom'),
  }

  if (isObj(raw.color)) {
    const fp = raw.color.formPaints
    if (fp !== undefined && (!Array.isArray(fp) || fp.length !== count)) fail(`color.formPaints: expected ${count} entries`)
    out.color = {
      bg: color(raw.color.bg ?? base.color.bg, 'color.bg'),
      singleGradient: raw.color.singleGradient === undefined ? false : bool(raw.color.singleGradient, 'color.singleGradient'),
      palette: typeof raw.color.palette === 'string' ? raw.color.palette.slice(0, 40) : 'custom',
      perForm: raw.color.perForm === undefined ? false : bool(raw.color.perForm, 'color.perForm'),
      formPaints: Array.isArray(fp)
        ? fp.map((e, i) => {
            if (!isObj(e)) return fail(`color.formPaints[${i}]: expected an object`)
            return { top: paint(e.top, `color.formPaints[${i}].top`), bottom: paint(e.bottom, `color.formPaints[${i}].bottom`) }
          })
        : Array.from({ length: count }, () => ({ top: out.top.paint, bottom: out.bottom.paint })),
    }
  } else out.color = { ...base.color, formPaints: Array.from({ length: count }, () => ({ top: out.top.paint, bottom: out.bottom.paint })) }
  if (isObj(raw.spin)) {
    const v = raw.spin
    out.spin = {
      top: num(v.top ?? DEFAULT_SPIN.top, -SPIN_LIMIT, SPIN_LIMIT, 'spin.top'),
      bottom: num(v.bottom ?? DEFAULT_SPIN.bottom, -SPIN_LIMIT, SPIN_LIMIT, 'spin.bottom'),
      formsPerTurn: oneOf(v.formsPerTurn ?? DEFAULT_SPIN.formsPerTurn, [0, 1, 2, 4] as const, 'spin.formsPerTurn'),
    }
  }
  if (isObj(raw.view3d)) {
    const v = raw.view3d
    const d = DEFAULT_VIEW3D
    out.view3d = {
      depth: num(v.depth ?? d.depth, 0.1, 64, 'view3d.depth'),
      bevel: num(v.bevel ?? d.bevel, 0, 16, 'view3d.bevel'),
      bevelSegments: int(v.bevelSegments ?? d.bevelSegments, 0, 16, 'view3d.bevelSegments'),
      env: oneOf(v.env ?? d.env, ENVS, 'view3d.env'),
      shadows: bool(v.shadows ?? d.shadows, 'view3d.shadows'),
      ortho: bool(v.ortho ?? d.ortho, 'view3d.ortho'),
      camera: oneOf(v.camera ?? d.camera, ['front', 'iso'] as const, 'view3d.camera'),
      autoRotate: bool(v.autoRotate ?? d.autoRotate, 'view3d.autoRotate'),
    }
  }
  if (isObj(raw.anim)) {
    const a = raw.anim
    const d: AnimSettings = DEFAULT_ANIM
    out.anim = {
      mode: oneOf(a.mode ?? d.mode, ['cut', 'morph'] as const, 'anim.mode'),
      duration: num(a.duration ?? d.duration, ANIM_LIMITS.duration[0], ANIM_LIMITS.duration[1], 'anim.duration'),
      easing: oneOf(a.easing ?? d.easing, EASINGS, 'anim.easing'),
      autoplay: bool(a.autoplay ?? d.autoplay, 'anim.autoplay'),
      interval: num(a.interval ?? d.interval, ANIM_LIMITS.interval[0], ANIM_LIMITS.interval[1], 'anim.interval'),
    }
  }
  // вид (2D/3D, построение) — настройка интерфейса, а не знака: остаётся по умолчанию
  return out
}
