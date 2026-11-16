import { Environment, Lightformer, OrbitControls, OrthographicCamera, PerspectiveCamera, SoftShadows } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { EnvPreset, MaterialPreset, Outline, PieceId } from '../types'
import { SPIN_AXIS, formSlot, spinAngles } from '../anim/spin'
import { engine, useDisplay } from '../anim/bind'
import type { DisplayFrame } from '../anim/engine'
import { outlineToPathD } from '../geometry/serialize'
import { extrudeOutline } from './shapes'
import { materialSpec, pieceColor } from './materials'
import { capture3d } from './capture'
import { useSign } from '../store/useSign'

function Material({ preset, color, depth }: { preset: MaterialPreset; color: string; depth: number }) {
  const { kind, props } = materialSpec(preset, color, depth)
  return kind === 'physical' ? <meshPhysicalMaterial {...props} /> : <meshStandardMaterial {...props} />
}

/** Окружение собирается из светящихся панелей (без загрузки HDR из сети). */
const RIGS: Record<EnvPreset, { color: string; intensity: number; pos: [number, number, number]; scale: [number, number, number] }[]> = {
  studio: [
    { color: '#ffffff', intensity: 3.2, pos: [0, 6, 2], scale: [10, 4, 1] },
    { color: '#f2f6ff', intensity: 1.8, pos: [-6, 1, 3], scale: [4, 8, 1] },
    { color: '#fff4e8', intensity: 1.4, pos: [6, 0, 3], scale: [3, 8, 1] },
    { color: '#ffffff', intensity: 0.8, pos: [0, -5, 3], scale: [10, 2, 1] },
    { color: '#ffffff', intensity: 1.6, pos: [0, 0, 9], scale: [14, 9, 1] },
  ],
  warm: [
    { color: '#ffb36b', intensity: 3.4, pos: [-5, 3, 3], scale: [6, 6, 1] },
    { color: '#ff7a59', intensity: 1.6, pos: [6, -1, 2], scale: [3, 8, 1] },
    { color: '#fff1d6', intensity: 1.6, pos: [0, 6, 0], scale: [10, 3, 1] },
    { color: '#ffd9b0', intensity: 1.5, pos: [0, 0, 9], scale: [14, 9, 1] },
  ],
  cool: [
    { color: '#8fb8ff', intensity: 3, pos: [5, 4, 3], scale: [6, 6, 1] },
    { color: '#c8e4ff', intensity: 1.8, pos: [-6, 0, 2], scale: [3, 8, 1] },
    { color: '#ffffff', intensity: 1.2, pos: [0, 6, 0], scale: [10, 3, 1] },
    { color: '#cfe2ff', intensity: 1.5, pos: [0, 0, 9], scale: [14, 9, 1] },
  ],
  contrast: [
    { color: '#ffffff', intensity: 8, pos: [-5, 4, 3], scale: [2, 8, 1] },
    { color: '#ffffff', intensity: 8, pos: [6, 2, -1], scale: [1.5, 8, 1] },
    { color: '#202028', intensity: 0.5, pos: [0, -4, 3], scale: [12, 4, 1] },
    { color: '#ffffff', intensity: 0.8, pos: [0, 0, 9], scale: [6, 9, 1] },
  ],
}

const ENV_BG: Record<EnvPreset, string> = { studio: '#8e8e96', warm: '#5e4a3d', cool: '#43505f', contrast: '#101014' }

function EnvRig({ preset }: { preset: EnvPreset }) {
  return (
    <Environment key={preset} resolution={256}>
      <color attach="background" args={[ENV_BG[preset]]} />
      {RIGS[preset].map((l, i) => (
        <Lightformer key={i} form="rect" color={l.color} intensity={l.intensity} position={l.pos} scale={l.scale} onUpdate={(self) => self.lookAt(0, 0, 0)} />
      ))}
    </Environment>
  )
}

type GroupRef = React.RefObject<THREE.Group | null>

function Piece({
  outline,
  z,
  opts,
  preset,
  color,
  group,
  angle,
}: {
  outline: Outline
  z: number
  opts: { depth: number; bevel: number; bevelSegments: number }
  preset: MaterialPreset
  color: string
  group: GroupRef
  /** угол поворота из кадра экспорта; живое вращение задаёт SpinDriver */
  angle?: number
}) {
  const sig = outlineToPathD(outline)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geo = useMemo(() => extrudeOutline(outline, opts), [sig, opts.depth, opts.bevel, opts.bevelSegments])
  useEffect(() => () => geo.dispose(), [geo])
  useLayoutEffect(() => {
    if (angle !== undefined) group.current?.quaternion.setFromAxisAngle(SPIN_AXIS, angle)
  }, [angle, group])
  return (
    <group ref={group}>
      <mesh geometry={geo} position={[0, 0, z]} castShadow receiveShadow>
        <Material key={preset} preset={preset} color={color} depth={opts.depth} />
      </mesh>
    </group>
  )
}

