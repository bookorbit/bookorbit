import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import BookListRow from '../BookListRow.vue'
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

const globalStubs = {
  stubs: {
    DropdownMenu: { template: '<div><slot /></div>' },
    DropdownMenuContent: { template: '<div><slot /></div>' },
    DropdownMenuItem: { template: '<div><slot /></div>' },
    DropdownMenuTrigger: { template: '<div><slot /></div>' },
    DropdownMenuSeparator: { template: '<div />' },
    Tooltip: { template: '<div><slot /></div>' },
    TooltipTrigger: { template: '<div><slot /></div>' },
    TooltipContent: { template: '<div><slot /></div>' },
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
  metadataScore: null,
  addedAt: '2026-01-01T00:00:00.000Z',
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
  genres: ['Fiction'],
  tags: [],
  rating: null,
  readingProgress: null,
  metadataScore: null,
  addedAt: '2026-01-01T00:00:00.000Z',
}

describe('BookListRow — missing state', () => {
  it('applies grayscale and opacity-60 to the root row', () => {
    const wrapper = mount(BookListRow, { props: { book: missingBook }, global: globalStubs })
    const root = wrapper.find('.flex.items-center')
    expect(root.classes()).toContain('grayscale')
    expect(root.classes()).toContain('opacity-60')
  })

  it('renders the amber missing badge', () => {
    const wrapper = mount(BookListRow, { props: { book: missingBook }, global: globalStubs })
    const badge = wrapper.find('[class*="bg-amber-500"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text().toLowerCase()).toContain('missing')
  })

  it('does not apply hover:bg-muted on the row when missing', () => {
    const wrapper = mount(BookListRow, { props: { book: missingBook }, global: globalStubs })
    const root = wrapper.find('.flex.items-center')
    expect(root.classes().join(' ')).not.toContain('hover:bg-muted')
  })
})

describe('BookListRow — present state', () => {
  it('does not apply grayscale to the root row', () => {
    const wrapper = mount(BookListRow, { props: { book: presentBook }, global: globalStubs })
    const root = wrapper.find('.flex.items-center')
    expect(root.classes()).not.toContain('grayscale')
  })

  it('does not render the missing badge', () => {
    const wrapper = mount(BookListRow, { props: { book: presentBook }, global: globalStubs })
    expect(wrapper.find('[class*="bg-amber-500"]').exists()).toBe(false)
  })

  it('applies hover:bg-muted/50 when present with a readable file', () => {
    const wrapper = mount(BookListRow, { props: { book: presentBook }, global: globalStubs })
    const root = wrapper.find('.flex.items-center')
    expect(root.classes().join(' ')).toContain('hover:bg-muted')
  })
})
