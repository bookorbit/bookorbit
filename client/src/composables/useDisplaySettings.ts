import { ref, watch } from 'vue'
import { storage } from '@/services/storage'

export type CardOverlayKey = 'series' | 'progress-bar' | 'progress-pill' | 'format' | 'rating' | 'new' | 'read-status'
export type AuthorCoverShape = 'square' | 'circle'

const coverSize = ref(storage.get('coverSize', 130))
const gridGap = ref(storage.get('gridGap', 20))
const viewMode = ref<'grid' | 'list'>(storage.get('viewMode', 'grid'))
const cardOverlays = ref<CardOverlayKey[]>(storage.get('cardOverlays', ['progress-bar', 'format', 'rating', 'read-status']))
const lensFilterExpanded = ref(storage.get('lensFilterExpanded', true))
const authorCoverSize = ref(storage.get('authorCoverSize', 120))
const authorCoverShape = ref<AuthorCoverShape>(storage.get('authorCoverShape', 'circle'))

watch(coverSize, (v) => storage.set('coverSize', v))
watch(gridGap, (v) => storage.set('gridGap', v))
watch(viewMode, (v) => storage.set('viewMode', v))
watch(cardOverlays, (v) => storage.set('cardOverlays', v), { deep: true })
watch(lensFilterExpanded, (v) => storage.set('lensFilterExpanded', v))
watch(authorCoverSize, (v) => storage.set('authorCoverSize', v))
watch(authorCoverShape, (v) => storage.set('authorCoverShape', v))

export function useDisplaySettings() {
  return { coverSize, gridGap, viewMode, cardOverlays, lensFilterExpanded, authorCoverSize, authorCoverShape }
}
