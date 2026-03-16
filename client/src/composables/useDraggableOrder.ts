import { onUnmounted, ref, watch, type Ref } from 'vue'

interface OrderableItem {
  id: number
  displayOrder: number
}

interface UseDraggableOrderOptions<T extends OrderableItem> {
  source: Ref<T[]>
  persist: (order: { id: number; displayOrder: number }[]) => Promise<void>
  debounceMs?: number
}

export function useDraggableOrder<T extends OrderableItem>({ source, persist, debounceMs = 600 }: UseDraggableOrderOptions<T>) {
  const localItems = ref<T[]>([]) as Ref<T[]>
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let snapshot: T[] = []
  let isDragging = false

  watch(
    source,
    (items) => {
      if (isDragging) return
      localItems.value = [...items]
      snapshot = [...items]
    },
    { immediate: true },
  )

  function onDragStart() {
    isDragging = true
    snapshot = [...localItems.value]
  }

  function onDragEnd() {
    isDragging = false

    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      const order = localItems.value.map((item, index) => ({ id: item.id, displayOrder: index }))
      try {
        await persist(order)
        order.forEach(({ id, displayOrder }) => {
          const item = source.value.find((i) => i.id === id)
          if (item) item.displayOrder = displayOrder
        })
      } catch {
        localItems.value = [...snapshot]
      }
    }, debounceMs)
  }

  onUnmounted(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  return { localItems, onDragStart, onDragEnd }
}
