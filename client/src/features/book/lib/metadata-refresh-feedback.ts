import {
  MetadataProviderKey,
  type BookDetail,
  type MetadataFetchDiagnostics,
  type MetadataProviderKey as MetadataProviderKeyType,
} from '@bookorbit/types'

const PROVIDER_LABELS: Record<MetadataProviderKeyType, string> = {
  [MetadataProviderKey.GOOGLE]: 'Google Books',
  [MetadataProviderKey.GOODREADS]: 'Goodreads',
  [MetadataProviderKey.AMAZON]: 'Amazon',
  [MetadataProviderKey.HARDCOVER]: 'Hardcover',
  [MetadataProviderKey.OPEN_LIBRARY]: 'Open Library',
  [MetadataProviderKey.ITUNES]: 'iTunes',
  [MetadataProviderKey.AUDIBLE]: 'Audible',
  [MetadataProviderKey.AUDNEXUS]: 'AudNexus',
  [MetadataProviderKey.LIBROFM]: 'Libro.fm',
  [MetadataProviderKey.COMICVINE]: 'ComicVine',
  [MetadataProviderKey.RANOBEDB]: 'RanobeDB',
  [MetadataProviderKey.KOBO]: 'Kobo',
  [MetadataProviderKey.LUBIMYCZYTAC]: 'LubimyCzytac',
  [MetadataProviderKey.ALADIN]: 'Aladin',
}

export function metadataRefreshEmptyMessage(diagnostics: MetadataFetchDiagnostics, book: BookDetail): string {
  switch (diagnostics.reason) {
    case 'no_active_providers':
      return noActiveProvidersMessage(diagnostics)
    case 'providers_throttled':
      return 'No metadata fetched: active providers are temporarily in cooldown. Try again later.'
    case 'no_candidates':
      return appendUnreferencedProviderMessage(`No metadata found from active providers for ${bookSearchLabel(book)}.`, diagnostics)
    case 'no_resolved_fields':
      return 'Metadata providers responded, but Field Rules did not produce any fields to apply. Check fill/overwrite rules, genre blocklist, or selected providers.'
    default:
      return 'No new metadata found.'
  }
}

export function metadataRefreshAppliedMessage(diagnostics: MetadataFetchDiagnostics, updatedCount: number): string {
  const fieldText = `${updatedCount} field${updatedCount === 1 ? '' : 's'}`
  const matchedProviders = formatProviderList(diagnostics.candidateProviders)
  const message = matchedProviders ? `Auto-filled ${fieldText}. Matched ${matchedProviders}.` : `Auto-filled ${fieldText}.`
  return appendUnreferencedProviderMessage(message, diagnostics)
}

function appendUnreferencedProviderMessage(message: string, diagnostics: MetadataFetchDiagnostics): string {
  const providers = formatProviderList(diagnostics.enabledUnreferencedProviders)
  if (!providers) return message
  return `${message} Not queried because they are not selected in Field Rules: ${providers}.`
}

function noActiveProvidersMessage(diagnostics: MetadataFetchDiagnostics): string {
  const disabled = formatProviderList(diagnostics.disabledFieldRuleProviders)
  const enabledUnreferenced = formatProviderList(diagnostics.enabledUnreferencedProviders)

  if (disabled && enabledUnreferenced) {
    return `No metadata fetched: Field Rules only use disabled providers (${disabled}). Enable them or add ${enabledUnreferenced} to Field Rules.`
  }

  if (disabled) {
    return `No metadata fetched: Field Rules only use disabled providers (${disabled}). Enable at least one provider in Metadata settings.`
  }

  if (enabledUnreferenced) {
    return `No metadata fetched: no enabled providers are selected in Field Rules. Add ${enabledUnreferenced} to Field Rules.`
  }

  return 'No metadata fetched: no active metadata providers are configured. Enable a provider in Metadata settings.'
}

function bookSearchLabel(book: BookDetail): string {
  const title = book.title?.trim()
  const authors = book.authors.map((author) => author.name.trim()).filter(Boolean)
  const authorText = formatTextList(authors)

  if (title && authorText) return `"${title}" by ${authorText}`
  if (title) return `"${title}"`
  if (authorText) return `books by ${authorText}`
  return 'this book'
}

function formatProviderList(providers: MetadataProviderKeyType[]): string {
  return formatTextList(providers.map((provider) => PROVIDER_LABELS[provider] ?? provider))
}

function formatTextList(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]!
  if (items.length === 2) return `${items[0]!} or ${items[1]!}`
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]!}`
}
