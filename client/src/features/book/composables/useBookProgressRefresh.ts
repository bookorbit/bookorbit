import { getCurrentScope, onScopeDispose } from 'vue'
import { useBookEvents } from './useBookEvents'

const PROGRESS_REFRESH_DEBOUNCE_MS = 250

export function useBookProgressRefresh(refresh: () => void | Promise<void>): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const cleanup = useBookEvents().onBookProgressChanged(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void refresh()
    }, PROGRESS_REFRESH_DEBOUNCE_MS)
  })

  if (getCurrentScope()) {
    onScopeDispose(() => {
      cleanup()
      if (timer) clearTimeout(timer)
    })
  }
}
