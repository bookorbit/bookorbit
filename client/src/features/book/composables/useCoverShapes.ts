import { shallowReactive, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { coverShapeFromSize, type MetadataCandidate, type MetadataCoverShape } from '@bookorbit/types'
import { toDisplayCoverUrl } from '../lib/metadata-fetch'
import { statedCoverShape } from '../lib/cover-slots'

export interface MeasuredCoverSize {
  width: number
  height: number
}

/**
 * Each candidate cover's shape and pixel size. The shape is the provider's, or when it states none,
 * the size of the image once the browser has loaded it: Hardcover leaves the size off some editions,
 * and an audiobook edition's image is as often the print jacket as square art. The size is the
 * image's once measured, otherwise the provider's, so a 575 x 92 strip can be told from a cover.
 */
export function useCoverShapes(candidates: MaybeRefOrGetter<readonly MetadataCandidate[]>) {
  const measured = shallowReactive(new Map<string, MeasuredCoverSize | null>())
  const pending = new Set<string>()

  function measure(url: string) {
    pending.add(url)
    const image = new Image()
    image.onload = () => {
      pending.delete(url)
      measured.set(url, { width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      pending.delete(url)
      measured.set(url, null)
    }
    image.src = url
  }

  watch(
    () => toValue(candidates).map((candidate) => toDisplayCoverUrl(candidate.coverUrl)),
    (urls) => {
      for (const url of urls) {
        if (url && !measured.has(url) && !pending.has(url)) measure(url)
      }
    },
    { immediate: true },
  )

  function shapeOf(candidate: MetadataCandidate): MetadataCoverShape {
    const stated = statedCoverShape(candidate)
    if (stated !== 'unknown') return stated
    const size = measured.get(toDisplayCoverUrl(candidate.coverUrl))
    return size ? coverShapeFromSize(size.width, size.height) : 'unknown'
  }

  /** The measured size wins: a stated size can describe a thumbnail smaller than the image served. */
  function sizeOf(candidate: MetadataCandidate): MeasuredCoverSize | null {
    const size = measured.get(toDisplayCoverUrl(candidate.coverUrl))
    if (size) return size
    return candidate.coverWidth && candidate.coverHeight ? { width: candidate.coverWidth, height: candidate.coverHeight } : null
  }

  return { shapeOf, sizeOf }
}
