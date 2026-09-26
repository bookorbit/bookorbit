import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDetail, CoverMedium } from '@bookorbit/types'
import { api } from '@/lib/api'
import EditMetadataTab from '../EditMetadataTab.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref('en') }),
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<() => void>(), info: vi.fn<() => void>(), warning: vi.fn<() => void>(), error: vi.fn<() => void>() },
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  setOnAuthFailure: vi.fn<(callback: () => void) => void>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))

const panel = {
  hasPending: ref(false),
  pendingMedia: ref<(CoverMedium | null)[]>([]),
  busy: ref(false),
  confirm: vi.fn<(media?: (CoverMedium | null)[]) => Promise<boolean>>(),
  setUrl: vi.fn<(url: string) => void>(),
  reset: vi.fn<() => void>(),
}

const CoverEditorPanelStub = defineComponent({
  name: 'CoverEditorPanel',
  props: ['book', 'lockedFields', 'disabled'],
  emits: ['coverChanged', 'toggleLock'],
  setup(_props, { expose }) {
    expose(panel)
    return {}
  },
  template: '<div data-test="cover-panel" />',
})

const MetadataSearchDrawerStub = defineComponent({
  name: 'MetadataSearchDrawer',
  props: ['book', 'lockedFields'],
  emits: ['close', 'apply'],
  template: '<div data-test="search-drawer" />',
})

function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 7,
    libraryId: 1,
    libraryName: 'Library',
    addedAt: '2024-01-01T00:00:00.000Z',
    updatedAt: null,
    status: 'present',
    title: 'Dune',
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedDate: null,
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    seriesMemberships: [],
    rating: null,
    personalNote: null,
    personalNoteUpdatedAt: null,
    communityRatings: [],
    coverSource: 'extracted',
    coverMedia: ['ebook', 'audio'],
    covers: { ebook: null, audio: null },
    coverVersion: 'v',
    hardcoverEditionId: null,
    providerIds: {},
    authors: [],
    narrators: [],
    genres: [],
    tags: [],
    files: [],
    folderPath: '/books/Dune',
    lastWrittenAt: null,
    metadataScore: null,
    readStatus: null,
    audioMetadata: null,
    formatPriority: [],
    comicMetadata: null,
    customMetadata: [],
    lockedFields: [],
    collections: [],
    ...overrides,
  } as unknown as BookDetail
}

