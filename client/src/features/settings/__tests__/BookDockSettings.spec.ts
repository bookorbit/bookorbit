import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, watch } from 'vue'

import type { BookDockSettings as BookDockSettingsResponse, LibraryDocksAdmin } from '@bookorbit/types'

const { apiMock, fetchLibrariesMock, toastErrorMock } = vi.hoisted(() => ({
  apiMock: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  fetchLibrariesMock: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  toastErrorMock: vi.fn<(message: string) => void>(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: ref([
      {
        id: 4,
        name: 'Library',
        folders: [{ id: 8, path: '/books' }],
      },
    ]),
    fetchLibraries: fetchLibrariesMock,
  }),
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))
vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(message: string) => void>(),
    error: toastErrorMock,
  },
}))

import BookDockSettings from '../BookDockSettings.vue'

const settings: BookDockSettingsResponse = {
  bookDockPath: '/data/private-book-dock',
  autoFetchMetadata: true,
  autoFinalizeEnabled: true,
  autoFinalizeThreshold: 85,
  autoFinalizeLibraryId: 4,
  autoFinalizeFolderId: 8,
  autoFinalizeMetadataMode: 'safe_merge',
}

const effective = {
  autoFetchMetadata: true,
  autoFinalizeEnabled: true,
  autoFinalizeThreshold: 85,
  autoFinalizeMetadataMode: 'safe_merge' as const,
  autoJoin: false,
  keepOriginal: false,
}
const noOverrides = { autoFetchMetadata: null, autoFinalizeEnabled: null, autoFinalizeThreshold: null, autoFinalizeMetadataMode: null }

const admin: LibraryDocksAdmin = {
  librariesPath: '/data/private-book-dock/_libraries',
  libraries: [
    {
      libraryId: 4,
      libraryName: 'Library',
      folders: [{ id: 8, path: '/books' }],
      dock: {
        id: 7,
        libraryId: 4,
        libraryName: 'Library',
        folderName: 'Library',
        enabled: true,
        targetFolderId: 8,
        overrides: noOverrides,
        autoJoin: false,
        keepOriginal: false,
      },
      effective,
      suggestedFolderName: null,
      folderPresent: true,
    },
    {
      libraryId: 5,
      libraryName: 'Kids',
      folders: [{ id: 9, path: '/kids' }],
      dock: null,
      effective,
      suggestedFolderName: 'Kids',
      folderPresent: false,
    },
  ],
  unrecognisedFolders: [],
  strayFiles: [],
  strayFilesTruncated: false,
  librariesFolderIsBook: false,
}

function response(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 403,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
  } as unknown as Response
}

/** The real sheet and dialog teleport into overlays; these keep their content in the tree. */
const FormSheetStub = defineComponent({
  props: { open: Boolean },
  emits: ['submit', 'opened', 'update:open'],
  setup(props, { emit, slots }) {
    watch(
      () => props.open,
      (open) => open && emit('opened'),
      { immediate: true },
    )
    return () =>
      props.open
        ? h('div', { 'data-testid': 'form-sheet' }, [
            slots.default?.(),
            h('button', { 'data-testid': 'sheet-submit', onClick: () => emit('submit') }),
          ])
        : null
  },
})
const ConfirmDialogStub = defineComponent({
  emits: ['confirm', 'cancel'],
  setup(_, { emit, slots }) {
    return () =>
      h('div', { 'data-testid': 'confirm-dialog' }, [slots.default?.(), h('button', { 'data-testid': 'confirm-ok', onClick: () => emit('confirm') })])
  },
})

async function mountSettings() {
  const wrapper = mount(BookDockSettings, {
    props: { embedded: true },
    global: { stubs: { FormSheet: FormSheetStub, ConfirmDialog: ConfirmDialogStub } },
  })
  await flushPromises()
  return wrapper
}

function putBodies(url: string): unknown[] {
  return apiMock.mock.calls.filter(([called, init]) => called === url && init?.method === 'PUT').map(([, init]) => JSON.parse(String(init?.body)))
}

