import type { CustomForm, Outline, PieceId, PieceState, SignState } from '../types'
import { customOf, formOutline, isCustom } from './configs'
import { filletOutline } from './fillet'
import { mapOutline } from './outline'

const cache = new Map<string, Outline>()
const remember = (key: string, make: () => Outline) => {
  let v = cache.get(key)
  if (!v) {
    v = make()
    if (cache.size > 600) cache.clear()
    cache.set(key, v)
  }
  return v
}

/** Контур детали формы со скруглениями, локальные координаты квадранта. */
export function buildPiece(
  s: { customForms: CustomForm[] },
  config: number,
  id: PieceId,
  piece: Pick<PieceState, 'rounding'>,
  N: number,
): Outline {
  const r = piece.rounding
  // загруженные формы различаем по id: номер у них может смениться после удаления соседней
  const form = isCustom(config) ? `custom:${customOf(s, config)?.id}` : config
  return remember(`${form}|${id}|${N}|${r.convex}|${r.concave}|${r.origin}`, () => filletOutline(formOutline(s, config, id, N), r))
}

/** Контуры двух деталей в мировых координатах. Нижняя = локальная, повёрнутая на 180°; зазор g — по g/2 на деталь. */
export function buildSign(s: Pick<SignState, 'config' | 'gap' | 'grid' | 'top' | 'bottom' | 'customForms'>): Record<PieceId, Outline> {
  const h = s.gap / 2
  const top = mapOutline(buildPiece(s, s.config, 'top', s.top, s.grid.N), (p) => ({ x: p.x + h, y: p.y + h }))
  const bottom = mapOutline(buildPiece(s, s.config, 'bottom', s.bottom, s.grid.N), (p) => ({ x: -p.x - h + 0, y: -p.y - h + 0 }))
  return { top, bottom }
}
