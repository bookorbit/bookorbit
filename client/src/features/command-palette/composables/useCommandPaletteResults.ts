import { computed, ref, watch, type Component, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RouteLocationRaw } from 'vue-router'
import { Moon, Settings, SlidersHorizontal, Sparkles, Sun, Upload } from '@lucide/vue'
import type { AuthorSummary, BookCard, DashboardScrollerBatchResponse, SeriesSummary } from '@bookorbit/types'
import { api } from '@/lib/api'
import { formatNumber } from '@/i18n/formatters'
import { useSidebarCustomizeMode } from '@/composables/useSidebarCustomizeMode'
import { useSidebarNav } from '@/composables/useSidebarNav'
import { SIDEBAR_SECTIONS, type SidebarListKind } from '@/composables/useSidebarSections'
import { fetchAuthors } from '@/features/author/api/author'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookRequestVisibility } from '@/features/book-requests/composables/useBookRequestVisibility'
import { useGlobalSearch } from '@/features/book/composables/useGlobalSearch'
import { useCollections } from '@/features/collection/composables/useCollections'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { fetchSeries } from '@/features/series/api/series'
import { searchSettingsNav, visibleSettingsNav } from '@/features/settings/lib/settings-nav'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import { useThemeStore } from '@/stores/theme'
import { rankBooks } from '../lib/rank'

export const PALETTE_MIN_QUERY = 2

export type PaletteTab = 'all' | 'books' | 'authors' | 'series' | 'settings'

export type PaletteItem =
  | { kind: 'book'; key: string; book: BookCard }
  | { kind: 'reading'; key: string; book: BookCard }
  | { kind: 'author'; key: string; author: AuthorSummary }
  | { kind: 'series'; key: string; series: SeriesSummary }
  | { kind: 'place'; key: string; label: string; icon: Component | string; fallbackIcon?: Component; meta: string; to: RouteLocationRaw }
  | { kind: 'setting'; key: string; label: string; groupLabel: string; description: string; icon: Component; to: RouteLocationRaw }
  | { kind: 'action'; key: string; label: string; icon: Component; meta?: string; run: () => void }
  | { kind: 'more'; key: string; label: string; tab: PaletteTab }

export interface PaletteSection {
  id: string
  label: string
  count?: number
  items: PaletteItem[]
}

export interface PaletteTabOption {
  id: PaletteTab
  label: string
  count: number
}

const ALL_TAB_LIMITS = { books: 5, authors: 3, series: 3, places: 5, settings: 4, actions: 3 } as const
const TAB_PAGE_SIZE = 20
const ENTITY_DEBOUNCE_MS = 250
const CONTINUE_READING_LIMIT = 4
const CONTINUE_READING_TTL_MS = 60_000

const ENTITY_KIND_LABEL_KEYS: Record<SidebarListKind, string> = {
  library: 'commandPalette.kinds.library',
  smartScope: 'commandPalette.kinds.smartScope',
  collection: 'commandPalette.kinds.collection',
}

interface PaletteActionHandlers {
  openUpload: () => void
  navigate: (to: RouteLocationRaw) => void
}

function matches(text: string, needle: string): boolean {
  return text.toLocaleLowerCase().includes(needle)
}

/**
 * Everything the palette lists, grouped the way it renders. Every request is bounded: books page
 * through the existing global search, authors and series ask for one small page, and the rest
 * filters lists the sidebar already holds.
 */
