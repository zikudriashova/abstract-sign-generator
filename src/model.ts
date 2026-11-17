import type { AnimSettings, GridState, Paint, PieceId, PieceState, Rounding, SignState, SpinSettings, View3D } from './types'
import { CONFIGS, DEFAULT_FORMS } from './geometry/configs'
import { createRng, hashSeed } from './geometry/rng'

export const solid = (color: string): Paint => ({ type: 'solid', angle: 0, stops: [{ color, at: 0 }, { color, at: 1 }] })
export const gradient = (type: 'linear' | 'radial', angle: number, ...colors: string[]): Paint => ({
  type,
  angle,
  stops: colors.map((color, i) => ({ color, at: colors.length === 1 ? 0 : i / (colors.length - 1) })),
})

export const NO_ROUNDING: Rounding = { convex: 0, concave: 0, origin: 0 }

export function basePiece(paint: Paint): PieceState {
  return { material: 'glossy', zShift: 0, rounding: { ...NO_ROUNDING }, paint }
}

export const DEFAULT_VIEW3D: View3D = {
  depth: 2,
  bevel: 0.3,
  bevelSegments: 3,
  env: 'studio',
  shadows: true,
  ortho: false,
  camera: 'iso',
  autoRotate: false,
}

export const DEFAULT_ANIM: AnimSettings = {
  mode: 'morph',
  duration: 600,
  easing: 'easeInOut',
  autoplay: false,
  interval: 2,
  order: 'sequence',
}

export const DEFAULT_SPIN: SpinSettings = { top: 0, bottom: 0, formsPerTurn: 2 }
export const SPIN_LIMIT = 3

export const ANIM_LIMITS = { duration: [150, 2000], interval: [0.5, 10] } as const

/** Детерминированно выбирает другую конфигурацию по seed. */
export function nextConfig(current: number, seed: number, count = CONFIGS.length): number {
  const others = Array.from({ length: count }, (_, i) => i).filter((i) => i !== current)
  if (!others.length) return current
  return createRng(hashSeed(seed, 'config')).pick(others)
}

/** Следующая форма для автоплея и вращения: по порядку (после последней — первая) или случайная другая. */
export function stepConfig(current: number, seed: number, count: number, order: AnimSettings['order']): number {
  if (order === 'random') return nextConfig(current, seed, count)
  return count ? (current + 1) % count : current
}

export interface Palette {
  name: string
  bg: string
  top: Paint
  bottom: Paint
}

export const PALETTES: Palette[] = [
  { name: 'Ink', bg: '#f0f0ee', top: solid('#1c1c1a'), bottom: solid('#1c1c1a') },
  { name: 'Signal', bg: '#f2efe9', top: solid('#e8402a'), bottom: solid('#1c1c1a') },
  { name: 'Night', bg: '#0e1022', top: gradient('linear', 45, '#7c5cff', '#2de2e6'), bottom: solid('#ffffff') },
  { name: 'Sunset', bg: '#1a0f1f', top: gradient('linear', 60, '#ff7a59', '#ffd166'), bottom: gradient('linear', 60, '#ff4d8d', '#7a5cff') },
  { name: 'Mint', bg: '#e9f5ef', top: solid('#0f8b6d'), bottom: solid('#12372a') },
  { name: 'Ember', bg: '#f7f3ea', top: gradient('radial', 0, '#ff9f1c', '#e71d36'), bottom: solid('#011627') },
  { name: 'Mono', bg: '#111111', top: solid('#f2f2f2'), bottom: solid('#f2f2f2') },
]

/** Заливка детали для конфигурации: своя у формы, если включены цвета по формам, иначе общая. */
export function paintOf(s: Pick<SignState, 'color' | 'top' | 'bottom' | 'config'>, id: PieceId, config = s.config): Paint {
  return s.color.perForm ? s.color.formPaints[config][id] : s[id].paint
}

/** Заливка, которой деталь рисуется: при «одном градиенте на знак» обе детали берут верхнюю. */
export const renderPaint = (s: Pick<SignState, 'color' | 'top' | 'bottom' | 'config'>, id: PieceId, config = s.config) =>
  paintOf(s, s.color.singleGradient ? 'top' : id, config)

/** Записать заливку детали туда, откуда она берётся сейчас (текущая форма или общая). */
export function withPaint(s: SignState, id: PieceId, paint: Paint): SignState {
  if (!s.color.perForm) return { ...s, [id]: { ...s[id], paint } }
  const formPaints = s.color.formPaints.map((fp, i) => (i === s.config ? { ...fp, [id]: paint } : fp))
  return { ...s, color: { ...s.color, formPaints } }
}

const luminance = (hex: string) => {
  const h = hex.length <= 5 ? [...hex.slice(1, 4)].map((x) => x + x).join('') : hex.slice(1, 7)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Раздать формам палитры по порядку: быстрый старт для цветов по формам. Фон общий,
 * поэтому берутся только палитры, рассчитанные на фон той же яркости (светлый или тёмный).
 */
export function spreadPalettes(s: SignState): SignState {
  const dark = luminance(s.color.bg) < 0.5
  const fit = PALETTES.filter((p) => luminance(p.bg) < 0.5 === dark)
  const list = fit.length ? fit : PALETTES
  return {
    ...s,
    color: { ...s.color, perForm: true, formPaints: s.color.formPaints.map((_, i) => ({ top: list[i % list.length].top, bottom: list[i % list.length].bottom })) },
  }
}

export function initialState(N: GridState['N'] = 12, palette = PALETTES[0]): SignState {
  return {
    version: 2,
    seed: 1,
    grid: { N },
    config: 0,
    forms: DEFAULT_FORMS,
    gap: 0,
    top: basePiece(palette.top),
    bottom: basePiece(palette.bottom),
    color: {
      bg: palette.bg,
      singleGradient: false,
      palette: palette.name,
      perForm: false,
      formPaints: CONFIGS.map(() => ({ top: palette.top, bottom: palette.bottom })),
    },
    view: { build: false, mode: '2d' },
    view3d: { ...DEFAULT_VIEW3D },
    anim: { ...DEFAULT_ANIM },
    spin: { ...DEFAULT_SPIN },
  }
}
