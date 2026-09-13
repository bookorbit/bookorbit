import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { JumpBucket } from '@bookorbit/types'
import { useJumpRailGutter } from '@/features/book/composables/useJumpRailGutter'
import { fetchAuthorJumpBuckets, type AuthorFilterParams } from '../api/author'
import { isLetterSort } from '../lib/author-identity'
import type { AuthorListSort, SortDirection } from '../types/author'

const LETTER_TEMPLATE = ['#', ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))]

/** Below this the list is short enough to scroll, and a rail is just clutter. */
const MIN_TOTAL_FOR_RAIL = 50

/**
 * A-Z rail for the authors page, reusing the book views' `JumpRail` presentation and
 * gutter. Buckets come from the server under the same filters as the list, so the rail
 * spans the whole result set rather than the pages fetched so far; jumping loads
 * forward to the target index before scrolling to it.
 */
export function useAuthorJumpRail(options: {
  enabled: Ref<boolean>
  sort: Ref<AuthorListSort>
  order: Ref<SortDirection>
  total: Ref<number>
  filterParams: () => AuthorFilterParams
  loadThrough: (index: number) => Promise<boolean>
  scroller: Ref<HTMLElement | null>
}) {
  const buckets = ref<JumpBucket[]>([])
  const activeKey = ref<string | null>(null)
  const jumping = ref(false)

  const supported = computed(() => isLetterSort(options.sort.value))
  const visible = computed(() => options.enabled.value && supported.value && options.total.value >= MIN_TOTAL_FOR_RAIL)
  const template = computed(() => (options.order.value === 'desc' ? [...LETTER_TEMPLATE].reverse() : LETTER_TEMPLATE))

  const { gutterReserved, releaseGutter } = useJumpRailGutter(visible)

  // Keyed so a filter, sort or search change refetches exactly once.
  const queryKey = computed(() => {
    if (!visible.value) return ''
    return JSON.stringify([options.sort.value, options.order.value, options.filterParams()])
  })

  let requestToken = 0

  watch(
    queryKey,
    async (key) => {
      if (!key) {
        buckets.value = []
        activeKey.value = null
        return
      }
      const token = ++requestToken
      try {
        const sort = options.sort.value === 'sortName' ? 'sortName' : 'name'
        const response = await fetchAuthorJumpBuckets({ ...options.filterParams(), sort, order: options.order.value })
        if (token !== requestToken) return
        buckets.value = response.buckets
        syncActiveKey()
      } catch {
        if (token !== requestToken) return
        // A rail that failed to load is simply absent; the list is unaffected.
        buckets.value = []
      }
    },
    { immediate: true },
  )

  /**
   * The heading currently under the top edge of the scroller. Read from the rendered
   * headings rather than from scroll maths, so it stays right whatever the section
   * heights are in either view.
   */
  function syncActiveKey() {
    const root = options.scroller.value
    if (!root || buckets.value.length === 0) return

    const top = root.getBoundingClientRect().top
    const headings = root.querySelectorAll<HTMLElement>('[data-letter]')
    let current: string | null = headings.length > 0 ? (headings[0]?.dataset.letter ?? null) : null

    for (const heading of headings) {
      if (heading.getBoundingClientRect().top - top <= 8) current = heading.dataset.letter ?? current
      else break
    }
    activeKey.value = current
  }

  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

  function offsetOf(root: HTMLElement, key: string): number | null {
    const heading = root.querySelector<HTMLElement>(`[data-letter="${CSS.escape(key)}"]`)
    if (!heading) return null
    return heading.getBoundingClientRect().top - root.getBoundingClientRect().top
  }

  /**
   * One scroll is not enough in an infinite list. Pages that land after the jump extend
   * the section they belong to, and because the index lays rows out in CSS columns a
   * part-filled section grows by a whole row when it re-balances - measured at 376px of
   * drift, which put the reader two letters short of where they asked for. So the
   * position is re-asserted until it holds still, and abandoned the moment the reader
   * scrolls themselves rather than fighting them for the viewport.
   */
  async function settleOnLetter(root: HTMLElement, key: string) {
    const deadline = Date.now() + 3000
    let expected = root.scrollTop
    let stable = 0

    while (Date.now() < deadline && stable < 3) {
      if (Math.abs(root.scrollTop - expected) > 2) return
      const offset = offsetOf(root, key)
      if (offset === null) return
      if (Math.abs(offset) < 1) {
        stable += 1
      } else {
        stable = 0
        root.scrollTop += offset
        expected = root.scrollTop
      }
      await nextFrame()
    }
  }

  async function handleJump(bucket: JumpBucket) {
    if (jumping.value) return
    jumping.value = true
    try {
      await options.loadThrough(bucket.index)
      await nextTick()
      const root = options.scroller.value
      if (!root || offsetOf(root, bucket.key) === null) return
      activeKey.value = bucket.key
      await settleOnLetter(root, bucket.key)
    } finally {
      jumping.value = false
    }
  }

  return { buckets, visible, template, activeKey, gutterReserved, releaseGutter, syncActiveKey, handleJump }
}
