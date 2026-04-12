import { computed, ref, watch, type Ref } from 'vue'
import type { CoverAspectRatio } from '@projectx/types'
import { storage } from '@/services/storage'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { DEFAULT_COVER_ASPECT_RATIO } from '@/features/book/lib/cover-aspect-ratio'

type ViewType = 'library' | 'lens' | 'collection'
type CoverShapeGroup = 'portrait' | 'square'

function coverSizeKey(type: ViewType, id: number, group: CoverShapeGroup) {
  return `projectx:coverSize:${type}:${id}:${group}`
}

function gridGapKey(type: ViewType, id: number, group: CoverShapeGroup) {
  return `projectx:gridGap:${type}:${id}:${group}`
}

function legacyCoverSizeKey(type: ViewType, id: number) {
  return `projectx:coverSize:${type}:${id}`
}

function legacyGridGapKey(type: ViewType, id: number) {
  return `projectx:gridGap:${type}:${id}`
}

export function useViewDisplaySettings(
  viewType: ViewType,
  viewId: Readonly<Ref<number | null>>,
  coverAspectRatio: Readonly<Ref<CoverAspectRatio>> = ref(DEFAULT_COVER_ASPECT_RATIO),
) {
  const { portraitCoverSize, squareCoverSize, coverSizeScope, portraitGridGap, squareGridGap } = useDisplaySettings()
  const fallbackGridGap = storage.get('gridGap', 20)

  const coverShapeGroup = computed<CoverShapeGroup>(() => (coverAspectRatio.value === '1/1' ? 'square' : 'portrait'))
  const globalCoverSizeForGroup = computed(() => (coverShapeGroup.value === 'square' ? squareCoverSize.value : portraitCoverSize.value))
  const globalGridGapForGroup = computed(() => (coverShapeGroup.value === 'square' ? squareGridGap.value : portraitGridGap.value))

  const coverSize = ref(globalCoverSizeForGroup.value)
  const gridGap = ref(globalGridGapForGroup.value)

  function loadForView() {
    const id = viewId.value
    if (id === null || !Number.isFinite(id)) {
      coverSize.value = globalCoverSizeForGroup.value
      gridGap.value = globalGridGapForGroup.value
      return
    }

    if (coverSizeScope.value === 'synced') {
      coverSize.value = globalCoverSizeForGroup.value
    } else {
      const fallback = storage.get(legacyCoverSizeKey(viewType, id), globalCoverSizeForGroup.value)
      coverSize.value = storage.get(coverSizeKey(viewType, id, coverShapeGroup.value), fallback)
    }

    if (coverSizeScope.value === 'synced') {
      gridGap.value = globalGridGapForGroup.value
    } else {
      const fallback = storage.get(legacyGridGapKey(viewType, id), fallbackGridGap)
      gridGap.value = storage.get(gridGapKey(viewType, id, coverShapeGroup.value), fallback)
    }
  }

  watch([viewId, coverShapeGroup, coverSizeScope, portraitCoverSize, squareCoverSize, portraitGridGap, squareGridGap], loadForView, {
    immediate: true,
  })

  watch(coverSize, (v) => {
    const id = viewId.value
    if (!Number.isFinite(v) || v <= 0) return
    if (coverSizeScope.value === 'synced') {
      if (coverShapeGroup.value === 'square') squareCoverSize.value = v
      else portraitCoverSize.value = v
      return
    }
    if (id !== null && Number.isFinite(id)) storage.set(coverSizeKey(viewType, id, coverShapeGroup.value), v)
  })

  watch(gridGap, (v) => {
    if (!Number.isFinite(v) || v <= 0) return
    if (coverSizeScope.value === 'synced') {
      if (coverShapeGroup.value === 'square') squareGridGap.value = v
      else portraitGridGap.value = v
      return
    }
    const id = viewId.value
    if (id !== null && Number.isFinite(id)) storage.set(gridGapKey(viewType, id, coverShapeGroup.value), v)
  })

  return { coverSize, gridGap }
}
