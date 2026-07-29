import { AuditAction } from '@bookorbit/types'

export type AuditActionOption = {
  key: keyof typeof AuditAction
  value: AuditAction
}

export const AUDIT_ACTION_OPTIONS = Object.entries(AuditAction).map(([key, value]) => ({
  key: key as keyof typeof AuditAction,
  value,
})) satisfies AuditActionOption[]

const actionKeyByValue = new Map<string, keyof typeof AuditAction>(AUDIT_ACTION_OPTIONS.map((option) => [option.value, option.key]))

export function getAuditActionLabelKey(action: string): string {
  const key = actionKeyByValue.get(action)
  return key ? `audit.actionLabels.${key}` : 'audit.unknownAction'
}
