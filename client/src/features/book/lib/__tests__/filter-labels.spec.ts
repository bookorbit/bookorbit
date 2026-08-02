import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomMetadataFieldSummary, Rule } from '@bookorbit/types'
import { RULE_FIELDS, RULE_OPERATORS, SORT_FIELDS } from '@bookorbit/types'
import { activateI18nLocale, i18n } from '@/i18n'
import { compileIcuCatalog } from '@/i18n/icu'
import en from '@/locales/en.json'
import { activeCustomFieldLabel } from '@/features/book/composables/useActiveCustomFields'
import { fieldLabel, operatorLabel, ruleToParts, sortFieldLabel } from '../filter-labels'

vi.mock('@/features/book/composables/useActiveCustomFields', () => ({
  activeCustomFieldLabel: vi.fn<(fieldId: number) => string | null>(() => null),
}))

function mockCustomFieldLabel(label: CustomMetadataFieldSummary['label'] | null) {
  vi.mocked(activeCustomFieldLabel).mockReturnValue(label)
}

describe('catalog coverage', () => {
  it('translates every rule field', () => {
    for (const field of RULE_FIELDS) {
      expect(fieldLabel(field)).not.toBe(`book.filter.fields.${field}`)
    }
  })

  it('translates every rule operator', () => {
    for (const operator of RULE_OPERATORS) {
      expect(operatorLabel(operator)).not.toBe(`book.filter.operators.${operator}`)
    }
  })

  it('translates every sort field', () => {
    for (const field of SORT_FIELDS) {
      expect(sortFieldLabel(field)).not.toBe(`book.sort.fields.${field}`)
    }
  })
})

describe('custom metadata sort fields', () => {
  it('shows the user-authored field label verbatim', () => {
    mockCustomFieldLabel('Shelf Location')

    expect(sortFieldLabel('custom:7')).toBe('Shelf Location')
    expect(activeCustomFieldLabel).toHaveBeenCalledWith(7)
  })

  it('falls back to a translated placeholder when the field no longer resolves', () => {
    mockCustomFieldLabel(null)

    expect(sortFieldLabel('custom:7')).toBe('Custom field')
  })
})

describe('active locale', () => {
  afterEach(() => {
    activateI18nLocale('en')
  })

  it('resolves labels from the active locale instead of hardcoded English', () => {
    const catalog = structuredClone(en)
    catalog.book.filter.fields.title = 'Titel'
    catalog.book.filter.operators.contains = 'enthält'
    catalog.book.sort.fields.title = 'Titel'
    i18n.global.setLocaleMessage('de', compileIcuCatalog(catalog, 'de'))
    activateI18nLocale('de')

    expect(fieldLabel('title')).toBe('Titel')
    expect(operatorLabel('contains')).toBe('enthält')
    expect(sortFieldLabel('title')).toBe('Titel')
  })
})

describe('lock status labels', () => {
  it('exposes a Lock Status field label', () => {
    expect(fieldLabel('lockStatus')).toBe('Lock Status')
  })

  it('exposes is locked / is unlocked operator labels', () => {
    expect(operatorLabel('isLocked')).toBe('is locked')
    expect(operatorLabel('isUnlocked')).toBe('is unlocked')
  })
})

describe('series status labels', () => {
  it('exposes a Series Status field label', () => {
    expect(fieldLabel('seriesStatus')).toBe('Series Status')
  })

  it('exposes an is up next operator label', () => {
    expect(operatorLabel('isUpNext')).toBe('is up next')
  })
})

describe('community rating labels', () => {
  it('exposes a Community Rating field label', () => {
    expect(fieldLabel('communityRating')).toBe('Community Rating')
  })
})

describe('ruleToParts', () => {
  it('renders a locked rule with no value', () => {
    const rule: Rule = { type: 'rule', field: 'lockStatus', operator: 'isLocked' }
    expect(ruleToParts(rule)).toEqual({ field: 'Lock Status', operator: 'is locked', value: null })
  })

  it('renders an unlocked rule with no value', () => {
    const rule: Rule = { type: 'rule', field: 'lockStatus', operator: 'isUnlocked' }
    expect(ruleToParts(rule)).toEqual({ field: 'Lock Status', operator: 'is unlocked', value: null })
  })

  it('renders an up-next rule with no value', () => {
    const rule: Rule = { type: 'rule', field: 'seriesStatus', operator: 'isUpNext' }
    expect(ruleToParts(rule)).toEqual({ field: 'Series Status', operator: 'is up next', value: null })
  })

  it('renders withinLast rules with a days suffix', () => {
    const rule: Rule = { type: 'rule', field: 'addedAt', operator: 'withinLast', value: 7 }
    expect(ruleToParts(rule)).toEqual({ field: 'Added Date', operator: 'within last', value: '7 days' })
  })

  it('joins array values with commas', () => {
    const rule: Rule = { type: 'rule', field: 'author', operator: 'includesAny', value: ['Tolkien', 'Le Guin'] }
    expect(ruleToParts(rule)).toEqual({ field: 'Author', operator: 'includes any of', value: 'Tolkien, Le Guin' })
  })

  it('renders a range when valueTo is present', () => {
    const rule: Rule = { type: 'rule', field: 'pageCount', operator: 'between', value: 100, valueTo: 200 }
    expect(ruleToParts(rule)).toEqual({ field: 'Page Count', operator: 'between', value: '100 - 200' })
  })

  it('renders an empty value when a valued operator has no value', () => {
    const rule: Rule = { type: 'rule', field: 'title', operator: 'eq' }
    expect(ruleToParts(rule)).toEqual({ field: 'Title', operator: 'is', value: '' })
  })

  it('renders provider context for community rating rules', () => {
    const rule: Rule = { type: 'rule', field: 'communityRating', provider: 'amazon', operator: 'gte', value: 4.5 }
    expect(ruleToParts(rule)).toEqual({ field: 'Community Rating (Amazon)', operator: 'at least', value: '4.5' })
  })

  it('renders any-provider context for community rating rules', () => {
    const rule: Rule = { type: 'rule', field: 'communityRating', provider: 'any', operator: 'gte', value: 4.5 }
    expect(ruleToParts(rule)).toEqual({ field: 'Community Rating (Any provider)', operator: 'at least', value: '4.5' })
  })
})
