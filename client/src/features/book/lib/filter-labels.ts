import type { Rule, RuleField, RuleOperator } from '@projectx/types'

export const FIELD_LABELS: Record<RuleField, string> = {
  title: 'Title',
  publisher: 'Publisher',
  language: 'Language',
  series: 'Series',
  seriesIndex: 'Series Index',
  publishedYear: 'Published Year',
  pageCount: 'Page Count',
  author: 'Author',
  tag: 'Tag',
  format: 'Format',
  addedAt: 'Added Date',
}

export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  contains: 'contains',
  notContains: 'does not contain',
  startsWith: 'starts with',
  endsWith: 'ends with',
  eq: 'is',
  notEq: 'is not',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
  between: 'between',
  includesAny: 'includes any of',
  includesAll: 'includes all of',
  excludesAll: 'excludes all of',
  before: 'before',
  after: 'after',
  withinLast: 'within last (days)',
}

const NO_VALUE_OPS: RuleOperator[] = ['isEmpty', 'isNotEmpty']

export function ruleToLabel(rule: Rule): string {
  const field = FIELD_LABELS[rule.field] ?? rule.field
  const op = OPERATOR_LABELS[rule.operator] ?? rule.operator
  if (NO_VALUE_OPS.includes(rule.operator)) return `${field} ${op}`
  const val = Array.isArray(rule.value) ? (rule.value as string[]).join(', ') : String(rule.value ?? '')
  if (rule.valueTo !== undefined) return `${field} ${op} ${val} - ${rule.valueTo}`
  return `${field} ${op} ${val}`
}
