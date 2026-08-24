import { isAudioFormat, isComicFormat, parseSeriesIndex } from '@bookorbit/types';
import { Injectable } from '@nestjs/common';
import { posix } from 'node:path';

import { isValidIsbn10, isValidIsbn13, normalizeIsbn } from '../../../book-duplicates/book-duplicate-normalize';
import type {
  SourceBook,
  SourceBookFile,
  SourceContributor,
  SourceExportDomains,
  SourceShelfBook,
  SourceUserBookStatus,
  SourceUserFileProgress,
} from '../source-adapter.types';
import type {
  CalibreWebAutomatedAuthorLinkRecord,
  CalibreWebAutomatedBookRecord,
  CalibreWebAutomatedFileRecord,
  CalibreWebAutomatedIdentifierRecord,
  CalibreWebAutomatedKoboBookmarkRecord,
  CalibreWebAutomatedNamedLinkRecord,
  CalibreWebAutomatedNormalizationResult,
  CalibreWebAutomatedRatingLinkRecord,
  CalibreWebAutomatedSourceRecords,
  CalibreWebAutomatedStatusRecord,
} from './calibre-web-automated-source.types';

const ANONYMOUS_ROLE = 32;
const MAX_WARNING_CATEGORIES = 100;
const CWA_AUDIO_FORMATS = new Set(['mp3', 'mp4', 'ogg', 'opus', 'wav', 'flac', 'm4a', 'm4b']);
const CWA_COMIC_FORMATS = new Set(['cbr', 'cbt', 'cbz']);
const AMAZON_IDENTIFIER_TYPES = new Set([
  'amazon',
  'amazon_au',
  'amazon_br',
  'amazon_ca',
  'amazon_cn',
  'amazon_de',
  'amazon_es',
  'amazon_fr',
  'amazon_in',
  'amazon_it',
  'amazon_jp',
  'amazon_mx',
  'amazon_nl',
  'amazon_uk',
  'amazon_us',
]);
const METADATA_FIELDS = [
  'title',
  'subtitle',
  'isbn10',
  'isbn13',
  'description',
  'publisher',
  'publishedYear',
  'language',
  'seriesName',
  'seriesIndex',
  'rating',
  'googleBooksId',
  'goodreadsId',
  'amazonId',
  'hardcoverId',
  'koboId',
] as const;

type MetadataField = (typeof METADATA_FIELDS)[number];
type ProgressSource = 'web' | 'kobo' | 'koreader';

interface BookContext {
  sourceBook: SourceBook;
  filesByFormat: Map<string, SourceBookFile[]>;
}

interface ProgressCandidate extends SourceUserFileProgress {
  source: ProgressSource;
  sequence: number;
}

interface NormalizedIdentifiers {
  isbn10: string | null;
  isbn13: string | null;
  asin: string | null;
  amazonId: string | null;
  goodreadsId: string | null;
  googleBooksId: string | null;
  koboId: string | null;
  hardcoverId: string | null;
}

