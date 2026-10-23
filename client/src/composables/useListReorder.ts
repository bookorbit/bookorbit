import { ref, watch } from 'vue'
import type { ReorderStatusKind } from '@/composables/useDraggableOrder'

export interface ListReorderStatus {
  kind: ReorderStatusKind
  id: string
  /** 1-based, so it can be announced directly. */
  position: number
  total: number
}

/**
 * Pointer and keyboard reordering for a list of string ids, applied through `commit` on every drop.
 * The keyboard model matches useDraggableOrder: Space or Enter lifts and drops, arrows move,
 * Escape puts the list back. `useDraggableOrder` stays separate because it persists numeric
 * displayOrder rows to the server.
 */
export function useListReorder(source: () => readonly string[], commit: (order: string[]) => void) {
  const items = ref<string[]>([...source()])
  const liftedId = ref<string | null>(null)
  const status = ref<ListReorderStatus | null>(null)
  let dragging = false
  let snapshot: string[] = []

  watch(source, (next) => {
    if (dragging || liftedId.value !== null) return
    items.value = [...next]
  })

  function setStatus(kind: ReorderStatusKind, index: number) {
    const id = items.value[index]
    if (id === undefined) return
    status.value = { kind, id, position: index + 1, total: items.value.length }
  }

  function onDragStart() {
    dragging = true
  }

  function onDragEnd() {
    dragging = false
    commit([...items.value])
  }

  function lift(id: string) {
    const index = items.value.indexOf(id)
    if (index === -1) return
    snapshot = [...items.value]
    liftedId.value = id
    setStatus('lifted', index)
  }

  function drop() {
    const id = liftedId.value
    if (id === null) return
    liftedId.value = null
    setStatus('dropped', items.value.indexOf(id))
    commit([...items.value])
  }

  function cancel() {
    const id = liftedId.value
    if (id === null) return
    items.value = [...snapshot]
    liftedId.value = null
    setStatus('cancelled', items.value.indexOf(id))
  }

  function moveLifted(offset: number) {
    const id = liftedId.value
    if (id === null) return
    const from = items.value.indexOf(id)
    const to = from + offset
    if (from === -1 || to < 0 || to >= items.value.length) return
    const next = [...items.value]
    next.splice(from, 1)
    next.splice(to, 0, id)
    items.value = next
    setStatus('moved', to)
  }

  function handleGripKeydown(event: KeyboardEvent, id: string) {
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
      // Claimed here so the editor's own Escape (leave edit mode) does not also fire.
      event.preventDefault()
      cancel()
    }
  }

  function handleGripBlur(id: string) {
    if (liftedId.value === id) drop()
  }

  return { items, liftedId, status, onDragStart, onDragEnd, handleGripKeydown, handleGripBlur }
}
