import { describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import type { BookDockFile } from '@bookorbit/types'
import BookDockView from '../BookDockView.vue'

const { route, replaceMock, access } = vi.hoisted(() => ({
  access: { manager: false },
  route: { query: {} as Record<string, string> },
  replaceMock: vi.fn<(location: { query: Record<string, string> }) => Promise<void>>(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ replace: replaceMock }),
}))

const fictionTarget = { dockId: 7, libraryId: 3, libraryName: 'Fiction', allowedFormats: ['epub'] }

vi.mock('@/features/book-dock/composables/useLibraryDocks', () => ({
  useLibraryDocks: () => ({
    docks: ref([{ ...fictionTarget, enabled: true, entry: null }]),
    admin: ref({
      librariesPath: '/dock/_libraries',
      libraries: [],
      unrecognisedFolders: [{ name: 'old', matchesLibraryId: null }],
      strayFiles: [],
      strayFilesTruncated: false,
      librariesFolderIsBook: false,
    }),
    filing: ref(new Map()),
    refreshDocks: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    refreshFiling: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    dockById: (id: number) => (id === 7 ? { ...fictionTarget, enabled: true, entry: null } : undefined),
    uploadTargetFor: (id: number) => (id === 7 ? fictionTarget : undefined),
  }),
}))

const apiMock = vi.fn<(url: string) => Promise<Response>>(
  async (_url: string) =>
    ({
      ok: true,
      json: async () => ({ items: [], total: 7000, page: 1, size: 20 }),
    }) as Response,
)

vi.mock('@/lib/api', () => ({ api: (url: string) => apiMock(url) }))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ isDemoRestrictedAccount: ref(false), hasPermission: () => access.manager }),
}))
const onBookDockChangeMock = vi.fn<(listener: () => void) => () => void>(() => vi.fn<() => void>())
vi.mock('@/features/book-dock/composables/useBookDockSummary', () => ({
  useBookDockSummary: () => ({
    summary: ref({ total: 7000, paused: false }),
    fetchSummary: vi.fn<() => void>(),
    subscribe: vi.fn<() => void>(),
    onBookDockChange: onBookDockChangeMock,
    socketConnected: ref(true),
  }),
}))
vi.mock('@/features/book-dock/composables/useBookDockStatistics', () => ({
  useBookDockStatistics: () => ({ statistics: ref(null), fetchStatistics: vi.fn<() => void>() }),
}))
const { addFilesMock } = vi.hoisted(() => ({ addFilesMock: vi.fn<(files: FileList | File[], target?: unknown) => void>() }))

vi.mock('@/features/book-dock/composables/useBookDockUpload', () => ({
  useBookDockUpload: () => ({ addFiles: addFilesMock, isUploading: ref(false) }),
  SUPPORTED_FORMATS: ['epub'],
  SUPPORTED_FORMATS_ACCEPT: '.epub',
}))
vi.mock('@/features/book-dock/composables/useBookDockConflicts', () => ({
  useBookDockConflicts: () => ({ conflicts: ref([]), scheduleConflicts: vi.fn<() => void>(), cancelConflicts: vi.fn<() => void>() }),
}))

describe('BookDockView pagination', () => {
  it('keeps a 7000-file dock navigable without rendering hundreds of buttons', async () => {
    const wrapper = shallowMount(BookDockView, { global: { stubs: { PaginationNav: false } } })
    await vi.waitFor(() => expect(wrapper.findAll('nav button')).toHaveLength(6))

    expect(
      wrapper
        .findAll('nav button')
        .map((button) => button.text())
        .filter(Boolean),
    ).toEqual(['1', '2', '349', '350'])
    expect(wrapper.get('[aria-current="page"]').text()).toBe('1')
    expect(String(apiMock.mock.calls[0]?.[0])).toContain('limit=20')

    await wrapper.get('[aria-label="Go to page 350"]').trigger('click')
    await vi.waitFor(() => expect(String(apiMock.mock.calls.at(-1)?.[0])).toContain('page=350'))
    expect(wrapper.get('[aria-current="page"]').text()).toBe('350')
    wrapper.unmount()
  })
})