@Injectable()
export class CalibreWebAutomatedNormalizer {
  normalize(records: CalibreWebAutomatedSourceRecords): CalibreWebAutomatedNormalizationResult {
    const counters = new CounterCollector(records.warnings.map((warning) => [warning.category, warning.count]));
    const compatibilityWarnings = new Set(records.compatibilityWarnings.map((warning) => warning.trim()).filter(Boolean));
    const logicalRoots = normalizeLogicalRoots(records, counters);
    const logicalRoot = logicalRoots.length === 1 ? logicalRoots[0] : null;

    const anonymousUserIds = new Set(records.users.filter((record) => (record.role & ANONYMOUS_ROLE) !== 0).map((record) => record.id));
    const users = records.users.flatMap((record) => {
      if (anonymousUserIds.has(record.id)) {
        counters.add('anonymous_users_excluded');
        return [];
      }
      const name = normalizeText(record.name);
      if (!name) {
        counters.add('invalid_users_skipped');
        return [];
      }
      return [{ sourceUserId: String(record.id), username: name, name, email: normalizeText(record.email) }];
    });
    const sourceUserIds = new Set(users.map((user) => user.sourceUserId));

    const authorLinks = groupBy(records.authorLinks, (record) => record.bookId);
    const publisherLinks = groupBy(records.publisherLinks, (record) => record.bookId);
    const languageLinks = groupBy(records.languageLinks, (record) => record.bookId);
    const seriesLinks = groupBy(records.seriesLinks, (record) => record.bookId);
    const ratingLinks = groupBy(records.ratingLinks, (record) => record.bookId);
    const comments = groupBy(records.comments, (record) => record.bookId);
    const tagLinks = groupBy(records.tagLinks, (record) => record.bookId);
    const identifiers = groupBy(records.identifiers, (record) => record.bookId);
    const files = groupBy(records.files, (record) => record.bookId);
    const books: SourceBook[] = [];
    const contexts = new Map<string, BookContext>();

    for (const record of records.books) {
      const sourceBookId = String(record.id);
      const normalizedFiles = normalizeFiles(sourceBookId, record, files.get(record.id) ?? [], logicalRoot, counters);
      const authors = records.capabilities.authors ? normalizeAuthors(record, authorLinks.get(record.id) ?? [], counters) : [];
      const publisher = records.capabilities.publishers
        ? selectSingleNamedValue(publisherLinks.get(record.id) ?? [], counters, 'multiple_publishers')
        : null;
      const language = records.capabilities.languages ? selectLanguage(languageLinks.get(record.id) ?? []) : null;
      const seriesName = records.capabilities.series ? selectSingleNamedValue(seriesLinks.get(record.id) ?? [], counters, 'multiple_series') : null;
      const rating = records.capabilities.ratings ? selectRating(ratingLinks.get(record.id) ?? [], counters) : null;
      const description = records.capabilities.comments ? selectSingleText(comments.get(record.id) ?? [], counters, 'multiple_comments') : null;
      const tags = records.capabilities.tags ? normalizeNamedValues(tagLinks.get(record.id) ?? []) : [];
      const normalizedIdentifiers = records.capabilities.identifiers
        ? normalizeIdentifiers(identifiers.get(record.id) ?? [], counters)
        : emptyIdentifiers();
      const publishedYear = normalizePublishedYear(record.pubdate, counters);
      const metadata = {
        title: normalizeText(record.title),
        subtitle: null,
        isbn10: normalizedIdentifiers.isbn10,
        isbn13: normalizedIdentifiers.isbn13,
        description,
        publisher,
        publishedYear,
        language,
        seriesName,
        seriesIndex: seriesName ? parseSeriesIndex(record.seriesIndex) : null,
        rating,
        googleBooksId: normalizedIdentifiers.googleBooksId,
        goodreadsId: normalizedIdentifiers.goodreadsId,
        amazonId: normalizedIdentifiers.amazonId,
        hardcoverId: normalizedIdentifiers.hardcoverId,
        koboId: normalizedIdentifiers.koboId,
      } satisfies Record<MetadataField, string | number | null>;
      const sourceBook: SourceBook = {
        sourceBookId,
        ...metadata,
        asin: normalizedIdentifiers.asin,
        author: authors.length > 0 ? authors.map((author) => author.name).join(' & ') : null,
        authors,
        narrators: [],
        filePath: normalizedFiles.find((file) => file.filePath)?.filePath ?? null,
        fileHash: null,
        files: normalizedFiles,
        genres: [],
        tags,
        presentFields: METADATA_FIELDS.filter((field) => metadata[field] !== null),
      };
      const filesByFormat = groupBy(
        normalizedFiles.filter((file): file is SourceBookFile & { format: string } => typeof file.format === 'string'),
        (file) => file.format,
      );
      books.push(sourceBook);
      contexts.set(sourceBookId, { sourceBook, filesByFormat });
    }

    const progressCandidates = [
      ...normalizeWebProgress(records, contexts, sourceUserIds, counters),
      ...normalizeKoboProgress(records, contexts, sourceUserIds, counters),
      ...normalizeKoreaderProgress(records, contexts, sourceUserIds, counters),
    ];
    const userFileProgress = mergeProgress(progressCandidates);
    const userBookStatuses = normalizeStatuses(records.statuses, contexts, sourceUserIds, userFileProgress, counters);
    const { shelves, shelfBooks } = normalizeShelves(records, contexts, sourceUserIds, counters);

    const availableDomains: SourceExportDomains = {
      metadata: true,
      authors: records.capabilities.authors,
      narrators: false,
      genres: false,
      tags: records.capabilities.tags,
      userBookStatuses: records.capabilities.userBookStatuses,
      readingProgress: records.capabilities.webProgress || records.capabilities.koboProgress || records.capabilities.koreaderProgress,
      readingSessions: false,
      bookmarks: false,
      annotations: false,
      shelves: records.capabilities.shelves,
      covers: false,
    };
    const counterValues = counters.values();
    const warnings = [
      ...compatibilityWarnings,
      ...Object.entries(counterValues).map(([category, count]) => `${count} source rows reported ${category.replaceAll('_', ' ')}`),
    ];

    return {
      data: {
        users,
        books,
        userBookStatuses,
        userFileProgress,
        readingSessions: [],
        bookmarks: [],
        annotations: [],
        shelves,
        shelfBooks,
        availableDomains,
      },
      sourceVersion: records.sourceVersion,
      pathPrefixes: logicalRoots,
      warnings,
      counters: counterValues,
    };
  }
}