/**
 * Живое вращение деталей вокруг вертикали через O. Углы копятся по времени кадра; когда верхняя
 * деталь проходит угол смены (первый — «ребром»), форма меняется. При нулевой скорости
 * деталь плавно возвращается в исходное положение. Во время покадрового экспорта углы
 * задаёт кадр, и драйвер не вмешивается.
 */
function SpinDriver({ groups }: { groups: Record<PieceId, GroupRef> }) {
  useFrame((_, delta) => {
    if (engine.get().spin) return
    const s = useSign.getState().sign
    const dt = Math.min(delta, 0.1) // после фоновой вкладки не «проворачиваемся» рывком
    const k = s.spin.formsPerTurn
    const before = formSlot(spinAngles.top, k)
    for (const id of ['top', 'bottom'] as const) {
      const speed = s.spin[id]
      if (speed) spinAngles[id] += 2 * Math.PI * speed * dt
      else {
        const home = Math.round(spinAngles[id] / (2 * Math.PI)) * 2 * Math.PI
        spinAngles[id] += (home - spinAngles[id]) * Math.min(1, dt * 6)
      }
      groups[id].current?.quaternion.setFromAxisAngle(SPIN_AXIS, spinAngles[id])
    }
    if (k && s.spin.top && formSlot(spinAngles.top, k) !== before) useSign.getState().advanceForm()
  })
  return null
}

function Rig({ ext, camera, ortho, autoRotate }: { ext: number; camera: 'front' | 'iso'; ortho: boolean; autoRotate: boolean }) {
  const size = useThree((s) => s.size)
  const cam = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null
  useEffect(() => {
    // дистанция так, чтобы знак целиком влезал и по ширине, и по высоте канваса
    const fov = cam instanceof THREE.PerspectiveCamera ? cam.fov : 28
    const aspect = size.width / Math.max(1, size.height)
    const d = (ext * 1.35) / (Math.tan((fov * Math.PI) / 360) * Math.min(1, aspect))
    const dir = camera === 'front' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0.9, 1).normalize()
    cam.position.copy(dir.multiplyScalar(d))
    cam.lookAt(0, 0, 0)
    if (cam instanceof THREE.OrthographicCamera) {
      cam.zoom = Math.min(size.width, size.height) / (ext * 2.3)
      cam.near = -1000
      cam.far = 1000
    }
    cam.updateProjectionMatrix()
    controls?.target.set(0, 0, 0)
    controls?.update()
    // перестройка только при смене пресета/проекции/габарита, чтобы не сбивать orbit пользователя
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, ortho, ext, controls, cam, size.width, size.height])
  return <OrbitControls makeDefault enableDamping autoRotate={autoRotate} autoRotateSpeed={1.6} />
}

/**
 * Рендер текущей сцены в квадратный PNG заданного размера (как и 2D-экспорт), независимо от размера окна.
 * Камера на время рендера подгоняется под квадрат, затем возвращается; при transparent фон сцены убирается.
 */
function Capture() {
  const { gl, scene, camera, size } = useThree()
  useEffect(() => {
    capture3d.current = async (side, transparent) => {
      const ratio = gl.getPixelRatio()
      const bg = scene.background
      const clearAlpha = gl.getClearAlpha()
      const saved =
        camera instanceof THREE.PerspectiveCamera
          ? { aspect: camera.aspect, zoom: camera.zoom }
          : camera instanceof THREE.OrthographicCamera
            ? { l: camera.left, r: camera.right, t: camera.top, b: camera.bottom, zoom: camera.zoom }
            : null
      const aspect = size.width / size.height
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = 1
        camera.zoom = camera.zoom / Math.min(1, aspect) // сохраняем кадрирование, подобранное под ширину
      } else if (camera instanceof THREE.OrthographicCamera) {
        camera.left = -side / 2
        camera.right = side / 2
        camera.top = side / 2
        camera.bottom = -side / 2
        camera.zoom = camera.zoom * (side / Math.min(size.width, size.height))
      }
      camera.updateProjectionMatrix()
      gl.setPixelRatio(1)
      gl.setSize(side, side, false)
      if (transparent) {
        scene.background = null
        gl.setClearAlpha(0)
      }
      gl.render(scene, camera)
      const blob = await new Promise<Blob | null>((res) => gl.domElement.toBlob(res, 'image/png'))
      scene.background = bg
      gl.setClearAlpha(clearAlpha)
      if (saved && camera instanceof THREE.PerspectiveCamera) Object.assign(camera, saved)
      else if (saved && camera instanceof THREE.OrthographicCamera) {
        const q = saved as { l: number; r: number; t: number; b: number; zoom: number }
        Object.assign(camera, { left: q.l, right: q.r, top: q.t, bottom: q.b, zoom: q.zoom })
      }
      camera.updateProjectionMatrix()
      gl.setPixelRatio(ratio)
      gl.setSize(size.width, size.height, false)
      gl.render(scene, camera)
      if (!blob) throw new Error('Could not get the PNG from WebGL')
      return blob
    }
    capture3d.video = videoApi(gl, scene, camera, size)
    return () => {
      capture3d.current = null
      capture3d.video = null
    }
  }, [gl, scene, camera, size])
  return null
}

