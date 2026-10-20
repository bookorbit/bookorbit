import { Injectable } from '@nestjs/common';

import type { BookmarkRow } from '../../db/schema';
import { BookmarkRepository, type DeviceBookmarkFields } from './bookmark.repository';

export type DeviceBookmarkOutcome = 'created' | 'restored' | 'matched';

export interface DeviceBookmarkUpsertResult {
  row: BookmarkRow;
  outcome: DeviceBookmarkOutcome;
}

/**
 * The bookmarks table stays owned by this module; device sync drives it through
 * these operations instead of reaching into the repository from another module.
 */
@Injectable()
export class BookmarkSyncService {
  constructor(private readonly bookmarkRepo: BookmarkRepository) {}

  /** Every row of the book, tombstones included, capped so one huge book cannot unbound a request. */
  listForSync(userId: number, bookId: number, limit: number): Promise<BookmarkRow[]> {
    return this.bookmarkRepo.listForSync(userId, bookId, limit);
  }

  /**
   * Lands one device bookmark at its CFI. A live row at that location is reused, a
   * tombstoned one is restored, and only an unoccupied location inserts.
   */
  async upsertFromDevice(
    userId: number,
    bookId: number,
    fields: DeviceBookmarkFields,
    opts: { keepTitle?: boolean } = {},
  ): Promise<DeviceBookmarkUpsertResult | null> {
    const location = { cfi: fields.cfi, positionSeconds: null };

    const created = await this.bookmarkRepo.createFromDevice(userId, bookId, fields);
    if (created) return { row: created, outcome: 'created' };

    const restored = await this.bookmarkRepo.restoreAtLocation(userId, bookId, location, {
      title: fields.title,
      origin: fields.origin ?? 'koreader',
      devicePos: fields.devicePos,
      pageno: fields.pageno,
      bookFileId: fields.bookFileId,
      ...(fields.note !== undefined ? { note: fields.note } : {}),
    });
    if (restored) return { row: restored, outcome: 'restored' };

    const existing = await this.bookmarkRepo.findLiveByLocation(userId, bookId, location);
    if (existing?.bookFileId == null && existing && fields.bookFileId != null) {
      await this.bookmarkRepo.captureSourceFile(userId, existing.id, fields.cfi, fields.bookFileId);
    }
    if (!existing) return null;
    // A device whose dogears carry no title of their own (Kobo) names a match by its chapter, which
    // must not replace a title someone chose.
    const patch = {
      ...(!opts.keepTitle && existing.title !== fields.title ? { title: fields.title } : {}),
      ...(fields.note != null && existing.note !== fields.note ? { note: fields.note } : {}),
    };
    if (Object.keys(patch).length > 0) {
      const updated = await this.bookmarkRepo.updateFromDevice(userId, existing.id, patch);
      return updated ? { row: updated, outcome: 'matched' } : null;
    }
    return { row: existing, outcome: 'matched' };
  }

  /** A device's note edit on a bookmark it already holds; older than the row's last change, it is an echo and ignored. */
  applyDeviceNote(userId: number, bookmarkId: number, note: string | null, editedAt: Date) {
    return this.bookmarkRepo.applyDeviceNote(userId, bookmarkId, note?.trim() ? note : null, editedAt);
  }

  /**
   * Device-side rename. Callers apply it only once the device has acknowledged the current server
   * version, so a rename made elsewhere and still on its way down is not undone by a stale title.
   */
  applyDeviceEdit(userId: number, bookmarkId: number, values: { title?: string; devicePos?: string; pageno?: number | null }) {
    return this.bookmarkRepo.updateFromDevice(userId, bookmarkId, values);
  }

  captureSourceFile(userId: number, bookmarkId: number, cfi: string, bookFileId: number) {
    return this.bookmarkRepo.captureSourceFile(userId, bookmarkId, cfi, bookFileId);
  }

  captureSourceFileById(userId: number, bookmarkId: number, bookFileId: number) {
    return this.bookmarkRepo.captureSourceFileById(userId, bookmarkId, bookFileId);
  }

  tombstone(userId: number, bookmarkIds: number[]): Promise<number> {
    return this.bookmarkRepo.tombstone(userId, bookmarkIds);
  }

  listPurgeableTombstones(userId: number, deletedBefore: Date, limit: number): Promise<number[]> {
    return this.bookmarkRepo.listPurgeableTombstones(userId, deletedBefore, limit);
  }

  purge(userId: number, bookmarkIds: number[]): Promise<number> {
    return this.bookmarkRepo.purge(userId, bookmarkIds);
  }
}
