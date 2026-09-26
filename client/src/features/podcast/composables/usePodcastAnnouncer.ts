import { nextTick, ref } from 'vue'

const ANNOUNCEMENT_TTL_MS = 8_000

const message = ref('')
let resetTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Single polite live region for podcast state changes that produce no toast: download transitions,
 * queue additions and removals, and sleep-timer expiry. Toasts carry their own live region, so
 * anything already toasted must not be announced here as well.
 */
export function usePodcastAnnouncer() {
  async function announce(text: string): Promise<void> {
    const next = text.trim()
    if (!next) return
    if (message.value === next) {
      message.value = ''
      await nextTick()
    }
    message.value = next
    if (resetTimer) clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      message.value = ''
      resetTimer = null
    }, ANNOUNCEMENT_TTL_MS)
  }

  return { message, announce }
}