function normalizeLogicalRoots(records: CalibreWebAutomatedSourceRecords, counters: CounterCollector): string[] {
  if (!records.capabilities.settings) return [];
  const roots = new Set<string>();
  for (const settings of [...records.settings].sort((left, right) => left.id - right.id)) {
    const rawRoot = settings.splitLibrary ? settings.splitDirectory : settings.calibreDirectory;
    const root = normalizeLogicalRoot(rawRoot);
    if (!root) {
      counters.add('unsafe_logical_roots');
      continue;
    }
    roots.add(root);
  }
  if (roots.size > 1) {
    counters.add('multiple_logical_roots');
    return [];
  }
  return [...roots];
}

function normalizeLogicalRoot(value: string | null): string | null {
  const root = normalizeText(value);
  if (!root || root.includes('\\') || root.includes('\0') || !posix.isAbsolute(root)) return null;
  if (root.split('/').some((component) => component === '..')) return null;
  const normalized = posix.normalize(root);
  return normalized === '/' ? '/' : normalized.replace(/\/$/, '');
}

function normalizeFiles(
  sourceBookId: string,
  book: CalibreWebAutomatedBookRecord,
  records: CalibreWebAutomatedFileRecord[],
  logicalRoot: string | null,
  counters: CounterCollector,
): SourceBookFile[] {
  const bookPath = normalizeBookPath(book.path);
  if (!bookPath) counters.add('unsafe_book_paths');
  return [...records]
    .sort((left, right) => left.id - right.id || left.format.localeCompare(right.format) || left.name.localeCompare(right.name))
    .map((record, sortOrder) => {
      const format = normalizeFormat(record.format);
      const baseName = normalizeFileBaseName(record.name);
      if (!format) counters.add('unsafe_file_formats');
      if (!baseName) counters.add('unsafe_file_names');
      const fileName = format && baseName ? `${baseName}.${format}` : null;
      const fileSubPath = fileName && bookPath ? posix.join(bookPath, fileName) : null;
      const candidatePath = logicalRoot && fileSubPath ? posix.join(logicalRoot, fileSubPath) : null;
      const filePath = candidatePath && isContainedLogicalPath(logicalRoot!, candidatePath) ? candidatePath : null;
      return {
        sourceFileId: `${sourceBookId}:${record.id}`,
        sourceBookId,
        filePath,
        fileHash: null,
        fileName,
        fileSubPath,
        durationSeconds: null,
        format,
        sortOrder,
      };
    });
}

function normalizeBookPath(value: string): string | null {
  if (!value || value !== value.trim() || value.includes('\\') || value.includes('\0') || posix.isAbsolute(value)) return null;
  const components = value.split('/');
  if (components.some((component) => !component || component === '.' || component === '..')) return null;
  return components.join('/');
}

function normalizeFileBaseName(value: string): string | null {
  if (!value || value !== value.trim() || value.includes('/') || value.includes('\\') || value.includes('\0') || value === '.' || value === '..') {
    return null;
  }
  return value;
}

function normalizeFormat(value: string): string | null {
  const format = value.trim().toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(format) ? format : null;
}

function isContainedLogicalPath(root: string, candidate: string): boolean {
  return root === '/' ? candidate.startsWith('/') : candidate.startsWith(`${root}/`);
}

