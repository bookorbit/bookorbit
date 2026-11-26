import { computed, nextTick, onUnmounted, ref } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CbzReaderView from './CbzReaderView.vue'
import CbzSettingsPanel from './components/CbzSettingsPanel.vue'
import ComicNoteDialog from './components/ComicNoteDialog.vue'
import ComicNoteMarkers from './components/ComicNoteMarkers.vue'
import ComicNotesPanel from './components/ComicNotesPanel.vue'
import NextIssueCard from './components/NextIssueCard.vue'
import ReaderBottomSheet from '../shared/components/ReaderBottomSheet.vue'

const NEXT_BOOK = { bookId: 91, fileId: 501, format: 'cbz', title: 'Issue 10', seriesIndex: '10' }

const mocks = vi.hoisted(() => ({
  savedMode: 'infinite' as 'paginated' | 'infinite' | 'long-strip',
  savedViewMode: 'single' as 'single' | 'two-page',
  savedSpreadGap: 0,
  pageCount: 10_000,
  savedPageNumber: 9_000,
  savedAutoAdvance: false,
  seriesId: 42 as number | null,
  nextBook: null as { bookId: number; fileId: number; format: string; title: string; seriesIndex: string } | null,
  loadNextBook: vi.fn<(seriesId: number | null, bookId: number) => Promise<void>>().mockResolvedValue(undefined),
  routerPush: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  onBeforeRouteLeave: vi.fn<(guard: () => Promise<void>) => void>(),
  pageUrl: vi.fn<(page: number) => string>((page) => `/api/v1/cbz/files/22/pages/${page}`),
  progressSave: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  scrollToIndex: vi.fn<(index: number, options: { align: string }) => void>(),
  updateBookSettings: vi.fn<(patch: unknown) => void>(),
  resetBookSettings: vi.fn<() => void>(),
  sessionEndSnapshots: [] as Array<{ percentage: number; pageNumber?: number | null }>,
  routeQuery: {} as Record<string, string>,
  comicNotes: [] as Array<{ annotation: { id: number; color: string; note: string }; page: number }>,
  loadComicNotes: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  addNote: vi.fn<(page: number, note: string, color: string) => Promise<unknown>>().mockResolvedValue({ id: 1 }),
  editNote: vi.fn<(id: number, note: string, color: string) => Promise<unknown>>().mockResolvedValue({ id: 1 }),
  removeNote: vi.fn<(id: number) => Promise<boolean>>().mockResolvedValue(true),
  toastError: vi.fn<(message: string) => void>(),
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { bookId: '11', fileId: '22' }, query: mocks.routeQuery }),
  useRouter: () => ({ back: vi.fn<() => void>(), push: mocks.routerPush, replace: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }),
  onBeforeRouteLeave: mocks.onBeforeRouteLeave,
}))

vi.mock('@tanstack/vue-virtual', () => ({
  useVirtualizer: (options: { value: { count: number } }) => {
    const center = ref(0)
    return computed(() => ({
      getVirtualItems: () => {
        const count = options.value.count
        if (count === 0) return []
        const start = Math.max(0, center.value - 2)
        const end = Math.min(count - 1, center.value + 2)
        return Array.from({ length: end - start + 1 }, (_, offset) => {
          const index = start + offset
          return { key: index, index, start: index * 1_000, end: (index + 1) * 1_000, size: 1_000, lane: 0 }
        })
      },
      getTotalSize: () => options.value.count * 1_000,
      measureElement: vi.fn<(element?: unknown) => void>(),
      scrollToIndex: (index: number, scrollOptions: { align: string }) => {
        center.value = index
        mocks.scrollToIndex(index, scrollOptions)
      },
    }))
  },
}))

vi.mock('./composables/useCbz', () => ({
  useCbz: () => {
    const pageCount = ref(0)
    return {
      pageCount,
      bookTitle: ref('Large comic'),
      loading: ref(false),
      error: ref(null),
      seriesId: ref(mocks.seriesId),
      pageUrl: mocks.pageUrl,
      thumbnailUrl: (page: number) => `/thumb/${page}`,
      load: async () => {
        pageCount.value = mocks.pageCount
      },
    }
  },
}))

vi.mock('vue-sonner', () => ({ toast: { error: mocks.toastError } }))

