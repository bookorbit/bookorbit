import { ref, onBeforeUnmount, type Ref } from 'vue'

export function useTableScrollBehavior(scrollContainerRef: Ref<HTMLDivElement | null>) {
  const isScrolled = ref(false)
  const showScrollTop = ref(false)
  let rafId: number | null = null

  function onScroll() {
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      const el = scrollContainerRef.value
      if (!el) return
      isScrolled.value = el.scrollTop > 0
      showScrollTop.value = el.scrollTop > el.clientHeight * 2
    })
  }

  function scrollToTop() {
    scrollContainerRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  onBeforeUnmount(() => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  })

  return { isScrolled, showScrollTop, onScroll, scrollToTop }
}
