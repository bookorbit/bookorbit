import type { Component } from 'vue'
import { Activity, BookOpen, Download, Layers, Library, Settings, ShieldCheck, TabletSmartphone, Users } from '@lucide/vue'
import { AuditAction, AuditResource, getAuditCategory, type AuditCategory, type AuditLogEntry } from '@bookorbit/types'
import { getBookDeletionAuditMeta } from './audit-meta'

export { getAuditCategory }
export type { AuditCategory }

export const AUDIT_CATEGORY_ORDER: readonly AuditCategory[] = [
  'access',
  'users',
  'libraries',
  'books',
  'requests',
  'collections',
  'devices',
  'settings',
  'other',
]

/** Icon and colour per category. Colour marks the category only; red and amber are kept for tone. */
export const AUDIT_CATEGORY_STYLE: Record<AuditCategory, { icon: Component; color: string }> = {
  access: { icon: ShieldCheck, color: 'var(--audit-authentication)' },
  users: { icon: Users, color: 'var(--audit-users)' },
  libraries: { icon: Library, color: 'var(--audit-libraries)' },
  books: { icon: BookOpen, color: 'var(--audit-books)' },
  requests: { icon: Download, color: 'var(--audit-requests)' },
  collections: { icon: Layers, color: 'var(--audit-collections)' },
  devices: { icon: TabletSmartphone, color: 'var(--audit-integrations)' },
  settings: { icon: Settings, color: 'var(--audit-config)' },
  other: { icon: Activity, color: 'var(--muted-foreground)' },
}

export type AuditTone = 'danger' | 'warning' | null

const WARNING_ACTIONS = new Set<string>([
  AuditAction.UserSuperuserEnable,
  AuditAction.UserPermissionSet,
  AuditAction.AuthPasswordAdminReset,
  AuditAction.UserUnlock,
])

export function isDestructiveAuditAction(action: string): boolean {
  return (
    /\.(delete|purge|remove|revoke|clean)$/.test(action) ||
    action.endsWith('.remove_download') ||
    action === AuditAction.BookBulkDelete ||
    action === AuditAction.UserSuperuserDisable ||
    action === AuditAction.OidcIdentityUnlinked
  )
}

/** Red for anything that removed something, amber for sign-in failures and changes to who can do what. */
export function getAuditTone(action: string): AuditTone {
  if (action === AuditAction.AuthLoginFailed) return 'warning'
  if (isDestructiveAuditAction(action)) return 'danger'
  return WARNING_ACTIONS.has(action) ? 'warning' : null
}

export type AuditPersonKind = 'user' | 'system' | 'deleted'

export interface AuditPerson {
  kind: AuditPersonKind
  name: string
  username: string
}

/** System events have no account; an event whose account was deleted keeps the username it was written with. */
export function getAuditPerson(entry: Pick<AuditLogEntry, 'actorUsername' | 'userId' | 'actorName'>): AuditPerson {
  if (entry.userId === null && entry.actorUsername === 'system') return { kind: 'system', name: entry.actorUsername, username: entry.actorUsername }
  if (entry.userId === null) return { kind: 'deleted', name: entry.actorUsername, username: entry.actorUsername }
  return { kind: 'user', name: entry.actorName || entry.actorUsername, username: entry.actorUsername }
}

export type AuditSourceKind = 'server' | 'local' | 'internet' | 'job' | 'unknown'

export function getAuditSourceKind(ip: string | null, actorUsername: string): AuditSourceKind {
  if (!ip) return actorUsername === 'system' ? 'job' : 'unknown'
  const address = ip.replace(/^::ffff:/i, '').toLowerCase()
  if (address === '::1' || address.startsWith('127.')) return 'server'
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(address) || /^(fc|fd|fe80)/.test(address)) return 'local'
  return 'internet'
}

export interface AuditTargetView {
  /** What to show. A real name, a setting key, or a type with an id when no name was ever recorded. */
  name: string
  /** True when `name` is only "Library #88" because the log never learned the real name. */
  unnamed: boolean
  /** The target no longer exists: removed by this event, or later. */
  gone: 'here' | 'since' | null
  /** Further targets of a bulk action, beyond the one named. */
  more: number
  /** Only the kind of thing is known, such as "Book request" for a bulk rejection. */
  typeOnly: boolean
}

const SIGN_IN_ACTIONS = new Set<string>([AuditAction.AuthLogin, AuditAction.AuthLogout, AuditAction.OidcLogin, AuditAction.MagicLinkLogin])

export function getAuditTargetView(
  entry: AuditLogEntry,
  labels: { untitled: string; resource: (resource: string) => string; withId: (resource: string, id: number) => string },
): AuditTargetView | null {
  const deletion = getBookDeletionAuditMeta(entry)
  if (deletion && deletion.books.length > 0) {
    return { name: deletion.books[0]!.title ?? labels.untitled, unnamed: false, gone: 'here', more: Math.max(0, deletion.total - 1), typeOnly: false }
  }
  if (entry.action === AuditAction.AuthLoginFailed) {
    const tried = typeof entry.meta?.attemptedUsername === 'string' ? entry.meta.attemptedUsername : null
    return tried ? { name: tried, unnamed: false, gone: null, more: 0, typeOnly: false } : null
  }
  if (SIGN_IN_ACTIONS.has(entry.action) || !entry.resource) return null
  if (entry.resourceId === null) return { name: labels.resource(entry.resource), unnamed: false, gone: null, more: 0, typeOnly: true }

  const removedHere = /\.(delete|purge)$/.test(entry.action) && entry.resource !== AuditResource.ReadingInsightsProfile
  const gone = entry.targetExists === false ? (removedHere ? 'here' : 'since') : null
  if (entry.targetLabel) return { name: entry.targetLabel, unnamed: false, gone, more: 0, typeOnly: false }
  return { name: labels.withId(entry.resource, entry.resourceId), unnamed: true, gone, more: 0, typeOnly: false }
}

export type AuditFactKey = 'format' | 'size' | 'download' | 'dockFile' | 'rejected' | 'failed' | 'cleaned' | 'skipped' | 'remaining' | 'sharingLevel'

/** The facts an event's meta carries, as plain values the drawer labels. */
export function getAuditFacts(entry: AuditLogEntry): Array<{ key: AuditFactKey; value: string | number }> {
  const meta = entry.meta ?? {}
  const facts: Array<{ key: AuditFactKey; value: string | number }> = []
  const add = (key: AuditFactKey, value: unknown) => {
    if (typeof value === 'number' || (typeof value === 'string' && value !== '')) facts.push({ key, value })
  }
  if (entry.action === AuditAction.BookRequestImport) {
    add('format', typeof meta.format === 'string' ? meta.format.toUpperCase() : undefined)
    add('size', meta.sizeBytes)
    add('download', meta.downloadId)
    add('dockFile', meta.bookDockFileId)
  }
  if (entry.action === AuditAction.BookRequestReject) {
    add('rejected', meta.rejected)
    add('failed', meta.failed)
  }
  if (entry.action.startsWith('maintenance.')) {
    add('cleaned', meta.cleaned)
    add('skipped', meta.skipped)
    add('remaining', meta.remaining)
  }
  if (entry.action.startsWith('reading_insights.')) add('sharingLevel', meta.sharingLevel)
  return facts
}
