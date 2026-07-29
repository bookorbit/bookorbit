import { describe, expect, it } from 'vitest'
import { AuditAction } from '@bookorbit/types'
import en from '@/locales/en.json'
import { AUDIT_ACTION_OPTIONS, getAuditActionLabelKey } from '../audit-actions'

describe('audit action labels', () => {
  it('provides a localized human-readable label for every audit action', () => {
    expect(AUDIT_ACTION_OPTIONS).toHaveLength(Object.keys(AuditAction).length)

    for (const option of AUDIT_ACTION_OPTIONS) {
      expect(en.audit.actionLabels[option.key]).toBeTruthy()
      expect(getAuditActionLabelKey(option.value)).toBe(`audit.actionLabels.${option.key}`)
    }
  })

  it('falls back safely for historical unknown actions', () => {
    expect(getAuditActionLabelKey('legacy.unknown')).toBe('audit.unknownAction')
  })
})
