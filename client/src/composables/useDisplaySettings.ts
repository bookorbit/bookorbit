import { ref, watch } from 'vue'
import {
  AUTHOR_COVER_SHAPES,
  BOOK_COVER_DISPLAY_MODES,
  BOOK_SHADOW_STRENGTHS,
  BOOK_SPINE_OVERLAYS,
  BOOK_VIEW_MODES,
  CARD_INFO_MODES,
  CARD_OVERLAY_KEYS,
  COVER_SIZE_SCOPES,
  GRID_CARD_LABEL_FIELDS,
  SERIES_CARD_COVER_MODES,
  TABLE_DENSITIES,
  type AuthorCoverShape,
  type BookCoverDisplayMode,
  type BookShadowStrength,
  type BookSpineOverlay,
  type BookViewMode,
  type CardInfoMode,
  type CardOverlayKey,
  type CoverSizeScope,
  type DisplayPreferences,
  type GridCardLabelField,
  type SeriesCardCoverMode,
  type TableDensity,
} from '@bookorbit/types'
import { storage } from '@/services/storage'

export type {
  AuthorCoverShape,
  BookCoverDisplayMode,
  BookShadowStrength,
  BookSpineOverlay,
  BookViewMode,
  CardInfoMode,
  CardOverlayKey,
  CoverSizeScope,
  DisplayPreferences,
  GridCardLabelField,
  SeriesCardCoverMode,
  TableDensity,
} from '@bookorbit/types'

const DEFAULT_PORTRAIT_COVER_SIZE = 130
const DEFAULT_SQUARE_COVER_SIZE = 150
const DEFAULT_GRID_GAP = 28
const DEFAULT_BOOK_SPINE_OVERLAY: BookSpineOverlay = 'off'
const DEFAULT_BOOK_SHADOW_STRENGTH: BookShadowStrength = 'default'
const DEFAULT_BOOK_COVER_DISPLAY_MODE: BookCoverDisplayMode = 'blurred-fit'
const DEFAULT_SERIES_CARD_COVER_MODE: SeriesCardCoverMode = 'mosaic'
const DEFAULT_CARD_OVERLAYS: CardOverlayKey[] = ['progress-bar', 'format', 'rating', 'read-status', 'series-position']

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

function normalizeBookCoverDisplayMode(value: unknown): BookCoverDisplayMode {
  return typeof value === 'string' && BOOK_COVER_DISPLAY_MODES.includes(value as BookCoverDisplayMode)
    ? (value as BookCoverDisplayMode)
    : DEFAULT_BOOK_COVER_DISPLAY_MODE
}

function normalizeSeriesCardCoverMode(value: unknown): SeriesCardCoverMode {
  return typeof value === 'string' && SERIES_CARD_COVER_MODES.includes(value as SeriesCardCoverMode)
    ? (value as SeriesCardCoverMode)
    : DEFAULT_SERIES_CARD_COVER_MODE
}

function normalizeCardInfoMode(value: unknown): CardInfoMode {
  return typeof value === 'string' && CARD_INFO_MODES.includes(value as CardInfoMode) ? (value as CardInfoMode) : 'hover-overlay'
}

function normalizeGridCardLabelField(value: unknown): GridCardLabelField {
  return typeof value === 'string' && GRID_CARD_LABEL_FIELDS.includes(value as GridCardLabelField) ? (value as GridCardLabelField) : 'hidden'
}

function normalizeCoverSizeScope(value: unknown): CoverSizeScope {
  return typeof value === 'string' && COVER_SIZE_SCOPES.includes(value as CoverSizeScope) ? (value as CoverSizeScope) : 'per-view'
}

function normalizeAuthorCoverShape(value: unknown): AuthorCoverShape {
  return typeof value === 'string' && AUTHOR_COVER_SHAPES.includes(value as AuthorCoverShape) ? (value as AuthorCoverShape) : 'circle'
}

function normalizeTableDensity(value: unknown): TableDensity {
  return typeof value === 'string' && TABLE_DENSITIES.includes(value as TableDensity) ? (value as TableDensity) : 'comfortable'
}

function normalizePositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
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

