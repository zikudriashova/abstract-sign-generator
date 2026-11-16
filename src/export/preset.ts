import type { SignState } from '../types'
import { validateState } from '../validate'

export const PRESET_APP = 'abstract-sign-generator'

/** JSON-пресет: всё, из чего строится знак (без состояния интерфейса — режима 2D/3D, построения). */
export function serializePreset(s: SignState): string {
  const { view: _view, ...state } = s
  void _view
  return JSON.stringify({ app: PRESET_APP, version: 2, state }, null, 2)
}

export type ParseResult = { ok: true; state: SignState } | { ok: false; error: string }

export function parsePreset(text: string): ParseResult {
  try {
    const raw = JSON.parse(text)
    if (!raw || typeof raw !== 'object' || raw.app !== PRESET_APP) throw new Error('this is not an Abstract Sign Generator preset')
    if (raw.version !== 2) throw new Error(`preset version ${raw.version} is not supported (version 1 presets were made with the previous generator)`)
    return { ok: true, state: validateState(raw.state) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