function normalizeAuthors(
  book: CalibreWebAutomatedBookRecord,
  records: CalibreWebAutomatedAuthorLinkRecord[],
  counters: CounterCollector,
): SourceContributor[] {
  const byId = new Map<number, CalibreWebAutomatedAuthorLinkRecord>();
  for (const record of [...records].sort((left, right) => left.id - right.id)) {
    if (byId.has(record.authorId)) {
      counters.add('duplicate_author_links');
      continue;
    }
    byId.set(record.authorId, record);
  }
  const fallback = [...byId.values()];
  const fragments =
    book.authorSort
      ?.split('&')
      .map((fragment) => fragment.trim())
      .filter(Boolean) ?? [];
  let ordered = fallback;
  if (fragments.length > 0) {
    const selected: CalibreWebAutomatedAuthorLinkRecord[] = [];
    const selectedIds = new Set<number>();
    let exact = true;
    for (const fragment of fragments) {
      const matches = fallback.filter((record) => record.sort?.trim() === fragment && !selectedIds.has(record.authorId));
      if (matches.length !== 1) {
        exact = false;
        break;
      }
      selected.push(matches[0]);
      selectedIds.add(matches[0].authorId);
    }
    if (exact) ordered = [...selected, ...fallback.filter((record) => !selectedIds.has(record.authorId))];
    else counters.add('ambiguous_author_order');
  }
  return ordered.map((record, displayOrder) => ({
    sourceContributorId: String(record.authorId),
    name: record.name.trim(),
    sortName: normalizeText(record.sort),
    description: null,
    displayOrder,
  }));
}

function selectSingleNamedValue(records: CalibreWebAutomatedNamedLinkRecord[], counters: CounterCollector, category: string): string | null {
  const values = normalizeNamedValues(records);
  if (values.length > 1) counters.add(category);
  return values[0] ?? null;
}

function selectLanguage(records: Array<CalibreWebAutomatedNamedLinkRecord & { itemOrder: number }>): string | null {
  return (
    [...records].sort((left, right) => left.itemOrder - right.itemOrder || left.id - right.id).map((record) => normalizeText(record.value))[0] ?? null
  );
}

function selectRating(records: CalibreWebAutomatedRatingLinkRecord[], counters: CounterCollector): number | null {
  const ratings = [
    ...new Set(records.map((record) => record.rating).filter((rating) => Number.isInteger(rating) && rating >= 0 && rating <= 10)),
  ].sort((left, right) => left - right);
  if (ratings.length !== records.length) counters.add('invalid_ratings');
  if (ratings.length > 1) counters.add('multiple_ratings');
  const selected = ratings[0];
  return selected && selected >= 1 ? selected : null;
}

function selectSingleText(records: Array<{ id: number; text: string }>, counters: CounterCollector, category: string): string | null {
  const values = [...records]
    .sort((left, right) => left.id - right.id)
    .map((record) => normalizeText(record.text))
    .filter(isPresent);
  if (values.length > 1) counters.add(category);
  return values[0] ?? null;
}

