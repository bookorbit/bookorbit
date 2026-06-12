import { ref, watch, type Ref } from 'vue'

/**
 * Reserves the grid's right gutter while the rail is visible. The gutter is
 * claimed immediately on show but only released after the rail's leave
 * transition finishes (wire releaseGutter to the rail's after-leave event),
 * so cards never slide under a rail that is still fading out.
 */
export function useJumpRailGutter(visible: Ref<boolean>) {
  const gutterReserved = ref(visible.value)

  watch(visible, (value) => {
    if (value) gutterReserved.value = true
  })

  function releaseGutter() {
    if (!visible.value) gutterReserved.value = false
  }

  return { gutterReserved, releaseGutter }
}
