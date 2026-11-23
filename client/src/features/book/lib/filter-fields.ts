import type { Component } from 'vue'
import {
  Barcode,
  BookMarked,
  Building,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CircleDashed,
  FileCheck,
  FileText,
  FileType,
  HardDrive,
  Headphones,
  History,
  Image,
  Languages,
  Layers,
  Library,
  LibraryBig,
  ListOrdered,
  Lock,
  MessageSquareText,
  Percent,
  Shapes,
  Sparkles,
  Star,
  Tag,
  TextQuote,
  Type,
  User,
  VenusAndMars,
  Users,
} from '@lucide/vue'
import type { CustomMetadataFieldType, GroupRule, Rule, RuleField, RuleOperator, StaticRuleField } from '@bookorbit/types'
import { CUSTOM_FIELD_OPERATORS, CUSTOM_FIELD_TYPE_OPERATORS, FIELD_OPERATORS, isCustomRuleField } from '@bookorbit/types'

/**
 * How a filter field takes its value, which decides the control its panel shows: a checklist, a
 * text box, a number with presets, stars, a date preset list, or a choice between states.
 */
export type FilterKind = 'list' | 'text' | 'number' | 'rating' | 'date' | 'choice'

export type FilterGroupKey = 'book' | 'reading' | 'library' | 'metadata' | 'custom'

export const FILTER_FIELD_KINDS: Record<StaticRuleField, FilterKind> = {
  title: 'text',
  author: 'list',
  authorGender: 'list',
  series: 'list',
  seriesIndex: 'number',
  genre: 'list',
  tag: 'list',
  publisher: 'list',
  language: 'list',
  description: 'choice',
  isbn: 'text',
  readStatus: 'list',
  readProgress: 'choice',
  rating: 'rating',
  startedAt: 'date',
  finishedAt: 'date',
  seriesStatus: 'choice',
  library: 'list',
  collection: 'list',
  format: 'list',
  storyGuide: 'choice',
  fileSize: 'number',
  pageCount: 'number',
  addedAt: 'date',
  fileAvailability: 'choice',
  cover: 'choice',
  audioCover: 'choice',
  publishedDate: 'date',
  publishedYear: 'number',
  originalPublishedYear: 'number',
  communityRating: 'number',
  communityRatingCount: 'number',
  metadataScore: 'number',
  lockStatus: 'choice',
}

export const FILTER_FIELD_ICONS: Record<StaticRuleField, Component> = {
  title: Type,
  author: User,
  authorGender: VenusAndMars,
  series: Library,
  seriesIndex: ListOrdered,
  genre: Shapes,
  tag: Tag,
  publisher: Building,
  language: Languages,
  description: TextQuote,
  isbn: Barcode,
  readStatus: CircleDashed,
  readProgress: Percent,
  rating: Star,
  startedAt: CalendarClock,
  finishedAt: CalendarCheck,
  seriesStatus: BookMarked,
  library: LibraryBig,
  collection: Layers,
  format: FileType,
  storyGuide: Sparkles,
  fileSize: HardDrive,
  pageCount: FileText,
  addedAt: CalendarPlus,
  fileAvailability: FileCheck,
  cover: Image,
  audioCover: Headphones,
  publishedDate: Calendar,
  publishedYear: CalendarDays,
  originalPublishedYear: History,
  communityRating: Users,
  communityRatingCount: MessageSquareText,
  metadataScore: Sparkles,
  lockStatus: Lock,
}

export const FILTER_FIELD_GROUPS: { key: Exclude<FilterGroupKey, 'custom'>; fields: StaticRuleField[] }[] = [
  {
    key: 'book',
    fields: ['title', 'author', 'authorGender', 'series', 'seriesIndex', 'genre', 'tag', 'publisher', 'language', 'description', 'isbn'],
  },
  { key: 'reading', fields: ['readStatus', 'readProgress', 'rating', 'startedAt', 'finishedAt', 'seriesStatus'] },
  {
    key: 'library',
    fields: ['library', 'collection', 'format', 'fileSize', 'pageCount', 'addedAt', 'fileAvailability', 'cover', 'audioCover'],
  },
  {
    key: 'metadata',
    fields: [
      'publishedDate',
      'publishedYear',
      'originalPublishedYear',
      'communityRating',
      'communityRatingCount',
      'metadataScore',
      'storyGuide',
      'lockStatus',
    ],
  },
]

