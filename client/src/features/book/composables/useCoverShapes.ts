import { shallowReactive, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { coverShapeFromSize, type MetadataCandidate, type MetadataCoverShape } from '@bookorbit/types'
import { toDisplayCoverUrl } from '../lib/metadata-fetch'
import { statedCoverShape } from '../lib/cover-slots'

/**
 * Each candidate cover's shape: the provider's, or when it states none, the size of the image once
 * the browser has loaded it. Hardcover leaves the size off some editions, and an audiobook edition's
 * image is as often the print jacket as square art, so a stated-unknown cover can still be portrait.
 */
export function useCoverShapes(candidates: MaybeRefOrGetter<readonly MetadataCandidate[]>) {
  const measured = shallowReactive(new Map<string, MetadataCoverShape>())
  const pending = new Set<string>()

  function measure(url: string) {
    pending.add(url)
    const image = new Image()
    image.onload = () => {
      pending.delete(url)
      measured.set(url, coverShapeFromSize(image.naturalWidth, image.naturalHeight))
    }
    image.onerror = () => {
      pending.delete(url)
      measured.set(url, 'unknown')
    }
    image.src = url
  }

  watch(
    () =>
      toValue(candidates)
        .filter((candidate) => statedCoverShape(candidate) === 'unknown')
        .map((candidate) => toDisplayCoverUrl(candidate.coverUrl)),
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
    return measured.get(toDisplayCoverUrl(candidate.coverUrl)) ?? 'unknown'
  }

  return { shapeOf }
}
