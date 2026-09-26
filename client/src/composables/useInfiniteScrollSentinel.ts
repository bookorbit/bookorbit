import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'

type UseInfiniteScrollSentinelOptions = {
  loadMore: () => Promise<unknown> | unknown
  hasMore: Ref<boolean>
  loading: Ref<boolean>
  rootMargin?: string
}

export function useInfiniteScrollSentinel(opts: UseInfiniteScrollSentinelOptions) {
  const sentinel = ref<HTMLElement | null>(null)
  let observer: IntersectionObserver | null = null
  const rootMargin = opts.rootMargin ?? '300px'

  function checkSentinel() {
    if (!opts.hasMore.value || opts.loading.value) return
    const element = sentinel.value
    if (!element) return
    if (element.getBoundingClientRect().top < window.innerHeight + 300) void opts.loadMore()
  }

  onMounted(() => {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !opts.loading.value && opts.hasMore.value) {
          void opts.loadMore()
        }
      },
      { rootMargin },
    )
    if (sentinel.value) observer.observe(sentinel.value)
    window.addEventListener('resize', checkSentinel, { passive: true })
  })

  onUnmounted(() => {
    observer?.disconnect()
    window.removeEventListener('resize', checkSentinel)
  })

  watch(
    opts.loading,
    (isLoading) => {
      if (!isLoading) checkSentinel()
    },
    { flush: 'post' },
  )

  return {
    sentinel,
    checkSentinel,
  }
}
