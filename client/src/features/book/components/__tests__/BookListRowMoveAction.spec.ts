import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCard } from '@bookorbit/types'

import BookListRow from '../BookListRow.vue'

const { hasPermissionMock } = vi.hoisted(() => ({ hasPermissionMock: vi.fn<(permission: string) => boolean>() }))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: hasPermissionMock, isDemoRestrictedAccount: { value: false } }),
}))

const book: BookCard = {
  id: 12,
  status: 'present',
  coverAspectRatio: '2/3',
  title: 'Dune',
  authors: ['Frank Herbert'],
  seriesName: null,
  seriesIndex: null,
  files: [],
  publishedDate: null,
  publishedYear: null,
  language: null,
  genres: [],
  tags: [],
  rating: null,
  readingProgress: null,
  readStatus: null,
  addedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: null,
  metadataScore: null,
  hasCover: false,
  hasMetadataLocks: false,
  lockedFields: [],
  subtitle: null,
  publisher: null,
  pageCount: null,
  isbn13: null,
  narrators: [],
  customMetadata: [],
}

function mountRow(allowMoveToLibrary: boolean) {
  return mount(BookListRow, {
    props: { book, allowMoveToLibrary },
    global: {
      stubs: {
        // Render menu content inline so the item is queryable without opening a portal.
        DropdownMenu: { template: '<div><slot /></div>' },
        DropdownMenuTrigger: { template: '<div><slot /></div>' },
        DropdownMenuContent: { template: '<div><slot /></div>' },
        DropdownMenuSeparator: true,
        // Declare the emit so the native click is not also treated as a fallthrough listener.
        DropdownMenuItem: { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' },
        RouterLink: { template: '<a><slot /></a>' },
        SendBookDialog: true,
        BookCoverSurface: true,
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: true,
      },
    },
  })
}

function moveItem(wrapper: ReturnType<typeof mountRow>) {
  return wrapper.findAll('button').find((candidate) => candidate.text().includes('Move to library'))
}

beforeEach(() => {
  hasPermissionMock.mockReset().mockReturnValue(true)
})

describe('list row move action', () => {
  it('emits the move action when the view opted in', async () => {
    const wrapper = mountRow(true)

    await moveItem(wrapper)!.trigger('click')

    expect(wrapper.emitted('action')).toEqual([['move-to-library']])
  })

  it('stays hidden for views that do not host the destination sheet', () => {
    expect(moveItem(mountRow(false))).toBeUndefined()
  })

  it('stays hidden without edit permission even when opted in', () => {
    hasPermissionMock.mockImplementation((permission) => permission !== 'library_edit_metadata')

    expect(moveItem(mountRow(true))).toBeUndefined()
  })
})