type Cam = THREE.Camera
/**
 * Покадровый рендер для видео. Кадр 16:9 любого размера: камера подгоняется так же,
 * как для PNG (знак кадрируется по высоте), затем каждый кадр морфинга фиксируется
 * в движке, ждём, пока React перестроит геометрию, и рендерим.
 */
function videoApi(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: Cam, size: { width: number; height: number }) {
  let restore: (() => void) | null = null
  return {
    begin(width: number, height: number) {
      const ratio = gl.getPixelRatio()
      const screenAspect = size.width / size.height
      const saved =
        camera instanceof THREE.PerspectiveCamera
          ? { aspect: camera.aspect, zoom: camera.zoom }
          : camera instanceof THREE.OrthographicCamera
            ? { left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom, zoom: camera.zoom }
            : {}
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = width / height
        camera.zoom = camera.zoom / Math.min(1, screenAspect)
      } else if (camera instanceof THREE.OrthographicCamera) {
        Object.assign(camera, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 })
        camera.zoom = camera.zoom * (height / Math.min(size.width, size.height))
      }
      ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix?.()
      gl.setPixelRatio(1)
      gl.setSize(width, height, false)
      restore = () => {
        Object.assign(camera, saved)
        ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix?.()
        gl.setPixelRatio(ratio)
        gl.setSize(size.width, size.height, false)
      }
    },
    async frame(f: DisplayFrame) {
      engine.hold(f)
      // ждём, пока R3F закоммитит сцену с этим кадром (геометрия строится в рендере компонентов)
      for (let i = 0; i < 200 && capture3d.committed !== f; i++) await new Promise((r) => setTimeout(r, 0))
      gl.render(scene, camera)
      return gl.domElement
    },
    end() {
      engine.hold(null)
      restore?.()
      restore = null
      gl.render(scene, camera)
    },
  }
}

function SignScene() {
  const sign = useSign((s) => s.sign)
  const v = sign.view3d
  // во время морфинга геометрия перестраивается каждый кадр из промежуточного контура
  const frame = useDisplay()
  const { outlines } = frame
  const topGroup = useRef<THREE.Group>(null)
  const bottomGroup = useRef<THREE.Group>(null)
  const groups = { top: topGroup, bottom: bottomGroup }
  // отметка для покадрового экспорта: сцена с этим кадром закоммичена
  useLayoutEffect(() => {
    capture3d.committed = frame
  }, [frame])
  // габарит зависит только от сетки и зазора: камера не дёргается во время анимации
  const ext = sign.grid.N + Math.max(0, sign.gap) / 2 + 1
  const opts = { depth: v.depth, bevel: v.bevel, bevelSegments: v.bevelSegments }
  const zMin = Math.min(sign.top.zShift, sign.bottom.zShift) - v.depth / 2
  return (
    <>
      <color attach="background" args={[sign.color.bg]} />
      {v.ortho ? (
        <OrthographicCamera makeDefault key="ortho" position={[0, 0, 50]} />
      ) : (
        <PerspectiveCamera makeDefault key="persp" fov={28} near={0.1} far={2000} position={[0, 0, 50]} />
      )}
      <Capture />
      <Rig ext={ext} camera={v.camera} ortho={v.ortho} autoRotate={v.autoRotate} />
      <EnvRig preset={v.env} />
      <ambientLight intensity={0.15} />
      {v.shadows && (
        <>
          <SoftShadows size={22} samples={12} focus={0.6} />
          <directionalLight
            castShadow
            intensity={2.2}
            position={[-ext * 0.8, ext * 1.3, ext * 2]}
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-ext * 1.8}
            shadow-camera-right={ext * 1.8}
            shadow-camera-top={ext * 1.8}
            shadow-camera-bottom={-ext * 1.8}
            shadow-camera-near={0.5}
            shadow-camera-far={ext * 10}
            shadow-bias={-0.0004}
          />
          <mesh position={[0, 0, zMin - Math.max(1.2, ext * 0.18)]} receiveShadow>
            <planeGeometry args={[ext * 8, ext * 8]} />
            <shadowMaterial opacity={0.38} />
          </mesh>
        </>
      )}
      <SpinDriver groups={groups} />
      {(['top', 'bottom'] as const).map((id) => (
        <Piece
          key={id}
          outline={outlines[id]}
          z={sign[id].zShift}
          opts={opts}
          preset={sign[id].material}
          color={frame.paints?.[id].stops[0].color ?? pieceColor(sign, id)}
          group={groups[id]}
          angle={frame.spin?.[id]}
        />
      ))}
    </>
  )
}

export default function Scene3D() {
  return (
    <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, toneMapping: THREE.NeutralToneMapping }}>
      <SignScene />
    </Canvas>
  )
}
