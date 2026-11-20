import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import { NotificationType, type NotificationItem } from '@bookorbit/types'
import { compileIcuCatalog } from '@/i18n/icu'
import en from '@/locales/en.json'
import NotificationItemVue from './NotificationItem.vue'

function notification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 1,
    type: NotificationType.BookRequestSubmitted,
    title: 'New book request',
    message: 'Reader requested "Dune"',
    actionUrl: '/requests',
    meta: { requestId: 42 },
    read: false,
    count: 1,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  }
}

async function mountItem(item: NotificationItem, options: { locale?: string; messages?: Record<string, unknown> } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/requests', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  const locale = options.locale ?? 'en'
  const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: { en: compileIcuCatalog(en, 'en'), ...(options.messages ? { [locale]: options.messages } : {}) },
  })

  const wrapper = mount(NotificationItemVue, {
    props: { notification: item },
    global: { plugins: [router, i18n] },
  })

  return { router, wrapper }
}

describe('NotificationItem', () => {
  it('renders a persisted notification type that is no longer in the registry', async () => {
    const { wrapper } = await mountItem(
      notification({
        type: 'legacy_notification_type' as NotificationItem['type'],
        title: 'Legacy notification',
        message: null,
        actionUrl: null,
        meta: null,
      }),
    )

    expect(wrapper.text()).toContain('Legacy notification')
  })

  /**
   * The stored URL verbatim, query and all. The tab used to be re-derived here from the type,
   * which was a second copy of a decision the server had already made and sent.
   */
  it('follows the action URL the server stored, including its query', async () => {
    const { router, wrapper } = await mountItem(notification({ actionUrl: '/requests?tab=all' }))
    const push = vi.spyOn(router, 'push')

    await wrapper.findAll('button')[0].trigger('click')

    expect(push).toHaveBeenCalledExactlyOnceWith('/requests?tab=all')
  })

  it.each([
    [NotificationType.BookRequestSubmitted, 'text-success'],
    [NotificationType.BookRequestRejected, 'text-warning'],
    [NotificationType.BookRequestFailed, 'text-destructive'],
  ])('renders %s with the request icon and its registered severity', async (type, severityClass) => {
    const { wrapper } = await mountItem(notification({ type }))

    expect(wrapper.find('.lucide-book-plus').exists()).toBe(true)
    expect(wrapper.find('.lucide-book-plus').classes()).toContain(severityClass)
  })

  it('exposes separate native controls for opening and dismissing the notification', async () => {
    const { wrapper } = await mountItem(notification())

    expect(wrapper.findAll('button')).toHaveLength(2)
    expect(wrapper.find('button[aria-label="Dismiss notification"]').exists()).toBe(true)
    expect(wrapper.findAll('button')[0].element.tagName).toBe('BUTTON')
  })

  describe('Library Dock digests', () => {
    const digest = (meta: Record<string, unknown>, type: NotificationItem['type'] = NotificationType.BookDockDigestNeedsReview) =>
      notification({ type, title: 'Server fallback title', message: 'Server fallback message', actionUrl: '/book-dock', meta })

    it('names the dock and both counts in the reader’s locale, as needing review', async () => {
      const { wrapper } = await mountItem(digest({ dockId: 11, libraryId: 4, libraryName: 'Fiction', filed: 482, held: 18 }))

      expect(wrapper.text()).toContain('Library Dock: Fiction')
      expect(wrapper.text()).toContain('482 books filed, 18 need review.')
      expect(wrapper.text()).not.toContain('Server fallback')
      expect(wrapper.find('.lucide-package-open').classes()).toContain('text-warning')
    })

    it.each([
      [{ dockId: null, libraryId: null, libraryName: null, filed: 1, held: 0 }, 'Library Dock: Unsorted', '1 book filed.'],
      [{ dockId: 11, libraryId: 4, libraryName: 'Fiction', filed: 0, held: 1 }, 'Library Dock: Fiction', '1 book needs review.'],
      [{ dockId: 11, libraryId: null, libraryName: null, filed: 2, held: 0 }, 'Library Dock', '2 books filed.'],
    ])('words %o', async (meta, title, message) => {
      const { wrapper } = await mountItem(digest(meta, NotificationType.BookDockDigest))

      expect(wrapper.text()).toContain(title)
      expect(wrapper.text()).toContain(message)
    })

    it('keeps the server copy for a digest stored without its counts', async () => {
      const { wrapper } = await mountItem(digest({ dockId: 11, filed: 'many' }))

      expect(wrapper.text()).toContain('Server fallback title')
    })
  })

  describe('read-aloud notifications', () => {
    const readAloud = (overrides: Partial<NotificationItem> = {}) =>
      notification({
        type: NotificationType.ReadAloudReady,
        title: 'Server fallback title',
        message: 'Server fallback message',
        actionUrl: '/book/12/files',
        meta: { jobId: 'job-1', bookId: 12, bookTitle: 'Dune', errorCode: null },
        ...overrides,
      })

    it('renders the title in the reader’s locale from the stored book title', async () => {
      const { wrapper } = await mountItem(readAloud())

      expect(wrapper.text()).toContain('Read-aloud ready: Dune')
      expect(wrapper.text()).not.toContain('Server fallback')
    })

    it('follows the active locale rather than the language the server wrote in', async () => {
      const { wrapper } = await mountItem(readAloud(), {
        locale: 'fr',
        messages: { notifications: { readAloud: { readyTitle: 'Lecture synchronisée prête : {title}' } } },
      })

      expect(wrapper.text()).toContain('Lecture synchronisée prête : Dune')
    })

    it('explains a failure with the localized reason for its error code', async () => {
      const { wrapper } = await mountItem(
        readAloud({
          type: NotificationType.ReadAloudFailed,
          meta: { jobId: 'job-1', bookId: 12, bookTitle: 'Dune', errorCode: 'insufficient_storage' },
        }),
      )

      expect(wrapper.text()).toContain('Read-aloud failed: Dune')
      expect(wrapper.text()).toContain(String(en.book.detail.files.readAloud.errors.job.insufficient_storage))
    })

    it('keeps the server copy for a notification stored before the title was sent', async () => {
      const { wrapper } = await mountItem(readAloud({ meta: { jobId: 'job-1', bookId: 12, errorCode: null } }))

      expect(wrapper.text()).toContain('Server fallback title')
      expect(wrapper.text()).toContain('Server fallback message')
    })

    const bulkRun = (overrides: Partial<NotificationItem> = {}) =>
      notification({
        type: NotificationType.BulkRunCompletedWithErrors,
        title: 'Server fallback title',
        message: 'Server fallback message',
        actionUrl: '/jobs/activity?view=history&type=bulk-run',
        meta: { runId: 'run-1', kind: 'book-refresh-metadata', total: 40, processed: 40, succeeded: 37, failed: 3, skipped: 0, code: null },
        ...overrides,
      })

    it('words a bulk run in the reader’s locale with the Jobs area’s name for its kind', async () => {
      const { wrapper } = await mountItem(bulkRun())

      expect(wrapper.text()).toContain('Finished with errors: Refresh book metadata')
      expect(wrapper.text()).toContain('3 of 40 items failed.')
      expect(wrapper.text()).not.toContain('Server fallback')
    })

    it('explains a stopped bulk run with the Jobs area’s reason for its code', async () => {
      const { wrapper } = await mountItem(
        bulkRun({ type: NotificationType.BulkRunFailed, meta: { runId: 'run-1', kind: 'book-move', total: 5, failed: 0, code: 'access-revoked' } }),
      )

      expect(wrapper.text()).toContain("Couldn't finish: Move books")
      expect(wrapper.text()).toContain(String(en.jobsArea.types['bulk-run'].reasons['access-revoked']))
    })

    it('names a bulk run kind this client does not know generically', async () => {
      const { wrapper } = await mountItem(
        bulkRun({ type: NotificationType.BulkRunInterrupted, meta: { runId: 'run-1', kind: 'future-kind', total: 2 } }),
      )

      expect(wrapper.text()).toContain('Interrupted: Bulk action')
      expect(wrapper.text()).toContain(String(en.jobsArea.types['bulk-run'].reasons.interrupted))
    })

    it('leaves every other type to the server copy', async () => {
      const { wrapper } = await mountItem(notification({ meta: { bookTitle: 'Dune' } }))

      expect(wrapper.text()).toContain('New book request')
      expect(wrapper.text()).toContain('Reader requested "Dune"')
    })
  })
})
