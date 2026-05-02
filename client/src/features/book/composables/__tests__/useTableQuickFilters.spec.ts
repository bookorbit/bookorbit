import { describe, it, expect } from 'vitest'
import { useTableQuickFilters } from '../useTableQuickFilters'

describe('useTableQuickFilters', () => {
  describe('getQuickFilterOptions', () => {
    it('returns empty array for non-library view types', () => {
      const { getQuickFilterOptions } = useTableQuickFilters('collection')
      expect(getQuickFilterOptions('title')).toEqual([])
      expect(getQuickFilterOptions('format')).toEqual([])
    })

    it('returns empty array for smart scope view type', () => {
      const { getQuickFilterOptions } = useTableQuickFilters('smartScope')
      expect(getQuickFilterOptions('cover')).toEqual([])
    })

    it('returns file presence options for format column in library view', () => {
      const { getQuickFilterOptions } = useTableQuickFilters('library')
      const options = getQuickFilterOptions('format')
      expect(options).toHaveLength(2)
      expect(options[0]!.key).toBe('present')
      expect(options[1]!.key).toBe('missing')
    })

    it('returns cover presence options for cover column in library view', () => {
      const { getQuickFilterOptions } = useTableQuickFilters('library')
      const options = getQuickFilterOptions('cover')
      expect(options).toHaveLength(2)
      expect(options[0]!.label).toContain('cover')
    })

    it('returns present/missing options for title column', () => {
      const { getQuickFilterOptions } = useTableQuickFilters('library')
      expect(getQuickFilterOptions('title')).toHaveLength(2)
    })

    it('returns options for all text field columns', () => {
      const { getQuickFilterOptions } = useTableQuickFilters('library')
      for (const colId of ['seriesName', 'publisher', 'language', 'isbn13', 'subtitle'] as const) {
        expect(getQuickFilterOptions(colId)).toHaveLength(2)
      }
    })

    it('returns options for all value field columns', () => {
      const { getQuickFilterOptions } = useTableQuickFilters('library')
      for (const colId of ['authors', 'genres', 'tags', 'readStatus', 'rating', 'pageCount', 'publishedYear'] as const) {
        expect(getQuickFilterOptions(colId)).toHaveLength(2)
      }
    })

    it('returns empty array for fileSize column (not filterable)', () => {
      const { getQuickFilterOptions } = useTableQuickFilters('library')
      expect(getQuickFilterOptions('fileSize')).toEqual([])
    })

    it('returns empty array for actions column', () => {
      const { getQuickFilterOptions } = useTableQuickFilters('library')
      expect(getQuickFilterOptions('actions')).toEqual([])
    })
  })

  describe('buildQuickFilterRule', () => {
    const { buildQuickFilterRule } = useTableQuickFilters('library')

    it('returns fileAvailability isMissing rule for format+missing', () => {
      const rule = buildQuickFilterRule('format', 'missing')
      expect(rule).toEqual({ type: 'rule', field: 'fileAvailability', operator: 'isMissing' })
    })

    it('returns fileAvailability isPresent rule for format+present', () => {
      const rule = buildQuickFilterRule('format', 'present')
      expect(rule).toEqual({ type: 'rule', field: 'fileAvailability', operator: 'isPresent' })
    })

    it('returns cover isMissing rule for cover+missing', () => {
      const rule = buildQuickFilterRule('cover', 'missing')
      expect(rule).toEqual({ type: 'rule', field: 'cover', operator: 'isMissing' })
    })

    it('returns cover isPresent rule for cover+present', () => {
      const rule = buildQuickFilterRule('cover', 'present')
      expect(rule).toEqual({ type: 'rule', field: 'cover', operator: 'isPresent' })
    })

    it('returns title isEmpty rule for title+missing', () => {
      const rule = buildQuickFilterRule('title', 'missing')
      expect(rule).toEqual({ type: 'rule', field: 'title', operator: 'isEmpty' })
    })

    it('returns title isNotEmpty rule for title+present', () => {
      const rule = buildQuickFilterRule('title', 'present')
      expect(rule).toEqual({ type: 'rule', field: 'title', operator: 'isNotEmpty' })
    })

    it('returns series isEmpty rule for seriesName+missing', () => {
      const rule = buildQuickFilterRule('seriesName', 'missing')
      expect(rule).toEqual({ type: 'rule', field: 'series', operator: 'isEmpty' })
    })

    it('returns author isEmpty rule for authors+missing', () => {
      const rule = buildQuickFilterRule('authors', 'missing')
      expect(rule).toEqual({ type: 'rule', field: 'author', operator: 'isEmpty' })
    })

    it('returns genre isEmpty rule for genres+missing', () => {
      const rule = buildQuickFilterRule('genres', 'missing')
      expect(rule).toEqual({ type: 'rule', field: 'genre', operator: 'isEmpty' })
    })

    it('returns readStatus isEmpty rule for readStatus+missing', () => {
      const rule = buildQuickFilterRule('readStatus', 'missing')
      expect(rule).toEqual({ type: 'rule', field: 'readStatus', operator: 'isEmpty' })
    })

    it('returns rating isEmpty rule for rating+missing', () => {
      const rule = buildQuickFilterRule('rating', 'missing')
      expect(rule).toEqual({ type: 'rule', field: 'rating', operator: 'isEmpty' })
    })

    it('returns null for unrecognized column', () => {
      expect(buildQuickFilterRule('fileSize', 'missing')).toBeNull()
      expect(buildQuickFilterRule('actions', 'missing')).toBeNull()
      expect(buildQuickFilterRule('addedAt', 'missing')).toBeNull()
    })
  })
})
