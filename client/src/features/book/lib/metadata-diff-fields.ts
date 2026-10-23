import type {
  ComicMetadataFields,
  MetadataCandidate,
  MetadataProviderKey,
  MetadataSeriesMembership,
  MetadataSource,
  ProviderIds,
} from '@bookorbit/types'
import { toDisplayCoverUrl } from './metadata-fetch'
import { formatCommunityRatingValue } from './community-rating'

export type ComicDiffFieldKey =
  | 'comicIssueNumber'
  | 'comicVolumeName'
  | 'comicPencillers'
  | 'comicInkers'
  | 'comicColorists'
  | 'comicLetterers'
  | 'comicCoverArtists'
  | 'comicCharacters'
  | 'comicTeams'
  | 'comicLocations'
  | 'comicStoryArcs'

export type ProviderIdPatchField =
  | 'googleBooksId'
  | 'goodreadsId'
  | 'amazonId'
  | 'hardcoverId'
  | 'openLibraryId'
  | 'itunesId'
  | 'audibleId'
  | 'librofmId'
  | 'koboId'
  | 'comicvineId'
  | 'ranobedbId'
  | 'lubimyczytacId'
  | 'aladinId'
  | 'mangabakaId'

export type DiffFieldKey =
  | 'title'
  | 'subtitle'
  | 'authors'
  | 'description'
  | 'publisher'
  | 'publishedDate'
  | 'publishedYear'
  | 'language'
  | 'pageCount'
  | 'communityRating'
  | 'seriesName'
  | 'seriesIndex'
  | 'isbn13'
  | 'isbn10'
  | 'genres'
  | 'narrators'
  | 'durationSeconds'
  | 'abridged'
  | 'coverUrl'
  | 'hardcoverEditionId'
  | ProviderIdPatchField
  | 'sourceUrl'
  | 'mangabakaSeriesId'
  | ComicDiffFieldKey

const FIELD_LABEL_PREFIX = 'book.detail.editMetadata.diff.fields'

export const FIELD_DEFS: { key: DiffFieldKey; labelKey: string }[] = (
  [
    'coverUrl',
    'title',
    'subtitle',
    'authors',
    'description',
    'publisher',
    'publishedDate',
    'language',
    'pageCount',
    'communityRating',
    'seriesName',
    'seriesIndex',
    'isbn13',
    'isbn10',
    'genres',
    'narrators',
    'durationSeconds',
    'abridged',
    'hardcoverEditionId',
    'mangabakaId',
    'mangabakaSeriesId',
  ] as const
).map((key) => ({ key, labelKey: `${FIELD_LABEL_PREFIX}.${key}` }))

export interface ComicFieldDef {
  key: ComicDiffFieldKey
  labelKey: string
  comicKey: keyof ComicMetadataFields
}

export const COMIC_FIELD_DEFS: ComicFieldDef[] = (
  [
    ['comicIssueNumber', 'issueNumber'],
    ['comicVolumeName', 'volumeName'],
    ['comicPencillers', 'pencillers'],
    ['comicInkers', 'inkers'],
    ['comicColorists', 'colorists'],
    ['comicLetterers', 'letterers'],
    ['comicCoverArtists', 'coverArtists'],
    ['comicCharacters', 'characters'],
    ['comicTeams', 'teams'],
    ['comicLocations', 'locations'],
    ['comicStoryArcs', 'storyArcs'],
  ] as const
).map(([key, comicKey]) => ({ key, labelKey: `${FIELD_LABEL_PREFIX}.${key}`, comicKey }))

export const COMIC_KEY_MAP: Record<ComicDiffFieldKey, keyof ComicMetadataFields> = Object.fromEntries(
  COMIC_FIELD_DEFS.map((d) => [d.key, d.comicKey]),
) as Record<ComicDiffFieldKey, keyof ComicMetadataFields>

export function isComicDiffFieldKey(key: DiffFieldKey): key is ComicDiffFieldKey {
  return key in COMIC_KEY_MAP
}

export const PROVIDER_ID_FIELD: Record<MetadataProviderKey, ProviderIdPatchField | undefined> = {
  google: 'googleBooksId',
  goodreads: 'goodreadsId',
  amazon: 'amazonId',
  hardcover: 'hardcoverId',
  openLibrary: 'openLibraryId',
  itunes: 'itunesId',
  audible: 'audibleId',
  audnexus: 'audibleId',
  librofm: 'librofmId',
  comicvine: 'comicvineId',
  ranobedb: 'ranobedbId',
  kobo: 'koboId',
  lubimyczytac: 'lubimyczytacId',
  aladin: 'aladinId',
  mangabaka: 'mangabakaId',
}

