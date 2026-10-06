import { computed, ref, shallowReactive, toRaw, toValue, type MaybeRefOrGetter } from 'vue'
import type {
  BookCommunityRating,
  BookMetadataLockField,
  ComicMetadataFields,
  CoverMedium,
  MetadataCandidate,
  MetadataCoverShape,
  MetadataProviderInfo,
  MetadataProviderKey,
  MetadataSeriesMembership,
  MetadataSource,
  ProviderIds,
  CustomMetadataBookValueInput,
} from '@bookorbit/types'
import { getProviderLabel, toDisplayCoverUrl } from '../lib/metadata-fetch'
import { COVER_FIT_RANK, coverFit, coverLockField, statedCoverShape, type CoverFit } from '../lib/cover-slots'
import {
  COMIC_FIELD_DEFS,
  COMIC_KEY_MAP,
  FIELD_DEFS,
  LIST_FIELD_KEYS,
  PROVIDER_ID_FIELD,
  classifyField,
  classifyIdentifier,
  descriptionPlainText,
  existingProviderId,
  getCandidateList,
  getCandidateValueFrom,
  getSourceList,
  getSourceValue,
  isActionable,
  isComicDiffFieldKey,
  isProviderIdPatchField,
  mergeGenreLists,
  normalizeForMatch,
  normalizeSeriesMemberships,
  providerIdLabelKey,
  type DiffFieldKey,
  type DiffKind,
  type MinorReason,
  type ProviderIdPatchField,
} from '../lib/metadata-diff-fields'
import { candidateKey } from '../lib/metadata-match'

export {
  COMIC_FIELD_DEFS,
  COMIC_KEY_MAP,
  FIELD_DEFS,
  PROVIDER_ID_FIELD,
  getCandidateValueFrom,
  isComicDiffFieldKey,
  isProviderIdPatchField,
  mergeGenreLists,
  providerIdLabelKey,
  type DiffFieldKey,
  type DiffKind,
  type MinorReason,
  type ProviderIdPatchField,
}
export type { ComicFieldDef } from '../lib/metadata-diff-fields'

/** A value another result offers for a field, with every result that agrees on it. */
export interface OtherValue {
  display: string
  list: string[] | null
  /** Results offering it, best first. A pick takes the first. */
  candidates: MetadataCandidate[]
  matchesCurrent: boolean
  isPicked: boolean
}

export interface DiffField {
  key: DiffFieldKey
  /** An i18n key; the row translates it with `labelParams`. */
  labelKey: string
  labelParams?: Record<string, string>
  bookValue: string
  candidateDisplay: string
  /** A list field's items, for chips; null for other fields. */
  bookList: string[] | null
  candidateList: string[] | null
  kind: DiffKind
  minorReason?: MinorReason
  hasDiff: boolean
  /** A value is staged for this field, from the active result or another. */
  isPicked: boolean
  pickedFromActive: boolean
  pickedCandidate: MetadataCandidate | null
  pickedProvider: MetadataProviderKey | null
  isLocked: boolean
  /** Genres can merge into the book's list as well as replace it. */
  mergeable: boolean
  otherValues: OtherValue[]
}

export interface CoverChoice {
  candidate: MetadataCandidate
  url: string
  fit: CoverFit
  size: CoverSize | null
  broken: boolean
}

export interface CoverSize {
  width: number
  height: number
}

export interface CoverState {
  medium: CoverMedium
  currentUrl: string
  locked: boolean
  /** The active result's cover, when it has one. */
  active: CoverChoice | null
  picked: CoverChoice | null
  pickedFromActive: boolean
  /** Every alternative's cover: the slot's shape first, then the cover rule's order, broken images last. */
  choices: CoverChoice[]
}

export interface StagedChange {
  key: string
  field: DiffFieldKey
  labelKey: string
  labelParams?: Record<string, string>
  candidate: MetadataCandidate
  before: string
  after: string
  merged: boolean
  isCover: boolean
}

export type FieldDecision = 'keep' | 'use' | 'merge' | 'replace'

