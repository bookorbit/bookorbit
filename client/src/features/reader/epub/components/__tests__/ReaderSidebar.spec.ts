import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReaderSidebar from '../ReaderSidebar.vue'

describe('ReaderSidebar', () => {
  const global = {
    stubs: {
      Tooltip: { template: '<div><slot /></div>' },
      TooltipTrigger: { template: '<div><slot /></div>' },
      TooltipContent: { template: '<div><slot /></div>' },
    },
  }

  it('navigates chapters and emits expand toggle from TOC rows', async () => {
    const wrapper = mount(ReaderSidebar, {
      props: {
        chapters: [
          {
            label: 'Chapter 1',
            href: 'ch1.xhtml#start',
            subitems: [{ label: 'Section 1.1', href: 'ch1.xhtml#sec-1' }],
          },
        ],
        bookmarks: [],
        annotations: [],
        activeHref: 'ch1.xhtml#middle',
        expandedHrefs: new Set<string>(),
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

  it('deletes bookmark and annotation from their respective tabs', async () => {
    const wrapper = mount(ReaderSidebar, {
      props: {
        chapters: [],
        bookmarks: [
          {
            id: 1,
            bookId: 1,
            cfi: 'epubcfi(/6/2)',
            title: 'Mark',
            createdAt: '2026-02-14T12:00:00.000Z',
          },
        ],
        annotations: [
          {
            id: 9,
            bookId: 1,
            cfi: 'epubcfi(/6/8)',
            text: 'Highlight text',
            color: '#FACC15',
            style: 'highlight',
            note: 'note',
            chapterTitle: 'Intro',
            createdAt: '2026-02-14T12:00:00.000Z',
          },
        ],
        activeHref: '',
        expandedHrefs: new Set<string>(),
      },
      global,
    })

    const tabButtons = wrapper.findAll('button')

    const bookmarksTab = tabButtons.find((btn) => btn.text().includes('Bookmarks'))
    await bookmarksTab?.trigger('click')

    const bookmarkDelete = wrapper.findAll('li button')[0]
    await bookmarkDelete?.trigger('click')
    expect(wrapper.emitted('deleteBookmark')?.[0]).toEqual([1])

    const highlightsTab = wrapper.findAll('button').find((btn) => btn.text().includes('Highlights'))
    await highlightsTab?.trigger('click')

    const highlightDelete = wrapper.findAll('li button')[0]
    await highlightDelete?.trigger('click')
    expect(wrapper.emitted('deleteAnnotation')?.[0]).toEqual([9])
  })
})
