import { useEffect } from 'react'
import { Canvas } from './ui/Canvas'
import { Panel } from './ui/Panel'
import { Toolbar } from './ui/Toolbar'
import { Favorites } from './ui/Favorites'
import { Toast } from './ui/Toast'
import { useSign } from './store/useSign'
import { useUI } from './store/useUI'
import { formCount } from './geometry/configs'

/** Автоплей: новая генерация каждые interval секунд, пока не стоит пауза. */
function useAutoplay() {
  const autoplay = useSign((s) => s.sign.anim.autoplay)
  const interval = useSign((s) => s.sign.anim.interval)
  const paused = useUI((s) => s.paused)
  useEffect(() => {
    if (!autoplay || paused) return
    const id = setInterval(() => useSign.getState().randomize(), interval * 1000)
    return () => clearInterval(id)
  }, [autoplay, interval, paused])
}

export default function App() {
  useAutoplay()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return
      const mod = e.metaKey || e.ctrlKey
      const { undo, redo, randomize, setConfig, sign } = useSign.getState()
      const key = e.key.toLowerCase()
      if (mod && key === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      } else if (mod) return
      else if (key === 'r') randomize()
      else if (/^[1-9]$/.test(key) && Number(key) <= formCount(sign)) setConfig(Number(key) - 1)
      else if (key === ' ' && sign.anim.autoplay) {
        e.preventDefault()
        const ui = useUI.getState()
        ui.setPaused(!ui.paused)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <Canvas />
      <Favorites />
      <Toolbar />
      <Toast />
      <Panel />
    </>
  )
}