function json(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

function patchCalls() {
  return vi.mocked(api).mock.calls.filter(([, init]) => init?.method === 'PATCH')
}

function mountTab(book: BookDetail) {
  return mount(EditMetadataTab, {
    props: { book },
    global: {
      stubs: {
        CoverEditorPanel: CoverEditorPanelStub,
        MetadataSearchDrawer: MetadataSearchDrawerStub,
        MetadataSourceCard: true,
        MetadataFieldLabel: true,
        RichDescriptionEditor: true,
        SeriesMembershipEditor: true,
        ChipInput: true,
        InputWithSuggestions: true,
        WriteAndRenameResultPanel: true,
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div><slot /></div>' },
      },
    },
  })
}

function saveButton(wrapper: ReturnType<typeof mountTab>) {
  return wrapper.findAll('button').find((button) => button.text().includes('common.save'))!
}

describe('EditMetadataTab cover tiles', () => {
  let savedBook: BookDetail

  beforeEach(() => {
    panel.hasPending.value = false
    panel.pendingMedia.value = []
    panel.busy.value = false
    panel.confirm.mockReset()
    panel.confirm.mockResolvedValue(true)
    panel.setUrl.mockReset()
    panel.reset.mockReset()
    savedBook = makeBook()
    vi.mocked(api).mockReset()
    vi.mocked(api).mockImplementation(async (url, init) => {
      if (init?.method === 'PATCH') return json({ book: savedBook, write: null, libraryAutoWriteEnabled: false })
      if (String(url).includes('/metadata-fetch/providers')) return json([])
      return json({})
    })
  })

  it('enables Save when the only change is an unsaved cover', async () => {
    const wrapper = mountTab(makeBook())
    await flushPromises()
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()

    panel.hasPending.value = true
    panel.pendingMedia.value = ['audio']
    await flushPromises()

    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('does not save the form when a cover fails to save', async () => {
    const wrapper = mountTab(makeBook())
    await flushPromises()
    panel.hasPending.value = true
    panel.pendingMedia.value = ['ebook', 'audio']
    panel.confirm.mockResolvedValue(false)
    await flushPromises()

    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(panel.confirm).toHaveBeenCalledWith(['ebook', 'audio'])
    expect(patchCalls()).toHaveLength(0)
  })

  it('writes a cover whose slot the form unlocks only after the form save', async () => {
    const wrapper = mountTab(makeBook({ lockedFields: ['audioCover'] }))
    await flushPromises()
    wrapper.getComponent(CoverEditorPanelStub).vm.$emit('toggleLock', 'audioCover')
    panel.hasPending.value = true
    panel.pendingMedia.value = ['ebook', 'audio']
    savedBook = makeBook({ lockedFields: [] })
    await flushPromises()

    const order: string[] = []
    panel.confirm.mockImplementation(async (media) => {
      order.push(`covers:${(media ?? []).join(',')}`)
      return true
    })
    vi.mocked(api).mockImplementation(async (url, init) => {
      if (init?.method === 'PATCH') {
        order.push('form')
        return json({ book: savedBook, write: null, libraryAutoWriteEnabled: false })
      }
      return json([])
    })

    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(order).toEqual(['covers:ebook', 'form', 'covers:audio'])
    expect(JSON.parse(String(patchCalls()[0]![1]!.body)).lockedFields).toEqual([])
  })

  it('clears the unsaved covers with the rest of the form', async () => {
    const wrapper = mountTab(makeBook())
    await flushPromises()
    panel.hasPending.value = true
    await flushPromises()

    await wrapper.get('[aria-label="common.cancel"]').trigger('click')

    expect(panel.reset).toHaveBeenCalledTimes(1)
  })

  it('passes each tile lock from the form, and toggles the one a tile asks for', async () => {
    const wrapper = mountTab(makeBook({ lockedFields: ['cover'] }))
    await flushPromises()

    expect(wrapper.getComponent(CoverEditorPanelStub).props('lockedFields')).toEqual(['cover'])
    wrapper.getComponent(CoverEditorPanelStub).vm.$emit('toggleLock', 'audioCover')
    await flushPromises()

    expect(wrapper.getComponent(CoverEditorPanelStub).props('lockedFields')).toEqual(['cover', 'audioCover'])
  })

  it('checks the audiobook cover lock before applying a searched cover to a book without an ebook', async () => {
    const wrapper = mountTab(makeBook({ coverMedia: ['audio'], lockedFields: ['audioCover'] }))
    await flushPromises()
    await wrapper.get('[aria-label="common.search"]').trigger('click')

    wrapper.getComponent(MetadataSearchDrawerStub).vm.$emit('apply', { formPatch: {}, coverUrl: 'https://example.com/square.jpg' })
    await flushPromises()

    expect(panel.setUrl).not.toHaveBeenCalled()
  })

  it('applies a searched cover to the panel when its slot is unlocked', async () => {
    const wrapper = mountTab(makeBook({ lockedFields: ['audioCover'] }))
    await flushPromises()
    await wrapper.get('[aria-label="common.search"]').trigger('click')

    wrapper.getComponent(MetadataSearchDrawerStub).vm.$emit('apply', { formPatch: {}, coverUrl: 'https://example.com/portrait.jpg' })
    await flushPromises()

    expect(panel.setUrl).toHaveBeenCalledWith('https://example.com/portrait.jpg', 'ebook')
  })

  it('stages each searched cover on its own tile, skipping a locked one', async () => {
    const wrapper = mountTab(makeBook({ coverMedia: ['ebook', 'audio'], lockedFields: ['cover'] }))
    await flushPromises()
    await wrapper.get('[aria-label="common.search"]').trigger('click')

    wrapper
      .getComponent(MetadataSearchDrawerStub)
      .vm.$emit('apply', { formPatch: {}, coverUrl: 'https://example.com/portrait.jpg', audioCoverUrl: 'https://example.com/square.jpg' })
    await flushPromises()

    expect(panel.setUrl).toHaveBeenCalledTimes(1)
    expect(panel.setUrl).toHaveBeenCalledWith('https://example.com/square.jpg', 'audio')
  })

  it('reports a cover change with its medium', async () => {
    const wrapper = mountTab(makeBook())
    await flushPromises()

    wrapper.getComponent(CoverEditorPanelStub).vm.$emit('coverChanged', 'audio')

    expect(wrapper.emitted('coverChanged')).toEqual([['audio']])
  })
})
