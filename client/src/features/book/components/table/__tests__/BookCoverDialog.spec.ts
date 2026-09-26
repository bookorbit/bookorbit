import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCard, BookDetail, BookMetadataLockField } from '@bookorbit/types'
import BookCoverDialog from '../BookCoverDialog.vue'

const detail = ref<BookDetail | null>(null)
const loading = ref(false)
const fetchDetail = vi.fn<(bookId: number) => Promise<void>>()
const lockedFields = ref<BookMetadataLockField[]>([])
const toggle = vi.fn<(bookId: number, field: BookMetadataLockField) => Promise<void>>()
const editorPending = ref(false)

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@vueuse/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vueuse/core')>()),
  useBreakpoints: () => ({ md: ref(true) }),
}))

vi.mock('../../../composables/useBookDetail', () => ({
  useBookDetail: () => ({ detail, loading, fetch: fetchDetail }),
}))

vi.mock('../../../composables/useMetadataLocks', () => ({
  useMetadataLocks: () => ({ lockedFields, toggle, load: vi.fn<() => void>() }),
}))

vi.mock('../../../composables/useCoverVersions', () => ({
  useCoverVersions: () => ({ coverUrl: (bookId: number, _type: string, version?: string) => `/cover/${bookId}?t=${version}` }),
}))

const CoverEditorPanelStub = defineComponent({
  name: 'CoverEditorPanel',
  props: ['book', 'lockedFields'],
  emits: ['coverChanged', 'toggleLock'],
  setup(_props, { expose }) {
    expose({ hasPending: editorPending })
    return {}
  },
  template: '<div data-test="editor" />',
})

const card = { id: 5, title: 'Dune', hasCover: false, coverVersion: 'card-version' } as unknown as BookCard

function makeDetail(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 5,
    title: 'Dune',
    coverSource: null,
    coverMedia: ['ebook', 'audio'],
    covers: { ebook: null, audio: null },
    coverVersion: 'detail-version',
    lockedFields: [],
    ...overrides,
  } as unknown as BookDetail
}

function mountDialog() {
  return mount(BookCoverDialog, {
    props: { book: card, readOnly: false },
    global: {
      stubs: {
        DialogRoot: { template: '<div><slot /></div>' },
        DialogPortal: { template: '<div><slot /></div>' },
        DialogOverlay: { template: '<div />' },
        DialogContent: { template: '<div><slot /></div>' },
        DialogTitle: { template: '<div><slot /></div>' },
        DialogDescription: { template: '<div><slot /></div>' },
        DialogClose: { template: '<button><slot /></button>' },
        BookCoverPlaceholder: true,
        CoverEditorPanel: CoverEditorPanelStub,
      },
    },
  })
}

async function openEditor(wrapper: ReturnType<typeof mountDialog>) {
  const edit = wrapper.findAll('button').find((button) => button.text().includes('book.table.cover.editCover'))!
  await edit.trigger('click')
  await flushPromises()
}

describe('BookCoverDialog', () => {
  beforeEach(() => {
    detail.value = null
    loading.value = false
    editorPending.value = false
    lockedFields.value = []
    fetchDetail.mockReset()
    fetchDetail.mockImplementation(async () => {
      detail.value = makeDetail()
    })
    toggle.mockReset()
  })

  it('loads the detail and passes its locks to the editor', async () => {
    lockedFields.value = ['audioCover']
    const wrapper = mountDialog()

    await openEditor(wrapper)

    expect(fetchDetail).toHaveBeenCalledWith(5)
    expect(wrapper.getComponent(CoverEditorPanelStub).props('lockedFields')).toEqual(['audioCover'])
  })

  it('toggles the lock of the tile that asked', async () => {
    const wrapper = mountDialog()
    await openEditor(wrapper)

    wrapper.getComponent(CoverEditorPanelStub).vm.$emit('toggleLock', 'audioCover')
    await flushPromises()

    expect(toggle).toHaveBeenCalledWith(5, 'audioCover')
  })

  it('refetches after a save and reports whether the book now has a cover', async () => {
    const wrapper = mountDialog()
    await openEditor(wrapper)
    fetchDetail.mockImplementation(async () => {
      detail.value = makeDetail({ coverSource: 'custom', coverVersion: 'after-save' })
    })

    wrapper.getComponent(CoverEditorPanelStub).vm.$emit('coverChanged', 'audio')
    await flushPromises()

    expect(fetchDetail).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('update:book')).toEqual([[5, true]])
    expect(wrapper.find('[data-test="editor"]').exists()).toBe(false)
    expect(wrapper.get('img').attributes('src')).toBe('/cover/5?t=after-save')
  })

  it('reports a cleared cover as no cover', async () => {
    const wrapper = mountDialog()
    await openEditor(wrapper)
    fetchDetail.mockImplementation(async () => {
      detail.value = makeDetail({ coverSource: null })
    })

    wrapper.getComponent(CoverEditorPanelStub).vm.$emit('coverChanged', 'ebook')
    await flushPromises()

    expect(wrapper.emitted('update:book')).toEqual([[5, false]])
  })

  it('keeps the editor open while the other tile still has an unsaved image', async () => {
    const wrapper = mountDialog()
    await openEditor(wrapper)
    editorPending.value = true
    fetchDetail.mockImplementation(async () => {
      loading.value = true
      await Promise.resolve()
      detail.value = makeDetail({ coverSource: 'custom' })
      loading.value = false
    })

    wrapper.getComponent(CoverEditorPanelStub).vm.$emit('coverChanged', 'ebook')
    await flushPromises()

    expect(wrapper.find('[data-test="editor"]').exists()).toBe(true)
  })

  it('does not unmount the editor while it refetches', async () => {
    const wrapper = mountDialog()
    await openEditor(wrapper)
    editorPending.value = true
    let finishFetch!: () => void
    fetchDetail.mockImplementation(() => {
      loading.value = true
      return new Promise<void>((resolve) => {
        finishFetch = () => {
          loading.value = false
          resolve()
        }
      })
    })

    wrapper.getComponent(CoverEditorPanelStub).vm.$emit('coverChanged', 'ebook')
    await flushPromises()

    expect(wrapper.find('[data-test="editor"]').exists()).toBe(true)
    finishFetch()
    await flushPromises()
  })
})
