import { ref, watch } from 'vue'
import { storage } from '@/services/storage'

export type CardOverlayKey = 'series' | 'progress-bar' | 'progress-pill' | 'format' | 'rating' | 'new' | 'read-status'
export type AuthorCoverShape = 'square' | 'circle'
export type CoverSizeScope = 'per-view' | 'synced'

const DEFAULT_BOOK_COVER_SIZE = 130
const portraitCoverSize = ref(Math.max(storage.get('portraitCoverSize', DEFAULT_BOOK_COVER_SIZE), 100))
const squareCoverSize = ref(Math.max(storage.get('squareCoverSize', DEFAULT_BOOK_COVER_SIZE), 100))
const coverSizeScope = ref<CoverSizeScope>(storage.get('coverSizeScope', 'per-view'))
const gridGap = ref(storage.get('gridGap', 20))
const portraitGridGap = ref(storage.get('portraitGridGap', gridGap.value))
const squareGridGap = ref(storage.get('squareGridGap', gridGap.value))
const viewMode = ref<'grid' | 'list'>(storage.get('viewMode', 'grid'))
const cardOverlays = ref<CardOverlayKey[]>(storage.get('cardOverlays', ['progress-bar', 'format', 'rating', 'read-status']))
const lensFilterExpanded = ref(storage.get('lensFilterExpanded', true))
const authorCoverSize = ref(Math.max(storage.get('authorCoverSize', 120), 100))
const authorCoverShape = ref<AuthorCoverShape>(storage.get('authorCoverShape', 'circle'))

watch(portraitCoverSize, (v) => storage.set('portraitCoverSize', v))
watch(squareCoverSize, (v) => storage.set('squareCoverSize', v))
watch(coverSizeScope, (v) => storage.set('coverSizeScope', v))
watch(gridGap, (v) => storage.set('gridGap', v))
watch(portraitGridGap, (v) => storage.set('portraitGridGap', v))
watch(squareGridGap, (v) => storage.set('squareGridGap', v))
watch(viewMode, (v) => storage.set('viewMode', v))
watch(cardOverlays, (v) => storage.set('cardOverlays', v), { deep: true })
watch(lensFilterExpanded, (v) => storage.set('lensFilterExpanded', v))
watch(authorCoverSize, (v) => storage.set('authorCoverSize', v))
watch(authorCoverShape, (v) => storage.set('authorCoverShape', v))

export function useDisplaySettings() {
  return {
    portraitCoverSize,
    squareCoverSize,
    coverSizeScope,
    gridGap,
    portraitGridGap,
    squareGridGap,
    viewMode,
    cardOverlays,
    lensFilterExpanded,
    authorCoverSize,
    authorCoverShape,
  }
}
