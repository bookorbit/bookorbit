import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BookCoverCard from '../BookCoverCard.vue'
import type { BookCard } from '@bookorbit/types'
import { nextTick, ref } from 'vue'
import { COVER_ASPECT_RATIO_KEY } from '@/features/book/lib/cover-aspect-ratio'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, useRoute: () => ({ fullPath: '/' }), useRouter: () => ({ push: vi.fn<(...args: unknown[]) => unknown>() }) }
})
vi.mock('@/features/author/api/author', () => ({
  fetchAuthors: vi.fn<(...args: unknown[]) => unknown>(),
}))
vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({ coverUrl: () => '/cover.jpg', bumpVersion: vi.fn<(...args: unknown[]) => void>() }),
}))
vi.mock('@/features/book/lib/book-cover', () => ({
  bookCoverStyle: () => ({ background: 'oklch(0.22 0.07 200)', color: 'oklch(0.92 0.03 200)' }),
  bookCoverPalette: () => ({
    gradient: 'linear-gradient(150deg, oklch(0.22 0.07 200) 0%, oklch(0.28 0.05 220) 100%)',
    from: 'oklch(0.22 0.07 200)',
    to: 'oklch(0.28 0.05 220)',
    color: 'oklch(0.99 0.025 200)',
    accent: 'oklch(0.82 0.16 200)',
    textMuted: 'oklch(0.92 0.08 200)',
  }),
  titleFontSizeClass: () => 'text-[11cqi]',
}))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => false }),
}))

// Stub complex UI sub-components
const globalStubs = {
  stubs: {
    DropdownMenu: { template: '<div><slot /></div>' },
    DropdownMenuContent: { template: '<div><slot /></div>' },
    DropdownMenuItem: { template: '<div><slot /></div>' },
    DropdownMenuTrigger: { template: '<div><slot /></div>' },
    DropdownMenuSeparator: { template: '<div data-test="dropdown-separator" />' },
    DropdownMenuSub: { template: '<div><slot /></div>' },
    DropdownMenuSubTrigger: { template: '<div><slot /></div>' },
    DropdownMenuSubContent: { template: '<div><slot /></div>' },
    Tooltip: { template: '<div><slot /></div>' },
    TooltipTrigger: { template: '<div><slot /></div>' },
    TooltipContent: { template: '<div data-testid="tooltip-content"><slot /></div>' },
  },
}

function mountCard(book: BookCard, coverAspectRatio: '2/3' | '1/1' = '2/3') {
  return mount(BookCoverCard, {
    props: { book },
    global: {
      ...globalStubs,
      provide: {
        [COVER_ASPECT_RATIO_KEY as symbol]: ref(coverAspectRatio),
      },
    },
  })
}

const { cardOverlays, bookSpineOverlay, bookShadowStrength, gridCardPrimaryLabel, gridCardSecondaryLabel, cardInfoMode } = useDisplaySettings()

afterEach(() => {
  cardOverlays.value = ['progress-bar', 'format', 'rating', 'read-status']
  bookSpineOverlay.value = 'off'
  bookShadowStrength.value = 'default'
  gridCardPrimaryLabel.value = 'hidden'
  gridCardSecondaryLabel.value = 'hidden'
  cardInfoMode.value = 'hover-overlay'
})

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
  addedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: null,
  metadataScore: null,
  hasCover: false,
  hasMetadataLocks: false,
  lockedFields: [],
  subtitle: null,
  publisher: null,
  pageCount: null,
  isbn13: null,
  narrators: [],
}

const presentBook: BookCard = {
  id: 2,
  status: 'present',
  title: 'Available Book',
  authors: ['Test Author'],
  seriesName: null,
  seriesIndex: null,
  files: [{ id: 10, format: 'epub', role: 'primary', sizeBytes: null }],
  publishedYear: 2024,
  language: 'en',
  genres: [],
  tags: [],
  rating: null,
  readingProgress: null,
  readStatus: null,
  addedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: null,
  metadataScore: null,
  hasCover: false,
  hasMetadataLocks: false,
  lockedFields: [],
  subtitle: null,
  publisher: null,
  pageCount: null,
  isbn13: null,
  narrators: [],
}

const presentBookWithCover: BookCard = {
  ...presentBook,
  id: 3,
  hasCover: true,
}

