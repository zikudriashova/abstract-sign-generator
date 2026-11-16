import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'

/** Приёмник кадров: кадры подаются по порядку, finish() возвращает готовый файл. */
export interface FrameSink {
  add(source: HTMLCanvasElement, index: number): Promise<void>
  finish(): Promise<Blob>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** H.264 в MP4 через WebCodecs: аппаратный кодировщик браузера, без тяжёлых библиотек. */
export async function createMp4Sink(width: number, height: number, fps: number): Promise<FrameSink> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined')
    throw new Error('H.264 needs a browser with WebCodecs (Chrome, Edge, Safari 16.4+). Try GIF instead.')
  const bitrate = height > 720 ? 10_000_000 : 6_000_000
  // High → Main → Baseline: берём первый профиль, который кодировщик поддерживает
  const candidates = height > 720 ? ['avc1.640028', 'avc1.4d0028', 'avc1.420028'] : ['avc1.64001f', 'avc1.4d001f', 'avc1.42001f']
  let codec = ''
  for (const c of candidates) {
    const { supported } = await VideoEncoder.isConfigSupported({ codec: c, width, height, bitrate, framerate: fps })
    if (supported) {
      codec = c
      break
    }
  }
  if (!codec) throw new Error(`this browser cannot encode H.264 at ${width}×${height}. Try GIF or another browser.`)

  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory' })
  let failure: unknown = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  })
  encoder.configure({ codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' } })
  const frameUs = 1e6 / fps
  return {
    async add(source, i) {
      if (failure) throw failure
      const frame = new VideoFrame(source, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) })
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 })
      frame.close()
      // не даём очереди кодировщика разрастись: память и отзывчивость интерфейса
      while (encoder.encodeQueueSize > 6) await sleep(2)
    },
    async finish() {
      await encoder.flush()
      encoder.close()
      if (failure) throw failure
      muxer.finalize()
      return new Blob([muxer.target.buffer], { type: 'video/mp4' })
    },
  }
}

/** GIF: палитра 256 цветов на кадр (rgb565), бесконечный повтор. */
export function createGifSink(width: number, height: number, fps: number) {
  const gif = GIFEncoder()
  const delay = Math.round(1000 / fps)
  let ctx: CanvasRenderingContext2D | null = null
  const addRGBA = (rgba: Uint8Array | Uint8ClampedArray) => {
    const palette = quantize(rgba, 256, { format: 'rgb565' })
    gif.writeFrame(applyPalette(rgba, palette, 'rgb565'), width, height, { palette, delay, repeat: 0 })
  }
  const sink: FrameSink & { addRGBA: typeof addRGBA } = {
    addRGBA,
    async add(source) {
      if (!ctx) {
        const c = document.createElement('canvas')
        c.width = width
        c.height = height
        ctx = c.getContext('2d', { willReadFrequently: true })!
      }
      ctx.drawImage(source, 0, 0, width, height)
      addRGBA(ctx.getImageData(0, 0, width, height).data)
    },
    async finish() {
      gif.finish()
      return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' })
    },
  }
  return sink
}