export const NO_VALUE_OPERATORS: readonly RuleOperator[] = [
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
export const LIST_OPERATORS: readonly RuleOperator[] = ['includesAny', 'includesAll', 'excludesAll']
export const RELATIVE_DAY_OPERATORS: readonly RuleOperator[] = ['withinLast', 'moreThanAgo']

/** The order operators are offered in: the most useful first, so a new filter starts on it, and the presence checks last. */
const OPERATOR_RANK: readonly RuleOperator[] = [
  'includesAny',
  'includesAll',
  'excludesAll',
  'withinLast',
  'moreThanAgo',
  'after',
  'before',
  'gte',
  'lte',
  'between',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'eq',
  'notEq',
  'gt',
  'lt',
  'isUnread',
  'isInProgress',
  'isFinished',
  'isPresent',
  'isMissing',
  'isUnlocked',
  'isLocked',
  'isUpNext',
  'isTrue',
  'isFalse',
  'isNotEmpty',
  'isEmpty',
]

function byRank(operators: readonly RuleOperator[]): RuleOperator[] {
  return [...operators].sort((a, b) => OPERATOR_RANK.indexOf(a) - OPERATOR_RANK.indexOf(b))
}

export function customFieldFilterKind(type: CustomMetadataFieldType | null | undefined): FilterKind {
  if (type === 'number') return 'number'
  if (type === 'date') return 'date'
  if (type === 'boolean') return 'choice'
  return 'text'
}

export function filterKindOf(field: RuleField, customType?: CustomMetadataFieldType | null): FilterKind {
  if (isCustomRuleField(field)) return customFieldFilterKind(customType)
  return FILTER_FIELD_KINDS[field as StaticRuleField] ?? 'text'
}

/**
 * Operators a field offers, in the order they are offered. A custom field whose type is no longer
 * known keeps every custom operator so a saved rule still shows its own.
 */
export function operatorsFor(field: RuleField, customType?: CustomMetadataFieldType | null): RuleOperator[] {
  if (isCustomRuleField(field)) return byRank(customType ? CUSTOM_FIELD_TYPE_OPERATORS[customType] : CUSTOM_FIELD_OPERATORS)
  return byRank(FIELD_OPERATORS[field as StaticRuleField] ?? [])
}

export function isCommunityRatingField(field: RuleField): field is 'communityRating' | 'communityRatingCount' {
  return field === 'communityRating' || field === 'communityRatingCount'
}

export const BYTES_PER_MIB = 1024 ** 2

/** Days a relative date filter starts on, "Last 30 days". */
export const DEFAULT_RELATIVE_DAYS = 30

export interface DatePreset {
  key: 'last7' | 'last30' | 'last90' | 'last365' | 'olderThanYear'
  operator: 'withinLast' | 'moreThanAgo'
  days: number
}

export const DATE_PRESETS: readonly DatePreset[] = [
  { key: 'last7', operator: 'withinLast', days: 7 },
  { key: 'last30', operator: 'withinLast', days: 30 },
  { key: 'last90', operator: 'withinLast', days: 90 },
  { key: 'last365', operator: 'withinLast', days: 365 },
  { key: 'olderThanYear', operator: 'moreThanAgo', days: 365 },
]

export interface NumberPreset {
  key: string
  operator: RuleOperator
  value: number
  valueTo?: number
}

/** Quick picks shown above a number field's own inputs. Labels live under `book.filter.presets.<field>.<key>`. */
export const NUMBER_PRESETS: Partial<Record<StaticRuleField, readonly NumberPreset[]>> = {
  pageCount: [
    { key: 'under200', operator: 'lt', value: 200 },
    { key: 'from200to400', operator: 'between', value: 200, valueTo: 400 },
    { key: 'over400', operator: 'gt', value: 400 },
  ],
  metadataScore: [
    { key: 'outstanding', operator: 'gte', value: 90 },
    { key: 'good', operator: 'gte', value: 70 },
    { key: 'fair', operator: 'gte', value: 50 },
    { key: 'poor', operator: 'lt', value: 50 },
  ],
}

export function matchesPreset(rule: Rule, preset: NumberPreset | DatePreset): boolean {
  if ('days' in preset) return rule.operator === preset.operator && Number(rule.value) === preset.days
  return (
    rule.operator === preset.operator &&
    Number(rule.value) === preset.value &&
    (preset.valueTo === undefined || Number(rule.valueTo) === preset.valueTo)
  )
}

/** A new filter on `field`, already complete when its field has a sensible starting value. */
export function defaultRule(field: RuleField, customType?: CustomMetadataFieldType | null): Rule {
  const kind = filterKindOf(field, customType)
  const operator = kind === 'rating' ? 'gte' : (operatorsFor(field, customType)[0] ?? 'eq')
  const rule = { type: 'rule', field, operator } as Rule
  if (isCommunityRatingField(field)) Object.assign(rule, { provider: 'any' })
  if (LIST_OPERATORS.includes(operator)) rule.value = []
  else if (RELATIVE_DAY_OPERATORS.includes(operator)) rule.value = DEFAULT_RELATIVE_DAYS
  else if (kind === 'rating') rule.value = 4
  return rule
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

/** Whether a rule says enough to filter by; one that does not is held back from the query. */
export function isRuleComplete(rule: Rule): boolean {
  if (NO_VALUE_OPERATORS.includes(rule.operator)) return true
  if (LIST_OPERATORS.includes(rule.operator)) return Array.isArray(rule.value) && rule.value.length > 0
  if (rule.operator === 'between') return hasValue(rule.value) && hasValue(rule.valueTo)
  return hasValue(rule.value)
}

/**
 * Moves a rule to another operator, carrying its value across where it still fits: a single value
 * becomes a one-item list and back, and a relative date starts at 30 days.
 */
export function withOperator(rule: Rule, operator: RuleOperator, kind: FilterKind): Rule {
  const next = { ...rule, operator } as Rule
  const was = rule.operator
  if (NO_VALUE_OPERATORS.includes(operator)) {
    delete next.value
    delete next.valueTo
    return next
  }
  if (LIST_OPERATORS.includes(operator)) {
    next.value = Array.isArray(rule.value) ? rule.value : hasValue(rule.value) ? [String(rule.value)] : []
    delete next.valueTo
    return next
  }
  if (Array.isArray(rule.value)) next.value = rule.value.length > 0 ? String(rule.value[0]) : undefined
  if (RELATIVE_DAY_OPERATORS.includes(operator)) {
    if (!RELATIVE_DAY_OPERATORS.includes(was)) next.value = DEFAULT_RELATIVE_DAYS
  } else if (RELATIVE_DAY_OPERATORS.includes(was) && kind === 'date') {
    delete next.value
  }
  if (NO_VALUE_OPERATORS.includes(was) && kind === 'rating') next.value = 4
  if (operator !== 'between') delete next.valueTo
  return next
}

/** Drops the rules that never got a value and the groups left empty by that, deepest first. */
export function pruneIncomplete(group: GroupRule): GroupRule {
  const rules = group.rules.flatMap((node): (Rule | GroupRule)[] => {
    if (node.type === 'group') {
      const pruned = pruneIncomplete(node)
      return pruned.rules.length > 0 ? [pruned] : []
    }
    return isRuleComplete(node) ? [node] : []
  })
  return { ...group, rules }
}
