import { Permission } from '@bookorbit/types'

import { presetPermissions } from './permission-presets'

export const ACCESS_TIERS = ['superuser', 'admin', 'standard', 'custom', 'none'] as const
export type AccessTier = (typeof ACCESS_TIERS)[number]

const ADMIN_PRESET = new Set(presetPermissions('admin'))
const STANDARD_PRESET = new Set(presetPermissions('standard'))

function matchesPreset(granted: readonly string[], preset: ReadonlySet<Permission>): boolean {
  return granted.length === preset.size && granted.every((name) => preset.has(name as Permission))
}

/**
 * The roster names access with the same vocabulary the editor's preset control uses, so a
 * row and the drawer can never disagree. A raw count answers "how many" but never "what can
 * they do"; anything that is not an exact preset match reads as Custom, with the count kept
 * alongside as the tiebreaker.
 */
export function accessTier(user: { isSuperuser: boolean; permissions?: string[] | null }): AccessTier {
  if (user.isSuperuser) return 'superuser'
  const granted = user.permissions ?? []
  if (granted.length === 0) return 'none'
  if (matchesPreset(granted, ADMIN_PRESET)) return 'admin'
  if (matchesPreset(granted, STANDARD_PRESET)) return 'standard'
  return 'custom'
}
