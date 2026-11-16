import * as THREE from 'three'
import type { MaterialPreset, PieceId, SignState } from '../types'
import { renderPaint } from '../model'

export interface MaterialSpec {
  kind: 'standard' | 'physical'
  props: Record<string, unknown>
}

/** Описание материала: одно и то же для сцены (JSX) и для GLB-экспорта. */
export function materialSpec(preset: MaterialPreset, color: string, depth: number): MaterialSpec {
  switch (preset) {
    case 'matte':
      return { kind: 'standard', props: { color, roughness: 0.92, metalness: 0 } }
    case 'glossy':
      return { kind: 'physical', props: { color, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 } }
    case 'metal':
      return { kind: 'standard', props: { color, metalness: 1, roughness: 0.22 } }
    case 'glass':
      return {
        kind: 'physical',
        props: {
          color: '#ffffff',
          transmission: 1,
          thickness: depth,
          roughness: 0.04,
          ior: 1.5,
          attenuationColor: color,
          attenuationDistance: Math.max(3, depth * 6),
        },
      }
    case 'clay':
      return { kind: 'physical', props: { color, roughness: 1, metalness: 0, sheen: 0.7, sheenRoughness: 0.8, sheenColor: color } }
    case 'emissive':
      return { kind: 'standard', props: { color, emissive: color, emissiveIntensity: 1.4, roughness: 0.5 } }
  }
}

export function createMaterial(preset: MaterialPreset, color: string, depth: number): THREE.Material {
  const { kind, props } = materialSpec(preset, color, depth)
  return kind === 'physical' ? new THREE.MeshPhysicalMaterial(props) : new THREE.MeshStandardMaterial(props)
}

/** Цвет детали в 3D: первый цвет её заливки (градиенты в 3D пока не поддерживаются). */
export function pieceColor(s: SignState, id: PieceId): string {
  return renderPaint(s, id).stops[0].color
}
