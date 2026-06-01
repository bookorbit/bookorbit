import { ConflictException, Injectable } from '@nestjs/common';
import { BOOK_METADATA_LOCK_FIELDS, MetadataProviderKey, type BookMetadataLockField, type ComicMetadataFields } from '@bookorbit/types';

import { UpdateBookMetadataDto } from '../book/dto/update-book-metadata.dto';
import type { ResolvedMetadataFields } from '../metadata-fetch/metadata-fetch-pipeline';
import { BookMetadataLockRepository } from './book-metadata-lock.repository';

const LOCK_FIELD_SET = new Set<string>(BOOK_METADATA_LOCK_FIELDS);
const LOCK_FIELD_ORDER = new Map<BookMetadataLockField, number>(BOOK_METADATA_LOCK_FIELDS.map((field, index) => [field, index]));

const PROVIDER_ID_LOCK_FIELDS_BY_PROVIDER: Partial<Record<MetadataProviderKey, BookMetadataLockField>> = {
  [MetadataProviderKey.GOOGLE]: 'googleBooksId',
  [MetadataProviderKey.GOODREADS]: 'goodreadsId',
  [MetadataProviderKey.AMAZON]: 'amazonId',
  [MetadataProviderKey.HARDCOVER]: 'hardcoverId',
  [MetadataProviderKey.OPEN_LIBRARY]: 'openLibraryId',
  [MetadataProviderKey.ITUNES]: 'itunesId',
  [MetadataProviderKey.AUDIBLE]: 'audibleId',
  [MetadataProviderKey.COMICVINE]: 'comicvineId',
  [MetadataProviderKey.RANOBEDB]: 'ranobedbId',
};

const COMIC_METADATA_LOCK_FIELDS: Record<keyof ComicMetadataFields, BookMetadataLockField> = {
  issueNumber: 'comicIssueNumber',
  volumeName: 'comicVolumeName',
  pencillers: 'comicPencillers',
  inkers: 'comicInkers',
  colorists: 'comicColorists',
  letterers: 'comicLetterers',
  coverArtists: 'comicCoverArtists',
  characters: 'comicCharacters',
  teams: 'comicTeams',
  locations: 'comicLocations',
  storyArcs: 'comicStoryArcs',
};

@Injectable()
export class BookMetadataLockService {
  constructor(private readonly lockRepo: BookMetadataLockRepository) {}

