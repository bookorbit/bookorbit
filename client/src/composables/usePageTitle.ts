import { onActivated, onBeforeUnmount, onDeactivated, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useRoute } from 'vue-router'
import { formatPageTitle } from '@/lib/page-title'
import { resolveRouteTitle } from '@/router/title-resolver'

function setTitle(title: string | null | undefined) {
  if (typeof document === 'undefined') return
  document.title = formatPageTitle(title)
}

export function usePageTitle(title: MaybeRefOrGetter<string | null | undefined>) {
  const route = useRoute()
  const ownPath = route.path
  let active = true

  const stop = watch(
    () => toValue(title),
    (value) => {
      if (active) setTitle(value)
    },
    { immediate: true },
  )

  // A page that rewrites its own query (a picked library, say) navigates, and the router's title
  // hook then puts the route's generic title back. Restore this page's own once that settles.
  const stopQuery = watch(
    () => route.fullPath,
    () => {
      if (active && route.path === ownPath) setTitle(toValue(title))
    },
    { flush: 'post' },
  )

  onActivated(() => {
    active = true
    setTitle(toValue(title))
  })

  onDeactivated(() => {
    active = false
  })

  onBeforeUnmount(() => {
    stop()
    stopQuery()
    if (active && typeof document !== 'undefined') {
      document.title = resolveRouteTitle(route)
    }
  })
}