describe('BookDockView uploads', () => {
  it('shows the upload failures panel on the page', () => {
    const wrapper = shallowMount(BookDockView)

    expect(wrapper.findComponent({ name: 'BookDockUploadFailures' }).exists()).toBe(true)
    wrapper.unmount()
  })

  it('hands every dropped file to the uploader, including ones it will refuse, so the refusal is reported', async () => {
    addFilesMock.mockClear()
    const wrapper = shallowMount(BookDockView)
    const files = [new File(['x'], 'dune.epub'), new File(['x'], 'notes.docx')]

    await wrapper.get('main').trigger('drop', { dataTransfer: { files } })

    expect(addFilesMock).toHaveBeenCalledTimes(1)
    expect([...addFilesMock.mock.calls[0]![0]].map((file) => file.name)).toEqual(['dune.epub', 'notes.docx'])
    wrapper.unmount()
  })

  it('ignores a drop that carries no files', async () => {
    addFilesMock.mockClear()
    const wrapper = shallowMount(BookDockView)

    await wrapper.get('main').trigger('drop', { dataTransfer: { files: [] } })

    expect(addFilesMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('BookDockView editor', () => {
  it('refreshes an open editor when extraction moves the file off the current list', async () => {
    const pending: BookDockFile = {
      id: 1,
      fileName: 'Dune.epub',
      fileSize: 1024,
      format: 'epub',
      status: 'pending',
      embeddedMetadata: null,
      selectedMetadata: null,
      fetchedMetadata: null,
      targetLibraryId: null,
      targetFolderId: null,
      confidence: null,
      fetchedMetadataSources: null,
      errorMessage: null,
      metadataEditedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      unitFiles: [],
    }
    const ready: BookDockFile = {
      ...pending,
      status: 'ready',
      embeddedMetadata: { title: 'Dune', authors: ['Frank Herbert'] },
      updatedAt: '2026-01-01T00:01:00.000Z',
    }
    let extracted = false
    await apiMock.withImplementation(
      async (url) => {
        const file = extracted ? ready : pending
        const items = extracted ? [] : [pending]
        const data = url === '/api/v1/book-dock/files/1' ? file : { items, total: items.length, page: 1, size: 20 }
        return { ok: true, json: async () => data } as Response
      },
      async () => {
        const wrapper = shallowMount(BookDockView, { global: { stubs: { Teleport: true } } })
        await flushPromises()
        wrapper.getComponent({ name: 'BookDockFileListView' }).vm.$emit('open', pending)
        await flushPromises()
        const editedFile = () => wrapper.getComponent({ name: 'BookDockFileSheet' }).props('file')
        expect(editedFile()).toEqual(pending)

        extracted = true
        onBookDockChangeMock.mock.lastCall![0]()
        await vi.waitFor(() => expect(editedFile()).toEqual(ready))
        wrapper.unmount()
      },
    )
  })
})

describe('BookDockView docks', () => {
  function resetRoute(query: Record<string, string> = {}) {
    route.query = reactive(query)
    apiMock.mockClear()
    replaceMock.mockClear()
    addFilesMock.mockClear()
  }

  it('opens on the dock the link names', async () => {
    resetRoute({ dock: '7' })
    const wrapper = shallowMount(BookDockView)

    await vi.waitFor(() => expect(apiMock.mock.calls.some(([url]) => url.startsWith('/api/v1/book-dock/files?'))).toBe(true))
    const filesUrl = apiMock.mock.calls.map(([url]) => url).find((url) => url.startsWith('/api/v1/book-dock/files?'))
    expect(filesUrl).toContain('dock=7')
    expect(wrapper.findComponent({ name: 'BookDockSwitcher' }).props('current')).toBe(7)
    wrapper.unmount()
  })

  it('reads an unknown dock in the link as every dock', async () => {
    resetRoute({ dock: 'fiction' })
    const wrapper = shallowMount(BookDockView)

    await vi.waitFor(() => expect(apiMock).toHaveBeenCalled())
    const filesUrl = apiMock.mock.calls.map(([url]) => url).find((url) => url.startsWith('/api/v1/book-dock/files?'))
    expect(filesUrl).not.toContain('dock=')
    wrapper.unmount()
  })

  it('puts the chosen dock in the address and loads its files', async () => {
    resetRoute()
    const wrapper = shallowMount(BookDockView)

    wrapper.findComponent({ name: 'BookDockSwitcher' }).vm.$emit('select', 'unsorted')

    await vi.waitFor(() => expect(replaceMock).toHaveBeenCalledWith({ query: { dock: 'unsorted' } }))
    await vi.waitFor(() => expect(apiMock.mock.calls.at(-1)?.[0]).toContain('dock=unsorted'))
    wrapper.unmount()
  })

  it('uploads what is dropped into the dock being viewed', async () => {
    resetRoute({ dock: '7' })
    const wrapper = shallowMount(BookDockView)
    const files = [new File(['x'], 'dune.epub')]

    await wrapper.get('main').trigger('drop', { dataTransfer: { files } })

    expect(addFilesMock).toHaveBeenCalledWith(files, fictionTarget)
    wrapper.unmount()
  })

  it('sends a drop on every dock to Unsorted', async () => {
    resetRoute()
    const wrapper = shallowMount(BookDockView)
    const files = [new File(['x'], 'dune.epub')]

    await wrapper.get('main').trigger('drop', { dataTransfer: { files } })

    expect(addFilesMock).toHaveBeenCalledWith(files, null)
    wrapper.unmount()
  })
})

describe('BookDockView manager controls', () => {
  it('shows dock facts and the folders that need attention only to a dock manager', async () => {
    for (const manager of [false, true]) {
      access.manager = manager
      route.query = reactive({ dock: '7' })
      const docked = shallowMount(BookDockView)
      await flushPromises()
      expect(docked.findComponent({ name: 'BookDockFacts' }).exists()).toBe(manager)
      docked.unmount()

      route.query = reactive({})
      const all = shallowMount(BookDockView)
      await flushPromises()
      expect(all.findComponent({ name: 'BookDockAttention' }).exists()).toBe(manager)
      all.unmount()
    }
    access.manager = false
  })
})