const PROVIDER_ID_PATCH_FIELDS = new Set<string>(Object.values(PROVIDER_ID_FIELD).filter((v): v is ProviderIdPatchField => v !== undefined))

export function isProviderIdPatchField(key: DiffFieldKey): key is ProviderIdPatchField {
  return PROVIDER_ID_PATCH_FIELDS.has(key)
}

/** The i18n key naming each provider's id row. AudNexus stores an Audible id. */
export function providerIdLabelKey(provider: MetadataProviderKey): string {
  return `book.detail.editMetadata.diff.providerIds.${provider === 'audnexus' ? 'audible' : provider}`
}

/** The id the book already holds for a provider. AudNexus answers with an Audible ASIN. */
export function existingProviderId(ids: ProviderIds | undefined, provider: MetadataProviderKey): string {
  return ids?.[provider] ?? (provider === 'audnexus' ? ids?.audible : '') ?? ''
}

/** Fields whose value is a list: compared as sets and shown as chips. */
export const LIST_FIELD_KEYS = new Set<DiffFieldKey>([
  'authors',
  'genres',
  'narrators',
  'comicPencillers',
  'comicInkers',
  'comicColorists',
  'comicLetterers',
  'comicCoverArtists',
  'comicCharacters',
  'comicTeams',
  'comicLocations',
  'comicStoryArcs',
])

export function mergeGenreLists(existing: readonly string[], incoming: readonly string[]): string[] {
  const merged: string[] = []
  const seen = new Set<string>()

  for (const raw of [...existing, ...incoming]) {
    const genre = raw.trim()
    const token = genre.toLowerCase()
    if (!genre || seen.has(token)) continue
    seen.add(token)
    merged.push(genre)
  }

  return merged
}

export function normalizeSeriesMemberships(values: readonly MetadataSeriesMembership[] | undefined): MetadataSeriesMembership[] {
  if (!values?.length) return []

  const seen = new Set<string>()
  const out: MetadataSeriesMembership[] = []
  for (const value of values) {
    const seriesName = value.seriesName.trim()
    const key = seriesName.toLowerCase()
    if (!seriesName || seen.has(key)) continue

    seen.add(key)
    out.push({
      seriesName,
      seriesIndex: value.seriesIndex ?? null,
    })
  }
  return out
}

export function getCandidateValueFrom(candidate: MetadataCandidate, key: DiffFieldKey): string {
  if (isComicDiffFieldKey(key)) {
    const comicKey = COMIC_KEY_MAP[key]
    const val = candidate.comicMetadata?.[comicKey]
    if (Array.isArray(val)) return val.join(', ')
    return val ?? ''
  }
  if (key === 'coverUrl') return toDisplayCoverUrl(candidate.coverUrl)
  if (key === 'authors') return (candidate.authors ?? []).join(', ')
  if (key === 'genres') return (candidate.genres ?? []).join(', ')
  if (key === 'narrators') return (candidate.narrators ?? []).join(', ')
  if (key === 'communityRating') return formatCommunityRatingValue(candidate.communityRating, candidate.communityRatingCount)
  if (key === 'publishedDate') return candidate.publishedDate ?? (candidate.publishedYear != null ? String(candidate.publishedYear) : '')
  const val = candidate[key as keyof MetadataCandidate]
  return val != null ? String(val) : ''
}

/** A list field's items on a candidate. */
export function getCandidateList(candidate: MetadataCandidate, key: DiffFieldKey): string[] {
  if (isComicDiffFieldKey(key)) {
    const val = candidate.comicMetadata?.[COMIC_KEY_MAP[key]]
    return Array.isArray(val) ? val : []
  }
  if (key === 'authors') return candidate.authors ?? []
  if (key === 'genres') return candidate.genres ?? []
  if (key === 'narrators') return candidate.narrators ?? []
  return []
}

/** A list field's items on the book. The book carries no comic metadata here, so those read as empty. */
export function getSourceList(current: MetadataSource, key: DiffFieldKey): string[] {
  if (key === 'authors') return current.authors
  if (key === 'genres') return current.genres
  if (key === 'narrators') return current.narrators ?? []
  return []
}

/** The book's value for a field, as the same string `getCandidateValueFrom` gives a candidate. */
export function getSourceValue(current: MetadataSource, key: DiffFieldKey, provider: MetadataProviderKey, currentCoverUrl = ''): string {
  if (isComicDiffFieldKey(key)) return ''
  if (LIST_FIELD_KEYS.has(key)) return getSourceList(current, key).join(', ')
  if (key === 'coverUrl') return currentCoverUrl
  if (key === 'communityRating') {
    const existing = current.communityRatings?.find((r) => r.provider === provider)
    return existing ? formatCommunityRatingValue(existing.rating, existing.ratingCount) : ''
  }
  if (key === 'publishedDate') return current.publishedDate ?? (current.publishedYear != null ? String(current.publishedYear) : '')
  const val = current[key as keyof MetadataSource]
  return val != null ? String(val) : ''
}

