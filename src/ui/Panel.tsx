import { button, Leva, levaStore, useControls } from 'leva'
import { useEffect } from 'react'
import type { Paint, PieceId } from '../types'
import { formCount, formName } from '../geometry/configs'
import { deleteCurrentForm, importFromSvg, restoreBuiltinForms } from '../import/actions'
import { GRID_SIZES } from '../geometry/grid'
import { ANIM_LIMITS, PALETTES, SPIN_LIMIT, paintOf, spreadPalettes, withPaint } from '../model'
import { useSign } from '../store/useSign'
import { exportAnimation, exportGlbFile, exportJson, exportOptions, exportPng2d, exportPng3d, exportSvg, importJson } from '../export/svg'

type Values = Record<string, any>
type Spec = Record<string, any>

const st = () => useSign.getState()

/**
 * Пишет значения в панель по полным путям, минуя set() из useControls: тот держит
 * карту путей первого рендера и падает после смены схемы (например, архетипа).
 */
function push(folder: string, values: Values) {
  const data = levaStore.getData()
  const out: Values = {}
  for (const [k, v] of Object.entries(values)) if (`${folder}.${k}` in data) out[`${folder}.${k}`] = v
  if (Object.keys(out).length) levaStore.set(out, false)
}

/**
 * Связка leva ↔ store. Store — источник истины: изменения из панели (fromPanel)
 * пишутся в store через write, а любое изменение store (undo, randomize, пресет)
 * возвращается в панель через set().
 */
