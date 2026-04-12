import type { Rule, RuleField, RuleOperator, SortField } from '@projectx/types'

export const SORT_FIELD_LABELS: Record<SortField, string> = {
  author: 'Author',
  title: 'Title',
  series: 'Series',
  seriesIndex: 'Series #',
  addedAt: 'Date Added',
  updatedAt: 'Date Updated',
  publishedYear: 'Published Year',
  pageCount: 'Page Count',
  rating: 'Rating',
  publisher: 'Publisher',
  fileSize: 'File Size',
  readProgress: 'Read Progress',
  lastReadAt: 'Last Read',
  finishedAt: 'Date Finished',
  random: 'Random',
}

export const FIELD_LABELS: Record<RuleField, string> = {
  title: 'Title',
  publisher: 'Publisher',
  language: 'Language',
  series: 'Series',
  seriesIndex: 'Series Index',
  publishedYear: 'Published Year',
  pageCount: 'Page Count',
  author: 'Author',
  genre: 'Genre',
  tag: 'Tag',
  collection: 'Collection',
  library: 'Library',
  format: 'Format',
  addedAt: 'Added Date',
  fileAvailability: 'File Availability',
  rating: 'Rating',
  readProgress: 'Reading Progress',
  description: 'Description',
  isbn: 'ISBN',
  metadataScore: 'Metadata Score',
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
  withinLast: 'within last',
  isMissing: 'is missing',
  isPresent: 'is present',
  isUnread: 'is unread',
  isInProgress: 'is in progress',
  isFinished: 'is finished',
}

const NO_VALUE_OPS: RuleOperator[] = ['isEmpty', 'isNotEmpty', 'isMissing', 'isPresent', 'isUnread', 'isInProgress', 'isFinished']

export function ruleToParts(rule: Rule): { field: string; operator: string; value: string | null } {
  const field = FIELD_LABELS[rule.field] ?? rule.field
  const operator = OPERATOR_LABELS[rule.operator] ?? rule.operator
  if (NO_VALUE_OPS.includes(rule.operator)) return { field, operator, value: null }
  if (rule.operator === 'withinLast') return { field, operator, value: `${rule.value} days` }
  const val = Array.isArray(rule.value) ? (rule.value as string[]).join(', ') : String(rule.value ?? '')
  return { field, operator, value: rule.valueTo !== undefined ? `${val} - ${rule.valueTo}` : val }
}
