import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryDocksAdmin } from '@bookorbit/types'
import BookDockAttention from '../BookDockAttention.vue'

const { adoptMock, moveMock, removeMock } = vi.hoisted(() => ({
  adoptMock: vi.fn<(name: string, libraryId: number) => Promise<{ ok: boolean; errorCode?: string | null }>>(),
  moveMock: vi.fn<(name: string) => Promise<{ ok: boolean; errorCode?: string | null }>>(),
  removeMock: vi.fn<(name: string) => Promise<{ ok: boolean; errorCode?: string | null }>>(),
}))
vi.mock('../../api/book-dock.api', () => ({
  adoptLibraryDockFolder: adoptMock,
  moveLibraryDockFolderToUnsorted: moveMock,
  removeLibraryDockFolder: removeMock,
}))

const admin: LibraryDocksAdmin = {
  librariesPath: '/dock/_libraries',
  libraries: [
    {
      libraryId: 14,
      libraryName: 'Kids',
      folders: [],
      dock: null,
      effective: {
        autoFetchMetadata: true,
        autoFinalizeEnabled: true,
        autoFinalizeThreshold: 85,
        autoFinalizeMetadataMode: 'safe_merge',
        autoJoin: false,
        keepOriginal: false,
      },
      suggestedFolderName: 'Kids',
      folderPresent: false,
    },
  ],
  unrecognisedFolders: [
    { name: 'kids', matchesLibraryId: 14 },
    { name: 'Sci-fi', matchesLibraryId: null },
  ],
  strayFiles: ['loose.epub', 'other.pdf'],
  strayFilesTruncated: false,
  librariesFolderIsBook: false,
}

function mountAttention(value: LibraryDocksAdmin = admin) {
  return mount(BookDockAttention, { props: { admin: value }, global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
}

describe('BookDockAttention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists each folder no dock owns and the loose files', () => {
    const wrapper = mountAttention()

    expect(wrapper.findAll('li')).toHaveLength(3)
    expect(wrapper.text()).toContain('Matches Kids, which has no dock.')
    expect(wrapper.text()).toContain('2 files')
  })

  it("turns on the matching library's dock with its folder", async () => {
    adoptMock.mockResolvedValue({ ok: true })
    const wrapper = mountAttention()

    await wrapper.get('[data-testid="book-dock-attention-adopt-kids"]').trigger('click')
    await flushPromises()

    expect(adoptMock).toHaveBeenCalledWith('kids', 14)
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('says why a folder with files in it was not removed', async () => {
    removeMock.mockResolvedValue({ ok: false, errorCode: 'LIBRARY_DOCK_FOLDER_NOT_EMPTY' })
    const wrapper = mountAttention()

    await wrapper.get('[data-testid="book-dock-attention-remove-Sci-fi"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toBe('Sci-fi still has files in it, so it was not removed.')
    expect(wrapper.emitted('changed')).toBeUndefined()
  })

  it('shows nothing when every folder has a dock', () => {
    const wrapper = mountAttention({ ...admin, unrecognisedFolders: [], strayFiles: [] })

    expect(wrapper.find('section').exists()).toBe(false)
  })
})
