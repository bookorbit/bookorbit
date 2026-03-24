import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import type { MetadataCandidate, MetadataProviderKey, MetadataSource } from '@projectx/types'
import { useMetadataDiff } from '../useMetadataDiff'

describe('useMetadataDiff', () => {
  const mockCurrent: MetadataSource = {
    title: 'Original Title',
    authors: ['Original Author'],
    genres: ['Genre 1'],
    description: 'Original Description',
    publisher: 'Original Publisher',
    publishedYear: 2020,
    language: 'en',
    pageCount: 300,
    seriesName: 'Original Series',
    seriesIndex: 1,
    isbn10: '1234567890',
    isbn13: '1234567890123',
  }

  const mockCandidate1: MetadataCandidate = {
    provider: 'google',
    providerId: 'g1',
    title: 'Google Title',
    authors: ['Google Author'],
    description: 'Google Description',
    coverUrl: 'http://google.com/cover.jpg',
  }

  const mockCandidate2: MetadataCandidate = {
    provider: 'goodreads',
    providerId: 'gr1',
    title: 'Goodreads Title',
    authors: ['Goodreads Author'],
    genres: ['Genre 2'],
  }

  const providers = [
    { key: 'google' as MetadataProviderKey, label: 'Google Books' },
    { key: 'goodreads' as MetadataProviderKey, label: 'Goodreads' },
  ]

  it('initializes with fields from active provider', () => {
    const candidates = ref([mockCandidate1, mockCandidate2])
    const activeProvider = ref<MetadataProviderKey>('google')
    const { fields } = useMetadataDiff(mockCurrent, candidates, activeProvider, providers)

    const titleField = fields.value.find((f) => f.key === 'title')
    expect(titleField).toBeDefined()
    expect(titleField?.candidateDisplay).toBe('Google Title')
    expect(titleField?.bookValue).toBe('Original Title')
  })

  it('switches fields when active provider changes', () => {
    const candidates = ref([mockCandidate1, mockCandidate2])
    const activeProvider = ref<MetadataProviderKey>('google')
    const { fields } = useMetadataDiff(mockCurrent, candidates, activeProvider, providers)

    activeProvider.value = 'goodreads'
    const titleField = fields.value.find((f) => f.key === 'title')
    expect(titleField?.candidateDisplay).toBe('Goodreads Title')
  })

  it('toggles a field for picking', () => {
    const candidates = ref([mockCandidate1, mockCandidate2])
    const activeProvider = ref<MetadataProviderKey>('google')
    const { fields, toggleField } = useMetadataDiff(mockCurrent, candidates, activeProvider, providers)

    toggleField('title')
    const titleField = fields.value.find((f) => f.key === 'title')
    expect(titleField?.isPicked).toBe(true)
    expect(titleField?.pickedProvider).toBe('google')
  })

  it('picks a field from a specific provider', () => {
    const candidates = ref([mockCandidate1, mockCandidate2])
    const activeProvider = ref<MetadataProviderKey>('google')
    const { fields, pickFieldFromProvider } = useMetadataDiff(mockCurrent, candidates, activeProvider, providers)

    pickFieldFromProvider('authors', 'goodreads')
    const authorsField = fields.value.find((f) => f.key === 'authors')
    expect(authorsField?.isPicked).toBe(true)
    expect(authorsField?.pickedProvider).toBe('goodreads')
    expect(authorsField?.pickedDisplay).toBe('Goodreads Author')
  })

  it('builds a patch with picked fields', () => {
    const candidates = ref([mockCandidate1, mockCandidate2])
    const activeProvider = ref<MetadataProviderKey>('google')
    const { toggleField, pickFieldFromProvider, buildPatch } = useMetadataDiff(mockCurrent, candidates, activeProvider, providers)

    toggleField('title') // google
    pickFieldFromProvider('authors', 'goodreads')

    const { formPatch } = buildPatch()
    expect(formPatch.title).toBe('Google Title')
    expect(formPatch.authors).toEqual(['Goodreads Author'])
    // Should auto-include provider IDs
    expect(formPatch.googleBooksId).toBe('g1')
    expect(formPatch.goodreadsId).toBe('gr1')
  })

  it('copyAll picks everything from active provider', () => {
    const candidates = ref([mockCandidate1, mockCandidate2])
    const activeProvider = ref<MetadataProviderKey>('google')
    const { fields, copyAll } = useMetadataDiff(mockCurrent, candidates, activeProvider, providers)

    copyAll()
    expect(fields.value.every((f) => !f.isCopyable || f.isPicked)).toBe(true)
    expect(fields.value.find((f) => f.key === 'title')?.pickedProvider).toBe('google')
  })

  it('clearPicksForProvider clears only that provider', () => {
    const candidates = ref([mockCandidate1, mockCandidate2])
    const activeProvider = ref<MetadataProviderKey>('google')
    const { toggleField, pickFieldFromProvider, clearPicksForProvider, fields } = useMetadataDiff(mockCurrent, candidates, activeProvider, providers)

    toggleField('title') // google
    pickFieldFromProvider('authors', 'goodreads')

    clearPicksForProvider('google')
    expect(fields.value.find((f) => f.key === 'title')?.isPicked).toBe(false)
    expect(fields.value.find((f) => f.key === 'authors')?.isPicked).toBe(true)
  })

  it('copyMissing picks only fields that are empty on the book', () => {
    const currentWithEmpty = { ...mockCurrent, description: '' }
    const candidates = ref([mockCandidate1])
    const activeProvider = ref<MetadataProviderKey>('google')
    const { fields, copyMissing } = useMetadataDiff(currentWithEmpty, candidates, activeProvider, providers)

    copyMissing()

    expect(fields.value.find((f) => f.key === 'title')?.isPicked).toBe(false)
    expect(fields.value.find((f) => f.key === 'description')?.isPicked).toBe(true)
  })

  it('handles comic metadata fields', () => {
    const mockComic: MetadataCandidate = {
      provider: 'google',
      providerId: 'c1',
      title: 'Comic',
      comicMetadata: {
        issueNumber: '42',
        volumeName: 'Volume 1',
      },
    }
    const candidates = ref([mockComic])
    const activeProvider = ref<MetadataProviderKey>('google')
    const { fields } = useMetadataDiff(mockCurrent, candidates, activeProvider, providers)

    const issueField = fields.value.find((f) => f.key === 'comicIssueNumber')
    expect(issueField).toBeDefined()
    expect(issueField?.candidateDisplay).toBe('42')
  })

  it('provides multiple values from different providers for a single field', () => {
    const candidates = ref([mockCandidate1, mockCandidate2])
    const activeProvider = ref<MetadataProviderKey>('google')
    const { fields } = useMetadataDiff(mockCurrent, candidates, activeProvider, providers)

    const authorsField = fields.value.find((f) => f.key === 'authors')
    expect(authorsField?.providerValues).toHaveLength(2)
    expect(authorsField?.providerValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'google', display: 'Google Author' }),
        expect.objectContaining({ provider: 'goodreads', display: 'Goodreads Author' }),
      ]),
    )
  })
})
