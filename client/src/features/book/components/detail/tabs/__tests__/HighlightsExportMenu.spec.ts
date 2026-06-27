import { mount } from '@vue/test-utils'
import { describe, expect, it, vi, afterEach } from 'vitest'
import HighlightsExportMenu from '../HighlightsExportMenu.vue'
import type { AnnotationItem } from '@bookorbit/types'

function makeHighlight(overrides: Partial<AnnotationItem> = {}): AnnotationItem {
  return {
    id: 1,
    bookId: 5,
    cfi: 'epubcfi(/6/4)',
    jumpFileId: 10,
    pageno: null,
    text: 'highlighted text',
    color: '#FACC15',
    style: 'highlight',
    note: null,
    chapterTitle: 'Chapter 1',
    origin: 'web',
    positionStatus: 'exact',
    chapterIndex: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function setupDownloadMocks() {
  const createObjectURL = vi.fn<(obj: Blob) => string>().mockReturnValue('blob:url')
  const revokeObjectURL = vi.fn<(url: string) => void>()
  const origURL = globalThis.URL
  Object.defineProperty(globalThis, 'URL', {
    value: { ...origURL, createObjectURL, revokeObjectURL },
    writable: true,
    configurable: true,
  })

  const clickMock = vi.fn<() => void>()
  const origCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'a') {
      return { href: '', download: '', click: clickMock } as unknown as HTMLAnchorElement
    }
    return origCreateElement(tag)
  })

  return { createObjectURL, revokeObjectURL, clickMock }
}

const stubs = {
  Popover: { name: 'Popover', props: ['open'], template: '<div><slot /></div>' },
  PopoverTrigger: { template: '<div><slot /></div>' },
  PopoverContent: { template: '<div><slot /></div>' },
}

function mountMenu(items: AnnotationItem[], bookTitle = 'Test Book') {
  return mount(HighlightsExportMenu, {
    props: { items, bookTitle },
    global: { stubs },
  })
}

describe('HighlightsExportMenu', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders export button', () => {
    const wrapper = mountMenu([makeHighlight()])
    expect(wrapper.text()).toContain('Export')
  })

  it('disables button when no items', () => {
    const wrapper = mountMenu([])
    const btn = wrapper.find('button')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('shows export options', () => {
    const wrapper = mountMenu([makeHighlight()])
    expect(wrapper.text()).toContain('Markdown')
    expect(wrapper.text()).toContain('Plain Text')
    expect(wrapper.text()).toContain('JSON')
  })

  it('generates markdown export', async () => {
    const { createObjectURL, clickMock, revokeObjectURL } = setupDownloadMocks()

    const wrapper = mountMenu([makeHighlight({ text: 'my highlight', note: 'my note', chapterTitle: 'Ch 1' })], 'Test Book')

    const mdBtn = wrapper.findAll('button').find((b) => b.text().includes('Markdown'))!
    await mdBtn.trigger('click')

    expect(createObjectURL).toHaveBeenCalled()
    expect(clickMock).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalled()
  })

  it('generates JSON export', async () => {
    const { createObjectURL, clickMock } = setupDownloadMocks()

    const wrapper = mountMenu([makeHighlight()])

    const jsonBtn = wrapper.findAll('button').find((b) => b.text().includes('JSON'))!
    await jsonBtn.trigger('click')

    expect(createObjectURL).toHaveBeenCalled()
    expect(clickMock).toHaveBeenCalled()
  })

  it('generates plain text export', async () => {
    const { createObjectURL, clickMock } = setupDownloadMocks()

    const wrapper = mountMenu([makeHighlight()])

    const txtBtn = wrapper.findAll('button').find((b) => b.text().includes('Plain Text'))!
    await txtBtn.trigger('click')

    expect(createObjectURL).toHaveBeenCalled()
    expect(clickMock).toHaveBeenCalled()
  })

  it('closes menu after export', async () => {
    setupDownloadMocks()

    const wrapper = mountMenu([makeHighlight()])

    const mdBtn = wrapper.findAll('button').find((b) => b.text().includes('Markdown'))!
    await mdBtn.trigger('click')

    expect(wrapper.findComponent({ name: 'Popover' }).props('open')).toBe(false)
  })
})
