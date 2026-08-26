// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Permission } from '@bookorbit/types'
import { PERMISSION_GROUPS, RESTRICTION_PERMISSIONS, detectPermissionSelection, permissionsInGroup, presetPermissions } from '../permission-presets'

describe('permission-presets', () => {
  // The user form renders permissions by walking the groups, so a permission missing from every
  // group is not merely unlabelled: nobody but a superuser can ever hold it.
  it('offers every permission in exactly one group', () => {
    const grouped = [...PERMISSION_GROUPS.flatMap(permissionsInGroup), ...RESTRICTION_PERMISSIONS]
    expect([...grouped].sort()).toEqual(Object.values(Permission).sort())
  })

  it('keeps demo_restricted separate from granting permissions', () => {
    expect(RESTRICTION_PERMISSIONS).toEqual([Permission.DemoRestricted])
    expect(PERMISSION_GROUPS.flatMap(permissionsInGroup)).not.toContain(Permission.DemoRestricted)
  })

  it('never selects a restriction permission in the admin preset', () => {
    expect(presetPermissions('admin')).not.toContain(Permission.DemoRestricted)
  })

  it('selects every granting permission in the admin preset', () => {
    const granting = PERMISSION_GROUPS.flatMap(permissionsInGroup)
    expect(presetPermissions('admin')).toEqual(granting)
    expect(granting.length).toBeGreaterThan(0)
  })

  it('limits the standard preset to reading and device access', () => {
    expect(presetPermissions('standard')).toEqual([
      Permission.LibraryDownload,
      Permission.KoboSync,
      Permission.KoreaderSync,
      Permission.HardcoverSync,
      Permission.ReadwiseSync,
      Permission.StorygraphSync,
      Permission.OpdsAccess,
    ])
    expect(presetPermissions('standard')).not.toContain(Permission.BookDockAccess)
    expect(presetPermissions('standard')).not.toContain(Permission.ManageBookDock)
  })

  it('separates personal Book Dock access from global Book Dock administration', () => {
    const bookDock = PERMISSION_GROUPS.find((group) => group.id === 'bookDock')

    expect(bookDock?.use).toEqual([Permission.BookDockAccess])
    expect(bookDock?.manage).toEqual([Permission.ManageBookDock])
  })

  it('separates requesting a book from moderating the queue', () => {
    const bookRequests = PERMISSION_GROUPS.find((group) => group.id === 'bookRequests')

    expect(bookRequests?.use).toContain(Permission.BookRequestAccess)
    expect(bookRequests?.use).toContain(Permission.BookRequestAutoApprove)
    expect(bookRequests?.use).toContain(Permission.BookRequestSelfFulfill)
    expect(bookRequests?.manage).toEqual([Permission.ManageBookRequests])
  })

  it('collapses everything only an administrator holds into one group', () => {
    const administration = PERMISSION_GROUPS.find((group) => group.id === 'administration')

    expect(administration?.use).toEqual([])
    expect(administration?.manage).toContain(Permission.ManageUsers)
    expect(administration?.manage).toContain(Permission.ManageLibraries)
    expect(administration?.manage).toContain(Permission.ManageAppSettings)
  })

  it('selects nothing for the clear preset', () => {
    expect(presetPermissions('clear')).toEqual([])
  })

  it('returns a fresh array so callers cannot mutate a preset', () => {
    const first = presetPermissions('standard')
    first.push(Permission.ManageUsers)
    expect(presetPermissions('standard')).not.toContain(Permission.ManageUsers)
  })
})

describe('detectPermissionSelection', () => {
  it('names the preset a selection matches', () => {
    expect(detectPermissionSelection(new Set())).toBe('clear')
    expect(detectPermissionSelection(new Set(presetPermissions('standard')))).toBe('standard')
    expect(detectPermissionSelection(new Set(presetPermissions('admin')))).toBe('admin')
  })

  // The preset control speaks for granting permissions, so a demo account on the standard set is
  // still Standard rather than dropping to Custom the moment a restriction is ticked.
  it('ignores restrictions, which no preset speaks for', () => {
    const selection = new Set<string>([...presetPermissions('standard'), Permission.DemoRestricted])

    expect(detectPermissionSelection(selection)).toBe('standard')
  })

  it('falls through to custom for a selection no preset covers', () => {
    expect(detectPermissionSelection(new Set([Permission.ManageUsers]))).toBe('custom')
  })
})
