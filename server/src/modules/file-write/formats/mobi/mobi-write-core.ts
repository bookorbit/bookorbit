import { MOBI_BOOK_FILE_WRITE_FIELDS } from '@bookorbit/types';

import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { buildCoverImages, resolveCoverSlots } from './mobi-cover';
import {
  EXTH_AUTHOR,
  EXTH_DESCRIPTION,
  EXTH_ISBN,
  EXTH_KF8_BOUNDARY,
  EXTH_LANGUAGE,
  EXTH_PUBLISHED_DATE,
  EXTH_PUBLISHER,
  EXTH_SUBJECT,
  EXTH_UPDATED_TITLE,
  readExthUint32,
  stripManagedRecords,
  type ExthRecord,
} from './mobi-exth';
import { isMobiHeaderRecord, MOBI_FILE_VERSION_KF8, readMobiHeaderRecord, rebuildHeaderRecord, type MobiHeaderRecord } from './mobi-header-record';
import { encodeMobiText } from './mobi-text-encoding';
import { assertWritablePalmDb, patchRecordsInPlace, readRecordOffsets, rebuildWithRecords, sliceRecord } from './palmdb';

// EXTH types this writer owns. Everything else in the source block, including the
// cover/thumbnail offsets and the KF8 resource bookkeeping, is preserved verbatim.
const MANAGED_EXTH_TYPES: ReadonlySet<number> = new Set([
  EXTH_AUTHOR,
  EXTH_PUBLISHER,
  EXTH_DESCRIPTION,
  EXTH_ISBN,
  EXTH_SUBJECT,
  EXTH_PUBLISHED_DATE,
  EXTH_UPDATED_TITLE,
  EXTH_LANGUAGE,
]);

const KF8_BOUNDARY_ABSENT = 0xffffffff;
const SUBJECT_SEPARATOR = '; ';

const MOBI_WRITABLE_FIELDS: ReadonlySet<BookWritePayloadKey> = new Set(MOBI_BOOK_FILE_WRITE_FIELDS);

export type MobiWriteMode = 'in-place' | 'rewrite';

export interface MobiWriteOutcome {
  buffer: Buffer;
  fieldsWritten: BookWritePayloadKey[];
  mode: MobiWriteMode;
  /** Characters replaced with "?" because the file's encoding cannot represent them. */
  lossyChars: number;
  patchedHeaderRecords: number[];
}

export async function writeMobiMetadata(
  source: Buffer,
  payload: BookWritePayload,
  fieldMask: ReadonlySet<BookWritePayloadKey>,
): Promise<MobiWriteOutcome> {
  assertWritablePalmDb(source);
  const offsets = readRecordOffsets(source);
  const recordAt = (index: number) => sliceRecord(source, offsets, index);

  const mainHeader = readMobiHeaderRecord(recordAt(0));
  const headerIndices = resolveHeaderRecordIndices(mainHeader, offsets.length, recordAt);

  const fieldsWritten = new Set<BookWritePayloadKey>();
  const replacements = new Map<number, Buffer>();
  let lossyChars = 0;
  let requiresRewrite = false;

  for (const index of headerIndices) {
    const record = recordAt(index);
    const header = index === 0 ? mainHeader : readMobiHeaderRecord(record);
    const built = buildManagedExthRecords(payload, fieldMask, header.encoding);
    lossyChars += built.lossyChars;
    for (const field of built.fieldsWritten) fieldsWritten.add(field);

    const exthRecords = [...stripManagedRecords(header.exthRecords, MANAGED_EXTH_TYPES), ...built.records];
    const fullName = built.fullName ?? header.fullName;
    const rebuilt = rebuildHeaderRecord(record, exthRecords, fullName);

    if (!rebuilt.fitsOriginalSize) requiresRewrite = true;
    replacements.set(index, rebuilt.record);
  }

  if (shouldWriteCover(payload, fieldMask)) {
    const slots = resolveCoverSlots(mainHeader.exthRecords, mainHeader.firstImageIndex, offsets.length, recordAt);
    if (slots) {
      const images = await buildCoverImages(payload.coverBytes!);
      replacements.set(slots.coverIndex, images.cover);
      if (slots.thumbnailIndex !== null) replacements.set(slots.thumbnailIndex, images.thumbnail);
      fieldsWritten.add('coverBytes');
      requiresRewrite = true;
    }
  }

  const buffer = requiresRewrite ? rebuildWithRecords(source, offsets, replacements) : patchRecordsInPlace(source, offsets, replacements);

  return {
    buffer,
    fieldsWritten: [...fieldsWritten],
    mode: requiresRewrite ? 'rewrite' : 'in-place',
    lossyChars,
    patchedHeaderRecords: headerIndices,
  };
}

