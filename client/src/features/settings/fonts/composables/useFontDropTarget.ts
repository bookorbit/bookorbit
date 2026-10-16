import { onMounted, onUnmounted, ref } from 'vue'

/**
 * Makes the whole page a drop target for font files, since the button that opens a picker is far
 * from most rows. `dragCount` is the number of items being dragged while files hover, else null:
 * browsers give the count, not the names, until the drop.
 */
export function useFontDropTarget(enabled: () => boolean, onFiles: (files: File[]) => void) {
  const dragCount = ref<number | null>(null)
  let depth = 0

  function carriesFiles(event: DragEvent): boolean {
    return enabled() && (event.dataTransfer?.types ?? []).includes('Files')
  }
  function handleEnter(event: DragEvent) {
    if (!carriesFiles(event)) return
    event.preventDefault()
    depth++
    dragCount.value = event.dataTransfer?.items.length ?? 0
  }
  function handleOver(event: DragEvent) {
    if (!carriesFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
  function handleLeave(event: DragEvent) {
    if (!carriesFiles(event)) return
    depth = Math.max(0, depth - 1)
    if (depth === 0) dragCount.value = null
  }
  function handleDrop(event: DragEvent) {
    if (!carriesFiles(event)) return
    event.preventDefault()
    depth = 0
    dragCount.value = null
    onFiles(Array.from(event.dataTransfer?.files ?? []))
  }

  onMounted(() => {
    window.addEventListener('dragenter', handleEnter)
    window.addEventListener('dragover', handleOver)
    window.addEventListener('dragleave', handleLeave)
    window.addEventListener('drop', handleDrop)
  })
  onUnmounted(() => {
    window.removeEventListener('dragenter', handleEnter)
    window.removeEventListener('dragover', handleOver)
    window.removeEventListener('dragleave', handleLeave)
    window.removeEventListener('drop', handleDrop)
  })

  return { dragCount }
}
