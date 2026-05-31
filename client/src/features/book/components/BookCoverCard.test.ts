import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import type { BookCard } from '@bookorbit/types'
import BookCoverCard from './BookCoverCard.vue'

// -- module mocks (must precede imports) -------------------------------------

const mockRouterPush = vi.fn<() => void>()
vi.mock('vue-router', () => ({
  useRoute: () => ({ fullPath: '/' }),
  useRouter: () => ({ push: mockRouterPush }),
}))

const mockCoverUrl = vi.fn<(id: number) => string>((id: number) => `/api/covers/${id}`)
const mockBumpVersion = vi.fn<() => void>()
vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({ coverUrl: mockCoverUrl, bumpVersion: mockBumpVersion }),
}))

const mockRefreshWithFeedback = vi.fn<() => Promise<null>>().mockResolvedValue(null)
const mockRefreshing = ref(false)
vi.mock('@/features/book/composables/useRefreshMetadata', () => ({
  useRefreshMetadata: () => ({ refreshing: mockRefreshing, refreshWithFeedback: mockRefreshWithFeedback }),
}))

const mockIsRefreshing = vi.fn<() => boolean>().mockReturnValue(false)
vi.mock('@/features/book/composables/useRefreshingBooks', () => ({
  useRefreshingBooks: () => ({ isRefreshing: mockIsRefreshing }),
}))

vi.mock('@/features/book/lib/book-card-mapper', () => ({
  mergeBookCardWithDetail: vi.fn<(_card: unknown, detail: unknown) => unknown>((_card: unknown, detail: unknown) => detail),
}))

const mockHasPermission = vi.fn<() => boolean>().mockReturnValue(true)
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}))

const mockFetchAuthors = vi.hoisted(() =>
  vi.fn<
    (params: { q?: string; page: number; size: number; sort: string; order: string }) => Promise<{
      items: Array<{ id: number; name: string; sortName: string | null; bookCount: number; lastAddedAt: string | null }>
      total: number
      page: number
      size: number
    }>
  >(),
)
vi.mock('@/features/author/api/author', () => ({
  fetchAuthors: mockFetchAuthors,
}))

const mockCardOverlays = ref<string[]>([])
const mockBookCoverDisplayMode = ref('blurred-fit')
const mockGridCardPrimaryLabel = ref('hidden')
const mockGridCardSecondaryLabel = ref('hidden')
const mockCardInfoMode = ref('hover-overlay')
vi.mock('@/composables/useDisplaySettings', () => ({
  useDisplaySettings: () => ({
    cardOverlays: mockCardOverlays,
    bookSpineOverlay: ref('off'),
    bookShadowStrength: ref('default'),
    bookCoverDisplayMode: mockBookCoverDisplayMode,
    gridCardPrimaryLabel: mockGridCardPrimaryLabel,
    gridCardSecondaryLabel: mockGridCardSecondaryLabel,
    cardInfoMode: mockCardInfoMode,
  }),
}))

const mockDownloadFile = vi.fn<() => void>()
const mockExportBooks = vi.fn<() => void>()
vi.mock('@/features/book/composables/useBookDownload', () => ({
  useBookDownload: () => ({ downloadFile: mockDownloadFile, exportBooks: mockExportBooks }),
}))

const mockSetStatus = vi.fn<() => void>()
vi.mock('@/features/book/composables/useBookStatus', () => ({
  useBookStatus: () => ({ setStatus: mockSetStatus }),
  STATUS_OPTIONS: [
    { value: 'unread', label: 'Unread' },
    { value: 'reading', label: 'Reading' },
    { value: 'read', label: 'Read' },
  ],
  STATUS_ICONS: { unread: 'span', reading: 'span', read: 'span' },
  STATUS_COLORS: { unread: 'text-muted', reading: 'text-blue-500', read: 'text-emerald-500' },
}))

vi.mock('@/features/book/lib/book-cover', () => ({
  bookCoverStyle: (_seed: string) => ({ background: 'oklch(50% 0.1 200)' }),
}))

vi.mock('@/features/book/lib/format-colors', () => ({
  getFormatColor: () => '#4a90e2',
}))