/**
 * Dual-format files carry a second MOBI header for the KF8 half. EXTH 121 only marks
 * that boundary inside a MOBI6 header; KF8-only files also carry a 121 record but it
 * points at an ordinary text or resource record, so following it there would corrupt
 * the book.
 */
function resolveHeaderRecordIndices(mainHeader: MobiHeaderRecord, recordCount: number, recordAt: (index: number) => Buffer): number[] {
  if (mainHeader.fileVersion >= MOBI_FILE_VERSION_KF8) return [0];

  const boundary = readExthUint32(mainHeader.exthRecords, EXTH_KF8_BOUNDARY);
  if (boundary === null || boundary === KF8_BOUNDARY_ABSENT || boundary <= 0 || boundary >= recordCount) return [0];
  if (!isMobiHeaderRecord(recordAt(boundary))) return [0];

  return [0, boundary];
}

function shouldWriteCover(payload: BookWritePayload, fieldMask: ReadonlySet<BookWritePayloadKey>): boolean {
  return Boolean(payload.coverBytes?.length) && isWritable('coverBytes', fieldMask);
}

function isWritable(field: BookWritePayloadKey, fieldMask: ReadonlySet<BookWritePayloadKey>): boolean {
  return MOBI_WRITABLE_FIELDS.has(field) && fieldMask.has(field);
}

interface ManagedExthResult {
  records: ExthRecord[];
  fieldsWritten: BookWritePayloadKey[];
  fullName: Buffer | null;
  lossyChars: number;
}

function buildManagedExthRecords(payload: BookWritePayload, fieldMask: ReadonlySet<BookWritePayloadKey>, encoding: number): ManagedExthResult {
  const records: ExthRecord[] = [];
  const fieldsWritten: BookWritePayloadKey[] = [];
  let fullName: Buffer | null = null;
  let lossyChars = 0;

  const emit = (type: number, value: string): Buffer => {
    const encoded = encodeMobiText(value, encoding);
    lossyChars += encoded.lossyChars;
    records.push({ type, data: encoded.buffer });
    return encoded.buffer;
  };

  const title = readText(payload.title);
  if (title !== null && isWritable('title', fieldMask)) {
    fullName = emit(EXTH_UPDATED_TITLE, title);
    fieldsWritten.push('title');
  }

  const authors = (payload.authors ?? []).map((author) => author.name.trim()).filter(Boolean);
  if (authors.length > 0 && isWritable('authors', fieldMask)) {
    for (const author of authors) emit(EXTH_AUTHOR, author);
    fieldsWritten.push('authors');
  }

  appendText(payload.publisher, 'publisher', EXTH_PUBLISHER);
  appendText(payload.description, 'description', EXTH_DESCRIPTION);
  appendText(payload.publishedDate, 'publishedDate', EXTH_PUBLISHED_DATE);
  appendText(payload.language, 'language', EXTH_LANGUAGE);

  // MOBI has a single ISBN slot; prefer the more specific identifier.
  const isbn13 = readText(payload.isbn13);
  const isbn10 = readText(payload.isbn10);
  if (isbn13 !== null && isWritable('isbn13', fieldMask)) {
    emit(EXTH_ISBN, isbn13);
    fieldsWritten.push('isbn13');
  } else if (isbn10 !== null && isWritable('isbn10', fieldMask)) {
    emit(EXTH_ISBN, isbn10);
    fieldsWritten.push('isbn10');
  }

  // Genres and tags share EXTH 105; calibre writes them as one separated string and
  // the in-repo parser splits on the same separator.
  const subjects: string[] = [];
  const genres = cleanList(payload.genres);
  const tags = cleanList(payload.tags);
  if (genres.length > 0 && isWritable('genres', fieldMask)) {
    subjects.push(...genres);
    fieldsWritten.push('genres');
  }
  if (tags.length > 0 && isWritable('tags', fieldMask)) {
    subjects.push(...tags);
    fieldsWritten.push('tags');
  }
  if (subjects.length > 0) emit(EXTH_SUBJECT, [...new Set(subjects)].join(SUBJECT_SEPARATOR));

  return { records, fieldsWritten, fullName, lossyChars };

  function appendText(value: string | null | undefined, field: BookWritePayloadKey, type: number): void {
    const text = readText(value);
    if (text === null || !isWritable(field, fieldMask)) return;
    emit(type, text);
    fieldsWritten.push(field);
  }
}

function readText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}
