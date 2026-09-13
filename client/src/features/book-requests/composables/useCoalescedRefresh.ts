import { onScopeDispose } from 'vue'

/**
 * Turns a stream of triggers into at most one refresh per window.
 *
 * The pipeline broadcasts a change per transition, and one request moving from approved through to
 * available is several of them within a couple of seconds. Every connected page answers each one
 * with a list fetch and a summary, so a burst is worth collapsing. Leading edge, so a single change
 * still lands immediately rather than a window late, and a trailing run always follows a burst so
 * the last change is never the one that goes unread.
 */
export function useCoalescedRefresh(refresh: () => void, windowMs: number): () => void {
  let handle: ReturnType<typeof setTimeout> | null = null
  let lastRefreshAt = 0

  onScopeDispose(() => {
    if (handle) clearTimeout(handle)
    handle = null
  })

  return () => {
    if (handle) return
    handle = setTimeout(
      () => {
        handle = null
        lastRefreshAt = Date.now()
        refresh()
      },
      Math.max(0, windowMs - (Date.now() - lastRefreshAt)),
    )
  }
}
