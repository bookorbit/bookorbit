import { ref, watch, type Ref } from 'vue'
import { storage } from '@/services/storage'

type ViewType = 'library' | 'lens' | 'collection'

function coverSizeKey(type: ViewType, id: number) {
  return `projectx:coverSize:${type}:${id}`
}

function gridGapKey(type: ViewType, id: number) {
  return `projectx:gridGap:${type}:${id}`
}

export function useViewDisplaySettings(viewType: ViewType, viewId: Readonly<Ref<number | null>>) {
  const globalCoverSize = storage.get('coverSize', 140)
  const globalGridGap = storage.get('gridGap', 20)

  const coverSize = ref(globalCoverSize)
  const gridGap = ref(globalGridGap)

  function loadForView(id: number | null) {
    if (id === null || !Number.isFinite(id)) {
      coverSize.value = globalCoverSize
      gridGap.value = globalGridGap
      return
    }
    coverSize.value = storage.get(coverSizeKey(viewType, id), globalCoverSize)
    gridGap.value = storage.get(gridGapKey(viewType, id), globalGridGap)
  }

  watch(viewId, loadForView, { immediate: true })

  watch(coverSize, (v) => {
    const id = viewId.value
    if (id !== null && Number.isFinite(id)) storage.set(coverSizeKey(viewType, id), v)
  })

  watch(gridGap, (v) => {
    const id = viewId.value
    if (id !== null && Number.isFinite(id)) storage.set(gridGapKey(viewType, id), v)
  })

  return { coverSize, gridGap }
}
