import {
  METADATA_SCORE_FIELDS,
  METADATA_SCORE_GROUPS,
  isMetadataScoreFieldScoring,
  totalMetadataScoreWeight,
  type MetadataScoreField,
  type MetadataScoreGroup,
  type MetadataScoreWeights,
} from '@bookorbit/types'

/** Highest weight a single field can be given. Keeps one field from swamping the other 23. */
export const MAX_FIELD_WEIGHT = 20

/**
 * Score fields reuse the shared field vocabulary rather than carrying their own copies, so a
 * translator names "Publisher" once for the whole app.
 */
const FIELD_LABEL_KEY: Record<MetadataScoreField, string> = {
  title: 'title',
  subtitle: 'subtitle',
  description: 'description',
  coverSource: 'cover',
  authors: 'authors',
  genres: 'genres',
  publisher: 'publisher',
  publishedYear: 'publishedYear',
  language: 'language',
  pageCount: 'pageCount',
  seriesName: 'seriesName',
  seriesIndex: 'seriesIndex',
  rating: 'communityRating',
  isbn13: 'isbn13',
  isbn10: 'isbn10',
  tags: 'tags',
  googleBooksId: 'googleBooksId',
  goodreadsId: 'goodreadsId',
  amazonId: 'amazonId',
  hardcoverId: 'hardcoverId',
  openLibraryId: 'openLibraryId',
  itunesId: 'itunesId',
  koboId: 'koboId',
  aladinId: 'aladinId',
}

export function scoreFieldLabelKey(field: MetadataScoreField): string {
  return `settings.metadata.fields.${FIELD_LABEL_KEY[field]}`
}

export function scoreFieldRuleKey(field: MetadataScoreField): string {
  return `settings.admin.scoreWeights.rules.${METADATA_SCORE_FIELDS[field].rule}`
}

export const ALL_SCORE_FIELDS = Object.keys(METADATA_SCORE_FIELDS) as MetadataScoreField[]

export function fieldsInGroup(group: MetadataScoreGroup): MetadataScoreField[] {
  return ALL_SCORE_FIELDS.filter((field) => METADATA_SCORE_FIELDS[field].group === group)
}

export function groupPoints(weights: MetadataScoreWeights, group: MetadataScoreGroup): number {
  return fieldsInGroup(group).reduce((sum, field) => (isMetadataScoreFieldScoring(weights[field]) ? sum + weights[field] : sum), 0)
}

/**
 * Share of a finished score this field is responsible for. This is the number that means something:
 * a raw weight only has meaning against the total the server divides by.
 */
export function fieldShare(weights: MetadataScoreWeights, field: MetadataScoreField): number {
  const total = totalMetadataScoreWeight(weights)
  if (total <= 0 || !isMetadataScoreFieldScoring(weights[field])) return 0
  return (weights[field] / total) * 100
}

export function groupShare(weights: MetadataScoreWeights, group: MetadataScoreGroup): number {
  const total = totalMetadataScoreWeight(weights)
  if (total <= 0) return 0
  return (groupPoints(weights, group) / total) * 100
}

export type ScoreCompositionSegment = {
  group: MetadataScoreGroup
  points: number
  share: number
}

/** Group segments for the composition bar, largest first, with switched-off groups dropped. */
export function scoreComposition(weights: MetadataScoreWeights): ScoreCompositionSegment[] {
  return METADATA_SCORE_GROUPS.map((group) => ({
    group,
    points: groupPoints(weights, group),
    share: groupShare(weights, group),
  }))
    .filter((segment) => segment.share > 0)
    .sort((a, b) => b.share - a.share)
}

/**
 * Ranked by what each field is actually worth. Ties keep declaration order, which already runs
 * roughly most to least important, and switched-off fields always sink to the bottom.
 */
export function rankedScoreFields(weights: MetadataScoreWeights): MetadataScoreField[] {
  return [...ALL_SCORE_FIELDS].sort((a, b) => {
    const aScoring = isMetadataScoreFieldScoring(weights[a])
    const bScoring = isMetadataScoreFieldScoring(weights[b])
    if (aScoring !== bScoring) return aScoring ? -1 : 1
    if (weights[b] !== weights[a]) return weights[b] - weights[a]
    return ALL_SCORE_FIELDS.indexOf(a) - ALL_SCORE_FIELDS.indexOf(b)
  })
}

/**
 * Column-major split so reading down the first column and on into the second preserves the ranking.
 * Row-major would interleave ranks 1 and 2 across the page and destroy the ordering the list exists for.
 */
export function splitIntoColumns<T>(items: T[], columns: number): T[][] {
  if (columns < 1) return [items]
  const perColumn = Math.ceil(items.length / columns)
  return Array.from({ length: columns }, (_, index) => items.slice(index * perColumn, (index + 1) * perColumn)).filter((column) => column.length > 0)
}

export function changedFields(draft: MetadataScoreWeights, saved: MetadataScoreWeights): MetadataScoreField[] {
  return ALL_SCORE_FIELDS.filter((field) => draft[field] !== saved[field])
}

export function scoringFieldCount(weights: MetadataScoreWeights): number {
  return ALL_SCORE_FIELDS.filter((field) => isMetadataScoreFieldScoring(weights[field])).length
}

/** Weights arrive from an API and from number inputs, so both paths get clamped to something sendable. */
export function normalizeWeight(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(MAX_FIELD_WEIGHT, Math.max(0, Math.round(parsed)))
}

export function normalizeWeights(weights: Partial<MetadataScoreWeights> | null | undefined): MetadataScoreWeights {
  return Object.fromEntries(ALL_SCORE_FIELDS.map((field) => [field, normalizeWeight(weights?.[field])])) as MetadataScoreWeights
}
