import { describe, expect, it } from 'vitest'
import type { Rule } from '@bookorbit/types'
import { FIELD_LABELS, OPERATOR_LABELS, ruleToParts } from '../filter-labels'

describe('lock status labels', () => {
  it('exposes a Lock Status field label', () => {
    expect(FIELD_LABELS.lockStatus).toBe('Lock Status')
  })

  it('exposes is locked / is unlocked operator labels', () => {
    expect(OPERATOR_LABELS.isLocked).toBe('is locked')
    expect(OPERATOR_LABELS.isUnlocked).toBe('is unlocked')
  })
})

describe('series status labels', () => {
  it('exposes a Series Status field label', () => {
    expect(FIELD_LABELS.seriesStatus).toBe('Series Status')
  })

  it('exposes an is up next operator label', () => {
    expect(OPERATOR_LABELS.isUpNext).toBe('is up next')
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
})
