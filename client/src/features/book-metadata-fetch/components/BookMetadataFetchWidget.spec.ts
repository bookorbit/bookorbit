import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, shallowMount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import type { AuthorEnrichmentStatusEvent, BookMetadataFetchStatusEvent } from '@bookorbit/types'
import { activateI18nLocale } from '@/i18n'

const bookStatus = ref<BookMetadataFetchStatusEvent>(idleBookStatus())
const authorStatus = ref<AuthorEnrichmentStatusEvent>(idleAuthorStatus())
const subscribeBooks = vi.fn<() => void>()
const subscribeAuthors = vi.fn<() => void>()
const toastSuccess = vi.fn<(message: string) => void>()
const toastWarning = vi.fn<(message: string) => void>()
const authUser = ref({ id: 1 })

vi.mock('../composables/useBookMetadataFetchStatus', () => ({
  useBookMetadataFetchStatus: () => ({ status: bookStatus, subscribe: subscribeBooks }),
}))

vi.mock('@/features/settings/composables/useAuthorEnrichmentStatus', () => ({
  useAuthorEnrichmentStatus: () => ({ status: authorStatus, subscribe: subscribeAuthors }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ isSuperuser: ref(true), hasPermission: () => true }),
}))

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({ user: authUser }),
}))

vi.mock('vue-sonner', () => ({
  toast: { success: toastSuccess, warning: toastWarning },
}))

const { default: BookMetadataFetchWidget } = await import('./BookMetadataFetchWidget.vue')

enableAutoUnmount(afterEach)

function idleBookStatus(overrides: Partial<BookMetadataFetchStatusEvent> = {}): BookMetadataFetchStatusEvent {
  return {
    queued: 0,
    processing: 0,
    failed: 0,
    latestFailureAt: null,
    paused: false,
    sessionTotal: 0,
    sessionDone: 0,
    currentItemName: null,
    ...overrides,
  }
}

function idleAuthorStatus(overrides: Partial<AuthorEnrichmentStatusEvent> = {}): AuthorEnrichmentStatusEvent {
  return {
    queued: 0,
    processing: 0,
    rateLimited: 0,
    failed: 0,
    latestFailureAt: null,
    done: 0,
    total: 0,
    paused: false,
    sessionTotal: 0,
    sessionDone: 0,
    sessionFailed: 0,
    currentItemName: null,
    ...overrides,
  }
}

