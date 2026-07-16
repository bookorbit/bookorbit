import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type {
  DismissAllKoreaderUnmatchedBooksResult,
  DismissKoreaderUnmatchedBookResult,
  KoreaderManualHashLink,
  KoreaderUnmatchedBook,
  LinkKoreaderUnmatchedBookResult,
  UnlinkKoreaderManualHashLinkResult,
} from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { KoreaderRepository } from './koreader.repository';

const MD5_HEX = /^[0-9a-f]{32}$/;
const UNMATCHED_BOOK_LIMIT = 100;
const MANUAL_HASH_LINK_LIMIT = 100;
const HASH_LINK_CREATE_EVENT = 'koreader.hash_link_create';
const HASH_LINK_UPDATE_EVENT = 'koreader.hash_link_update';
const HASH_LINK_DELETE_EVENT = 'koreader.hash_link_delete';
const UNMATCHED_BOOK_DISMISS_EVENT = 'koreader.unmatched_book_dismiss';
const UNMATCHED_BOOK_DISMISS_ALL_EVENT = 'koreader.unmatched_book_dismiss_all';

/**
 * Manages the KOReader "unmatched book" queue and the manual hash links used
 * to resolve hashes that BookOrbit cannot match intrinsically (via file hash
 * or hash history). Split out of KoreaderService to keep that class focused
 * on credentials and progress sync.
 */
@Injectable()
export class KoreaderHashLinkService {
  private readonly logger = new Logger(KoreaderHashLinkService.name);

  constructor(
    private readonly repo: KoreaderRepository,
    private readonly bookService: BookService,
  ) {}

  async listUnmatchedBooks(user: RequestUser): Promise<KoreaderUnmatchedBook[]> {
    const rows = await this.repo.listUnmatchedBooks(user.id, UNMATCHED_BOOK_LIMIT);
    if (rows.length === 0) return [];

    const accessibleLibraryIds = await this.repo.getAccessibleLibraryIds(user.id);
    const hashes = rows.map((row) => row.hash);
    const resolved = await this.repo.resolveBookFilesByHashes(hashes, accessibleLibraryIds, user.id);
    if (resolved.size > 0) {
      await this.repo.clearUnmatchedBooks(user.id, [...resolved.keys()]);
    }

    return rows
      .filter((row) => !resolved.has(row.hash))
      .map((row) => ({
        hash: row.hash,
        title: row.title ?? null,
        authors: row.authors ?? null,
        lastOpen: row.lastOpen ?? null,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
      }));
  }

  async linkUnmatchedBook(user: RequestUser, hash: string, bookId: number): Promise<LinkKoreaderUnmatchedBookResult> {
    const startedAtMs = Date.now();
    const normalizedHash = this.normalizeKoreaderHash(hash);
    this.logger.log(
      `[${HASH_LINK_CREATE_EVENT}] [start] userId=${user.id} hash=${normalizedHash.slice(0, 8)} bookId=${bookId} - hash link create started`,
    );

    const unmatched = await this.repo.getUnmatchedBook(user.id, normalizedHash);
    if (!unmatched || !isLinkableUnmatchedBook(unmatched)) throw new NotFoundException('KOReader unmatched book not found');

    await this.bookService.verifyBookAccess(bookId, user);
    const bookFileId = await this.repo.findBookFileIdByBookId(bookId);
    if (!bookFileId) throw new BadRequestException('Book has no file to link');

    const accessibleLibraryIds = await this.repo.getAccessibleLibraryIds(user.id);
    const existingIntrinsicMatch = await this.repo.resolveBookFileByHash(normalizedHash, accessibleLibraryIds);
    if (existingIntrinsicMatch && existingIntrinsicMatch.id !== bookFileId) {
      throw new ConflictException('KOReader hash already matches a different book');
    }

    const existingLink = await this.repo.getBookHashLink(user.id, normalizedHash);
    if (existingLink && existingLink.bookFileId !== bookFileId) {
      throw new ConflictException('KOReader hash is already linked to a different book');
    }

    if (!existingIntrinsicMatch) {
      await this.repo.upsertBookHashLink(user.id, normalizedHash, bookFileId, {
        title: unmatched?.title ?? null,
        authors: unmatched?.authors ?? null,
        lastOpen: unmatched?.lastOpen ?? null,
      });
    }
    await this.repo.clearUnmatchedBooks(user.id, [normalizedHash]);

    this.logger.log(
      `[${HASH_LINK_CREATE_EVENT}] [end] userId=${user.id} hash=${normalizedHash.slice(0, 8)} bookId=${bookId} bookFileId=${bookFileId} durationMs=${Date.now() - startedAtMs} - hash link create completed`,
    );
    return { hash: normalizedHash, bookId, bookFileId };
  }

