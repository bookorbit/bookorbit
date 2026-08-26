import { MetadataProviderKey, type ProviderIds } from '@bookorbit/types'
import { providerIconPathSafe } from './provider-icons'

export type BookProviderLink = {
  key: MetadataProviderKey
  label: string
  url: string
  iconUrl: string | null
  fallback: string
}

type ProviderLinkDefinition = Omit<BookProviderLink, 'url' | 'iconUrl'> & {
  url: (id: string) => string
}

function encoded(value: string): string {
  return encodeURIComponent(value)
}

export function lubimyczytacBookUrl(id: string): string {
  const value = String(id).trim()
  // New data stores the canonical "id/slug" path. lubimyczytac.pl 404s on a slug-less id,
  // so legacy bare-numeric ids get a placeholder slug segment to keep the link valid.
  const path = value.includes('/') ? value : `${value}/-`
  return `https://lubimyczytac.pl/ksiazka/${path.split('/').map(encodeURIComponent).join('/')}`
}

export function libroFmAudiobookUrl(id: string): string {
  return `https://libro.fm/audiobooks/${encodeURIComponent(String(id).trim())}`
}

export function comicVineIssueUrl(id: string): string {
  return `https://comicvine.gamespot.com/issue/4000-${encoded(String(id).trim())}/`
}

function openLibraryBookUrl(id: string): string {
  const value = String(id).trim()
  const workId = value.startsWith('/works/') ? value.slice('/works/'.length) : value
  return `https://openlibrary.org/works/${encoded(workId)}`
}

const PROVIDER_LINK_DEFINITIONS: readonly ProviderLinkDefinition[] = [
  {
    key: MetadataProviderKey.GOOGLE,
    label: 'Google Books',
    url: (id) => `https://books.google.com/books?id=${encoded(id)}`,
    fallback: 'G',
  },
  {
    key: MetadataProviderKey.GOODREADS,
    label: 'Goodreads',
    url: (id) => `https://www.goodreads.com/book/show/${encoded(id)}`,
    fallback: 'GR',
  },
  {
    key: MetadataProviderKey.AMAZON,
    label: 'Amazon',
    url: (id) => `https://www.amazon.com/dp/${encoded(id)}`,
    fallback: 'A',
  },
  {
    key: MetadataProviderKey.HARDCOVER,
    label: 'Hardcover',
    url: (id) => `https://hardcover.app/books/${encoded(id)}`,
    fallback: 'H',
  },
  {
    key: MetadataProviderKey.OPEN_LIBRARY,
    label: 'Open Library',
    url: openLibraryBookUrl,
    fallback: 'OL',
  },
  {
    key: MetadataProviderKey.ITUNES,
    label: 'Apple Books',
    url: (id) => `https://books.apple.com/book/id${encoded(id)}`,
    fallback: '',
  },
  {
    key: MetadataProviderKey.AUDIBLE,
    label: 'Audible',
    url: (id) => `https://www.audible.com/pd/${encoded(id)}`,
    fallback: 'Au',
  },
  {
    key: MetadataProviderKey.LIBROFM,
    label: 'Libro.fm',
    url: libroFmAudiobookUrl,
    fallback: 'Lf',
  },
  {
    key: MetadataProviderKey.KOBO,
    label: 'Kobo',
    url: (id) => `https://www.kobo.com/us/en/ebook/${encoded(id)}`,
    fallback: 'K',
  },
  {
    key: MetadataProviderKey.COMICVINE,
    label: 'ComicVine',
    url: comicVineIssueUrl,
    fallback: 'CV',
  },
  {
    key: MetadataProviderKey.RANOBEDB,
    label: 'RanobeDB',
    url: (id) => `https://ranobedb.org/book/${encoded(id)}`,
    fallback: 'RN',
  },
  {
    key: MetadataProviderKey.LUBIMYCZYTAC,
    label: 'LubimyCzytac',
    url: lubimyczytacBookUrl,
    fallback: 'LC',
  },
  {
    key: MetadataProviderKey.ALADIN,
    label: 'Aladin',
    url: (id) => `https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=${encoded(id)}`,
    fallback: '알',
  },
  {
    key: MetadataProviderKey.MANGABAKA,
    label: 'MangaBaka',
    url: (id) => `https://mangabaka.org/${encoded(id)}`,
    fallback: 'MB',
  },
]

export function createBookProviderLinks(providerIds: ProviderIds): BookProviderLink[] {
  return PROVIDER_LINK_DEFINITIONS.flatMap((definition) => {
    const id = providerIds[definition.key]?.trim()
    if (!id) return []

    return [
      {
        key: definition.key,
        label: definition.label,
        url: definition.url(id),
        iconUrl: providerIconPathSafe(definition.key),
        fallback: definition.fallback,
      },
    ]
  })
}
