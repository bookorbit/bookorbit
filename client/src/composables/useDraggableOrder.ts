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

export type ReorderStatusKind = 'lifted' | 'moved' | 'dropped' | 'cancelled'

export interface ReorderStatus<T> {
  kind: ReorderStatusKind
  item: T
  /** 1-based, so it can be announced directly. */
  position: number
  total: number
}

export function useDraggableOrder<T extends OrderableItem>({ source, persist, debounceMs = 600 }: UseDraggableOrderOptions<T>) {
  const localItems = ref<T[]>([]) as Ref<T[]>
  const liftedId = ref<number | null>(null)
  const status = ref<ReorderStatus<T> | null>(null)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let snapshot: T[] = []
  let isDragging = false

  watch(
    source,
    (items) => {
      if (isDragging || liftedId.value !== null) return
      localItems.value = [...items]
      snapshot = [...items]
    },
    { immediate: true },
  )

  function commitOrder() {
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

  function onDragStart() {
    isDragging = true
    snapshot = [...localItems.value]
  }

  function onDragEnd() {
    isDragging = false
    commitOrder()
  }

  function setStatus(kind: ReorderStatusKind, index: number) {
    const item = localItems.value[index]
    if (!item) return
    status.value = { kind, item, position: index + 1, total: localItems.value.length }
  }

  function lift(id: number) {
    const index = localItems.value.findIndex((item) => item.id === id)
    if (index === -1) return
    snapshot = [...localItems.value]
    liftedId.value = id
    setStatus('lifted', index)
  }

  function drop() {
    const id = liftedId.value
    if (id === null) return
    const index = localItems.value.findIndex((item) => item.id === id)
    liftedId.value = null
    if (index !== -1) setStatus('dropped', index)
    commitOrder()
  }

  function cancel() {
    if (liftedId.value === null) return
    const id = liftedId.value
    localItems.value = [...snapshot]
    liftedId.value = null
    const index = localItems.value.findIndex((item) => item.id === id)
    if (index !== -1) setStatus('cancelled', index)
  }

  function moveLifted(offset: number) {
    const id = liftedId.value
    if (id === null) return
    const from = localItems.value.findIndex((item) => item.id === id)
    if (from === -1) return
    const to = from + offset
    if (to < 0 || to >= localItems.value.length) return

    const next = [...localItems.value]
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    localItems.value = next
    setStatus('moved', to)
  }

  /** Space lifts and drops, arrows move, Escape restores the pre-lift order. */
  function handleGripKeydown(event: KeyboardEvent, id: number) {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (liftedId.value === id) drop()
      else lift(id)
      return
    }
    if (liftedId.value !== id) return

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveLifted(-1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveLifted(1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  function handleGripBlur(id: number) {
    if (liftedId.value === id) drop()
  }

  onUnmounted(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  return { localItems, liftedId, status, onDragStart, onDragEnd, handleGripKeydown, handleGripBlur }
}
