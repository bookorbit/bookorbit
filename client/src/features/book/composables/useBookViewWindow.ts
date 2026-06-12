import { computed, ref, type Ref } from 'vue'
import { jumpBucketKindForSort, type GroupRule, type JumpBucket, type SortSpec } from '@bookorbit/types'
import { BOOK_WINDOW_BLOCK_SIZE, useBookWindow, type BookWindowQuery } from './useBookWindow'
import { useJumpBuckets } from './useJumpBuckets'
import { useJumpRailGutter } from './useJumpRailGutter'

const LETTER_TEMPLATE = ['#', ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))]
const MIN_TOTAL_FOR_RAIL = 50
const LIST_CHUNK = 100

function isValidScopeId(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value > 0
}

/**
 * One-stop wiring for the three book browsing views: the placeholder window
 * (grid + table slots, list-mode contiguous prefix) plus the grid jump rail
 * (buckets, active bucket, scrubbing). Sort/filter/search changes reset the
 * window automatically through the query key; no manual reload watching.
 */
export function useBookViewWindow(options: {
  scopeId: Ref<number | null>
  listEndpoint: (id: number) => string
  bucketsEndpoint: (id: number) => string
  viewMode: Ref<string>
  collapseEnabled?: Ref<boolean>
  q?: Ref<string>
}) {
  const filter = ref<GroupRule | undefined>(undefined)
  const sort = ref<SortSpec[]>([{ field: 'title', dir: 'asc' }])

  const query = computed<BookWindowQuery>(() => ({
    sort: sort.value,
    ...(filter.value ? { filter: filter.value } : {}),
    ...(options.collapseEnabled?.value ? { collapseSeries: true } : {}),
    ...(options.q?.value.trim() ? { q: options.q.value.trim() } : {}),
  }))

  const listEndpoint = computed(() => (isValidScopeId(options.scopeId.value) ? options.listEndpoint(options.scopeId.value) : null))
  const bucketsEndpoint = computed(() => (isValidScopeId(options.scopeId.value) ? options.bucketsEndpoint(options.scopeId.value) : null))

  const window = useBookWindow({ endpoint: listEndpoint, query })

  const firstVisibleIndex = ref(0)

  function handleFirstVisibleIndex(index: number) {
    firstVisibleIndex.value = index
  }

  function handleRange(startIndex: number, endIndex: number) {
    window.ensureRange(startIndex, endIndex)
  }

  const bucketKind = computed(() => jumpBucketKindForSort(sort.value))
  const railModeActive = computed(() => options.viewMode.value === 'grid')
  const railEligible = computed(() => bucketKind.value !== null && railModeActive.value && window.total.value >= MIN_TOTAL_FOR_RAIL)

  const bucketsApi = useJumpBuckets({
    endpoint: bucketsEndpoint,
    query,
    enabled: railEligible,
    firstVisibleIndex,
  })

  const railVisible = computed(() => railEligible.value && bucketsApi.buckets.value.length >= 2)
  const activeBucketKey = computed(() => bucketsApi.activeBucket.value?.key ?? null)

  const letterTemplate = computed(() => {
    const dir = (sort.value[0] ?? { dir: 'asc' }).dir
    return dir === 'desc' ? [...LETTER_TEMPLATE].reverse() : LETTER_TEMPLATE
  })

  const { gutterReserved: railGutterReserved, releaseGutter: releaseRailGutter } = useJumpRailGutter(railVisible)

  let scrollToIndex: ((index: number) => void) | null = null

  function registerScroller(fn: ((index: number) => void) | null) {
    scrollToIndex = fn
  }

  function handleJump(bucket: JumpBucket) {
    scrollToIndex?.(bucket.index)
    window.ensureRange(bucket.index, bucket.index + BOOK_WINDOW_BLOCK_SIZE - 1)
    firstVisibleIndex.value = bucket.index
  }

  // List mode keeps the sentinel-driven append feel by loading the next chunk
  // after the contiguous prefix.
  const hasMorePrefix = computed(() => window.initialized.value && window.contiguousPrefix.value.length < window.total.value)

  function loadMorePrefix() {
    const start = window.contiguousPrefix.value.length
    window.ensureRange(start, start + LIST_CHUNK - 1)
  }

  return {
    ...window,
    filter,
    sort,
    query,
    firstVisibleIndex,
    handleFirstVisibleIndex,
    handleRange,
    hasMorePrefix,
    loadMorePrefix,
    bucketKind,
    buckets: bucketsApi.buckets,
    refreshBuckets: bucketsApi.refresh,
    railVisible,
    activeBucketKey,
    letterTemplate,
    railGutterReserved,
    releaseRailGutter,
    registerScroller,
    handleJump,
  }
}
