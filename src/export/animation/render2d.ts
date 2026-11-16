import type { SignState } from '../../types'
import type { TimelineFrame } from './timeline'
import { signToSvg } from '../../render2d/svg'
import { svgWithSize } from '../png'

/**
 * Кадр 2D-видео: фон знака на весь кадр 16:9, по центру — квадрат знака высотой в кадр.
 * Рисуется из той же SVG-строки, что экран и SVG-экспорт.
 */
export async function draw2dFrame(ctx: CanvasRenderingContext2D, s: SignState, f: TimelineFrame, width: number, height: number) {
  ctx.fillStyle = s.color.bg
  ctx.fillRect(0, 0, width, height)
  const svg = svgWithSize(signToSvg(s, { build: false, bg: false, fixedSize: true, outlines: f.outlines, paints: f.paints, idPrefix: 'v-' }), height)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    ctx.drawImage(img, (width - height) / 2, 0, height, height)
  } finally {
    URL.revokeObjectURL(url)
  }
}
