import { describe, expect, it } from 'vitest'
import { ALL_METADATA_FIELDS } from '@bookorbit/types'
import type { FieldPreference, MetadataField, MetadataProviderKey, ProviderStatus } from '@bookorbit/types'
import {
  applyProviderAction,
  fieldsMatching,
  isProviderUsable,
  providerRank,
  providerUsageCount,
  resolvedProviders,
  skippedProviders,
  skipReasonFor,
} from '../field-rules'

const status = (key: string, enabled: boolean, configured: boolean): ProviderStatus => ({ key, label: key, enabled, configured }) as ProviderStatus

const STATUSES: ProviderStatus[] = [
  status('goodreads', true, true),
  status('google', true, true),
  status('kobo', false, true),
  status('aladin', true, false),
]

const key = (value: string) => value as MetadataProviderKey

function makeFields(overrides: Partial<Record<MetadataField, Partial<FieldPreference>>> = {}) {
  return ALL_METADATA_FIELDS.reduce<Record<MetadataField, FieldPreference>>(
    (result, field) => {
      result[field] = { enabled: true, providers: [], mergeStrategy: 'overwriteIfProvided', ...overrides[field] }
      return result
    },
    {} as Record<MetadataField, FieldPreference>,
  )
}

describe('skipReasonFor', () => {
  it('reports disabled ahead of unconfigured', () => {
    expect(skipReasonFor(status('kobo', false, false))).toBe('disabled')
  })

  it('reports unconfigured for an enabled provider without credentials', () => {
    expect(skipReasonFor(status('aladin', true, false))).toBe('notConfigured')
  })

  it('reports nothing for a usable provider', () => {
    expect(skipReasonFor(status('google', true, true))).toBeNull()
  })
})

describe('isProviderUsable', () => {
  it('treats a provider with no status entry as usable so it stays removable', () => {
    expect(isProviderUsable(key('unknownProvider'), STATUSES)).toBe(true)
  })

  it('rejects a disabled or unconfigured provider', () => {
    expect(isProviderUsable(key('kobo'), STATUSES)).toBe(false)
    expect(isProviderUsable(key('aladin'), STATUSES)).toBe(false)
  })
})

describe('resolvedProviders and skippedProviders', () => {
  const chain = [key('kobo'), key('goodreads'), key('aladin'), key('google')]

  it('keeps only the providers that will run, in order', () => {
    expect(resolvedProviders(chain, STATUSES)).toEqual(['goodreads', 'google'])
  })

  it('reports the rest as skipped', () => {
    expect(skippedProviders(chain, STATUSES)).toEqual(['kobo', 'aladin'])
  })
})

describe('providerRank', () => {
  // A skipped provider never takes a turn, so numbering it would overstate the order.
  const chain = [key('kobo'), key('goodreads'), key('aladin'), key('google')]

  it('numbers only the providers that will run', () => {
    expect(providerRank(chain, 1, STATUSES)).toBe(1)
    expect(providerRank(chain, 3, STATUSES)).toBe(2)
  })

  it('gives a skipped provider no rank', () => {
    expect(providerRank(chain, 0, STATUSES)).toBeNull()
    expect(providerRank(chain, 2, STATUSES)).toBeNull()
  })
})

describe('applyProviderAction', () => {
  const chain = [key('goodreads'), key('google'), key('kobo')]

  it('moves a provider to the front without disturbing the rest', () => {
    expect(applyProviderAction(chain, key('kobo'), 'first')).toEqual(['kobo', 'goodreads', 'google'])
  })

  it('moves a provider to the back', () => {
    expect(applyProviderAction(chain, key('goodreads'), 'last')).toEqual(['google', 'kobo', 'goodreads'])
  })

  it('removes a provider', () => {
    expect(applyProviderAction(chain, key('google'), 'remove')).toEqual(['goodreads', 'kobo'])
  })

  it('does not insert a provider the field never had', () => {
    expect(applyProviderAction(chain, key('amazon'), 'first')).toEqual(chain)
  })

  it('is a no-op when removing a provider the field never had', () => {
    expect(applyProviderAction(chain, key('amazon'), 'remove')).toEqual(chain)
  })
})

describe('providerUsageCount', () => {
  it('counts the fields listing a provider', () => {
    const fields = makeFields({
      title: { providers: [key('goodreads'), key('google')] },
      cover: { providers: [key('goodreads')] },
      genres: { providers: [key('google')] },
    })
    expect(providerUsageCount(fields, key('goodreads'))).toBe(2)
    expect(providerUsageCount(fields, key('amazon'))).toBe(0)
  })
})

describe('fieldsMatching', () => {
  const fields = makeFields({
    title: { providers: [key('goodreads')] },
    subtitle: { providers: [key('google')] },
    cover: { providers: [key('goodreads')] },
  })
  const label = (field: MetadataField) => field

  it('returns every field when nothing is filtered', () => {
    const result = fieldsMatching(fields, { query: '', provider: null, overriddenOnly: false, overridden: new Set() }, label)
    expect(result.size).toBe(ALL_METADATA_FIELDS.length)
  })

  it('matches the label case-insensitively, as a substring', () => {
    const result = fieldsMatching(fields, { query: 'TIT', provider: null, overriddenOnly: false, overridden: new Set() }, label)
    expect([...result].sort()).toEqual(['subtitle', 'title'])
  })

  it('filters to the fields using a provider', () => {
    const result = fieldsMatching(fields, { query: '', provider: key('goodreads'), overriddenOnly: false, overridden: new Set() }, label)
    expect([...result].sort()).toEqual(['cover', 'title'])
  })

  it('filters to overridden fields', () => {
    const overridden = new Set<MetadataField>(['cover'])
    const result = fieldsMatching(fields, { query: '', provider: null, overriddenOnly: true, overridden }, label)
    expect([...result]).toEqual(['cover'])
  })

  it('applies every filter together', () => {
    const overridden = new Set<MetadataField>(['title', 'subtitle'])
    const result = fieldsMatching(fields, { query: 't', provider: key('goodreads'), overriddenOnly: true, overridden }, label)
    expect([...result]).toEqual(['title'])
  })
})
