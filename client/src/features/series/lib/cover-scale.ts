export const SQUARE_RATIO_TARGET = 1
export const SQUARE_RATIO_TOLERANCE = 0.08
export const PORTRAIT_STACK_ASPECT_RATIO = '2 / 3'
export const SQUARE_STACK_ASPECT_RATIO = '1 / 1'
export const PORTRAIT_STACK_FRAME_ASPECT_RATIO = '2/3'
export const SQUARE_STACK_FRAME_ASPECT_RATIO = '1/1'
const COVER_RATIO_EPSILON = 0.0001

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function shouldPersistCoverRatio(previous: number | undefined, next: number | null): next is number {
  if (!isFinitePositive(next)) return false
  if (previous == null) return true
  return Math.abs(previous - next) >= COVER_RATIO_EPSILON
}

export function isSquareCoverRatio(ratio: number | null | undefined): boolean {
  return isFinitePositive(ratio) && Math.abs(ratio - SQUARE_RATIO_TARGET) <= SQUARE_RATIO_TOLERANCE
}

export function resolveSquareCoverScale(ratio: number | null | undefined, enlargedScale: number): number {
  return isSquareCoverRatio(ratio) ? enlargedScale : 1
}

export function resolveCoverStackAspectRatio(
  ratio: number | null | undefined,
): typeof SQUARE_STACK_ASPECT_RATIO | typeof PORTRAIT_STACK_ASPECT_RATIO {
  return isSquareCoverRatio(ratio) ? SQUARE_STACK_ASPECT_RATIO : PORTRAIT_STACK_ASPECT_RATIO
}

export function resolveCoverStackFrameAspectRatio(
  ratio: number | null | undefined,
): typeof SQUARE_STACK_FRAME_ASPECT_RATIO | typeof PORTRAIT_STACK_FRAME_ASPECT_RATIO {
  return isSquareCoverRatio(ratio) ? SQUARE_STACK_FRAME_ASPECT_RATIO : PORTRAIT_STACK_FRAME_ASPECT_RATIO
}

export function resolveCoverStackDisplayMode(ratio: number | null | undefined): 'natural-bottom' | undefined {
  return isSquareCoverRatio(ratio) ? 'natural-bottom' : undefined
}

export function centeredBottomScaleTransform(scale: number): { transformOrigin: string; transform: string } | null {
  if (!Number.isFinite(scale) || scale <= 1) return null
  const centerShiftPercent = (scale - 1) * 50
  return {
    transformOrigin: 'center bottom',
    transform: `translateY(-${centerShiftPercent}%) scale(${scale})`,
  }
}