const portraitCoverSize = ref(
  normalizePositiveInteger(storage.get('portraitCoverSize', DEFAULT_PORTRAIT_COVER_SIZE), DEFAULT_PORTRAIT_COVER_SIZE, 100, 400),
)
const squareCoverSize = ref(normalizePositiveInteger(storage.get('squareCoverSize', DEFAULT_SQUARE_COVER_SIZE), DEFAULT_SQUARE_COVER_SIZE, 100, 400))
const coverSizeScope = ref<CoverSizeScope>(normalizeCoverSizeScope(storage.get('coverSizeScope', 'per-view')))
const gridGap = ref(normalizePositiveInteger(storage.get('gridGap', DEFAULT_GRID_GAP), DEFAULT_GRID_GAP, 1, 80))
const portraitGridGap = ref(normalizePositiveInteger(storage.get('portraitGridGap', gridGap.value), gridGap.value, 1, 80))
const squareGridGap = ref(normalizePositiveInteger(storage.get('squareGridGap', gridGap.value), gridGap.value, 1, 80))

function normalizeViewMode(v: unknown): BookViewMode {
  if (typeof v === 'string' && BOOK_VIEW_MODES.includes(v as BookViewMode)) return v as BookViewMode
  return 'grid'
}

const viewMode = ref<BookViewMode>(normalizeViewMode(storage.get('viewMode', 'grid')))
const cardOverlays = ref<CardOverlayKey[]>(normalizeCardOverlays(storage.get('cardOverlays', DEFAULT_CARD_OVERLAYS)))
const smartScopeFilterExpanded = ref(storage.get<boolean>('smartScopeFilterExpanded', true) === true)
const authorCoverSize = ref(normalizePositiveInteger(storage.get('authorCoverSize', 120), 120, 100, 400))
const authorCoverShape = ref<AuthorCoverShape>(normalizeAuthorCoverShape(storage.get('authorCoverShape', 'circle')))
const tableZebraStriping = ref(storage.get<boolean>('tableZebraStriping', false) === true)
const tableDensity = ref<TableDensity>(normalizeTableDensity(storage.get('tableDensity', 'comfortable')))
const bookSpineOverlay = ref<BookSpineOverlay>(normalizeBookSpineOverlay(storage.get('bookSpineOverlay', DEFAULT_BOOK_SPINE_OVERLAY)))
const bookShadowStrength = ref<BookShadowStrength>(normalizeBookShadowStrength(storage.get('bookShadowStrength', DEFAULT_BOOK_SHADOW_STRENGTH)))
const bookCoverDisplayMode = ref<BookCoverDisplayMode>(
  normalizeBookCoverDisplayMode(storage.get('bookCoverDisplayMode', DEFAULT_BOOK_COVER_DISPLAY_MODE)),
)
const seriesCardCoverMode = ref<SeriesCardCoverMode>(normalizeSeriesCardCoverMode(storage.get('seriesCardCoverMode', DEFAULT_SERIES_CARD_COVER_MODE)))
const gridCardPrimaryLabel = ref<GridCardLabelField>(normalizeGridCardLabelField(storage.get('gridCardPrimaryLabel', 'hidden')))
const gridCardSecondaryLabel = ref<GridCardLabelField>(normalizeGridCardLabelField(storage.get('gridCardSecondaryLabel', 'hidden')))
const cardInfoMode = ref<CardInfoMode>(normalizeCardInfoMode(storage.get('cardInfoMode', 'hover-overlay')))

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
watch(authorCoverShape, (v) => storage.set('authorCoverShape', normalizeAuthorCoverShape(v)))
watch(tableZebraStriping, (v) => storage.set('tableZebraStriping', v))
watch(tableDensity, (v) => storage.set('tableDensity', normalizeTableDensity(v)))
watch(bookSpineOverlay, (value) => storage.set('bookSpineOverlay', normalizeBookSpineOverlay(value)))
watch(bookShadowStrength, (value) => storage.set('bookShadowStrength', normalizeBookShadowStrength(value)))
watch(bookCoverDisplayMode, (value) => storage.set('bookCoverDisplayMode', normalizeBookCoverDisplayMode(value)))
watch(seriesCardCoverMode, (value) => storage.set('seriesCardCoverMode', normalizeSeriesCardCoverMode(value)))
watch(gridCardPrimaryLabel, (value) => storage.set('gridCardPrimaryLabel', normalizeGridCardLabelField(value)))
watch(gridCardSecondaryLabel, (value) => storage.set('gridCardSecondaryLabel', normalizeGridCardLabelField(value)))
watch(cardInfoMode, (value) => storage.set('cardInfoMode', normalizeCardInfoMode(value)))

