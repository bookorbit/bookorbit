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
  let active = true

  const stop = watch(
    () => toValue(title),
    (value) => {
      if (active) setTitle(value)
    },
    { immediate: true },
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
    if (active && typeof document !== 'undefined') {
      document.title = resolveRouteTitle(route)
    }
  })
}
