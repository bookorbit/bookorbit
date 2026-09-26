import type { Rule, StaticRuleField, TableViewType } from '@bookorbit/types'
import { i18n } from '@/i18n'

// Resolved through the global composer because this runs outside a component setup; the template
// that calls it still re-renders on a language change.
const t = i18n.global.t

type QuickFilterField = Exclude<StaticRuleField, 'communityRating' | 'communityRatingCount'>

const TEXT_FIELD_MAP: Partial<Record<string, QuickFilterField>> = {
  title: 'title',
  seriesName: 'series',
  publisher: 'publisher',
  language: 'language',
  isbn13: 'isbn',
  subtitle: 'description',
}

const VALUE_FIELD_MAP: Partial<Record<string, QuickFilterField>> = {
  authors: 'author',
  genres: 'genre',
  tags: 'tag',
  readStatus: 'readStatus',
  rating: 'rating',
  pageCount: 'pageCount',
  publishedDate: 'publishedDate',
  publishedYear: 'publishedYear',
  metadataScore: 'metadataScore',
}

export function useTableQuickFilters(viewType: TableViewType) {
  function getQuickFilterOptions(colId: string): { key: string; label: string }[] {
    if (viewType !== 'library') return []

    if (colId === 'format') {
      return [
        { key: 'present', label: t('book.table.quickFilter.presentFiles') },
        { key: 'missing', label: t('book.table.quickFilter.missingFiles') },
      ]
    }

    if (colId === 'cover') {
      return [
        { key: 'present', label: t('book.table.quickFilter.withCovers') },
        { key: 'missing', label: t('book.table.quickFilter.missingCovers') },
        { key: 'missingAudio', label: t('book.table.quickFilter.missingAudioCovers') },
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
        'publishedDate',
        'publishedYear',
        'metadataScore',
      ].includes(colId)
    ) {
      return [
        { key: 'present', label: t('book.table.quickFilter.withValues') },
        { key: 'missing', label: t('book.table.quickFilter.emptyRows') },
      ]
    }

    return []
  }

  function buildQuickFilterRule(colId: string, key: string): Rule | null {
    if (colId === 'format') return { type: 'rule', field: 'fileAvailability', operator: key === 'missing' ? 'isMissing' : 'isPresent' }
    if (colId === 'cover' && key === 'missingAudio') return { type: 'rule', field: 'audioCover', operator: 'isMissing' }
    if (colId === 'cover') return { type: 'rule', field: 'cover', operator: key === 'missing' ? 'isMissing' : 'isPresent' }

    const textField = TEXT_FIELD_MAP[colId]
    if (textField) return { type: 'rule', field: textField, operator: key === 'missing' ? 'isEmpty' : 'isNotEmpty' }

    const valueField = VALUE_FIELD_MAP[colId]
    if (valueField) return { type: 'rule', field: valueField, operator: key === 'missing' ? 'isEmpty' : 'isNotEmpty' }

    return null
  }

  return { getQuickFilterOptions, buildQuickFilterRule }
}