export type DiffKind = 'fill' | 'change' | 'minor' | 'same' | 'missing'

/** Why a difference is not worth a decision. Each has a translated label under `ledger.minor`. */
export type MinorReason = 'reordered' | 'formatting' | 'punctuation' | 'capitalization' | 'yearOnly' | 'addsDay' | 'languageCode' | 'ratingCount'

export interface DiffClass {
  kind: DiffKind
  reason?: MinorReason
}

const SAME: DiffClass = { kind: 'same' }
const CHANGE: DiffClass = { kind: 'change' }
const minor = (reason: MinorReason): DiffClass => ({ kind: 'minor', reason })

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201c',
  rdquo: '\u201d',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
}

/** Description HTML as readable text, without a DOM so it also runs where there is none. */
export function descriptionPlainText(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|blockquote)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\u2022 ')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Letters and digits only, lowercased and without accents, for "the same words" comparisons. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function classifyText(current: string, incoming: string): DiffClass {
  const a = current.trim()
  const b = incoming.trim()
  if (!b) return { kind: 'missing' }
  if (!a) return { kind: 'fill' }
  if (a === b) return SAME
  if (a.toLowerCase() === b.toLowerCase()) return minor('capitalization')
  if (normalizeForMatch(a) === normalizeForMatch(b)) return minor('punctuation')
  return CHANGE
}

export function classifyList(current: readonly string[], incoming: readonly string[]): DiffClass {
  const a = current.map((v) => v.trim()).filter(Boolean)
  const b = incoming.map((v) => v.trim()).filter(Boolean)
  if (!b.length) return { kind: 'missing' }
  if (!a.length) return { kind: 'fill' }
  const left = a.map(normalizeForMatch)
  const right = b.map(normalizeForMatch)
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const sameItems = leftSet.size === rightSet.size && [...leftSet].every((v) => rightSet.has(v))
  if (!sameItems) return CHANGE
  if (a.join('\u0000') === b.join('\u0000')) return SAME
  return left.join('\u0000') === right.join('\u0000') ? minor('capitalization') : minor('reordered')
}

export function classifyDescription(current: string | null | undefined, incoming: string | null | undefined): DiffClass {
  const a = descriptionPlainText(current)
  const b = descriptionPlainText(incoming)
  if (!b) return { kind: 'missing' }
  if (!a) return { kind: 'fill' }
  if (a === b) return (current ?? '').trim() === (incoming ?? '').trim() ? SAME : minor('formatting')
  if (normalizeForMatch(a) === normalizeForMatch(b)) return minor('punctuation')
  return CHANGE
}

export function classifyDate(current: string, incoming: string): DiffClass {
  if (!incoming) return { kind: 'missing' }
  if (!current) return { kind: 'fill' }
  if (current === incoming) return SAME
  if (current.slice(0, 4) === incoming.slice(0, 4)) {
    if (/^\d{4}$/.test(incoming)) return minor('yearOnly')
    if (/^\d{4}$/.test(current)) return minor('addsDay')
  }
  return CHANGE
}

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' })
  } catch {
    return null
  }
})()

/** A language as one comparable token, so "en", "eng" and "English" read as the same language. */
export function languageToken(value: string): string {
  const trimmed = value.trim()
  if (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(trimmed)) {
    try {
      const name = languageNames?.of(trimmed)
      if (name) return name.toLowerCase()
    } catch {
      // not a language code after all
    }
  }
  return trimmed.toLowerCase()
}

export function classifyLanguage(current: string, incoming: string): DiffClass {
  if (!incoming.trim()) return { kind: 'missing' }
  if (!current.trim()) return { kind: 'fill' }
  if (current.trim() === incoming.trim()) return SAME
  return languageToken(current) === languageToken(incoming) ? minor('languageCode') : CHANGE
}

export function classifyNumber(current: number | string | null | undefined, incoming: number | string | null | undefined): DiffClass {
  const empty = (v: unknown) => v == null || v === ''
  if (empty(incoming)) return { kind: 'missing' }
  if (empty(current)) return { kind: 'fill' }
  const a = Number(current)
  const b = Number(incoming)
  if (Number.isFinite(a) && Number.isFinite(b)) return a === b ? SAME : CHANGE
  return classifyText(String(current), String(incoming))
}

