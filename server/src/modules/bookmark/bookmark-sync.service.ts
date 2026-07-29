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
  async upsertFromDevice(userId: number, bookId: number, fields: DeviceBookmarkFields): Promise<DeviceBookmarkUpsertResult | null> {
    const location = { cfi: fields.cfi, positionSeconds: null };

    const created = await this.bookmarkRepo.createFromDevice(userId, bookId, fields);
    if (created) return { row: created, outcome: 'created' };

    const restored = await this.bookmarkRepo.restoreAtLocation(userId, bookId, location, {
      title: fields.title,
      origin: 'koreader',
      devicePos: fields.devicePos,
      pageno: fields.pageno,
    });
    if (restored) return { row: restored, outcome: 'restored' };

    const existing = await this.bookmarkRepo.findLiveByLocation(userId, bookId, location);
    return existing ? { row: existing, outcome: 'matched' } : null;
  }

  /** Device-side rename. The web has no rename surface, so the device always wins. */
  applyDeviceEdit(userId: number, bookmarkId: number, values: { title?: string; devicePos?: string; pageno?: number | null }) {
    return this.bookmarkRepo.updateFromDevice(userId, bookmarkId, values);
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
