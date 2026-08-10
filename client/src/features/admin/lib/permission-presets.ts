import { Permission } from '@bookorbit/types'

export interface PermissionGroup {
  id: string
  permissions: Permission[]
  /** Permissions in this group take capability away instead of granting it, so presets must never select them. */
  inverted?: boolean
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'content',
    permissions: [
      Permission.LibraryDownload,
      Permission.LibraryUpload,
      Permission.LibraryEditMetadata,
      Permission.LibraryDeleteBooks,
      Permission.BookDockAccess,
    ],
  },
  {
    id: 'devicesAccess',
    permissions: [
      Permission.KoboSync,
      Permission.KoreaderSync,
      Permission.HardcoverSync,
      Permission.ReadwiseSync,
      Permission.StorygraphSync,
      Permission.OpdsAccess,
    ],
  },
  {
    id: 'email',
    permissions: [Permission.EmailSend, Permission.ManageEmail],
  },
  {
    id: 'administration',
    permissions: [
      Permission.ManageLibraries,
      Permission.ManageMetadataConfig,
      Permission.ManageIcons,
      Permission.ManageAppSettings,
      Permission.ManageBookDock,
      Permission.ManageUsers,
      Permission.ViewUserActivity,
      Permission.ViewAuditLog,
    ],
  },
  {
    id: 'notifications',
    permissions: [Permission.NotificationAccess],
  },
  {
    id: 'restrictions',
    permissions: [Permission.DemoRestricted],
    inverted: true,
  },
]

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

export function presetPermissions(preset: PermissionPreset): Permission[] {
  switch (preset) {
    case 'admin':
      return PERMISSION_GROUPS.filter((group) => !group.inverted).flatMap((group) => group.permissions)
    case 'standard':
      return [...STANDARD_PRESET]
    case 'clear':
      return []
  }
}
