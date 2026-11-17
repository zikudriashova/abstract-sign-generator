import { create } from 'zustand'
import type { CustomForm, FormEntry, GridState, PieceId, SignState } from '../types'
import { CONFIGS, formCount, unitForm } from '../geometry/configs'
import { PALETTES, initialState, nextConfig, stepConfig, withPaint } from '../model'
import { validateState } from '../validate'

interface Store {
  sign: SignState
  past: SignState[]
  future: SignState[]
  /** изменить состояние; одинаковый coalesceKey в течение 600 мс склеивается в один шаг истории */
  update(fn: (s: SignState) => SignState, coalesceKey?: string): void
  undo(): void
  redo(): void
  /** выбрать форму знака по номеру в списке */
  setConfig(config: number): void
  /** новая генерация: случайная конфигурация, отличная от текущей */
  randomize(): void
  /** следующая форма по настройке anim.order (автоплей, клавиша →) */
  next(): void
  /** предыдущая форма по списку (клавиша ←) */
  prev(): void
  /** смена формы от вращения по anim.order (не попадает в историю undo, чтобы её не засорять) */
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
  /** удалить текущую форму (встроенную или загруженную); последнюю удалить нельзя. true — удалено */
  removeCurrentForm(): boolean
  /** вернуть удалённые встроенные формы в начало списка; возвращает, сколько вернулось */
  restoreBuiltins(): number
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
  next() {
    get().update((s) => {
      if (s.anim.order === 'sequence') return { ...s, config: stepConfig(s.config, s.seed, formCount(s), 'sequence') }
      const seed = (Math.random() * 2 ** 32) >>> 0
      return { ...s, seed, config: nextConfig(s.config, seed, formCount(s)) }
    })
  },
  prev() {
    get().update((s) => ({ ...s, config: (s.config - 1 + formCount(s)) % formCount(s) }))
  },
  advanceForm() {
    const s = get().sign
    const seed = s.anim.order === 'random' ? (Math.random() * 2 ** 32) >>> 0 : s.seed
    set({ sign: { ...s, seed, config: stepConfig(s.config, seed, formCount(s), s.anim.order) } })
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
    get().update((s) => ({
      ...s,
      config: s.forms.length,
      forms: [...s.forms, { kind: 'custom', ...form, id: newFormId() }],
      // у новой формы цвета — как у текущей, их можно сразу поменять
      color: { ...s.color, formPaints: [...s.color.formPaints, s.color.formPaints[s.config]] },
    }))
  },
  replacePiece(id, outline, name) {
    get().update((s) => {
      const cur = s.forms[s.config]
      if (cur.kind === 'custom') {
        // новый id: геометрия кэшируется по id формы
        const forms = s.forms.map((f, i): FormEntry => (i === s.config ? { ...cur, [id]: outline, id: newFormId() } : f))
        return { ...s, forms }
      }
      // встроенная форма не меняется: рядом появляется загруженная копия с новой деталью
      const copy: FormEntry = { kind: 'custom', ...unitForm(s, s.config), [id]: outline, name, id: newFormId() }
      return {
        ...s,
        config: s.forms.length,
        forms: [...s.forms, copy],
        color: { ...s.color, formPaints: [...s.color.formPaints, s.color.formPaints[s.config]] },
      }
    })
  },
  removeCurrentForm() {
    const before = get().sign.forms.length
    get().update((s) => {
      if (s.forms.length <= 1) return s
      const keep = (_: unknown, i: number) => i !== s.config
      const forms = s.forms.filter(keep)
      // на место удалённой встаёт следующая; если удалили последнюю в списке — предыдущая
      return { ...s, forms, config: Math.min(s.config, forms.length - 1), color: { ...s.color, formPaints: s.color.formPaints.filter(keep) } }
    })
    return get().sign.forms.length < before
  },
  restoreBuiltins() {
    const s = get().sign
    const missing = CONFIGS.map((_, index) => index).filter((index) => !s.forms.some((f) => f.kind === 'builtin' && f.index === index))
    if (!missing.length) return 0
    get().update((st) => {
      const back: FormEntry[] = missing.map((index) => ({ kind: 'builtin', index }))
      // возвращённые встают в начало, по порядку; текущая форма остаётся выбранной
      const paints = missing.map(() => ({ top: st.top.paint, bottom: st.bottom.paint }))
      return {
        ...st,
        forms: [...back, ...st.forms],
        config: st.config + back.length,
        color: { ...st.color, formPaints: [...paints, ...st.color.formPaints] },
      }
    })
    return missing.length
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