export function classifyIdentifier(current: string, incoming: string): DiffClass {
  if (!incoming.trim()) return { kind: 'missing' }
  if (!current.trim()) return { kind: 'fill' }
  if (current.trim() === incoming.trim()) return SAME
  const bare = (v: string) => v.replace(/[^0-9a-z]/gi, '').toLowerCase()
  return bare(current) === bare(incoming) ? minor('formatting') : CHANGE
}

export function classifyRating(
  current: { rating: number; ratingCount?: number | null } | null | undefined,
  incoming: { rating: number; ratingCount?: number | null } | null | undefined,
): DiffClass {
  if (!incoming || !Number.isFinite(incoming.rating)) return { kind: 'missing' }
  if (!current || !Number.isFinite(current.rating)) return { kind: 'fill' }
  const sameCount = (current.ratingCount ?? null) === (incoming.ratingCount ?? null)
  if (Math.abs(current.rating - incoming.rating) < 0.05) return sameCount && current.rating === incoming.rating ? SAME : minor('ratingCount')
  return CHANGE
}

const TEXT_KEYS = new Set<DiffFieldKey>(['title', 'subtitle', 'publisher', 'seriesName', 'comicIssueNumber', 'comicVolumeName'])
const IDENTIFIER_KEYS = new Set<DiffFieldKey>(['isbn13', 'isbn10', 'hardcoverEditionId'])

/** How a candidate's value for one field relates to the book's. Provider id rows go through `classifyIdentifier`. */
export function classifyField(key: DiffFieldKey, current: MetadataSource, candidate: MetadataCandidate): DiffClass {
  if (LIST_FIELD_KEYS.has(key)) return classifyList(getSourceList(current, key), getCandidateList(candidate, key))
  if (TEXT_KEYS.has(key)) return classifyText(getSourceValue(current, key, candidate.provider), getCandidateValueFrom(candidate, key))
  if (IDENTIFIER_KEYS.has(key)) return classifyIdentifier(getSourceValue(current, key, candidate.provider), getCandidateValueFrom(candidate, key))
  switch (key) {
    case 'description':
      return classifyDescription(current.description, candidate.description)
    case 'publishedDate':
      return classifyDate(getSourceValue(current, key, candidate.provider), getCandidateValueFrom(candidate, key))
    case 'language':
      return classifyLanguage(current.language ?? '', candidate.language ?? '')
    case 'pageCount':
      return classifyNumber(current.pageCount, candidate.pageCount)
    case 'durationSeconds':
      return classifyNumber(current.durationSeconds, candidate.durationSeconds)
    case 'seriesIndex':
      return classifyNumber(current.seriesIndex, candidate.seriesIndex)
    case 'abridged':
      return candidate.abridged == null
        ? { kind: 'missing' }
        : current.abridged == null
          ? { kind: 'fill' }
          : current.abridged === candidate.abridged
            ? SAME
            : CHANGE
    case 'communityRating': {
      const existing = current.communityRatings?.find((r) => r.provider === candidate.provider)
      const offered =
        candidate.communityRating != null ? { rating: candidate.communityRating, ratingCount: candidate.communityRatingCount ?? null } : null
      return classifyRating(existing, offered)
    }
    default:
      return classifyText(getSourceValue(current, key, candidate.provider), getCandidateValueFrom(candidate, key))
  }
}

/** Whether a difference is worth a decision: it fills an empty field or replaces a value. */
export function isActionable(kind: DiffKind): boolean {
  return kind === 'fill' || kind === 'change' || kind === 'minor'
}

export interface DifferenceSummary {
  /** Empty fields on the book the candidate would fill. */
  fills: number
  /** Fields where the candidate has a different value. Minor differences are not counted. */
  changes: number
}

/** What a candidate offers the book at a glance, before it is opened. */
export function summarizeDifferences(current: MetadataSource, candidate: MetadataCandidate, providerIds?: ProviderIds): DifferenceSummary {
  const summary: DifferenceSummary = { fills: 0, changes: 0 }
  const count = (kind: DiffKind) => {
    if (kind === 'fill') summary.fills += 1
    else if (kind === 'change') summary.changes += 1
  }
  for (const def of FIELD_DEFS) {
    if (def.key === 'coverUrl') continue
    count(classifyField(def.key, current, candidate).kind)
  }
  if (candidate.comicMetadata) {
    for (const def of COMIC_FIELD_DEFS) count(classifyField(def.key, current, candidate).kind)
  }
  if (PROVIDER_ID_FIELD[candidate.provider] && candidate.providerId) {
    count(classifyIdentifier(existingProviderId(providerIds, candidate.provider), candidate.providerId).kind)
  }
  return summary
}
