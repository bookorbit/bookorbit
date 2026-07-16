export const EMAIL_TABS = ['providers', 'recipients', 'groups', 'templates', 'preferences', 'history'] as const

export type EmailTab = (typeof EMAIL_TABS)[number]

export function normalizeEmailTab(value: unknown): EmailTab {
  if (typeof value === 'string' && EMAIL_TABS.includes(value as EmailTab)) {
    return value as EmailTab
  }
  return 'providers'
}