function normalizeNamedValues(records: CalibreWebAutomatedNamedLinkRecord[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const record of [...records].sort((left, right) => left.id - right.id)) {
    const value = normalizeText(record.value);
    const key = value?.toLocaleLowerCase();
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return values;
}

function normalizeIdentifiers(records: CalibreWebAutomatedIdentifierRecord[], counters: CounterCollector): NormalizedIdentifiers {
  const isbnValues = new Set<string>();
  const asinValues = new Set<string>();
  const amazonValues = new Set<string>();
  const providerValues = new Map<'goodreadsId' | 'googleBooksId' | 'koboId' | 'hardcoverId', Set<string>>();
  for (const record of records) {
    const type = record.type.trim().toLowerCase();
    const value = record.value.trim();
    if (type === 'isbn') {
      const isbn = normalizeIsbn(value);
      if (isbn && ((isbn.length === 10 && isValidIsbn10(isbn)) || (isbn.length === 13 && isValidIsbn13(isbn)))) isbnValues.add(isbn);
      else counters.add('invalid_identifiers');
      continue;
    }
    if (type === 'asin' || AMAZON_IDENTIFIER_TYPES.has(type)) {
      const asin = normalizeAsin(value);
      if (!asin) {
        counters.add('invalid_identifiers');
        continue;
      }
      asinValues.add(asin);
      if (AMAZON_IDENTIFIER_TYPES.has(type)) amazonValues.add(asin);
      continue;
    }
    const field =
      type === 'goodreads'
        ? 'goodreadsId'
        : type === 'google'
          ? 'googleBooksId'
          : type === 'kobo'
            ? 'koboId'
            : type === 'hardcover' || type === 'hardcover_id'
              ? 'hardcoverId'
              : null;
    if (!field) continue;
    if (!value) {
      counters.add('invalid_identifiers');
      continue;
    }
    const values = providerValues.get(field) ?? new Set<string>();
    values.add(value);
    providerValues.set(field, values);
  }
  const isbn = uniqueValue(isbnValues, counters, 'conflicting_isbn_identifiers');
  const asin = uniqueValue(asinValues, counters, 'conflicting_asin_identifiers');
  const amazonId = asin && amazonValues.has(asin) ? asin : null;
  return {
    isbn10: isbn?.length === 10 ? isbn : null,
    isbn13: isbn?.length === 13 ? isbn : null,
    asin,
    amazonId,
    goodreadsId: uniqueValue(providerValues.get('goodreadsId'), counters, 'conflicting_goodreads_identifiers'),
    googleBooksId: uniqueValue(providerValues.get('googleBooksId'), counters, 'conflicting_google_identifiers'),
    koboId: uniqueValue(providerValues.get('koboId'), counters, 'conflicting_kobo_identifiers'),
    hardcoverId: uniqueValue(providerValues.get('hardcoverId'), counters, 'conflicting_hardcover_identifiers'),
  };
}

function emptyIdentifiers(): NormalizedIdentifiers {
  return { isbn10: null, isbn13: null, asin: null, amazonId: null, goodreadsId: null, googleBooksId: null, koboId: null, hardcoverId: null };
}

function uniqueValue(values: Set<string> | undefined, counters: CounterCollector, conflictCategory: string): string | null {
  if (!values || values.size === 0) return null;
  if (values.size > 1) {
    counters.add(conflictCategory);
    return null;
  }
  return [...values][0];
}

function normalizeAsin(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(normalized) ? normalized : null;
}

function normalizePublishedYear(value: string | null, counters: CounterCollector): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    counters.add('invalid_published_dates');
    return null;
  }
  const year = date.getUTCFullYear();
  if (year === 101) return null;
  if (year < 1000 || year > 2200) {
    counters.add('invalid_published_dates');
    return null;
  }
  return year;
}

function normalizeWebProgress(
  records: CalibreWebAutomatedSourceRecords,
  contexts: Map<string, BookContext>,
  sourceUserIds: Set<string>,
  counters: CounterCollector,
): ProgressCandidate[] {
  if (!records.capabilities.webProgress) return [];
  const candidates: ProgressCandidate[] = [];
  for (const record of records.webProgress) {
    const sourceUserId = String(record.userId);
    const sourceBookId = String(record.bookId);
    const context = contexts.get(sourceBookId);
    if (!sourceUserIds.has(sourceUserId) || !context) {
      counters.add('orphaned_web_progress');
      continue;
    }
    const format = normalizeFormat(record.format);
    const file = format ? resolveUniqueFile(context, format, counters, 'ambiguous_web_progress_files') : null;
    if (!format || !file) {
      counters.add('unresolved_web_progress');
      continue;
    }
    const base = progressBase(sourceUserId, sourceBookId, file.sourceFileId, 'web', record.id);
    if (format === 'epub') {
      if (!isValidEpubCfi(record.bookmarkKey)) {
        counters.add('invalid_web_cfi');
        continue;
      }
      candidates.push({ ...base, cfi: record.bookmarkKey.trim() });
      continue;
    }
    if (CWA_AUDIO_FORMATS.has(format)) {
      if (!isAudioFormat(format)) {
        counters.add('unsupported_cwa_audio_formats');
        continue;
      }
      const milliseconds = parseNonNegativeNumber(record.bookmarkKey);
      if (milliseconds == null) {
        counters.add('invalid_web_audio_positions');
        continue;
      }
      candidates.push({ ...base, positionSeconds: milliseconds / 1000 });
      continue;
    }
    if (CWA_COMIC_FORMATS.has(format)) {
      if (!isComicFormat(format)) {
        counters.add('unsupported_cwa_comic_formats');
        continue;
      }
      const pageIndex = parseNonNegativeInteger(record.bookmarkKey);
      if (pageIndex == null) {
        counters.add('invalid_web_page_numbers');
        continue;
      }
      candidates.push({ ...base, pageNumber: pageIndex + 1 });
      continue;
    }
    counters.add('unsupported_web_formats');
  }
  return candidates;
}

function progressBase(sourceUserId: string, sourceBookId: string, sourceFileId: string, source: ProgressSource, sequence: number): ProgressCandidate {
  return {
    sourceUserId,
    sourceBookId,
    sourceFileId,
    percentage: null,
    cfi: null,
    pageNumber: null,
    positionSeconds: null,
    updatedAt: null,
    source,
    sequence,
  };
}

