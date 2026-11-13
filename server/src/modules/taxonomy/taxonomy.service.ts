import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and } from 'drizzle-orm';

import type {
  BookQuery,
  BooksPage,
  JumpBucketsQuery,
  JumpBucketsResponse,
  TaxonomyDetail,
  TaxonomyKind,
  TaxonomyPage,
  TaxonomySimilarResponse,
} from '@bookorbit/types';
import { MAX_OFFSET_ROWS, isOffsetWithinLimit } from '../../common/constants/pagination.constants';
import type { RequestUser } from '../../common/types/request-user';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import { BookService } from '../book/book.service';
import { BookQueryBuilder } from '../book/book-query-builder.service';
import { LibraryService } from '../library/library.service';
import type { ListTaxonomyDto } from './dto/list-taxonomy.dto';
import { TaxonomyRepository, type TaxonomyEntry, type TaxonomyVisibility } from './taxonomy.repository';

const SIMILAR_NAME_LIMIT = 40;

/**
 * Browsing by genre or tag. Every answer is counted over the books the viewer can see, so a name
 * that only appears on books in libraries they cannot open, or on books their content filters
 * hide, does not exist for them.
 */
@Injectable()
export class TaxonomyService {
  private readonly logger = new Logger(TaxonomyService.name);

  constructor(
    private readonly repo: TaxonomyRepository,
    private readonly libraryService: LibraryService,
    private readonly bookService: BookService,
    private readonly queryBuilder: BookQueryBuilder,
  ) {}

  async findPage(kind: TaxonomyKind, user: RequestUser, dto: ListTaxonomyDto): Promise<TaxonomyPage> {
    const page = dto.page ?? 0;
    const size = dto.size ?? 50;
    if (!isOffsetWithinLimit(page * size)) {
      throw new BadRequestException(`pagination window is too deep; page * size must be <= ${MAX_OFFSET_ROWS}`);
    }

    const visibility = await this.visibility(user, dto.libraryId);
    if (visibility.libraryIds.length === 0) {
      return { items: [], total: 0, page, size, totals: { genre: 0, tag: 0 } };
    }

    const [result, genreTotal, tagTotal] = await Promise.all([
      this.repo.findPage({
        kind,
        visibility,
        userId: user.id,
        q: dto.q || undefined,
        page,
        size,
        sort: dto.sort ?? 'name',
        order: dto.order ?? 'asc',
      }),
      this.repo.countVisible('genre', visibility),
      this.repo.countVisible('tag', visibility),
    ]);

    const covers = await this.repo.findCoverBookIds(
      kind,
      result.items.map((item) => item.id),
      visibility,
    );

    return {
      items: result.items.map((item) => ({ ...item, coverBookIds: covers.get(item.id) ?? [] })),
      total: result.total,
      page,
      size,
      totals: { genre: genreTotal, tag: tagTotal },
    };
  }

  async countVisible(kind: TaxonomyKind, user: RequestUser): Promise<number> {
    return this.repo.countVisible(kind, await this.visibility(user));
  }

  async findDetail(kind: TaxonomyKind, id: number, user: RequestUser): Promise<TaxonomyDetail> {
    const visibility = await this.visibility(user);
    const entry = await this.findVisibleEntry(kind, id, visibility);
    const libraries = await this.repo.findLibraryCounts(kind, id, visibility);
    if (libraries.length === 0) throw this.notFound(kind);

    return {
      id: entry.id,
      kind,
      name: entry.name,
      bookCount: libraries.reduce((sum, library) => sum + library.bookCount, 0),
      libraries,
    };
  }

  async findSimilar(kind: TaxonomyKind, id: number, user: RequestUser): Promise<TaxonomySimilarResponse> {
    const visibility = await this.visibility(user);
    const entry = await this.findVisibleEntry(kind, id, visibility);
    if (!(await this.repo.hasVisibleBooks(kind, id, visibility))) throw this.notFound(kind);
    const items = await this.repo.findSimilar(kind, entry, visibility, SIMILAR_NAME_LIMIT);
    return { items };
  }

  async queryBooks(kind: TaxonomyKind, id: number, user: RequestUser, query: BookQuery, libraryId?: number): Promise<BooksPage> {
    const start = Date.now();
    const where = await this.buildBooksWhere(kind, id, user, query, libraryId);
    if (!where) return { items: [], total: 0, page: query.pagination.page, size: query.pagination.size };

    try {
      const result = await this.bookService.executeBooksQuery(user.id, where, query, {
        seriesSelectionFilter: query.filter,
        viewer: user,
      });
      const durationMs = Date.now() - start;
      if (durationMs >= 500) {
        this.logger.warn(
          `[taxonomy.query_books] [end] kind=${kind} id=${id} userId=${user.id} resultCount=${result.items.length} durationMs=${durationMs} - slow query`,
        );
      }
      return result;
    } catch (err) {
      this.logger.error(
        `[taxonomy.query_books] [fail] kind=${kind} id=${id} userId=${user.id} durationMs=${Date.now() - start} errorClass=${(err as Error).constructor?.name} - query failed`,
      );
      throw err;
    }
  }

  async queryJumpBuckets(
    kind: TaxonomyKind,
    id: number,
    user: RequestUser,
    query: JumpBucketsQuery,
    libraryId?: number,
  ): Promise<JumpBucketsResponse> {
    const where = await this.buildBooksWhere(kind, id, user, query, libraryId);
    if (!where) return { buckets: [], total: 0, kind: 'letter', granularity: null };
    return this.bookService.executeJumpBucketsQuery(user.id, where, query, this.timeZone(user), {
      seriesSelectionFilter: query.filter,
    });
  }

  private async buildBooksWhere(kind: TaxonomyKind, id: number, user: RequestUser, query: BookQuery, libraryId?: number) {
    const visibility = await this.visibility(user, libraryId);
    if (visibility.libraryIds.length === 0) return null;
    const where = this.queryBuilder.buildWhere(query.filter, {
      accessibleLibraryIds: visibility.libraryIds,
      userId: user.id,
      q: query.q,
      timeZone: this.timeZone(user),
      contentFilters: visibility.contentFilters,
    });
    return and(where, this.repo.membershipClause(kind, id))!;
  }

  private async findVisibleEntry(kind: TaxonomyKind, id: number, visibility: TaxonomyVisibility): Promise<TaxonomyEntry> {
    if (visibility.libraryIds.length === 0) throw this.notFound(kind);
    const entry = await this.repo.findEntry(kind, id);
    if (!entry) throw this.notFound(kind);
    return entry;
  }

  private async visibility(user: RequestUser, libraryId?: number): Promise<TaxonomyVisibility> {
    const accessible = await this.libraryService.findAccessibleLibraryIds(user);
    const libraryIds = libraryId === undefined ? accessible : accessible.filter((candidate) => candidate === libraryId);
    return { libraryIds, contentFilters: user.isSuperuser ? undefined : user.contentFilters };
  }

  private timeZone(user: RequestUser): string {
    return resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
  }

  private notFound(kind: TaxonomyKind): NotFoundException {
    return new NotFoundException(kind === 'genre' ? 'Genre not found' : 'Tag not found');
  }
}