export function getDisplayPreferencesSnapshot(): DisplayPreferences {
  return {
    portraitCoverSize: normalizePositiveInteger(portraitCoverSize.value, DEFAULT_PORTRAIT_COVER_SIZE, 100, 400),
    squareCoverSize: normalizePositiveInteger(squareCoverSize.value, DEFAULT_SQUARE_COVER_SIZE, 100, 400),
    coverSizeScope: normalizeCoverSizeScope(coverSizeScope.value),
    gridGap: normalizePositiveInteger(gridGap.value, DEFAULT_GRID_GAP, 1, 80),
    portraitGridGap: normalizePositiveInteger(portraitGridGap.value, DEFAULT_GRID_GAP, 1, 80),
    squareGridGap: normalizePositiveInteger(squareGridGap.value, DEFAULT_GRID_GAP, 1, 80),
    viewMode: normalizeViewMode(viewMode.value),
    cardOverlays: normalizeCardOverlays(cardOverlays.value),
    smartScopeFilterExpanded: smartScopeFilterExpanded.value === true,
    authorCoverSize: normalizePositiveInteger(authorCoverSize.value, 120, 100, 400),
    authorCoverShape: normalizeAuthorCoverShape(authorCoverShape.value),
    tableZebraStriping: tableZebraStriping.value === true,
    tableDensity: normalizeTableDensity(tableDensity.value),
    bookSpineOverlay: normalizeBookSpineOverlay(bookSpineOverlay.value),
    bookShadowStrength: normalizeBookShadowStrength(bookShadowStrength.value),
    bookCoverDisplayMode: normalizeBookCoverDisplayMode(bookCoverDisplayMode.value),
    seriesCardCoverMode: normalizeSeriesCardCoverMode(seriesCardCoverMode.value),
    gridCardPrimaryLabel: normalizeGridCardLabelField(gridCardPrimaryLabel.value),
    gridCardSecondaryLabel: normalizeGridCardLabelField(gridCardSecondaryLabel.value),
    cardInfoMode: normalizeCardInfoMode(cardInfoMode.value),
  }
}

export function sanitizeDisplayPreferences(raw: unknown): Partial<DisplayPreferences> {
  if (typeof raw !== 'object' || raw === null) return {}
  const obj = raw as Record<string, unknown>
  const out: Partial<DisplayPreferences> = {}

  if (typeof obj.portraitCoverSize === 'number')
    out.portraitCoverSize = normalizePositiveInteger(obj.portraitCoverSize, DEFAULT_PORTRAIT_COVER_SIZE, 100, 400)
  if (typeof obj.squareCoverSize === 'number')
    out.squareCoverSize = normalizePositiveInteger(obj.squareCoverSize, DEFAULT_SQUARE_COVER_SIZE, 100, 400)
  if (COVER_SIZE_SCOPES.includes(obj.coverSizeScope as CoverSizeScope)) out.coverSizeScope = obj.coverSizeScope as CoverSizeScope
  if (typeof obj.gridGap === 'number') out.gridGap = normalizePositiveInteger(obj.gridGap, DEFAULT_GRID_GAP, 1, 80)
  if (typeof obj.portraitGridGap === 'number') out.portraitGridGap = normalizePositiveInteger(obj.portraitGridGap, DEFAULT_GRID_GAP, 1, 80)
  if (typeof obj.squareGridGap === 'number') out.squareGridGap = normalizePositiveInteger(obj.squareGridGap, DEFAULT_GRID_GAP, 1, 80)
  if (BOOK_VIEW_MODES.includes(obj.viewMode as BookViewMode)) out.viewMode = obj.viewMode as BookViewMode
  if (Array.isArray(obj.cardOverlays)) out.cardOverlays = normalizeCardOverlays(obj.cardOverlays)
  if (typeof obj.smartScopeFilterExpanded === 'boolean') out.smartScopeFilterExpanded = obj.smartScopeFilterExpanded
  if (typeof obj.authorCoverSize === 'number') out.authorCoverSize = normalizePositiveInteger(obj.authorCoverSize, 120, 100, 400)
  if (AUTHOR_COVER_SHAPES.includes(obj.authorCoverShape as AuthorCoverShape)) out.authorCoverShape = obj.authorCoverShape as AuthorCoverShape
  if (typeof obj.tableZebraStriping === 'boolean') out.tableZebraStriping = obj.tableZebraStriping
  if (TABLE_DENSITIES.includes(obj.tableDensity as TableDensity)) out.tableDensity = obj.tableDensity as TableDensity
  if (BOOK_SPINE_OVERLAYS.includes(obj.bookSpineOverlay as BookSpineOverlay)) out.bookSpineOverlay = obj.bookSpineOverlay as BookSpineOverlay
  if (BOOK_SHADOW_STRENGTHS.includes(obj.bookShadowStrength as BookShadowStrength))
    out.bookShadowStrength = obj.bookShadowStrength as BookShadowStrength
  if (BOOK_COVER_DISPLAY_MODES.includes(obj.bookCoverDisplayMode as BookCoverDisplayMode)) {
    out.bookCoverDisplayMode = obj.bookCoverDisplayMode as BookCoverDisplayMode
  }
  if (SERIES_CARD_COVER_MODES.includes(obj.seriesCardCoverMode as SeriesCardCoverMode)) {
    out.seriesCardCoverMode = obj.seriesCardCoverMode as SeriesCardCoverMode
  }
  if (GRID_CARD_LABEL_FIELDS.includes(obj.gridCardPrimaryLabel as GridCardLabelField)) {
    out.gridCardPrimaryLabel = obj.gridCardPrimaryLabel as GridCardLabelField
  }
  if (GRID_CARD_LABEL_FIELDS.includes(obj.gridCardSecondaryLabel as GridCardLabelField)) {
    out.gridCardSecondaryLabel = obj.gridCardSecondaryLabel as GridCardLabelField
  }
  if (CARD_INFO_MODES.includes(obj.cardInfoMode as CardInfoMode)) {
    out.cardInfoMode = obj.cardInfoMode as CardInfoMode
  }

  return out
}

