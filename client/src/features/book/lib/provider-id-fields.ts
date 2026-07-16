import { MetadataProviderKey, type MetadataProviderInfo } from '@bookorbit/types'

export const PROVIDER_ID_FIELDS = [
  { provider: MetadataProviderKey.GOOGLE, field: 'googleBooksId', label: 'Google Books' },
  { provider: MetadataProviderKey.GOODREADS, field: 'goodreadsId', label: 'Goodreads' },
  { provider: MetadataProviderKey.AMAZON, field: 'amazonId', label: 'Amazon' },
  { provider: MetadataProviderKey.HARDCOVER, field: 'hardcoverId', label: 'Hardcover' },
  { provider: MetadataProviderKey.HARDCOVER, field: 'hardcoverEditionId', label: 'Hardcover Ed.' },
  { provider: MetadataProviderKey.OPEN_LIBRARY, field: 'openLibraryId', label: 'OpenLibrary' },
  { provider: MetadataProviderKey.ITUNES, field: 'itunesId', label: 'iTunes' },
  { provider: MetadataProviderKey.AUDIBLE, field: 'audibleId', label: 'Audible' },
  { provider: MetadataProviderKey.LIBROFM, field: 'librofmId', label: 'Libro.fm' },
  { provider: MetadataProviderKey.KOBO, field: 'koboId', label: 'Kobo' },
  { provider: MetadataProviderKey.COMICVINE, field: 'comicvineId', label: 'ComicVine' },
  { provider: MetadataProviderKey.RANOBEDB, field: 'ranobedbId', label: 'RanobeDB' },
  { provider: MetadataProviderKey.LUBIMYCZYTAC, field: 'lubimyczytacId', label: 'LubimyCzytac' },
  { provider: MetadataProviderKey.ALADIN, field: 'aladinId', label: 'Aladin' },
] as const

export type ProviderIdField = (typeof PROVIDER_ID_FIELDS)[number]
export type ProviderIdFormField = ProviderIdField['field']

const PROVIDER_ID_FORM_FIELDS = new Set<string>(PROVIDER_ID_FIELDS.map((field) => field.field))
const PROVIDER_BY_FORM_FIELD = new Map<ProviderIdFormField, MetadataProviderKey>(PROVIDER_ID_FIELDS.map((field) => [field.field, field.provider]))
const PROVIDER_ALIASES_BY_FORM_FIELD: Partial<Record<ProviderIdFormField, MetadataProviderKey[]>> = {
  audibleId: [MetadataProviderKey.AUDIBLE, MetadataProviderKey.AUDNEXUS],
}

export function isProviderIdFormField(field: string): field is ProviderIdFormField {
  return PROVIDER_ID_FORM_FIELDS.has(field)
}

export function isProviderIdFieldAvailable(field: ProviderIdFormField, providers: readonly Pick<MetadataProviderInfo, 'key'>[] | null): boolean {
  if (providers === null) return true
  const providerKeys =
    PROVIDER_ALIASES_BY_FORM_FIELD[field] ?? [PROVIDER_BY_FORM_FIELD.get(field)].filter((key): key is MetadataProviderKey => key !== undefined)
  return providerKeys.length > 0 ? providers.some((item) => providerKeys.includes(item.key)) : true
}

export function filterProviderIdFields(providers: readonly Pick<MetadataProviderInfo, 'key'>[] | null): ProviderIdField[] {
  return PROVIDER_ID_FIELDS.filter((field) => isProviderIdFieldAvailable(field.field, providers))
}
