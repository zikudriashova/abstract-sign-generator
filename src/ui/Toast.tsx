import { useUI } from '../store/useUI'

export function Toast() {
  const toast = useUI((s) => s.toast)
  if (!toast) return null
  return (
    <div className={toast.error ? 'toast error' : 'toast'} role="status" key={toast.id}>
      {toast.text}
    </div>
  )
}
