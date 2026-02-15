export type RuleField =
  | 'title'
  | 'publisher'
  | 'language'
  | 'series'
  | 'seriesIndex'
  | 'publishedYear'
  | 'pageCount'
  | 'author'
  | 'tag'
  | 'format'
  | 'addedAt'
  | 'fileAvailability'
  | 'rating'
  | 'readProgress'
  | 'description'
  | 'isbn'

export type RuleOperator =
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'eq'
  | 'notEq'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'includesAny'
  | 'includesAll'
  | 'excludesAll'
  | 'before'
  | 'after'
  | 'withinLast'
  | 'isMissing'
  | 'isPresent'
  | 'isUnread'
  | 'isInProgress'
  | 'isFinished'

export const FIELD_OPERATORS: Record<RuleField, RuleOperator[]> = {
  title: ['contains', 'notContains', 'startsWith', 'endsWith', 'eq', 'notEq', 'isEmpty', 'isNotEmpty'],
  publisher: ['contains', 'notContains', 'isEmpty', 'isNotEmpty'],
  language: ['eq', 'notEq', 'isEmpty', 'isNotEmpty'],
  series: ['contains', 'notContains', 'isEmpty', 'isNotEmpty'],
  author: ['includesAny', 'includesAll', 'excludesAll', 'isEmpty', 'isNotEmpty'],
  tag: ['includesAny', 'includesAll', 'excludesAll', 'isEmpty', 'isNotEmpty'],
  format: ['includesAny', 'excludesAll'],
  publishedYear: ['eq', 'notEq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  seriesIndex: ['eq', 'notEq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  pageCount: ['gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  addedAt: ['before', 'after', 'between', 'withinLast'],
  fileAvailability: ['isMissing', 'isPresent'],
  rating: ['eq', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty'],
  readProgress: ['isUnread', 'isInProgress', 'isFinished'],
  description: ['isEmpty', 'isNotEmpty'],
  isbn: ['isEmpty', 'isNotEmpty', 'eq'],
}

export const RULE_FIELDS = Object.keys(FIELD_OPERATORS) as RuleField[]

export const RULE_OPERATORS: RuleOperator[] = [
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'eq',
  'notEq',
  'isEmpty',
  'isNotEmpty',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'includesAny',
  'includesAll',
  'excludesAll',
  'before',
  'after',
  'withinLast',
  'isMissing',
  'isPresent',
  'isUnread',
  'isInProgress',
  'isFinished',
]

export type Rule = {
  type: 'rule'
  field: RuleField
  operator: RuleOperator
  value?: string | number | string[] | number[]
  valueTo?: string | number
}

export type GroupRule = {
  type: 'group'
  join: 'AND' | 'OR'
  rules: (Rule | GroupRule)[]
}

export type SortField = 'title' | 'addedAt' | 'publishedYear' | 'pageCount' | 'seriesIndex'

export const SORT_FIELDS: SortField[] = ['title', 'addedAt', 'publishedYear', 'pageCount', 'seriesIndex']

export type SortSpec = {
  field: SortField
  dir: 'asc' | 'desc'
}

export type BookQuery = {
  filter?: GroupRule
  sort: SortSpec[]
  pagination: { page: number; size: number }
}
