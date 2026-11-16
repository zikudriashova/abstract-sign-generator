import * as THREE from 'three'

/** Ось вращения деталей — общая вертикаль знака через O: детали поворачиваются вокруг неё, как створки двери. */
export const SPIN_AXIS = new THREE.Vector3(0, 1, 0)

/**
 * Номер «сектора формы» при угле поворота: смены формы приходятся на углы
 * π/2 + j·2π/k, первая — когда деталь стоит ребром. При k=2 обе смены прячутся «в ребро».
 */
export function formSlot(angle: number, formsPerTurn: number): number {
  if (!formsPerTurn) return 0
  return Math.floor((angle - Math.PI / 2) / ((2 * Math.PI) / formsPerTurn))
}

/** Живые углы поворота деталей (рад); общая точка правды для сцены и смены форм. */
export const spinAngles = { top: 0, bottom: 0 }
