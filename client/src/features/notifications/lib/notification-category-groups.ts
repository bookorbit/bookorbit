import {
  BookPlus,
  FileCog,
  FolderSync,
  HardDriveDownload,
  Mail,
  Podcast,
  RefreshCw,
  ScanLine,
  Tags,
  Trophy,
  Users,
  type LucideIcon,
} from '@lucide/vue'
import { APP_FEATURES, type NotificationCategory } from '@bookorbit/types'

export const NOTIFICATION_CATEGORY_GROUPS = [
  { id: 'library', categories: ['scanning', 'metadata', 'authorEnrichment'] },
  { id: 'files', categories: ['fileWriteBack', 'fileRename', 'bulkRename', 'migration'] },
  { id: 'integrations', categories: ['bookDock', 'bookRequests', 'email', ...(APP_FEATURES.podcasts ? (['podcasts'] as const) : [])] },
  { id: 'personal', categories: ['achievements'] },
] as const satisfies ReadonlyArray<{ id: string; categories: readonly NotificationCategory[] }>

export const NOTIFICATION_CATEGORY_ICONS: Record<NotificationCategory, LucideIcon> = {
  scanning: ScanLine,
  metadata: Tags,
  authorEnrichment: Users,
  fileWriteBack: HardDriveDownload,
  fileRename: FileCog,
  bulkRename: FileCog,
  migration: RefreshCw,
  bookDock: FolderSync,
  bookRequests: BookPlus,
  email: Mail,
  podcasts: Podcast,
  achievements: Trophy,
}
