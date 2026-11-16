import { useSyncExternalStore } from 'react'
import type { SignState } from '../types'
import { buildSign } from '../geometry/sign'
import { renderPaint } from '../model'
import { useSign } from '../store/useSign'
import { MorphEngine } from './engine'

/** Всё, что влияет на геометрию: если ключ не изменился, перестраивать нечего. */
const geomKey = (s: SignState) =>
  JSON.stringify([s.config, s.gap, s.grid.N, s.top.rounding, s.bottom.rounding])

const paints = (s: SignState) => ({ top: renderPaint(s, 'top'), bottom: renderPaint(s, 'bottom') })
/** Всё, что влияет на цвет деталей. */
const paintKey = (s: SignState) => JSON.stringify(paints(s))

let last = useSign.getState().sign
export const engine = new MorphEngine(buildSign(last), paints(last))

useSign.subscribe((st) => {
  const s = st.sign
  if (s === last) return
  const prev = last
  last = s
  if (geomKey(s) === geomKey(prev) && paintKey(s) === paintKey(prev)) return
  engine.setTarget(buildSign(s), s.config !== prev.config ? 'shape' : 'other', s.anim, paints(s))
})

/** Текущий кадр для отрисовки (2D и 3D): промежуточный во время морфинга, иначе точный контур. */
export const useDisplay = () => useSyncExternalStore(engine.subscribe, engine.get)
