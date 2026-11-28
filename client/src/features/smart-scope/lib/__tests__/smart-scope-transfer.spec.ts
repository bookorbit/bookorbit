import type { CustomMetadataFieldSummary, SmartScope } from '@bookorbit/types'
import { describe, expect, it } from 'vitest'
import { exportScopeTemplate, parseScopeTemplate, scopeReferences, serializeScopeTemplate } from '../smart-scope-transfer'

const scope: SmartScope = {
  id: 95,
  userId: 289,
  name: 'Priority reads',
  icon: 'custom:local-only',
  filter: {
    type: 'group',
    join: 'AND',
    rules: [
      { type: 'rule', field: 'custom:77', operator: 'isTrue' },
      { type: 'rule', field: 'collection', operator: 'isNotEmpty' },
    ],
  },
  defaultSort: [{ field: 'custom:77', dir: 'asc' }],
  isPublic: true,
  coverAspectRatio: '2/3',
  syncToKobo: true,
  koboSyncEnabled: true,
  isOwner: true,
  displayOrder: 0,
  createdAt: '',
  updatedAt: '',
}

const field: CustomMetadataFieldSummary = {
  id: 77,
  label: 'Next to read',
  type: 'boolean',
  displayOrder: 0,
  archivedAt: null,
  enabledLibraryIds: [33],
}

describe('smart scope templates', () => {
  it('shares one portable custom field reference across filter and sort and leaves account settings behind', () => {
    const template = exportScopeTemplate(scope, [field])
    const text = serializeScopeTemplate(template)

    expect(template).toEqual({
      format: 'bookorbit.smart-scope',
      version: 1,
      name: scope.name,
      coverAspectRatio: '2/3',
      icon: 'Aperture',
      filter: {
        type: 'group',
        join: 'AND',
        rules: [
          { type: 'rule', field: 'custom:1', operator: 'isTrue' },
          { type: 'rule', field: 'collection', operator: 'isNotEmpty' },
        ],
      },
      defaultSort: [{ field: 'custom:1', dir: 'asc' }],
      customFields: [{ label: 'Next to read', type: 'boolean' }],
    })
    expect(parseScopeTemplate(text)).toEqual(template)
    expect(scopeReferences(template)).toEqual([{ key: 'custom:1', kind: 'customField', label: 'Next to read', type: 'boolean' }])
  })

  it('rejects unsupported versions and missing or incompatible custom field definitions', () => {
    const template = exportScopeTemplate(scope, [field])

    expect(() => parseScopeTemplate(JSON.stringify({ ...template, version: 2 }))).toThrow('unsupportedVersion')
    expect(() => parseScopeTemplate(JSON.stringify({ ...template, customFields: [] }))).toThrow('invalid')
    expect(() => parseScopeTemplate(JSON.stringify({ ...template, customFields: [{ label: field.label, type: 'text' }] }))).toThrow('invalid')
    expect(() => exportScopeTemplate(scope, [{ ...field, archivedAt: '2026-01-01' }])).toThrow('missingCustomField')
  })
})
