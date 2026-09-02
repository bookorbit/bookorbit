import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

interface UseRouteTabOptions<T extends string> {
  routeName?: string
  normalize: (value: unknown) => T
  availableTabs: MaybeRefOrGetter<readonly T[]>
  fallback: T
}

interface UseRouteTabResult<T extends string> {
  activeTab: Ref<T>
  selectTab: (tab: T) => void
}

export function useRouteTab<T extends string>(options: UseRouteTabOptions<T>): UseRouteTabResult<T> {
  const route = useRoute()
  const router = useRouter()

  function resolveTab(value: unknown): T {
    const availableTabs = toValue(options.availableTabs)
    const normalized = options.normalize(value)
    if (availableTabs.includes(normalized)) return normalized
    return availableTabs[0] ?? options.fallback
  }

  const activeTab = ref(resolveTab(route.query.tab)) as Ref<T>

  function replaceQuery(tab: T): void {
    if (route.query.tab === tab) return
    const query = { ...route.query, tab }
    void router.replace(options.routeName ? { name: options.routeName, query } : { query })
  }

  function syncTab(value: unknown): void {
    const nextTab = resolveTab(value)
    activeTab.value = nextTab
    if (toValue(options.availableTabs).length > 0) replaceQuery(nextTab)
  }

  watch(() => route.query.tab, syncTab, { immediate: true })
  watch(
    () => toValue(options.availableTabs),
    () => syncTab(route.query.tab),
  )

  function selectTab(tab: T): void {
    if (!toValue(options.availableTabs).includes(tab)) return
    activeTab.value = tab
    replaceQuery(tab)
  }

  return { activeTab, selectTab }
}