describe('BookDockSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchLibrariesMock.mockResolvedValue(undefined)
    apiMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/book-dock/settings' && init?.method === 'PUT') return response({ ...settings, ...JSON.parse(String(init.body)) })
      if (url === '/api/v1/book-dock/docks/admin') return response(admin)
      if (url === '/api/v1/book-dock/docks') return response({ docks: [] })
      if (url === '/api/v1/book-dock/docks/filing-check') return response({ checks: [{ libraryId: 4, filing: 'copy' }] })
      if (url.startsWith('/api/v1/book-dock/docks/') && init?.method === 'PUT') return response(admin.libraries[0])
      return response(settings)
    })
  })

  it('loads the protected settings contract and renders its scoped path', async () => {
    const wrapper = await mountSettings()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/book-dock/settings')
    expect(fetchLibrariesMock).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-testid="book-dock-path"]').text()).toBe('/data/private-book-dock')
    expect(apiMock.mock.calls.some(([url]) => url === '/api/v1/app-info' || url === '/api/v1/app-settings')).toBe(false)
  })

  it('shows the drop folder, the defaults and the docks, each heading close to its content', async () => {
    const wrapper = await mountSettings()
    const sections = wrapper.findAll('section[aria-labelledby^="book-dock-"]')

    expect(sections).toHaveLength(3)
    for (const section of sections) {
      expect(section.classes()).toContain('space-y-2')
      expect(section.get('.settings-group-label').classes()).not.toContain('mb-0')
    }
  })

  it('updates the complete typed settings document through the protected endpoint', async () => {
    const wrapper = await mountSettings()

    await wrapper.findAll('[role="switch"]')[0]!.trigger('click')
    await flushPromises()

    expect(putBodies('/api/v1/book-dock/settings')).toEqual([
      {
        autoFetchMetadata: false,
        autoFinalizeEnabled: true,
        autoFinalizeThreshold: 85,
        autoFinalizeLibraryId: 4,
        autoFinalizeFolderId: 8,
        autoFinalizeMetadataMode: 'safe_merge',
        unsortedAutoJoin: false,
        unsortedKeepOriginal: false,
      },
    ])
  })

  it('explains the chosen metadata mode under its select and follows a change', async () => {
    const wrapper = await mountSettings()
    const select = wrapper.get('select[aria-describedby="book-dock-metadata-mode-hint"]')
    const hint = () => wrapper.get('#book-dock-metadata-mode-hint').text()
    const safeMerge = hint()

    await select.setValue('embedded_only')
    await flushPromises()

    expect(safeMerge).not.toBe('')
    expect(hint()).not.toBe(safeMerge)
    expect(putBodies('/api/v1/book-dock/settings').at(-1)).toMatchObject({ autoFinalizeMetadataMode: 'embedded_only' })
  })

  it('reports a failed update without applying the optimistic value', async () => {
    apiMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/book-dock/settings' && init?.method === 'PUT') return response({}, false)
      if (url === '/api/v1/book-dock/docks/admin') return response(admin)
      return response(settings)
    })
    const wrapper = await mountSettings()

    await wrapper.findAll('[role="switch"]')[0]!.trigger('click')
    await flushPromises()

    expect(toastErrorMock).toHaveBeenCalledOnce()
    expect(wrapper.findAll('[role="switch"]')[0]!.attributes('aria-checked')).toBe('true')
  })

  it('lists Unsorted first, then libraries with a dock, then the rest, with how each files', async () => {
    const wrapper = await mountSettings()
    const rows = wrapper.findAll('[data-testid="library-docks-table"] tbody tr')

    expect(rows.map((row) => row.attributes('data-testid'))).toEqual(['library-docks-row-unsorted', 'library-docks-row-4', 'library-docks-row-5'])
    expect(rows[1]!.text()).toContain('_libraries/Library')
    expect(rows[1]!.text()).toContain('Copy')
    expect(rows[2]!.text()).toContain('No dock')
    expect(wrapper.find('[data-testid="library-docks-edit-5"]').exists()).toBe(false)
  })

  it('moves the destination for files without one into the Unsorted panel and can clear it', async () => {
    const wrapper = await mountSettings()

    await wrapper.get('[data-testid="library-docks-edit-unsorted"]').trigger('click')
    const librarySelect = wrapper.get('[data-testid="library-dock-unsorted-library"]')
    ;(librarySelect.element as HTMLSelectElement).selectedIndex = 0
    await librarySelect.trigger('change')
    await wrapper.get('[data-testid="sheet-submit"]').trigger('click')
    await flushPromises()

    expect(putBodies('/api/v1/book-dock/settings').at(-1)).toMatchObject({ autoFinalizeLibraryId: null, autoFinalizeFolderId: null })
  })

  it("saves only what changed in a dock's panel, and a default goes back to null", async () => {
    const wrapper = await mountSettings()

    await wrapper.get('[data-testid="library-docks-edit-4"]').trigger('click')
    await wrapper.get('[data-testid="library-dock-own-threshold"]').trigger('click')
    await wrapper.get('[data-testid="sheet-submit"]').trigger('click')
    await flushPromises()

    expect(putBodies('/api/v1/book-dock/docks/4')).toEqual([{ autoFinalizeThreshold: 85 }])
  })

  it('asks for a folder before turning on the dock of a library that has none', async () => {
    const wrapper = await mountSettings()

    await wrapper.get('[data-testid="library-docks-toggle-5"]').trigger('click')
    expect(putBodies('/api/v1/book-dock/docks/5')).toEqual([])
    expect((wrapper.get('[data-testid="library-dock-turn-on-folder"]').element as HTMLInputElement).value).toBe('Kids')

    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()

    expect(putBodies('/api/v1/book-dock/docks/5')).toEqual([{ enabled: true, folderName: 'Kids', targetFolderId: 9 }])
  })
})
