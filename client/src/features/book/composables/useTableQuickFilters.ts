import type { Rule, RuleField, TableViewType } from '@bookorbit/types'
import type { ColumnId } from './tableColumnSchema'

const TEXT_FIELD_MAP: Partial<Record<ColumnId, RuleField>> = {
  title: 'title',
  seriesName: 'series',
  publisher: 'publisher',
  language: 'language',
  isbn13: 'isbn',
  subtitle: 'description',
}

const VALUE_FIELD_MAP: Partial<Record<ColumnId, RuleField>> = {
  authors: 'author',
  genres: 'genre',
  tags: 'tag',
  readStatus: 'readStatus',
  rating: 'rating',
  pageCount: 'pageCount',
  publishedYear: 'publishedYear',
}

export function useTableQuickFilters(viewType: TableViewType) {
  function getQuickFilterOptions(colId: ColumnId): { key: string; label: string }[] {
    if (viewType !== 'library') return []

    if (colId === 'format') {
      return [
        { key: 'present', label: 'Filter to present files' },
        { key: 'missing', label: 'Filter to missing files' },
      ]
    }

    if (colId === 'cover') {
      return [
        { key: 'present', label: 'Filter to books with covers' },
        { key: 'missing', label: 'Filter to books missing covers' },
      ]
    }

    if (
      [
        'title',
        'seriesName',
        'publisher',
        'language',
        'isbn13',
        'subtitle',
        'authors',
        'genres',
        'tags',
        'readStatus',
        'rating',
        'pageCount',
        'publishedYear',
      ].includes(colId)
    ) {
      return [
        { key: 'present', label: 'Filter to rows with values' },
        { key: 'missing', label: 'Filter to empty rows' },
      ]
    }

    return []
  }

  function buildQuickFilterRule(colId: ColumnId, key: string): Rule | null {
    if (colId === 'format') return { type: 'rule', field: 'fileAvailability', operator: key === 'missing' ? 'isMissing' : 'isPresent' }
    if (colId === 'cover') return { type: 'rule', field: 'cover', operator: key === 'missing' ? 'isMissing' : 'isPresent' }

    const textField = TEXT_FIELD_MAP[colId]
    if (textField) return { type: 'rule', field: textField, operator: key === 'missing' ? 'isEmpty' : 'isNotEmpty' }

    const valueField = VALUE_FIELD_MAP[colId]
    if (valueField) return { type: 'rule', field: valueField, operator: key === 'missing' ? 'isEmpty' : 'isNotEmpty' }

    return null
  }

  return { getQuickFilterOptions, buildQuickFilterRule }
}
