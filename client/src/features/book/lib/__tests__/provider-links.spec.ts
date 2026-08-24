import { describe, expect, it } from 'vitest'
import { MetadataProviderKey, type ProviderIds } from '@bookorbit/types'
import { comicVineIssueUrl, createBookProviderLinks, libroFmAudiobookUrl } from '../provider-links'

describe('book provider links', () => {
  it('builds every supported book provider link from one ordered registry', () => {
    const providerIds: ProviderIds = {
      google: 'google-id',
      goodreads: 'goodreads-id',
      amazon: 'amazon-id',
      hardcover: 'hardcover-slug',
      openLibrary: '/works/OL123W',
      itunes: '123456',
      audible: 'B012345',
      librofm: '9781234567890',
      kobo: 'kobo-slug',
      comicvine: '1126983',
      ranobedb: '1287',
      lubimyczytac: '123/title name',
      aladin: '456789',
    }

    expect(createBookProviderLinks(providerIds)).toEqual([
      {
        key: MetadataProviderKey.GOOGLE,
        label: 'Google Books',
        url: 'https://books.google.com/books?id=google-id',
        iconUrl: '/assets/provider-icons/google.svg',
        fallback: 'G',
      },
      {
        key: MetadataProviderKey.GOODREADS,
        label: 'Goodreads',
        url: 'https://www.goodreads.com/book/show/goodreads-id',
        iconUrl: '/assets/provider-icons/goodreads.svg',
        fallback: 'GR',
      },
      {
        key: MetadataProviderKey.AMAZON,
        label: 'Amazon',
        url: 'https://www.amazon.com/dp/amazon-id',
        iconUrl: '/assets/provider-icons/amazon.svg',
        fallback: 'A',
      },
      {
        key: MetadataProviderKey.HARDCOVER,
        label: 'Hardcover',
        url: 'https://hardcover.app/books/hardcover-slug',
        iconUrl: '/assets/provider-icons/hardcover.svg',
        fallback: 'H',
      },
      {
        key: MetadataProviderKey.OPEN_LIBRARY,
        label: 'Open Library',
        url: 'https://openlibrary.org/works/OL123W',
        iconUrl: '/assets/provider-icons/openlibrary.svg',
        fallback: 'OL',
      },
      {
        key: MetadataProviderKey.ITUNES,
        label: 'Apple Books',
        url: 'https://books.apple.com/book/id123456',
        iconUrl: '/assets/provider-icons/apple-books.svg',
        fallback: '',
      },
      {
        key: MetadataProviderKey.AUDIBLE,
        label: 'Audible',
        url: 'https://www.audible.com/pd/B012345',
        iconUrl: '/assets/provider-icons/audible.svg',
        fallback: 'Au',
      },
      {
        key: MetadataProviderKey.LIBROFM,
        label: 'Libro.fm',
        url: 'https://libro.fm/audiobooks/9781234567890',
        iconUrl: '/assets/provider-icons/librofm.svg',
        fallback: 'Lf',
      },
      {
        key: MetadataProviderKey.KOBO,
        label: 'Kobo',
        url: 'https://www.kobo.com/us/en/ebook/kobo-slug',
        iconUrl: '/assets/provider-icons/kobo.svg',
        fallback: 'K',
      },
      {
        key: MetadataProviderKey.COMICVINE,
        label: 'ComicVine',
        url: 'https://comicvine.gamespot.com/issue/4000-1126983/',
        iconUrl: null,
        fallback: 'CV',
      },
      {
        key: MetadataProviderKey.RANOBEDB,
        label: 'RanobeDB',
        url: 'https://ranobedb.org/book/1287',
        iconUrl: '/assets/provider-icons/ranobedb.svg',
        fallback: 'RN',
      },
      {
        key: MetadataProviderKey.LUBIMYCZYTAC,
        label: 'LubimyCzytac',
        url: 'https://lubimyczytac.pl/ksiazka/123/title%20name',
        iconUrl: '/assets/provider-icons/lubimyczytac.svg',
        fallback: 'LC',
      },
      {
        key: MetadataProviderKey.ALADIN,
        label: 'Aladin',
        url: 'https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=456789',
        iconUrl: '/assets/provider-icons/aladin.svg',
        fallback: '알',
      },
    ])
  })

  it('trims provider IDs, safely encodes URL values, and ignores empty IDs', () => {
    const links = createBookProviderLinks({
      google: '  id with spaces&extra=true  ',
      comicvine: '  1126983  ',
      goodreads: '   ',
      amazon: null,
    })

    expect(links).toEqual([
      expect.objectContaining({
        key: MetadataProviderKey.GOOGLE,
        url: 'https://books.google.com/books?id=id%20with%20spaces%26extra%3Dtrue',
      }),
      expect.objectContaining({
        key: MetadataProviderKey.COMICVINE,
        url: 'https://comicvine.gamespot.com/issue/4000-1126983/',
      }),
    ])
  })

  it('constructs the generic ComicVine issue URL from a bare issue ID', () => {
    expect(comicVineIssueUrl(' 1126983 ')).toBe('https://comicvine.gamespot.com/issue/4000-1126983/')
  })

  it('builds a trimmed and encoded Libro.fm audiobook URL', () => {
    expect(libroFmAudiobookUrl(' 978 123 ')).toBe('https://libro.fm/audiobooks/978%20123')
  })
})
