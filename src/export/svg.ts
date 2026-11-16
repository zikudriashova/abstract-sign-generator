import { signToSvg, downloadText } from '../render2d/svg'
import { capture3d } from '../render3d/capture'
import { useSign } from '../store/useSign'
import { useUI } from '../store/useUI'
import { PNG_BASE, downloadBlob, renderPng2d } from './png'
import { parsePreset, serializePreset } from './preset'

/** Параметры экспорта (интерфейс, не часть знака). */
export const exportOptions = { bg: false, scale: 2, videoHeight: 1080 as 720 | 1080, videoFormat: 'mp4' as 'mp4' | 'gif' }

const notify = (text: string, error = false) => useUI.getState().notify(text, error)
const sign = () => useSign.getState().sign

async function guard(label: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    notify(`${label}: done`)
  } catch (e) {
    notify(`${label}: ${e instanceof Error ? e.message : String(e)}`, true)
  }
}

export const exportSvg = () =>
  guard('SVG', () => {
    const svg = signToSvg(sign(), { build: false, bg: exportOptions.bg, fixedSize: true })
    downloadText('sign.svg', `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`, 'image/svg+xml')
  })

export const exportPng2d = () =>
  guard('PNG', async () => {
    downloadBlob(`sign@${exportOptions.scale}x.png`, await renderPng2d(sign(), exportOptions.scale, exportOptions.bg))
  })

export const exportPng3d = () =>
  guard('PNG 3D', async () => {
    if (!capture3d.current) throw new Error('switch to 3D mode')
    downloadBlob(`sign-3d@${exportOptions.scale}x.png`, await capture3d.current(PNG_BASE * exportOptions.scale, !exportOptions.bg))
  })

// three.js и GLTFExporter грузятся только при экспорте GLB, чтобы не раздувать основной бандл
export const exportGlbFile = () =>
  guard('GLB', async () => {
    const { exportGlb } = await import('./glb')
    downloadBlob('sign.glb', await exportGlb(sign()))
  })

export const exportJson = () =>
  guard('JSON', () => downloadText('sign-preset.json', serializePreset(sign()), 'application/json'))

/** Открывает выбор файла и подставляет пресет; при ошибке знак не меняется. */
export function importJson() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json,.json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const res = parsePreset(await file.text())
    if (res.ok) {
      useSign.getState().loadState(res.state)
      notify(`Preset loaded: ${file.name}`)
    } else notify(`Could not load preset: ${res.error}`, true)
  }
  input.click()
}

let animationBusy = false

/** Экспорт зацикленной анимации (все конфигурации по кругу) в MP4 (H.264) или GIF, 720p/1080p. */
export async function exportAnimation() {
  if (animationBusy) return notify('Animation export is already running')
  animationBusy = true
  const { videoHeight, videoFormat } = exportOptions
  const label = `${videoFormat === 'mp4' ? 'MP4' : 'GIF'} ${videoHeight}p`
  try {
    const { renderAnimation } = await import('./animation')
    let last = 0
    const res = await renderAnimation(sign(), videoHeight, videoFormat, (done, total) => {
      const now = performance.now()
      if (now - last > 250 || done === total) {
        last = now
        notify(`${label}: frame ${done} / ${total}…`)
      }
    })
    downloadBlob(res.name, res.blob)
    notify(`${label}: done, ${res.frames} frames, ${(res.blob.size / 1048576).toFixed(1)} MB`)
  } catch (e) {
    notify(`${label}: ${e instanceof Error ? e.message : String(e)}`, true)
  } finally {
    animationBusy = false
  }
}
