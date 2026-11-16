import { useMemo } from 'react'
import { formCount, formName } from '../geometry/configs'
import { signToSvg } from '../render2d/svg'
import { useSign } from '../store/useSign'
import { useUI } from '../store/useUI'

/** Все пять конфигураций с текущими цветами и настройками; клик выбирает конфигурацию (с анимацией). */
export function ContactSheet() {
  const sign = useSign((s) => s.sign)
  const setSheet = useUI((s) => s.setSheet)
  const items = useMemo(
    () =>
      Array.from({ length: formCount(sign) }, (_, i) => ({
        name: formName(sign, i),
        i,
        svg: signToSvg({ ...sign, config: i }, { build: false, bg: true, idPrefix: `s${i}-` }),
      })),
    [sign],
  )
  return (
    <div className="sheet">
      <div className="sheet-head">
        <span>All forms — click one to switch</span>
        <button onClick={() => setSheet(false)}>Close</button>
      </div>
      <div className="sheet-grid">
        {items.map((it) => (
          <button
            key={it.i}
            className={it.i === sign.config ? 'sheet-item current' : 'sheet-item'}
            title={it.name}
            onClick={() => {
              useSign.getState().setConfig(it.i)
              setSheet(false)
            }}
          >
            <span dangerouslySetInnerHTML={{ __html: it.svg }} />
            <small>{it.name}</small>
          </button>
        ))}
      </div>
    </div>
  )
}