describe('BookCoverCard — missing state', () => {
  it('renders an amber inset ring overlay when missing', () => {
    const wrapper = mountCard(missingBook)
    const ringOverlay = wrapper.find('.ring-amber-500')
    expect(ringOverlay.exists()).toBe(true)
    expect(ringOverlay.classes()).toContain('ring-2')
    expect(ringOverlay.classes()).toContain('ring-inset')
  })

  it('does not apply hover-scale to the cover container', () => {
    const wrapper = mountCard(missingBook)
    const coverDiv = wrapper.find('[style*="aspect-ratio"]')
    const classes = coverDiv.classes().join(' ')
    expect(classes).not.toContain('group-hover:scale-[1.02]')
  })

  it('renders the amber missing badge with TriangleAlert icon', () => {
    const wrapper = mountCard(missingBook)
    const badge = wrapper.find('[class*="bg-amber-600"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text().toLowerCase()).toContain('missing')
  })

  it('uses cursor-default on the root when book is missing', () => {
    const wrapper = mountCard(missingBook)
    const root = wrapper.find('div')
    expect(root.classes()).toContain('cursor-default')
  })
})

describe('BookCoverCard — present state', () => {
  it('does not apply grayscale to the cover container', () => {
    const wrapper = mountCard(presentBook)
    const coverDiv = wrapper.find('[style*="aspect-ratio"]')
    expect(coverDiv.classes()).not.toContain('grayscale')
  })

  it('does not render the missing badge', () => {
    const wrapper = mountCard(presentBook)
    expect(wrapper.find('[class*="bg-amber-600"]').exists()).toBe(false)
  })

  it('applies hover-scale to cover container when present', () => {
    const wrapper = mountCard(presentBook)
    const coverDiv = wrapper.find('[style*="aspect-ratio"]')
    const classes = coverDiv.classes().join(' ')
    expect(classes).toContain('group-hover:scale-[1.02]')
  })

  it('clamps fallback title to 2 lines for 2/3 covers and keeps author to one line', () => {
    const wrapper = mountCard(presentBook, '2/3')
    const fallbackTitle = wrapper.find('[class*="bg-linear-to-t"] p')
    const fallbackAuthor = wrapper.find('[class*="bg-linear-to-t"] button')
    expect(fallbackTitle.exists()).toBe(false)
    expect(fallbackAuthor.exists()).toBe(false)
  })

  it('clamps fallback title to 1 line for 1/1 covers and keeps author to one line', () => {
    const wrapper = mountCard(presentBook, '1/1')
    const fallbackTitle = wrapper.find('[class*="bg-linear-to-t"] p')
    const fallbackAuthor = wrapper.find('[class*="bg-linear-to-t"] button')
    expect(fallbackTitle.exists()).toBe(false)
    expect(fallbackAuthor.exists()).toBe(false)
  })

  it('anchors the kebab menu button to the lower-right corner', () => {
    const wrapper = mountCard(presentBook)
    expect(wrapper.find('div.absolute.bottom-2.right-2.z-20').exists()).toBe(true)
  })

  it('does not render a trailing separator when no post-status actions are visible', () => {
    const wrapper = mountCard(presentBook)
    expect(wrapper.text()).toContain('Set Status')
    expect(wrapper.text()).not.toContain('Send via Email')
    expect(wrapper.text()).not.toContain('Delete')
    expect(wrapper.findAll('[data-test="dropdown-separator"]')).toHaveLength(0)
  })

  it('renders an orange lock pill when lock-status overlay is enabled and metadata is locked', () => {
    cardOverlays.value = ['lock-status']

    const wrapper = mountCard({ ...presentBook, hasMetadataLocks: true })

    expect(wrapper.find('.text-amber-400').exists()).toBe(true)
    expect(wrapper.find('.text-emerald-400').exists()).toBe(false)
  })

  it('renders a green unlock pill when lock-status overlay is enabled and metadata is unlocked', () => {
    cardOverlays.value = ['lock-status']

    const wrapper = mountCard(presentBook)

    expect(wrapper.find('.text-emerald-400').exists()).toBe(true)
    expect(wrapper.find('.text-amber-400').exists()).toBe(false)
  })
})

describe('BookCoverCard — cover style preferences', () => {
  it('applies the reusable cover surface class to the main cover container', () => {
    const wrapper = mountCard(presentBook)
    const coverDiv = wrapper.find('[style*="aspect-ratio"]')
    expect(coverDiv.classes()).toContain('book-cover-surface')
  })

  it('applies the selected spine overlay mode to the cover surface', async () => {
    const wrapper = mountCard(presentBook)
    bookSpineOverlay.value = 'strong'
    await nextTick()
    const coverDiv = wrapper.find('[style*="aspect-ratio"]')
    expect(coverDiv.attributes('data-cover-spine')).toBe('strong')
  })

  it('applies the selected shadow strength mode to the cover surface', async () => {
    const wrapper = mountCard(presentBook)
    bookShadowStrength.value = 'strong'
    await nextTick()
    const coverDiv = wrapper.find('[style*="aspect-ratio"]')
    expect(coverDiv.attributes('data-cover-shadow')).toBe('strong')
  })

  it('forces spine overlay off for audiobooks even when global spine mode is enabled', async () => {
    const wrapper = mountCard({
      ...presentBook,
      files: [{ id: 12, format: 'm4b', role: 'primary', sizeBytes: null }],
    })
    bookSpineOverlay.value = 'strong'
    await nextTick()

    const coverDiv = wrapper.find('[style*="aspect-ratio"]')
    expect(coverDiv.attributes('data-cover-spine')).toBe('off')
  })
})

describe('BookCoverCard — placeholder state', () => {
  it('shows BookCoverPlaceholder when hasCover is false', () => {
    const wrapper = mountCard(presentBook)
    expect(wrapper.findComponent({ name: 'BookCoverPlaceholder' }).exists()).toBe(true)
  })

  it('does not render cover img when hasCover is false', () => {
    const wrapper = mountCard(presentBook)
    const imgs = wrapper.findAll('img')
    expect(imgs).toHaveLength(0)
  })

  it('does not show BookCoverPlaceholder when hasCover is true', () => {
    const wrapper = mountCard(presentBookWithCover)
    expect(wrapper.findComponent({ name: 'BookCoverPlaceholder' }).exists()).toBe(false)
  })

  it('renders cover img when hasCover is true', () => {
    const wrapper = mountCard(presentBookWithCover)
    const imgs = wrapper.findAll('img')
    expect(imgs.length).toBeGreaterThan(0)
  })
})

describe('BookCoverCard — series position overlay', () => {
  const bookWithSeries: BookCard = {
    ...presentBook,
    seriesName: 'The Expanse',
    seriesIndex: 3,
  }

  afterEach(() => {
    cardOverlays.value = ['progress-bar', 'format', 'rating', 'read-status']
  })

  it('renders the series badge when overlay is enabled and seriesIndex is set', () => {
    cardOverlays.value = ['series-position']
    const wrapper = mountCard(bookWithSeries)
    expect(wrapper.text()).toContain('#3')
  })

  it('marks the series badge as a card click blocker and disables hit-testing on hover', () => {
    cardOverlays.value = ['series-position']
    const wrapper = mountCard(bookWithSeries)
    const badge = wrapper.find('[data-card-click-blocker]')
    expect(badge.exists()).toBe(true)
    expect(badge.classes()).toContain('group-hover:pointer-events-none')
  })

  it('does not render the badge when series-position is not in overlays', () => {
    cardOverlays.value = []
    const wrapper = mountCard(bookWithSeries)
    expect(wrapper.text()).not.toContain('#3')
  })

  it('does not render badge when seriesIndex is null', () => {
    cardOverlays.value = ['series-position']
    const wrapper = mountCard({ ...presentBook, seriesIndex: null, seriesName: 'Dune' })
    expect(wrapper.text()).not.toContain('#')
  })

  it('formats whole-number float 3.0 as #3 (no trailing decimal)', () => {
    cardOverlays.value = ['series-position']
    const wrapper = mountCard({ ...presentBook, seriesIndex: 3.0, seriesName: 'Dune' })
    expect(wrapper.text()).toContain('#3')
    expect(wrapper.text()).not.toContain('#3.0')
  })

  it('formats fractional index 1.5 as #1.5', () => {
    cardOverlays.value = ['series-position']
    const wrapper = mountCard({ ...presentBook, seriesIndex: 1.5, seriesName: 'Dune' })
    expect(wrapper.text()).toContain('#1.5')
  })

  it('tooltip content shows series name combined with number', () => {
    cardOverlays.value = ['series-position']
    const wrapper = mountCard(bookWithSeries)
    const tooltip = wrapper.find('[data-testid="tooltip-content"]')
    expect(tooltip.exists()).toBe(true)
    expect(tooltip.text()).toContain('The Expanse #3')
  })

  it('tooltip shows only number when seriesName is null', () => {
    cardOverlays.value = ['series-position']
    const wrapper = mountCard({ ...presentBook, seriesIndex: 5, seriesName: null })
    const tooltip = wrapper.find('[data-testid="tooltip-content"]')
    expect(tooltip.exists()).toBe(true)
    expect(tooltip.text()).toBe('#5')
  })

  it('lock and series badges coexist in the top-right container', () => {
    cardOverlays.value = ['series-position', 'lock-status']
    const wrapper = mountCard({ ...presentBook, seriesIndex: 2, seriesName: 'Dune', hasMetadataLocks: true })
    expect(wrapper.text()).toContain('#2')
    expect(wrapper.find('.text-amber-400').exists()).toBe(true)
  })
})

describe('BookCoverCard — grid card labels', () => {
  const bookWithMeta: BookCard = {
    ...presentBook,
    title: 'Dune',
    authors: ['Frank Herbert'],
    seriesName: 'Dune Chronicles',
    seriesIndex: 1,
  }

  afterEach(() => {
    gridCardPrimaryLabel.value = 'hidden'
    gridCardSecondaryLabel.value = 'hidden'
    cardInfoMode.value = 'hover-overlay'
  })

  function mountWithLabel(book: BookCard = bookWithMeta) {
    cardInfoMode.value = 'below-cover'
    return mount(BookCoverCard, {
      props: { book, showLabel: true },
      global: {
        ...globalStubs,
        provide: { [COVER_ASPECT_RATIO_KEY as symbol]: ref('2/3') },
      },
    })
  }

  it('does not render label area when cardInfoMode is hover-overlay', () => {
    gridCardPrimaryLabel.value = 'book-title'
    cardInfoMode.value = 'hover-overlay'
    const wrapper = mountCard(bookWithMeta)
    expect(wrapper.find('[data-testid="grid-card-label"]').exists()).toBe(false)
  })

  it('does not render label text elements when both fields are hidden in below-cover mode', () => {
    gridCardPrimaryLabel.value = 'hidden'
    gridCardSecondaryLabel.value = 'hidden'
    const wrapper = mountWithLabel()
    expect(wrapper.find('[data-testid="grid-card-label-primary"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="grid-card-label-secondary"]').exists()).toBe(false)
  })

  it('renders primary label with book title', () => {
    gridCardPrimaryLabel.value = 'book-title'
    const wrapper = mountWithLabel()
    const label = wrapper.find('[data-testid="grid-card-label-primary"]')
    expect(label.exists()).toBe(true)
    expect(label.text()).toBe('Dune')
  })

  it('renders primary label with series title', () => {
    gridCardPrimaryLabel.value = 'series-title'
    const wrapper = mountWithLabel()
    const label = wrapper.find('[data-testid="grid-card-label-primary"]')
    expect(label.exists()).toBe(true)
    expect(label.text()).toBe('Dune Chronicles')
  })

  it('renders primary label with series title and position', () => {
    gridCardPrimaryLabel.value = 'series-title-position'
    const wrapper = mountWithLabel()
    const label = wrapper.find('[data-testid="grid-card-label-primary"]')
    expect(label.exists()).toBe(true)
    expect(label.text()).toBe('Dune Chronicles #1')
  })

  it('renders primary label with author', () => {
    gridCardPrimaryLabel.value = 'author'
    const wrapper = mountWithLabel()
    const label = wrapper.find('[data-testid="grid-card-label-primary"]')
    expect(label.exists()).toBe(true)
    expect(label.text()).toBe('Frank Herbert')
  })

  it('hides primary label line when field resolves to null (missing series)', () => {
    gridCardPrimaryLabel.value = 'series-title'
    cardInfoMode.value = 'below-cover'
    const wrapper = mount(BookCoverCard, {
      props: { book: { ...presentBook, title: 'Standalone', seriesName: null }, showLabel: true },
      global: { ...globalStubs, provide: { [COVER_ASPECT_RATIO_KEY as symbol]: ref('2/3') } },
    })
    expect(wrapper.find('[data-testid="grid-card-label-primary"]').exists()).toBe(false)
  })

  it('renders secondary label alongside primary', () => {
    gridCardPrimaryLabel.value = 'book-title'
    gridCardSecondaryLabel.value = 'author'
    const wrapper = mountWithLabel()
    expect(wrapper.find('[data-testid="grid-card-label-primary"]').text()).toBe('Dune')
    expect(wrapper.find('[data-testid="grid-card-label-secondary"]').text()).toBe('Frank Herbert')
  })

  it('formats series-title-position with fractional index', () => {
    gridCardPrimaryLabel.value = 'series-title-position'
    cardInfoMode.value = 'below-cover'
    const wrapper = mount(BookCoverCard, {
      props: { book: { ...bookWithMeta, seriesIndex: 1.5 }, showLabel: true },
      global: { ...globalStubs, provide: { [COVER_ASPECT_RATIO_KEY as symbol]: ref('2/3') } },
    })
    expect(wrapper.find('[data-testid="grid-card-label-primary"]').text()).toBe('Dune Chronicles #1.5')
  })
})
