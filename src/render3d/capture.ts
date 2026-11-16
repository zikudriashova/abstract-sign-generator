import type { DisplayFrame } from '../anim/engine'

/** Мост между Scene3D (внутри R3F) и кнопками экспорта: сцена регистрирует здесь функцию рендера в PNG. */
export interface Capture3D {
  (sidePx: number, transparent: boolean): Promise<Blob>
}

/** Покадровый рендер 3D для видео: begin задаёт размер кадра, frame рисует заданный кадр морфинга. */
export interface Video3D {
  begin(width: number, height: number): void
  frame(f: DisplayFrame): Promise<HTMLCanvasElement>
  end(): void
}

export const capture3d: { current: Capture3D | null; video: Video3D | null; committed: DisplayFrame | null } = {
  current: null,
  video: null,
  committed: null,
}
