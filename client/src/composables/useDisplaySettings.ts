import { ref, watch } from 'vue'
import { storage } from '@/services/storage'

export type CardOverlayKey = 'progress-bar' | 'format' | 'rating' | 'read-status' | 'lock-status' | 'series-position'
export type AuthorCoverShape = 'square' | 'circle'
export type CoverSizeScope = 'per-view' | 'synced'
export type TableDensity = 'compact' | 'comfortable' | 'roomy'
export type BookSpineOverlay = 'off' | 'subtle' | 'strong'
export type BookShadowStrength = 'default' | 'strong'

const DEFAULT_PORTRAIT_COVER_SIZE = 130
const DEFAULT_SQUARE_COVER_SIZE = 150
const DEFAULT_GRID_GAP = 28
const DEFAULT_BOOK_SPINE_OVERLAY: BookSpineOverlay = 'off'
const DEFAULT_BOOK_SHADOW_STRENGTH: BookShadowStrength = 'default'
const CARD_OVERLAY_KEYS: CardOverlayKey[] = ['progress-bar', 'format', 'rating', 'read-status', 'lock-status', 'series-position']
const DEFAULT_CARD_OVERLAYS: CardOverlayKey[] = ['progress-bar', 'format', 'rating', 'read-status', 'series-position']
const BOOK_SPINE_OVERLAYS: BookSpineOverlay[] = ['off', 'subtle', 'strong']
const BOOK_SHADOW_STRENGTHS: BookShadowStrength[] = ['default', 'strong']

function normalizeBookSpineOverlay(value: unknown): BookSpineOverlay {
  return typeof value === 'string' && BOOK_SPINE_OVERLAYS.includes(value as BookSpineOverlay)
    ? (value as BookSpineOverlay)
    : DEFAULT_BOOK_SPINE_OVERLAY
}

function normalizeBookShadowStrength(value: unknown): BookShadowStrength {
  return typeof value === 'string' && BOOK_SHADOW_STRENGTHS.includes(value as BookShadowStrength)
    ? (value as BookShadowStrength)
    : DEFAULT_BOOK_SHADOW_STRENGTH
}

function normalizeCardOverlays(value: unknown): CardOverlayKey[] {
  if (!Array.isArray(value)) return [...DEFAULT_CARD_OVERLAYS]

  const normalized: CardOverlayKey[] = []
  for (const item of value) {
    if (!CARD_OVERLAY_KEYS.includes(item as CardOverlayKey)) continue
    const typed = item as CardOverlayKey
    if (normalized.includes(typed)) continue
    normalized.push(typed)
  }

  return normalized
}

const portraitCoverSize = ref(Math.max(storage.get('portraitCoverSize', DEFAULT_PORTRAIT_COVER_SIZE), 100))
const squareCoverSize = ref(Math.max(storage.get('squareCoverSize', DEFAULT_SQUARE_COVER_SIZE), 100))
const coverSizeScope = ref<CoverSizeScope>(storage.get('coverSizeScope', 'per-view'))
const gridGap = ref(storage.get('gridGap', DEFAULT_GRID_GAP))
const portraitGridGap = ref(storage.get('portraitGridGap', gridGap.value))
const squareGridGap = ref(storage.get('squareGridGap', gridGap.value))
export type BookViewMode = 'grid' | 'list' | 'table'

const VALID_VIEW_MODES: BookViewMode[] = ['grid', 'list', 'table']

function normalizeViewMode(v: unknown): BookViewMode {
  if (typeof v === 'string' && VALID_VIEW_MODES.includes(v as BookViewMode)) return v as BookViewMode
  return 'grid'
}

const viewMode = ref<BookViewMode>(normalizeViewMode(storage.get('viewMode', 'grid')))
const cardOverlays = ref<CardOverlayKey[]>(normalizeCardOverlays(storage.get('cardOverlays', DEFAULT_CARD_OVERLAYS)))
const smartScopeFilterExpanded = ref(storage.get('smartScopeFilterExpanded', true))
const authorCoverSize = ref(Math.max(storage.get('authorCoverSize', 120), 100))
const authorCoverShape = ref<AuthorCoverShape>(storage.get('authorCoverShape', 'circle'))
const tableZebraStriping = ref(storage.get('tableZebraStriping', false))
const tableDensity = ref<TableDensity>(storage.get('tableDensity', 'comfortable'))
const bookSpineOverlay = ref<BookSpineOverlay>(normalizeBookSpineOverlay(storage.get('bookSpineOverlay', DEFAULT_BOOK_SPINE_OVERLAY)))
const bookShadowStrength = ref<BookShadowStrength>(normalizeBookShadowStrength(storage.get('bookShadowStrength', DEFAULT_BOOK_SHADOW_STRENGTH)))

watch(portraitCoverSize, (v) => storage.set('portraitCoverSize', v))
watch(squareCoverSize, (v) => storage.set('squareCoverSize', v))
watch(coverSizeScope, (v) => storage.set('coverSizeScope', v))
watch(gridGap, (v) => storage.set('gridGap', v))
watch(portraitGridGap, (v) => storage.set('portraitGridGap', v))
watch(squareGridGap, (v) => storage.set('squareGridGap', v))
watch(viewMode, (v) => storage.set('viewMode', v))
watch(cardOverlays, (v) => storage.set('cardOverlays', normalizeCardOverlays(v)), { deep: true })
watch(smartScopeFilterExpanded, (v) => storage.set('smartScopeFilterExpanded', v))
watch(authorCoverSize, (v) => storage.set('authorCoverSize', v))
watch(authorCoverShape, (v) => storage.set('authorCoverShape', v))
watch(tableZebraStriping, (v) => storage.set('tableZebraStriping', v))
watch(tableDensity, (v) => storage.set('tableDensity', v))
watch(bookSpineOverlay, (value) => storage.set('bookSpineOverlay', normalizeBookSpineOverlay(value)))
watch(bookShadowStrength, (value) => storage.set('bookShadowStrength', normalizeBookShadowStrength(value)))

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
    smartScopeFilterExpanded,
    authorCoverSize,
    authorCoverShape,
    tableZebraStriping,
    tableDensity,
    bookSpineOverlay,
    bookShadowStrength,
  }
}
