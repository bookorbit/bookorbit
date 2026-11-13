import { describe, expect, it } from 'vitest'
import type { GroupRule, Rule } from '@bookorbit/types'
import { defaultRule, isRuleComplete, pruneIncomplete, withOperator } from '../filter-fields'
import { SORT_FIELD_KINDS, naturalDirection, withLeadField } from '../sort-fields'

describe('natural sort direction', () => {
  it('reads text, series order and status from the start, and dates and numbers from the top', () => {
    expect(naturalDirection(SORT_FIELD_KINDS.title)).toBe('asc')
    expect(naturalDirection(SORT_FIELD_KINDS.seriesIndex)).toBe('asc')
    expect(naturalDirection(SORT_FIELD_KINDS.readStatus)).toBe('asc')
    expect(naturalDirection(SORT_FIELD_KINDS.addedAt)).toBe('desc')
    expect(naturalDirection(SORT_FIELD_KINDS.publishedYear)).toBe('desc')
    expect(naturalDirection(SORT_FIELD_KINDS.rating)).toBe('desc')
    expect(naturalDirection(SORT_FIELD_KINDS.fileSize)).toBe('desc')
  })

  it('puts a new lead first in its own order and drops a later level that repeats it', () => {
    const sort = [
      { field: 'title', dir: 'desc' },
      { field: 'addedAt', dir: 'asc' },
      { field: 'author', dir: 'asc' },
    ] as const

    expect(withLeadField([...sort], 'addedAt', 'date')).toEqual([
      { field: 'addedAt', dir: 'desc' },
      { field: 'author', dir: 'asc' },
    ])
  })

  it('lets a random sort stand alone', () => {
    expect(
      withLeadField(
        [
          { field: 'title', dir: 'asc' },
          { field: 'author', dir: 'asc' },
        ],
        'random',
        'random',
      ),
    ).toEqual([{ field: 'random', dir: 'asc' }])
  })
})

describe('filter rules', () => {
  it('starts each kind of field ready to pick a value', () => {
    expect(defaultRule('author', null)).toEqual({ type: 'rule', field: 'author', operator: 'includesAny', value: [] })
    expect(defaultRule('rating', null)).toEqual({ type: 'rule', field: 'rating', operator: 'gte', value: 4 })
    expect(defaultRule('addedAt', null)).toMatchObject({ field: 'addedAt', operator: 'withinLast', value: 30 })
    expect(defaultRule('communityRating', null)).toMatchObject({ field: 'communityRating', provider: 'any' })
  })

  it('carries a value across operators where it still fits', () => {
    const one: Rule = { type: 'rule', field: 'author', operator: 'eq', value: 'Le Guin' }
    expect(withOperator(one, 'includesAny', 'list')).toMatchObject({ operator: 'includesAny', value: ['Le Guin'] })

    const many: Rule = { type: 'rule', field: 'author', operator: 'includesAny', value: ['Le Guin', 'Banks'] }
    expect(withOperator(many, 'eq', 'list')).toMatchObject({ operator: 'eq', value: 'Le Guin' })
    expect(withOperator(many, 'isEmpty', 'list')).not.toHaveProperty('value')

    const range: Rule = { type: 'rule', field: 'pageCount', operator: 'between', value: 100, valueTo: 300 }
    expect(withOperator(range, 'gte', 'number')).toEqual({ type: 'rule', field: 'pageCount', operator: 'gte', value: 100 })
  })

  it('knows a rule is ready only once it has every value its operator needs', () => {
    expect(isRuleComplete({ type: 'rule', field: 'author', operator: 'includesAny', value: [] })).toBe(false)
    expect(isRuleComplete({ type: 'rule', field: 'pageCount', operator: 'between', value: 100 })).toBe(false)
    expect(isRuleComplete({ type: 'rule', field: 'title', operator: 'isEmpty' })).toBe(true)
    expect(isRuleComplete({ type: 'rule', field: 'title', operator: 'contains', value: '' })).toBe(false)
  })

  it('prunes rules without a value and the groups they leave empty, deepest first', () => {
    const filter: GroupRule = {
      type: 'group',
      join: 'AND',
      rules: [
        { type: 'rule', field: 'title', operator: 'contains', value: 'Dune' },
        { type: 'rule', field: 'author', operator: 'includesAny', value: [] },
        { type: 'group', join: 'OR', rules: [{ type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'isbn', operator: 'eq' }] }] },
      ],
    }

    expect(pruneIncomplete(filter)).toEqual({
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }],
    })
  })
})
