import { lazy, Suspense, useMemo, useRef } from 'react'
import { signToSvg } from '../render2d/svg'
import { useDisplay } from '../anim/bind'
import { useSign } from '../store/useSign'
import { useUI } from '../store/useUI'
import { ContactSheet } from './ContactSheet'

// three.js грузится отдельным чанком только при переходе в 3D
const Scene3D = lazy(() => import('../render3d/Scene3D'))

/**
 * Клик по холсту ставит автоплей на паузу и снимает с неё. Перетаскивание
 * (орбита в 3D) кликом не считается.
 */
function useClickToPause() {
  const down = useRef<{ x: number; y: number } | null>(null)
  return {
    onPointerDown: (e: React.PointerEvent) => (down.current = { x: e.clientX, y: e.clientY }),
    onPointerUp: (e: React.PointerEvent) => {
      const d = down.current
      down.current = null
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return
      if (!useSign.getState().sign.anim.autoplay) return
      const ui = useUI.getState()
      ui.setPaused(!ui.paused)
    },
  }
}

function PauseBadge() {
  const autoplay = useSign((s) => s.sign.anim.autoplay)
  const paused = useUI((s) => s.paused)
  if (!autoplay) return null
  return <div className="badge">{paused ? '❚❚ Paused — click to resume' : '▶ Autoplay — click to pause'}</div>
}

export function Canvas() {
  const sign = useSign((s) => s.sign)
  const sheet = useUI((s) => s.sheet)
  const frame = useDisplay()
  const click = useClickToPause()
  const svg = useMemo(
    () => signToSvg(sign, { build: sign.view.build, bg: true, idPrefix: 'c-', outlines: frame.outlines, paints: frame.paints }),
    [sign, frame],
  )
  if (sheet)
    return (
      <div className="canvas">
        <ContactSheet />
      </div>
    )
  if (sign.view.mode === '3d')
    return (
      <div className="canvas canvas3d" {...click}>
        <Suspense fallback={<div className="loading">Loading 3D…</div>}>
          <Scene3D />
        </Suspense>
        <PauseBadge />
      </div>
    )
  return (
    <div className="canvas" {...click}>
      <div className="svgwrap" dangerouslySetInnerHTML={{ __html: svg }} />
      <PauseBadge />
    </div>
  )
}
