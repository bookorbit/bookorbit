import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Permission, type AccessLevel, type Library } from '@bookorbit/types'

const state = vi.hoisted(() => ({ superuser: false, permission: true }))
const libraries = ref<Library[]>([])
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => state.superuser || state.permission,
    isSuperuser: {
      get value() {
        return state.superuser
      },
    },
  }),
}))
vi.mock('../useLibraries', () => ({ useLibraries: () => ({ libraries }) }))
const { useLibraryPermissions } = await import('../useLibraryPermissions')

function library(id: number, accessLevel?: AccessLevel | null, type: Library['type'] = 'books'): Library {
  return { id, type, accessLevel } as Library
}

beforeEach(() => {
  state.superuser = false
  state.permission = true
  libraries.value = [library(1, 'editor'), library(2, 'viewer'), library(3, 'owner')]
})

describe('useLibraryPermissions', () => {
  it.each([
    [1, true],
    [2, false],
    [3, true],
    [4, false],
    [undefined, false],
    [null, false],
  ] as const)('checks editor access for library %s', (id, expected) => {
    expect(useLibraryPermissions().hasLibraryPermission(Permission.LibraryEditMetadata, id, 'editor')).toBe(expected)
  })

  it('requires the global permission even for editors and owners', () => {
    state.permission = false
    const { hasLibraryPermission } = useLibraryPermissions()
    expect(hasLibraryPermission(Permission.LibraryEditMetadata, 1, 'editor')).toBe(false)
    expect(hasLibraryPermission(Permission.LibraryEditMetadata, 3, 'editor')).toBe(false)
  })

  it('fails closed while libraries are loading or have no role', () => {
    const { hasLibraryPermission } = useLibraryPermissions()
    libraries.value = []
    expect(hasLibraryPermission(Permission.LibraryEditMetadata, 1, 'editor')).toBe(false)
    libraries.value = [library(1), library(2, null)]
    expect(hasLibraryPermission(Permission.LibraryEditMetadata, 1, 'editor')).toBe(false)
    expect(hasLibraryPermission(Permission.LibraryEditMetadata, 2, 'editor')).toBe(false)
  })

  it('permits superusers without explicit permissions or membership', () => {
    state.superuser = true
    state.permission = false
    libraries.value = []
    expect(useLibraryPermissions().hasLibraryPermission(Permission.LibraryEditMetadata, 7, 'editor')).toBe(true)
  })

  it('rechecks a changed role and clears permissions on library reset', () => {
    const { hasLibraryPermission } = useLibraryPermissions()
    expect(hasLibraryPermission(Permission.LibraryEditMetadata, 1, 'editor')).toBe(true)
    libraries.value[0]!.accessLevel = 'viewer'
    expect(hasLibraryPermission(Permission.LibraryEditMetadata, 1, 'editor')).toBe(false)
    libraries.value = []
    expect(hasLibraryPermission(Permission.LibraryEditMetadata, 3, 'editor')).toBe(false)
  })

  it('preserves viewer-level access and requires owner for owner-level actions', () => {
    const { hasLibraryPermission } = useLibraryPermissions()
    expect(hasLibraryPermission(Permission.LibraryDownload, 2)).toBe(true)
    expect(hasLibraryPermission(Permission.ManageLibraries, 1, 'owner')).toBe(false)
    expect(hasLibraryPermission(Permission.ManageLibraries, 3, 'owner')).toBe(true)
  })

  it('reports whether any book library grants the permission at the required level', () => {
    const { hasPermissionInAnyLibrary } = useLibraryPermissions()
    expect(hasPermissionInAnyLibrary(Permission.LibraryEditMetadata, 'editor')).toBe(true)

    libraries.value = [library(1, 'viewer'), library(2, 'editor', 'podcasts')]
    expect(hasPermissionInAnyLibrary(Permission.LibraryEditMetadata, 'editor')).toBe(false)

    state.superuser = true
    expect(hasPermissionInAnyLibrary(Permission.LibraryEditMetadata, 'editor')).toBe(true)

    state.superuser = false
    state.permission = false
    libraries.value = [library(1, 'owner')]
    expect(hasPermissionInAnyLibrary(Permission.LibraryEditMetadata, 'editor')).toBe(false)
  })
})
