import { useRouter, type RouteLocationRaw } from 'vue-router'
import { isNewTabClick } from '@/lib/click-modifiers'

export function useOpenInNewTab() {
  const router = useRouter()

  function openInNewTab(to: RouteLocationRaw): void {
    window.open(router.resolve(to).href, '_blank', 'noopener,noreferrer')
  }

  /**
   * For click and auxclick handlers on elements that cannot be real links. Returns true when the
   * event asked for a new tab and one was opened, so the caller skips its in-tab navigation.
   */
  function openInNewTabIfRequested(event: MouseEvent, to: RouteLocationRaw | null | undefined): boolean {
    if (!to || !isNewTabClick(event)) return false
    event.preventDefault()
    openInNewTab(to)
    return true
  }

  return { openInNewTab, openInNewTabIfRequested }
}
