import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReaderSidebar from '../ReaderSidebar.vue'

describe('ReaderSidebar', () => {
  const scrollIntoView = vi.fn<() => void>()

  beforeEach(() => {
    scrollIntoView.mockClear()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
  })

  const global = {
    stubs: {
      Tooltip: { template: '<div><slot /></div>' },
      TooltipTrigger: { template: '<div><slot /></div>' },
      TooltipContent: { template: '<div><slot /></div>' },
    },
  }

  async function flushScrollWatcher() {
    await nextTick()
    await nextTick()
  }

  function makeBaseProps() {
    return {
      chapters: [],
      bookmarks: [],
      annotations: [],
      currentCfi: null,
      locationMetaByCfi: {},
      activeHref: '',
      expandedHrefs: new Set<string>(),
    }
  }

  it('navigates chapters and emits expand toggle from TOC rows', async () => {
    const wrapper = mount(ReaderSidebar, {
      props: {
        ...makeBaseProps(),
        chapters: [
          {
            label: 'Chapter 1',
            href: 'ch1.xhtml#start',
            subitems: [{ label: 'Section 1.1', href: 'ch1.xhtml#sec-1' }],
          },
        ],
        activeHref: 'ch1.xhtml#middle',
      },
      global,
    })

    const chapterButton = wrapper.findAll('button').find((btn) => btn.text().includes('Chapter 1'))
    await chapterButton?.trigger('click')

    expect(wrapper.emitted('navigateChapter')?.[0]).toEqual(['ch1.xhtml#start'])

    const chevronToggle = wrapper.find('li span.shrink-0')
    await chevronToggle.trigger('click')

    expect(wrapper.emitted('toggleExpand')?.[0]).toEqual(['ch1.xhtml#start'])
  })

  it('scrolls the active TOC chapter into view when the active href changes', async () => {
    const wrapper = mount(ReaderSidebar, {
      props: {
        ...makeBaseProps(),
        chapters: Array.from({ length: 20 }, (_, index) => ({
          label: `Chapter ${index + 1}`,
          href: `ch${index + 1}.xhtml#start`,
        })),
        activeHref: 'ch1.xhtml#middle',
      },
      global,
    })

    await flushScrollWatcher()
    scrollIntoView.mockClear()

    await wrapper.setProps({ activeHref: 'ch18.xhtml#middle' })
    await flushScrollWatcher()

    expect(wrapper.find('[data-reader-active-row="chapter"]').text()).toContain('Chapter 18')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
  })

  it('navigates and deletes bookmark/annotation entries from sidebar tabs', async () => {
    const wrapper = mount(ReaderSidebar, {
      props: {
        ...makeBaseProps(),
        currentCfi: 'epubcfi(/6/7)',
        bookmarks: [
          {
            id: 1,
            bookId: 1,
            cfi: 'epubcfi(/6/2)',
            title: 'Mark',
            createdAt: '2026-02-14T12:00:00.000Z',
          },
          {
            id: 2,
            bookId: 1,
            cfi: 'epubcfi(/6/8)',
            title: 'Later mark',
            createdAt: '2026-02-15T12:00:00.000Z',
          },
        ],
        annotations: [
          {
            id: 9,
            bookId: 1,
            cfi: 'epubcfi(/6/8)',
            jumpFileId: 101,
            pageno: null,
            text: 'Highlight text',
            color: '#FACC15',
            style: 'highlight',
            note: 'note',
            chapterTitle: 'Intro',
            origin: 'web',
            positionStatus: 'exact',
            chapterIndex: null,
            createdAt: '2026-02-14T12:00:00.000Z',
          },
          {
            id: 10,
            bookId: 1,
            cfi: 'epubcfi(/6/12)',
            jumpFileId: 101,
            pageno: null,
            text: 'Second highlight',
            color: '#38BDF8',
            style: 'underline',
            note: null,
            chapterTitle: null,
            origin: 'web',
            positionStatus: 'exact',
            chapterIndex: null,
            createdAt: '2026-02-15T12:00:00.000Z',
          },
        ],
        locationMetaByCfi: {
          'epubcfi(/6/2)': { chapterTitle: 'Chapter 1', percentage: 12 },
          'epubcfi(/6/8)': { chapterTitle: 'Chapter 3', percentage: 45 },
          'epubcfi(/6/12)': { chapterTitle: 'Chapter 5', percentage: 74 },
        },
      },
      global,
    })

    const tabButtons = wrapper.findAll('button')

    const bookmarksTab = tabButtons.find((btn) => btn.text().includes('Bookmarks'))
    await bookmarksTab?.trigger('click')

    expect(wrapper.text()).toContain('Chapter 1 - 12%')
    const bookmarkNav = wrapper.findAll('li button').find((btn) => btn.text().includes('Mark'))
    await bookmarkNav?.trigger('click')
    expect(wrapper.emitted('navigateBookmark')?.[0]).toEqual(['epubcfi(/6/2)'])
    const activeBookmarkRow = wrapper.findAll('li').find((li) => li.text().includes('Later mark'))
    expect(activeBookmarkRow?.classes()).toContain('bg-primary/10')

    const bookmarkDelete = wrapper.findAll('li button').find((btn) => btn.classes().includes('hover:text-destructive'))
    await bookmarkDelete?.trigger('click')
    expect(wrapper.emitted('deleteBookmark')?.[0]).toEqual([1])

    const highlightsTab = wrapper.findAll('button').find((btn) => btn.text().includes('Highlights'))
    await highlightsTab?.trigger('click')

    expect(wrapper.text()).toContain('Chapter 3 - 45%')
    const highlightNav = wrapper.findAll('li button').find((btn) => btn.text().includes('Highlight text'))
    await highlightNav?.trigger('click')
    expect(wrapper.emitted('navigateAnnotation')?.[0]).toEqual(['epubcfi(/6/8)'])

    const highlightDelete = wrapper.findAll('li button').find((btn) => btn.classes().includes('hover:text-destructive'))
    await highlightDelete?.trigger('click')
    expect(wrapper.emitted('deleteAnnotation')?.[0]).toEqual([9])
  })

  it('applies highlight search, filters, and sorting controls', async () => {
    const wrapper = mount(ReaderSidebar, {
      props: {
        ...makeBaseProps(),
        annotations: [
          {
            id: 11,
            bookId: 1,
            cfi: 'epubcfi(/6/4)',
            jumpFileId: 101,
            pageno: null,
            text: 'Alpha quote',
            color: '#FACC15',
            style: 'highlight',
            note: null,
            chapterTitle: null,
            origin: 'web',
            positionStatus: 'exact',
            chapterIndex: null,
            createdAt: '2026-02-13T12:00:00.000Z',
          },
          {
            id: 12,
            bookId: 1,
            cfi: 'epubcfi(/6/10)',
            jumpFileId: 101,
            pageno: null,
            text: 'Beta insight',
            color: '#38BDF8',
            style: 'underline',
            note: 'note here',
            chapterTitle: 'Chapter Ten',
            origin: 'web',
            positionStatus: 'exact',
            chapterIndex: null,
            createdAt: '2026-02-16T12:00:00.000Z',
          },
        ],
        locationMetaByCfi: {
          'epubcfi(/6/4)': { chapterTitle: 'Chapter 2', percentage: 20 },
          'epubcfi(/6/10)': { chapterTitle: 'Chapter 10', percentage: 67 },
        },
      },
      global,
    })

    const highlightsTab = wrapper.findAll('button').find((btn) => btn.text().includes('Highlights'))
    await highlightsTab?.trigger('click')

    const searchInput = wrapper.find('input[placeholder="Search highlights..."]')
    await searchInput.setValue('beta')
    expect(wrapper.text()).toContain('Beta insight')
    expect(wrapper.text()).not.toContain('Alpha quote')

    const selects = wrapper.findAll('select')
    await selects[1]?.setValue('#38BDF8')
    expect(wrapper.text()).toContain('Beta insight')

    const notesOnlyCheckbox = wrapper.find('input[type="checkbox"]')
    await notesOnlyCheckbox.setValue(true)
    expect(wrapper.text()).toContain('Beta insight')

    await selects[0]?.setValue('oldest')
    const visibleRows = wrapper.findAll('li')
    expect(visibleRows[0]?.text()).toContain('Beta insight')
  })

  it('filters bookmarks, sorts by date, and skips bookmark navigation when CFI is missing', async () => {
    const wrapper = mount(ReaderSidebar, {
      props: {
        ...makeBaseProps(),
        bookmarks: [
          {
            id: 21,
            bookId: 1,
            cfi: 'epubcfi(/6/2)',
            title: 'First mark',
            createdAt: '2026-02-13T12:00:00.000Z',
          },
          {
            id: 22,
            bookId: 1,
            cfi: null as unknown as string,
            title: 'Missing cfi',
            createdAt: '2026-02-18T12:00:00.000Z',
          },
        ],
      },
      global,
    })

    const bookmarksTab = wrapper.findAll('button').find((btn) => btn.text().includes('Bookmarks'))
    await bookmarksTab?.trigger('click')

    expect(wrapper.text()).toContain('Location unavailable')

    const searchInput = wrapper.find('input[placeholder="Search bookmarks..."]')
    await searchInput.setValue('missing')
    expect(wrapper.text()).toContain('Missing cfi')
    expect(wrapper.text()).not.toContain('First mark')

    const sortSelect = wrapper.find('select')
    await sortSelect.setValue('newest')
    const firstBookmarkRow = wrapper.findAll('li')[0]
    expect(firstBookmarkRow?.text()).toContain('Missing cfi')

    const missingCfiButton = wrapper.findAll('li button').find((btn) => btn.text().includes('Missing cfi'))
    await missingCfiButton?.trigger('click')
    expect(wrapper.emitted('navigateBookmark')).toBeUndefined()
  })

  it('shows custom color metadata and empty-state when highlight filters remove all results', async () => {
    const wrapper = mount(ReaderSidebar, {
      props: {
        ...makeBaseProps(),
        annotations: [
          {
            id: 31,
            bookId: 1,
            cfi: 'epubcfi(/6/8)',
            jumpFileId: 101,
            pageno: null,
            text: 'Custom color text',
            color: '#abc123',
            style: 'highlight',
            note: null,
            chapterTitle: null,
            origin: 'web',
            positionStatus: 'exact',
            chapterIndex: null,
            createdAt: '2026-02-11T12:00:00.000Z',
          },
        ],
      },
      global,
    })

    const highlightsTab = wrapper.findAll('button').find((btn) => btn.text().includes('Highlights'))
    await highlightsTab?.trigger('click')
    expect(wrapper.text()).toContain('Custom (#ABC123)')

    const colorSelect = wrapper.findAll('select')[1]
    await colorSelect?.setValue('#FACC15')
    expect(wrapper.text()).toContain('No highlights match your filters')
  })
})
