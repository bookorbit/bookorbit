import type { InjectionKey, Ref } from 'vue'
import type { CoverAspectRatio } from '@bookorbit/types'

export const COVER_ASPECT_RATIO_KEY: InjectionKey<Readonly<Ref<CoverAspectRatio>>> = Symbol('coverAspectRatio')
export const DEFAULT_COVER_ASPECT_RATIO: CoverAspectRatio = '2/3'

export function coverAspectRatioValue(value: string): number {
  const parts = value.split('/')
  if (parts.length !== 2) return 2 / 3
  const width = Number(parts[0])
  const height = Number(parts[1])
  if (Number.isFinite(width) && Number.isFinite(height) && height > 0) {
    return width / height
  }
  return 2 / 3
}

export function fittedCoverFrameStyle(imageRatio: number | null, slotRatio: number): Record<string, string> {
  if (!imageRatio || imageRatio <= 0 || !slotRatio || slotRatio <= 0) {
    return { inset: '0' }
  }

  if (Math.abs(imageRatio - slotRatio) < 0.0001) {
    return { inset: '0' }
  }

  if (imageRatio > slotRatio) {
    const heightPercent = (slotRatio / imageRatio) * 100
    return {
      width: '100%',
      height: `${heightPercent}%`,
      top: '50%',
      left: '0',
      transform: 'translateY(-50%)',
    }
  }

  const widthPercent = (imageRatio / slotRatio) * 100
  return {
    width: `${widthPercent}%`,
    height: '100%',
    top: '0',
    left: '50%',
    transform: 'translateX(-50%)',
  }
}
