import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { buildSign } from '../geometry/sign'
import { createMaterial, pieceColor } from '../render3d/materials'
import { extrudeOutline } from '../render3d/shapes'
import type { PieceId, SignState } from '../types'

/** Сцена для экспорта: те же контуры, экструзия и материалы, что в 3D-виде. 1 модуль = 1 единица. */
export function buildExportScene(s: SignState): THREE.Scene {
  const scene = new THREE.Scene()
  const outlines = buildSign(s)
  const v = s.view3d
  for (const id of ['top', 'bottom'] as PieceId[]) {
    const mesh = new THREE.Mesh(
      extrudeOutline(outlines[id], { depth: v.depth, bevel: v.bevel, bevelSegments: v.bevelSegments }),
      createMaterial(s[id].material, pieceColor(s, id), v.depth),
    )
    mesh.name = id
    mesh.position.z = s[id].zShift
    scene.add(mesh)
  }
  return scene
}

export async function exportGlb(s: SignState): Promise<Blob> {
  const buf = (await new GLTFExporter().parseAsync(buildExportScene(s), { binary: true })) as ArrayBuffer
  return new Blob([buf], { type: 'model/gltf-binary' })
}
