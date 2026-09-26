import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { COVER_MEDIA, isAudioFormat, type CoverMedium } from '@bookorbit/types';
import { readFile, stat } from 'fs/promises';
import { basename } from 'path';
import sharp from 'sharp';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { BookCoverContext, BookCoverSourceFile } from '../book-cover-store/book-cover-store.repository';
import { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import { assignFolderImages, type FolderImageCandidate } from '../book-cover-store/cover-shape';
import { hasAudioFiles, selectEmbeddedCoverSources, selectFolderImages } from '../book-cover-store/cover-sources';
import { MetadataExtractionService } from './metadata-extraction.service';

const RECONCILE_CONCURRENCY = 2;
const DORMANT_PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;
const EXPIRED_DORMANT_BATCH_SIZE = 500;
const MAX_FOLDER_IMAGES = 8;
const MAX_FOLDER_IMAGE_BYTES = 32 * 1024 * 1024;

export type CoverReconcileOptions = {
  /** The book's files changed, so a slot filled from a folder image is resolved again. */
  filesChanged?: boolean;
  /** Upgrade writes: `books.updated_at` stays put and the caller batches the change events. */
  backfill?: boolean;
};

export type CoverReconcileResult = {
  libraryId: number | null;
  changed: boolean;
  filled: CoverMedium[];
};

type QueueEntry = {
  options: CoverReconcileOptions;
  done: Promise<void>;
  resolve: () => void;
};

type LoadedFolderImage = FolderImageCandidate & { bytes: Buffer };

/**
 * Makes a book's cover slots match its files. Every path that changes a book's file set enqueues
 * the book here: slots of media that left go dormant, slots of media that returned come back, and
 * empty slots fill from that medium's embedded art, then from folder images.
 */
@Injectable()
export class CoverSlotReconciler implements OnModuleDestroy {
  private readonly logger = new Logger(CoverSlotReconciler.name);
  private readonly queued = new Map<number, QueueEntry>();
  private readonly order: number[] = [];
  private readonly running = new Set<number>();
  private active = 0;
  private stopped = false;

  constructor(
    private readonly store: BookCoverStore,
    private readonly extraction: MetadataExtractionService,
  ) {}

  onModuleDestroy(): void {
    this.stopped = true;
    this.order.length = 0;
    for (const entry of this.queued.values()) entry.resolve();
    this.queued.clear();
  }

  /**
   * Schedules each book once. A book already waiting absorbs the new request; a book already
   * running is queued again, so a change that lands mid-run is never lost. Resolves when every
   * listed book's run has finished; failures are logged, never thrown.
   */
  enqueue(bookIds: Iterable<number>, options: CoverReconcileOptions = {}): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const waits: Promise<void>[] = [];
    for (const bookId of new Set(bookIds)) {
      const existing = this.queued.get(bookId);
      if (existing) {
        existing.options = {
          filesChanged: existing.options.filesChanged === true || options.filesChanged === true,
          backfill: existing.options.backfill === true && options.backfill === true,
        };
        waits.push(existing.done);
        continue;
      }
      let resolve!: () => void;
      const done = new Promise<void>((settle) => {
        resolve = settle;
      });
      this.queued.set(bookId, { options, done, resolve });
      this.order.push(bookId);
      waits.push(done);
    }
    this.drain();
    return Promise.all(waits).then(() => undefined);
  }

  async reconcile(bookId: number, options: CoverReconcileOptions = {}): Promise<CoverReconcileResult> {
    const input = await this.store.reconcileInput(bookId);
    if (!input) return { libraryId: null, changed: false, filled: [] };
    const { context, sources } = input;
    const changed = await this.settleDormancy(context, options);
    const needed = COVER_MEDIA.filter((medium) => this.needsFill(context, medium, options.filesChanged === true));
    const filled = needed.length > 0 ? await this.fill(context, sources.files, sources.formatPriority, needed, options) : [];
    return { libraryId: context.libraryId, changed: changed || filled.length > 0, filled };
  }

  /** Lets a later reconcile prune extracted slots that stayed dormant for a day. */
  async enqueueExpiredDormant(libraryId: number): Promise<void> {
    const cutoff = new Date(Date.now() - DORMANT_PRUNE_AFTER_MS);
    const bookIds = await this.store.bookIdsWithExpiredDormantSlots(libraryId, cutoff, EXPIRED_DORMANT_BATCH_SIZE);
    if (bookIds.length > 0) await this.enqueue(bookIds);
  }

  private drain(): void {
    while (!this.stopped && this.active < RECONCILE_CONCURRENCY) {
      const index = this.order.findIndex((bookId) => !this.running.has(bookId));
      if (index === -1) return;
      const [bookId] = this.order.splice(index, 1) as [number];
      const entry = this.queued.get(bookId)!;
      this.queued.delete(bookId);
      this.running.add(bookId);
      this.active++;
      void this.reconcileSafely(bookId, entry.options).finally(() => {
        this.active--;
        this.running.delete(bookId);
        entry.resolve();
        this.drain();
      });
    }
  }

  private async reconcileSafely(bookId: number, options: CoverReconcileOptions): Promise<void> {
    const startedAt = Date.now();
    try {
      const result = await this.reconcile(bookId, options);
      if (result.changed) {
        this.logger.debug(
          `[cover.slot_reconcile] [end] bookId=${bookId} filled=${result.filled.join(',') || 'none'} durationMs=${Date.now() - startedAt} - cover slots reconciled`,
        );
      }
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[cover.slot_reconcile] [fail] bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - cover slot reconcile failed`,
      );
    }
  }

  private async settleDormancy(context: BookCoverContext, options: CoverReconcileOptions): Promise<boolean> {
    let changed = false;
    const dormantBefore = new Date(Date.now() - DORMANT_PRUNE_AFTER_MS);
    for (const slot of context.slots) {
      const medium = slot.medium as CoverMedium;
      if (this.isPresent(context, medium)) {
        if (slot.dormantSince !== null) changed = (await this.store.reactivate(context.bookId, medium, options)) || changed;
      } else if (slot.dormantSince === null) {
        changed = (await this.store.markDormant(context.bookId, medium, options)) || changed;
      } else {
        changed = (await this.store.pruneDormant(context.bookId, medium, dormantBefore)) || changed;
      }
    }
    return changed;
  }

  private needsFill(context: BookCoverContext, medium: CoverMedium, filesChanged: boolean): boolean {
    if (!this.isPresent(context, medium)) return false;
    if (context.lockedFields.includes(medium === 'ebook' ? 'cover' : 'audioCover')) return false;
    const slot = context.slots.find((candidate) => candidate.medium === medium);
    if (!slot) return true;
    return filesChanged && slot.source === 'extracted' && slot.origin === 'folder_image';
  }

  private async fill(
    context: BookCoverContext,
    files: readonly BookCoverSourceFile[],
    formatPriority: readonly string[],
    needed: readonly CoverMedium[],
    options: CoverReconcileOptions,
  ): Promise<CoverMedium[]> {
    const filled: CoverMedium[] = [];
    const withoutEmbeddedArt: CoverMedium[] = [];
    const embeddedSources = selectEmbeddedCoverSources(files, formatPriority);

    for (const medium of needed) {
      const source = embeddedSources[medium];
      const bytes = source ? await this.extractEmbedded(context.bookId, source) : null;
      if (!bytes) {
        withoutEmbeddedArt.push(medium);
        continue;
      }
      if (await this.save(context.bookId, medium, bytes, 'embedded', options)) filled.push(medium);
    }

    if (withoutEmbeddedArt.length === 0) return filled;
    const images = await this.loadFolderImages(context.bookId, files);
    const assignments = assignFolderImages(images, withoutEmbeddedArt, {
      bothMedia: context.media.hasEbook && context.media.hasAudio,
      squareOnlyAudio: !hasAudioFiles(files),
      primaryMedium: this.primaryMedium(context, files),
    });
    for (const [medium, image] of assignments) {
      const loaded = images.find((candidate) => candidate.path === image.path)!;
      if (await this.save(context.bookId, medium, loaded.bytes, 'folder_image', options)) filled.push(medium);
    }
    return filled;
  }

  private async save(
    bookId: number,
    medium: CoverMedium,
    bytes: Buffer,
    origin: 'embedded' | 'folder_image',
    options: CoverReconcileOptions,
  ): Promise<boolean> {
    try {
      return await this.store.saveExtracted(bookId, medium, bytes, {
        origin,
        overwrite: false,
        backfill: options.backfill,
        fill: { replaceOrigins: ['folder_image'] },
        skipIfUnchanged: true,
      });
    } catch (error) {
      this.logger.warn(
        `[cover.slot_reconcile] [fail] bookId=${bookId} medium=${medium} origin=${origin} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - cover slot fill skipped`,
      );
      return false;
    }
  }

  private async extractEmbedded(bookId: number, file: BookCoverSourceFile): Promise<Buffer | null> {
    try {
      return await this.extraction.extractEmbeddedCover(file.absolutePath, file.format!);
    } catch (error) {
      this.logger.debug(
        `[cover.slot_reconcile] [fail] bookId=${bookId} format=${file.format} path="${sanitizeLogValue(file.absolutePath)}" errorClass=${error instanceof Error ? error.name : 'Error'} - embedded cover unreadable`,
      );
      return null;
    }
  }

  private async loadFolderImages(bookId: number, files: readonly BookCoverSourceFile[]): Promise<LoadedFolderImage[]> {
    const loaded: LoadedFolderImage[] = [];
    for (const file of selectFolderImages(files).slice(0, MAX_FOLDER_IMAGES)) {
      try {
        const { size } = await stat(file.absolutePath);
        if (size === 0 || size > MAX_FOLDER_IMAGE_BYTES) continue;
        const bytes = await readFile(file.absolutePath);
        const { width, height } = await sharp(bytes, { failOn: 'error' }).metadata();
        if (!width || !height) continue;
        loaded.push({ path: file.absolutePath, name: basename(file.absolutePath), width, height, bytes });
      } catch {
        this.logger.debug(`[cover.slot_reconcile] [fail] bookId=${bookId} path="${sanitizeLogValue(file.absolutePath)}" - folder image unreadable`);
      }
    }
    return loaded;
  }

  private isPresent(context: BookCoverContext, medium: CoverMedium): boolean {
    return medium === 'ebook' ? context.media.hasEbook : context.media.hasAudio;
  }

  private primaryMedium(context: BookCoverContext, files: readonly BookCoverSourceFile[]): CoverMedium {
    const primary = files.find((file) => file.id === context.primaryFileId);
    return primary?.format && isAudioFormat(primary.format.toLowerCase()) ? 'audio' : 'ebook';
  }
}
