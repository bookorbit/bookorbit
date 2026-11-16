import type { GroupRule, Rule, RuleField, RuleOperator, SortField } from '@bookorbit/types'
import { isReadAlongFormatKey, parseCustomRuleFieldId, parseCustomSortFieldId, PLAIN_EPUB_FILTER_FORMAT } from '@bookorbit/types'
import { i18n } from '@/i18n'
import { activeCustomFieldLabel } from '@/features/book/composables/useActiveCustomFields'
import { providerShortLabel } from '@/lib/provider-colors'
import { formatBytes } from '@/lib/formatting'
import { formatKeyName } from './book-formats'

// Resolved through the global composer rather than useI18n() because these helpers also run
// outside a component setup (useViewSort, plain computeds). Composer.t tracks the active locale,
// so computeds and templates calling these still re-evaluate on a language change.
const t = i18n.global.t

export function sortFieldLabel(field: SortField): string {
  const customFieldId = parseCustomSortFieldId(field)
  if (customFieldId === null) return t(`book.sort.fields.${field}`)
  // Custom field labels are user-authored, so they are shown as-is rather than translated.
  return activeCustomFieldLabel(customFieldId) ?? t('book.sort.customFieldFallback')
}

// Fields both catalogs name read the same everywhere, so the filter takes the sort catalog's label for these.
const SHARED_SORT_LABEL_FIELDS: ReadonlySet<RuleField> = new Set<RuleField>(['seriesIndex', 'fileSize', 'addedAt', 'readProgress'])

export function fieldLabel(field: RuleField): string {
  const customFieldId = parseCustomRuleFieldId(field)
  if (customFieldId === null) return t(SHARED_SORT_LABEL_FIELDS.has(field) ? `book.sort.fields.${field}` : `book.filter.fields.${field}`)
  // Custom field labels are user-authored, so they are shown as-is rather than translated.
  return activeCustomFieldLabel(customFieldId) ?? t('book.filter.customFieldFallback')
}

export function operatorLabel(operator: RuleOperator): string {
  return t(`book.filter.operators.${operator}`)
}

const NO_VALUE_OPS: RuleOperator[] = [
  'isEmpty',
  'isNotEmpty',
  'isMissing',
  'isPresent',
  'isUnread',
  'isInProgress',
  'isFinished',
  'isLocked',
  'isUnlocked',
  'isUpNext',
  'isTrue',
  'isFalse',
]

function communityRatingProviderLabel(rule: Rule): string {
  if (rule.field !== 'communityRating' && rule.field !== 'communityRatingCount') return ''
  const provider = rule.provider ?? 'any'
  if (provider === 'any') return t('book.filter.anyProvider')
  return providerShortLabel(provider)
}

export function ruleToParts(rule: Rule): { field: string; operator: string; value: string | null } {
  const field =
    rule.field === 'communityRating' || rule.field === 'communityRatingCount'
      ? `${fieldLabel(rule.field)} (${communityRatingProviderLabel(rule)})`
      : fieldLabel(rule.field)
  const operator = operatorLabel(rule.operator)
  if (NO_VALUE_OPS.includes(rule.operator)) return { field, operator, value: null }
  if (rule.operator === 'withinLast') return { field, operator, value: `${rule.value} ${t('book.filter.unit.days')}` }
  if (rule.operator === 'moreThanAgo') return { field, operator, value: `${rule.value} ${t('book.filter.unit.daysAgo')}` }
  if (rule.field === 'fileSize') {
    const value = typeof rule.value === 'number' ? formatBytes(rule.value) : ''
    const valueTo = typeof rule.valueTo === 'number' ? formatBytes(rule.valueTo) : null
    return { field, operator, value: valueTo === null ? value : `${value} - ${valueTo}` }
  }
  const values = Array.isArray(rule.value) ? (rule.value as string[]) : null
  const val = values
    ? values.map((value) => (rule.field === 'authorGender' ? filterValueLabel(rule.field, value) : value)).join(', ')
    : String(rule.value ?? '')
  return { field, operator, value: rule.valueTo !== undefined ? `${val} - ${rule.valueTo}` : val }
}

/** A list value as people read it: read statuses by their translated names, formats by their codes. */
export function filterValueLabel(field: Rule['field'], value: string): string {
  if (field === 'authorGender') return t(`author.gender.${value}`)
  if (field === 'readStatus') {
    const key = `book.readStatus.${value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`
    const label = t(key)
    return label === key ? value : label
  }
  if (field === 'format') return formatFilterValueLabel(value)
  return value
}

export function formatFilterValueLabel(value: string): string {
  return isReadAlongFormatKey(value) || value === PLAIN_EPUB_FILTER_FORMAT ? formatKeyName(value) : value.toUpperCase()
}

/**
 * The compact form a rule takes as a token in the browse search field. A single-value
 * "includes any of" reads as "is", read statuses use their translated names and formats
 * their codes; everything else matches `ruleToParts`.
 */
export function ruleToTokenParts(rule: Rule): { field: string; operator: string; value: string | null } {
  const parts = ruleToParts(rule)
  if (!Array.isArray(rule.value) || (rule.field !== 'readStatus' && rule.field !== 'format')) {
    const operator = Array.isArray(rule.value) ? singleValueOperator(rule, rule.value.length) : null
    return operator ? { ...parts, operator } : parts
  }
  const values = (rule.value as string[]).map((value) => filterValueLabel(rule.field, value))
  return { field: parts.field, operator: singleValueOperator(rule, values.length) ?? parts.operator, value: values.join(', ') }
}

/** "includes any of" one value reads as "is", and "excludes all of" one value as "is not". */
function singleValueOperator(rule: Rule, count: number): string | null {
  if (count !== 1) return null
  if (rule.operator === 'includesAny') return operatorLabel('eq')
  if (rule.operator === 'excludesAll') return operatorLabel('notEq')
  return null
}

/** A rule as one line of words, "Read Status is Reading", for lists of active filters and accessible names. */
export function ruleSentence(rule: Rule): string {
  const parts = ruleToTokenParts(rule)
  return [parts.field, parts.operator, parts.value].filter(Boolean).join(' ')
}

/** A group as the token that stands for it, "Any of 2 rules". */
export function groupLabel(group: GroupRule): string {
  return group.join === 'OR'
    ? t('components.browseHeader.tokens.anyOf', { count: group.rules.length })
    : t('components.browseHeader.tokens.allOf', { count: group.rules.length })
}