function normalizeKoboProgress(
  records: CalibreWebAutomatedSourceRecords,
  contexts: Map<string, BookContext>,
  sourceUserIds: Set<string>,
  counters: CounterCollector,
): ProgressCandidate[] {
  if (!records.capabilities.koboProgress) return [];
  const bookmarksByState = groupBy(records.koboBookmarks, (record) => record.readingStateId);
  const candidates: ProgressCandidate[] = [];
  for (const state of records.koboReadingStates) {
    const sourceUserId = String(state.userId);
    const sourceBookId = String(state.bookId);
    const context = contexts.get(sourceBookId);
    if (!sourceUserIds.has(sourceUserId) || !context) {
      counters.add('orphaned_kobo_progress');
      continue;
    }
    const bookmark = selectKoboBookmark(bookmarksByState.get(state.id) ?? []);
    if (!bookmark) continue;
    const preferredFormat = context.filesByFormat.has('kepub') ? 'kepub' : 'epub';
    const file = resolveUniqueFile(context, preferredFormat, counters, 'ambiguous_kobo_progress_files');
    if (!file) {
      counters.add('unresolved_kobo_progress');
      continue;
    }
    let percentage = normalizePercentage(bookmark.progressPercent);
    if (bookmark.progressPercent != null && percentage == null) counters.add('invalid_kobo_percentages');
    if (percentage == null) {
      percentage = normalizePercentage(bookmark.contentSourceProgressPercent);
      if (bookmark.contentSourceProgressPercent != null && percentage == null) counters.add('invalid_kobo_percentages');
    }
    const candidate = progressBase(sourceUserId, sourceBookId, file.sourceFileId, 'kobo', bookmark.id);
    candidate.percentage = percentage;
    candidate.updatedAt = normalizeTimestamp(bookmark.lastModified ?? state.priorityTimestamp ?? state.lastModified);
    candidate.cfi = isEpubCompatible(file.format) && isValidEpubCfi(bookmark.locationValue) ? bookmark.locationValue!.trim() : null;
    if (percentage == null && !candidate.cfi) {
      counters.add('invalid_kobo_progress');
      continue;
    }
    candidates.push(candidate);
  }
  return candidates;
}

function selectKoboBookmark(records: CalibreWebAutomatedKoboBookmarkRecord[]): CalibreWebAutomatedKoboBookmarkRecord | null {
  return [...records].sort((left, right) => compareTimestamps(right.lastModified, left.lastModified) || right.id - left.id)[0] ?? null;
}

function normalizeKoreaderProgress(
  records: CalibreWebAutomatedSourceRecords,
  contexts: Map<string, BookContext>,
  sourceUserIds: Set<string>,
  counters: CounterCollector,
): ProgressCandidate[] {
  if (!records.capabilities.koreaderProgress) return [];
  const checksums = groupBy(records.checksums, (record) => record.checksum);
  const candidates: ProgressCandidate[] = [];
  for (const record of records.koreaderProgress) {
    const sourceUserId = String(record.userId);
    if (!sourceUserIds.has(sourceUserId)) {
      counters.add('orphaned_koreader_progress');
      continue;
    }
    const matches = checksums.get(record.document) ?? [];
    const targets = new Map(matches.map((match) => [`${match.bookId}\0${match.format.trim().toLowerCase()}`, match]));
    if (targets.size === 0) {
      counters.add('orphaned_koreader_checksums');
      continue;
    }
    if (targets.size > 1) {
      counters.add('ambiguous_koreader_checksums');
      continue;
    }
    const target = [...targets.values()][0];
    const sourceBookId = String(target.bookId);
    const context = contexts.get(sourceBookId);
    const format = normalizeFormat(target.format);
    const file = context && format ? resolveUniqueFile(context, format, counters, 'ambiguous_koreader_progress_files') : null;
    if (!context || !file) {
      counters.add('unresolved_koreader_progress');
      continue;
    }
    const percentage = normalizePercentage(record.percentage);
    if (percentage == null) {
      counters.add('invalid_koreader_percentages');
      continue;
    }
    const candidate = progressBase(sourceUserId, sourceBookId, file.sourceFileId, 'koreader', record.id);
    candidate.percentage = percentage;
    candidate.updatedAt = normalizeTimestamp(record.timestamp);
    candidate.cfi = isEpubCompatible(format) && isValidEpubCfi(record.progress) ? record.progress.trim() : null;
    candidates.push(candidate);
  }
  return candidates;
}

