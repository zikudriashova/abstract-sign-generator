import { create } from 'zustand'
import type { CustomForm, GridState, PieceId, SignState } from '../types'
import { configUnitForm, customOf, formCount, isCustom } from '../geometry/configs'
import { PALETTES, initialState, nextConfig, withPaint } from '../model'
import { validateState } from '../validate'

interface Store {
  sign: SignState
  past: SignState[]
  future: SignState[]
  /** изменить состояние; одинаковый coalesceKey в течение 600 мс склеивается в один шаг истории */
  update(fn: (s: SignState) => SignState, coalesceKey?: string): void
  undo(): void
  redo(): void
  /** выбрать конфигурацию знака (0..4) */
  setConfig(config: number): void
  /** новая генерация: случайная конфигурация, отличная от текущей */
  randomize(): void
  /** смена формы от вращения (не попадает в историю undo, чтобы её не засорять) */
  advanceForm(): void
  setSeed(seed: number): void
  setN(N: GridState['N']): void
  applyPalette(name: string): void
  /** заменить знак импортированным пресетом (вид 2D/3D сохраняется) */
  loadState(s: SignState): void
  /** добавить загруженную из SVG форму и переключиться на неё */
  addCustomForm(form: Omit<CustomForm, 'id'>): void
  /** заменить одну деталь текущей формы; у встроенной формы создаётся загруженная копия */
  replacePiece(id: PieceId, outline: CustomForm['top'], name: string): void
  /** удалить текущую форму, если она загруженная */
  removeCurrentForm(): void
}

const HISTORY_LIMIT = 200
const newFormId = () => Math.random().toString(36).slice(2, 10)
let lastKey = ''
let lastAt = 0

const AUTOSAVE = 'sign-generator:autosave:v2'

/** Последний знак восстанавливается при запуске; повреждённое или старое сохранение игнорируется. */
function loadAutosave(): SignState {
  try {
    const raw = localStorage.getItem(AUTOSAVE)
    if (raw) return validateState(JSON.parse(raw))
  } catch {
    /* нет доступа к хранилищу или сохранение устарело */
  }
  return initialState(12)
}

export const useSign = create<Store>((set, get) => ({
  sign: loadAutosave(),
  past: [],
  future: [],

  update(fn, key) {
    const { sign, past } = get()
    const next = fn(sign)
    if (next === sign) return
    const now = performance.now()
    const merge = key !== undefined && key === lastKey && now - lastAt < 600
    lastKey = key ?? ''
    lastAt = now
    set({
      sign: next,
      past: merge ? past : [...past, sign].slice(-HISTORY_LIMIT),
      future: [],
    })
  },
  undo() {
    const { past, sign, future } = get()
    if (!past.length) return
    lastKey = ''
    set({ sign: past[past.length - 1], past: past.slice(0, -1), future: [sign, ...future] })
  },
  redo() {
    const { past, sign, future } = get()
    if (!future.length) return
    lastKey = ''
    set({ sign: future[0], past: [...past, sign], future: future.slice(1) })
  },

  setConfig(config) {
    if (config < 0 || config >= formCount(get().sign)) return
    get().update((s) => (s.config === config ? s : { ...s, config }))
  },
  randomize() {
    get().update((s) => {
      const seed = (Math.random() * 2 ** 32) >>> 0
      return { ...s, seed, config: nextConfig(s.config, seed, formCount(s)) }
    })
  },
  advanceForm() {
    const s = get().sign
    const seed = (Math.random() * 2 ** 32) >>> 0
    set({ sign: { ...s, seed, config: nextConfig(s.config, seed, formCount(s)) } })
  },
  setSeed(seed) {
    get().update((s) => ({ ...s, seed, config: nextConfig(s.config, seed, formCount(s)) }), 'seed')
  },
  setN(N) {
    get().update((s) => (s.grid.N === N ? s : { ...s, grid: { N } }))
  },
  loadState(next) {
    get().update((s) => ({ ...next, view: s.view }))
  },
  addCustomForm(form) {
    get().update((s) => {
      const config = formCount(s)
      return {
        ...s,
        config,
        customForms: [...s.customForms, { ...form, id: newFormId() }],
        // у новой формы цвета — как у текущей, их можно сразу поменять
        color: { ...s.color, formPaints: [...s.color.formPaints, s.color.formPaints[s.config]] },
      }
    })
  },
  replacePiece(id, outline, name) {
    get().update((s) => {
      if (isCustom(s.config)) {
        const k = s.config - (formCount(s) - s.customForms.length)
        // новый id: геометрия кэшируется по id формы
        const customForms = s.customForms.map((f, i) => (i === k ? { ...f, [id]: outline, id: newFormId() } : f))
        return { ...s, customForms }
      }
      const base = configUnitForm(s.config)
      const form: CustomForm = { ...base, [id]: outline, name, id: newFormId() }
      return {
        ...s,
        config: formCount(s),
        customForms: [...s.customForms, form],
        color: { ...s.color, formPaints: [...s.color.formPaints, s.color.formPaints[s.config]] },
      }
    })
  },
  removeCurrentForm() {
    get().update((s) => {
      if (!isCustom(s.config) || !customOf(s, s.config)) return s
      const k = s.config - (formCount(s) - s.customForms.length)
      return {
        ...s,
        config: Math.max(0, s.config - 1),
        customForms: s.customForms.filter((_, i) => i !== k),
        color: { ...s.color, formPaints: s.color.formPaints.filter((_, i) => i !== s.config) },
      }
    })
  },
  applyPalette(name) {
    const p = PALETTES.find((x) => x.name === name)
    if (!p) return
    get().update((s) => {
      // при цветах по формам палитра применяется к текущей форме, фон — общий
      const next = withPaint(withPaint(s, 'top', p.top), 'bottom', p.bottom)
      return { ...next, color: { ...next.color, bg: p.bg, palette: p.name } }
    })
  },
}))

// автосохранение с задержкой, чтобы не писать в localStorage на каждый шаг ползунка
let saveTimer: ReturnType<typeof setTimeout> | undefined
useSign.subscribe((st, prev) => {
  if (st.sign === prev.sign) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE, JSON.stringify(st.sign))
    } catch {
      /* хранилище недоступно */
    }
  }, 400)
})
