import { ref, watch } from 'vue'
import { storage } from '@/services/storage'

export type CardOverlayKey = 'series' | 'progress-bar' | 'progress-pill' | 'format' | 'rating' | 'new'

const coverSize = ref(storage.get('coverSize', 150))
const gridGap = ref(storage.get('gridGap', 16))
const viewMode = ref<'grid' | 'list'>(storage.get('viewMode', 'grid'))
const cardOverlays = ref<CardOverlayKey[]>(storage.get('cardOverlays', ['series', 'progress-bar', 'progress-pill', 'format']))
const lensFilterExpanded = ref(storage.get('lensFilterExpanded', true))

watch(coverSize, (v) => storage.set('coverSize', v))
watch(gridGap, (v) => storage.set('gridGap', v))
watch(viewMode, (v) => storage.set('viewMode', v))
watch(cardOverlays, (v) => storage.set('cardOverlays', v), { deep: true })
watch(lensFilterExpanded, (v) => storage.set('lensFilterExpanded', v))

export function useDisplaySettings() {
  return { coverSize, gridGap, viewMode, cardOverlays, lensFilterExpanded }
}
