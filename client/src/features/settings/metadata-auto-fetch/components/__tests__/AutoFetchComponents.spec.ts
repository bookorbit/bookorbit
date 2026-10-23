import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookMetadataFetchConditions, BookMetadataFetchPreviewBook, BookMetadataFetchStatusEvent } from '@bookorbit/types'
import AutoFetchConditionColumns from '../AutoFetchConditionColumns.vue'
import AutoFetchPreviewList from '../AutoFetchPreviewList.vue'
import AutoFetchQueueBand from '../AutoFetchQueueBand.vue'
import AutoFetchScoreHistogram from '../AutoFetchScoreHistogram.vue'

const status = vi.hoisted(() => ({ value: null as unknown }))
const actions = vi.hoisted(() => ({
  pause: vi.fn<() => Promise<void>>(),
  resume: vi.fn<() => Promise<void>>(),
  cancelPending: vi.fn<() => Promise<void>>(),
  retryFailed: vi.fn<() => Promise<unknown>>(),
}))

vi.mock('@/features/book-metadata-fetch/composables/useBookMetadataFetchStatus', () => ({
  useBookMetadataFetchStatus: () => ({ status: status.value, subscribe: vi.fn<() => void>() }),
}))
vi.mock('@/features/book-metadata-fetch/composables/useBookMetadataFetchActions', () => ({ useBookMetadataFetchActions: () => actions }))
vi.mock('@/features/book-metadata-fetch/components/BookMetadataFetchReportModal.vue', () => ({
  default: { template: '<div data-testid="report" />' },
}))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() } }))

const conditions: BookMetadataFetchConditions = {
  neverFetched: { enabled: true },
  scoreThreshold: { enabled: true, threshold: 60 },
  missingFields: { enabled: true, fields: ['description'] },
}

