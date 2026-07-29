import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { BookmarkRow, KoreaderBookmarkLink } from '../../db/schema';
import { BookmarkSyncService } from '../bookmark/bookmark-sync.service';
import { PositionConverterService } from '../position-converter/position-converter.service';
import type { BookmarkAckBookDto, BookmarkExchangeAckDto, BookmarkExchangeBookDto, BookmarkExchangeDto, KoreaderBookmarkDto } from './dto';
import { KoreaderBookmarkRepository } from './koreader-bookmark.repository';
import { KoreaderRepository } from './koreader.repository';

const EXCHANGE_EVENT = 'koreader.bookmark_exchange';
const ACK_EVENT = 'koreader.bookmark_exchange_ack';

/** Per-book working set. Dogears are rare, so one bounded page covers a whole book. */
const BOOKMARKS_PER_BOOK_LIMIT = 500;
const PUSH_DOWN_PAGE = 100;
/** Converting a CFI opens a chapter document; keep one request's worth bounded. */
const CONVERSION_BUDGET_PER_REQUEST = 20;
const TOMBSTONE_RETENTION_DAYS = 90;
const PURGE_CANDIDATES_PER_REQUEST = 50;
const TITLE_MAX_LENGTH = 500;

export interface BookmarkAddEntry {
  serverId: number;
  pos: string;
  pageno: number | null;
  title: string;
}

export interface BookmarkDeleteEntry {
  serverId: number;
  /** The device's own identity for the row; it has no other way to find it locally. */
  key: string;
  datetime: string | null;
}

export interface BookmarkExchangeBookResult {
  hash: string;
  bookId: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  deviceDeleted: number;
  toApply: { add: BookmarkAddEntry[]; delete: BookmarkDeleteEntry[] };
  more: boolean;
  skippedConversion: number;
}

export interface BookmarkExchangeResponse {
  results: BookmarkExchangeBookResult[];
  unmatched: string[];
}

export interface BookmarkExchangeAckResponse {
  results: { hash: string; acked: number }[];
  unmatched: string[];
}

/** The device identity of a bookmark: md5 of `${datetime}|${pos}`, matching the plugin. */
export function buildBookmarkKey(datetime: string, pos: string): string {
  return createHash('md5').update(`${datetime}|${pos}`).digest('hex');
}

@Injectable()
export class KoreaderBookmarkExchangeService {
  private readonly logger = new Logger(KoreaderBookmarkExchangeService.name);

  constructor(
    private readonly koreaderRepo: KoreaderRepository,
    private readonly bookmarkRepo: KoreaderBookmarkRepository,
    private readonly bookmarkSync: BookmarkSyncService,
    private readonly positionConverter: PositionConverterService,
  ) {}

  async exchange(user: RequestUser, dto: BookmarkExchangeDto): Promise<BookmarkExchangeResponse> {
    const startedAtMs = Date.now();
    const totalChanges = dto.books.reduce((sum, book) => sum + book.changes.length, 0);
    this.logger.log(
      `[${EXCHANGE_EVENT}] [start] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} books=${dto.books.length} changes=${totalChanges} - bookmark exchange started`,
    );

    try {
      const matches = await this.resolveBooks(user.id, dto.books);
      const results: BookmarkExchangeBookResult[] = [];
      const unmatched: string[] = [];
      let pushedTotal = 0;

      for (const book of dto.books) {
        const hash = book.hash.toLowerCase();
        const match = matches.get(hash);
        if (!match) {
          unmatched.push(hash);
          continue;
        }
        const result = await this.exchangeBook(user.id, dto.deviceId, hash, match.bookId, match.bookFileId, book);
        pushedTotal += result.toApply.add.length + result.toApply.delete.length;
        results.push(result);
      }

      await this.purgeExpiredTombstones(user.id);

      this.logger.log(
        `[${EXCHANGE_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} books=${results.length} pushed=${pushedTotal} unmatched=${unmatched.length} - bookmark exchange completed`,
      );
      return { results, unmatched };
    } catch (error) {
      this.logFailure(EXCHANGE_EVENT, user.id, dto.deviceId, startedAtMs, error);
      throw error;
    }
  }

