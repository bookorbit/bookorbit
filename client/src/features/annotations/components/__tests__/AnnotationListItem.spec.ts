import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import type { AnnotationItem } from '@bookorbit/types'
import AnnotationListItem from '../AnnotationListItem.vue'

const stubs = {
  RouterLink: { template: '<a><slot /></a>' },
  Tooltip: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div><slot /></div>' },
  AnnotationBookThumb: { template: '<div class="book-thumb" />' },
  AnnotationSyncDetailPanel: { template: '<div class="sync-detail" />' },
  HighlightNoteEditor: {
    template: '<div class="note-editor"><button class="save" type="button" @click="$emit(\'save\', \'edited\')">save</button></div>',
  },
}

function makeAnnotation(overrides: Partial<AnnotationItem> = {}): AnnotationItem {
  return {
    id: 1,
    bookId: 5,
    cfi: 'epubcfi(/6/4!/4/2/1:0)',
    jumpFileId: 9,
    pageno: 3,
    text: 'a short highlight',
    color: '#FACC15',
    style: 'highlight',
    note: 'my note',
    chapterTitle: 'Chapter 1',
    origin: 'web',
    positionStatus: 'exact',
    chapterIndex: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function mountItem(props: Record<string, unknown> = {}) {
  return mount(AnnotationListItem, { props: { annotation: makeAnnotation(), ...props }, global: { stubs } })
}

function iconButton(wrapper: VueWrapper, iconClass: string) {
  return wrapper.findAll('button').find((button) => button.find(`.${iconClass}`).exists())
}

describe('AnnotationListItem', () => {
  it('renders the quote and the note', () => {
    const wrapper = mountItem()
    expect(wrapper.text()).toContain('a short highlight')
    expect(wrapper.text()).toContain('my note')
  })

  it('emits toggleSelect when the checkbox changes', async () => {
    const wrapper = mountItem()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(wrapper.emitted('toggleSelect')!.slice(-1)[0]).toEqual([1])
  })

  it('requires a confirm step before trashing in book mode', async () => {
    const wrapper = mountItem({ mode: 'book' })
    await iconButton(wrapper, 'lucide-trash-2')!.trigger('click')
    expect(wrapper.emitted('trash')).toBeFalsy()

    const confirm = wrapper.findAll('button').find((button) => button.text() === 'Trash')
    await confirm!.trigger('click')
    expect(wrapper.emitted('trash')!.slice(-1)[0]).toEqual([1])
  })

  it('trashes immediately in hub mode', async () => {
    const wrapper = mountItem({ mode: 'hub' })
    await iconButton(wrapper, 'lucide-trash-2')!.trigger('click')
    expect(wrapper.emitted('trash')!.slice(-1)[0]).toEqual([1])
  })

  it('exposes restore and purge actions when trashed', async () => {
    const wrapper = mountItem({ trashed: true })
    await iconButton(wrapper, 'lucide-archive-restore')!.trigger('click')
    expect(wrapper.emitted('restore')!.slice(-1)[0]).toEqual([1])
    await iconButton(wrapper, 'lucide-trash-2')!.trigger('click')
    expect(wrapper.emitted('purge')!.slice(-1)[0]).toEqual([1])
  })

  it('emits jump when a reader location is available', async () => {
    const wrapper = mountItem({ mode: 'hub' })
    await iconButton(wrapper, 'lucide-book-open')!.trigger('click')
    expect(wrapper.emitted('jump')).toBeTruthy()
  })

  it('emits updateColor from the style panel only when the color differs', async () => {
    const wrapper = mountItem()
    await iconButton(wrapper, 'lucide-palette')!.trigger('click')
    await wrapper.get('button[title="Green"]').trigger('click')
    expect(wrapper.emitted('updateColor')!.slice(-1)[0]).toEqual([1, '#4ADE80'])
  })

  it('emits updateNote when the note editor saves', async () => {
    const wrapper = mountItem()
    await iconButton(wrapper, 'lucide-file-pen')!.trigger('click')
    await wrapper.get('.note-editor .save').trigger('click')
    expect(wrapper.emitted('updateNote')!.slice(-1)[0]).toEqual([1, 'edited'])
  })

  it('copies the quote text to the clipboard', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const wrapper = mountItem()
    await iconButton(wrapper, 'lucide-copy')!.trigger('click')
    expect(writeText).toHaveBeenCalledWith('a short highlight')
  })

  it('toggles expansion for long quotes', async () => {
    const wrapper = mountItem({ annotation: makeAnnotation({ text: 'x'.repeat(300) }) })
    const expand = wrapper.findAll('button').find((button) => button.text().includes('Expand'))
    expect(expand).toBeTruthy()
    await expand!.trigger('click')
    expect(wrapper.findAll('button').some((button) => button.text().includes('Collapse'))).toBe(true)
  })
})