  normalizeLockedFields(fields: readonly string[] | null | undefined): BookMetadataLockField[] {
    if (!fields?.length) return [];

    const seen = new Set<BookMetadataLockField>();
    const normalized: BookMetadataLockField[] = [];
    for (const field of fields) {
      if (!LOCK_FIELD_SET.has(field)) continue;
      const typedField = field as BookMetadataLockField;
      if (seen.has(typedField)) continue;
      seen.add(typedField);
      normalized.push(typedField);
    }

    return normalized.sort(
      (left, right) => (LOCK_FIELD_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) - (LOCK_FIELD_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  async getLockedFields(bookId: number): Promise<BookMetadataLockField[]> {
    return this.normalizeLockedFields(await this.lockRepo.findLockedFields(bookId));
  }

  async isFieldLocked(bookId: number, field: BookMetadataLockField): Promise<boolean> {
    const fields = await this.lockRepo.findLockedFields(bookId);
    return fields.includes(field);
  }

  async replaceLockedFields(
    bookId: number,
    lockedFields: readonly string[],
    executor?: Parameters<BookMetadataLockRepository['replaceLockedFields']>[2],
  ): Promise<BookMetadataLockField[]> {
    const normalized = this.normalizeLockedFields(lockedFields);
    await this.lockRepo.replaceLockedFields(bookId, normalized, executor);
    return normalized;
  }

  async bulkReplaceLockedFields(bookIds: number[], lockedFields: BookMetadataLockField[]): Promise<void> {
    await this.lockRepo.bulkReplaceLockedFields(bookIds, lockedFields);
  }

  async getCoverLockedBookIds(bookIds: number[]): Promise<Set<number>> {
    const fieldsMap = await this.lockRepo.findLockedFieldsByBookIds(bookIds);
    const locked = new Set<number>();
    for (const [bookId, fields] of fieldsMap) {
      if (fields.includes('cover')) locked.add(bookId);
    }
    return locked;
  }

  async getBookIdsWithLockedField(bookIds: number[], field: BookMetadataLockField): Promise<Set<number>> {
    const fieldsMap = await this.lockRepo.findLockedFieldsByBookIds(bookIds);
    const locked = new Set<number>();
    for (const [bookId, fields] of fieldsMap) {
      if (fields.includes(field)) locked.add(bookId);
    }
    return locked;
  }

  async getLockedFieldsMap(bookIds: number[]): Promise<Map<number, string[]>> {
    return this.lockRepo.findLockedFieldsByBookIds(bookIds);
  }

  async assertFieldsUnlocked(bookId: number, fields: readonly BookMetadataLockField[]): Promise<void> {
    const lockedFields = await this.getLockedFields(bookId);
    const lockedSet = new Set(lockedFields);
    const blockedFields = fields.filter((field) => lockedSet.has(field));
    if (blockedFields.length === 0) return;

    throw new ConflictException(`Metadata fields are locked: ${blockedFields.join(', ')}`);
  }

  async assertManualUpdateAllowed(bookId: number, dto: UpdateBookMetadataDto): Promise<void> {
    await this.assertFieldsUnlocked(bookId, this.getFieldsTargetedByBookUpdate(dto));
  }

  async assertManualUpdateAllowedForLockTransition(bookId: number, dto: UpdateBookMetadataDto, nextLockedFields: readonly string[]): Promise<void> {
    const currentlyLocked = new Set(await this.getLockedFields(bookId));
    const nextLocked = new Set(this.normalizeLockedFields(nextLockedFields));
    const lockedBeforeAndAfter = [...currentlyLocked].filter((field) => nextLocked.has(field));
    const targetedFields = this.getFieldsTargetedByBookUpdate(dto);
    const blockedFields = targetedFields.filter((field) => lockedBeforeAndAfter.includes(field));
    if (blockedFields.length === 0) return;

    throw new ConflictException(`Metadata fields are locked: ${blockedFields.join(', ')}`);
  }

  async filterAutomatedBookUpdate(
    bookId: number,
    dto: UpdateBookMetadataDto,
  ): Promise<{ dto: UpdateBookMetadataDto; skippedFields: BookMetadataLockField[] }> {
    const lockedSet = new Set(await this.getLockedFields(bookId));
    return this.filterAutomatedBookUpdateWithLockedSet(dto, lockedSet);
  }

  async filterResolvedMetadata(
    bookId: number,
    resolved: ResolvedMetadataFields,
    providerIds: Partial<Record<MetadataProviderKey, string>>,
  ): Promise<{
    resolved: ResolvedMetadataFields;
    providerIds: Partial<Record<MetadataProviderKey, string>>;
    skippedFields: BookMetadataLockField[];
  }> {
    const lockedSet = new Set(await this.getLockedFields(bookId));
    const skippedFields = new Set<BookMetadataLockField>();
    const filteredResolved: ResolvedMetadataFields = {};

    this.copyResolvedField(filteredResolved, resolved, 'title', 'title', lockedSet, skippedFields);
    this.copyResolvedField(filteredResolved, resolved, 'subtitle', 'subtitle', lockedSet, skippedFields);
    this.copyResolvedField(filteredResolved, resolved, 'description', 'description', lockedSet, skippedFields);
    this.copyResolvedField(filteredResolved, resolved, 'authors', 'authors', lockedSet, skippedFields);
    this.copyResolvedField(filteredResolved, resolved, 'publisher', 'publisher', lockedSet, skippedFields);
    this.copyResolvedField(filteredResolved, resolved, 'publishedYear', 'publishedYear', lockedSet, skippedFields);
    this.copyResolvedField(filteredResolved, resolved, 'language', 'language', lockedSet, skippedFields);
    this.copyResolvedField(filteredResolved, resolved, 'pageCount', 'pageCount', lockedSet, skippedFields);
    this.copyResolvedField(filteredResolved, resolved, 'seriesName', 'seriesName', lockedSet, skippedFields);
    this.copyResolvedField(filteredResolved, resolved, 'seriesIndex', 'seriesIndex', lockedSet, skippedFields);
    this.copyResolvedField(filteredResolved, resolved, 'genres', 'genres', lockedSet, skippedFields);
    this.copyResolvedField(filteredResolved, resolved, 'narrators', 'narrators', lockedSet, skippedFields);
    this.copyResolvedField(filteredResolved, resolved, 'duration', 'durationSeconds', lockedSet, skippedFields);
    this.copyResolvedField(filteredResolved, resolved, 'abridged', 'abridged', lockedSet, skippedFields);

    if (resolved.chapters !== undefined) {
      filteredResolved.chapters = resolved.chapters;
    }

    if (resolved.coverUrl !== undefined) {
      if (lockedSet.has('cover')) skippedFields.add('cover');
      else filteredResolved.coverUrl = resolved.coverUrl;
    }

    if (resolved.comicMetadata) {
      const filteredComicMetadata: Partial<Record<keyof ComicMetadataFields, ComicMetadataFields[keyof ComicMetadataFields]>> = {};
      let hasComicMetadata = false;

      for (const [comicKey, lockField] of Object.entries(COMIC_METADATA_LOCK_FIELDS) as [keyof ComicMetadataFields, BookMetadataLockField][]) {
        const value = resolved.comicMetadata[comicKey];
        if (value === undefined) continue;
        if (lockedSet.has(lockField)) {
          skippedFields.add(lockField);
          continue;
        }
        filteredComicMetadata[comicKey] = value as ComicMetadataFields[typeof comicKey];
        hasComicMetadata = true;
      }

      if (hasComicMetadata) {
        filteredResolved.comicMetadata = filteredComicMetadata as ComicMetadataFields;
      }
    }

    const filteredProviderIds: Partial<Record<MetadataProviderKey, string>> = {};
    for (const [providerKey, providerId] of Object.entries(providerIds) as [MetadataProviderKey, string][]) {
      if (!providerId) continue;
      const lockField = PROVIDER_ID_LOCK_FIELDS_BY_PROVIDER[providerKey];
      if (lockField && lockedSet.has(lockField)) {
        skippedFields.add(lockField);
        continue;
      }
      filteredProviderIds[providerKey] = providerId;
    }

    return {
      resolved: filteredResolved,
      providerIds: filteredProviderIds,
      skippedFields: this.normalizeLockedFields([...skippedFields]),
    };
  }

  private filterAutomatedBookUpdateWithLockedSet(
    dto: UpdateBookMetadataDto,
    lockedSet: ReadonlySet<BookMetadataLockField>,
  ): { dto: UpdateBookMetadataDto; skippedFields: BookMetadataLockField[] } {
    const filteredDto: UpdateBookMetadataDto = {};
    const skippedFields = new Set<BookMetadataLockField>();

    this.copyUpdateField(filteredDto, dto, 'title', 'title', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'subtitle', 'subtitle', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'description', 'description', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'publisher', 'publisher', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'publishedYear', 'publishedYear', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'language', 'language', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'pageCount', 'pageCount', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'seriesName', 'seriesName', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'seriesIndex', 'seriesIndex', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'isbn10', 'isbn10', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'isbn13', 'isbn13', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'rating', 'rating', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'authors', 'authors', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'genres', 'genres', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'tags', 'tags', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'googleBooksId', 'googleBooksId', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'goodreadsId', 'goodreadsId', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'amazonId', 'amazonId', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'hardcoverId', 'hardcoverId', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'openLibraryId', 'openLibraryId', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'itunesId', 'itunesId', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'audibleId', 'audibleId', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'comicvineId', 'comicvineId', lockedSet, skippedFields);
    this.copyUpdateField(filteredDto, dto, 'ranobedbId', 'ranobedbId', lockedSet, skippedFields);

    if (dto.audioMetadata) {
      const filteredAudioMetadata: NonNullable<UpdateBookMetadataDto['audioMetadata']> = {};
      let hasAudioMetadata = false;

      if ('narrators' in dto.audioMetadata) {
        if (lockedSet.has('narrators')) skippedFields.add('narrators');
        else {
          filteredAudioMetadata.narrators = dto.audioMetadata.narrators;
          hasAudioMetadata = true;
        }
      }

      if ('durationSeconds' in dto.audioMetadata) {
        if (lockedSet.has('durationSeconds')) skippedFields.add('durationSeconds');
        else {
          filteredAudioMetadata.durationSeconds = dto.audioMetadata.durationSeconds;
          hasAudioMetadata = true;
        }
      }

      if ('abridged' in dto.audioMetadata) {
        if (lockedSet.has('abridged')) skippedFields.add('abridged');
        else {
          filteredAudioMetadata.abridged = dto.audioMetadata.abridged;
          hasAudioMetadata = true;
        }
      }

      if ('chapters' in dto.audioMetadata) {
        filteredAudioMetadata.chapters = dto.audioMetadata.chapters;
        hasAudioMetadata = true;
      }

      if (hasAudioMetadata) {
        filteredDto.audioMetadata = filteredAudioMetadata;
      }
    }

    if (dto.comicMetadata) {
      const filteredComicMetadata: Partial<Record<keyof ComicMetadataFields, ComicMetadataFields[keyof ComicMetadataFields]>> = {};
      let hasComicMetadata = false;

      for (const [comicKey, lockField] of Object.entries(COMIC_METADATA_LOCK_FIELDS) as [keyof ComicMetadataFields, BookMetadataLockField][]) {
        const value = dto.comicMetadata[comicKey];
        if (value === undefined) continue;
        if (lockedSet.has(lockField)) {
          skippedFields.add(lockField);
          continue;
        }
        filteredComicMetadata[comicKey] = value as ComicMetadataFields[typeof comicKey];
        hasComicMetadata = true;
      }

      if (hasComicMetadata) {
        filteredDto.comicMetadata = filteredComicMetadata as NonNullable<UpdateBookMetadataDto['comicMetadata']>;
      }
    }

    return {
      dto: filteredDto,
      skippedFields: this.normalizeLockedFields([...skippedFields]),
    };
  }

  private copyUpdateField(
    target: UpdateBookMetadataDto,
    source: UpdateBookMetadataDto,
    key: keyof UpdateBookMetadataDto,
    lockField: BookMetadataLockField,
    lockedSet: ReadonlySet<BookMetadataLockField>,
    skippedFields: Set<BookMetadataLockField>,
  ): void {
    if (source[key] === undefined) return;
    if (lockedSet.has(lockField)) {
      skippedFields.add(lockField);
      return;
    }
    target[key] = source[key] as never;
  }

  private copyResolvedField(
    target: ResolvedMetadataFields,
    source: ResolvedMetadataFields,
    key: keyof ResolvedMetadataFields,
    lockField: BookMetadataLockField,
    lockedSet: ReadonlySet<BookMetadataLockField>,
    skippedFields: Set<BookMetadataLockField>,
  ): void {
    if (source[key] === undefined) return;
    if (lockedSet.has(lockField)) {
      skippedFields.add(lockField);
      return;
    }
    target[key] = source[key] as never;
  }

  private getFieldsTargetedByBookUpdate(dto: UpdateBookMetadataDto): BookMetadataLockField[] {
    const fields = new Set<BookMetadataLockField>();

    this.addFieldIfPresent(fields, dto, 'title', 'title');
    this.addFieldIfPresent(fields, dto, 'subtitle', 'subtitle');
    this.addFieldIfPresent(fields, dto, 'description', 'description');
    this.addFieldIfPresent(fields, dto, 'publisher', 'publisher');
    this.addFieldIfPresent(fields, dto, 'publishedYear', 'publishedYear');
    this.addFieldIfPresent(fields, dto, 'language', 'language');
    this.addFieldIfPresent(fields, dto, 'pageCount', 'pageCount');
    this.addFieldIfPresent(fields, dto, 'seriesName', 'seriesName');
    this.addFieldIfPresent(fields, dto, 'seriesIndex', 'seriesIndex');
    this.addFieldIfPresent(fields, dto, 'isbn10', 'isbn10');
    this.addFieldIfPresent(fields, dto, 'isbn13', 'isbn13');
    this.addFieldIfPresent(fields, dto, 'rating', 'rating');
    this.addFieldIfPresent(fields, dto, 'authors', 'authors');
    this.addFieldIfPresent(fields, dto, 'genres', 'genres');
    this.addFieldIfPresent(fields, dto, 'tags', 'tags');
    this.addFieldIfPresent(fields, dto, 'googleBooksId', 'googleBooksId');
    this.addFieldIfPresent(fields, dto, 'goodreadsId', 'goodreadsId');
    this.addFieldIfPresent(fields, dto, 'amazonId', 'amazonId');
    this.addFieldIfPresent(fields, dto, 'hardcoverId', 'hardcoverId');
    this.addFieldIfPresent(fields, dto, 'openLibraryId', 'openLibraryId');
    this.addFieldIfPresent(fields, dto, 'itunesId', 'itunesId');
    this.addFieldIfPresent(fields, dto, 'audibleId', 'audibleId');
    this.addFieldIfPresent(fields, dto, 'comicvineId', 'comicvineId');
    this.addFieldIfPresent(fields, dto, 'ranobedbId', 'ranobedbId');

    if (dto.audioMetadata) {
      this.addFieldIfPresent(fields, dto.audioMetadata, 'narrators', 'narrators');
      this.addFieldIfPresent(fields, dto.audioMetadata, 'durationSeconds', 'durationSeconds');
      this.addFieldIfPresent(fields, dto.audioMetadata, 'abridged', 'abridged');
    }

    if (dto.comicMetadata) {
      for (const [comicKey, lockField] of Object.entries(COMIC_METADATA_LOCK_FIELDS) as [keyof ComicMetadataFields, BookMetadataLockField][]) {
        this.addFieldIfPresent(fields, dto.comicMetadata, comicKey, lockField);
      }
    }

    return this.normalizeLockedFields([...fields]);
  }

  private addFieldIfPresent<T extends object>(target: Set<BookMetadataLockField>, source: T, key: keyof T, field: BookMetadataLockField): void {
    if (source[key] !== undefined) {
      target.add(field);
    }
  }
}
