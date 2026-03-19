import { onBeforeUnmount, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useRoute } from 'vue-router'
import { formatPageTitle } from '@/lib/page-title'
import { resolveRouteTitle } from '@/router/title-resolver'

function setTitle(title: string | null | undefined) {
  if (typeof document === 'undefined') return
  document.title = formatPageTitle(title)
}

export function usePageTitle(title: MaybeRefOrGetter<string | null | undefined>) {
  const route = useRoute()

  const stop = watch(
    () => toValue(title),
    (value) => setTitle(value),
    { immediate: true },
  )

  onBeforeUnmount(() => {
    stop()
    if (typeof document !== 'undefined') {
      document.title = resolveRouteTitle(route)
    }
  })
}
