import type { Easing, Outline, Paint, PieceId } from '../types'
import { lerpPaint } from './paint'
import { EASINGS, type Ring, lerpRings, matchRings, outlineToRings, ringsToOutline } from './morph'

type Pieces<T> = Record<PieceId, T>
const IDS: PieceId[] = ['top', 'bottom']

export interface DisplayFrame {
  outlines: Pieces<Outline>
  /** заливки кадра: при смене формы с цветами по формам перетекают вместе с морфингом */
  paints?: Pieces<Paint>
  /** идёт ли сейчас морфинг */
  animating: boolean
  /** углы поворота деталей вокруг вертикали через O, рад (задаются только покадровым экспортом) */
  spin?: Pieces<number>
}

interface Tween {
  pairs: Pieces<[Ring, Ring][]>
  fromPaints?: Pieces<Paint>
  start: number
  duration: number
  easing: Easing
}

/**
 * Анимация смены формы. Не блокирует ввод: каждая новая команда стартует
 * с текущего промежуточного кадра. Кадры — через requestAnimationFrame.
 */
export class MorphEngine {
  private target: Pieces<Outline>
  private targetPaints?: Pieces<Paint>
  private frame: DisplayFrame
  private tween: Tween | null = null
  private raf = 0
  private endTimer: ReturnType<typeof setTimeout> | undefined
  private listeners = new Set<() => void>()
  /** кадр, зафиксированный извне (покадровый экспорт видео); перекрывает живую анимацию */
  private held: DisplayFrame | null = null

  constructor(
    initial: Pieces<Outline>,
    paints?: Pieces<Paint>,
    private now: () => number = () => performance.now(),
    private schedule: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
    private cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
  ) {
    this.target = initial
    this.targetPaints = paints
    this.frame = { outlines: initial, paints, animating: false }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  get = () => this.held ?? this.frame

  /** Показать заданный кадр вместо живого (null — вернуть живой). Для покадрового рендера 3D-видео. */
  hold(frame: DisplayFrame | null) {
    this.held = frame
    this.emit()
  }

  /** Кольца текущего кадра: промежуточные, если идёт морфинг. */
  private currentRings(): Pieces<Ring[]> {
    if (this.tween) {
      const t = this.progress(this.now())
      return { top: lerpRings(this.tween.pairs.top, t), bottom: lerpRings(this.tween.pairs.bottom, t) }
    }
    return { top: outlineToRings(this.frame.outlines.top), bottom: outlineToRings(this.frame.outlines.bottom) }
  }

  private progress(now: number) {
    const tw = this.tween!
    const t = Math.min(1, Math.max(0, (now - tw.start) / tw.duration))
    return EASINGS[tw.easing](t)
  }

  /**
   * Новая цель. kind 'shape' — смена конфигурации (анимируется по настройкам),
   * 'other' — зазор, сетка, скругления: применяется сразу, а во время морфинга
   * подхватывается без рывка до конца текущей анимации.
   */
  setTarget(
    next: Pieces<Outline>,
    kind: 'shape' | 'other',
    s: { mode: 'cut' | 'morph'; duration: number; easing: Easing },
    paints?: Pieces<Paint>,
  ) {
    this.target = next
    const prevPaints = this.currentPaints()
    this.targetPaints = paints
    const now = this.now()
    if (kind === 'shape' && s.mode === 'morph' && s.duration > 0) {
      this.startTween(now, s.duration, s.easing, prevPaints)
    } else if (kind === 'other' && this.tween) {
      const left = this.tween.start + this.tween.duration - now
      // смена цвета вне смены формы применяется сразу
      if (left > 16) this.startTween(now, left, this.tween.easing, this.tween.fromPaints && prevPaints)
      else this.snap()
    } else this.snap()
  }

  /** Заливки текущего кадра (промежуточные во время перехода). */
  private currentPaints(): Pieces<Paint> | undefined {
    const tw = this.tween
    if (!tw?.fromPaints || !this.targetPaints) return this.frame.paints ?? this.targetPaints
    const t = this.progress(this.now())
    return { top: lerpPaint(tw.fromPaints.top, this.targetPaints.top, t), bottom: lerpPaint(tw.fromPaints.bottom, this.targetPaints.bottom, t) }
  }

  private startTween(now: number, duration: number, easing: Easing, fromPaints?: Pieces<Paint>) {
    const from = this.currentRings()
    const pairs = {} as Pieces<[Ring, Ring][]>
    for (const id of IDS) pairs[id] = matchRings(from[id], outlineToRings(this.target[id]))
    const tween: Tween = { pairs, start: now, duration, easing, fromPaints }
    this.tween = tween
    // страховка: в фоновой вкладке requestAnimationFrame не вызывается, а форма всё равно должна прийти к цели
    clearTimeout(this.endTimer)
    this.endTimer = setTimeout(() => this.tween === tween && this.snap(), duration + 50)
    this.tick()
  }

  private snap() {
    this.tween = null
    clearTimeout(this.endTimer)
    this.cancel(this.raf)
    this.frame = { outlines: this.target, paints: this.targetPaints, animating: false }
    this.emit()
  }

  private tick = () => {
    this.cancel(this.raf)
    const tw = this.tween
    if (!tw) return
    const now = this.now()
    if (now - tw.start >= tw.duration) return this.snap()
    const t = this.progress(now)
    const tp = this.targetPaints
    this.frame = {
      outlines: { top: ringsToOutline(lerpRings(tw.pairs.top, t)), bottom: ringsToOutline(lerpRings(tw.pairs.bottom, t)) },
      paints: tw.fromPaints && tp ? { top: lerpPaint(tw.fromPaints.top, tp.top, t), bottom: lerpPaint(tw.fromPaints.bottom, tp.bottom, t) } : tp,
      animating: true,
    }
    this.emit()
    this.raf = this.schedule(this.tick)
  }

  private emit() {
    this.listeners.forEach((fn) => fn())
  }
}