describe('BookMetadataFetchWidget', () => {
  beforeEach(() => {
    activateI18nLocale('en')
    vi.clearAllMocks()
    localStorage.clear()
    authUser.value = { id: 1 }
    bookStatus.value = idleBookStatus()
    authorStatus.value = idleAuthorStatus()
  })

  it('subscribes to both status streams and stays hidden while idle', () => {
    const wrapper = shallowMount(BookMetadataFetchWidget)

    expect(subscribeBooks).toHaveBeenCalledOnce()
    expect(subscribeAuthors).toHaveBeenCalledOnce()
    expect(wrapper.find('.fixed').exists()).toBe(false)
  })

  it('renders running author work above the mobile action bar with logical positioning', () => {
    authorStatus.value = idleAuthorStatus({ queued: 2, total: 2, sessionTotal: 2, currentItemName: 'Alice' })

    const wrapper = shallowMount(BookMetadataFetchWidget)
    const container = wrapper.get('.fixed')

    expect(wrapper.text()).toContain('Enriching authors')
    expect(wrapper.text()).toContain('2 remaining')
    expect(container.classes()).toContain('bottom-[calc(6rem+env(safe-area-inset-bottom))]')
    expect(container.classes()).toContain('sm:bottom-6')
    expect(container.classes()).toContain('end-3')
    expect(container.classes()).toContain('sm:end-6')
  })

  it('shows terminal failures as finished and dismisses them without deleting the failure report', async () => {
    authorStatus.value = idleAuthorStatus({ failed: 152, latestFailureAt: '2026-08-05T10:00:00.000Z', total: 152 })
    const wrapper = shallowMount(BookMetadataFetchWidget)

    expect(wrapper.text()).toContain('Author enrichment finished')
    expect(wrapper.text()).toContain('152 failed')

    await wrapper.get('button[aria-label="Dismiss author enrichment status"]').trigger('click')

    expect(wrapper.find('.fixed').exists()).toBe(false)
    expect(authorStatus.value.failed).toBe(152)
  })

  it('keeps a dismissed terminal failure card hidden after the widget remounts', async () => {
    authorStatus.value = idleAuthorStatus({ failed: 2, latestFailureAt: '2026-08-05T10:00:00.000Z', total: 2 })
    const wrapper = shallowMount(BookMetadataFetchWidget)

    await wrapper.get('button[aria-label="Dismiss author enrichment status"]').trigger('click')
    wrapper.unmount()

    const remounted = shallowMount(BookMetadataFetchWidget)
    expect(remounted.find('.fixed').exists()).toBe(false)
  })

  it('shows a new terminal failure set after an older one was dismissed', async () => {
    authorStatus.value = idleAuthorStatus({ failed: 2, latestFailureAt: '2026-08-05T10:00:00.000Z', total: 2 })
    const wrapper = shallowMount(BookMetadataFetchWidget)

    await wrapper.get('button[aria-label="Dismiss author enrichment status"]').trigger('click')
    authorStatus.value = idleAuthorStatus({ failed: 2, latestFailureAt: '2026-08-05T11:00:00.000Z', total: 2 })
    await nextTick()

    expect(wrapper.text()).toContain('Author enrichment finished')
  })

  it('keeps a dismissed card hidden for the current run and restores it for later work', async () => {
    authorStatus.value = idleAuthorStatus({ queued: 2, total: 2, sessionTotal: 2 })
    const wrapper = shallowMount(BookMetadataFetchWidget)

    await wrapper.get('button[aria-label="Dismiss author enrichment status"]').trigger('click')
    authorStatus.value = idleAuthorStatus({ processing: 1, total: 2, sessionTotal: 2, sessionDone: 1 })
    await nextTick()
    expect(wrapper.find('.fixed').exists()).toBe(false)

    authorStatus.value = idleAuthorStatus({ failed: 1, total: 1 })
    await nextTick()
    authorStatus.value = idleAuthorStatus({ queued: 1, total: 2, sessionTotal: 1 })
    await nextTick()

    expect(wrapper.text()).toContain('Enriching authors')
  })

  it('reports current-session failures instead of the retained global failure count', async () => {
    authorStatus.value = idleAuthorStatus({ queued: 1, total: 152, sessionTotal: 1 })
    const wrapper = shallowMount(BookMetadataFetchWidget)

    authorStatus.value = idleAuthorStatus({
      failed: 152,
      total: 152,
      sessionTotal: 1,
      sessionDone: 1,
      sessionFailed: 1,
    })
    await nextTick()

    expect(toastWarning).toHaveBeenCalledOnce()
    expect(toastWarning).toHaveBeenCalledWith('Author enrichment done - 1 processed, 1 failed')
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Author enrichment finished')
  })

  it('does not toast for an initial historical-failure snapshot', () => {
    authorStatus.value = idleAuthorStatus({ failed: 152, total: 152 })

    shallowMount(BookMetadataFetchWidget)

    expect(toastWarning).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('toasts once per successful session and resets after the zeroed server snapshot', async () => {
    authorStatus.value = idleAuthorStatus({ processing: 1, total: 1, sessionTotal: 1 })
    shallowMount(BookMetadataFetchWidget)

    authorStatus.value = idleAuthorStatus({ sessionTotal: 1, sessionDone: 1 })
    await nextTick()
    authorStatus.value = idleAuthorStatus()
    await nextTick()
    authorStatus.value = idleAuthorStatus({ queued: 1, total: 1, sessionTotal: 1 })
    await nextTick()
    authorStatus.value = idleAuthorStatus({ sessionTotal: 1, sessionDone: 1 })
    await nextTick()

    expect(toastSuccess).toHaveBeenCalledTimes(2)
    expect(toastSuccess).toHaveBeenNthCalledWith(1, 'Author enrichment complete - 1 authors updated')
    expect(toastSuccess).toHaveBeenNthCalledWith(2, 'Author enrichment complete - 1 authors updated')
  })

  it('also makes retained book metadata failures dismissible', async () => {
    bookStatus.value = idleBookStatus({ failed: 3, latestFailureAt: '2026-08-05T10:00:00.000Z' })
    const wrapper = shallowMount(BookMetadataFetchWidget)

    expect(wrapper.text()).toContain('Metadata fetch finished')
    await wrapper.get('button[aria-label="Dismiss metadata fetch status"]').trigger('click')

    expect(wrapper.find('.fixed').exists()).toBe(false)
    expect(bookStatus.value.failed).toBe(3)
  })

  it('keeps a dismissed book metadata failure card hidden after the widget remounts', async () => {
    bookStatus.value = idleBookStatus({ failed: 3, latestFailureAt: '2026-08-05T10:00:00.000Z' })
    const wrapper = shallowMount(BookMetadataFetchWidget)

    await wrapper.get('button[aria-label="Dismiss metadata fetch status"]').trigger('click')
    wrapper.unmount()

    const remounted = shallowMount(BookMetadataFetchWidget)
    expect(remounted.find('.fixed').exists()).toBe(false)
  })

  it('shows a new book metadata failure set after an older one was dismissed', async () => {
    bookStatus.value = idleBookStatus({ failed: 3, latestFailureAt: '2026-08-05T10:00:00.000Z' })
    const wrapper = shallowMount(BookMetadataFetchWidget)

    await wrapper.get('button[aria-label="Dismiss metadata fetch status"]').trigger('click')
    bookStatus.value = idleBookStatus({ failed: 3, latestFailureAt: '2026-08-05T11:00:00.000Z' })
    await nextTick()

    expect(wrapper.text()).toContain('Metadata fetch finished')
  })

  it('does not let a dismissed author card hide retained book metadata failures', async () => {
    authorStatus.value = idleAuthorStatus({ failed: 3, latestFailureAt: '2026-08-05T10:00:00.000Z', total: 3 })
    const wrapper = shallowMount(BookMetadataFetchWidget)

    await wrapper.get('button[aria-label="Dismiss author enrichment status"]').trigger('click')
    bookStatus.value = idleBookStatus({ failed: 3, latestFailureAt: '2026-08-05T10:00:00.000Z' })
    await nextTick()

    expect(wrapper.text()).toContain('Metadata fetch finished')
  })
})
