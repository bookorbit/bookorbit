import { Permission, PERMISSION_LABELS } from '@bookorbit/types'

type Translate = (key: string) => string

/** The name a permission goes by in the interface, wherever permissions are listed. */
export function permissionLabel(permission: Permission, t: Translate): string {
  if (permission === Permission.ViewUserActivity) return t('adminFeature.accountActivity.permissionLabel')
  return PERMISSION_LABELS[permission] ?? permission
}