function idle(overrides: Partial<BookMetadataFetchStatusEvent> = {}): BookMetadataFetchStatusEvent {
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

describe('AutoFetchScoreHistogram', () => {
  it('moves the line with the keyboard and states the value for assistive technology', async () => {
    const wrapper = mount(AutoFetchScoreHistogram, { props: { bins: Array.from({ length: 20 }, () => 2), threshold: 60 } })
    const slider = wrapper.get('[role="slider"]')
    expect(slider.attributes('aria-valuetext')).toBe('Score below 60')

    await slider.trigger('keydown', { key: 'ArrowRight' })
    await slider.trigger('keydown', { key: 'PageDown' })
    await slider.trigger('keydown', { key: 'End' })
    await slider.trigger('keydown', { key: 'Home' })
    await slider.trigger('keydown', { key: 'a' })

    expect(wrapper.emitted('update:threshold')).toEqual([[61], [50], [100], [0]])
  })

  it('fills each bar up to the line', () => {
    const wrapper = mount(AutoFetchScoreHistogram, { props: { bins: Array.from({ length: 20 }, () => 4), threshold: 62 } })
    const fills = wrapper.findAll('[role="slider"] span.bg-primary').map((fill) => (fill.element as HTMLElement).style.height)
    expect(fills[11]).toBe('100%')
    expect(fills[12]).toBe('40%')
    expect(fills[13]).toBe('0%')
  })
})

describe('AutoFetchConditionColumns', () => {
  it('adds a picked field to the rule and starts an empty field list from the global picks', async () => {
    const wrapper = mount(AutoFetchConditionColumns, { props: { conditions, breakdown: null } })
    await wrapper.get('[data-field="genres"]').trigger('click')
    expect(wrapper.emitted('set')![0]).toEqual(['missingFields', { enabled: true, fields: ['description', 'genres'] }])

    const off: BookMetadataFetchConditions = { ...conditions, missingFields: { enabled: false, fields: [] } }
    const library = mount(AutoFetchConditionColumns, {
      props: { conditions: off, breakdown: null, globalConditions: conditions, ownKeys: ['missingFields'] },
    })
    await library.get('[data-condition="missingFields"] [role="switch"]').trigger('click')
    expect(library.emitted('set')![0]).toEqual(['missingFields', { enabled: true, fields: ['description'] }])
    await library.get('[data-condition="missingFields"] button[data-key="missingFields"]').trigger('click')
    expect(library.emitted('followGlobal')![0]).toEqual(['missingFields'])
  })
})

describe('AutoFetchPreviewList', () => {
  const book: BookMetadataFetchPreviewBook = {
    bookId: 9,
    libraryId: 6,
    title: 'Arkham Asylum',
    author: null,
    metadataScore: 26,
    neverFetched: true,
    missingFields: ['description', 'cover', 'seriesName'],
    hasCover: true,
    coverAspectRatio: '2/3',
    coverVersion: 'ebook:1',
  }

  it('shows at most three reasons, coloured by kind, and names the library on the global tab', () => {
    const wrapper = mount(AutoFetchPreviewList, {
      props: { items: [book], matching: 10, total: 10, conditions, libraryNames: new Map([[6, 'Comics']]) },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const reasons = wrapper
      .findAll('li span.rounded-\\[5px\\]')
      .map((reason) => [reason.text(), reason.classes().find((name) => /^text-(?!\[)/.test(name))])
    expect(reasons).toEqual([
      ['Never fetched', 'text-foreground'],
      ['Score 26', 'text-destructive'],
      ['No description', 'text-primary'],
    ])
    expect(wrapper.text()).toContain('+2')
    expect(wrapper.text()).toContain('Unknown author · Comics')
    expect(wrapper.text()).toContain('10 of 10 books match')
  })

  it('says so when no book matches', () => {
    const wrapper = mount(AutoFetchPreviewList, { props: { items: [], matching: 0, total: 10, conditions } })
    expect(wrapper.text()).toContain('No book matches this rule, so a run would queue nothing.')
  })
})

describe('AutoFetchQueueBand', () => {
  beforeEach(() => {
    Object.values(actions).forEach((action) => action.mockReset().mockResolvedValue(undefined))
  })

  it('stays hidden while nothing is queued or failed', () => {
    status.value = ref(idle())
    expect(mount(AutoFetchQueueBand).find('[data-testid="auto-fetch-queue"]').exists()).toBe(false)
  })

  it('shows progress with the book in hand, and asks before cancelling the queue', async () => {
    status.value = ref(idle({ queued: 300, processing: 1, sessionTotal: 466, sessionDone: 165, currentItemName: 'Hex' }))
    const wrapper = mount(AutoFetchQueueBand)
    expect(wrapper.text()).toContain('Fetching metadata')
    expect(wrapper.text()).toContain('165 of 466')
    expect(wrapper.text()).toContain('Hex')

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Cancel queued')!
      .trigger('click')
    expect(actions.cancelPending).not.toHaveBeenCalled()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Confirm cancel')!
      .trigger('click')
    await flushPromises()
    expect(actions.cancelPending).toHaveBeenCalledOnce()
  })

  it('offers resume while paused and retry once only failures are left', async () => {
    status.value = ref(idle({ queued: 4, paused: true, sessionTotal: 10, sessionDone: 6 }))
    const paused = mount(AutoFetchQueueBand)
    await paused
      .findAll('button')
      .find((button) => button.text() === 'Resume')!
      .trigger('click')
    expect(actions.resume).toHaveBeenCalledOnce()

    status.value = ref(idle({ failed: 3 }))
    const failed = mount(AutoFetchQueueBand)
    expect(failed.text()).toContain('3 books could not be fetched')
    await failed
      .findAll('button')
      .find((button) => button.text() === 'Retry all failed')!
      .trigger('click')
    await flushPromises()
    expect(actions.retryFailed).toHaveBeenCalledOnce()
    await failed
      .findAll('button')
      .find((button) => button.text() === 'View 3 failed')!
      .trigger('click')
    expect(failed.find('[data-testid="report"]').exists()).toBe(true)
  })
})