vi.mock('./composables/useComicNotes', async () => {
  const { computed, ref } = await import('vue')
  return {
    useComicNotes: () => {
      const notes = ref(mocks.comicNotes)
      return {
        notes,
        total: computed(() => notes.value.length),
        loading: ref(false),
        loadError: ref(false),
        loadingMore: ref(false),
        hasMore: ref(false),
        markers: computed(() => notes.value.map((note) => ({ page: note.page, color: note.annotation.color }))),
        lastColor: ref('#FACC15'),
        load: mocks.loadComicNotes,
        loadMore: vi.fn<() => Promise<boolean>>(),
        notesOn: (pages: readonly number[]) => notes.value.filter((note) => pages.includes(note.page)),
        addNote: mocks.addNote,
        editNote: mocks.editNote,
        removeNote: mocks.removeNote,
      }
    },
  }
})

vi.mock('../shared/composables/useSeriesNextBook', () => ({
  useSeriesNextBook: () => ({ nextBook: computed(() => mocks.nextBook), load: mocks.loadNextBook }),
}))

vi.mock('./composables/useCbzSettings', () => ({
  useCbzSettings: () => ({
    fitMode: ref('fit-page'),
    viewMode: ref('single'),
    scrollMode: ref('paginated'),
    direction: ref('ltr'),
    spreadAlignment: ref('normal'),
    spreadGap: ref(0),
    forceTwoPage: ref(false),
    widePageSingletonMode: ref('auto'),
    bgColor: ref('black'),
    autoAdvance: ref(false),
    bgValue: computed(() => '#000'),
    imgFitClass: computed(() => 'object-contain'),
  }),
}))

vi.mock('../shared/composables/useReaderSettings', () => ({
  useReaderSettings: () => ({
    effective: computed(() => ({
      fitMode: 'fit-page',
      viewMode: mocks.savedViewMode,
      scrollMode: mocks.savedMode,
      direction: 'ltr',
      spreadAlignment: 'normal',
      spreadGap: mocks.savedSpreadGap,
      forceTwoPage: false,
      widePageSingletonMode: 'auto',
      bgColor: 'black',
      autoAdvance: mocks.savedAutoAdvance,
    })),
    isCustomized: ref(false),
    load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    updateBookSettings: mocks.updateBookSettings,
    resetBookSettings: mocks.resetBookSettings,
  }),
}))

vi.mock('../shared/composables/useReaderProgress', () => ({
  useReaderProgress: () => ({
    pageNumber: ref(mocks.savedPageNumber),
    percentage: ref(90),
    load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    save: mocks.progressSave,
  }),
}))

// Like the real composable, the session ends from an unmounted hook registered before the view's own.
vi.mock('../shared/composables/useReadingSession', () => ({
  useReadingSession: (_fileId: number, getProgress: () => { percentage: number; pageNumber?: number | null }) => {
    onUnmounted(() => mocks.sessionEndSnapshots.push(getProgress()))
    return { onActivity: vi.fn<() => void>(), elapsedMinutes: ref(0) }
  },
}))

vi.mock('../shared/composables/useVisibility', () => ({
  useVisibility: () => ({
    headerVisible: ref(false),
    footerVisible: ref(false),
    handleMiddleTap: vi.fn<() => void>(),
    showHeader: vi.fn<() => void>(),
    showFooter: vi.fn<() => void>(),
    setVisibilityLock: vi.fn<(locked: boolean) => void>(),
  }),
}))

vi.mock('../shared/composables/useFullscreen', () => ({
  useFullscreen: () => ({ isFullscreen: ref(false), toggleFullscreen: vi.fn<() => void>() }),
}))

/** Answers media queries as a window of this width would, so the notes panel picks its layout. */
function stubViewport(width: number) {
  window.innerWidth = width
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query)
    const max = /max-width:\s*([\d.]+)px/.exec(query)
    return {
      matches: (!min || width >= Number(min[1])) && (!max || width <= Number(max[1])),
      media: query,
      onchange: null,
      addEventListener: vi.fn<MediaQueryList['addEventListener']>(),
      removeEventListener: vi.fn<MediaQueryList['removeEventListener']>(),
      addListener: vi.fn<MediaQueryList['addListener']>(),
      removeListener: vi.fn<MediaQueryList['removeListener']>(),
      dispatchEvent: vi.fn<MediaQueryList['dispatchEvent']>(),
    }
  })
}

function mountWithControls(props: { bookId: number; fileId: number; source?: 'cbz' | 'djvu' } = { bookId: 11, fileId: 22 }) {
  return shallowMount(CbzReaderView, { props, global: { renderStubDefaultSlot: true } })
}

