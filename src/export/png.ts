import { signToSvg } from '../render2d/svg'
import type { SignState } from '../types'

/** 1x = 1024 px по стороне: знак квадратный, масштабы 1x/2x/4x дают 1024/2048/4096. */
export const PNG_BASE = 1024

/** Подставляет размер в корневой <svg>: растеризация идёт из той же строки, что и экран/SVG. */
export function svgWithSize(svg: string, px: number): string {
  return svg.replace(/^(<svg [^>]*?)\s+width="[^"]*"\s+height="[^"]*"/, `$1 width="${px}" height="${px}"`)
}

export async function renderPng2d(s: SignState, scale: number, withBg: boolean): Promise<Blob> {
  const px = PNG_BASE * scale
  const svg = svgWithSize(signToSvg(s, { build: false, bg: withBg, fixedSize: true }), px)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = px
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, px, px) // фон не заливаем — PNG остаётся прозрачным
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) throw new Error('Could not produce the PNG')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
