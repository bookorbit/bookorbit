import { ANNOTATION_COLOR_FILTER_OPTIONS } from '@bookorbit/types'

export interface FilterOption {
  value: string
  label: string
}

export const COLOR_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All colors' },
  ...ANNOTATION_COLOR_FILTER_OPTIONS.map((color) => ({ value: color.hex, label: color.label })),
]

export const STYLE_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All styles' },
  { value: 'highlight', label: 'Highlight' },
  { value: 'underline', label: 'Underline' },
  { value: 'strikethrough', label: 'Strikethrough' },
  { value: 'squiggly', label: 'Squiggly' },
  { value: 'invert', label: 'Invert' },
]

export const ORIGIN_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All sources' },
  { value: 'web', label: 'Web' },
  { value: 'koreader', label: 'KOReader' },
  { value: 'kobo', label: 'Kobo' },
]

export type SortKey = 'newest' | 'oldest' | 'book-asc' | 'book-desc'

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'book-asc', label: 'Book A to Z' },
  { value: 'book-desc', label: 'Book Z to A' },
]

function labelFor(options: FilterOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value
}

export function colorLabel(value: string): string {
  return labelFor(COLOR_OPTIONS, value)
}

export function styleLabel(value: string): string {
  return labelFor(STYLE_OPTIONS, value)
}

export function originLabel(value: string): string {
  return labelFor(ORIGIN_OPTIONS, value)
}