  async exchangeAck(user: RequestUser, dto: BookmarkExchangeAckDto): Promise<BookmarkExchangeAckResponse> {
    const startedAtMs = Date.now();
    try {
      const matches = await this.resolveBooks(user.id, dto.books);
      const results: { hash: string; acked: number }[] = [];
      const unmatched: string[] = [];

      for (const book of dto.books) {
        const hash = book.hash.toLowerCase();
        const match = matches.get(hash);
        if (!match) {
          unmatched.push(hash);
          continue;
        }
        const acked = await this.ackBook(user.id, dto.deviceId, match.bookId, book);
        results.push({ hash, acked });
      }

      this.logger.log(
        `[${ACK_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} books=${results.length} unmatched=${unmatched.length} - bookmark exchange ack applied`,
      );
      return { results, unmatched };
    } catch (error) {
      this.logFailure(ACK_EVENT, user.id, dto.deviceId, startedAtMs, error);
      throw error;
    }
  }

  private async resolveBooks(userId: number, books: { hash: string }[]) {
    const accessibleLibraryIds = await this.koreaderRepo.getAccessibleLibraryIds(userId);
    const hashes = [...new Set(books.map((book) => book.hash.toLowerCase()))];
    return this.koreaderRepo.resolveBookFilesByHashes(hashes, accessibleLibraryIds, userId);
  }

  private logFailure(event: string, userId: number, deviceId: string, startedAtMs: number, error: unknown): void {
    const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
    this.logger.warn(
      `[${event}] [fail] userId=${userId} deviceId=${deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : 'unknown error')}" - bookmark exchange failed`,
    );
  }

  private async exchangeBook(
    userId: number,
    deviceId: string,
    hash: string,
    bookId: number,
    bookFileId: number,
    book: BookmarkExchangeBookDto,
  ): Promise<BookmarkExchangeBookResult> {
    const before = await this.loadWorkingSet(userId, deviceId, bookId);

    const ingest = await this.ingestDeviceChanges(userId, deviceId, bookId, bookFileId, book.changes, before);
    const deviceDeleted = book.keysComplete ? await this.applyDeviceDeletions(userId, deviceId, book, before) : 0;

    const after = ingest.mutated || deviceDeleted > 0 ? await this.loadWorkingSet(userId, deviceId, bookId) : before;
    const push = await this.buildPushDown(userId, bookFileId, after);

    return {
      hash,
      bookId,
      accepted: ingest.accepted,
      duplicates: ingest.duplicates,
      rejected: ingest.rejected,
      deviceDeleted,
      toApply: { add: push.add, delete: push.delete },
      more: push.more,
      skippedConversion: push.skippedConversion,
    };
  }

