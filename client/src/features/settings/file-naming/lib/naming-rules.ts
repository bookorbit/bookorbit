import {
  DEFAULT_DOWNLOAD_PATTERN,
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE,
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER,
  type Library,
  type OrganizationMode,
} from '@bookorbit/types'

export const GLOBAL_RULE_KEYS = ['fileAsBook', 'folderAsBook', 'download'] as const
export type GlobalRuleKey = (typeof GLOBAL_RULE_KEYS)[number]

/** Whether a rule produces a stored path or a suggested download filename. */
export type NamingTarget = 'upload' | 'download'

export type NamingRuleId = `global:${GlobalRuleKey}` | `library:${number}`

export interface NamingRule {
  id: NamingRuleId
  kind: 'global' | 'library'
  target: NamingTarget
  /** Set on library rules and on the two upload defaults; null for the download rule. */
  organizationMode: OrganizationMode | null
  globalKey: GlobalRuleKey | null
  library: Library | null
  /** The pattern shipped with BookOrbit, offered by the reset action. */
  shippedDefault: string
}

export const GLOBAL_RULE_ENDPOINTS: Record<GlobalRuleKey, string> = {
  fileAsBook: '/api/v1/app-settings/upload-pattern',
  folderAsBook: '/api/v1/app-settings/upload-pattern-folder',
  download: '/api/v1/app-settings/download-pattern',
}

export const GLOBAL_RULE_DEFAULTS: Record<GlobalRuleKey, string> = {
  fileAsBook: DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE,
  folderAsBook: DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER,
  download: DEFAULT_DOWNLOAD_PATTERN,
}

export const GLOBAL_RULE_ICONS: Record<GlobalRuleKey, string> = {
  fileAsBook: 'File',
  folderAsBook: 'FolderOpen',
  download: 'Download',
}

export function globalKeyForMode(mode: OrganizationMode): GlobalRuleKey {
  return mode === 'book_per_folder' ? 'folderAsBook' : 'fileAsBook'
}

export function globalRule(key: GlobalRuleKey): NamingRule {
  return {
    id: `global:${key}`,
    kind: 'global',
    target: key === 'download' ? 'download' : 'upload',
    organizationMode: key === 'download' ? null : key === 'folderAsBook' ? 'book_per_folder' : 'book_per_file',
    globalKey: key,
    library: null,
    shippedDefault: GLOBAL_RULE_DEFAULTS[key],
  }
}

export function libraryRule(library: Library): NamingRule {
  return {
    id: `library:${library.id}`,
    kind: 'library',
    target: 'upload',
    organizationMode: library.organizationMode,
    globalKey: null,
    library,
    shippedDefault: GLOBAL_RULE_DEFAULTS[globalKeyForMode(library.organizationMode)],
  }
}

/**
 * Libraries a global upload default actually governs: those in the matching organization
 * mode that have not set a pattern of their own. Counting them turns an abstract default
 * into a statement about real libraries.
 */
export function librariesGovernedBy(rule: NamingRule, libraries: Library[], overriddenIds: ReadonlySet<number>): Library[] {
  if (rule.kind !== 'global' || rule.target !== 'upload' || !rule.organizationMode) return []
  return libraries.filter((library) => library.organizationMode === rule.organizationMode && !overriddenIds.has(library.id))
}
