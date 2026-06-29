import { onActivated, onDeactivated, onMounted, watch, type Ref } from 'vue'
import { useBookNavigation } from './useBookNavigation'
import type { BookSlot } from './useBookWindow'

export function useBookViewContext(slots: Ref<BookSlot[]>, total: Ref<number>, loadMore: () => Promise<unknown> | unknown) {
  const { setBookSlotContext, registerLoadMore } = useBookNavigation()
  let active = true

  const syncBookContext = () => {
    if (!active) return
    setBookSlotContext(slots.value, total.value)
  }

  watch([slots, total], () => syncBookContext(), { immediate: true })

  function registerContextLoader() {
    registerLoadMore(async () => {
      await loadMore()
      setBookSlotContext(slots.value, total.value)
    })
  }

  onMounted(() => {
    registerContextLoader()
  })

  onActivated(() => {
    active = true
    registerContextLoader()
    syncBookContext()
  })

  onDeactivated(() => {
    active = false
  })
}
