import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import type { BookSelectionPayload } from '@bookorbit/types'

interface MergeBooksTargetOptions {
  getSelectionPayload: () => BookSelectionPayload
  selectedCount: Ref<number>
}

export function useMergeBooksTarget(options: MergeBooksTargetOptions) {
  const open = ref(false)
  const payload = computed<BookSelectionPayload>(() => options.getSelectionPayload())
  const count = computed(() => options.selectedCount.value)

  function openForSelection(): void {
    open.value = true
  }

  function setOpen(next: boolean): void {
    open.value = next
  }

  return { open, payload, count, openForSelection, setOpen }
}
