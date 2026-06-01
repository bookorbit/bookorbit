export const SQUARE_RATIO_TARGET = 1
export const SQUARE_RATIO_TOLERANCE = 0.08
const COVER_RATIO_EPSILON = 0.0001

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function shouldPersistCoverRatio(previous: number | undefined, next: number | null): next is number {
  if (!isFinitePositive(next)) return false
  if (previous == null) return true
  return Math.abs(previous - next) >= COVER_RATIO_EPSILON
}

export function resolveSquareCoverScale(ratio: number | null | undefined, enlargedScale: number): number {
  if (!isFinitePositive(ratio)) return 1
  return Math.abs(ratio - SQUARE_RATIO_TARGET) <= SQUARE_RATIO_TOLERANCE ? enlargedScale : 1
}

export function centeredBottomScaleTransform(scale: number): { transformOrigin: string; transform: string } | null {
  if (!Number.isFinite(scale) || scale <= 1) return null
  const centerShiftPercent = (scale - 1) * 50
  return {
    transformOrigin: 'center bottom',
    transform: `translateY(-${centerShiftPercent}%) scale(${scale})`,
  }
}
