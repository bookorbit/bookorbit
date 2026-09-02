import { AuditResource } from '@bookorbit/types'

export type AuditResourceDomain = 'content' | 'people' | 'metadata' | 'integrations' | 'settings' | 'insights' | 'other'

export type AuditResourceOption = {
  key: keyof typeof AuditResource
  value: AuditResource
}

export const AUDIT_RESOURCE_OPTIONS = Object.entries(AuditResource).map(([key, value]) => ({
  key: key as keyof typeof AuditResource,
  value,
})) satisfies AuditResourceOption[]

const resourceKeyByValue = new Map<string, keyof typeof AuditResource>(AUDIT_RESOURCE_OPTIONS.map((option) => [option.value, option.key]))

const domainByResource: Record<AuditResource, AuditResourceDomain> = {
  [AuditResource.User]: 'people',
  [AuditResource.Library]: 'content',
  [AuditResource.Book]: 'content',
  [AuditResource.Collection]: 'content',
  [AuditResource.SmartScope]: 'content',
  [AuditResource.BookDockFile]: 'content',
  [AuditResource.BookRequest]: 'content',
  [AuditResource.DownloadClient]: 'integrations',
  [AuditResource.RequestIndexer]: 'integrations',
  [AuditResource.Author]: 'people',
  [AuditResource.AppSettings]: 'settings',
  [AuditResource.Genre]: 'metadata',
  [AuditResource.Tag]: 'metadata',
  [AuditResource.KoboDevice]: 'integrations',
  [AuditResource.EmailProvider]: 'integrations',
  [AuditResource.EmailTemplate]: 'integrations',
  [AuditResource.EmailRecipient]: 'integrations',
  [AuditResource.EmailRecipientGroup]: 'integrations',
  [AuditResource.Narrator]: 'people',
  [AuditResource.Publisher]: 'metadata',
  [AuditResource.Language]: 'metadata',
  [AuditResource.Series]: 'metadata',
  [AuditResource.OidcIdentity]: 'integrations',
  [AuditResource.MagicLinkToken]: 'integrations',
  [AuditResource.ReadingInsightsProfile]: 'insights',
}

const badgeClassByDomain: Record<AuditResourceDomain, string> = {
  content: 'border-[var(--pill-web)]/40 bg-[var(--pill-web)]/10 text-[var(--pill-web)]',
  people: 'border-[var(--pill-koreader)]/40 bg-[var(--pill-koreader)]/10 text-[var(--pill-koreader)]',
  metadata: 'border-[var(--pill-repaired)]/40 bg-[var(--pill-repaired)]/10 text-[var(--pill-repaired)]',
  integrations: 'border-[var(--pill-kobo)]/40 bg-[var(--pill-kobo)]/10 text-[var(--pill-kobo)]',
  settings: 'border-[var(--pill-pending)]/40 bg-[var(--pill-pending)]/10 text-[var(--pill-pending)]',
  insights: 'border-primary/30 bg-primary/10 text-primary',
  other: 'border-border bg-muted text-muted-foreground',
}

const dotClassByDomain: Record<AuditResourceDomain, string> = {
  content: 'bg-[var(--pill-web)]',
  people: 'bg-[var(--pill-koreader)]',
  metadata: 'bg-[var(--pill-repaired)]',
  integrations: 'bg-[var(--pill-kobo)]',
  settings: 'bg-[var(--pill-pending)]',
  insights: 'bg-primary',
  other: 'bg-muted-foreground',
}

export function getAuditResourceLabelKey(resource: string): string {
  const key = resourceKeyByValue.get(resource)
  return key ? `audit.resourceLabels.${key}` : 'audit.unknownResource'
}

export function getAuditResourceDomain(resource: string): AuditResourceDomain {
  return domainByResource[resource as AuditResource] ?? 'other'
}

export function getAuditResourceBadgeClass(resource: string): string {
  return badgeClassByDomain[getAuditResourceDomain(resource)]
}

export function getAuditResourceDotClass(resource: string): string {
  return dotClassByDomain[getAuditResourceDomain(resource)]
}
