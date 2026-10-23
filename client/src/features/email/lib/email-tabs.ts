export const EMAIL_TABS = ['recipients', 'servers', 'templates', 'history'] as const

export type EmailTab = (typeof EMAIL_TABS)[number]

/** Tabs the page used to have, so old links still land somewhere sensible. */
const LEGACY_TABS: Record<string, EmailTab> = { providers: 'servers', groups: 'recipients', preferences: 'recipients' }

export function normalizeEmailTab(value: unknown): EmailTab {
  if (typeof value !== 'string') return 'recipients'
  if ((EMAIL_TABS as readonly string[]).includes(value)) return value as EmailTab
  return LEGACY_TABS[value] ?? 'recipients'
}
