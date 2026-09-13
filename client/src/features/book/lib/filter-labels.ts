import type { Rule, RuleField, RuleOperator, SortField } from '@bookorbit/types'
import { parseCustomRuleFieldId, parseCustomSortFieldId } from '@bookorbit/types'
import { i18n } from '@/i18n'
import { activeCustomFieldLabel } from '@/features/book/composables/useActiveCustomFields'
import { PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'
import { formatBytes } from '@/lib/formatting'

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

export function fieldLabel(field: RuleField): string {
  const customFieldId = parseCustomRuleFieldId(field)
  if (customFieldId === null) return t(`book.filter.fields.${field}`)
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
  return PROVIDER_SHORT_LABELS[provider] ?? provider
}

export function ruleToParts(rule: Rule): { field: string; operator: string; value: string | null } {
  const field =
    rule.field === 'communityRating' || rule.field === 'communityRatingCount'
      ? `${fieldLabel(rule.field)} (${communityRatingProviderLabel(rule)})`
      : fieldLabel(rule.field)
  const operator = operatorLabel(rule.operator)
  if (NO_VALUE_OPS.includes(rule.operator)) return { field, operator, value: null }
  if (rule.operator === 'withinLast') return { field, operator, value: `${rule.value} ${t('book.filter.unit.days')}` }
  if (rule.field === 'fileSize') {
    const value = typeof rule.value === 'number' ? formatBytes(rule.value) : ''
    const valueTo = typeof rule.valueTo === 'number' ? formatBytes(rule.valueTo) : null
    return { field, operator, value: valueTo === null ? value : `${value} - ${valueTo}` }
  }
  const val = Array.isArray(rule.value) ? (rule.value as string[]).join(', ') : String(rule.value ?? '')
  return { field, operator, value: rule.valueTo !== undefined ? `${val} - ${rule.valueTo}` : val }
}