export interface MetadataPatch {
  title?: string | null
  subtitle?: string | null
  description?: string | null
  publisher?: string | null
  publishedDate?: string | null
  publishedYear?: number | null
  language?: string | null
  pageCount?: number | null
  communityRatings?: Array<Pick<BookCommunityRating, 'provider' | 'rating' | 'ratingCount'>>
  seriesName?: string | null
  seriesIndex?: string | null
  seriesMemberships?: MetadataSeriesMembership[] | null
  isbn10?: string | null
  isbn13?: string | null
  authors?: string[]
  genres?: string[]
  narrators?: string[]
  durationSeconds?: number | null
  abridged?: boolean
  googleBooksId?: string | null
  goodreadsId?: string | null
  amazonId?: string | null
  hardcoverId?: string | null
  hardcoverEditionId?: string | null
  openLibraryId?: string | null
  itunesId?: string | null
  audibleId?: string | null
  librofmId?: string | null
  koboId?: string | null
  comicvineId?: string | null
  ranobedbId?: string | null
  lubimyczytacId?: string | null
  aladinId?: string | null
  mangabakaId?: string | null
  mangabakaSeriesId?: string | null
  comicMetadata?: ComicMetadataFields
  customMetadata?: CustomMetadataBookValueInput[]
}

/** What the diff hands back: the form fields, plus a cover for each slot that was picked. */
export interface MetadataDiffApply {
  formPatch: MetadataPatch
  /** For the ebook slot. */
  coverUrl?: string
  /** For the audio slot. */
  audioCoverUrl?: string
}

export type GenreWriteMode = 'merge' | 'replace'

export interface MetadataDiffInput {
  current: MaybeRefOrGetter<MetadataSource>
  /** The result being compared against the book. */
  active: MaybeRefOrGetter<MetadataCandidate | null>
  /** Results offered for "other values" and the cover strip, best first. Usually the likely matches only. */
  alternatives: MaybeRefOrGetter<readonly MetadataCandidate[]>
  providers: MaybeRefOrGetter<readonly MetadataProviderInfo[]>
  currentCoverUrl?: MaybeRefOrGetter<string | undefined>
  providerIds?: MaybeRefOrGetter<ProviderIds | undefined>
  lockedFields?: MaybeRefOrGetter<readonly BookMetadataLockField[] | undefined>
  /** The slot the cover fills. Defaults to the ebook slot. */
  coverMedium?: MaybeRefOrGetter<CoverMedium | undefined>
  /** Providers in the order the slot's cover rule ranks them. */
  coverPriority?: MaybeRefOrGetter<readonly MetadataProviderKey[] | undefined>
  coverLabelKey?: MaybeRefOrGetter<string | undefined>
  coverShapeOf?: (candidate: MetadataCandidate) => MetadataCoverShape
  coverSizeOf?: (candidate: MetadataCandidate) => CoverSize | null
}

const FIELD_LABELS = new Map<DiffFieldKey, string>([...FIELD_DEFS, ...COMIC_FIELD_DEFS].map((def) => [def.key, def.labelKey]))
const RATING_LABEL_KEY = 'book.detail.editMetadata.match.providerRating'
const DEFAULT_COVER_LABEL_KEY = 'book.detail.editMetadata.diff.fields.coverUrl'

/** Wider than this, or narrower than the inverse, an image is a banner or a strip rather than a cover. */
const BROKEN_COVER_RATIO = 2.2

export function coverLooksBroken(size: CoverSize | null): boolean {
  if (!size || size.width <= 0 || size.height <= 0) return false
  const ratio = size.width / size.height
  return ratio > BROKEN_COVER_RATIO || ratio < 1 / (BROKEN_COVER_RATIO * 1.3)
}

function sameCandidate(a: MetadataCandidate | null | undefined, b: MetadataCandidate | null | undefined): boolean {
  if (!a || !b) return false
  return candidateKey(a) === candidateKey(b)
}

function statedSize(candidate: MetadataCandidate): CoverSize | null {
  return candidate.coverWidth && candidate.coverHeight ? { width: candidate.coverWidth, height: candidate.coverHeight } : null
}

/**
 * The comparison between the book and one search result, and the picks made across all of them.
 * A pick names the result it came from, so switching to another result keeps what was chosen from
 * the first; `buildPatch` then reads each field from its own result.
 */
