import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Permission, type BookCard, type Library } from '@bookorbit/types'
import type { QuerySelectionState } from '../useBookBulkActions'

const libraries = ref<Library[]>([])
const permissions = ref<string[]>([Permission.LibraryEditMetadata])
const isSuperuser = ref(false)
vi.mock('@/features/library/composables/useLibraries', () => ({ useLibraries: () => ({ libraries }) }))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (permission: string) => isSuperuser.value || permissions.value.includes(permission), isSuperuser }),
}))
const { useBookSelectionPermissions } = await import('../useBookSelectionPermissions')

beforeEach(() => {
  permissions.value = [Permission.LibraryEditMetadata]
  isSuperuser.value = false
  libraries.value = [
    { id: 7, accessLevel: 'editor' },
    { id: 8, accessLevel: 'viewer' },
    { id: 9, accessLevel: 'owner' },
  ] as Library[]
})

function context(ids: number[] = [1]) {
  const books = ref<BookCard[]>([
    { id: 1, libraryId: 7 },
    { id: 2, libraryId: 8 },
    { id: 3, libraryId: 9 },
  ] as BookCard[])
  const selectedIds = ref(new Set(ids))
  const query = ref<QuerySelectionState | null>(null)
  return { books, selectedIds, query, ...useBookSelectionPermissions(books, selectedIds, query) }
}

describe('metadata permissions for bulk selections', () => {
  it('permits an editor and owner selection and rejects a mixed viewer selection', () => {
    const ctx = context([1, 3])
    expect(ctx.canEditSelectionMetadata.value).toBe(true)
    ctx.selectedIds.value.add(2)
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
  })

  it.each([{ ids: [] }, { ids: [99] }])('fails closed for empty or unresolved selection $ids', ({ ids }) => {
    expect(context(ids).canEditSelectionMetadata.value).toBe(false)
  })

  it('fails closed when a card from an older server has no library ID', () => {
    const ctx = context()
    delete ctx.books.value[0]!.libraryId
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
  })

  it('checks the query scope even when the visible page belongs to an editor', () => {
    const ctx = context()
    ctx.query.value = { libraryId: 8, total: 10000 } as QuerySelectionState
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
    ctx.query.value = { libraryId: 7, total: 10000 } as QuerySelectionState
    expect(ctx.canEditSelectionMetadata.value).toBe(true)
  })

  it('requires editor access to every accessible library for an unscoped query', () => {
    const ctx = context()
    ctx.query.value = { total: 10000 } as QuerySelectionState
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
    libraries.value[1]!.accessLevel = 'editor'
    expect(ctx.canEditSelectionMetadata.value).toBe(true)
    libraries.value = []
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
  })

  it('reacts to global permission revocation and library-role downgrade', () => {
    const ctx = context()
    expect(ctx.canEditSelectionMetadata.value).toBe(true)
    permissions.value = []
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
    permissions.value = [Permission.LibraryEditMetadata]
    libraries.value[0]!.accessLevel = 'viewer'
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
  })

  it('retains editor scope when sorting or filtering replaces loaded cards', () => {
    const ctx = context([1, 3])
    expect(ctx.canEditSelectionMetadata.value).toBe(true)
    ctx.books.value = [{ id: 2, libraryId: 8 }] as BookCard[]
    expect(ctx.selectedIds.value.size).toBe(2)
    expect(ctx.canEditSelectionMetadata.value).toBe(true)
    libraries.value[0]!.accessLevel = 'viewer'
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
    libraries.value[0]!.accessLevel = 'editor'
    expect(ctx.canEditSelectionMetadata.value).toBe(true)
    permissions.value = []
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
  })

  it('retains viewer restrictions after the selected card leaves the window', () => {
    const ctx = context([1, 2])
    ctx.books.value = [{ id: 3, libraryId: 9 }] as BookCard[]
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
    ctx.selectedIds.value.delete(2)
    expect(ctx.canEditSelectionMetadata.value).toBe(true)
  })

  it('discards cached scope when a book is deselected', () => {
    const ctx = context()
    ctx.books.value = []
    expect(ctx.canEditSelectionMetadata.value).toBe(true)
    ctx.selectedIds.value.clear()
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
    ctx.selectedIds.value.add(1)
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
    ctx.books.value = [{ id: 1, libraryId: 8 }] as BookCard[]
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
  })

  it('updates retained scope when a selected book moves into a viewer library', () => {
    const ctx = context()
    expect(ctx.canEditSelectionMetadata.value).toBe(true)
    ctx.books.value[0]!.libraryId = 8
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
    ctx.books.value = []
    expect(ctx.canEditSelectionMetadata.value).toBe(false)
  })
})