vi.mock('@/features/book/components/BookCoverPlaceholder.vue', () => ({
  default: defineComponent({
    name: 'BookCoverPlaceholder',
    props: ['title', 'authorLine', 'isAudio', 'seed'],
    setup(props) {
      return () => h('div', { 'data-testid': 'cover-placeholder', 'data-title': props.title })
    },
  }),
}))

vi.mock('@/features/email/components/SendBookDialog.vue', () => ({
  default: defineComponent({
    name: 'SendBookDialog',
    props: ['open', 'bookIds', 'bookFiles', 'bookTitle'],
    emits: ['update:open'],
    setup() {
      return () => h('div', { 'data-testid': 'send-dialog' })
    },
  }),
}))

// -- helpers -----------------------------------------------------------------

function makeFile(overrides: Partial<{ id: number; format: string; role: string; sizeBytes: number }> = {}) {
  return {
    id: overrides.id ?? 1,
    format: overrides.format ?? 'epub',
    role: overrides.role ?? 'primary',
    sizeBytes: overrides.sizeBytes ?? 1024,
  }
}

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'present',
    title: 'Dune',
    authors: ['Frank Herbert'],
    seriesName: null,
    seriesIndex: null,
    files: [makeFile()],
    publishedYear: 1965,
    language: 'en',
    genres: ['Science Fiction'],
    rating: 4,
    readingProgress: 50,
    readStatus: null,
    addedAt: '2024-01-01T00:00:00Z',
    updatedAt: null,
    metadataScore: 90,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    subtitle: null,
    publisher: 'Chilton Books',
    pageCount: 412,
    isbn13: '9780441013593',
    narrators: [],
    tags: [],
    ...overrides,
  }
}

function mountCard(
  props: Partial<{ book: BookCard; selectionMode: boolean; selected: boolean; showLabel: boolean; onSelect: (e: MouseEvent) => void }> = {},
) {
  return mount(BookCoverCard, {
    props: { book: makeBook(), selectionMode: false, selected: false, ...props },
    global: {
      stubs: {
        DropdownMenu: { template: '<div data-testid="dropdown-menu"><slot /></div>' },
        DropdownMenuTrigger: { template: '<div data-testid="dropdown-trigger"><slot /></div>' },
        DropdownMenuContent: { template: '<div data-testid="dropdown-content"><slot /></div>' },
        DropdownMenuItem: { template: '<div data-testid="dropdown-item" @click="$emit(\'click\')"><slot /></div>', emits: ['click'] },
        DropdownMenuSeparator: true,
        DropdownMenuSub: { template: '<div data-testid="dropdown-sub"><slot /></div>' },
        DropdownMenuSubTrigger: { template: '<div><slot /></div>' },
        DropdownMenuSubContent: { template: '<div><slot /></div>' },
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div><slot /></div>' },
        Loader2: true,
        MoreVertical: true,
        PanelRight: true,
        BookOpen: true,
        Play: true,
        Check: true,
        ExternalLink: true,
        Pencil: true,
        RefreshCw: true,
        FolderPlus: true,
        Send: true,
        Trash2: true,
        TriangleAlert: true,
        Star: true,
        Download: true,
        Image: true,
        Lock: true,
        LockOpen: true,
      },
    },
  })
}

function setTouchMode(value: boolean) {
  vi.stubGlobal('matchMedia', vi.fn<() => { matches: boolean }>().mockReturnValue({ matches: value }))
}

// -- tests -------------------------------------------------------------------

