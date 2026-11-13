import type { Component } from 'vue'
import {
  Building,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  CircleDashed,
  Clock,
  FileText,
  FileType,
  HardDrive,
  Hash,
  Languages,
  Layers,
  Library,
  Link2,
  ListOrdered,
  Percent,
  Shuffle,
  Sparkles,
  Star,
  TextQuote,
  ToggleLeft,
  Type,
  User,
} from '@lucide/vue'
import type { CustomMetadataFieldType, SortSpec, StaticSortField } from '@bookorbit/types'

/**
 * How a sort field orders, which decides the words its direction reads as ("A → Z", "Newest first")
 * and the direction it starts in when picked.
 */
export type SortKind = 'text' | 'date' | 'number' | 'index' | 'status' | 'boolean' | 'random'

/** Relevance only ranks against a search query, so no browse sort offers it. */
export type BrowseSortField = Exclude<StaticSortField, 'relevance'>

export type SortGroupKey = 'common' | 'reading' | 'details' | 'files' | 'other' | 'custom'

export const SORT_FIELD_KINDS: Record<BrowseSortField, SortKind> = {
  title: 'text',
  author: 'text',
  series: 'text',
  addedAt: 'date',
  lastReadAt: 'date',
  rating: 'number',
  readStatus: 'status',
  readProgress: 'number',
  startedAt: 'date',
  finishedAt: 'date',
  seriesIndex: 'index',
  publishedDate: 'date',
  publishedYear: 'date',
  publisher: 'text',
  language: 'text',
  pageCount: 'number',
  format: 'text',
  fileSize: 'number',
  updatedAt: 'date',
  metadataScore: 'number',
  random: 'random',
  collectionOrder: 'index',
}

export const SORT_FIELD_ICONS: Record<BrowseSortField, Component> = {
  title: Type,
  author: User,
  series: Library,
  addedAt: CalendarPlus,
  lastReadAt: Clock,
  rating: Star,
  readStatus: CircleDashed,
  readProgress: Percent,
  startedAt: CalendarClock,
  finishedAt: CalendarCheck,
  seriesIndex: ListOrdered,
  publishedDate: Calendar,
  publishedYear: CalendarDays,
  publisher: Building,
  language: Languages,
  pageCount: FileText,
  format: FileType,
  fileSize: HardDrive,
  updatedAt: CalendarRange,
  metadataScore: Sparkles,
  random: Shuffle,
  collectionOrder: Layers,
}

/** The sort list's sections, most used first. A collection's own order leads Common inside a collection. */
export const SORT_FIELD_GROUPS: { key: Exclude<SortGroupKey, 'custom'>; fields: BrowseSortField[] }[] = [
  { key: 'common', fields: ['collectionOrder', 'title', 'author', 'series', 'addedAt', 'lastReadAt', 'rating'] },
  { key: 'reading', fields: ['readStatus', 'readProgress', 'startedAt', 'finishedAt'] },
  { key: 'details', fields: ['seriesIndex', 'publishedDate', 'publishedYear', 'publisher', 'language', 'pageCount'] },
  { key: 'files', fields: ['format', 'fileSize', 'updatedAt', 'metadataScore'] },
  { key: 'other', fields: ['random'] },
]

const NATURAL_DIRECTION: Record<SortKind, SortSpec['dir']> = {
  text: 'asc',
  index: 'asc',
  status: 'asc',
  random: 'asc',
  date: 'desc',
  number: 'desc',
  boolean: 'desc',
}

/** The order a field starts in when picked: text A → Z, series numbers 1 → 9, dates newest first, numbers high to low. */
export function naturalDirection(kind: SortKind): SortSpec['dir'] {
  return NATURAL_DIRECTION[kind]
}

export function customFieldSortKind(type: CustomMetadataFieldType | null | undefined): SortKind {
  if (type === 'number') return 'number'
  if (type === 'date') return 'date'
  if (type === 'boolean') return 'boolean'
  return 'text'
}

export const CUSTOM_FIELD_ICONS: Record<CustomMetadataFieldType, Component> = {
  text: TextQuote,
  url: Link2,
  number: Hash,
  date: Calendar,
  boolean: ToggleLeft,
}

/** The i18n key of a direction's words for a field kind; random has none because it has no order to flip. */
export function directionKey(kind: SortKind, dir: SortSpec['dir']): string | null {
  return kind === 'random' ? null : `book.sort.direction.${kind}.${dir}`
}

/** Makes `field` the first tier in its natural order, keeping the other tiers that do not repeat it. Random stands alone. */
export function withLeadField(sort: SortSpec[], field: SortSpec['field'], kind: SortKind): SortSpec[] {
  if (kind === 'random') return [{ field, dir: 'asc' }]
  return [{ field, dir: naturalDirection(kind) }, ...sort.slice(1).filter((spec) => spec.field !== field)]
}

/** The most tiers a browse sort offers; more than four rarely changes what is on screen. */
export const MAX_SORT_LEVELS = 4
