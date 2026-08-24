// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Permission } from '@bookorbit/types'

import { accessTier } from '../access-tier'
import { presetPermissions } from '../permission-presets'

describe('accessTier', () => {
  it('reports a superuser before looking at granted permissions', () => {
    expect(accessTier({ isSuperuser: true, permissions: [] })).toBe('superuser')
  })

  it('names the exact admin and standard presets', () => {
    expect(accessTier({ isSuperuser: false, permissions: presetPermissions('admin') })).toBe('admin')
    expect(accessTier({ isSuperuser: false, permissions: presetPermissions('standard') })).toBe('standard')
  })

  it('ignores the order permissions arrive in', () => {
    const reversed = [...presetPermissions('standard')].reverse()
    expect(accessTier({ isSuperuser: false, permissions: reversed })).toBe('standard')
  })

  it('falls back to custom for a preset with anything added or removed', () => {
    const extra = [...presetPermissions('standard'), Permission.LibraryUpload]
    const missing = presetPermissions('standard').slice(1)
    expect(accessTier({ isSuperuser: false, permissions: extra })).toBe('custom')
    expect(accessTier({ isSuperuser: false, permissions: missing })).toBe('custom')
  })

  it('treats demo_restricted as a departure from the preset, since presets never grant it', () => {
    const restricted = [...presetPermissions('standard'), Permission.DemoRestricted]
    expect(accessTier({ isSuperuser: false, permissions: restricted })).toBe('custom')
  })

  it('reports no access for an empty or absent permission list', () => {
    expect(accessTier({ isSuperuser: false, permissions: [] })).toBe('none')
    expect(accessTier({ isSuperuser: false })).toBe('none')
    expect(accessTier({ isSuperuser: false, permissions: null })).toBe('none')
  })
})