export function applyDisplayPreferences(raw: unknown): void {
  const prefs = sanitizeDisplayPreferences(raw)
  if (prefs.portraitCoverSize !== undefined) portraitCoverSize.value = prefs.portraitCoverSize
  if (prefs.squareCoverSize !== undefined) squareCoverSize.value = prefs.squareCoverSize
  if (prefs.coverSizeScope !== undefined) coverSizeScope.value = prefs.coverSizeScope
  if (prefs.gridGap !== undefined) gridGap.value = prefs.gridGap
  if (prefs.portraitGridGap !== undefined) portraitGridGap.value = prefs.portraitGridGap
  if (prefs.squareGridGap !== undefined) squareGridGap.value = prefs.squareGridGap
  if (prefs.viewMode !== undefined) viewMode.value = prefs.viewMode
  if (prefs.cardOverlays !== undefined) cardOverlays.value = prefs.cardOverlays
  if (prefs.smartScopeFilterExpanded !== undefined) smartScopeFilterExpanded.value = prefs.smartScopeFilterExpanded
  if (prefs.authorCoverSize !== undefined) authorCoverSize.value = prefs.authorCoverSize
  if (prefs.authorCoverShape !== undefined) authorCoverShape.value = prefs.authorCoverShape
  if (prefs.tableZebraStriping !== undefined) tableZebraStriping.value = prefs.tableZebraStriping
  if (prefs.tableDensity !== undefined) tableDensity.value = prefs.tableDensity
  if (prefs.bookSpineOverlay !== undefined) bookSpineOverlay.value = prefs.bookSpineOverlay
  if (prefs.bookShadowStrength !== undefined) bookShadowStrength.value = prefs.bookShadowStrength
  if (prefs.bookCoverDisplayMode !== undefined) bookCoverDisplayMode.value = prefs.bookCoverDisplayMode
  if (prefs.seriesCardCoverMode !== undefined) seriesCardCoverMode.value = prefs.seriesCardCoverMode
  if (prefs.gridCardPrimaryLabel !== undefined) gridCardPrimaryLabel.value = prefs.gridCardPrimaryLabel
  if (prefs.gridCardSecondaryLabel !== undefined) gridCardSecondaryLabel.value = prefs.gridCardSecondaryLabel
  if (prefs.cardInfoMode !== undefined) cardInfoMode.value = prefs.cardInfoMode
}

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
    bookCoverDisplayMode,
    seriesCardCoverMode,
    gridCardPrimaryLabel,
    gridCardSecondaryLabel,
    cardInfoMode,
  }
}