  async listManualHashLinks(user: RequestUser): Promise<KoreaderManualHashLink[]> {
    const accessibleLibraryIds = await this.repo.getAccessibleLibraryIds(user.id);
    const rows = await this.repo.listBookHashLinks(user.id, MANUAL_HASH_LINK_LIMIT, accessibleLibraryIds);

    return rows.map((row) => ({
      hash: row.hash,
      bookId: row.bookId,
      bookFileId: row.bookFileId,
      bookTitle: row.bookTitle ?? null,
      bookAuthors: row.bookAuthors,
      koreaderTitle: row.koreaderTitle ?? null,
      koreaderAuthors: row.koreaderAuthors ?? null,
      koreaderLastOpen: row.koreaderLastOpen ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async relinkManualHashLink(user: RequestUser, hash: string, bookId: number): Promise<LinkKoreaderUnmatchedBookResult> {
    const startedAtMs = Date.now();
    const normalizedHash = this.normalizeKoreaderHash(hash);
    this.logger.log(
      `[${HASH_LINK_UPDATE_EVENT}] [start] userId=${user.id} hash=${normalizedHash.slice(0, 8)} bookId=${bookId} - hash link update started`,
    );

    const existingLink = await this.repo.getBookHashLink(user.id, normalizedHash);
    if (!existingLink) throw new NotFoundException('KOReader manual link not found');

    await this.bookService.verifyBookAccess(bookId, user);
    const bookFileId = await this.repo.findBookFileIdByBookId(bookId);
    if (!bookFileId) throw new BadRequestException('Book has no file to link');

    const accessibleLibraryIds = await this.repo.getAccessibleLibraryIds(user.id);
    const existingIntrinsicMatch = await this.repo.resolveBookFileByHash(normalizedHash, accessibleLibraryIds);
    if (existingIntrinsicMatch && existingIntrinsicMatch.id !== bookFileId) {
      throw new ConflictException('KOReader hash already matches a different book');
    }

    await this.repo.upsertBookHashLink(user.id, normalizedHash, bookFileId);
    await this.repo.clearUnmatchedBooks(user.id, [normalizedHash]);

    this.logger.log(
      `[${HASH_LINK_UPDATE_EVENT}] [end] userId=${user.id} hash=${normalizedHash.slice(0, 8)} bookId=${bookId} bookFileId=${bookFileId} durationMs=${Date.now() - startedAtMs} - hash link update completed`,
    );
    return { hash: normalizedHash, bookId, bookFileId };
  }

  async unlinkManualHashLink(user: RequestUser, hash: string): Promise<UnlinkKoreaderManualHashLinkResult> {
    const startedAtMs = Date.now();
    const normalizedHash = this.normalizeKoreaderHash(hash);
    this.logger.log(`[${HASH_LINK_DELETE_EVENT}] [start] userId=${user.id} hash=${normalizedHash.slice(0, 8)} - hash link delete started`);

    const deleted = await this.repo.deleteBookHashLink(user.id, normalizedHash);
    if (!deleted) throw new NotFoundException('KOReader manual link not found');

    const accessibleLibraryIds = await this.repo.getAccessibleLibraryIds(user.id);
    const existingIntrinsicMatch = await this.repo.resolveBookFileByHash(normalizedHash, accessibleLibraryIds);
    const restoredAsUnmatched = !existingIntrinsicMatch;
    if (restoredAsUnmatched) {
      await this.repo.upsertUnmatchedBooks(user.id, [
        {
          hash: normalizedHash,
          title: deleted.koreaderTitle,
          authors: deleted.koreaderAuthors,
          lastOpen: deleted.koreaderLastOpen,
          source: 'file',
          metadataAmbiguous: false,
        },
      ]);
    }

    this.logger.log(
      `[${HASH_LINK_DELETE_EVENT}] [end] userId=${user.id} hash=${normalizedHash.slice(0, 8)} durationMs=${Date.now() - startedAtMs} restoredAsUnmatched=${restoredAsUnmatched} - hash link delete completed`,
    );
    return { hash: normalizedHash };
  }

  async dismissUnmatchedBook(user: RequestUser, hash: string): Promise<DismissKoreaderUnmatchedBookResult> {
    const startedAtMs = Date.now();
    const normalizedHash = this.normalizeKoreaderHash(hash);
    this.logger.log(
      `[${UNMATCHED_BOOK_DISMISS_EVENT}] [start] userId=${user.id} hash=${normalizedHash.slice(0, 8)} - unmatched book dismiss started`,
    );

    const deleted = await this.repo.dismissUnmatchedBook(user.id, normalizedHash);
    if (!deleted) throw new NotFoundException('KOReader unmatched book not found');

    this.logger.log(
      `[${UNMATCHED_BOOK_DISMISS_EVENT}] [end] userId=${user.id} hash=${normalizedHash.slice(0, 8)} durationMs=${Date.now() - startedAtMs} - unmatched book dismiss completed`,
    );
    return { hash: normalizedHash };
  }

  async dismissAllUnmatchedBooks(user: RequestUser): Promise<DismissAllKoreaderUnmatchedBooksResult> {
    const startedAtMs = Date.now();
    this.logger.log(`[${UNMATCHED_BOOK_DISMISS_ALL_EVENT}] [start] userId=${user.id} - unmatched book bulk dismiss started`);

    const count = await this.repo.dismissAllUnmatchedBooks(user.id);

    this.logger.log(
      `[${UNMATCHED_BOOK_DISMISS_ALL_EVENT}] [end] userId=${user.id} durationMs=${Date.now() - startedAtMs} count=${count} - unmatched book bulk dismiss completed`,
    );
    return { count };
  }

  private normalizeKoreaderHash(hash: string): string {
    const normalized = hash.trim().toLowerCase();
    if (!MD5_HEX.test(normalized)) throw new BadRequestException('Invalid KOReader hash');
    return normalized;
  }
}

function isLinkableUnmatchedBook(row: { source?: string | null; metadataAmbiguous?: boolean | null } | null): boolean {
  return !!row && (row.source === 'current_file' || row.source === 'file') && row.metadataAmbiguous === false;
}
