import { describe, expect, it } from 'vitest'
import { MetadataProviderKey, type BookDetail, type MetadataFetchDiagnostics } from '@bookorbit/types'
import { metadataRefreshAppliedMessage, metadataRefreshEmptyMessage } from '../metadata-refresh-feedback'

function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 137,
    libraryId: 1,
    libraryName: 'Books',
    status: 'present',
    folderPath: '/books/a-little-life',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    title: 'A Little Life',
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedDate: null,
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    rating: null,
    personalNote: null,
    personalNoteUpdatedAt: null,
    communityRatings: [],
    coverSource: null,
    hardcoverEditionId: null,
    providerIds: {},
    authors: [{ id: 1, name: 'Hanya Yanagihara', sortName: null }],
    genres: [],
    tags: [],
    files: [],
    lastWrittenAt: null,
    metadataScore: null,
    readStatus: null,
    audioMetadata: null,
    formatPriority: [],
    comicMetadata: null,
    customMetadata: [],
    lockedFields: [],
    collections: [],
    ...overrides,
  }
}

function diagnostics(overrides: Partial<MetadataFetchDiagnostics>): MetadataFetchDiagnostics {
  return {
    reason: null,
    activeProviders: [],
    fieldRuleProviders: [],
    disabledFieldRuleProviders: [],
    enabledUnreferencedProviders: [],
    throttledProviders: [],
    candidateProviders: [],
    candidateCount: 0,
    resolvedFieldCount: 0,
    ...overrides,
  }
}

describe('metadataRefreshEmptyMessage', () => {
  it('explains disabled field-rule providers and points at enabled alternatives', () => {
    const message = metadataRefreshEmptyMessage(
      diagnostics({
        reason: 'no_active_providers',
        disabledFieldRuleProviders: [MetadataProviderKey.GOODREADS, MetadataProviderKey.GOOGLE],
        enabledUnreferencedProviders: [MetadataProviderKey.KOBO, MetadataProviderKey.HARDCOVER],
      }),
      makeBook(),
    )

    expect(message).toBe(
      'No metadata fetched: Field Rules only use disabled providers (Goodreads or Google Books). Enable them or add Kobo or Hardcover to Field Rules.',
    )
  })

  it('includes the book search terms when active providers found no candidates', () => {
    const message = metadataRefreshEmptyMessage(
      diagnostics({
        reason: 'no_candidates',
        activeProviders: [MetadataProviderKey.KOBO],
      }),
      makeBook(),
    )

    expect(message).toBe('No metadata found from active providers for "A Little Life" by Hanya Yanagihara.')
  })

  it('distinguishes provider results that were filtered by rules', () => {
    const message = metadataRefreshEmptyMessage(
      diagnostics({
        reason: 'no_resolved_fields',
        activeProviders: [MetadataProviderKey.GOOGLE],
        candidateProviders: [MetadataProviderKey.GOOGLE],
        candidateCount: 1,
      }),
      makeBook(),
    )

    expect(message).toBe(
      'Metadata providers responded, but Field Rules did not produce any fields to apply. Check fill/overwrite rules, genre blocklist, or selected providers.',
    )
  })
})

describe('metadataRefreshAppliedMessage', () => {
  it('reports matched and enabled unreferenced providers', () => {
    const message = metadataRefreshAppliedMessage(
      diagnostics({
        candidateProviders: [MetadataProviderKey.GOOGLE, MetadataProviderKey.LIBROFM],
        enabledUnreferencedProviders: [MetadataProviderKey.AUDNEXUS],
      }),
      3,
    )

    expect(message).toBe(
      'Auto-filled 3 fields. Matched Google Books or Libro.fm. Not queried because they are not selected in Field Rules: AudNexus.',
    )
  })
})
