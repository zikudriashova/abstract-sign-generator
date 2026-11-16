import { create } from 'zustand'

interface UI {
  sheet: boolean
  setSheet(open: boolean): void
  /** автоплей поставлен на паузу кликом по холсту (не сохраняется) */
  paused: boolean
  setPaused(paused: boolean): void
  toast: { id: number; text: string; error: boolean } | null
  notify(text: string, error?: boolean): void
}

let timer: ReturnType<typeof setTimeout> | undefined
export const useUI = create<UI>((set) => ({
  sheet: false,
  setSheet: (sheet) => set({ sheet }),
  paused: false,
  setPaused: (paused) => set({ paused }),
  toast: null,
  notify(text, error = false) {
    clearTimeout(timer)
    set({ toast: { id: Math.random(), text, error } })
    timer = setTimeout(() => set({ toast: null }), error ? 6000 : 2500)
  },
}))