  private async loadWorkingSet(userId: number, deviceId: string, bookId: number) {
    const bookmarks = await this.bookmarkSync.listForSync(userId, bookId, BOOKMARKS_PER_BOOK_LIMIT);
    if (bookmarks.length === BOOKMARKS_PER_BOOK_LIMIT) {
      this.logger.warn(
        `[${EXCHANGE_EVENT}] userId=${userId} bookId=${bookId} limit=${BOOKMARKS_PER_BOOK_LIMIT} - bookmark working set capped; rows past the cap neither sync nor delete this round`,
      );
    }
    const links = await this.bookmarkRepo.findLinksForBookmarks(
      userId,
      deviceId,
      bookmarks.map((bookmark) => bookmark.id),
    );
    return { bookmarks, links, byId: new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark])) };
  }

  /**
   * Device adds and renames. A known key is a rename at most; an unknown key resolves
   * to a CFI and then either links an existing bookmark, restores a tombstone or inserts.
   */
  private async ingestDeviceChanges(
    userId: number,
    deviceId: string,
    bookId: number,
    bookFileId: number,
    changes: KoreaderBookmarkDto[],
    working: { links: KoreaderBookmarkLink[]; byId: Map<number, BookmarkRow> },
  ): Promise<{ accepted: number; duplicates: number; rejected: number; mutated: boolean }> {
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;
    let mutated = false;
    if (changes.length === 0) return { accepted, duplicates, rejected, mutated };

    const linkByKey = new Map(working.links.map((link) => [link.koreaderKey, link]));
    const seenKeys = new Set<string>();

    for (const change of changes) {
      const key = buildBookmarkKey(change.datetime, change.pos);
      if (seenKeys.has(key)) {
        duplicates += 1;
        continue;
      }
      seenKeys.add(key);

      const title = this.titleFor(change);
      const known = linkByKey.get(key);
      if (known) {
        const bookmark = working.byId.get(known.bookmarkId);
        // Only the device can rename a dogear, so a differing title is always its edit.
        if (bookmark && !bookmark.deletedAt && bookmark.title !== title) {
          await this.bookmarkSync.applyDeviceEdit(userId, known.bookmarkId, { title, pageno: change.pageno ?? null });
          mutated = true;
        }
        duplicates += 1;
        continue;
      }

      const outcome = await this.positionConverter.xpointerPointToCfi({ bookFileId, pos: change.pos });
      if (outcome.status === 'failed' || !outcome.cfi) {
        rejected += 1;
        continue;
      }

      const landed = await this.bookmarkSync.upsertFromDevice(userId, bookId, {
        cfi: outcome.cfi,
        title,
        devicePos: change.pos,
        pageno: change.pageno ?? null,
      });
      if (!landed) {
        rejected += 1;
        continue;
      }

      await this.bookmarkRepo.upsertLink({
        bookmarkId: landed.row.id,
        userId,
        deviceId,
        koreaderKey: key,
        deviceDatetime: change.datetime,
      });
      mutated = true;
      if (landed.outcome === 'matched') duplicates += 1;
      else accepted += 1;
    }

    return { accepted, duplicates, rejected, mutated };
  }

  /**
   * A link whose key the device no longer reports was deleted there. The bookmark is
   * tombstoned globally and this device's link dropped; the other devices' links stay
   * so they still receive the delete.
   */
  private async applyDeviceDeletions(
    userId: number,
    deviceId: string,
    book: BookmarkExchangeBookDto,
    working: { links: KoreaderBookmarkLink[]; byId: Map<number, BookmarkRow> },
  ): Promise<number> {
    const presentKeys = new Set(book.keys.map((entry) => entry.k));
    const goneIds = working.links
      .filter((link) => !presentKeys.has(link.koreaderKey))
      .map((link) => link.bookmarkId)
      .filter((bookmarkId) => working.byId.get(bookmarkId)?.deletedAt == null);
    if (goneIds.length === 0) return 0;

    const tombstoned = await this.bookmarkSync.tombstone(userId, goneIds);
    await this.bookmarkRepo.deleteLinks(userId, deviceId, goneIds);
    return tombstoned;
  }

  /** Live bookmarks this device has never seen, plus the tombstones it still holds. */
  private async buildPushDown(
    userId: number,
    bookFileId: number,
    working: { bookmarks: BookmarkRow[]; links: KoreaderBookmarkLink[] },
  ): Promise<{ add: BookmarkAddEntry[]; delete: BookmarkDeleteEntry[]; more: boolean; skippedConversion: number }> {
    const linkedIds = new Set(working.links.map((link) => link.bookmarkId));
    const byId = new Map(working.bookmarks.map((bookmark) => [bookmark.id, bookmark]));

    const deleteEntries: BookmarkDeleteEntry[] = working.links
      .filter((link) => byId.get(link.bookmarkId)?.deletedAt != null)
      .map((link) => ({ serverId: link.bookmarkId, key: link.koreaderKey, datetime: link.deviceDatetime }));

    // Audio bookmarks have no device counterpart, and a CFI-less row cannot be placed.
    const candidates = working.bookmarks.filter((bookmark) => bookmark.deletedAt == null && bookmark.cfi != null && !linkedIds.has(bookmark.id));

    const add: BookmarkAddEntry[] = [];
    let skippedConversion = 0;
    let conversionBudget = CONVERSION_BUDGET_PER_REQUEST;

    for (const bookmark of candidates) {
      if (add.length >= PUSH_DOWN_PAGE) break;
      let pos = bookmark.devicePos;
      if (!pos) {
        if (conversionBudget <= 0) {
          skippedConversion += 1;
          continue;
        }
        conversionBudget -= 1;
        const outcome = await this.positionConverter.cfiPointToXpointer({ bookFileId, cfi: bookmark.cfi! });
        if (outcome.status === 'failed' || !outcome.pos0) {
          skippedConversion += 1;
          continue;
        }
        pos = outcome.pos0;
      }
      add.push({ serverId: bookmark.id, pos, pageno: bookmark.pageno, title: bookmark.title });
    }

    // Only a page-capped add set is worth another round: entries whose conversion was
    // budgeted out this request are retried by the next exchange, not by a follow-up pull.
    const more = candidates.length > add.length + skippedConversion;
    return { add, delete: deleteEntries, more, skippedConversion };
  }

  private async ackBook(userId: number, deviceId: string, bookId: number, book: BookmarkAckBookDto): Promise<number> {
    const bookmarks = await this.bookmarkSync.listForSync(userId, bookId, BOOKMARKS_PER_BOOK_LIMIT);
    const byId = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
    let acked = 0;

    for (const entry of book.applied) {
      if (entry.status !== 'applied' || !byId.has(entry.serverId)) continue;
      const key = entry.key ?? (entry.datetime && entry.pos ? buildBookmarkKey(entry.datetime, entry.pos) : null);
      // Without a device identity the bookmark could never be recognised as deleted there.
      if (!key) continue;
      await this.bookmarkRepo.upsertLink({
        bookmarkId: entry.serverId,
        userId,
        deviceId,
        koreaderKey: key,
        deviceDatetime: entry.datetime ?? null,
      });
      acked += 1;
    }

    const deletedIds = book.deleted.filter((entry) => entry.status === 'applied' && byId.has(entry.serverId)).map((entry) => entry.serverId);
    acked += await this.bookmarkRepo.deleteLinks(userId, deviceId, deletedIds);
    return acked;
  }

  /** Opportunistic: a tombstone no device still holds has nothing left to tell anyone. */
  private async purgeExpiredTombstones(userId: number): Promise<void> {
    const deletedBefore = new Date(Date.now() - TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await this.bookmarkSync.listPurgeableTombstones(userId, deletedBefore, PURGE_CANDIDATES_PER_REQUEST);
    if (candidates.length === 0) return;
    const stillLinked = await this.bookmarkRepo.findBookmarkIdsWithLinks(userId, candidates);
    const purgeable = candidates.filter((id) => !stillLinked.has(id));
    if (purgeable.length === 0) return;
    const purged = await this.bookmarkSync.purge(userId, purgeable);
    if (purged > 0) {
      this.logger.log(`[${EXCHANGE_EVENT}] userId=${userId} purged=${purged} - expired bookmark tombstones removed`);
    }
  }

  /**
   * A dogear has no text of its own. The device note is the user's own label; a chapter
   * title matches what the web reader stores. Both are user data, so the last-resort
   * page label stays a neutral, documented fallback rather than localized copy.
   */
  private titleFor(change: KoreaderBookmarkDto): string {
    const note = change.note?.trim();
    if (note) return note.slice(0, TITLE_MAX_LENGTH);
    const chapter = change.chapter?.trim();
    if (chapter) return chapter.slice(0, TITLE_MAX_LENGTH);
    if (change.pageno != null) return `p. ${change.pageno}`;
    return 'Bookmark';
  }
}
