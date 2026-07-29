import { describe, expect, it } from 'vitest'
import { AuditResource } from '@bookorbit/types'
import en from '@/locales/en.json'
import { AUDIT_RESOURCE_OPTIONS, getAuditResourceBadgeClass, getAuditResourceDomain, getAuditResourceLabelKey } from '../audit-resources'

describe('audit resource display', () => {
  it('provides a localized human-readable label for every target type', () => {
    expect(AUDIT_RESOURCE_OPTIONS).toHaveLength(Object.keys(AuditResource).length)

    for (const option of AUDIT_RESOURCE_OPTIONS) {
      expect(en.audit.resourceLabels[option.key]).toBeTruthy()
      expect(getAuditResourceLabelKey(option.value)).toBe(`audit.resourceLabels.${option.key}`)
    }
  })

  it('groups target types into color and icon domains', () => {
    expect(getAuditResourceDomain(AuditResource.Book)).toBe('content')
    expect(getAuditResourceDomain(AuditResource.User)).toBe('people')
    expect(getAuditResourceDomain(AuditResource.Tag)).toBe('metadata')
    expect(getAuditResourceDomain(AuditResource.KoboDevice)).toBe('integrations')
    expect(getAuditResourceDomain(AuditResource.AppSettings)).toBe('settings')
    expect(getAuditResourceBadgeClass(AuditResource.Book)).toContain('--pill-web')
  })

  it('falls back safely for historical unknown target types', () => {
    expect(getAuditResourceLabelKey('legacy_target')).toBe('audit.unknownResource')
    expect(getAuditResourceDomain('legacy_target')).toBe('other')
  })
})
