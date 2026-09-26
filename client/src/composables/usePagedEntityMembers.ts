import { computed, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { createRequestGeneration } from '@/lib/async'
import { useInfiniteScrollSentinel } from './useInfiniteScrollSentinel'

const DEFAULT_PAGE_SIZE = 50

export interface PagedEntityMembersOptions<TEntity, TItem> {
  /** The entity whose members are paged, read from the route. */
  entityId: Ref<number>
  /** The entity itself, resolved out of a shared list cache. Null until that cache has it. */
  entity: ComputedRef<TEntity | null>
  /** Whether the shared list cache has answered at all, which is what tells a missing id from an unloaded one. */
  loaded: Ref<boolean>
  listError: Ref<string | null>
  fetchEntities: () => Promise<void>
  refreshEntities: () => Promise<void>
  fetchPage: (entityId: number, page: number, size: number) => Promise<{ items: TItem[]; total: number }>
  /** Hands the authoritative total back to the cache that owns the entity, for its badge. */
  applyTotal?: (entityId: number, total: number) => void
  pageSize?: number
  errorKeys: { load: string; loadMore: string }
}

/**
 * A collection of shows and a smart scope of episodes are the same page: resolve an entity out of a
 * shared list, then page its members with a generation guard, an infinite-scroll sentinel, and a
 * first-page error that is fatal where an appended-page error is not.
 *
 * A failed first page re-reads the entity list before giving up, because the usual cause is that the
 * entity was deleted or unshared in another tab: that answer is "not found", not "load failed".
 */
export function usePagedEntityMembers<TEntity, TItem>(options: PagedEntityMembersOptions<TEntity, TItem>) {
  const { t } = useI18n()
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE

  const items = ref([]) as Ref<TItem[]>
  const total = ref(0)
  const page = ref(0)
  const loading = ref(true)
  const failed = ref(false)
  const appendFailed = ref(false)
  const generation = createRequestGeneration()

  const notFound = computed(() => options.loaded.value && !loading.value && options.entity.value === null)
  const hasMore = computed(() => items.value.length < total.value)
  /** Translated on read so a locale change updates a message already on screen. */
  const error = computed(() => (failed.value ? t(options.errorKeys.load) : null))
  const appendError = computed(() => (appendFailed.value ? t(options.errorKeys.loadMore) : null))

  async function load(append = false): Promise<void> {
    if (!options.entity.value) return
    // An append in flight must not swallow a reload the user just asked for, so only appends
    // are skipped while busy; a reload supersedes whatever is running.
    if (loading.value && append) return
    const activeGeneration = generation.begin()
    loading.value = true
    if (append) appendFailed.value = false
    else failed.value = false
    try {
      const requestedPage = append ? page.value + 1 : 0
      const result = await options.fetchPage(options.entityId.value, requestedPage, pageSize)
      if (!generation.isCurrent(activeGeneration)) return
      items.value = append ? [...items.value, ...result.items] : result.items
      total.value = result.total
      page.value = requestedPage
      options.applyTotal?.(options.entityId.value, result.total)
    } catch {
      if (!generation.isCurrent(activeGeneration)) return
      if (!append) {
        await options.refreshEntities()
        if (!generation.isCurrent(activeGeneration) || !options.entity.value) return
      }
      if (append) appendFailed.value = true
      else failed.value = true
    } finally {
      if (generation.isCurrent(activeGeneration)) loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    await load(true)
  }

  async function loadRoute(): Promise<void> {
    const requestedId = options.entityId.value
    loading.value = true
    failed.value = false
    await options.fetchEntities()
    if (requestedId !== options.entityId.value) return
    if (!options.loaded.value && options.listError.value) {
      loading.value = false
      failed.value = true
      return
    }
    if (options.entity.value) {
      await load()
      return
    }
    loading.value = false
  }

  /** Drops a member the caller has already removed server-side, keeping the total and the badge in step. */
  function removeItem(predicate: (item: TItem) => boolean): void {
    const remaining = items.value.filter((item) => !predicate(item))
    if (remaining.length === items.value.length) return
    items.value = remaining
    total.value = Math.max(0, total.value - 1)
    options.applyTotal?.(options.entityId.value, total.value)
  }

  const { sentinel } = useInfiniteScrollSentinel({ loadMore, hasMore, loading })

  onMounted(loadRoute)

  return { items, total, loading, notFound, error, appendError, hasMore, sentinel, load, loadMore, loadRoute, removeItem }
}
