import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import BookCoverCard from '../BookCoverCard.vue'
import type { BookCard } from '@projectx/types'

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, useRouter: () => ({ push: vi.fn<(...args: unknown[]) => unknown>() }) }
})
vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({ coverUrl: () => '/cover.jpg', bumpVersion: vi.fn<(...args: unknown[]) => void>() }),
}))
vi.mock('@/features/book/lib/book-cover', () => ({
  bookCoverStyle: () => ({ background: 'oklch(0.22 0.07 200)', color: 'oklch(0.92 0.03 200)' }),
}))

// Stub complex UI sub-components
const globalStubs = {
  stubs: {
    DropdownMenu: { template: '<div><slot /></div>' },
    DropdownMenuContent: { template: '<div><slot /></div>' },
    DropdownMenuItem: { template: '<div><slot /></div>' },
    DropdownMenuTrigger: { template: '<div><slot /></div>' },
    DropdownMenuSeparator: { template: '<div />' },
    DropdownMenuSub: { template: '<div><slot /></div>' },
    DropdownMenuSubTrigger: { template: '<div><slot /></div>' },
    DropdownMenuSubContent: { template: '<div><slot /></div>' },
  },
}

const missingBook: BookCard = {
  id: 1,
  status: 'missing',
  title: 'Gone Book',
  authors: ['Test Author'],
  seriesName: null,
  seriesIndex: null,
  files: [],
  publishedYear: null,
  language: null,
  genres: [],
  tags: [],
  rating: null,
  readingProgress: null,
  readStatus: null,
  metadataScore: null,
  addedAt: '2026-01-01T00:00:00.000Z',
  durationSeconds: null,
}

const presentBook: BookCard = {
  id: 2,
  status: 'present',
  title: 'Available Book',
  authors: ['Test Author'],
  seriesName: null,
  seriesIndex: null,
  files: [{ id: 10, format: 'epub', role: 'primary' }],
  publishedYear: 2024,
  language: 'en',
  genres: [],
  tags: [],
  rating: null,
  readingProgress: null,
  readStatus: null,
  metadataScore: null,
  addedAt: '2026-01-01T00:00:00.000Z',
  durationSeconds: null,
}

describe('BookCoverCard — missing state', () => {
  it('renders an amber inset ring overlay when missing', () => {
    const wrapper = mount(BookCoverCard, { props: { book: missingBook }, global: globalStubs })
    const ringOverlay = wrapper.find('.ring-amber-500')
    expect(ringOverlay.exists()).toBe(true)
    expect(ringOverlay.classes()).toContain('ring-2')
    expect(ringOverlay.classes()).toContain('ring-inset')
  })

  it('does not apply hover-scale to the cover container', () => {
    const wrapper = mount(BookCoverCard, { props: { book: missingBook }, global: globalStubs })
    const coverDiv = wrapper.find('[style*="aspect-ratio"]')
    const classes = coverDiv.classes().join(' ')
    expect(classes).not.toContain('group-hover:scale-[1.02]')
  })

  it('renders the amber missing badge with TriangleAlert icon', () => {
    const wrapper = mount(BookCoverCard, { props: { book: missingBook }, global: globalStubs })
    const badge = wrapper.find('[class*="bg-amber-600"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text().toLowerCase()).toContain('missing')
  })

  it('uses cursor-default on the root when book is missing', () => {
    const wrapper = mount(BookCoverCard, { props: { book: missingBook }, global: globalStubs })
    const root = wrapper.find('div.group')
    expect(root.classes()).toContain('cursor-default')
  })
})

describe('BookCoverCard — present state', () => {
  it('does not apply grayscale to the cover container', () => {
    const wrapper = mount(BookCoverCard, { props: { book: presentBook }, global: globalStubs })
    const coverDiv = wrapper.find('[style*="aspect-ratio"]')
    expect(coverDiv.classes()).not.toContain('grayscale')
  })

  it('does not render the missing badge', () => {
    const wrapper = mount(BookCoverCard, { props: { book: presentBook }, global: globalStubs })
    expect(wrapper.find('[class*="bg-amber-600"]').exists()).toBe(false)
  })

  it('applies hover-scale to cover container when present', () => {
    const wrapper = mount(BookCoverCard, { props: { book: presentBook }, global: globalStubs })
    const coverDiv = wrapper.find('[style*="aspect-ratio"]')
    const classes = coverDiv.classes().join(' ')
    expect(classes).toContain('group-hover:scale-[1.02]')
  })
})