function mergeProgress(candidates: ProgressCandidate[]): SourceUserFileProgress[] {
  const groups = groupBy(candidates, (candidate) => `${candidate.sourceUserId}\0${candidate.sourceBookId}\0${candidate.sourceFileId ?? ''}`);
  const merged: SourceUserFileProgress[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort(compareProgressCandidates);
    const selected = ordered[0];
    const percentageSource = ordered.find((candidate) => candidate.percentage != null);
    const webLocator = ordered.find(
      (candidate) => candidate.source === 'web' && (candidate.cfi != null || candidate.positionSeconds != null || candidate.pageNumber != null),
    );
    merged.push({
      sourceUserId: selected.sourceUserId,
      sourceBookId: selected.sourceBookId,
      sourceFileId: selected.sourceFileId,
      percentage: percentageSource?.percentage ?? null,
      cfi: selected.cfi ?? webLocator?.cfi ?? null,
      pageNumber: selected.pageNumber ?? webLocator?.pageNumber ?? null,
      positionSeconds: selected.positionSeconds ?? webLocator?.positionSeconds ?? null,
      updatedAt: percentageSource?.updatedAt ?? selected.updatedAt,
    });
  }
  return merged.sort(
    (left, right) =>
      left.sourceUserId.localeCompare(right.sourceUserId) ||
      left.sourceBookId.localeCompare(right.sourceBookId) ||
      String(left.sourceFileId).localeCompare(String(right.sourceFileId)),
  );
}

function compareProgressCandidates(left: ProgressCandidate, right: ProgressCandidate): number {
  const leftTime = timestampValue(left.updatedAt);
  const rightTime = timestampValue(right.updatedAt);
  if (leftTime !== rightTime) return rightTime - leftTime;
  const priority = { web: 1, kobo: 2, koreader: 3 } satisfies Record<ProgressSource, number>;
  return priority[right.source] - priority[left.source] || right.sequence - left.sequence;
}

function normalizeStatuses(
  records: CalibreWebAutomatedStatusRecord[],
  contexts: Map<string, BookContext>,
  sourceUserIds: Set<string>,
  progress: SourceUserFileProgress[],
  counters: CounterCollector,
): SourceUserBookStatus[] {
  const validRecords: CalibreWebAutomatedStatusRecord[] = [];
  for (const record of records) {
    if (![0, 1, 2].includes(record.readStatus)) {
      counters.add('unknown_read_statuses');
      continue;
    }
    if (!sourceUserIds.has(String(record.userId)) || !contexts.has(String(record.bookId))) {
      counters.add('orphaned_statuses');
      continue;
    }
    validRecords.push(record);
  }
  const progressByBook = groupBy(progress, (record) => `${record.sourceUserId}\0${record.sourceBookId}`);
  const statuses: SourceUserBookStatus[] = [];
  for (const group of groupBy(validRecords, (record) => `${record.userId}\0${record.bookId}`).values()) {
    const record = [...group].sort((left, right) => compareTimestamps(right.lastModified, left.lastModified) || right.id - left.id)[0];
    if (group.length > 1) counters.add('duplicate_statuses');
    const sourceUserId = String(record.userId);
    const sourceBookId = String(record.bookId);
    const status = record.readStatus === 0 ? 'unread' : record.readStatus === 1 ? 'read' : 'reading';
    const bookProgress = selectBookProgress(progressByBook.get(`${sourceUserId}\0${sourceBookId}`) ?? []);
    statuses.push({
      sourceUserId,
      sourceBookId,
      status,
      percentage: status === 'read' ? 100 : status === 'unread' ? 0 : (bookProgress?.percentage ?? null),
      startedAt: normalizeTimestamp(record.lastTimeStartedReading),
      finishedAt: status === 'read' ? normalizeTimestamp(record.lastModified) : null,
      updatedAt: normalizeTimestamp(record.lastModified),
    });
  }
  return statuses;
}

function selectBookProgress(records: SourceUserFileProgress[]): SourceUserFileProgress | null {
  return (
    [...records]
      .filter((record) => record.percentage != null)
      .sort((left, right) => {
        const leftTime = timestampValue(left.updatedAt);
        const rightTime = timestampValue(right.updatedAt);
        if (leftTime !== rightTime) return rightTime - leftTime;
        return (right.percentage ?? -1) - (left.percentage ?? -1);
      })[0] ?? null
  );
}

