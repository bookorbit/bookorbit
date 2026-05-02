import { computed, reactive, ref, watch, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { BookCard, BookQuery, BooksPage, GroupRule, SortField, SortSpec } from '@bookorbit/types'

function getPrimaryFile(book: BookCard) {
  return book.files.find((file) => file.role === 'primary') ?? book.files[0] ?? null
}

function getBookSortValue(book: BookCard, field: SortField): string | number | null {
  switch (field) {
    case 'title':
      return book.title?.toLowerCase() ?? null
    case 'author':
      return book.authors?.[0]?.toLowerCase() ?? null
    case 'series':
      return book.seriesName?.toLowerCase() ?? null
    case 'seriesIndex':
      return book.seriesIndex ?? null
    case 'addedAt':
      return book.addedAt ?? null
    case 'publishedYear':
      return book.publishedYear ?? null
    case 'updatedAt':
      return book.updatedAt ?? null
    case 'pageCount':
      return book.pageCount ?? null
    case 'rating':
      return book.rating ?? null
    case 'publisher':
      return book.publisher?.toLowerCase() ?? null
    case 'fileSize':
      return getPrimaryFile(book)?.sizeBytes ?? null
    case 'language':
      return book.language?.toLowerCase() ?? null
    case 'readProgress':
      return book.readingProgress ?? null
    case 'lastReadAt':
      return book.readStatus?.updatedAt ?? null
    case 'finishedAt':
      return book.readStatus?.finishedAt ?? null
    case 'metadataScore':
      return book.metadataScore ?? null
    default:
      return null
  }
}

export function sortItems(items: BookCard[], specs: SortSpec[]): BookCard[] {
  return [...items].sort((a, b) => {
    for (const spec of specs) {
      const av = getBookSortValue(a, spec.field)
      const bv = getBookSortValue(b, spec.field)
      if (av === null && bv === null) continue
      if (av === null) return 1
      if (bv === null) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      if (cmp !== 0) return spec.dir === 'asc' ? cmp : -cmp
    }
    return 0
  })
}

export type { BookCard }

export function useLibraryBooks(libraryId: Ref<number | null>, collapseEnabled: Ref<boolean> = ref(false), q: Ref<string> = ref('')) {
  const items = ref<BookCard[]>([])
  const total = ref(0)
  const loading = ref(false)
  const initialized = ref(false)
  const error = ref<string | null>(null)

  const filter = ref<GroupRule | undefined>(undefined)
  const sort = ref<SortSpec[]>([{ field: 'title', dir: 'asc' }])
  const pagination = reactive({ page: 0, size: 50 })

  const hasMore = computed(() => items.value.length < total.value)

  let activeController: AbortController | null = null

  async function load(reset = false) {
    if (libraryId.value === null) return
    if (!reset && (loading.value || !hasMore.value)) return

    if (reset && activeController) {
      activeController.abort()
    }

    const controller = new AbortController()
    activeController = controller
    loading.value = true
    error.value = null

    if (reset) {
      pagination.page = 0
    }

    try {
      const body: BookQuery = {
        filter: filter.value,
        sort: sort.value,
        pagination: { page: pagination.page, size: pagination.size },
        ...(collapseEnabled.value ? { collapseSeries: true } : {}),
        ...(q.value.trim() ? { q: q.value.trim() } : {}),
      }

      const res = await api(`/api/v1/libraries/${libraryId.value}/books`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (controller.signal.aborted) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const page: BooksPage = await res.json()

      if (controller.signal.aborted) return

      if (pagination.page === 0) {
        items.value = page.items
      } else {
        items.value = [...items.value, ...page.items]
      }
      total.value = page.total
      pagination.page++
    } catch (e) {
      if (controller.signal.aborted) return
      error.value = e instanceof Error ? e.message : 'Failed to load books'
    } finally {
      if (!controller.signal.aborted) {
        loading.value = false
        initialized.value = true
      }
    }
  }

  function clear() {
    items.value = []
    total.value = 0
    pagination.page = 0
  }

  watch(libraryId, (newId, oldId) => {
    if (newId !== oldId) load(true)
  })

  watch(
    sort,
    () => {
      void load(true)
    },
    { deep: true },
  )

  return { items, total, loading, initialized, error, filter, sort, pagination, hasMore, load, clear }
}
