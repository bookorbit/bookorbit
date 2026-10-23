import { computed, type Ref } from 'vue'
import type { GroupRule, Rule } from '@bookorbit/types'
import { i18n } from '@/i18n'
import { ruleToTokenParts } from '../lib/filter-labels'

export interface FilterToken {
  /** Position of the rule in the root group, which is what removing it needs. */
  index: number
  field: string
  operator: string
  value: string | null
}

function isFormatFacetRule(rule: Rule | GroupRule): rule is Rule & { value: string[] } {
  return rule.type === 'rule' && rule.field === 'format' && rule.operator === 'includesAny' && Array.isArray(rule.value)
}

function normalize(rules: (Rule | GroupRule)[], join: GroupRule['join']): GroupRule | undefined {
  return rules.length > 0 ? { type: 'group', join, rules } : undefined
}

/**
 * Splits a browse filter into what the bar shows twice over: the root-level format rule the
 * format chips own, and every other root rule as a removable token in the search field. Picking
 * a chip edits that one rule, so a format is never stated as a chip and a token at once.
 *
 * Facet chips only own a rule under an AND root. An OR root is kept whole as a single token, and
 * picking a format then ANDs the format rule beside it rather than changing what the OR means.
 * Views without format chips pass `formatFacet: false`, and every rule is then a token.
 */
export function useFilterTokens(filter: Ref<GroupRule | undefined>, options: { formatFacet?: boolean } = {}) {
  const t = i18n.global.t
  const formatFacet = options.formatFacet ?? true

  const formatRuleIndex = computed(() => {
    const root = filter.value
    if (!formatFacet || !root || root.join !== 'AND') return -1
    return root.rules.findIndex(isFormatFacetRule)
  })

  const selectedFormats = computed<string[]>(() => {
    const index = formatRuleIndex.value
    if (index < 0 || !filter.value) return []
    const rule = filter.value.rules[index]
    return rule && isFormatFacetRule(rule) ? [...rule.value] : []
  })

  const tokens = computed<FilterToken[]>(() => {
    const root = filter.value
    if (!root) return []
    if (root.join === 'OR') {
      return [{ index: -1, field: t('components.browseHeader.tokens.anyOf', { count: root.rules.length }), operator: '', value: null }]
    }
    return root.rules.flatMap((rule, index) => {
      if (index === formatRuleIndex.value) return []
      if (rule.type === 'group') {
        const label =
          rule.join === 'OR'
            ? t('components.browseHeader.tokens.anyOf', { count: rule.rules.length })
            : t('components.browseHeader.tokens.allOf', { count: rule.rules.length })
        return [{ index, field: label, operator: '', value: null }]
      }
      return [{ index, ...ruleToTokenParts(rule) }]
    })
  })

  const ruleCount = computed(() => {
    const root = filter.value
    if (!root) return 0
    return root.join === 'OR' ? 1 : root.rules.length
  })

  function removeToken(index: number) {
    const root = filter.value
    if (!root) return
    if (index < 0) {
      filter.value = undefined
      return
    }
    filter.value = normalize(
      root.rules.filter((_, i) => i !== index),
      root.join,
    )
  }

  function setFormats(formats: string[]) {
    const root = filter.value
    const formatRule: Rule = { type: 'rule', field: 'format', operator: 'includesAny', value: formats }
    if (!root) {
      filter.value = formats.length > 0 ? { type: 'group', join: 'AND', rules: [formatRule] } : undefined
      return
    }
    if (root.join === 'OR') {
      if (formats.length === 0) return
      filter.value = { type: 'group', join: 'AND', rules: [root, formatRule] }
      return
    }
    const index = formatRuleIndex.value
    const rules = [...root.rules]
    if (index >= 0) {
      if (formats.length === 0) rules.splice(index, 1)
      else rules[index] = formatRule
    } else if (formats.length > 0) {
      rules.push(formatRule)
    }
    filter.value = normalize(rules, 'AND')
  }

  function toggleFormat(format: string) {
    const current = selectedFormats.value
    setFormats(current.includes(format) ? current.filter((f) => f !== format) : [...current, format])
  }

  return { tokens, selectedFormats, ruleCount, removeToken, toggleFormat, setFormats }
}
