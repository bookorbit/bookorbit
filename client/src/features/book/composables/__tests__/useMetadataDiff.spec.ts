// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { ref, type Ref } from 'vue'
import type {
  BookMetadataLockField,
  MetadataCandidate,
  MetadataProviderInfo,
  MetadataProviderKey,
  MetadataSource,
  ProviderIds,
} from '@bookorbit/types'
import { useMetadataDiff, type MetadataDiffInput } from '../useMetadataDiff'

describe('useMetadataDiff', () => {
  const mockCurrent: MetadataSource = {
    title: 'Original Title',
    subtitle: 'Original Subtitle',
    authors: ['Original Author'],
    genres: ['Genre 1'],
    description: 'Original Description',
    publisher: 'Original Publisher',
    publishedDate: null,
    publishedYear: 2020,
    language: 'en',
    pageCount: 300,
    seriesName: 'Original Series',
    seriesIndex: '1',
    isbn10: '1234567890',
    isbn13: '1234567890123',
    narrators: [],
    durationSeconds: null,
    abridged: null,
    hardcoverEditionId: null,
    communityRatings: [],
  }

  const google: MetadataCandidate = {
    provider: 'google',
    providerId: 'g1',
    title: 'Google Title',
    authors: ['Google Author'],
    description: 'Google Description',
    coverUrl: 'http://google.com/cover.jpg',
  }

  const goodreads: MetadataCandidate = {
    provider: 'goodreads',
    providerId: 'gr1',
    title: 'Goodreads Title',
    authors: ['Goodreads Author'],
    genres: ['Genre 2'],
  }

  const providers: MetadataProviderInfo[] = [
    { key: 'google', label: 'Google Books', identifiable: true },
    { key: 'goodreads', label: 'Goodreads', identifiable: true },
    { key: 'hardcover', label: 'Hardcover', identifiable: true },
    { key: 'amazon', label: 'Amazon', identifiable: true },
    { key: 'audible', label: 'Audible', identifiable: true },
  ]

  function setup(
    active: MetadataCandidate | Ref<MetadataCandidate | null>,
    options: Partial<Omit<MetadataDiffInput, 'active'>> & { lockedFields?: readonly BookMetadataLockField[]; providerIds?: ProviderIds } = {},
  ) {
    const activeRef = 'value' in active ? active : ref<MetadataCandidate | null>(active)
    return useMetadataDiff({
      current: mockCurrent,
      alternatives: [],
      providers,
      ...options,
      active: activeRef,
    })
  }

  const field = (diff: ReturnType<typeof setup>, key: string) => diff.fields.value.find((f) => f.key === key)

  it('lines up the active result against the book', () => {
    const diff = setup(google)

    expect(field(diff, 'title')).toMatchObject({ candidateDisplay: 'Google Title', bookValue: 'Original Title', kind: 'change' })
  })

  it('follows the active result when it changes', () => {
    const active = ref<MetadataCandidate | null>(google)
    const diff = setup(active)

    active.value = goodreads
    expect(field(diff, 'title')?.candidateDisplay).toBe('Goodreads Title')
  })

  it('has no rows without an active result', () => {
    expect(setup(ref(null)).fields.value).toEqual([])
  })

  it('names how each field differs, and marks a reordered list as minor', () => {
    const diff = setup({
      provider: 'goodreads',
      providerId: 'gr1',
      title: 'original title',
      genres: ['Genre 1'],
      authors: ['Original Author'],
      publisher: 'Other House',
      language: 'English',
      isbn13: '978-1234567890',
    })

    expect(field(diff, 'title')).toMatchObject({ kind: 'minor', minorReason: 'capitalization' })
    expect(field(diff, 'authors')?.kind).toBe('same')
    expect(field(diff, 'publisher')?.kind).toBe('change')
    expect(field(diff, 'language')).toMatchObject({ kind: 'minor', minorReason: 'languageCode' })
    expect(field(diff, 'goodreadsId')?.kind).toBe('fill')
  })

  it('shows a description as plain text and compares it without markup', () => {
    const current = { ...mockCurrent, description: '<p>A <b>bold</b> start.</p>' }
    const diff = setup({ ...goodreads, description: 'A bold start.' }, { current })

    expect(field(diff, 'description')).toMatchObject({ bookValue: 'A bold start.', kind: 'minor', minorReason: 'formatting' })
  })

  it('stages a field from the active result', () => {
    const diff = setup(google)

    diff.toggleField('title')
    expect(field(diff, 'title')).toMatchObject({ isPicked: true, pickedFromActive: true, pickedProvider: 'google' })
    expect(diff.decisionOf(field(diff, 'title')!)).toBe('use')
  })

  it('keeps a pick when another result becomes active, and says where it came from', () => {
    const active = ref<MetadataCandidate | null>(google)
    const diff = setup(active)

    diff.setField('authors', 'use')
    active.value = goodreads

    expect(field(diff, 'authors')).toMatchObject({ isPicked: true, pickedFromActive: false, pickedProvider: 'google' })
    expect(diff.decisionOf(field(diff, 'authors')!)).toBe('keep')
    expect(diff.buildPatch().formPatch.authors).toEqual(['Google Author'])
  })

  it('keeps picks from two results of the same provider apart', () => {
    const second: MetadataCandidate = { provider: 'google', providerId: 'g2', title: 'Second Edition', pageCount: 412 }
    const active = ref<MetadataCandidate | null>(google)
    const diff = setup(active)

    diff.setField('title', 'use')
    active.value = second
    diff.setField('pageCount', 'use')

    expect(diff.buildPatch().formPatch).toMatchObject({ title: 'Google Title', pageCount: 412 })
    expect(diff.stagedByCandidate.value.get('google:g1')).toBe(1)
    expect(diff.stagedByCandidate.value.get('google:g2')).toBe(1)
  })

  it('stages a field from another result', () => {
    const diff = setup(google, { alternatives: [google, goodreads] })

    diff.setField('authors', 'use', goodreads)
    expect(field(diff, 'authors')).toMatchObject({ isPicked: true, pickedFromActive: false, pickedProvider: 'goodreads' })
  })

  it('builds a patch reading each field from its own result, and links every provider that contributed', () => {
    const diff = setup(google)

    diff.toggleField('title')
    diff.setField('authors', 'use', goodreads)

    const { formPatch } = diff.buildPatch()
    expect(formPatch.title).toBe('Google Title')
    expect(formPatch.authors).toEqual(['Goodreads Author'])
    expect(formPatch.googleBooksId).toBe('g1')
    expect(formPatch.goodreadsId).toBe('gr1')
  })

  it('groups the values other results offer, once per value', () => {
    const agreeing: MetadataCandidate = { provider: 'amazon', providerId: 'a1', title: 'Goodreads Title' }
    const same: MetadataCandidate = { provider: 'hardcover', providerId: 'h1', title: 'Original Title' }
    const diff = setup(google, { alternatives: [google, goodreads, agreeing, same] })

    const others = field(diff, 'title')?.otherValues ?? []
    expect(others.map((entry) => [entry.display, entry.candidates.map((c) => c.provider), entry.matchesCurrent])).toEqual([
      ['Goodreads Title', ['goodreads', 'amazon'], false],
      ['Original Title', ['hardcover'], true],
    ])

    diff.setField('title', 'use', agreeing)
    expect(field(diff, 'title')?.otherValues[0]?.isPicked).toBe(true)
  })

  it('merges provider genres into the current list by default', () => {
    const diff = setup({ provider: 'goodreads', providerId: 'gr1', title: 'Goodreads Title', genres: [' genre 1 ', 'Genre 2', 'GENRE 2', ''] })

    expect(field(diff, 'genres')?.mergeable).toBe(true)
    diff.toggleField('genres')

    expect(diff.decisionOf(field(diff, 'genres')!)).toBe('merge')
    expect(diff.buildPatch().formPatch.genres).toEqual(['Genre 1', 'Genre 2'])
    expect(diff.staged.value[0]).toMatchObject({ after: 'Genre 1, Genre 2', merged: true })
  })

  it('can replace current genres explicitly', () => {
    const diff = setup({ provider: 'goodreads', providerId: 'gr1', title: 'Goodreads Title', genres: ['Genre 2', 'genre 2', 'Genre 3'] })

    diff.setField('genres', 'replace')

    expect(diff.decisionOf(field(diff, 'genres')!)).toBe('replace')
    expect(diff.buildPatch().formPatch.genres).toEqual(['Genre 2', 'Genre 3'])
  })

  it('shows and applies the Libro.fm ISBN as a provider ID', () => {
    const diff = setup(
      { provider: 'librofm', providerId: '9781234567890', title: 'Libro.fm Title' },
      { providers: [{ key: 'librofm', label: 'Libro.fm', identifiable: true }] },
    )

    expect(field(diff, 'librofmId')).toMatchObject({
      labelKey: 'book.detail.editMetadata.diff.providerIds.librofm',
      candidateDisplay: '9781234567890',
    })

    diff.toggleField('title')
    expect(diff.buildPatch().formPatch.librofmId).toBe('9781234567890')
  })

  it('shows and applies an AudNexus ASIN as the Audible ID', () => {
    const diff = setup(
      { provider: 'audnexus', providerId: 'B0TEST12345', audibleId: 'B0TEST12345', title: 'AudNexus Title' },
      { providers: [{ key: 'audnexus', label: 'AudNexus', identifiable: false }], providerIds: { audible: 'B0OLD12345' } },
    )

    expect(field(diff, 'audibleId')).toMatchObject({
      labelKey: 'book.detail.editMetadata.diff.providerIds.audible',
      bookValue: 'B0OLD12345',
      candidateDisplay: 'B0TEST12345',
      kind: 'change',
    })

    diff.toggleField('title')
    expect(diff.buildPatch().formPatch.audibleId).toBe('B0TEST12345')
  })

  it('builds a date and derived year patch when published date is picked', () => {
    const diff = setup({ provider: 'google', providerId: 'g1', title: 'Google Title', publishedDate: '1965-08-01', publishedYear: 1965 })

    diff.toggleField('publishedDate')

    expect(diff.buildPatch().formPatch).toMatchObject({ publishedDate: '1965-08-01', publishedYear: 1965 })
  })

  it('uses the publishedYear lock for publishedDate picks', () => {
    const diff = setup(
      { provider: 'google', providerId: 'g1', title: 'Google Title', publishedDate: '1965-08-01', publishedYear: 1965 },
      { lockedFields: ['publishedYear'] },
    )

    expect(field(diff, 'publishedDate')?.isLocked).toBe(true)
    diff.toggleField('publishedDate')

    expect(diff.buildPatch().formPatch.publishedDate).toBeUndefined()
    expect(diff.buildPatch().formPatch.publishedYear).toBeUndefined()
  })

  it('builds a provider-specific community ratings patch', () => {
    const hardcover: MetadataCandidate = {
      provider: 'hardcover',
      providerId: 'hardcover-book',
      title: 'Hardcover Title',
      communityRating: 4.25,
      communityRatingCount: 12345,
    }
    const amazon: MetadataCandidate = {
      provider: 'amazon',
      providerId: 'B00X47ZVXM',
      title: 'Amazon Title',
      communityRating: 4.8,
      communityRatingCount: 104451,
    }
    const active = ref<MetadataCandidate | null>(hardcover)
    const diff = setup(active)

    expect(field(diff, 'communityRating')).toMatchObject({
      labelKey: 'book.detail.editMetadata.match.providerRating',
      labelParams: { provider: 'Hardcover' },
      bookValue: '',
      candidateDisplay: '4.3 / 5 (12,345 ratings)',
      kind: 'fill',
    })

    diff.toggleField('communityRating')
    active.value = amazon
    diff.toggleField('communityRating')

    expect(diff.buildPatch().formPatch).toMatchObject({
      communityRatings: [
        { provider: 'hardcover', rating: 4.25, ratingCount: 12345 },
        { provider: 'amazon', rating: 4.8, ratingCount: 104451 },
      ],
      hardcoverId: 'hardcover-book',
      amazonId: 'B00X47ZVXM',
    })
  })

  it('treats a refreshed rating count as a minor difference', () => {
    const current = {
      ...mockCurrent,
      communityRatings: [{ provider: 'amazon' as MetadataProviderKey, rating: 4.4, ratingCount: 9846, updatedAt: null }],
    }
    const diff = setup({ provider: 'amazon', providerId: 'a1', title: 'Amazon Title', communityRating: 4.4, communityRatingCount: 9771 }, { current })

    expect(field(diff, 'communityRating')).toMatchObject({ kind: 'minor', minorReason: 'ratingCount' })
  })

  it('shows and applies Hardcover edition IDs as lockable metadata fields', () => {
    const diff = setup({ provider: 'hardcover', providerId: 'the-name-of-the-wind', hardcoverEditionId: '1001', title: 'Hardcover Title' })

    expect(field(diff, 'hardcoverEditionId')).toMatchObject({ bookValue: '', candidateDisplay: '1001', isLocked: false })

    diff.toggleField('hardcoverEditionId')
    expect(diff.buildPatch().formPatch).toEqual({ hardcoverEditionId: '1001', hardcoverId: 'the-name-of-the-wind' })
  })

  it('auto-includes unlocked Hardcover edition IDs when applying other Hardcover fields', () => {
    const diff = setup({ provider: 'hardcover', providerId: 'the-name-of-the-wind', hardcoverEditionId: '1001', title: 'Hardcover Title' })

    diff.toggleField('title')

    expect(diff.buildPatch().formPatch).toMatchObject({ title: 'Hardcover Title', hardcoverId: 'the-name-of-the-wind', hardcoverEditionId: '1001' })
  })

  it('does not auto-include locked Hardcover edition IDs', () => {
    const diff = setup(
      { provider: 'hardcover', providerId: 'the-name-of-the-wind', hardcoverEditionId: '1001', title: 'Hardcover Title' },
      { lockedFields: ['hardcoverEditionId'] },
    )

    diff.toggleField('title')

    expect(diff.buildPatch().formPatch).toMatchObject({ title: 'Hardcover Title', hardcoverId: 'the-name-of-the-wind' })
    expect(diff.buildPatch().formPatch.hardcoverEditionId).toBeUndefined()
  })

  const audible: MetadataCandidate = {
    provider: 'audible',
    providerId: 'B002V1NSN2',
    title: 'Confessor',
    seriesName: 'Sword of Truth',
    seriesIndex: '11',
    seriesMemberships: [
      { seriesName: 'Sword of Truth', seriesIndex: '11' },
      { seriesName: 'Chainfire Trilogy', seriesIndex: '3' },
    ],
  }

  it('builds series memberships when series name and index are picked from the same result', () => {
    const diff = setup(audible)

    diff.toggleField('seriesName')
    diff.toggleField('seriesIndex')

    expect(diff.buildPatch().formPatch.seriesMemberships).toEqual([
      { seriesName: 'Sword of Truth', seriesIndex: '11' },
      { seriesName: 'Chainfire Trilogy', seriesIndex: '3' },
    ])
  })

  it('does not replace series memberships when only the series name is picked', () => {
    const diff = setup(audible)

    diff.toggleField('seriesName')

    expect(diff.buildPatch().formPatch.seriesMemberships).toBeUndefined()
  })

  it('does not build memberships from a name and an index of different results', () => {
    const other: MetadataCandidate = { ...audible, providerId: 'B00OTHER', seriesIndex: '12' }
    const diff = setup(audible)

    diff.setField('seriesName', 'use')
    diff.setField('seriesIndex', 'use', other)

    expect(diff.buildPatch().formPatch.seriesMemberships).toBeUndefined()
  })

  it('takes every difference from the active result', () => {
    const diff = setup(google)

    expect(diff.takeAllCount.value).toBe(diff.fields.value.filter((f) => f.hasDiff).length + 1)
    diff.takeAll()

    expect(diff.fields.value.every((f) => !f.hasDiff || f.isPicked)).toBe(true)
    expect(field(diff, 'title')?.pickedProvider).toBe('google')
    expect(diff.buildPatch().coverUrl).toBe('http://google.com/cover.jpg')
  })

  it('fills only the fields that are empty on the book', () => {
    const diff = setup(google, { current: { ...mockCurrent, description: '' } })

    diff.fillEmpty()

    expect(field(diff, 'title')?.isPicked).toBe(false)
    expect(field(diff, 'description')?.isPicked).toBe(true)
  })

  it('lists staged changes with what they replace, and unstages one', () => {
    const diff = setup(google)

    diff.toggleField('title')
    diff.toggleField('description')

    expect(diff.staged.value.map((change) => [change.key, change.before, change.after])).toEqual([
      ['title', 'Original Title', 'Google Title'],
      ['description', 'Original Description', 'Google Description'],
    ])
    diff.unstage('title')
    expect(diff.staged.value.map((change) => change.key)).toEqual(['description'])

    diff.clearAll()
    expect(diff.hasCopied.value).toBe(false)
  })

  it('handles comic metadata fields', () => {
    const diff = setup({ provider: 'google', providerId: 'c1', title: 'Comic', comicMetadata: { issueNumber: '42', volumeName: 'Volume 1' } })

    expect(field(diff, 'comicIssueNumber')).toMatchObject({ candidateDisplay: '42', kind: 'fill' })
  })

  it('marks locked fields and prevents them from being picked', () => {
    const diff = setup(google, { lockedFields: ['title'] })

    diff.toggleField('title')
    diff.takeAll()

    expect(field(diff, 'title')).toMatchObject({ isLocked: true, isPicked: false })
    expect(diff.buildPatch().formPatch.title).toBeUndefined()
  })

  it('proxies external cover URLs for display and preserves the raw cover URL in the patch', () => {
    const externalCover = 'https://m.media-amazon.com/images/I/41ZaIFRkWyL.jpg'
    const diff = setup({ ...google, coverUrl: externalCover })

    expect(diff.cover.value.active?.url).toContain('/api/v1/books/cover/proxy?url=')
    diff.pickCover(diff.cover.value.active!.candidate)

    expect(diff.buildPatch().coverUrl).toBe(externalCover)
  })

  it('does not proxy same-origin cover URLs for display', () => {
    const diff = setup({ ...google, coverUrl: '/api/v1/books/1/cover' })

    expect(diff.cover.value.active?.url).toBe('/api/v1/books/1/cover')
  })

  it('gives the cover the lock and slot it fills, and reads the current cover live', () => {
    const currentCover = ref('')
    const diff = setup(google, { currentCoverUrl: () => currentCover.value, lockedFields: ['audioCover'], coverMedium: 'audio' })

    expect(diff.cover.value).toMatchObject({ medium: 'audio', locked: true, currentUrl: '' })
    diff.pickCover(google)
    expect(diff.buildPatch().coverUrl).toBeUndefined()

    currentCover.value = '/api/v1/books/1/cover?medium=audio'
    expect(diff.cover.value.currentUrl).toBe('/api/v1/books/1/cover?medium=audio')
  })

  describe('cover shape', () => {
    const hardcover: MetadataCandidate = { provider: 'hardcover', providerId: 'h1', title: 'The Silver Chair', coverUrl: '/covers/hardcover.jpg' }
    const square: MetadataCandidate = {
      provider: 'audible',
      providerId: 'a1',
      title: 'The Silver Chair',
      coverUrl: '/covers/audible.jpg',
      coverShape: 'square',
    }
    const portrait: MetadataCandidate = {
      provider: 'google',
      providerId: 'g1',
      title: 'The Silver Chair',
      coverUrl: '/covers/google.jpg',
      coverShape: 'portrait',
    }
    const strip: MetadataCandidate = {
      provider: 'amazon',
      providerId: 'am1',
      title: 'The Silver Chair',
      coverUrl: '/covers/strip.jpg',
      coverShape: 'square',
    }
    // Keyed by id, as the real lookups go by URL: the active result arrives as a reactive proxy.
    const measuredPortrait = (candidate: MetadataCandidate) => (candidate.providerId === 'h1' ? 'portrait' : (candidate.coverShape ?? 'unknown'))
    const sizes = (candidate: MetadataCandidate) => (candidate.providerId === 'am1' ? { width: 575, height: 92 } : null)

    function audioDiff(currentCover: string) {
      return setup(hardcover, {
        alternatives: [hardcover, strip, portrait, square],
        currentCoverUrl: () => currentCover,
        coverMedium: 'audio',
        coverPriority: ['google', 'hardcover'],
        coverShapeOf: measuredPortrait,
        coverSizeOf: sizes,
      })
    }

    it('names the fit of the offered cover and lists fitting art first, broken images last', () => {
      const { cover } = audioDiff('/api/v1/books/1/cover?medium=audio')

      expect(cover.value.active?.fit).toBe('mismatch')
      expect(cover.value.choices.map((choice) => [choice.candidate.provider, choice.fit, choice.broken])).toEqual([
        ['audible', 'match', false],
        ['google', 'mismatch', false],
        ['hardcover', 'mismatch', false],
        ['amazon', 'match', true],
      ])
    })

    it('keeps Use all from swapping a cover for art of the other shape, but the cover control still can', () => {
      const diff = audioDiff('/api/v1/books/1/cover?medium=audio')

      diff.takeAll()
      expect(diff.buildPatch().coverUrl).toBeUndefined()
      expect(diff.buildPatch().formPatch.title).toBe('The Silver Chair')

      diff.pickCover(hardcover)
      expect(diff.buildPatch().coverUrl).toBe('/covers/hardcover.jpg')
    })

    it('lets Use all fill an empty slot with art of the other shape', () => {
      const diff = audioDiff('')

      diff.takeAll()
      expect(diff.buildPatch().coverUrl).toBe('/covers/hardcover.jpg')
    })
  })
})