function normalizeShelves(
  records: CalibreWebAutomatedSourceRecords,
  contexts: Map<string, BookContext>,
  sourceUserIds: Set<string>,
  counters: CounterCollector,
): { shelves: Array<{ sourceShelfId: string; sourceUserId: string; name: string }>; shelfBooks: SourceShelfBook[] } {
  if (!records.capabilities.shelves) return { shelves: [], shelfBooks: [] };
  const shelves = records.shelves.flatMap((record) => {
    const sourceUserId = String(record.userId);
    if (!sourceUserIds.has(sourceUserId)) {
      counters.add('orphaned_shelves');
      return [];
    }
    if (record.isPublic) counters.add('public_shelves_privatized');
    return [{ sourceShelfId: String(record.id), sourceUserId, name: record.name.trim() }];
  });
  const shelvesById = new Map(shelves.map((shelf) => [shelf.sourceShelfId, shelf]));
  const shelfBooks: SourceShelfBook[] = [];
  for (const [shelfId, group] of groupBy(records.shelfBooks, (record) => String(record.shelfId))) {
    const shelf = shelvesById.get(shelfId);
    if (!shelf) continue;
    const positionCounts = new Map<number, number>();
    for (const record of group) {
      if (isNonNegativeInteger(record.position)) positionCounts.set(record.position, (positionCounts.get(record.position) ?? 0) + 1);
    }
    const normalized = group.map((record) => ({
      record,
      position: isNonNegativeInteger(record.position) && positionCounts.get(record.position) === 1 ? record.position : null,
    }));
    normalized.sort((left, right) => {
      if (left.position != null && right.position != null) return left.position - right.position || left.record.id - right.record.id;
      if (left.position != null) return -1;
      if (right.position != null) return 1;
      return left.record.id - right.record.id;
    });
    const seenBooks = new Set<string>();
    for (const { record, position } of normalized) {
      const sourceBookId = String(record.bookId);
      if (!contexts.has(sourceBookId)) {
        counters.add('orphaned_shelf_memberships');
        continue;
      }
      if (seenBooks.has(sourceBookId)) {
        counters.add('duplicate_shelf_memberships');
        continue;
      }
      seenBooks.add(sourceBookId);
      if (record.position != null && position == null) counters.add('invalid_shelf_positions');
      shelfBooks.push({ sourceShelfId: shelf.sourceShelfId, sourceUserId: shelf.sourceUserId, sourceBookId, position });
    }
  }
  return { shelves, shelfBooks };
}

function resolveUniqueFile(context: BookContext, format: string, counters: CounterCollector, category: string): SourceBookFile | null {
  const files = context.filesByFormat.get(format) ?? [];
  if (files.length > 1) counters.add(category);
  return files.length === 1 ? files[0] : null;
}

function isEpubCompatible(format: string | null | undefined): boolean {
  return format === 'epub' || format === 'kepub';
}

function isValidEpubCfi(value: string | null): boolean {
  const cfi = normalizeText(value);
  if (!cfi || !/^epubcfi\(.+\)$/.test(cfi) || /[\0\r\n]/.test(cfi)) return false;
  let depth = 0;
  for (let index = 'epubcfi'.length; index < cfi.length; index += 1) {
    const character = cfi[index];
    if (character === '^') {
      index += 1;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function normalizePercentage(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < -0.000001 || value > 100.000001) return null;
  return Math.max(0, Math.min(100, value));
}

function parseNonNegativeNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseNonNegativeInteger(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isNonNegativeInteger(value: number | null): value is number {
  return Number.isSafeInteger(value) && value! >= 0;
}

function normalizeTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function compareTimestamps(left: string | null, right: string | null): number {
  return timestampValue(left) - timestampValue(right);
}

function timestampValue(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function normalizeText(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function groupBy<T, K>(values: T[], key: (value: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey) ?? [];
    group.push(value);
    groups.set(groupKey, group);
  }
  return groups;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

class CounterCollector {
  private readonly counts = new Map<string, number>();

  constructor(entries: Array<[string, number]> = []) {
    for (const [category, count] of entries) this.add(category, count);
  }

  add(category: string, count = 1): void {
    if (!this.counts.has(category) && this.counts.size >= MAX_WARNING_CATEGORIES) return;
    this.counts.set(category, (this.counts.get(category) ?? 0) + count);
  }

  values(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}
