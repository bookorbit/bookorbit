import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { COVER_MEDIA, isAudioFormat, type BookCard, type BookCoverSlot, type CoverMedia, type CoverMedium } from '@bookorbit/types';
import { randomUUID } from 'crypto';
import { access, copyFile, cp, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import sharp from 'sharp';

import {
  COVER_CUSTOM_FILE_PREFIX,
  COVER_EXTRACTED_FILE_PREFIX,
  COVER_THUMBNAIL_FILE_NAME,
  bookCoverDirPath,
  bookCoverSlotDirPath,
  bookCoverSlotThumbnailPath,
  findPreferredBookCoverFileName,
  isCustomBookCoverFileName,
  isExtractedBookCoverFileName,
} from '../../common/book-cover-storage';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { generateThumbnail, imageExt, normalizeProgressiveJpeg } from '../metadata/lib/cover';
import { BookCoverEventsService } from './book-cover-events.service';
import { classifyCoverShape } from './cover-shape';
import {
  BookCoverStoreRepository,
  type BookCoverContext,
  type BookCoverOrigin,
  type BookCoverSlotRow,
  type BookCoverSource,
  type BookCoverSources,
} from './book-cover-store.repository';

export type CoverVariant = 'cover' | 'thumbnail';

type SaveOptions = {
  origin: BookCoverOrigin;
  overwrite?: boolean;
  backfill?: boolean;
  /** Writes only into an empty slot, or into an extracted slot whose origin is listed. */
  fill?: { replaceOrigins?: readonly BookCoverOrigin[] };
  skipIfUnchanged?: boolean;
};

type SlotStateOptions = { backfill?: boolean };

// A grid of books with missing thumbnails would otherwise resize every cover at once.
const THUMBNAIL_REPAIR_CONCURRENCY = 4;

@Injectable()
export class BookCoverStore {
  private readonly logger = new Logger(BookCoverStore.name);
  private readonly appDataPath: string;
  private readonly thumbnailRepairs = new Map<string, Promise<string | null>>();
  private readonly thumbnailRepairWaiters: Array<() => void> = [];
  private activeThumbnailRepairs = 0;
  private readonly conversions = new Map<number, Promise<{ converted: boolean; libraryId: number }>>();

  constructor(
    config: ConfigService,
    private readonly repository: BookCoverStoreRepository,
    private readonly events: BookCoverEventsService,
  ) {
    this.appDataPath = config.getOrThrow<string>('storage.appDataPath');
  }

  async resolve(bookId: number, options: { medium?: CoverMedium; variant: CoverVariant; strict?: boolean }): Promise<string | null> {
    const existing = await this.repository.findContext(bookId);
    if (!existing) return null;
    const context = await this.convertOnRead(existing);
    const activeSlots = new Map(
      context.slots
        .filter((slot) => slot.dormantSince === null && this.mediumIsActive(slot.medium as CoverMedium, context.media))
        .map((slot) => [slot.medium as CoverMedium, slot]),
    );
    const order = this.resolutionOrder(context, options.medium, options.strict === true);

    for (const medium of order) {
      if (!activeSlots.has(medium)) continue;
      const path = await this.resolveSlotArtifact(bookId, medium, options.variant);
      if (path) return path;
    }
    return null;
  }

  async saveExtracted(bookId: number, medium: CoverMedium, bytes: Buffer, options: SaveOptions): Promise<boolean> {
    const context = await this.convertedContext(bookId);
    if (this.isLocked(context, medium)) return false;
    const currentSlot = this.slotFor(context, medium);
    if (options.fill && currentSlot && !this.canFill(currentSlot, options.fill.replaceOrigins ?? [])) return false;
    const dir = bookCoverSlotDirPath(this.appDataPath, bookId, medium);
    if (options.skipIfUnchanged && currentSlot?.source === 'extracted' && currentSlot.dormantSince === null && (await this.servesBytes(dir, bytes))) {
      return false;
    }
    const dimensions = await this.measure(bytes);
    await mkdir(dir, { recursive: true });
    const files = await this.readDirIfExists(dir);
    const customFile = files.find(isCustomBookCoverFileName);
    const preserveCustom = options.overwrite !== true && currentSlot?.source === 'custom' && customFile !== undefined;
    const storedCustomMissing = options.overwrite !== true && currentSlot?.source === 'custom' && customFile === undefined;
    const replaceMissingCustom = storedCustomMissing && files.length > 0;

    if (preserveCustom) {
      await this.replaceCoverFile(dir, COVER_EXTRACTED_FILE_PREFIX, bytes);
      if (!files.includes(COVER_THUMBNAIL_FILE_NAME) && customFile) {
        await this.writeThumbnailAtomically(dir, await readFile(join(dir, customFile)));
      }
      this.emitChanged(context, options.backfill);
      return true;
    }

    await this.replaceServedArtifacts(dir, COVER_EXTRACTED_FILE_PREFIX, bytes);
    if (options.overwrite === true || replaceMissingCustom) await this.deleteFilesByPrefix(dir, COVER_CUSTOM_FILE_PREFIX);
    const now = new Date();
    await this.repository.applySlotMutation(
      bookId,
      medium,
      context.media,
      {
        kind: 'upsert',
        row: {
          source: 'extracted',
          origin: options.origin,
          width: dimensions.width,
          height: dimensions.height,
          updatedAt: now,
          dormantSince: null,
        },
      },
      { bumpBook: options.backfill !== true, servedBytesChanged: true, updatedAt: now },
    );
    this.emitChanged(context, options.backfill);
    return true;
  }

  async saveCustom(
    bookId: number,
    medium: CoverMedium,
    bytes: Buffer,
    options: { origin?: BookCoverOrigin; backfill?: boolean } = {},
  ): Promise<boolean> {
    const context = await this.convertedContext(bookId);
    if (this.isLocked(context, medium)) return false;
    let coverBytes: Buffer;
    try {
      coverBytes = await normalizeProgressiveJpeg(bytes);
      await sharp(coverBytes, { failOn: 'error' }).metadata();
    } catch {
      throw new BadRequestException('Invalid image file');
    }
    const dimensions = await this.measure(coverBytes);
    const dir = bookCoverSlotDirPath(this.appDataPath, bookId, medium);
    await mkdir(dir, { recursive: true });
    await this.replaceServedArtifacts(dir, COVER_CUSTOM_FILE_PREFIX, coverBytes);
    const now = new Date();
    await this.repository.applySlotMutation(
      bookId,
      medium,
      context.media,
      {
        kind: 'upsert',
        row: {
          source: 'custom',
          origin: options.origin ?? 'upload',
          width: dimensions.width,
          height: dimensions.height,
          updatedAt: now,
          dormantSince: null,
        },
      },
      { bumpBook: options.backfill !== true, servedBytesChanged: true, updatedAt: now },
    );
    this.events.emitChanged({ bookIds: [bookId], libraryId: context.libraryId });
    return true;
  }

  async revert(bookId: number, medium: CoverMedium, options: { backfill?: boolean } = {}): Promise<BookCoverSource | null> {
    const context = await this.convertedContext(bookId);
    if (this.isLocked(context, medium)) return (this.slotFor(context, medium)?.source as BookCoverSource | undefined) ?? null;
    const dir = bookCoverSlotDirPath(this.appDataPath, bookId, medium);
    const files = await this.readDirIfExists(dir);
    const extracted = files.find(isExtractedBookCoverFileName);
    const now = new Date();
    if (!extracted) {
      await this.deleteFilesByPrefix(dir, COVER_CUSTOM_FILE_PREFIX);
      await rm(bookCoverSlotThumbnailPath(this.appDataPath, bookId, medium), { force: true });
      await this.repository.applySlotMutation(
        bookId,
        medium,
        context.media,
        { kind: 'delete' },
        {
          bumpBook: options.backfill !== true,
          servedBytesChanged: true,
          updatedAt: now,
        },
      );
      this.events.emitChanged({ bookIds: [bookId], libraryId: context.libraryId });
      return null;
    }

    const bytes = await readFile(join(dir, extracted));
    const thumbnail = await generateThumbnail(bytes);
    const dimensions = await this.measure(bytes);
    await this.deleteFilesByPrefix(dir, COVER_CUSTOM_FILE_PREFIX);
    await this.writeThumbnailBytesAtomically(dir, thumbnail);
    const prior = this.slotFor(context, medium);
    await this.repository.applySlotMutation(
      bookId,
      medium,
      context.media,
      {
        kind: 'upsert',
        row: {
          source: 'extracted',
          origin: prior?.origin ?? 'embedded',
          width: dimensions.width,
          height: dimensions.height,
          updatedAt: now,
          dormantSince: null,
        },
      },
      { bumpBook: options.backfill !== true, servedBytesChanged: true, updatedAt: now },
    );
    this.events.emitChanged({ bookIds: [bookId], libraryId: context.libraryId });
    return 'extracted';
  }

  async markDormant(bookId: number, medium: CoverMedium, options: SlotStateOptions = {}): Promise<boolean> {
    const context = await this.requireContext(bookId);
    const slot = this.slotFor(context, medium);
    if (!slot || slot.dormantSince !== null) return false;
    const now = new Date();
    await this.repository.applySlotMutation(
      bookId,
      medium,
      context.media,
      { kind: 'upsert', row: { ...this.rowValues(slot), dormantSince: now } },
      { bumpBook: options.backfill !== true, servedBytesChanged: false, updatedAt: now, beforeMedia: this.withMedium(context.media, medium, true) },
    );
    this.emitChanged(context, options.backfill);
    return true;
  }

  async reactivate(bookId: number, medium: CoverMedium, options: SlotStateOptions = {}): Promise<boolean> {
    const context = await this.requireContext(bookId);
    const slot = this.slotFor(context, medium);
    if (!slot || slot.dormantSince === null || !this.mediumIsActive(medium, context.media)) return false;
    const now = new Date();
    await this.repository.applySlotMutation(
      bookId,
      medium,
      context.media,
      { kind: 'upsert', row: { ...this.rowValues(slot), dormantSince: null } },
      { bumpBook: options.backfill !== true, servedBytesChanged: false, updatedAt: now, beforeMedia: this.withMedium(context.media, medium, false) },
    );
    this.emitChanged(context, options.backfill);
    return true;
  }

  /** Removes a dormant extracted slot. Custom slots and slots back in use are left alone. */
  async pruneDormant(bookId: number, medium: CoverMedium, dormantBefore: Date): Promise<boolean> {
    const context = await this.requireContext(bookId);
    const slot = this.slotFor(context, medium);
    if (!slot || slot.source !== 'extracted' || slot.dormantSince === null || slot.dormantSince > dormantBefore) return false;
    if (this.mediumIsActive(medium, context.media)) return false;
    await this.repository.applySlotMutation(
      bookId,
      medium,
      context.media,
      { kind: 'delete' },
      { bumpBook: false, servedBytesChanged: false, updatedAt: new Date() },
    );
    await rm(bookCoverSlotDirPath(this.appDataPath, bookId, medium), { recursive: true, force: true });
    return true;
  }

  /** The slots a book will hand over when it is merged into another book, read before it goes. */
  async slotsForAdoption(bookId: number): Promise<BookCoverSlotRow[]> {
    const context = await this.repository.findContext(bookId);
    if (!context) return [];
    return (await this.ensureConverted(context)).slots.filter((slot) => slot.dormantSince === null);
  }

  /**
   * Moves the slots of a book that was merged away into the book that absorbed its files, for each
   * medium the target has no slot for. Call it after the merge and before the source's cover
   * directory is removed.
   */
  async adoptSlots(sourceBookId: number, sourceSlots: readonly BookCoverSlotRow[], targetBookId: number): Promise<CoverMedium[]> {
    if (sourceSlots.length === 0) return [];
    const target = await this.convertedContext(targetBookId);
    const adopted: CoverMedium[] = [];
    for (const slot of sourceSlots) {
      const medium = slot.medium as CoverMedium;
      if (this.slotFor(target, medium) || this.isLocked(target, medium)) continue;
      const sourceDir = bookCoverSlotDirPath(this.appDataPath, sourceBookId, medium);
      if (!findPreferredBookCoverFileName(await this.readDirIfExists(sourceDir))) continue;
      const targetDir = bookCoverSlotDirPath(this.appDataPath, targetBookId, medium);
      await rm(targetDir, { recursive: true, force: true });
      await mkdir(bookCoverDirPath(this.appDataPath, targetBookId), { recursive: true });
      try {
        await rename(sourceDir, targetDir);
      } catch {
        await cp(sourceDir, targetDir, { recursive: true });
      }
      const now = new Date();
      await this.repository.applySlotMutation(
        targetBookId,
        medium,
        target.media,
        {
          kind: 'upsert',
          row: { ...this.rowValues(slot), updatedAt: now, dormantSince: this.mediumIsActive(medium, target.media) ? null : now },
        },
        { bumpBook: true, servedBytesChanged: true, updatedAt: now },
      );
      adopted.push(medium);
    }
    if (adopted.length > 0) this.emitChanged(target, false);
    return adopted;
  }

  async removeCoverDirectory(bookId: number): Promise<void> {
    await rm(bookCoverDirPath(this.appDataPath, bookId), { recursive: true, force: true });
  }

  /**
   * Picks the slot for a cover that belongs to no medium of its own, such as an OPF sidecar's image.
   * An EPUB with read-along audio is the only audio its book has, so a sidecar image stays on the
   * ebook side there: that audio slot fills only from a square folder image, a fetch or an upload.
   */
  async chooseSidecarMedium(bookId: number, bytes: Buffer): Promise<CoverMedium> {
    const context = await this.requireContext(bookId);
    if (!context.media.hasAudio) return 'ebook';
    if (!context.media.hasEbook) return 'audio';
    if (!context.files.some((file) => this.isContent(file.role) && this.isAudioFile(file.format))) return 'ebook';
    const { width, height } = await this.measure(bytes);
    const shape = classifyCoverShape(width, height);
    if (shape === 'square') return 'audio';
    if (shape === 'portrait') return 'ebook';
    return this.primaryMedium(context);
  }

  async bookIdsWithExpiredDormantSlots(libraryId: number, dormantBefore: Date, limit: number): Promise<number[]> {
    return this.repository.listBookIdsWithExpiredDormantSlots(libraryId, dormantBefore, limit);
  }

  async reconcileInput(bookId: number): Promise<{ context: BookCoverContext; sources: BookCoverSources } | null> {
    const existing = await this.repository.findContext(bookId);
    if (!existing) return null;
    const context = await this.ensureConverted(existing);
    const sources = await this.repository.findCoverSources(bookId);
    return sources ? { context, sources } : null;
  }

  async chooseWriteMedium(bookId: number, bytes?: Buffer): Promise<CoverMedium> {
    const context = await this.requireContext(bookId);
    if (context.media.hasEbook && !context.media.hasAudio) return 'ebook';
    if (context.media.hasAudio && !context.media.hasEbook) return 'audio';
    if (context.media.hasEbook && context.media.hasAudio && bytes) {
      const { width, height } = await this.measure(bytes);
      const shape = classifyCoverShape(width, height);
      if (shape === 'square') return 'audio';
      if (shape === 'portrait') return 'ebook';
    }
    return this.faceMedium(context);
  }

  async faceMediumFor(bookId: number): Promise<CoverMedium> {
    const context = await this.requireContext(bookId);
    const preferred = this.faceMedium(context);
    const alternate = preferred === 'ebook' ? 'audio' : 'ebook';
    const active = new Set(
      context.slots
        .filter((slot) => slot.dormantSince === null && this.mediumIsActive(slot.medium as CoverMedium, context.media))
        .map((slot) => slot.medium as CoverMedium),
    );
    if (active.has(preferred)) return preferred;
    if (active.has(alternate)) return alternate;
    if (this.mediumIsActive(preferred, context.media)) return preferred;
    if (this.mediumIsActive(alternate, context.media)) return alternate;
    return preferred;
  }

  async mediaFor(bookId: number): Promise<CoverMedia> {
    return (await this.requireContext(bookId)).media;
  }

  /** Whether the slot is filled and served, after bringing a legacy root cover into its slot. */
  async hasActiveSlot(bookId: number, medium: CoverMedium): Promise<boolean> {
    const context = await this.convertedContext(bookId);
    return context.slots.some((slot) => slot.medium === medium && slot.dormantSince === null) && this.mediumIsActive(medium, context.media);
  }

  /** What a metadata fetch needs to know about a book's covers: its media, which slots are filled, and which are locked. */
  async fetchState(bookId: number): Promise<{ media: CoverMedia; filled: Record<CoverMedium, boolean>; locked: CoverMedium[] } | null> {
    const existing = await this.repository.findContext(bookId);
    if (!existing) return null;
    const context = await this.ensureConverted(existing);
    const active = (medium: CoverMedium) =>
      this.mediumIsActive(medium, context.media) && context.slots.some((slot) => slot.medium === medium && slot.dormantSince === null);
    return {
      media: context.media,
      filled: { ebook: active('ebook'), audio: active('audio') },
      locked: COVER_MEDIA.filter((medium) => this.isLocked(context, medium)),
    };
  }

  async slotsFor(bookIds: number[]): Promise<Map<number, BookCoverSlotRow[]>> {
    return this.repository.slotsFor(bookIds);
  }

  async enrichCardVersions(cards: BookCard[]): Promise<void> {
    const slotsByBookId = await this.repository.slotsFor(cards.map((card) => card.id));
    for (const card of cards) {
      card.coverVersion = this.coverVersion(card.coverAspectRatio, slotsByBookId.get(card.id) ?? [], card.updatedAt ?? card.addedAt);
    }
  }

  slotDtos(context: Pick<BookCoverContext, 'media' | 'slots'>): Record<CoverMedium, BookCoverSlot | null> {
    return {
      ebook: this.toSlotDto(context.slots.find((slot) => slot.medium === 'ebook' && slot.dormantSince === null && context.media.hasEbook)),
      audio: this.toSlotDto(context.slots.find((slot) => slot.medium === 'audio' && slot.dormantSince === null && context.media.hasAudio)),
    };
  }

  coverVersion(coverAspectRatio: string, slots: readonly BookCoverSlotRow[], legacyVersion: string): string {
    if (slots.length === 0) return `legacy:${legacyVersion}`;
    const face: CoverMedium = coverAspectRatio === '1/1' ? 'audio' : 'ebook';
    const other: CoverMedium = face === 'ebook' ? 'audio' : 'ebook';
    const stamp = (medium: CoverMedium) => slots.find((slot) => slot.medium === medium && slot.dormantSince === null)?.updatedAt.toISOString() ?? '-';
    return `${face}:${stamp(face)}:${stamp(other)}`;
  }

  async contextFor(bookId: number): Promise<BookCoverContext | null> {
    const context = await this.repository.findContext(bookId);
    return context ? this.convertOnRead(context) : null;
  }

  /**
   * Moves a legacy root cover into the slot that matches its shape. Stage A, writes and reads all
   * land here, so a conversion already running for the book is joined rather than raced: a second
   * run would find the root files gone halfway through.
   */
  async convertLegacy(bookId: number, options: { emit?: boolean } = {}): Promise<{ converted: boolean; libraryId: number }> {
    const running = this.conversions.get(bookId);
    if (running) return running;
    const conversion = this.convertLegacyOnce(bookId, options);
    this.conversions.set(bookId, conversion);
    try {
      return await conversion;
    } finally {
      if (this.conversions.get(bookId) === conversion) this.conversions.delete(bookId);
    }
  }

  private async convertLegacyOnce(bookId: number, options: { emit?: boolean }): Promise<{ converted: boolean; libraryId: number }> {
    const context = await this.requireContext(bookId);
    if (context.slots.length > 0) {
      await this.repository.copyCoverLockToAudio(bookId);
      return { converted: false, libraryId: context.libraryId };
    }

    const restored = await this.restoreSlotRows(context);
    if (restored) {
      await this.repository.copyCoverLockToAudio(bookId);
      if (options.emit !== false) this.events.emitChanged({ bookIds: [bookId], libraryId: context.libraryId });
      return { converted: true, libraryId: context.libraryId };
    }

    const root = bookCoverDirPath(this.appDataPath, bookId);
    const files = await this.readDirIfExists(root);
    const coverFile = findPreferredBookCoverFileName(files);
    if (!coverFile) {
      await this.repository.copyCoverLockToAudio(bookId);
      return { converted: false, libraryId: context.libraryId };
    }

    const coverBytes = await readFile(join(root, coverFile));
    const medium = await this.legacyMedium(context, coverBytes);
    const slotDir = bookCoverSlotDirPath(this.appDataPath, bookId, medium);
    await mkdir(slotDir, { recursive: true });
    const source = isCustomBookCoverFileName(coverFile) || context.coverSource === 'custom' ? 'custom' : 'extracted';
    const rootArtifacts = files.filter(
      (file) =>
        file === COVER_THUMBNAIL_FILE_NAME ||
        file.startsWith(COVER_CUSTOM_FILE_PREFIX) ||
        file.startsWith(COVER_EXTRACTED_FILE_PREFIX) ||
        file.startsWith('cover.'),
    );
    const prefixedArtifacts = rootArtifacts.filter(
      (file) => file.startsWith(COVER_CUSTOM_FILE_PREFIX) || file.startsWith(COVER_EXTRACTED_FILE_PREFIX),
    );
    const artifactCopies = prefixedArtifacts.map((file) => ({ source: file, destination: file }));
    if (files.includes(COVER_THUMBNAIL_FILE_NAME)) {
      artifactCopies.push({ source: COVER_THUMBNAIL_FILE_NAME, destination: COVER_THUMBNAIL_FILE_NAME });
    }
    if (!isCustomBookCoverFileName(coverFile) && !isExtractedBookCoverFileName(coverFile)) {
      artifactCopies.push({
        source: coverFile,
        destination: `${source === 'custom' ? COVER_CUSTOM_FILE_PREFIX : COVER_EXTRACTED_FILE_PREFIX}${imageExt(coverBytes)}`,
      });
    }
    for (const artifact of artifactCopies) {
      await this.linkOrCopy(join(root, artifact.source), join(slotDir, artifact.destination));
    }

    const dimensions = await this.measure(coverBytes);
    const { mtime } = await stat(join(root, coverFile));
    await this.repository.importSlotWithoutStamp(bookId, medium, {
      source,
      origin: 'legacy',
      width: dimensions.width,
      height: dimensions.height,
      updatedAt: context.coverUpdatedAt ?? mtime,
      dormantSince: null,
    });
    await Promise.all(rootArtifacts.map((file) => rm(join(root, file), { force: true })));
    await this.repository.copyCoverLockToAudio(bookId);
    if (options.emit !== false) this.events.emitChanged({ bookIds: [bookId], libraryId: context.libraryId });
    return { converted: true, libraryId: context.libraryId };
  }

  async removeBrokenSlots(bookId: number): Promise<{ hadSlots: boolean; removed: number }> {
    let context = await this.requireContext(bookId);
    if (context.slots.length === 0) return { hadSlots: false, removed: 0 };
    let removed = 0;
    for (const slot of context.slots) {
      const medium = slot.medium as CoverMedium;
      if (await this.resolveSlotArtifact(bookId, medium, 'cover')) continue;
      await this.repository.applySlotMutation(
        bookId,
        medium,
        context.media,
        { kind: 'delete' },
        {
          bumpBook: true,
          servedBytesChanged: true,
          updatedAt: new Date(),
        },
      );
      removed++;
      context = (await this.repository.findContext(bookId)) ?? context;
    }
    if (removed > 0) this.events.emitChanged({ bookIds: [bookId], libraryId: context.libraryId });
    return { hadSlots: true, removed };
  }

  private async convertedContext(bookId: number): Promise<BookCoverContext> {
    return this.ensureConverted(await this.requireContext(bookId));
  }

  /**
   * Root cover files are never served, so a book stage A has not reached yet, or one whose covers
   * came back from a restore, is converted before anything reads or writes its slots. A write that
   * skipped this would create the first slot row and strand the root cover for good.
   */
  private async ensureConverted(context: BookCoverContext): Promise<BookCoverContext> {
    if (context.slots.length > 0 || !(await this.hasLegacyArtifacts(context.bookId))) return context;
    await this.convertLegacy(context.bookId, { emit: false });
    return this.requireContext(context.bookId);
  }

  /** A read that cannot convert serves no cover rather than failing the request. */
  private async convertOnRead(context: BookCoverContext): Promise<BookCoverContext> {
    const startedAt = Date.now();
    try {
      return await this.ensureConverted(context);
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[cover.legacy_convert] [fail] bookId=${context.bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - legacy cover conversion on read failed`,
      );
      return context;
    }
  }

  private async hasLegacyArtifacts(bookId: number): Promise<boolean> {
    const root = bookCoverDirPath(this.appDataPath, bookId);
    if (findPreferredBookCoverFileName(await this.readDirIfExists(root))) return true;
    for (const medium of COVER_MEDIA) {
      if (findPreferredBookCoverFileName(await this.readDirIfExists(bookCoverSlotDirPath(this.appDataPath, bookId, medium)))) return true;
    }
    return false;
  }

  private canFill(slot: BookCoverSlotRow, replaceOrigins: readonly BookCoverOrigin[]): boolean {
    return slot.source === 'extracted' && slot.dormantSince === null && replaceOrigins.includes(slot.origin as BookCoverOrigin);
  }

  private async servesBytes(dir: string, bytes: Buffer): Promise<boolean> {
    const files = await this.readDirIfExists(dir);
    const served = findPreferredBookCoverFileName(files);
    if (!served || !isExtractedBookCoverFileName(served)) return false;
    try {
      return (await readFile(join(dir, served))).equals(bytes);
    } catch {
      return false;
    }
  }

  private rowValues(slot: BookCoverSlotRow): Omit<BookCoverSlotRow, 'bookId' | 'medium'> {
    return {
      source: slot.source,
      origin: slot.origin,
      width: slot.width,
      height: slot.height,
      updatedAt: slot.updatedAt,
      dormantSince: slot.dormantSince,
    };
  }

  private withMedium(media: CoverMedia, medium: CoverMedium, present: boolean): CoverMedia {
    return medium === 'ebook' ? { ...media, hasEbook: present } : { ...media, hasAudio: present };
  }

  private primaryMedium(context: BookCoverContext): CoverMedium {
    const primary = context.files.find((file) => file.id === context.primaryFileId) ?? context.files.find((file) => this.isContent(file.role));
    return primary?.format ? this.formatMedium(primary.format) : 'ebook';
  }

  private isContent(role: string): boolean {
    return role === 'content' || role === 'primary';
  }

  private isAudioFile(format: string | null): boolean {
    return format !== null && this.formatMedium(format) === 'audio';
  }

  private emitChanged(context: Pick<BookCoverContext, 'bookId' | 'libraryId'>, backfill: boolean | undefined): void {
    if (backfill === true) return;
    this.events.emitChanged({ bookIds: [context.bookId], libraryId: context.libraryId });
  }

  private async requireContext(bookId: number): Promise<BookCoverContext> {
    const context = await this.repository.findContext(bookId);
    if (!context) throw new NotFoundException(`Book ${bookId} not found`);
    return context;
  }

  private async restoreSlotRows(context: BookCoverContext): Promise<boolean> {
    let restored = false;
    for (const medium of ['ebook', 'audio'] as const) {
      const dir = bookCoverSlotDirPath(this.appDataPath, context.bookId, medium);
      const files = await this.readDirIfExists(dir);
      const cover = findPreferredBookCoverFileName(files);
      if (!cover) continue;
      const coverBytes = await readFile(join(dir, cover));
      const dimensions = await this.measure(coverBytes);
      const { mtime } = await stat(join(dir, cover));
      await this.repository.importSlotWithoutStamp(context.bookId, medium, {
        source: isCustomBookCoverFileName(cover) || context.coverSource === 'custom' ? 'custom' : 'extracted',
        origin: 'legacy',
        width: dimensions.width,
        height: dimensions.height,
        updatedAt: context.coverUpdatedAt ?? mtime,
        dormantSince: this.mediumIsActive(medium, context.media) ? null : new Date(),
      });
      restored = true;
    }
    return restored;
  }

  private async legacyMedium(context: BookCoverContext, bytes: Buffer): Promise<CoverMedium> {
    if (context.media.hasEbook && !context.media.hasAudio) return 'ebook';
    if (context.media.hasAudio && !context.media.hasEbook) return 'audio';
    const dimensions = await this.measure(bytes);
    const shape = classifyCoverShape(dimensions.width, dimensions.height);
    if (shape === 'square') return 'audio';
    if (shape === 'portrait') return 'ebook';
    const primary = context.files.find((file) => file.id === context.primaryFileId) ?? context.files[0];
    return primary?.format ? this.formatMedium(primary.format) : 'ebook';
  }

  private formatMedium(format: string): CoverMedium {
    return isAudioFormat(format.toLowerCase()) ? 'audio' : 'ebook';
  }

  private async linkOrCopy(source: string, destination: string): Promise<void> {
    try {
      await link(source, destination);
    } catch {
      await copyFile(source, destination);
    }
  }

  private resolutionOrder(context: BookCoverContext, requested: CoverMedium | undefined, strict: boolean): CoverMedium[] {
    if (requested) return strict ? [requested] : [requested, requested === 'ebook' ? 'audio' : 'ebook'];
    const face = this.faceMedium(context);
    return [face, face === 'ebook' ? 'audio' : 'ebook'];
  }

  private faceMedium(context: Pick<BookCoverContext, 'coverAspectRatio'>): CoverMedium {
    return context.coverAspectRatio === '1/1' ? 'audio' : 'ebook';
  }

  private mediumIsActive(medium: CoverMedium, media: CoverMedia): boolean {
    return medium === 'ebook' ? media.hasEbook : media.hasAudio;
  }

  private isLocked(context: BookCoverContext, medium: CoverMedium): boolean {
    return context.lockedFields.includes(medium === 'ebook' ? 'cover' : 'audioCover');
  }

  private slotFor(context: BookCoverContext, medium: CoverMedium): BookCoverSlotRow | undefined {
    return context.slots.find((slot) => slot.medium === medium);
  }

  private toSlotDto(slot: BookCoverSlotRow | undefined): BookCoverSlot | null {
    if (!slot) return null;
    return {
      source: slot.source as BookCoverSource,
      updatedAt: slot.updatedAt.toISOString(),
      width: slot.width,
      height: slot.height,
    };
  }

  private async resolveSlotArtifact(bookId: number, medium: CoverMedium, variant: CoverVariant): Promise<string | null> {
    const dir = bookCoverSlotDirPath(this.appDataPath, bookId, medium);
    if (variant === 'thumbnail') {
      const thumbnailPath = bookCoverSlotThumbnailPath(this.appDataPath, bookId, medium);
      if (await this.exists(thumbnailPath)) return thumbnailPath;
      const key = `${bookId}:${medium}`;
      const existing = this.thumbnailRepairs.get(key);
      if (existing) return existing;
      const repair = this.withThumbnailRepairSlot(() => this.repairThumbnail(bookId, medium, dir, thumbnailPath));
      this.thumbnailRepairs.set(key, repair);
      try {
        return await repair;
      } finally {
        if (this.thumbnailRepairs.get(key) === repair) this.thumbnailRepairs.delete(key);
      }
    }
    const files = await this.readDirIfExists(dir);
    const cover = findPreferredBookCoverFileName(files);
    return cover ? join(dir, cover) : null;
  }

  /**
   * Regenerates a thumbnail that went missing beside an intact cover (issue #1475). Resolves to
   * null rather than throwing, so a cover sharp cannot read stays a placeholder in the grid instead
   * of failing the request.
   */
  private async repairThumbnail(bookId: number, medium: CoverMedium, dir: string, thumbnailPath: string): Promise<string | null> {
    const startedAt = Date.now();
    try {
      const cover = findPreferredBookCoverFileName(await this.readDirIfExists(dir));
      if (!cover) return null;
      const thumbnail = await generateThumbnail(await readFile(join(dir, cover)));
      await this.publishRepairedThumbnail(dir, thumbnailPath, thumbnail);
      this.logger.log(
        `[cover.thumbnail_repair] [end] bookId=${bookId} medium=${medium} durationMs=${Date.now() - startedAt} source="${sanitizeLogValue(cover)}" - thumbnail repair completed`,
      );
      return thumbnailPath;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[cover.thumbnail_repair] [fail] bookId=${bookId} medium=${medium} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - thumbnail repair failed`,
      );
      return null;
    }
  }

  /**
   * Publishes from a fully written temporary file, so an interrupted write never leaves a truncated
   * thumbnail at the served path. A hard link fails when the path already exists, which leaves a
   * cover write that landed first in possession of its own thumbnail. Mounts without hard links fall
   * back to a rename, still atomic, that only loses that exclusive create.
   */
  private async publishRepairedThumbnail(dir: string, thumbnailPath: string, bytes: Buffer): Promise<void> {
    const tempPath = join(dir, `.thumbnail-repair-${randomUUID()}.tmp`);
    try {
      await writeFile(tempPath, bytes);
      try {
        await link(tempPath, thumbnailPath);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') return;
      }
      if (await this.exists(thumbnailPath)) return;
      await rename(tempPath, thumbnailPath);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private async withThumbnailRepairSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeThumbnailRepairs < THUMBNAIL_REPAIR_CONCURRENCY) {
      this.activeThumbnailRepairs++;
    } else {
      await new Promise<void>((resolve) => this.thumbnailRepairWaiters.push(resolve));
    }
    try {
      return await operation();
    } finally {
      const next = this.thumbnailRepairWaiters.shift();
      if (next) next();
      else this.activeThumbnailRepairs--;
    }
  }

  private async replaceCoverFile(dir: string, prefix: string, bytes: Buffer): Promise<void> {
    const ext = imageExt(bytes);
    const finalPath = join(dir, `${prefix}${ext}`);
    const tempPath = join(dir, `.${prefix}${randomUUID()}.${ext}.tmp`);
    try {
      await writeFile(tempPath, bytes);
      await rename(tempPath, finalPath);
      await this.deleteFilesByPrefix(dir, prefix, basename(finalPath));
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private async writeThumbnailAtomically(dir: string, bytes: Buffer): Promise<void> {
    const thumbnail = await generateThumbnail(bytes);
    await this.writeThumbnailBytesAtomically(dir, thumbnail);
  }

  private async writeThumbnailBytesAtomically(dir: string, thumbnail: Buffer): Promise<void> {
    const tempPath = join(dir, `.thumbnail-${randomUUID()}.tmp`);
    try {
      await writeFile(tempPath, thumbnail);
      await rename(tempPath, join(dir, COVER_THUMBNAIL_FILE_NAME));
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private async replaceServedArtifacts(dir: string, prefix: string, coverBytes: Buffer): Promise<void> {
    const thumbnail = await generateThumbnail(coverBytes);
    const ext = imageExt(coverBytes);
    const finalCoverPath = join(dir, `${prefix}${ext}`);
    const tempId = randomUUID();
    const tempCoverPath = join(dir, `.${prefix}${tempId}.${ext}.tmp`);
    const tempThumbnailPath = join(dir, `.thumbnail-${tempId}.tmp`);
    try {
      await writeFile(tempCoverPath, coverBytes);
      await writeFile(tempThumbnailPath, thumbnail);
      await rename(tempThumbnailPath, join(dir, COVER_THUMBNAIL_FILE_NAME));
      await rename(tempCoverPath, finalCoverPath);
      await this.deleteFilesByPrefix(dir, prefix, basename(finalCoverPath));
    } finally {
      await Promise.all([rm(tempCoverPath, { force: true }).catch(() => undefined), rm(tempThumbnailPath, { force: true }).catch(() => undefined)]);
    }
  }

  private async measure(bytes: Buffer): Promise<{ width: number | null; height: number | null }> {
    try {
      const metadata = await sharp(bytes, { failOn: 'none' }).metadata();
      return { width: metadata.width ?? null, height: metadata.height ?? null };
    } catch {
      return { width: null, height: null };
    }
  }

  private async deleteFilesByPrefix(dir: string, prefix: string, except?: string): Promise<void> {
    const files = await this.readDirIfExists(dir);
    await Promise.all(files.filter((file) => file.startsWith(prefix) && file !== except).map((file) => rm(join(dir, file), { force: true })));
  }

  private async readDirIfExists(dir: string): Promise<string[]> {
    try {
      return await readdir(dir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return [];
      throw error;
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
