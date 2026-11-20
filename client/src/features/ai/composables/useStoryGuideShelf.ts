import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  StoryGuideHistory,
  StoryGuideList,
  StoryGuideListDirection,
  StoryGuideListItem,
  StoryGuideListSort,
  StoryGuidesSummary,
} from '@bookorbit/types'

import * as aiApi from '../api/ai.api'

export const STORY_GUIDE_PAGE_SIZE = 50
export const STORY_GUIDE_SEARCH_DELAY_MS = 300

/** Text reads best A to Z; every number reads best largest or newest first. */
function defaultDirection(sort: StoryGuideListSort): StoryGuideListDirection {
  return sort === 'title' ? 'asc' : 'desc'
}

/**
 * The AI area's Story guides tab: one page of the stored guides, searched by title and sorted by a
 * column, and the totals above it. Answers older than one already shown are dropped, so a slow
 * search never overwrites a newer one.
 */
export function useStoryGuideShelf() {
  const query = ref('')
  const search = ref('')
  const sort = ref<StoryGuideListSort>('built')
  const direction = ref<StoryGuideListDirection>('desc')
  const offset = ref(0)

  const list = ref<StoryGuideList | null>(null)
  const loading = ref(true)
  const failed = ref(false)

  const summary = ref<StoryGuidesSummary | null>(null)
  const history = ref<StoryGuideHistory | null>(null)
  const overviewLoading = ref(true)
  const overviewFailed = ref(false)

  const items = computed<StoryGuideListItem[]>(() => list.value?.items ?? [])
  const total = computed(() => list.value?.total ?? 0)
  const searching = computed(() => search.value.length > 0)

  let generation = 0
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  async function load(): Promise<void> {
    const current = ++generation
    failed.value = false
    try {
      const next = await aiApi.listStoryGuides({
        q: search.value,
        sort: sort.value,
        direction: direction.value,
        offset: offset.value,
        limit: STORY_GUIDE_PAGE_SIZE,
      })
      if (current !== generation) return
      list.value = next
      // A page emptied by a delete steps back, so the list never strands on an empty page.
      if (next.items.length === 0 && offset.value > 0 && next.total > 0) offset.value = Math.max(0, offset.value - STORY_GUIDE_PAGE_SIZE)
    } catch {
      if (current === generation) failed.value = true
    } finally {
      if (current === generation) loading.value = false
    }
  }

  async function loadOverview(): Promise<void> {
    overviewFailed.value = false
    const [summaryResult, historyResult] = await Promise.allSettled([aiApi.getStoryGuidesSummary(), aiApi.getStoryGuideHistory()])
    if (summaryResult.status === 'fulfilled') summary.value = summaryResult.value
    if (historyResult.status === 'fulfilled') history.value = historyResult.value
    overviewFailed.value = summaryResult.status === 'rejected' || historyResult.status === 'rejected'
    overviewLoading.value = false
  }

  function refresh(): void {
    void load()
    void loadOverview()
  }

  function startOver(): void {
    loading.value = true
    if (offset.value !== 0) offset.value = 0
    else void load()
  }

  /** The same column again flips the order; a new column starts from its natural order. */
  function sortBy(column: StoryGuideListSort): void {
    if (sort.value === column) {
      direction.value = direction.value === 'asc' ? 'desc' : 'asc'
      return
    }
    sort.value = column
    direction.value = defaultDirection(column)
  }

  function clearSearch(): void {
    query.value = ''
  }

  watch(query, (value) => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      searchTimer = null
      search.value = value.trim()
    }, STORY_GUIDE_SEARCH_DELAY_MS)
  })
  watch([search, sort, direction], startOver)
  watch(offset, () => {
    void load()
  })

  onMounted(refresh)

  onBeforeUnmount(() => {
    generation++
    if (searchTimer) clearTimeout(searchTimer)
  })

  return {
    query,
    search,
    sort,
    direction,
    offset,
    list,
    items,
    total,
    loading,
    failed,
    searching,
    summary,
    history,
    overviewLoading,
    overviewFailed,
    load,
    loadOverview,
    refresh,
    sortBy,
    clearSearch,
  }
}
