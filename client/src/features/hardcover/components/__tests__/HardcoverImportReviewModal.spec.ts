import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { HardcoverImportPreview, HardcoverImportPreviewRow } from '@bookorbit/types'
import HardcoverImportReviewModal from '../HardcoverImportReviewModal.vue'

function makeRow(overrides: Partial<HardcoverImportPreviewRow> = {}): HardcoverImportPreviewRow {
  const id = overrides.hardcoverUserBookId ?? 1000
  return {
    hardcoverUserBookId: id,
    hardcoverBookId: id + 10,
    hardcoverEditionId: id + 20,
    hardcoverReadId: id + 30,
    hardcoverTitle: `Hardcover ${id}`,
    hardcoverAuthors: ['Frank Herbert'],
    hardcoverStatusId: 3,
    hardcoverStatusLabel: 'Read',
    importedStatus: 'read',
    importedStartedAt: '2024-01-01',
    importedFinishedAt: '2024-01-10',
    importedProgressPercent: 100,
    localBookId: id + 40,
    localPrimaryFileId: id + 50,
    localTitle: `Book ${id}`,
    localAuthors: ['Frank Herbert'],
    localReadStatus: null,
    localProgressPercent: null,
    matchMethod: 'isbn',
    confidence: 100,
    outcome: 'will_update',
    reason: 'Ready to import',
    progressOutcome: 'will_update',
    progressReason: 'Ready to import progress',
    ...overrides,
  }
}

function makePreview(rows: HardcoverImportPreviewRow[]): HardcoverImportPreview {
  return {
    rows,
    summary: {
      totalHardcoverBooks: rows.length,
      matchedBooks: rows.filter((row) => row.localBookId != null).length,
      willUpdate: rows.filter((row) => row.outcome === 'will_update').length,
      needsReview: rows.filter((row) => row.outcome === 'needs_review').length,
      conflicts: rows.filter((row) => row.outcome === 'conflict').length,
      unmatched: rows.filter((row) => row.outcome === 'unmatched').length,
      skipped: rows.filter((row) => row.outcome === 'skipped').length,
      progressWillUpdate: rows.filter((row) => row.progressOutcome === 'will_update').length,
      progressConflicts: rows.filter((row) => row.progressOutcome === 'conflict').length,
      progressSkipped: rows.filter((row) => row.progressOutcome === 'skipped').length,
    },
  }
}

function mountModal(preview = makePreview([makeRow()])) {
  return mount(HardcoverImportReviewModal, {
    props: {
      preview,
      applying: false,
      importProgress: true,
    },
    global: {
      stubs: { Teleport: true },
    },
  })
}

