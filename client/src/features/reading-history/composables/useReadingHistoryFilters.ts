import { reactive, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery, type LocationQueryRaw } from 'vue-router'
import { READING_ATTEMPT_OUTCOMES, READING_HISTORY_SORTS, type ReadingAttemptOutcome, type ReadingHistorySort } from '@bookorbit/types'

export type ReadingHistoryView = 'list' | 'covers'

export interface ReadingHistoryFilters {
  /** null = All time. */
  year: number | null
  quarter: number | null
  outcomes: ReadingAttemptOutcome[]
  search: string
  sort: ReadingHistorySort
  bookId: number | null
  view: ReadingHistoryView
}

const VIEW_STORAGE_KEY = 'reading-history-view'
const SEARCH_WRITE_DELAY_MS = 300

function first(value: LocationQuery[string] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw : undefined
}

function positiveInt(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function storedView(): ReadingHistoryView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'covers' ? 'covers' : 'list'
  } catch {
    return 'list'
  }
}

/** Reads the filters from a URL query, ignoring anything unknown or malformed. */
export function filtersFromQuery(query: LocationQuery, currentYear: number): ReadingHistoryFilters {
  const yearParam = first(query.year)
  const year = yearParam === 'all' ? null : (positiveInt(yearParam) ?? currentYear)
  const quarter = year === null ? null : positiveInt(first(query.q))
  const outcomes = (first(query.outcomes) ?? '')
    .split(',')
    .filter((value): value is ReadingAttemptOutcome => (READING_ATTEMPT_OUTCOMES as readonly string[]).includes(value))
  const sort = first(query.sort)
  const view = first(query.view)
  return {
    year,
    quarter: quarter !== null && quarter <= 4 ? quarter : null,
    outcomes: outcomes.length > 0 ? [...new Set(outcomes)] : ['completed'],
    search: first(query.search) ?? '',
    sort: sort && (READING_HISTORY_SORTS as readonly string[]).includes(sort) ? (sort as ReadingHistorySort) : 'newest',
    bookId: positiveInt(first(query.book)),
    view: view === 'covers' || view === 'list' ? view : storedView(),
  }
}

/** Writes the filters back as a minimal query: defaults are left out. */
export function queryFromFilters(filters: ReadingHistoryFilters, currentYear: number): LocationQueryRaw {
  const query: LocationQueryRaw = {}
  if (filters.year === null) query.year = 'all'
  else if (filters.year !== currentYear) query.year = String(filters.year)
  if (filters.year !== null && filters.quarter !== null) query.q = String(filters.quarter)
  if (filters.outcomes.length !== 1 || filters.outcomes[0] !== 'completed') query.outcomes = filters.outcomes.join(',')
  if (filters.search.trim()) query.search = filters.search.trim()
  if (filters.sort !== 'newest') query.sort = filters.sort
  if (filters.bookId !== null) query.book = String(filters.bookId)
  if (filters.view === 'covers') query.view = 'covers'
  return query
}

function sameQuery(next: LocationQueryRaw, current: LocationQuery): boolean {
  const keys = Object.keys(next)
  if (keys.length !== Object.keys(current).length) return false
  return keys.every((key) => first(current[key]) === next[key])
}

/**
 * The page's filters, kept in the URL so a view can be bookmarked or linked to (the dashboard's
 * goal and the completion charts link here), and the List or Covers choice remembered per browser.
 */
export function useReadingHistoryFilters(currentYear = new Date().getFullYear()) {
  const route = useRoute()
  const router = useRouter()
  const filters = reactive<ReadingHistoryFilters>(filtersFromQuery(route.query, currentYear))

  let searchTimer: ReturnType<typeof setTimeout> | null = null

  function write() {
    const next = queryFromFilters(filters, currentYear)
    if (sameQuery(next, route.query)) return
    void router.replace({ query: next })
  }

  watch(
    () => [filters.year, filters.quarter, filters.outcomes.join(','), filters.sort, filters.bookId, filters.view],
    () => {
      try {
        localStorage.setItem(VIEW_STORAGE_KEY, filters.view)
      } catch {
        /* storage unavailable: the choice lasts for this visit */
      }
      write()
    },
  )
  watch(
    () => filters.search,
    () => {
      if (searchTimer) clearTimeout(searchTimer)
      searchTimer = setTimeout(write, SEARCH_WRITE_DELAY_MS)
    },
  )
  watch(
    () => route.query,
    (query) => {
      if (route.name !== 'reading-history') return
      Object.assign(filters, filtersFromQuery(query, currentYear))
    },
  )

  function setYear(year: number | null) {
    filters.year = year
    filters.quarter = null
  }

  function toggleQuarter(quarter: number) {
    if (filters.year === null) return
    filters.quarter = filters.quarter === quarter ? null : quarter
  }

  /** Finished stays on unless another outcome is on, so the list never filters to nothing. */
  function toggleOutcome(outcome: ReadingAttemptOutcome) {
    const has = filters.outcomes.includes(outcome)
    if (has && filters.outcomes.length === 1) return
    filters.outcomes = has
      ? filters.outcomes.filter((value) => value !== outcome)
      : READING_ATTEMPT_OUTCOMES.filter((value) => value === outcome || filters.outcomes.includes(value))
  }

  function clearBook() {
    filters.bookId = null
  }

  return { filters, currentYear, setYear, toggleQuarter, toggleOutcome, clearBook }
}
