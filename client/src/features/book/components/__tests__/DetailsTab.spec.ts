import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import DetailsTab from '../detail/tabs/DetailsTab.vue'
import type { BookDetail } from '@projectx/types'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({ coverUrl: () => '/cover.jpg', bumpVersion: vi.fn() }),
}))
vi.mock('@/features/book/lib/book-cover', () => ({
  bookCoverStyle: () => ({ background: 'oklch(0.22 0.07 200)', color: 'oklch(0.92 0.03 200)' }),
}))

const globalStubs = {
  stubs: {
    DialogRoot: { template: '<div><slot /></div>' },
    DialogPortal: { template: '<div><slot /></div>' },
    DialogOverlay: { template: '<div />' },
    DialogContent: { template: '<div><slot /></div>' },
    DialogClose: { template: '<button><slot /></button>' },
  },
}

function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 1,
    libraryId: 1,
    status: 'present',
    title: 'Test Book',
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    authors: [],
    tags: [],
    files: [],
    ...overrides,
  }
}

describe('DetailsTab — missing state', () => {
  it('renders the amber warning banner', () => {
    const wrapper = mount(DetailsTab, {
      props: { book: makeBook({ status: 'missing' }) },
      global: globalStubs,
    })
    const banner = wrapper.find('[class*="border-amber-500"]')
    expect(banner.exists()).toBe(true)
  })

  it('shows "Files not found" heading in the banner', () => {
    const wrapper = mount(DetailsTab, {
      props: { book: makeBook({ status: 'missing' }) },
      global: globalStubs,
    })
    expect(wrapper.text()).toContain('Files not found')
  })

  it('mentions disk in the banner description', () => {
    const wrapper = mount(DetailsTab, {
      props: { book: makeBook({ status: 'missing' }) },
      global: globalStubs,
    })
    expect(wrapper.text().toLowerCase()).toContain('disk')
  })
})

describe('DetailsTab — present state', () => {
  it('does not render the warning banner', () => {
    const wrapper = mount(DetailsTab, {
      props: { book: makeBook({ status: 'present' }) },
      global: globalStubs,
    })
    expect(wrapper.find('[class*="border-amber-500"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Files not found')
  })
})
