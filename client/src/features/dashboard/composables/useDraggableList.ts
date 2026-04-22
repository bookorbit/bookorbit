import { ref, type Ref } from 'vue'

export function useDraggableList<T>(list: Ref<T[]>) {
  const draggedIndex = ref<number | null>(null)
  const dragOverIndex = ref<number | null>(null)

  function onDragStart(index: number) {
    draggedIndex.value = index
  }

  function onDragOver(e: DragEvent, index: number) {
    e.preventDefault()
    dragOverIndex.value = index
  }

  function onDrop(index: number) {
    if (draggedIndex.value === null || draggedIndex.value === index) {
      draggedIndex.value = null
      dragOverIndex.value = null
      return
    }
    const items = [...list.value]
    const [moved] = items.splice(draggedIndex.value, 1)
    if (moved) items.splice(index, 0, moved)
    list.value = items
    draggedIndex.value = null
    dragOverIndex.value = null
  }

  function onDragEnd() {
    draggedIndex.value = null
    dragOverIndex.value = null
  }

  function moveUp(index: number) {
    if (index === 0) return
    const items = [...list.value]
    ;[items[index - 1], items[index]] = [items[index]!, items[index - 1]!]
    list.value = items
  }

  function moveDown(index: number) {
    if (index === list.value.length - 1) return
    const items = [...list.value]
    ;[items[index], items[index + 1]] = [items[index + 1]!, items[index]!]
    list.value = items
  }

  return { draggedIndex, dragOverIndex, onDragStart, onDragOver, onDrop, onDragEnd, moveUp, moveDown }
}