function useBound(
  folder: string,
  spec: Spec,
  getValues: () => Values,
  write: (key: string, value: any, all: Values) => void,
  deps: unknown[],
  extra: Spec = {},
) {
  // подписка на store: любое изменение (undo, randomize, пресет) перерисовывает связку и пушит значения в панель
  useSign((s) => s.sign)
  useControls(
    folder,
    () => {
      const init = getValues()
      const schema: Spec = {}
      Object.entries(spec).forEach(([k, cfg], i) => {
        schema[k] = {
          ...cfg,
          order: i + 10, // кнопки (order 0) всегда идут первыми
          value: init[k],
          onChange: (v: any, _p: string, ctx: { fromPanel: boolean; initial: boolean }) => {
            // leva при инициализации помечает первый контрол папки как fromPanel,
            // поэтому записи без реального изменения значения отбрасываем
            if (!ctx.fromPanel || ctx.initial || getValues()[k] === v) return
            write(k, v, { ...getValues(), [k]: v })
            push(folder, getValues())
          },
        }
      })
      return { ...schema, ...extra }
    },
    deps,
  )
  const key = JSON.stringify(getValues())
  useEffect(() => {
    push(folder, getValues())
    // после смены схемы (deps) leva может вернуть старое значение, поэтому дублируем на следующем кадре
    const raf = requestAnimationFrame(() => push(folder, getValues()))
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

function paintValues(id: PieceId, p: Paint): Values {
  const c = p.stops.map((s) => s.color)
  return {
    [`${id}Type`]: p.type,
    [`${id}Color1`]: c[0],
    [`${id}Color2`]: c[1] ?? c[0],
    [`${id}Color3`]: c[2] ?? c[1] ?? c[0],
    [`${id}Stops`]: Math.min(3, p.stops.length) as number,
    [`${id}Angle`]: p.angle,
  }
}
function paintFrom(id: PieceId, v: Values): Paint {
  const type = v[`${id}Type`] as Paint['type']
  const n = type === 'solid' ? 2 : (v[`${id}Stops`] as number)
  const cols = type === 'solid' ? [v[`${id}Color1`], v[`${id}Color1`]] : [v[`${id}Color1`], v[`${id}Color2`], v[`${id}Color3`]].slice(0, n)
  return { type, angle: v[`${id}Angle`], stops: cols.map((color, i) => ({ color, at: i / (cols.length - 1) })) }
}

function RoundingControls() {
  const N = useSign((s) => s.sign.grid.N)
  const spec: Spec = {}
  const get = () => {
    const s = st().sign
    const v: Values = {}
    for (const id of ['top', 'bottom'] as const)
      for (const k of ['convex', 'concave', 'origin'] as const) v[`${id}_${k}`] = s[id].rounding[k]
    return v
  }
  for (const id of ['top', 'bottom'] as const)
    for (const [k, label] of [['convex', 'convex'], ['concave', 'concave'], ['origin', 'corner O']] as const)
      spec[`${id}_${k}`] = { min: 0, max: N, step: 0.5, label: `${id}: ${label}` }
  useBound(
    'Rounding',
    spec,
    get,
    (key, value) => {
      const [id, k] = key.split('_') as [PieceId, 'convex' | 'concave' | 'origin']
      st().update((s) => ({ ...s, [id]: { ...s[id], rounding: { ...s[id].rounding, [k]: value } } }), `r.${key}`)
    },
    [N],
  )
  return null
}

function ColorControls() {
  const perForm = useSign((s) => s.sign.color.perForm)
  const config = useSign((s) => s.sign.config)
  // при цветах по формам правится заливка текущей формы — номер формы виден в подписи
  const scope = perForm ? ` · form ${config + 1}` : ''
  const spec: Spec = {
    perForm: { label: 'colors per form' },
    palette: { options: PALETTES.map((p) => p.name), label: `palette${scope}` },
    bg: { label: 'background' },
    singleGradient: { label: 'one gradient for whole sign' },
  }
  for (const id of ['top', 'bottom'] as const) {
    const t = `${id}${scope}`
    spec[`${id}Type`] = { options: ['solid', 'linear', 'radial'], label: `${t}: fill` }
    spec[`${id}Color1`] = { label: `${t}: color 1` }
    spec[`${id}Color2`] = { label: `${t}: color 2`, render: (get: any) => get(`Color.${id}Type`) !== 'solid' }
    spec[`${id}Stops`] = { options: [2, 3], label: `${t}: stops`, render: (get: any) => get(`Color.${id}Type`) !== 'solid' }
    spec[`${id}Color3`] = { label: `${t}: color 3`, render: (get: any) => get(`Color.${id}Type`) !== 'solid' && get(`Color.${id}Stops`) === 3 }
    spec[`${id}Angle`] = { min: 0, max: 360, step: 5, label: `${t}: angle`, render: (get: any) => get(`Color.${id}Type`) === 'linear' }
  }
  useBound(
    'Color',
    spec,
    () => {
      const s = st().sign
      return {
        perForm: s.color.perForm,
        palette: s.color.palette,
        bg: s.color.bg,
        singleGradient: s.color.singleGradient,
        ...paintValues('top', paintOf(s, 'top')),
        ...paintValues('bottom', paintOf(s, 'bottom')),
      }
    },
    (key, value, all) => {
      if (key === 'palette') return st().applyPalette(value)
      st().update(
        (s) => {
          if (key === 'perForm')
            // при включении все формы стартуют с текущих общих цветов; их можно сразу развести кнопкой
            return {
              ...s,
              color: { ...s.color, perForm: value, formPaints: value ? s.color.formPaints.map(() => ({ top: s.top.paint, bottom: s.bottom.paint })) : s.color.formPaints },
            }
          if (key === 'bg') return { ...s, color: { ...s.color, bg: value } }
          if (key === 'singleGradient') return { ...s, color: { ...s.color, singleGradient: value } }
          const id = key.startsWith('top') ? 'top' : 'bottom'
          const next = withPaint(s, id, paintFrom(id, all))
          return { ...next, color: { ...next.color, palette: 'custom' } }
        },
        `c.${key}`,
      )
    },
    [perForm, config],
    { 'Palettes → forms': button(() => st().update(spreadPalettes)) },
  )
  return null
}

function GridControls() {
  const N = useSign((s) => s.sign.grid.N)
  useBound(
    'Grid',
    {
      N: { options: [...GRID_SIZES], label: 'N (modules/quadrant)' },
      gap: { min: -N, max: N, step: 0.5, label: 'gap' },
      build: { label: 'construction mode' },
    },
    () => {
      const s = st().sign
      return { N: s.grid.N, gap: s.gap, build: s.view.build }
    },
    (key, value) => {
      const a = st()
      if (key === 'N') return a.setN(value)
      a.update((s) => (key === 'gap' ? { ...s, gap: value } : { ...s, view: { ...s.view, build: value } }), `g.${key}`)
    },
    [N],
  )
  return null
}

function SignControls() {
  // список форм меняется при загрузке и удалении: пересобираем селект по именам
  const names = useSign((s) => Array.from({ length: formCount(s.sign) }, (_, i) => formName(s.sign, i)).join('\n'))
  const options = Object.fromEntries(names.split('\n').map((n, i) => [n, i]))
  useBound(
    'Sign',
    {
      config: { options, label: 'form' },
      seed: { step: 1, label: 'seed' },
    },
    () => {
      const s = st().sign
      return { config: s.config, seed: s.seed }
    },
    (key, value) => {
      if (key === 'config') return st().setConfig(Number(value))
      st().setSeed(Math.max(0, Math.floor(Number(value) || 0)) >>> 0)
    },
    [names],
    {
      Randomize: button(() => st().randomize()),
      'Import sign (SVG)': button(() => void importFromSvg('sign')),
      'Replace top piece (SVG)': button(() => void importFromSvg('top')),
      'Replace bottom piece (SVG)': button(() => void importFromSvg('bottom')),
      'Delete this form': button(() => deleteCurrentForm()),
      'Restore built-in forms': button(() => restoreBuiltinForms()),
    },
  )
  return null
}

function AnimationControls() {
  const isMorph = (get: (p: string) => unknown) => get('Animation.mode') === 'morph'
  const isAuto = (get: (p: string) => unknown) => get('Animation.autoplay') === true
  useBound(
    'Animation',
    {
      mode: { options: { 'smooth morph': 'morph', 'hard cut': 'cut' }, label: 'shape change' },
      duration: { min: ANIM_LIMITS.duration[0], max: ANIM_LIMITS.duration[1], step: 10, label: 'duration, ms', render: isMorph },
      easing: { options: { linear: 'linear', 'ease-in-out': 'easeInOut', 'expo-out': 'expoOut', 'back-out': 'backOut' }, label: 'curve', render: isMorph },
      autoplay: { label: 'autoplay' },
      interval: { min: ANIM_LIMITS.interval[0], max: ANIM_LIMITS.interval[1], step: 0.1, label: 'every, s', render: isAuto },
    },
    () => ({ ...st().sign.anim }),
    (key, value) => st().update((s) => ({ ...s, anim: { ...s.anim, [key]: value } }), `anim.${key}`),
    [],
  )
  return null
}

const MATERIALS = { matte: 'matte', 'glossy plastic': 'glossy', metal: 'metal', 'glass': 'glass', clay: 'clay', emissive: 'emissive' }

function ThreeDControls() {
  const N = useSign((s) => s.sign.grid.N)
  const is3d = (get: (p: string) => unknown) => get('3D.mode') === '3d'
  const spec: Spec = {
    mode: { options: { '2D': '2d', '3D': '3d' }, label: 'mode' },
    depth: { min: 0.5, max: N, step: 0.5, label: 'depth', render: is3d },
    bevel: { min: 0, max: 3, step: 0.1, label: 'bevel: size', render: is3d },
    bevelSegments: { min: 0, max: 8, step: 1, label: 'bevel: segments', render: is3d },
    zTop: { min: -N, max: N, step: 0.5, label: 'Z top', render: is3d },
    zBottom: { min: -N, max: N, step: 0.5, label: 'Z bottom', render: is3d },
    matTop: { options: MATERIALS, label: 'material top', render: is3d },
    matBottom: { options: MATERIALS, label: 'material bottom', render: is3d },
    env: { options: ['studio', 'warm', 'cool', 'contrast'], label: 'environment', render: is3d },
    shadows: { label: 'soft shadows', render: is3d },
    ortho: { label: 'orthographic', render: is3d },
    camera: { options: ['front', 'iso'], label: 'camera', render: is3d },
    autoRotate: { label: 'auto-rotate', render: is3d },
    spinTop: { min: -SPIN_LIMIT, max: SPIN_LIMIT, step: 0.05, label: 'spin top, turns/s', render: is3d },
    spinBottom: { min: -SPIN_LIMIT, max: SPIN_LIMIT, step: 0.05, label: 'spin bottom, turns/s', render: is3d },
    formsPerTurn: { options: { 'no change': 0, '1 per turn': 1, '2 per turn': 2, '4 per turn': 4 }, label: 'top: forms per turn', render: is3d },
  }
  useBound(
    '3D',
    spec,
    () => {
      const s = st().sign
      return {
        mode: s.view.mode,
        ...s.view3d,
        zTop: s.top.zShift,
        zBottom: s.bottom.zShift,
        matTop: s.top.material,
        matBottom: s.bottom.material,
        spinTop: s.spin.top,
        spinBottom: s.spin.bottom,
        formsPerTurn: s.spin.formsPerTurn,
      }
    },
    (key, value) => {
      st().update(
        (s) => {
          if (key === 'mode') return { ...s, view: { ...s.view, mode: value } }
          if (key === 'zTop') return { ...s, top: { ...s.top, zShift: value } }
          if (key === 'zBottom') return { ...s, bottom: { ...s.bottom, zShift: value } }
          if (key === 'matTop') return { ...s, top: { ...s.top, material: value } }
          if (key === 'matBottom') return { ...s, bottom: { ...s.bottom, material: value } }
          if (key === 'spinTop') return { ...s, spin: { ...s.spin, top: value } }
          if (key === 'spinBottom') return { ...s, spin: { ...s.spin, bottom: value } }
          if (key === 'formsPerTurn') return { ...s, spin: { ...s.spin, formsPerTurn: Number(value) as 0 | 1 | 2 | 4 } }
          return { ...s, view3d: { ...s.view3d, [key]: value } }
        },
        `3d.${key}`,
      )
    },
    [N],
  )
  return null
}

function ExportControls() {
  useControls('Export', {
    'PNG scale': { value: exportOptions.scale, options: { '1x (1024)': 1, '2x (2048)': 2, '4x (4096)': 4 }, onChange: (v: number) => (exportOptions.scale = v) },
    'background in export': { value: exportOptions.bg, onChange: (v: boolean) => (exportOptions.bg = v) },
    SVG: button(() => void exportSvg()),
    'PNG 2D': button(() => void exportPng2d()),
    'PNG 3D': button(() => void exportPng3d()),
    GLB: button(() => void exportGlbFile()),
    'video size': { value: exportOptions.videoHeight, options: { '1080p (1920×1080)': 1080, '720p (1280×720)': 720 }, onChange: (v: 720 | 1080) => (exportOptions.videoHeight = v) },
    'video format': { value: exportOptions.videoFormat, options: { 'MP4 (H.264)': 'mp4', GIF: 'gif' }, onChange: (v: 'mp4' | 'gif') => (exportOptions.videoFormat = v) },
    'Animation ▶': button(() => void exportAnimation()),
    'JSON ↓ (export)': button(() => void exportJson()),
    'JSON ↑ (import)': button(() => importJson()),
  })
  return null
}

export function Panel() {
  return (
    <>
      <Leva titleBar={{ title: 'Abstract Sign' }} theme={{ sizes: { rootWidth: '340px' } }} />
      <GridControls />
      <SignControls />
      <AnimationControls />
      <RoundingControls />
      <ColorControls />
      <ThreeDControls />
      <ExportControls />
    </>
  )
}
