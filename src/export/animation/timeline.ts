import type { Outline, Paint, PieceId, SignState } from '../../types'
import { formCount } from '../../geometry/configs'
import { buildSign } from '../../geometry/sign'
import { renderPaint } from '../../model'
import { EASINGS, type Ring, lerpRings, matchRings, outlineToRings, ringsToOutline } from '../../anim/morph'
import { lerpPaint } from '../../anim/paint'

type Pieces<T> = Record<PieceId, T>

export interface TimelineFrame {
  outlines: Pieces<Outline>
  paints: Pieces<Paint>
  /** углы поворота вокруг вертикали через O, рад; есть только у 3D-ролика */
  spin?: Pieces<number>
}

export interface Timeline {
  fps: number
  frameCount: number
  /** длительность цикла, с */
  duration: number
  frameAt(i: number): TimelineFrame
}

const IDS: PieceId[] = ['top', 'bottom']

/**
 * Зацикленный ролик по конфигурациям, начиная с текущей.
 *
 * Обычный режим: на каждую конфигурацию — anim.interval секунд, в конце — переход
 * (морфинг с кривой или резкая смена на границе); пять конфигураций и обратно.
 *
 * 3D с вращением и сменой форм за оборот: форма меняется при прохождении углов
 * π/2 + j·2π/k (первая смена — «ребром»), конфигурации идут по кругу. Длина ролика —
 * целое число оборотов верхней детали, кратное пяти, поэтому петля сходится и по
 * форме, и по углу; если удаётся, подбирается и целое число оборотов нижней детали.
 */
export function buildTimeline(s: SignState, fps: number): Timeline {
  const n = formCount(s)
  const ease = EASINGS[s.anim.easing]
  const is3d = s.view.mode === '3d'
  const spinTop = is3d ? s.spin.top : 0
  const spinBottom = is3d ? s.spin.bottom : 0
  const k = s.spin.formsPerTurn
  const bySpin = is3d && spinTop !== 0 && k > 0

  const exact = Array.from({ length: n }, (_, config) => buildSign({ ...s, config }))
  const paintsOf = (config: number): Pieces<Paint> => ({ top: renderPaint(s, 'top', config), bottom: renderPaint(s, 'bottom', config) })
  const pairCache = new Map<string, Pieces<[Ring, Ring][]>>()
  const pairs = (from: number, to: number) => {
    const key = `${from}>${to}`
    let p = pairCache.get(key)
    if (!p) {
      p = {} as Pieces<[Ring, Ring][]>
      for (const id of IDS) p[id] = matchRings(outlineToRings(exact[from][id]), outlineToRings(exact[to][id]))
      pairCache.set(key, p)
    }
    return p
  }
  const configAt = (step: number) => (s.config + step) % n

  /** Кадр «шаг step, прошло local секунд от начала перехода длиной dur». */
  const frame = (step: number, local: number, dur: number, t: number): TimelineFrame => {
    const from = configAt(step)
    const spin = is3d ? { top: 2 * Math.PI * spinTop * t, bottom: 2 * Math.PI * spinBottom * t } : undefined
    if (!dur || local < 0) return { outlines: exact[from], paints: paintsOf(from), spin }
    if (local >= dur) {
      const to = configAt(step + 1)
      return { outlines: exact[to], paints: paintsOf(to), spin }
    }
    const to = configAt(step + 1)
    const e = ease(local / dur)
    const p = pairs(from, to)
    const pf = paintsOf(from),
      pt = paintsOf(to)
    return {
      outlines: { top: ringsToOutline(lerpRings(p.top, e)), bottom: ringsToOutline(lerpRings(p.bottom, e)) },
      paints: { top: lerpPaint(pf.top, pt.top, e), bottom: lerpPaint(pf.bottom, pt.bottom, e) },
      spin,
    }
  }

  if (bySpin) {
    const turn = 1 / Math.abs(spinTop) // секунд на оборот
    const ratio = Math.abs(spinBottom) / Math.abs(spinTop)
    let turns = n
    for (let m = n; m <= 12 * n; m += n)
      if (Math.abs(m * ratio - Math.round(m * ratio)) < 1e-6) {
        turns = m
        break
      }
    const duration = turns * turn
    const period = turn / k // между сменами формы
    const dur = s.anim.mode === 'morph' ? Math.min(s.anim.duration / 1000, period) : 0
    const first = turn / 4 // первая смена — деталь стоит ребром
    return {
      fps,
      duration,
      frameCount: Math.max(1, Math.round(duration * fps)),
      frameAt(i) {
        const t = i / fps
        if (t < first) return frame(0, -1, dur, t)
        const j = Math.floor((t - first) / period) // номер последней прошедшей смены
        // переход j-й смены: из формы j в форму j+1; после него — «полка» до следующей смены
        return dur ? frame(j, t - first - j * period, dur, t) : frame(j + 1, -1, 0, t)
      },
    }
  }

  const interval = s.anim.interval
  const dur = s.anim.mode === 'morph' ? Math.min(s.anim.duration / 1000, interval) : 0
  const hold = interval - dur
  const duration = n * interval
  return {
    fps,
    duration,
    frameCount: Math.max(1, Math.round(duration * fps)),
    frameAt(i) {
      const t = i / fps
      const step = Math.min(n - 1, Math.floor(t / interval))
      return frame(step, t - step * interval - hold, dur, t)
    },
  }
}