describe('HardcoverImportReviewModal', () => {
  it('selects ready rows by default and emits the selected ids', async () => {
    const wrapper = mountModal(
      makePreview([
        makeRow({ hardcoverUserBookId: 1000, outcome: 'will_update' }),
        makeRow({
          hardcoverUserBookId: 1001,
          outcome: 'needs_review',
          matchMethod: 'title_author',
          confidence: 91,
          reason: 'Review title and author match before import',
        }),
      ]),
    )

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Import selected'))!
      .trigger('click')

    expect(wrapper.emitted('apply')).toEqual([[[1000]]])
  })

  it('allows review rows and progress import to be selected explicitly', async () => {
    const wrapper = mountModal(
      makePreview([
        makeRow({ hardcoverUserBookId: 1000, outcome: 'will_update' }),
        makeRow({
          hardcoverUserBookId: 1001,
          outcome: 'needs_review',
          matchMethod: 'title_author',
          confidence: 91,
          reason: 'Review title and author match before import',
        }),
      ]),
    )

    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(false)
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Review'))!
      .trigger('click')
    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(true)
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Import selected'))!
      .trigger('click')

    expect(wrapper.emitted('update:importProgress')).toEqual([[false]])
    expect(wrapper.emitted('apply')).toEqual([[[1000, 1001]]])
  })

  it('paginates large previews without rendering every row at once', async () => {
    const rows = Array.from({ length: 55 }, (_, index) => makeRow({ hardcoverUserBookId: 1000 + index }))
    const wrapper = mountModal(makePreview(rows))

    expect(wrapper.text()).toContain('1-50 of 55')
    expect(wrapper.text()).toContain('Book 1000')
    expect(wrapper.text()).not.toContain('Book 1054')

    await wrapper.get('button[aria-label="Next page"]').trigger('click')

    expect(wrapper.text()).toContain('51-55 of 55')
    expect(wrapper.text()).toContain('Book 1054')
  })

  it('shows an empty state when filters match no rows', async () => {
    const wrapper = mountModal(makePreview([makeRow({ localTitle: 'Dune' })]))

    await wrapper.get('input[type="search"]').setValue('foundation')

    expect(wrapper.text()).toContain('No rows match the current filters.')
  })

  it('matches accented book metadata with an unaccented search term', async () => {
    const wrapper = mountModal(makePreview([makeRow({ localTitle: 'El Criticón', localAuthors: ['Baltasar Gracián'] })]))

    await wrapper.get('input[type="search"]').setValue('gracian')

    expect(wrapper.text()).toContain('El Criticón')
    expect(wrapper.text()).not.toContain('No rows match the current filters.')
  })

  it('supports bulk selection controls across the current page', async () => {
    const wrapper = mountModal(
      makePreview([
        makeRow({ hardcoverUserBookId: 1000, outcome: 'will_update' }),
        makeRow({
          hardcoverUserBookId: 1001,
          outcome: 'needs_review',
          matchMethod: 'title_author',
          confidence: 91,
          reason: 'Review title and author match before import',
        }),
      ]),
    )

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Clear selection'))!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Review'))!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Select page'))!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Clear page'))!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Select ready'))!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Import selected'))!
      .trigger('click')

    expect(wrapper.emitted('apply')).toEqual([[[1000]]])
  })

  it('renders fallback labels and non-ready outcome states', async () => {
    const wrapper = mountModal(
      makePreview([
        makeRow({
          hardcoverUserBookId: 1000,
          localTitle: null,
          hardcoverTitle: null,
          localAuthors: [],
          hardcoverAuthors: [],
          importedStatus: null,
          localReadStatus: 'on_hold',
          matchMethod: 'hardcover_id',
          confidence: null,
          outcome: 'conflict',
          progressOutcome: 'conflict',
          progressReason: 'BookOrbit already has reading progress',
          importedProgressPercent: 12.34,
          localProgressPercent: 4.5,
          reason: 'BookOrbit already has a read status',
        }),
        makeRow({
          hardcoverUserBookId: 1001,
          localTitle: null,
          hardcoverTitle: 'Remote only',
          localAuthors: ['Local Author'],
          hardcoverAuthors: ['Hardcover Author'],
          matchMethod: null,
          confidence: null,
          outcome: 'unmatched',
          progressOutcome: 'skipped',
          progressReason: 'No matching BookOrbit book found',
          importedProgressPercent: null,
          localProgressPercent: null,
          reason: 'No matching BookOrbit book found',
        }),
        makeRow({
          hardcoverUserBookId: 1002,
          outcome: 'skipped',
          matchMethod: 'title_author',
          progressOutcome: 'skipped',
          reason: 'Hardcover status is not imported',
        }),
      ]),
    )

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('All'))!
      .trigger('click')

    expect(wrapper.text()).toContain('Untitled')
    expect(wrapper.text()).toContain('Remote only')
    expect(wrapper.text()).toContain('Local Author / Hardcover Author')
    expect(wrapper.text()).toContain('Hardcover ID / -')
    expect(wrapper.text()).toContain('Title + author')
    expect(wrapper.text()).toContain('12.3% Hardcover')
    expect(wrapper.text()).toContain('4.5% BookOrbit')
    expect(wrapper.text()).toContain('Conflict')
    expect(wrapper.text()).toContain('Unmatched')
    expect(wrapper.text()).toContain('Skipped')
  })

  it('does not close while apply is in progress', async () => {
    const wrapper = mount(HardcoverImportReviewModal, {
      props: {
        preview: makePreview([makeRow()]),
        applying: true,
        importProgress: true,
      },
      global: {
        stubs: { Teleport: true },
      },
    })

    await wrapper.get('button[aria-label="Close import review"]').trigger('click')

    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
