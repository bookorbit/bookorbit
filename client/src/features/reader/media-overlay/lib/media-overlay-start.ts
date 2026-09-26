import type { FoliateMediaOverlay } from '@/features/reader/epub/composables/useFoliate'

type MediaOverlayItem = { text: string }
type MediaOverlayFilter = (item: MediaOverlayItem, index: number, items: MediaOverlayItem[]) => boolean

export async function startMediaOverlayWithFallback(
  mediaOverlay: FoliateMediaOverlay,
  sectionIndex: number,
  filter: MediaOverlayFilter | null,
  shouldFallback: () => boolean,
): Promise<void> {
  const found = await mediaOverlay.start(sectionIndex, filter ?? undefined)
  if (filter && !found && shouldFallback()) await mediaOverlay.start(sectionIndex)
}