export function useCommandPaletteResults(query: Ref<string>, tab: Ref<PaletteTab>, isOpen: Ref<boolean>, handlers: PaletteActionHandlers) {
  const { t } = useI18n()
  const { hasPermission, isSuperuser, userPermissions, isDemoRestrictedAccount } = usePermissions()
  const { showBookRequests } = useBookRequestVisibility()
  const { zones } = useSidebarNav()
  const { libraries } = useLibraries()
  const { smartScopes } = useSmartScopes()
  const { collections } = useCollections()
  const themeStore = useThemeStore()
  const { startCustomizing } = useSidebarCustomizeMode()

  const trimmed = computed(() => query.value.trim())
  const needle = computed(() => trimmed.value.toLocaleLowerCase())
  const isSearching = computed(() => trimmed.value.length >= PALETTE_MIN_QUERY)

  const books = useGlobalSearch(query)

  const authors = ref<AuthorSummary[]>([])
  const authorTotal = ref(0)
  const series = ref<SeriesSummary[]>([])
  const seriesTotal = ref(0)
  const entitiesLoading = ref(false)
  let entityTimer: ReturnType<typeof setTimeout> | null = null
  let entityGeneration = 0

  async function loadEntities(q: string, generation: number) {
    const [authorResult, seriesResult] = await Promise.allSettled([
      fetchAuthors({ q, page: 0, size: TAB_PAGE_SIZE, sort: 'name', order: 'asc' }),
      fetchSeries({ q, page: 0, size: TAB_PAGE_SIZE, sort: 'name', order: 'asc' }),
    ])
    if (generation !== entityGeneration) return
    authors.value = authorResult.status === 'fulfilled' ? authorResult.value.items : []
    authorTotal.value = authorResult.status === 'fulfilled' ? authorResult.value.total : 0
    series.value = seriesResult.status === 'fulfilled' ? seriesResult.value.items : []
    seriesTotal.value = seriesResult.status === 'fulfilled' ? seriesResult.value.total : 0
    entitiesLoading.value = false
  }

  watch(trimmed, (q) => {
    if (entityTimer) clearTimeout(entityTimer)
    entityGeneration += 1
    authors.value = []
    series.value = []
    authorTotal.value = 0
    seriesTotal.value = 0
    if (q.length < PALETTE_MIN_QUERY) {
      entitiesLoading.value = false
      return
    }
    entitiesLoading.value = true
    const generation = entityGeneration
    entityTimer = setTimeout(() => void loadEntities(q, generation), ENTITY_DEBOUNCE_MS)
  })

  const continueReading = ref<BookCard[]>([])
  let continueReadingFetchedAt = 0

  async function refreshContinueReading() {
    if (Date.now() - continueReadingFetchedAt < CONTINUE_READING_TTL_MS) return
    continueReadingFetchedAt = Date.now()
    try {
      const res = await api('/api/v1/dashboard/scrollers/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: 'command-palette', type: 'continue-reading', limit: CONTINUE_READING_LIMIT }] }),
      })
      if (!res.ok) return
      const payload: DashboardScrollerBatchResponse = await res.json()
      continueReading.value = payload.items[0]?.books ?? []
    } catch {
      continueReadingFetchedAt = 0
    }
  }

  watch(isOpen, (open) => {
    if (open) void refreshContinueReading()
  })

  const places = computed<Extract<PaletteItem, { kind: 'place' }>[]>(() => {
    const pageMeta = t('commandPalette.kinds.page')
    const pages = zones.value.flatMap((zone) =>
      zone.entries.map((entry) => ({
        kind: 'place' as const,
        key: `page:${entry.id}`,
        label: entry.label,
        icon: entry.icon,
        meta: pageMeta,
        to: entry.to,
      })),
    )
    const lists: Record<SidebarListKind, { id: number; name: string; icon?: string | null; bookCount?: number | null }[]> = {
      library: libraries.value,
      smartScope: smartScopes.value,
      collection: collections.value,
    }
    const entities = SIDEBAR_SECTIONS.flatMap((definition) =>
      lists[definition.kind].map((entity) => ({
        kind: 'place' as const,
        key: `${definition.kind}:${entity.id}`,
        label: entity.name,
        icon: entity.icon || definition.icon,
        fallbackIcon: definition.icon,
        meta:
          entity.bookCount != null
            ? `${t(ENTITY_KIND_LABEL_KEYS[definition.kind])} · ${formatNumber(entity.bookCount)}`
            : t(ENTITY_KIND_LABEL_KEYS[definition.kind]),
        to: { name: definition.routeName, params: { id: entity.id } },
      })),
    )
    return [...entities, ...pages]
  })

  const actions = computed<Extract<PaletteItem, { kind: 'action' }>[]>(() => {
    const list: Extract<PaletteItem, { kind: 'action' }>[] = []
    if (hasPermission('library_upload') && !isDemoRestrictedAccount.value) {
      list.push({ kind: 'action', key: 'action:upload', label: t('components.appHeader.uploadBooks'), icon: Upload, run: handlers.openUpload })
    }
    const toLight = themeStore.resolvedTheme === 'dark'
    list.push({
      kind: 'action',
      key: 'action:theme',
      label: toLight ? t('commandPalette.actions.lightTheme') : t('commandPalette.actions.darkTheme'),
      icon: toLight ? Sun : Moon,
      run: themeStore.toggleTheme,
    })
    list.push({
      kind: 'action',
      key: 'action:whats-new',
      label: t('components.appHeader.whatsNew'),
      icon: Sparkles,
      run: () => handlers.navigate({ name: 'whats-new' }),
    })
    list.push({
      kind: 'action',
      key: 'action:customize-sidebar',
      label: t('components.sidebar.customize.open'),
      icon: SlidersHorizontal,
      run: startCustomizing,
    })
    list.push({
      kind: 'action',
      key: 'action:settings',
      label: t('components.appHeader.settings'),
      icon: Settings,
      run: () => handlers.navigate({ name: 'settings-libraries' }),
    })
    return list
  })

  const settingsHits = computed<Extract<PaletteItem, { kind: 'setting' }>[]>(() => {
    if (!isSearching.value) return []
    const groups = visibleSettingsNav({
      isSuperuser: isSuperuser.value,
      permissions: userPermissions.value,
      isDemoRestricted: isDemoRestrictedAccount.value,
      showBookRequests: showBookRequests.value,
    })
    return searchSettingsNav(groups, trimmed.value, t).map(({ item, group }) => ({
      kind: 'setting' as const,
      key: `setting:${item.id}`,
      label: t(item.labelKey),
      groupLabel: t(group.labelKey),
      description: item.descriptionKey ? t(item.descriptionKey) : '',
      icon: item.icon,
      to: { name: item.routeName },
    }))
  })

  const placeHits = computed(() => (isSearching.value ? places.value.filter((place) => matches(place.label, needle.value)) : []))
  const actionHits = computed(() => (isSearching.value ? actions.value.filter((action) => matches(action.label, needle.value)) : []))

  const tabs = computed<PaletteTabOption[]>(() => {
    if (!isSearching.value) return []
    const options: PaletteTabOption[] = [
      { id: 'books', label: t('commandPalette.tabs.books'), count: books.total.value },
      { id: 'authors', label: t('commandPalette.tabs.authors'), count: authorTotal.value },
      { id: 'series', label: t('commandPalette.tabs.series'), count: seriesTotal.value },
      { id: 'settings', label: t('commandPalette.tabs.settings'), count: settingsHits.value.length },
    ]
    const all = options.reduce((sum, option) => sum + option.count, 0) + placeHits.value.length
    return [{ id: 'all', label: t('commandPalette.tabs.all'), count: all }, ...options.filter((option) => option.count > 0)]
  })

  function moreRow(label: string, target: PaletteTab): PaletteItem {
    return { kind: 'more', key: `more:${target}`, label, tab: target }
  }

  const sections = computed<PaletteSection[]>(() => {
    if (!isSearching.value) {
      const result: PaletteSection[] = []
      if (continueReading.value.length) {
        result.push({
          id: 'continue',
          label: t('commandPalette.sections.continueReading'),
          items: continueReading.value.map((book) => ({ kind: 'reading', key: `reading:${book.id}`, book })),
        })
      }
      const libraryPlaces = places.value.filter((place) => place.key.startsWith('library:')).slice(0, ALL_TAB_LIMITS.places)
      if (libraryPlaces.length) result.push({ id: 'goto', label: t('commandPalette.sections.goTo'), items: libraryPlaces })
      result.push({ id: 'actions', label: t('commandPalette.sections.actions'), items: actions.value })
      return result
    }

    const bookItems: PaletteItem[] = books.results.value.map((book) => ({ kind: 'book', key: `book:${book.id}`, book }))
    const authorItems: PaletteItem[] = authors.value.map((author) => ({ kind: 'author', key: `author:${author.id}`, author }))
    const seriesItems: PaletteItem[] = series.value.map((entry) => ({ kind: 'series', key: `series:${entry.id}`, series: entry }))

    if (tab.value === 'books') return [{ id: 'books', label: t('commandPalette.sections.books'), count: books.total.value, items: bookItems }]
    if (tab.value === 'authors') return [{ id: 'authors', label: t('commandPalette.sections.authors'), count: authorTotal.value, items: authorItems }]
    if (tab.value === 'series') return [{ id: 'series', label: t('commandPalette.sections.series'), count: seriesTotal.value, items: seriesItems }]
    if (tab.value === 'settings')
      return [{ id: 'settings', label: t('commandPalette.sections.settings'), count: settingsHits.value.length, items: settingsHits.value }]

    const result: PaletteSection[] = []
    if (bookItems.length) {
      const ranked = rankBooks(books.results.value, trimmed.value).slice(0, ALL_TAB_LIMITS.books)
      const items: PaletteItem[] = ranked.map((book) => ({ kind: 'book', key: `book:${book.id}`, book }))
      if (books.total.value > ALL_TAB_LIMITS.books) items.push(moreRow(t('commandPalette.showAllBooks', { count: books.total.value }), 'books'))
      result.push({ id: 'books', label: t('commandPalette.sections.books'), count: books.total.value, items })
    }
    if (authorItems.length) {
      const items = authorItems.slice(0, ALL_TAB_LIMITS.authors)
      if (authorTotal.value > ALL_TAB_LIMITS.authors) items.push(moreRow(t('commandPalette.showAllAuthors', { count: authorTotal.value }), 'authors'))
      result.push({ id: 'authors', label: t('commandPalette.sections.authors'), count: authorTotal.value, items })
    }
    if (seriesItems.length) {
      const items = seriesItems.slice(0, ALL_TAB_LIMITS.series)
      if (seriesTotal.value > ALL_TAB_LIMITS.series) items.push(moreRow(t('commandPalette.showAllSeries', { count: seriesTotal.value }), 'series'))
      result.push({ id: 'series', label: t('commandPalette.sections.series'), count: seriesTotal.value, items })
    }
    if (placeHits.value.length) {
      result.push({ id: 'goto', label: t('commandPalette.sections.goTo'), items: placeHits.value.slice(0, ALL_TAB_LIMITS.places) })
    }
    if (settingsHits.value.length) {
      const items: PaletteItem[] = settingsHits.value.slice(0, ALL_TAB_LIMITS.settings)
      if (settingsHits.value.length > ALL_TAB_LIMITS.settings) {
        items.push(moreRow(t('commandPalette.showAllSettings', { count: settingsHits.value.length }), 'settings'))
      }
      result.push({ id: 'settings', label: t('commandPalette.sections.settings'), count: settingsHits.value.length, items })
    }
    if (actionHits.value.length)
      result.push({ id: 'actions', label: t('commandPalette.sections.actions'), items: actionHits.value.slice(0, ALL_TAB_LIMITS.actions) })
    return result
  })

  const loading = computed(() => isSearching.value && (books.loading.value || entitiesLoading.value))
  const settled = computed(() => isSearching.value && books.settled.value && !entitiesLoading.value)

  function clear() {
    books.clear()
  }

  return {
    sections,
    tabs,
    isSearching,
    loading,
    settled,
    hasMoreBooks: books.hasMore,
    loadingMoreBooks: books.loadingMore,
    loadMoreBooks: books.loadMore,
    clear,
  }
}
