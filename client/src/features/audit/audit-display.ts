import type { AuditLogEntry } from '@bookorbit/types'
import { getBookDeletionAuditMeta } from './audit-meta'

export type AuditCategory = 'authentication' | 'books' | 'users' | 'libraries' | 'collections' | 'integrations' | 'settings' | 'other'

export function getAuditCategory(action: string): AuditCategory {
  if (action.startsWith('auth.') || action.startsWith('magic_link.')) return 'authentication'
  if (action.startsWith('book.')) return 'books'
  if (action.startsWith('user.') || action.startsWith('reading_insights.')) return 'users'
  if (action.startsWith('library.')) return 'libraries'
  if (action.startsWith('collection.') || action.startsWith('smart_scope.')) return 'collections'
  if (action.startsWith('kobo.') || action.startsWith('email.')) return 'integrations'
  if (action.startsWith('app_settings.') || action.startsWith('entity_manager.') || action.startsWith('author.')) return 'settings'
  return 'other'
}

export function isDestructiveAuditAction(action: string): boolean {
  return action.endsWith('.delete') || action.endsWith('.revoke') || action.endsWith('.remove') || action.endsWith('.failed')
}

export function getAuditTarget(
  entry: AuditLogEntry,
  untitled: string,
  additional: (count: number) => string,
  resourceLabel: (resource: string) => string = (resource) => resource,
): string {
  const deletion = getBookDeletionAuditMeta(entry)
  if (deletion && deletion.books.length > 0) {
    const titles = deletion.books.slice(0, 3).map((book) => book.title ?? untitled)
    const remaining = deletion.total - titles.length
    return remaining > 0 ? `${titles.join(', ')} ${additional(remaining)}` : titles.join(', ')
  }
  if (entry.resource && entry.resourceId !== null) return `${resourceLabel(entry.resource)} #${entry.resourceId}`
  return entry.resource ? resourceLabel(entry.resource) : '-'
}
