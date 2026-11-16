import type { SignState } from '../../types'
import { capture3d } from '../../render3d/capture'
import { buildTimeline } from './timeline'
import { draw2dFrame } from './render2d'
import { createGifSink, createMp4Sink, type FrameSink } from './sinks'

export type VideoFormat = 'mp4' | 'gif'

/** Кадров в секунду: MP4 — 30, GIF — 25 (задержка GIF кратна 10 мс). */
export const VIDEO_FPS: Record<VideoFormat, number> = { mp4: 30, gif: 25 }

export interface AnimationExport {
  blob: Blob
  name: string
  frames: number
}

/**
 * Экспорт зацикленной анимации из текущего вида (2D или 3D) в кадре 16:9.
 * Интерфейс не блокируется: между кадрами управление возвращается браузеру.
 */
export async function renderAnimation(
  s: SignState,
  height: 720 | 1080,
  format: VideoFormat,
  onProgress: (done: number, total: number) => void,
): Promise<AnimationExport> {
  const width = Math.round((height * 16) / 9)
  const fps = VIDEO_FPS[format]
  const tl = buildTimeline(s, fps)
  const sink: FrameSink = format === 'mp4' ? await createMp4Sink(width, height, fps) : createGifSink(width, height, fps)
  const yieldToUI = () => new Promise((r) => setTimeout(r, 0))

  if (s.view.mode === '3d') {
    const video = capture3d.video
    if (!video) throw new Error('the 3D view is not ready yet')
    video.begin(width, height)
    try {
      for (let i = 0; i < tl.frameCount; i++) {
        const f = tl.frameAt(i)
        const canvas = await video.frame({ outlines: f.outlines, paints: f.paints, spin: f.spin ?? { top: 0, bottom: 0 }, animating: true })
        await sink.add(canvas, i)
        onProgress(i + 1, tl.frameCount)
      }
    } finally {
      video.end()
    }
  } else {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    for (let i = 0; i < tl.frameCount; i++) {
      await draw2dFrame(ctx, s, tl.frameAt(i), width, height)
      await sink.add(canvas, i)
      onProgress(i + 1, tl.frameCount)
      if (i % 4 === 0) await yieldToUI()
    }
  }
  return { blob: await sink.finish(), name: `sign-animation-${height}p.${format}`, frames: tl.frameCount }
}
