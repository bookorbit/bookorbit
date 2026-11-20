import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { GroupRule, Rule } from '@bookorbit/types'
import { READ_ALONG_FORMAT_PRIORITY } from '@bookorbit/types'
import { useFilterTokens } from '../useFilterTokens'
import { ruleToTokenParts } from '../../lib/filter-labels'

const unread: Rule = { type: 'rule', field: 'readStatus', operator: 'includesAny', value: ['unread'] }
const epub: Rule = { type: 'rule', field: 'format', operator: 'includesAny', value: ['epub'] }

function and(...rules: (Rule | GroupRule)[]): GroupRule {
  return { type: 'group', join: 'AND', rules }
}

describe('useFilterTokens', () => {
  it('leaves the root format rule to the chips and shows every other rule as a token', () => {
    const filter = ref<GroupRule | undefined>(and(unread, epub))
    const { tokens, selectedFormats, ruleCount } = useFilterTokens(filter)

    expect(selectedFormats.value).toEqual(['epub'])
    expect(tokens.value).toEqual([{ index: 0, kind: 'rule', field: 'Read Status', operator: 'is', value: 'Unread' }])
    expect(ruleCount.value).toBe(2)
  })

  it('adds, extends and finally drops the format rule as chips are toggled', () => {
    const filter = ref<GroupRule | undefined>(and(unread))
    const { toggleFormat } = useFilterTokens(filter)

    toggleFormat('epub')
    expect(filter.value).toEqual(and(unread, epub))

    toggleFormat('mobi')
    expect(filter.value).toEqual(and(unread, { ...epub, value: ['epub', 'mobi'] }))

    toggleFormat('epub')
    toggleFormat('mobi')
    expect(filter.value).toEqual(and(unread))
  })

  it('clears the filter entirely when the last format chip is unpicked', () => {
    const filter = ref<GroupRule | undefined>(undefined)
    const { toggleFormat } = useFilterTokens(filter)

    toggleFormat('pdf')
    expect(filter.value).toEqual(and({ ...epub, value: ['pdf'] }))
    toggleFormat('pdf')
    expect(filter.value).toBeUndefined()
  })

  it('removes the token at its root position and drops an emptied filter', () => {
    const filter = ref<GroupRule | undefined>(and(unread, epub))
    const { removeToken, tokens } = useFilterTokens(filter)

    removeToken(0)
    expect(filter.value).toEqual(and(epub))
    expect(tokens.value).toEqual([])

    removeToken(0)
    expect(filter.value).toBeUndefined()
  })

  it('shows every rule of an OR root as its own token and ANDs a picked format beside the whole OR', () => {
    const orRoot: GroupRule = { type: 'group', join: 'OR', rules: [unread, epub] }
    const filter = ref<GroupRule | undefined>(orRoot)
    const { tokens, selectedFormats, ruleCount, join, toggleFormat } = useFilterTokens(filter)

    expect(selectedFormats.value).toEqual([])
    expect(join.value).toBe('OR')
    expect(ruleCount.value).toBe(2)
    expect(tokens.value.map((token) => [token.index, token.field, token.value])).toEqual([
      [0, 'Read Status', 'Unread'],
      [1, 'Format', 'EPUB'],
    ])

    toggleFormat('azw3')
    expect(filter.value).toEqual(and(orRoot, { ...epub, value: ['azw3'] }))
  })

  it('switches how the root rules combine and leaves an empty filter alone', () => {
    const filter = ref<GroupRule | undefined>(and(unread, epub))
    const { join, setJoin, selectedFormats } = useFilterTokens(filter)

    setJoin('OR')
    expect(filter.value).toEqual({ type: 'group', join: 'OR', rules: [unread, epub] })
    expect(join.value).toBe('OR')
    expect(selectedFormats.value).toEqual([])

    filter.value = undefined
    setJoin('AND')
    expect(filter.value).toBeUndefined()
    expect(join.value).toBe('AND')
  })

  it('shows a nested group as one token marked as a group', () => {
    const nested: GroupRule = { type: 'group', join: 'OR', rules: [unread, epub] }
    const filter = ref<GroupRule | undefined>(and(nested))
    const { tokens } = useFilterTokens(filter)

    expect(tokens.value).toEqual([{ index: 0, kind: 'group', field: 'Any of 2 rules', operator: '', value: null }])
  })

  it('turns every rule into a token when the view has no format chips', () => {
    const filter = ref<GroupRule | undefined>(and(unread, epub))
    const { tokens, selectedFormats } = useFilterTokens(filter, { formatFacet: false })

    expect(selectedFormats.value).toEqual([])
    expect(tokens.value.map((token) => token.field)).toEqual(['Read Status', 'Format'])
  })
})

describe('ruleToTokenParts', () => {
  it('reads a single-value "includes any of" as "is" with translated statuses and format codes', () => {
    expect(ruleToTokenParts({ type: 'rule', field: 'readStatus', operator: 'includesAny', value: ['want_to_read'] })).toEqual({
      field: 'Read Status',
      operator: 'is',
      value: 'Want to Read',
    })
    expect(ruleToTokenParts(epub)).toEqual({ field: 'Format', operator: 'is', value: 'EPUB' })
    expect(ruleToTokenParts({ ...epub, value: [READ_ALONG_FORMAT_PRIORITY] })).toEqual({
      field: 'Format',
      operator: 'is',
      value: 'Read-aloud EPUB',
    })
  })

  it('keeps the full operator when several values are picked', () => {
    expect(ruleToTokenParts({ ...epub, value: ['epub', 'pdf'] })).toEqual({ field: 'Format', operator: 'includes any of', value: 'EPUB, PDF' })
  })
})
