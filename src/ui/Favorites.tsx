import { signToSvg } from '../render2d/svg'
import { useFavorites } from '../store/useFavorites'
import { useSign } from '../store/useSign'

export function Favorites() {
  const items = useFavorites((s) => s.items)
  const remove = useFavorites((s) => s.remove)
  if (!items.length) return null
  return (
    <div className="favs" aria-label="Favorites">
      {items.map((f) => (
        <div key={f.id} className="fav">
          <button
            title="Restore"
            onClick={() => useSign.getState().update((s) => ({ ...f.state, view: s.view }))}
            dangerouslySetInnerHTML={{ __html: signToSvg(f.state, { build: false, bg: true, idPrefix: `f${f.id}-` }) }}
          />
          <span className="x" title="Delete" onClick={() => remove(f.id)}>×</span>
        </div>
      ))}
    </div>
  )
}
