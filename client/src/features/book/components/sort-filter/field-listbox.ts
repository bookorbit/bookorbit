import type { Component } from 'vue'

export interface FieldOption<T extends string = string> {
  value: T
  label: string
  icon: Component
}

export interface FieldOptionGroup<T extends string = string> {
  key: string
  /** Section heading; an empty label draws the options without one. */
  label: string
  options: FieldOption<T>[]
}

/** Case- and accent-insensitive form used to match a typed query against labels. */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
}

export function filterFieldGroups<T extends string>(groups: FieldOptionGroup<T>[], query: string, exclude: readonly T[] = []): FieldOptionGroup<T>[] {
  const needle = normalizeSearch(query.trim())
  return groups
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => !exclude.includes(option.value) && (!needle || normalizeSearch(option.label).includes(needle))),
    }))
    .filter((group) => group.options.length > 0)
}

/** Splits a label around the first case-insensitive match of the query, so the match can be marked. */
export function splitMatch(label: string, query: string): [string, string, string] {
  const needle = query.trim().toLocaleLowerCase()
  const at = needle ? label.toLocaleLowerCase().indexOf(needle) : -1
  if (at < 0) return [label, '', '']
  return [label.slice(0, at), label.slice(at, at + needle.length), label.slice(at + needle.length)]
}
