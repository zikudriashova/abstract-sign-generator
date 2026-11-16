import { create } from 'zustand'
import type { SignState } from '../types'
import { validateState } from '../validate'

export interface Favorite {
  id: string
  state: SignState
}

const KEY = 'sign-generator:favorites:v2'

const load = (): Favorite[] => {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? JSON.parse(raw) : []
    if (!Array.isArray(v)) return []
    // битые записи отбрасываем, остальные проходят строгую проверку
    return v.flatMap((f: Favorite) => {
      try {
        return [{ id: String(f.id), state: validateState(f.state) }]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}
const save = (items: Favorite[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    /* хранилище недоступно — избранное живёт до перезагрузки */
  }
}

interface Store {
  items: Favorite[]
  add(state: SignState): void
  remove(id: string): void
}

export const useFavorites = create<Store>((set, get) => ({
  items: load(),
  add(state) {
    const items = [{ id: Math.random().toString(36).slice(2, 9), state }, ...get().items].slice(0, 48)
    save(items)
    set({ items })
  },
  remove(id) {
    const items = get().items.filter((f) => f.id !== id)
    save(items)
    set({ items })
  },
}))
