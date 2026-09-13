import { Permission } from '@bookorbit/types'

export interface PermissionGroup {
  id: string
  use: Permission[]
  manage: Permission[]
}

/**
 * The order the user form renders. Groups that pair a personal capability with its administration
 * come first; everything that only an administrator ever holds collapses into a single group at the
 * end, because splitting it three ways spent three headings on rows that are all the same answer to
 * "should this account run the server".
 */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'libraryBooks',
    use: [Permission.LibraryDownload, Permission.LibraryUpload, Permission.LibraryEditMetadata],
    manage: [Permission.LibraryDeleteBooks],
  },
  {
    id: 'bookRequests',
    use: [Permission.BookRequestAccess, Permission.BookRequestAutoApprove, Permission.BookRequestSelfFulfill],
    manage: [Permission.ManageBookRequests],
  },
  {
    id: 'devices',
    use: [Permission.KoboSync, Permission.KoreaderSync, Permission.OpdsAccess],
    manage: [],
  },
  {
    id: 'readingIntegrations',
    use: [Permission.HardcoverSync, Permission.ReadwiseSync, Permission.StorygraphSync],
    manage: [],
  },
  {
    id: 'bookDock',
    use: [Permission.BookDockAccess],
    manage: [Permission.ManageBookDock],
  },
  {
    id: 'emailNotifications',
    use: [Permission.EmailSend, Permission.NotificationAccess],
    manage: [Permission.ManageEmail],
  },
  {
    id: 'administration',
    use: [],
    manage: [
      Permission.ManageLibraries,
      Permission.ManageMetadataConfig,
      Permission.ManageIcons,
      Permission.ManageUsers,
      Permission.ViewUserActivity,
      Permission.ViewAuditLog,
      Permission.ManageAppSettings,
    ],
  },
]

export const RESTRICTION_PERMISSIONS: Permission[] = [Permission.DemoRestricted]

export function permissionsInGroup(group: PermissionGroup): Permission[] {
  return [...group.use, ...group.manage]
}

/** Every permission the presets and the permission grid deal in, restrictions excluded. */
export function grantingPermissions(): Permission[] {
  return PERMISSION_GROUPS.flatMap(permissionsInGroup)
}

export function isRestrictionPermission(permissionName: string): boolean {
  return RESTRICTION_PERMISSIONS.includes(permissionName as Permission)
}

/**
 * What an ordinary reader gets. Deliberately no request capability: whether people may ask for
 * books at all is an instance-level decision an operator makes once, so it belongs on the role
 * they choose rather than on the button that fills the form in for them.
 */
const STANDARD_PRESET: Permission[] = [
  Permission.LibraryDownload,
  Permission.KoboSync,
  Permission.KoreaderSync,
  Permission.HardcoverSync,
  Permission.ReadwiseSync,
  Permission.StorygraphSync,
  Permission.OpdsAccess,
]

export type PermissionPreset = 'standard' | 'admin' | 'clear'

/** What the preset control reports: a preset the selection matches, or the absence of one. */
export type PermissionSelection = PermissionPreset | 'custom'

export const PERMISSION_PRESETS: PermissionPreset[] = ['clear', 'standard', 'admin']

export function presetPermissions(preset: PermissionPreset): Permission[] {
  switch (preset) {
    case 'admin':
      return grantingPermissions()
    case 'standard':
      return [...STANDARD_PRESET]
    case 'clear':
      return []
  }
}

/**
 * Restrictions are deliberately ignored: `demo_restricted` is set on the Restrictions section and
 * says nothing about which preset the granting permissions match, so a demo account on the standard
 * set still reads as Standard rather than falling through to Custom.
 */
export function detectPermissionSelection(selected: ReadonlySet<string>): PermissionSelection {
  const granted = new Set([...selected].filter((name) => !isRestrictionPermission(name)))
  for (const preset of PERMISSION_PRESETS) {
    const names = presetPermissions(preset)
    if (names.length === granted.size && names.every((name) => granted.has(name))) return preset
  }
  return 'custom'
}
