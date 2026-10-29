import { computed, onScopeDispose, shallowRef, watch, type Ref } from 'vue'
import { Permission, type BookDetail, type ReadAloudCapability } from '@bookorbit/types'
import { api } from '@/lib/api'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { resolveReadAloudEntry } from '../lib/read-aloud'

/**
 * Whether a book can be offered a read-aloud right now and has none yet, for entry points outside
 * the Files tab. One lookup, no live updates: it asks again when the book's files change. A failed
 * or refused lookup simply offers nothing, since the Files tab explains the real state.
 */
export function useReadAloudInvite(book: Ref<Pick<BookDetail, 'id' | 'files'>>) {
  const { hasPermission, isDemoRestrictedAccount } = usePermissions()
  const enabled = computed(() => hasPermission(Permission.LibraryGenerateReadAloud) && !isDemoRestrictedAccount.value)
  /** The last answer, tagged with its book so another book's answer can never show here. */
  const answer = shallowRef<{ bookId: number; capability: ReadAloudCapability } | null>(null)
  let controller: AbortController | null = null

  async function load() {
    controller?.abort()
    controller = null
    const bookId = book.value.id
    // The same book keeps its last answer while asking again, so the invite does not blink off and on.
    if (!enabled.value || answer.value?.bookId !== bookId) answer.value = null
    if (!enabled.value) return
    const current = new AbortController()
    controller = current
    try {
      const response = await api(`/api/v1/books/${bookId}/read-aloud`, { signal: current.signal })
      if (current.signal.aborted) return
      if (!response.ok) {
        answer.value = null
        return
      }
      const capability = (await response.json()) as ReadAloudCapability
      if (current.signal.aborted) return
      answer.value = { bookId, capability }
    } catch {
      // Offering nothing is the safe answer to a lookup that did not finish.
      if (!current.signal.aborted) answer.value = null
    }
  }

  watch([() => book.value.id, () => book.value.files.map((file) => file.id).join(','), enabled], load, { immediate: true })
  onScopeDispose(() => controller?.abort())

  const invite = computed(() => {
    const current = answer.value
    if (!enabled.value || current === null || current.bookId !== book.value.id) return false
    const entry = resolveReadAloudEntry({ enabled: true, capability: current.capability, loadFailed: false, job: null })
    return entry.kind === 'available' && current.capability.existingReadAlongs.length === 0
  })

  return { invite }
}
