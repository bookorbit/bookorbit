import { MetadataProviderKey, type BookDockMetadata } from '@bookorbit/types';

const PASSTHROUGH_FIELDS = [
  'title',
  'subtitle',
  'authors',
  'narrators',
  'description',
  'publisher',
  'publishedDate',
  'publishedYear',
  'language',
  'pageCount',
  'isbn10',
  'isbn13',
  'seriesName',
  'seriesIndex',
  'genres',
  'coverUrl',
  'abridged',
  'googleBooksId',
  'goodreadsId',
  'amazonId',
  'hardcoverId',
  'hardcoverEditionId',
  'openLibraryId',
  'itunesId',
  'audibleId',
  'librofmId',
  'koboId',
  'comicvineId',
  'ranobedbId',
  'lubimyczytacId',
  'aladinId',
] as const satisfies readonly (keyof BookDockMetadata)[];

const BOOK_DOCK_METADATA_FIELDS = new Set<keyof BookDockMetadata>([
  ...PASSTHROUGH_FIELDS,
  'durationSeconds',
  'chapters',
  'seriesMemberships',
  'communityRatings',
  'comicMetadata',
]);
const METADATA_PROVIDER_KEYS = new Set<string>(Object.values(MetadataProviderKey));

export function normalizeBookDockMetadata(value: unknown): BookDockMetadata | null {
  if (!isRecord(value)) return null;

  const normalized: BookDockMetadata = {};
  const target = normalized as Record<string, unknown>;
  for (const field of PASSTHROUGH_FIELDS) {
    if (value[field] !== undefined) target[field] = value[field];
  }

  const durationSeconds = value.durationSeconds !== undefined ? value.durationSeconds : value.duration;
  if (durationSeconds !== undefined) target.durationSeconds = durationSeconds;

  copyChapters(value, normalized);
  copySeriesMemberships(value, normalized);
  copyCommunityRatings(value, normalized);
  copyComicMetadata(value, normalized);

  return normalized;
}

export function normalizeBookDockMetadataSources(value: unknown): Partial<Record<keyof BookDockMetadata, string>> | null {
  if (!isRecord(value)) return null;

  const normalized: Partial<Record<keyof BookDockMetadata, string>> = {};
  for (const [rawField, source] of Object.entries(value)) {
    if (typeof source !== 'string') continue;
    const field = normalizeSourceField(rawField);
    if (!field) continue;
    normalized[field] = source;
  }
  return normalized;
}

function copyChapters(source: Record<string, unknown>, target: BookDockMetadata): void {
  if (source.chapters === undefined) return;
  if (source.chapters === null) {
    target.chapters = null;
    return;
  }
  if (!Array.isArray(source.chapters)) return;

  target.chapters = source.chapters.flatMap((value) => {
    if (!isRecord(value)) return [];
    const startMs =
      typeof value.startMs === 'number' ? value.startMs : typeof value.startMs === 'string' ? Number.parseFloat(value.startMs.trim()) : NaN;
    if (!Number.isFinite(startMs) || startMs < 0) return [];
    const chapter: NonNullable<BookDockMetadata['chapters']>[number] & { durationMs?: number | null } = {
      title: typeof value.title === 'string' ? value.title : '',
      startMs: Math.round(startMs),
    };
    if (value.durationMs === null || isNonNegativeInteger(value.durationMs)) chapter.durationMs = value.durationMs;
    return [chapter];
  });
}

function copySeriesMemberships(source: Record<string, unknown>, target: BookDockMetadata): void {
  if (source.seriesMemberships === undefined) return;
  if (source.seriesMemberships === null) {
    target.seriesMemberships = null;
    return;
  }
  if (!Array.isArray(source.seriesMemberships)) return;

  target.seriesMemberships = source.seriesMemberships.flatMap((value) => {
    if (!isRecord(value) || typeof value.seriesName !== 'string') return [];
    const membership: NonNullable<BookDockMetadata['seriesMemberships']>[number] = { seriesName: value.seriesName };
    if (value.seriesIndex === null || typeof value.seriesIndex === 'number') membership.seriesIndex = value.seriesIndex;
    return [membership];
  });
}

function copyCommunityRatings(source: Record<string, unknown>, target: BookDockMetadata): void {
  if (source.communityRatings === undefined) return;
  if (source.communityRatings === null) {
    target.communityRatings = null;
    return;
  }
  if (!Array.isArray(source.communityRatings)) return;

  target.communityRatings = source.communityRatings.flatMap((value) => {
    if (
      !isRecord(value) ||
      typeof value.provider !== 'string' ||
      !METADATA_PROVIDER_KEYS.has(value.provider) ||
      typeof value.rating !== 'number' ||
      !Number.isFinite(value.rating) ||
      value.rating < 0 ||
      value.rating > 5
    ) {
      return [];
    }
    const rating: NonNullable<BookDockMetadata['communityRatings']>[number] = {
      provider: value.provider as MetadataProviderKey,
      rating: value.rating,
    };
    if (value.ratingCount === null || isNonNegativeInteger(value.ratingCount)) rating.ratingCount = value.ratingCount;
    return [rating];
  });
}

function copyComicMetadata(source: Record<string, unknown>, target: BookDockMetadata): void {
  if (source.comicMetadata === undefined) return;
  if (source.comicMetadata === null) {
    target.comicMetadata = null;
    return;
  }
  if (!isRecord(source.comicMetadata)) return;

  const comicMetadata: NonNullable<BookDockMetadata['comicMetadata']> = {};
  if (typeof source.comicMetadata.issueNumber === 'string') comicMetadata.issueNumber = source.comicMetadata.issueNumber;
  if (typeof source.comicMetadata.volumeName === 'string') comicMetadata.volumeName = source.comicMetadata.volumeName;
  const arrayFields = ['pencillers', 'inkers', 'colorists', 'letterers', 'coverArtists', 'characters', 'teams', 'locations', 'storyArcs'] as const;
  for (const field of arrayFields) {
    const entries = source.comicMetadata[field];
    if (Array.isArray(entries)) comicMetadata[field] = entries.filter((entry): entry is string => typeof entry === 'string');
  }
  target.comicMetadata = comicMetadata;
}

function normalizeSourceField(field: string): keyof BookDockMetadata | null {
  if (field === 'duration') return 'durationSeconds';
  if (field === 'communityRating') return 'communityRatings';
  if (field === 'cover') return 'coverUrl';
  return BOOK_DOCK_METADATA_FIELDS.has(field as keyof BookDockMetadata) ? (field as keyof BookDockMetadata) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
