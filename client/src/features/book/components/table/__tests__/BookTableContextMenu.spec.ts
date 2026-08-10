import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCard } from '@bookorbit/types'

import BookTableContextMenu from '../BookTableContextMenu.vue'

const { hasPermissionMock } = vi.hoisted(() => ({ hasPermissionMock: vi.fn<(permission: string) => boolean>() }))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: hasPermissionMock, isDemoRestrictedAccount: { value: false } }),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn<(to: unknown) => void>() }) }))

vi.mock('@/features/book/composables/useRefreshMetadata', () => ({
  useRefreshMetadata: () => ({ refreshWithFeedback: vi.fn<() => Promise<null>>(), refreshing: { value: false } }),
}))

vi.mock('@/features/book/composables/useBookRefreshFeedback', () => ({
  useBookRefreshFeedback: () => ({
    markRefreshing: vi.fn<(id: number) => void>(),
    markSuccess: vi.fn<(id: number, columns: string[]) => void>(),
    markFailed: vi.fn<(id: number) => void>(),
  }),
}))

vi.mock('@/features/book/composables/useRefreshingBooks', () => ({
  useRefreshingBooks: () => ({ isRefreshing: () => false }),
}))

const book = { id: 7, title: 'Dune' } as BookCard

function mountMenu() {
  return mount(BookTableContextMenu, {
    props: { book, position: { x: 100, y: 100 } },
    global: {
      stubs: { SendBookDialog: true, Teleport: true },
    },
  })
}

function moveButton(wrapper: ReturnType<typeof mountMenu>) {
  return wrapper.findAll('button').find((candidate) => candidate.text().includes('Move to library'))
}

beforeEach(() => {
  hasPermissionMock.mockReset().mockReturnValue(true)
})

describe('move to library entry', () => {
  it('emits a move action for the right-clicked book', async () => {
    const wrapper = mountMenu()

    await moveButton(wrapper)!.trigger('click')

    expect(wrapper.emitted('action')).toEqual([[book, 'move-to-library']])
  })

  it('closes the menu after choosing it', async () => {
    const wrapper = mountMenu()

    await moveButton(wrapper)!.trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('stays hidden without edit permission', () => {
    hasPermissionMock.mockImplementation((permission) => permission !== 'library_edit_metadata')

    expect(moveButton(mountMenu())).toBeUndefined()
  })
})