export function useMetadataDiff(input: MetadataDiffInput) {
  const picks = shallowReactive(new Map<DiffFieldKey, MetadataCandidate>())
  // A book keeps one community rating per provider, so each provider's rating is its own pick.
  const ratingPicks = shallowReactive(new Map<MetadataProviderKey, MetadataCandidate>())
  const genreWriteMode = ref<GenreWriteMode>('merge')

  const lockedFieldSet = computed(() => new Set(toValue(input.lockedFields) ?? []))
  const coverMedium = computed<CoverMedium>(() => toValue(input.coverMedium) ?? 'ebook')
  const coverShapeOf = input.coverShapeOf ?? statedCoverShape
  const coverSizeOf = input.coverSizeOf ?? statedSize

  function resolveLockField(key: DiffFieldKey): BookMetadataLockField | null {
    if (key === 'coverUrl') return coverLockField(coverMedium.value)
    if (key === 'sourceUrl') return null
    if (key === 'publishedDate') return 'publishedYear'
    return key as BookMetadataLockField
  }

  function isLocked(key: DiffFieldKey): boolean {
    const lock = resolveLockField(key)
    return lock ? lockedFieldSet.value.has(lock) : false
  }

  function pickFor(key: DiffFieldKey, provider: MetadataProviderKey): MetadataCandidate | null {
    return (key === 'communityRating' ? ratingPicks.get(provider) : picks.get(key)) ?? null
  }

  function comparable(key: DiffFieldKey, candidate: MetadataCandidate): string {
    if (LIST_FIELD_KEYS.has(key)) return getCandidateList(candidate, key).map(normalizeForMatch).sort().join('\u0000')
    if (key === 'description') return normalizeForMatch(descriptionPlainText(candidate.description))
    return normalizeForMatch(getCandidateValueFrom(candidate, key))
  }

  function otherValuesFor(key: DiffFieldKey, active: MetadataCandidate, current: MetadataSource, picked: MetadataCandidate | null): OtherValue[] {
    const own = comparable(key, active)
    const currentComparable = LIST_FIELD_KEYS.has(key)
      ? getSourceList(current, key).map(normalizeForMatch).sort().join('\u0000')
      : key === 'description'
        ? normalizeForMatch(descriptionPlainText(current.description))
        : normalizeForMatch(getSourceValue(current, key, active.provider))
    const groups = new Map<string, OtherValue>()
    for (const candidate of toValue(input.alternatives)) {
      if (sameCandidate(candidate, active)) continue
      const display = key === 'description' ? descriptionPlainText(candidate.description) : getCandidateValueFrom(candidate, key)
      if (!display) continue
      const value = comparable(key, candidate)
      if (!value || value === own) continue
      let group = groups.get(value)
      if (!group) {
        group = {
          display,
          list: LIST_FIELD_KEYS.has(key) ? getCandidateList(candidate, key) : null,
          candidates: [],
          matchesCurrent: value === currentComparable,
          isPicked: false,
        }
        groups.set(value, group)
      }
      group.candidates.push(candidate)
      if (sameCandidate(candidate, picked)) group.isPicked = true
    }
    return [...groups.values()]
  }

  function makeRow(key: DiffFieldKey, labelKey: string, active: MetadataCandidate, current: MetadataSource): DiffField | null {
    const candidateDisplay = key === 'description' ? descriptionPlainText(active.description) : getCandidateValueFrom(active, key)
    const bookValue = key === 'description' ? descriptionPlainText(current.description) : getSourceValue(current, key, active.provider)
    if (!candidateDisplay && !bookValue) return null
    const cls = classifyField(key, current, active)
    const pickedCandidate = pickFor(key, active.provider)
    const isList = LIST_FIELD_KEYS.has(key)
    return {
      key,
      labelKey: key === 'communityRating' ? RATING_LABEL_KEY : labelKey,
      ...(key === 'communityRating' ? { labelParams: { provider: getProviderLabel(active.provider, toValue(input.providers)) } } : {}),
      bookValue,
      candidateDisplay,
      bookList: isList ? getSourceList(current, key) : null,
      candidateList: isList ? getCandidateList(active, key) : null,
      kind: cls.kind,
      ...(cls.reason ? { minorReason: cls.reason } : {}),
      hasDiff: isActionable(cls.kind),
      isPicked: pickedCandidate !== null,
      pickedFromActive: sameCandidate(pickedCandidate, active),
      pickedCandidate,
      pickedProvider: pickedCandidate?.provider ?? null,
      isLocked: isLocked(key),
      mergeable: key === 'genres' && current.genres.length > 0,
      otherValues: key === 'communityRating' ? [] : otherValuesFor(key, active, current, pickedCandidate),
    }
  }

  const fields = computed<DiffField[]>(() => {
    const active = toValue(input.active)
    if (!active) return []
    const current = toValue(input.current)
    const rows: DiffField[] = []

    for (const def of FIELD_DEFS) {
      if (def.key === 'coverUrl') continue
      const row = makeRow(def.key, def.labelKey, active, current)
      if (row) rows.push(row)
    }

    if (active.comicMetadata) {
      for (const def of COMIC_FIELD_DEFS) {
        const row = makeRow(def.key, def.labelKey, active, current)
        if (row) rows.push(row)
      }
    }

    const idField = PROVIDER_ID_FIELD[active.provider]
    const existing = existingProviderId(toValue(input.providerIds), active.provider)
    const offered = active.providerId ?? ''
    if (idField && (offered || existing)) {
      const pickedCandidate = picks.get(idField) ?? null
      const cls = classifyIdentifier(existing, offered)
      rows.push({
        key: idField,
        labelKey: providerIdLabelKey(active.provider),
        bookValue: existing,
        candidateDisplay: offered,
        bookList: null,
        candidateList: null,
        kind: cls.kind,
        ...(cls.reason ? { minorReason: cls.reason } : {}),
        hasDiff: isActionable(cls.kind),
        isPicked: pickedCandidate !== null,
        pickedFromActive: sameCandidate(pickedCandidate, active),
        pickedCandidate,
        pickedProvider: pickedCandidate?.provider ?? null,
        isLocked: lockedFieldSet.value.has(idField),
        mergeable: false,
        otherValues: [],
      })
    }

    return rows
  })

  function coverChoice(candidate: MetadataCandidate): CoverChoice | null {
    const url = toDisplayCoverUrl(candidate.coverUrl)
    if (!url) return null
    const size = coverSizeOf(candidate)
    return { candidate, url, fit: coverFit(coverShapeOf(candidate), coverMedium.value), size, broken: coverLooksBroken(size) }
  }

  const cover = computed<CoverState>(() => {
    const active = toValue(input.active)
    const priority = new Map((toValue(input.coverPriority) ?? []).map((provider, index) => [provider, index]))
    const choices = toValue(input.alternatives)
      .map((candidate, index) => ({ choice: coverChoice(candidate), index }))
      .filter((entry): entry is { choice: CoverChoice; index: number } => entry.choice !== null)
      .sort(
        (a, b) =>
          Number(a.choice.broken) - Number(b.choice.broken) ||
          COVER_FIT_RANK[a.choice.fit] - COVER_FIT_RANK[b.choice.fit] ||
          (priority.get(a.choice.candidate.provider) ?? Number.MAX_SAFE_INTEGER) -
            (priority.get(b.choice.candidate.provider) ?? Number.MAX_SAFE_INTEGER) ||
          a.index - b.index,
      )
      .map(({ choice }) => choice)
    const pickedCandidate = picks.get('coverUrl') ?? null
    return {
      medium: coverMedium.value,
      currentUrl: toValue(input.currentCoverUrl) ?? '',
      locked: isLocked('coverUrl'),
      active: active ? coverChoice(active) : null,
      picked: pickedCandidate ? coverChoice(pickedCandidate) : null,
      pickedFromActive: sameCandidate(pickedCandidate, active),
      choices,
    }
  })

  function setField(key: DiffFieldKey, decision: FieldDecision, from?: MetadataCandidate | null) {
    if (isLocked(key)) return
    const candidate = from ?? toValue(input.active)
    if (key === 'communityRating') {
      if (!candidate) return
      if (decision === 'keep') ratingPicks.delete(candidate.provider)
      else ratingPicks.set(candidate.provider, toRaw(candidate))
      return
    }
    if (decision === 'keep') {
      picks.delete(key)
      return
    }
    if (!candidate) return
    picks.set(key, toRaw(candidate))
    if (key === 'genres' && (decision === 'merge' || decision === 'replace')) genreWriteMode.value = decision
  }

  /** The decision a field's control shows for the active result. */
  function decisionOf(field: DiffField): FieldDecision {
    if (!field.pickedFromActive) return 'keep'
    return field.key === 'genres' ? genreWriteMode.value : 'use'
  }

  function toggleField(key: DiffFieldKey) {
    const field = fields.value.find((f) => f.key === key)
    if (!field) return
    setField(key, field.pickedFromActive ? 'keep' : field.key === 'genres' ? genreWriteMode.value : 'use')
  }

  function pickCover(candidate: MetadataCandidate | null) {
    if (isLocked('coverUrl')) return
    if (!candidate) picks.delete('coverUrl')
    else picks.set('coverUrl', toRaw(candidate))
  }

  /** Every empty field the active result can fill, and an empty cover slot. */
  function fillEmpty() {
    for (const field of fields.value) {
      if (field.isLocked || field.kind !== 'fill' || field.isPicked) continue
      setField(field.key, 'use')
    }
    const state = cover.value
    if (!state.currentUrl && state.active && !state.locked && !state.picked && !state.active.broken) pickCover(state.active.candidate)
  }

  /**
   * Every difference the active result has. Like the automatic fetch, it never swaps a cover for
   * art of the other shape; the cover's own control still can.
   */
  function takeAll() {
    for (const field of fields.value) {
      if (field.isLocked || !isActionable(field.kind)) continue
      setField(field.key, field.key === 'genres' ? genreWriteMode.value : 'use')
    }
    const state = cover.value
    if (state.active && !state.locked && !state.active.broken && (state.active.fit !== 'mismatch' || !state.currentUrl))
      pickCover(state.active.candidate)
  }

  const takeAllCount = computed(() => {
    const state = cover.value
    const coverCounts = !!state.active && !state.locked && !state.active.broken && (state.active.fit !== 'mismatch' || !state.currentUrl)
    return fields.value.filter((field) => !field.isLocked && isActionable(field.kind)).length + (coverCounts ? 1 : 0)
  })

  const fillEmptyCount = computed(() => {
    const state = cover.value
    const coverCounts = !state.currentUrl && !!state.active && !state.locked && !state.picked && !state.active.broken
    return fields.value.filter((field) => !field.isLocked && field.kind === 'fill' && !field.isPicked).length + (coverCounts ? 1 : 0)
  })

  function clearAll() {
    picks.clear()
    ratingPicks.clear()
  }

  function unstage(key: string) {
    if (key.startsWith('rating:')) {
      ratingPicks.delete(key.slice('rating:'.length) as MetadataProviderKey)
      return
    }
    picks.delete(key as DiffFieldKey)
  }

  const staged = computed<StagedChange[]>(() => {
    const current = toValue(input.current)
    const ids = toValue(input.providerIds)
    const out: StagedChange[] = []
    for (const [key, candidate] of picks) {
      if (key === 'coverUrl') {
        out.push({
          key,
          field: key,
          labelKey: toValue(input.coverLabelKey) ?? DEFAULT_COVER_LABEL_KEY,
          candidate,
          before: toValue(input.currentCoverUrl) ?? '',
          after: toDisplayCoverUrl(candidate.coverUrl),
          merged: false,
          isCover: true,
        })
        continue
      }
      if (isProviderIdPatchField(key)) {
        out.push({
          key,
          field: key,
          labelKey: providerIdLabelKey(candidate.provider),
          candidate,
          before: existingProviderId(ids, candidate.provider),
          after: candidate.providerId ?? '',
          merged: false,
          isCover: false,
        })
        continue
      }
      const merged = key === 'genres' && genreWriteMode.value === 'merge'
      const describe = (value: string) => (key === 'description' ? descriptionPlainText(value) : value)
      out.push({
        key,
        field: key,
        labelKey: FIELD_LABELS.get(key) ?? key,
        candidate,
        before: describe(getSourceValue(current, key, candidate.provider)),
        after: merged ? mergeGenreLists(current.genres, candidate.genres ?? []).join(', ') : describe(getCandidateValueFrom(candidate, key)),
        merged,
        isCover: false,
      })
    }
    for (const [provider, candidate] of ratingPicks) {
      out.push({
        key: `rating:${provider}`,
        field: 'communityRating',
        labelKey: RATING_LABEL_KEY,
        labelParams: { provider: getProviderLabel(provider, toValue(input.providers)) },
        candidate,
        before: getSourceValue(current, 'communityRating', provider),
        after: getCandidateValueFrom(candidate, 'communityRating'),
        merged: false,
        isCover: false,
      })
    }
    return out
  })

  /** How many staged values came from each result, by `candidateKey`. */
  const stagedByCandidate = computed(() => {
    const counts = new Map<string, number>()
    for (const change of staged.value) {
      const key = candidateKey(change.candidate)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  })

  const hasCopied = computed(() => picks.size > 0 || ratingPicks.size > 0)

  function buildPatch(): { formPatch: MetadataPatch; coverUrl?: string } {
    const formPatch: MetadataPatch = {}
    let coverUrl: string | undefined
    const comicPatch: Partial<ComicMetadataFields> = {}
    const current = toValue(input.current)
    const contributors: MetadataCandidate[] = []
    const contribute = (candidate: MetadataCandidate) => {
      if (!contributors.some((c) => sameCandidate(c, candidate))) contributors.push(candidate)
    }

    for (const [key, candidate] of picks) {
      if (isLocked(key)) continue
      contribute(candidate)

      if (isComicDiffFieldKey(key)) {
        const comicKey = COMIC_KEY_MAP[key]
        ;(comicPatch as Record<string, unknown>)[comicKey] = candidate.comicMetadata?.[comicKey]
        continue
      }
      if (key === 'coverUrl') {
        coverUrl = candidate.coverUrl
        continue
      }
      if (key === 'authors') {
        formPatch.authors = candidate.authors ?? []
        continue
      }
      if (key === 'genres') {
        formPatch.genres =
          genreWriteMode.value === 'merge' ? mergeGenreLists(current.genres, candidate.genres ?? []) : mergeGenreLists([], candidate.genres ?? [])
        continue
      }
      if (key === 'narrators') {
        formPatch.narrators = candidate.narrators ?? []
        continue
      }
      if (key === 'durationSeconds') {
        formPatch.durationSeconds = candidate.durationSeconds ?? null
        continue
      }
      if (key === 'abridged') {
        formPatch.abridged = candidate.abridged ?? false
        continue
      }
      if (key === 'publishedDate') {
        formPatch.publishedDate = candidate.publishedDate ?? null
        formPatch.publishedYear = candidate.publishedYear ?? null
        continue
      }
      if (key === 'pageCount') {
        formPatch.pageCount = candidate.pageCount ?? null
        continue
      }
      if (key === 'seriesIndex') {
        formPatch.seriesIndex = candidate.seriesIndex ?? null
        continue
      }
      if (isProviderIdPatchField(key)) {
        formPatch[key] = candidate.providerId
        continue
      }
      if (key === 'sourceUrl' || key === 'communityRating') continue
      const val = candidate[key as keyof MetadataCandidate]
      ;(formPatch as Record<string, unknown>)[key] = val != null ? String(val) : null
    }

    if (!isLocked('communityRating')) {
      for (const candidate of ratingPicks.values()) {
        if (candidate.communityRating === undefined) continue
        contribute(candidate)
        formPatch.communityRatings ??= []
        formPatch.communityRatings.push({
          provider: candidate.provider,
          rating: candidate.communityRating,
          ratingCount: candidate.communityRatingCount ?? null,
        })
      }
    }

    const seriesName = picks.get('seriesName')
    if (seriesName && sameCandidate(seriesName, picks.get('seriesIndex')) && !isLocked('seriesName')) {
      const memberships = normalizeSeriesMemberships(seriesName.seriesMemberships)
      if (memberships.length > 0) formPatch.seriesMemberships = memberships
    }

    if (Object.keys(comicPatch).length > 0) {
      formPatch.comicMetadata = comicPatch as ComicMetadataFields
    }

    // Link every provider that contributed a value, so a later fetch can find the same record.
    for (const candidate of contributors) {
      if (!candidate.providerId) continue
      const idField = PROVIDER_ID_FIELD[candidate.provider]
      if (idField && formPatch[idField] === undefined && !lockedFieldSet.value.has(idField)) {
        formPatch[idField] = candidate.providerId
      }
      if (
        candidate.provider === 'hardcover' &&
        candidate.hardcoverEditionId &&
        formPatch.hardcoverEditionId === undefined &&
        !lockedFieldSet.value.has('hardcoverEditionId')
      ) {
        formPatch.hardcoverEditionId = candidate.hardcoverEditionId
      }
    }

    // Keep the ids the book already holds that nothing here replaces.
    const ids = toValue(input.providerIds)
    if (ids) {
      for (const [provider, id] of Object.entries(ids)) {
        const idField = PROVIDER_ID_FIELD[provider as MetadataProviderKey]
        if (idField && formPatch[idField] === undefined && id) {
          formPatch[idField] = id
        }
      }
    }

    return { formPatch, coverUrl }
  }

  function setGenreWriteMode(mode: GenreWriteMode) {
    genreWriteMode.value = mode
  }

  return {
    fields,
    cover,
    staged,
    stagedByCandidate,
    hasCopied,
    genreWriteMode,
    setGenreWriteMode,
    setField,
    decisionOf,
    toggleField,
    pickCover,
    fillEmpty,
    fillEmptyCount,
    takeAll,
    takeAllCount,
    clearAll,
    unstage,
    buildPatch,
  }
}
