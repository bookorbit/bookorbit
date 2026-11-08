import { ref } from 'vue'
import type { BookLinkGroup } from '@bookorbit/types'
import { errorMessage } from '@/lib/api-json'
import { linkBooks, setBookLinkLead, unlinkBook } from '../api/book-link'

/**
 * The three link requests with one in-flight flag, so a menu or sheet never sends twice. Each
 * returns null or false on failure and leaves the translated reason in `error` for the caller to
 * show: inline in the sheet, as a toast from a menu.
 */
export function useBookLinkActions() {
  const pending = ref(false)
  const error = ref<string | null>(null)

  async function run<T>(request: () => Promise<T>, fallbackKey: string): Promise<T | null> {
    if (pending.value) return null
    pending.value = true
    error.value = null
    try {
      return await request()
    } catch (reason) {
      error.value = errorMessage(reason, fallbackKey)
      return null
    } finally {
      pending.value = false
    }
  }

  function link(bookIds: number[]): Promise<BookLinkGroup | null> {
    return run(() => linkBooks({ bookIds: [...new Set(bookIds)] }), 'book.link.errors.linkFailed')
  }

  async function unlink(bookId: number): Promise<boolean> {
    const done = await run(async () => {
      await unlinkBook(bookId)
      return true
    }, 'book.link.errors.unlinkFailed')
    return done === true
  }

  function makeLead(groupId: number, leadBookId: number): Promise<BookLinkGroup | null> {
    return run(() => setBookLinkLead(groupId, { leadBookId }), 'book.link.errors.leadFailed')
  }

  function clearError(): void {
    error.value = null
  }

  return { pending, error, link, unlink, makeLead, clearError }
}
