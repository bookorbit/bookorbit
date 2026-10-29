import { computed, onBeforeUnmount, onMounted, ref, shallowRef, type ComponentPublicInstance, type Ref } from 'vue'
import { elementScroll, useVirtualizer, type Virtualizer } from '@tanstack/vue-virtual'

/**
 * A virtualizer over rows that scroll with the page, not inside a box of their own: the scroll
 * element is the app shell's scroller, and `scrollMargin` is where the list starts inside it.
 * The start moves whenever anything above the list changes height (the rail's numbers arriving,
 * the toolbar wrapping, a phone rotating), so it is re-measured on every resize.
 */
export function useShellVirtualizer(options: {
  listEl: Ref<HTMLElement | null>
  count: Ref<number>
  estimateSize: (index: number) => number
  getItemKey: (index: number) => string
  overscan?: number
  /** Space a jump leaves above its row, for anything pinned over the top of the list. */
  scrollPaddingStart?: number
}) {
  // The shell outlives every page, so it is there before this list renders. Resolving it now
  // matters: the virtualizer caches its first scroll offset, and attaching later would snap the
  // page back to the top.
  const scrollEl = shallowRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.app-shell-scroll'))
  const scrollMargin = ref(0)
  let observer: ResizeObserver | null = null

  function measureMargin() {
    const list = options.listEl.value
    const scroller = scrollEl.value
    if (!list || !scroller) return
    const next = Math.round(list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop)
    if (next !== scrollMargin.value) scrollMargin.value = next
  }

  onMounted(() => {
    scrollEl.value = options.listEl.value?.closest<HTMLElement>('.app-shell-scroll') ?? scrollEl.value
    measureMargin()
    observer = new ResizeObserver(measureMargin)
    const page = scrollEl.value?.firstElementChild
    if (page) observer.observe(page)
    if (options.listEl.value) observer.observe(options.listEl.value)
  })

  onBeforeUnmount(() => observer?.disconnect())

  const virtualizer = useVirtualizer(
    computed(() => ({
      count: options.count.value,
      getScrollElement: () => scrollEl.value,
      estimateSize: options.estimateSize,
      getItemKey: options.getItemKey,
      overscan: options.overscan ?? 6,
      scrollPaddingStart: options.scrollPaddingStart ?? 0,
      scrollMargin: scrollMargin.value,
      // On first attaching to the shell the virtualizer scrolls to this offset; the shell's own
      // position keeps it from snapping the page back to the top.
      initialOffset: () => scrollEl.value?.scrollTop ?? 0,
      // The shell scrolls smoothly by default. The virtualizer's own corrections (re-targeting a
      // jump as rows measure, holding rows still as those above them resize) ask for the default
      // behaviour, so they would animate, and mid-animation it mistakes them for the reader
      // scrolling and abandons the jump. Only an explicitly smooth scroll animates.
      scrollToFn: (offset: number, scroll: { adjustments?: number; behavior?: ScrollBehavior }, instance: Virtualizer<HTMLElement, Element>) =>
        elementScroll(offset, { ...scroll, behavior: scroll.behavior === 'smooth' ? 'smooth' : 'instant' }, instance),
    })),
  )

  const items = computed(() => virtualizer.value.getVirtualItems())
  const totalSize = computed(() => virtualizer.value.getTotalSize())

  /** The list-relative scroll position: how far the top of the viewport is into the list. */
  const listScrollTop = computed(() => (virtualizer.value.scrollOffset ?? 0) - scrollMargin.value)

  /** A template ref callback: rows measure themselves as they render. */
  function measureElement(el: Element | ComponentPublicInstance | null) {
    const node = el instanceof Element ? el : (el?.$el as Element | undefined)
    if (node) virtualizer.value.measureElement(node)
  }

  /**
   * Jumps straight to a row. Instant, because the shell scrolls smoothly by default and a long
   * list would crawl for seconds; the virtualizer re-targets once the rows around it are measured.
   */
  function scrollToIndex(index: number) {
    virtualizer.value.scrollToIndex(index, { align: 'start', behavior: 'instant' })
  }

  return { virtualizer, items, totalSize, scrollMargin, listScrollTop, measureElement, scrollToIndex, measureMargin }
}
