import { useFavorites } from '../store/useFavorites'
import { useSign } from '../store/useSign'
import { useUI } from '../store/useUI'
import { exportSvg } from '../export/svg'
import { formCount, formName, isCustom } from '../geometry/configs'

export function Toolbar() {
  const { undo, redo, randomize, update, past, future } = useSign()
  const build = useSign((s) => s.sign.view.build)
  const mode = useSign((s) => s.sign.view.mode)
  const config = useSign((s) => s.sign.config)
  const names = useSign((s) => Array.from({ length: formCount(s.sign) }, (_, i) => `${isCustom(s.sign, i) ? '*' : ''}${formName(s.sign, i)}`).join('\n')).split('\n')
  const autoplay = useSign((s) => s.sign.anim.autoplay)
  const sheet = useUI((s) => s.sheet)
  const setSheet = useUI((s) => s.setSheet)
  return (
    <div className="toolbar">
      <button onClick={() => randomize()} title="R">Randomize</button>
      <span className="configs" role="group" aria-label="Configuration">
        {names.map((raw, i) => {
          const custom = raw.startsWith('*')
          const name = custom ? raw.slice(1) : raw
          return (
          <button
            key={i}
            className={[i === config ? 'on' : '', custom ? 'custom' : ''].join(' ')}
            title={i < 9 ? `${name} (key ${i + 1})` : name}
            onClick={() => useSign.getState().setConfig(i)}
          >
            {i + 1}
          </button>
          )
        })}
      </span>
      <button
        className={autoplay ? 'on' : ''}
        title="Autoplay (Space pauses)"
        onClick={() => {
          useUI.getState().setPaused(false)
          update((s) => ({ ...s, anim: { ...s.anim, autoplay: !s.anim.autoplay } }), 'anim.autoplay')
        }}
      >
        {autoplay ? '■ Stop' : '▶ Play'}
      </button>
      <button onClick={undo} disabled={!past.length} title="⌘Z">Undo</button>
      <button onClick={redo} disabled={!future.length} title="⇧⌘Z">Redo</button>
      <button className={mode === '3d' ? 'on' : ''} onClick={() => update((s) => ({ ...s, view: { ...s.view, mode: s.view.mode === '3d' ? '2d' : '3d' } }))}>
        {mode === '3d' ? '3D' : '2D'}
      </button>
      <button className={sheet ? 'on' : ''} onClick={() => setSheet(!sheet)}>Sheet</button>
      <button className={build ? 'on' : ''} onClick={() => update((s) => ({ ...s, view: { ...s.view, build: !s.view.build } }))}>
        Construction
      </button>
      <button onClick={() => useFavorites.getState().add(useSign.getState().sign)} title="Save to favorites">★</button>
      <button onClick={exportSvg}>SVG</button>
    </div>
  )
}
