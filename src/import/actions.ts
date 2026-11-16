import type { PieceId } from '../types'
import { customCount, formName, formOutline, isCustom } from '../geometry/configs'
import { MAX_CUSTOM_FORMS } from './limits'
import { importSvg, type ImportTarget } from './svgImport'
import { useSign } from '../store/useSign'
import { useUI } from '../store/useUI'

const notify = (text: string, error = false) => useUI.getState().notify(text, error)

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.svg,image/svg+xml'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

const baseName = (f: File) => f.name.replace(/\.svg$/i, '').trim().slice(0, 40) || 'Imported'

/**
 * Загрузка фигур из SVG. 'sign' — целый знак становится новой формой; 'top'/'bottom' —
 * замена одной детали текущей формы (у встроенной формы создаётся загруженная копия).
 */
export async function importFromSvg(target: ImportTarget) {
  const st = useSign.getState()
  if (target === 'sign' || !isCustom(st.sign, st.sign.config)) {
    if (customCount(st.sign) >= MAX_CUSTOM_FORMS) return notify(`Up to ${MAX_CUSTOM_FORMS} imported forms — delete one first`, true)
  }
  const file = await pickFile()
  if (!file) return
  const res = importSvg(await file.text(), target)
  if (!res.ok) return notify(`Could not import ${file.name}: ${res.error}`, true)
  const s = useSign.getState().sign
  const name = baseName(file)
  if (target === 'sign') {
    // пустая четверть — деталь остаётся от текущей формы
    const keep = (id: PieceId) => formOutline(s, s.config, id, 1)
    useSign.getState().addCustomForm({ name, top: res.top ?? keep('top'), bottom: res.bottom ?? keep('bottom') })
  } else useSign.getState().replacePiece(target, res[target]!, name)
  const n = useSign.getState().sign.config + 1
  const what = target === 'sign' ? `form ${n}` : `${target} piece of form ${n}`
  notify(res.warnings.length ? `Imported as ${what}. Note: ${res.warnings.join('; ')}` : `Imported ${file.name} as ${what}`, res.warnings.length > 0)
}

export function deleteCurrentForm() {
  const s = useSign.getState().sign
  const name = formName(s, s.config)
  if (!useSign.getState().removeCurrentForm()) return notify('The last form cannot be deleted')
  const builtin = !isCustom(s, s.config)
  notify(builtin ? `Deleted ${name}. Built-in forms come back with “Restore built-in forms” (or ⌘Z)` : `Deleted ${name} (⌘Z to undo)`)
}

export function restoreBuiltinForms() {
  const n = useSign.getState().restoreBuiltins()
  notify(n ? `Restored ${n} built-in form${n > 1 ? 's' : ''}` : 'All built-in forms are already there')
}
