// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Permission } from '@bookorbit/types'
import { PERMISSION_GROUPS, presetPermissions } from '../permission-presets'

describe('permission-presets', () => {
  it('keeps demo_restricted selectable as its own group', () => {
    const restrictions = PERMISSION_GROUPS.find((group) => group.id === 'restrictions')
    expect(restrictions?.permissions).toEqual([Permission.DemoRestricted])
    expect(restrictions?.inverted).toBe(true)
  })

  it('never selects an inverted permission in the admin preset', () => {
    expect(presetPermissions('admin')).not.toContain(Permission.DemoRestricted)
  })

  it('selects every granting permission in the admin preset', () => {
    const granting = PERMISSION_GROUPS.filter((group) => !group.inverted).flatMap((group) => group.permissions)
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
    const content = PERMISSION_GROUPS.find((group) => group.id === 'content')
    const administration = PERMISSION_GROUPS.find((group) => group.id === 'administration')

    expect(content?.permissions).toContain(Permission.BookDockAccess)
    expect(content?.permissions).not.toContain(Permission.ManageBookDock)
    expect(administration?.permissions).toContain(Permission.ManageBookDock)
    expect(administration?.permissions).not.toContain(Permission.BookDockAccess)
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