describe('CbzReaderView', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    localStorage.clear()
    mocks.routeQuery = {}
    mocks.comicNotes = []
    mocks.savedMode = 'infinite'
    mocks.savedViewMode = 'single'
    mocks.savedSpreadGap = 0
    mocks.pageCount = 10_000
    mocks.savedPageNumber = 9_000
    mocks.savedAutoAdvance = false
    mocks.seriesId = 42
    mocks.nextBook = null
    mocks.sessionEndSnapshots.length = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn<(handle: number) => void>())
  })

  it('offers DjVu embedded text and recovers from a failed page image', async () => {
    mocks.savedMode = 'paginated'
    mocks.savedPageNumber = 1
    mocks.pageCount = 2
    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22, source: 'djvu' } })
    await flushPromises()
    expect(wrapper.find('[aria-label="reader.djvu.pageText"]').exists()).toBe(true)
    await wrapper.get('img').trigger('error')
    expect(wrapper.text()).toContain('reader.pageImages.pageFailed')
    const retry = wrapper.findAll('button').find((button) => button.text() === 'common.retry')!
    await retry.trigger('click')
    expect(wrapper.text()).not.toContain('reader.pageImages.pageFailed')
    expect(wrapper.get('img').attributes('alt')).toBe('reader.pageImages.pageAlt')
    wrapper.unmount()
  })

  it.each(['infinite', 'long-strip'] as const)('restores %s mode by index while rendering only a bounded page window', async (mode) => {
    mocks.savedMode = mode
    const wrapper = shallowMount(CbzReaderView, {
      props: { bookId: 11, fileId: 22 },
    })

    await flushPromises()
    await nextTick()

    expect(mocks.scrollToIndex).toHaveBeenCalledWith(8_999, { align: 'start' })

    const renderedPages = wrapper.findAll('[data-page]').map((page) => Number(page.attributes('data-page')))
    expect(renderedPages).toEqual([8_997, 8_998, 8_999, 9_000, 9_001])
    expect(wrapper.findAll('img')).toHaveLength(5)
    expect(new Set(mocks.pageUrl.mock.calls.map(([page]) => page)).size).toBeLessThanOrEqual(5)
    expect(mocks.pageUrl).not.toHaveBeenCalledWith(0)

    wrapper.unmount()
  })

  it.each([0, 24])('anchors two-page images to the spine with a %ipx configurable gap', async (spreadGap) => {
    mocks.savedMode = 'paginated'
    mocks.savedViewMode = 'two-page'
    mocks.savedSpreadGap = spreadGap
    mocks.pageCount = 6
    mocks.savedPageNumber = 2
    window.innerWidth = 1_200

    const wrapper = shallowMount(CbzReaderView, {
      props: { bookId: 11, fileId: 22 },
    })

    await flushPromises()
    await nextTick()

    expect(wrapper.get('[data-testid="cbz-paginated-pages"]').attributes('style')).toContain(`column-gap: ${spreadGap}px`)
    expect(wrapper.get('[data-spread-side="left"]').classes()).toContain('justify-end')
    expect(wrapper.get('[data-spread-side="right"]').classes()).toContain('justify-start')
    expect(wrapper.get('[data-spread-side="left"]').classes()).toContain('items-center-safe')
    expect(wrapper.get('[data-spread-side="right"]').classes()).toContain('items-center-safe')
    expect(wrapper.findAll('[data-spread-side] img')).toHaveLength(2)

    wrapper.unmount()
  })

  it('safely centers a paginated page without putting oversized content before the scroll origin', async () => {
    mocks.savedMode = 'paginated'
    mocks.savedViewMode = 'single'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, {
      props: { bookId: 11, fileId: 22 },
    })

    await flushPromises()
    await nextTick()

    const pages = wrapper.get('[data-testid="cbz-paginated-pages"]')
    expect(pages.classes()).toContain('items-center-safe')
    expect(pages.classes()).toContain('justify-center-safe')

    wrapper.unmount()
  })

  it('routes settings panel updates and reset through the per-book settings store', async () => {
    mocks.savedMode = 'paginated'
    const wrapper = shallowMount(CbzReaderView, {
      props: { bookId: 11, fileId: 22 },
      global: {
        stubs: {
          Popover: { template: '<div><slot /></div>' },
          PopoverTrigger: { template: '<div><slot /></div>' },
          PopoverContent: { template: '<div><slot /></div>' },
        },
      },
    })

    await flushPromises()
    await nextTick()

    const panel = wrapper.getComponent(CbzSettingsPanel)
    expect(panel.props('settings')).toMatchObject({ fitMode: 'fit-page', bgColor: 'black' })

    panel.vm.$emit('update', { bgColor: 'white' })
    await nextTick()
    expect(mocks.updateBookSettings).toHaveBeenCalledWith({ bgColor: 'white' })

    panel.vm.$emit('reset')
    expect(mocks.resetBookSettings).toHaveBeenCalledOnce()

    wrapper.unmount()
  })
  it('zooms with desktop controls and Ctrl-wheel without turning the page', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, {
      props: { bookId: 11, fileId: 22 },
      global: {
        stubs: {
          Tooltip: { template: '<div><slot /></div>' },
          TooltipTrigger: { template: '<div><slot /></div>' },
          TooltipContent: { template: '<div><slot /></div>' },
        },
      },
    })

    await flushPromises()
    await nextTick()

    const pages = wrapper.get('[data-testid="cbz-paginated-pages"]')
    const viewport = wrapper.get('[data-testid="cbz-paginated-viewport"]').element as HTMLElement
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 800 },
    })
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1_000, height: 800 } as DOMRect)
    expect(pages.attributes('style')).toContain('scale(1)')

    await wrapper.get('button[aria-label="reader.cbz.zoomIn"]').trigger('click')
    await nextTick()
    expect(pages.attributes('style')).toContain('scale(1.25)')
    expect(viewport.scrollLeft).toBe(125)
    expect(viewport.scrollTop).toBe(100)

    const slider = wrapper.get('input[type="range"]')
    expect(slider.attributes('value')).toBe('1')

    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, clientX: 500, clientY: 400, deltaY: 100 }))
    await nextTick()

    expect(pages.attributes('style')).toContain('scale(1)')
    expect(viewport.scrollLeft).toBe(0)
    expect(viewport.scrollTop).toBe(0)
    expect(slider.attributes('value')).toBe('1')

    wrapper.unmount()
  })
  it('offers the next book of the series on the last page and opens it on request', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 3
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    expect(mocks.loadNextBook).toHaveBeenCalledWith(42, 11)
    const card = wrapper.findComponent(NextIssueCard)
    expect(card.exists()).toBe(true)

    card.vm.$emit('open')
    await flushPromises()

    expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'reader', params: { bookId: 91, fileId: 501 }, query: { format: 'cbz' } })

    wrapper.unmount()
  })

  it('hides the next book until the last page is reached', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 2
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    expect(wrapper.findComponent(NextIssueCard).exists()).toBe(false)

    wrapper.unmount()
  })

  it('keeps arrow keys turning pages after a reader button is clicked, leaving activation keys to the button', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 5
    mocks.savedPageNumber = 2
    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 }, attachTo: document.body })
    await flushPromises()
    await nextTick()
    const pages = () => wrapper.findAll('img').map((image) => image.attributes('src'))
    const opened = pages()
    const button = wrapper.get('button').element as HTMLButtonElement
    button.focus()

    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    await nextTick()
    expect(pages()).toEqual(opened)

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextTick()
    expect(pages()).not.toEqual(opened)

    wrapper.unmount()
  })

  it('leaves the page turn inert past the last page while auto-advance is off', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 3
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await flushPromises()

    expect(mocks.routerPush).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('crosses into the next book on a further page turn once auto-advance has settled on the last page', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 3
    mocks.savedAutoAdvance = true
    mocks.nextBook = NEXT_BOOK

    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    // The turn that landed on the last page must not carry through into the next book.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await flushPromises()
    expect(mocks.routerPush).not.toHaveBeenCalled()

    now.mockReturnValue(11_000)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await flushPromises()

    expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'reader', params: { bookId: 91, fileId: 501 }, query: { format: 'cbz' } })

    now.mockRestore()
    wrapper.unmount()
  })

  it('never crosses into another book while peeking', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 3
    mocks.savedAutoAdvance = true
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22, peekMode: true } })
    await flushPromises()
    await nextTick()

    expect(mocks.loadNextBook).not.toHaveBeenCalled()
    expect(wrapper.findComponent(NextIssueCard).exists()).toBe(false)

    wrapper.unmount()
  })

  it('flushes a debounced page turn before the reading session ends', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await nextTick()
    wrapper.unmount()

    expect(mocks.sessionEndSnapshots).toEqual([{ percentage: 50, pageNumber: 3 }])
    expect(mocks.progressSave).toHaveBeenCalledOnce()
  })

  it('places the next book after the last page in continuous modes', async () => {
    mocks.savedMode = 'long-strip'
    mocks.pageCount = 3
    mocks.savedPageNumber = 2
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    expect(wrapper.findComponent(NextIssueCard).exists()).toBe(true)

    wrapper.unmount()
  })
  describe('page notes', () => {
    it('opens the page a note link points at instead of the saved place, then loads the notes', async () => {
      mocks.savedMode = 'paginated'
      mocks.pageCount = 20
      mocks.savedPageNumber = 3
      mocks.routeQuery = { format: 'cbz', page: '12' }

      const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
      await flushPromises()

      expect(wrapper.get('[data-testid="cbz-paginated-pages"] img').attributes('data-page')).toBe('11')
      expect(mocks.loadComicNotes).toHaveBeenCalledOnce()
      wrapper.unmount()
    })

    it('marks the Notes button and the slider when the page on screen has a note', async () => {
      mocks.savedMode = 'paginated'
      mocks.pageCount = 10
      mocks.savedPageNumber = 3
      mocks.comicNotes = [
        { annotation: { id: 1, color: '#F472B6', note: 'Here' }, page: 2 },
        { annotation: { id: 2, color: '#38BDF8', note: 'Later' }, page: 8 },
      ]

      const wrapper = mountWithControls()
      await flushPromises()

      const toggle = wrapper.get('[data-testid="comic-notes-toggle"]')
      expect(toggle.attributes('aria-label')).toBe('reader.cbz.notes.buttonOnPage')
      expect(toggle.attributes('aria-expanded')).toBe('false')
      expect(toggle.get('span[aria-hidden="true"]').attributes('style')).toContain('background: rgb(244, 114, 182)')
      expect(wrapper.findComponent(ComicNoteMarkers).props('markers')).toEqual([
        { page: 2, color: '#F472B6' },
        { page: 8, color: '#38BDF8' },
      ])

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
      await nextTick()
      expect(wrapper.get('[data-testid="comic-notes-toggle"]').attributes('aria-label')).toBe('reader.cbz.notes.button')
      expect(wrapper.find('[data-testid="comic-notes-toggle"] span[aria-hidden="true"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('docks the notes beside the page on a wide screen, narrowing a spread to one page until it closes', async () => {
      stubViewport(1_200)
      mocks.savedMode = 'paginated'
      mocks.savedViewMode = 'two-page'
      mocks.pageCount = 6
      mocks.savedPageNumber = 2

      const wrapper = mountWithControls()
      await flushPromises()
      expect(wrapper.findAll('[data-spread-side] img')).toHaveLength(2)

      await wrapper.get('[data-testid="comic-notes-toggle"]').trigger('click')

      expect(wrapper.get('[data-testid="comic-notes-aside"]').classes()).toContain('inset-y-0')
      expect(wrapper.get('[data-testid="comic-notes-toggle"]').attributes('aria-expanded')).toBe('true')
      expect(wrapper.findAll('[data-spread-side]')).toHaveLength(0)
      expect(localStorage.getItem('reader:cbz:notesOpen')).toBe('true')

      // Escape that a menu or dialog used to close itself must not close the panel too.
      const menu = document.createElement('div')
      menu.setAttribute('role', 'menu')
      const item = menu.appendChild(document.createElement('button'))
      document.body.append(menu)
      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await nextTick()
      expect(wrapper.find('[data-testid="comic-notes-aside"]').exists()).toBe(true)
      menu.remove()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await nextTick()

      expect(wrapper.find('[data-testid="comic-notes-aside"]').exists()).toBe(false)
      expect(wrapper.findAll('[data-spread-side] img')).toHaveLength(2)
      expect(localStorage.getItem('reader:cbz:notesOpen')).toBe('false')
      wrapper.unmount()
    })

    it('reopens a docked panel on the next visit, but floats it over the page on a tablet', async () => {
      localStorage.setItem('reader:cbz:notesOpen', 'true')
      mocks.savedMode = 'paginated'
      mocks.pageCount = 6
      mocks.savedPageNumber = 2

      stubViewport(1_300)
      const docked = mountWithControls()
      await flushPromises()
      expect(docked.find('[data-testid="comic-notes-aside"]').exists()).toBe(true)
      docked.unmount()

      stubViewport(900)
      const tablet = mountWithControls()
      await flushPromises()
      expect(tablet.find('[data-testid="comic-notes-aside"]').exists()).toBe(false)
      await tablet.get('[data-testid="comic-notes-toggle"]').trigger('click')
      const aside = tablet.get('[data-testid="comic-notes-aside"]')
      expect(aside.classes()).toContain('shadow-2xl')
      expect(tablet.findAll('[data-reader-controls]')[1]!.classes()).toContain('opacity-100')

      await aside.trigger('keydown', { key: 'Escape' })
      expect(tablet.find('[data-testid="comic-notes-aside"]').exists()).toBe(false)
      tablet.unmount()
    })

    it('adds a note to the page on screen and keeps the dialog open when the save fails', async () => {
      stubViewport(1_300)
      mocks.savedMode = 'paginated'
      mocks.pageCount = 10
      mocks.savedPageNumber = 3

      const wrapper = mountWithControls()
      await flushPromises()
      await wrapper.get('[data-testid="comic-notes-toggle"]').trigger('click')
      wrapper.findComponent(ComicNotesPanel).vm.$emit('add')
      await nextTick()

      const dialog = wrapper.findComponent(ComicNoteDialog)
      expect(dialog.props()).toMatchObject({ mode: 'add', pages: [2], initialPage: 2, initialColor: '#FACC15', bookTitle: 'Large comic' })

      mocks.addNote.mockResolvedValueOnce(null)
      dialog.vm.$emit('save', { page: 2, note: 'First try', color: '#4ADE80' })
      await flushPromises()
      expect(mocks.toastError).toHaveBeenCalledWith('reader.toast.noteSaveFailed')
      expect(wrapper.findComponent(ComicNoteDialog).exists()).toBe(true)

      wrapper.findComponent(ComicNoteDialog).vm.$emit('save', { page: 2, note: 'Second try', color: '#4ADE80' })
      await flushPromises()
      expect(mocks.addNote).toHaveBeenLastCalledWith(2, 'Second try', '#4ADE80')
      expect(wrapper.findComponent(ComicNoteDialog).exists()).toBe(false)
      wrapper.unmount()
    })

    it('edits and deletes a note from the list', async () => {
      stubViewport(1_300)
      mocks.savedMode = 'paginated'
      mocks.pageCount = 10
      mocks.savedPageNumber = 3
      const note = { annotation: { id: 5, color: '#FF3300', note: 'From the device' }, page: 6 }
      mocks.comicNotes = [note]
      mocks.removeNote.mockResolvedValueOnce(false)

      const wrapper = mountWithControls()
      await flushPromises()
      await wrapper.get('[data-testid="comic-notes-toggle"]').trigger('click')
      const panel = wrapper.findComponent(ComicNotesPanel)

      panel.vm.$emit('edit', note)
      await nextTick()
      expect(wrapper.findComponent(ComicNoteDialog).props()).toMatchObject({
        mode: 'edit',
        pages: [6],
        initialPage: 6,
        initialNote: 'From the device',
        initialColor: '#FF3300',
      })
      wrapper.findComponent(ComicNoteDialog).vm.$emit('save', { page: 6, note: 'Rewritten', color: '#FF3300' })
      await flushPromises()
      expect(mocks.editNote).toHaveBeenCalledWith(5, 'Rewritten', '#FF3300')

      panel.vm.$emit('delete', note)
      await flushPromises()
      expect(mocks.removeNote).toHaveBeenCalledWith(5)
      expect(mocks.toastError).toHaveBeenCalledWith('reader.toast.noteDeleteFailed')
      wrapper.unmount()
    })

    it('on a phone, opening a note turns to its page and puts the sheet away', async () => {
      mocks.savedMode = 'paginated'
      mocks.pageCount = 10
      mocks.savedPageNumber = 1
      const note = { annotation: { id: 3, color: '#38BDF8', note: 'Splash' }, page: 7 }
      mocks.comicNotes = [note]

      const wrapper = mountWithControls()
      await flushPromises()
      expect(wrapper.find('[data-testid="comic-notes-aside"]').exists()).toBe(false)
      await wrapper.get('[data-testid="comic-notes-toggle"]').trigger('click')
      expect(wrapper.findComponent(ReaderBottomSheet).props('open')).toBe(true)

      wrapper.findComponent(ComicNotesPanel).vm.$emit('open', note)
      await nextTick()

      expect(wrapper.get('[data-testid="cbz-paginated-pages"] img').attributes('data-page')).toBe('7')
      expect(wrapper.findComponent(ReaderBottomSheet).props('open')).toBe(false)
      wrapper.unmount()
    })
  })
})