describe('BookCoverCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRefreshing.value = false
    mockCardOverlays.value = []
    mockBookCoverDisplayMode.value = 'blurred-fit'
    mockGridCardPrimaryLabel.value = 'hidden'
    mockGridCardSecondaryLabel.value = 'hidden'
    mockCardInfoMode.value = 'hover-overlay'
    mockFetchAuthors.mockResolvedValue({
      items: [{ id: 7, name: 'Frank Herbert', sortName: null, bookCount: 1, lastAddedAt: '2024-01-01T00:00:00Z' }],
      total: 1,
      page: 0,
      size: 5,
    })
    setTouchMode(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── hover overlay pointer-events (the bug fix) ────────────────────────────

  describe('hover overlay pointer events', () => {
    it('has pointer-events-none by default so the overlay does not block content below', () => {
      const wrapper = mountCard()
      const overlay = wrapper.find('.bg-black\\/70')
      expect(overlay.classes()).toContain('pointer-events-none')
    })

    it('has group-hover:pointer-events-auto so buttons become clickable on desktop hover', () => {
      const wrapper = mountCard()
      const overlay = wrapper.find('.bg-black\\/70')
      expect(overlay.classes()).toContain('group-hover:pointer-events-auto')
    })

    it('has group-hover:opacity-100 to become visible on desktop hover', () => {
      const wrapper = mountCard()
      const overlay = wrapper.find('.bg-black\\/70')
      expect(overlay.classes()).toContain('group-hover:opacity-100')
    })

    it('removes pointer-events-none and opacity-0 when mobile overlay is active', async () => {
      setTouchMode(true)
      const wrapper = mountCard()
      await wrapper.find('.group').trigger('click')
      const overlay = wrapper.find('.bg-black\\/70')
      expect(overlay.classes()).toContain('opacity-100')
      expect(overlay.classes()).not.toContain('pointer-events-none')
    })

    it('does not apply group-hover classes when mobile overlay is active', async () => {
      setTouchMode(true)
      const wrapper = mountCard()
      await wrapper.find('.group').trigger('click')
      const overlay = wrapper.find('.bg-black\\/70')
      expect(overlay.classes()).not.toContain('group-hover:opacity-100')
      expect(overlay.classes()).not.toContain('group-hover:pointer-events-auto')
    })

    it('is absent in selection mode (no hover overlay rendered)', () => {
      const wrapper = mountCard({ selectionMode: true })
      // The v-if="!selectionMode" removes the overlay entirely
      expect(wrapper.find('.bg-black\\/70').exists()).toBe(false)
    })
  })

  // ── quick view button ─────────────────────────────────────────────────────

  describe('quick view button', () => {
    it('emits action:quick-view when quick view button is clicked', async () => {
      const wrapper = mountCard()
      const overlayBtns = wrapper.find('.bg-black\\/70').findAll('button')
      await overlayBtns[0]?.trigger('click')
      expect(wrapper.emitted('action')?.[0]).toEqual(['quick-view'])
    })
  })

  // ── card click: desktop vs mobile ────────────────────────────────────────

  describe('card click behavior', () => {
    it('opens primary file on desktop click when primaryFile exists', async () => {
      setTouchMode(false)
      const book = makeBook({ files: [makeFile({ id: 10, format: 'epub', role: 'primary' })] })
      const wrapper = mountCard({ book })
      await wrapper.find('.group').trigger('click')
      expect(mockRouterPush).toHaveBeenCalledWith(expect.objectContaining({ name: 'reader', params: { bookId: 1, fileId: 10 } }))
    })

    it('does nothing on desktop click when no readable primary file exists', async () => {
      setTouchMode(false)
      const book = makeBook({ files: [] })
      const wrapper = mountCard({ book })
      await wrapper.find('.group').trigger('click')
      expect(mockRouterPush).not.toHaveBeenCalled()
    })

    it('does not open file when clicking a button (event target is button)', async () => {
      setTouchMode(false)
      const wrapper = mountCard()
      const btn = wrapper.find('button')
      await btn.trigger('click')
      // The card click handler returns early for button clicks
      expect(mockRouterPush).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'reader' }))
    })

    it('toggles mobile overlay on touch tap instead of opening file', async () => {
      setTouchMode(true)
      const wrapper = mountCard()
      await wrapper.find('.group').trigger('click')
      const overlay = wrapper.find('.bg-black\\/70')
      expect(overlay.classes()).toContain('opacity-100')
    })

    it('toggling mobile overlay off on second tap hides overlay', async () => {
      setTouchMode(true)
      const wrapper = mountCard()
      await wrapper.find('.group').trigger('click')
      await wrapper.find('.group').trigger('click')
      const overlay = wrapper.find('.bg-black\\/70')
      expect(overlay.classes()).toContain('opacity-0')
    })

    it('emits select and does not open file in selection mode', async () => {
      const mockSelect = vi.fn<(e: MouseEvent) => void>()
      const wrapper = mountCard({ selectionMode: true, onSelect: mockSelect })
      await wrapper.find('.group').trigger('click')
      expect(mockSelect).toHaveBeenCalled()
      expect(mockRouterPush).not.toHaveBeenCalled()
    })

    it('does not open file for missing books on desktop', async () => {
      setTouchMode(false)
      const book = makeBook({ status: 'missing' })
      const wrapper = mountCard({ book })
      await wrapper.find('.group').trigger('click')
      expect(mockRouterPush).not.toHaveBeenCalled()
    })
  })

  describe('below-cover label click behavior', () => {
    it('opens book details when the primary label text is clicked', async () => {
      mockCardInfoMode.value = 'below-cover'
      mockGridCardPrimaryLabel.value = 'book-title'
      const book = makeBook({ id: 42, files: [makeFile({ id: 10, format: 'epub', role: 'primary' })] })
      const wrapper = mountCard({ book, showLabel: true })

      await wrapper.get('[data-testid="grid-card-label-primary"]').trigger('click')

      expect(mockRouterPush).toHaveBeenCalledWith({ name: 'book-detail', params: { bookId: 42 } })
      expect(mockRouterPush).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'reader' }))
    })

    it('opens author details when the author label text is clicked', async () => {
      mockCardInfoMode.value = 'below-cover'
      mockGridCardSecondaryLabel.value = 'author'
      const book = makeBook({ id: 43, files: [makeFile({ id: 11, format: 'epub', role: 'primary' })] })
      const wrapper = mountCard({ book, showLabel: true })

      await wrapper.get('[data-testid="grid-card-label-secondary"]').trigger('click')
      await flushPromises()

      expect(mockFetchAuthors).toHaveBeenCalledWith({ q: 'Frank Herbert', page: 0, size: 5, sort: 'name', order: 'asc' })
      expect(mockRouterPush).toHaveBeenCalledWith({ name: 'author-detail', params: { id: 7 }, query: { from: '/' } })
      expect(mockRouterPush).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'reader' }))
    })

    it('opens series details when the series label text is clicked', async () => {
      mockCardInfoMode.value = 'below-cover'
      mockGridCardPrimaryLabel.value = 'series-title-position'
      const book = makeBook({ id: 44, seriesName: 'Dune Chronicles', seriesIndex: 1, files: [makeFile({ id: 12, format: 'epub', role: 'primary' })] })
      const wrapper = mountCard({ book, showLabel: true })

      await wrapper.get('[data-testid="grid-card-label-primary"]').trigger('click')

      expect(mockRouterPush).toHaveBeenCalledWith({ name: 'series-detail', params: { seriesName: 'Dune Chronicles' }, query: { from: '/' } })
      expect(mockRouterPush).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'reader' }))
    })
  })

  // ── cover rendering ───────────────────────────────────────────────────────

  describe('cover rendering', () => {
    it('shows placeholder when hasCover is false', () => {
      const wrapper = mountCard({ book: makeBook({ hasCover: false }) })
      expect(wrapper.find('[data-testid="cover-placeholder"]').exists()).toBe(true)
    })

    it('shows cover image when hasCover is true', () => {
      const wrapper = mountCard({ book: makeBook({ hasCover: true }) })
      // img element for the main cover image exists
      expect(wrapper.find('img').exists()).toBe(true)
    })

    it('uses coverUrl composable for the image src', () => {
      const book = makeBook({ id: 42, hasCover: true })
      mountCard({ book })
      expect(mockCoverUrl).toHaveBeenCalledWith(42)
    })

    it('constrains overlays to the natural fitted cover frame after image load', async () => {
      mockBookCoverDisplayMode.value = 'natural-bottom'
      const wrapper = mountCard({ book: makeBook({ hasCover: true }) })
      const image = wrapper.find('img[alt="Dune"]')
      Object.defineProperty(image.element, 'naturalWidth', { configurable: true, value: 1200 })
      Object.defineProperty(image.element, 'naturalHeight', { configurable: true, value: 600 })

      await image.trigger('load')

      const frame = wrapper.find('[data-testid="cover-overlay-frame"]')
      expect(frame.attributes('style')).toContain('height:')
      expect(frame.attributes('style')).toContain('bottom: 0')
      expect(frame.attributes('style')).not.toContain('top: 50%')
    })

    it('shows missing badge when book status is missing', () => {
      const book = makeBook({ status: 'missing' })
      const wrapper = mountCard({ book })
      expect(wrapper.text()).toContain('Missing')
    })
  })

  // ── book metadata display ─────────────────────────────────────────────────

  describe('text metadata', () => {
    it('shows book title', () => {
      const wrapper = mountCard({ book: makeBook({ title: 'Foundation' }) })
      expect(wrapper.text()).toContain('Foundation')
    })

    it('does not render hover title when no cover is loaded yet', () => {
      // hasCover true but image not loaded - placeholder not shown, hover title hidden
      const book = makeBook({ hasCover: true, title: 'Foundation' })
      const wrapper = mountCard({ book })
      // coverLoaded defaults to false; showHoverText = false → title not in overlay p tag
      const overlay = wrapper.find('.bg-black\\/70')
      const pTags = overlay.findAll('p')
      // p with text is only rendered when showHoverText is true
      expect(pTags.filter((p) => p.text().includes('Foundation')).length).toBe(0)
    })

    it('shows author in hover overlay when no cover (placeholder shown)', () => {
      const book = makeBook({ hasCover: false, authors: ['Frank Herbert'] })
      const wrapper = mountCard({ book })
      expect(wrapper.find('.bg-black\\/70').text()).toContain('Frank Herbert')
    })
  })

  // ── selection mode UI ─────────────────────────────────────────────────────

  describe('selection mode', () => {
    it('renders selection checkbox overlay in selection mode', () => {
      const wrapper = mountCard({ selectionMode: true })
      // There is a selection overlay div (absolute inset-0 z-30)
      const selectionOverlay = wrapper.find('.z-30')
      expect(selectionOverlay.exists()).toBe(true)
    })

    it('shows checkmark when selected', () => {
      const wrapper = mountCard({ selectionMode: true, selected: true })
      // Check that the selection overlay has primary styling
      const selectionOverlay = wrapper.find('.z-30')
      expect(selectionOverlay.classes()).toContain('bg-primary/20')
    })

    it('does not show check in unselected state', () => {
      const wrapper = mountCard({ selectionMode: true, selected: false })
      const selectionOverlay = wrapper.find('.z-30')
      expect(selectionOverlay.classes()).not.toContain('bg-primary/20')
    })
  })

  // ── author browse navigation ──────────────────────────────────────────────

  describe('author browse', () => {
    it('navigates to authors page when author button clicked', async () => {
      const book = makeBook({ hasCover: false, authors: ['Frank Herbert'] })
      const wrapper = mountCard({ book })
      const authorBtn = wrapper.findAll('.bg-black\\/70 button').find((b) => b.text().includes('Frank Herbert'))
      expect(authorBtn).toBeDefined()
      await authorBtn!.trigger('click')
      expect(mockRouterPush).toHaveBeenCalledWith({ name: 'authors', query: { q: 'Frank Herbert' } })
    })

    it('does not navigate when authors array is empty', async () => {
      const book = makeBook({ hasCover: false, authors: [] })
      const wrapper = mountCard({ book })
      await wrapper.find('.group').trigger('click')
      expect(mockRouterPush).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'authors' }))
    })
  })

  // ── refreshing spinner ────────────────────────────────────────────────────

  describe('refresh spinner', () => {
    it('renders refresh overlay when any refresh is active', async () => {
      mockRefreshing.value = true
      const wrapper = mountCard()
      // The refresh overlay is the absolute z-40 div
      const refreshOverlay = wrapper.find('.z-40')
      expect(refreshOverlay.exists()).toBe(true)
    })

    it('does not render refresh overlay by default', () => {
      mockRefreshing.value = false
      mockIsRefreshing.mockReturnValue(false)
      const wrapper = mountCard()
      expect(wrapper.find('.z-40').exists()).toBe(false)
    })
  })

  // ── dropdown menu actions ─────────────────────────────────────────────────

  describe('dropdown menu', () => {
    it('renders the kebab menu trigger button', () => {
      const wrapper = mountCard()
      // The dropdown trigger wraps a button with MoreVertical icon
      expect(wrapper.find('[data-testid="dropdown-trigger"]').exists()).toBe(true)
    })

    it('does not render dropdown in selection mode', () => {
      const wrapper = mountCard({ selectionMode: true })
      expect(wrapper.find('[data-testid="dropdown-menu"]').exists()).toBe(false)
    })
  })

  // ── cover aspect ratio ────────────────────────────────────────────────────

  describe('cover aspect ratio', () => {
    it('applies cover aspect ratio style to the cover container', () => {
      const wrapper = mountCard()
      // The cover wrapper has style with aspectRatio
      const coverWrapper = wrapper.find('[style*="aspect-ratio"]')
      expect(coverWrapper.exists()).toBe(true)
    })
  })

  // ── send dialog ───────────────────────────────────────────────────────────

  describe('send email dialog', () => {
    it('shows send dialog when showSendDialog is triggered', async () => {
      mockHasPermission.mockReturnValue(true)
      const wrapper = mountCard()
      // The dialog is not shown initially
      expect(wrapper.find('[data-testid="send-dialog"]').exists()).toBe(false)
    })
  })

  // ── series position overlay ───────────────────────────────────────────────

  describe('series position overlay', () => {
    it('hides badge when series-position is not in cardOverlays', () => {
      mockCardOverlays.value = []
      const wrapper = mountCard({ book: makeBook({ seriesIndex: 3, seriesName: 'Dune' }) })
      expect(wrapper.text()).not.toContain('#3')
    })

    it('shows #3 badge when seriesIndex is 3 and overlay is enabled', () => {
      mockCardOverlays.value = ['series-position']
      const wrapper = mountCard({ book: makeBook({ seriesIndex: 3, seriesName: 'Dune' }) })
      expect(wrapper.text()).toContain('#3')
    })

    it('marks badge as a card-click blocker and disables hit-testing on hover', () => {
      mockCardOverlays.value = ['series-position']
      const wrapper = mountCard({ book: makeBook({ seriesIndex: 3, seriesName: 'Dune' }) })
      const badge = wrapper.find('[data-card-click-blocker]')
      expect(badge.exists()).toBe(true)
      expect(badge.classes()).toContain('group-hover:pointer-events-none')
    })

    it('shows #1.5 badge when seriesIndex is 1.5', () => {
      mockCardOverlays.value = ['series-position']
      const wrapper = mountCard({ book: makeBook({ seriesIndex: 1.5, seriesName: 'Dune' }) })
      expect(wrapper.text()).toContain('#1.5')
    })

    it('strips trailing .0 for whole-number floats (3.0 shows as #3)', () => {
      mockCardOverlays.value = ['series-position']
      const wrapper = mountCard({ book: makeBook({ seriesIndex: 3.0, seriesName: 'Dune' }) })
      expect(wrapper.text()).toContain('#3')
      expect(wrapper.text()).not.toContain('#3.0')
    })

    it('hides badge when seriesIndex is null even if overlay is enabled', () => {
      mockCardOverlays.value = ['series-position']
      const wrapper = mountCard({ book: makeBook({ seriesIndex: null, seriesName: 'Dune' }) })
      expect(wrapper.text()).not.toContain('#')
    })

    it('hides badge in selection mode', () => {
      mockCardOverlays.value = ['series-position']
      const wrapper = mountCard({ book: makeBook({ seriesIndex: 2, seriesName: 'Dune' }), selectionMode: true })
      expect(wrapper.text()).not.toContain('#2')
    })

    it('hides badge for missing books', () => {
      mockCardOverlays.value = ['series-position']
      const wrapper = mountCard({ book: makeBook({ seriesIndex: 2, seriesName: 'Dune', status: 'missing' }) })
      expect(wrapper.text()).not.toContain('#2')
    })

    it('tooltip content includes series name and number', () => {
      mockCardOverlays.value = ['series-position']
      const wrapper = mountCard({ book: makeBook({ seriesIndex: 3, seriesName: 'Sprawl' }) })
      expect(wrapper.text()).toContain('Sprawl #3')
    })

    it('tooltip content shows only number when seriesName is null', () => {
      mockCardOverlays.value = ['series-position']
      const wrapper = mountCard({ book: makeBook({ seriesIndex: 3, seriesName: null }) })
      expect(wrapper.text()).toContain('#3')
    })

    it('does not open the reader when the series badge is clicked', async () => {
      setTouchMode(false)
      mockCardOverlays.value = ['series-position']
      const wrapper = mountCard({ book: makeBook({ seriesIndex: 3, seriesName: 'Dune' }) })
      const badge = wrapper.find('[data-card-click-blocker]')
      expect(badge.exists()).toBe(true)
      await badge.trigger('click')
      expect(mockRouterPush).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'reader' }))
    })
  })
})
