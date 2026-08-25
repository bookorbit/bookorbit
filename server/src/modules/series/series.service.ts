import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { BooksPage, SeriesBooksPage, SeriesDetail, SeriesNextBookResponse, SeriesPage, SeriesSummary } from '@bookorbit/types';
import { READER_OPENABLE_FORMATS, getOpenableFormatsForGroup } from '@bookorbit/types';
import { MAX_OFFSET_ROWS, isOffsetWithinLimit } from '../../common/constants/pagination.constants';
import type { RequestUser } from '../../common/types/request-user';
import { MAX_SERIES_TOTAL_BOOKS, normalizeSeriesTotalBooks } from '../../common/utils/series-total-books.utils';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import { BookReadService } from '../book/book-read.service';
import { LibraryService } from '../library/library.service';
import { FindNextSeriesBookDto } from './dto/find-next-series-book.dto';
import { ListSeriesBooksDto } from './dto/list-series-books.dto';
import { ListSeriesDto } from './dto/list-series.dto';
import { SeriesRepository } from './series.repository';

@Injectable()
export class SeriesService {
  private readonly logger = new Logger(SeriesService.name);

  constructor(
    private readonly seriesRepo: SeriesRepository,
    private readonly bookReadService: BookReadService,
    private readonly libraryService: LibraryService,
  ) {}

  private assertPaginationWindow(page: number, size: number): void {
    if (!isOffsetWithinLimit(page * size)) {
      throw new BadRequestException(`pagination window is too deep; page * size must be <= ${MAX_OFFSET_ROWS}`);
    }
  }

  async findAll(user: RequestUser, dto: ListSeriesDto): Promise<SeriesPage> {
    const page = dto.page ?? 0;
    const size = dto.size ?? 50;
    this.assertPaginationWindow(page, size);

    const libraryIds = await this.resolveLibraryIds(user, dto.libraryId);
    if (libraryIds.length === 0) {
      return { items: [], total: 0, page, size };
    }

    const result = await this.seriesRepo.findPage({
      q: dto.q,
      page,
      size,
      sort: dto.sort ?? 'name',
      order: dto.order ?? 'asc',
      libraryIds,
      userId: user.id,
      completionStatus: dto.completionStatus,
      author: dto.author,
      contentFilters: user.isSuperuser ? undefined : user.contentFilters,
    });

    const items: SeriesSummary[] = result.items.map((row) => ({
      id: row.id,
      name: row.name,
      bookCount: row.bookCount,
      readCount: row.readCount,
      authors: row.authors,
      coverBookIds: row.coverBookIds,
      lastAddedAt: row.lastAddedAt ?? null,
    }));

    return { items, total: result.total, page: result.page, size: result.size };
  }

  /** Total series the user can browse; matches the unfiltered total of {@link findAll}. */
  async countAll(user: RequestUser): Promise<number> {
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    if (libraryIds.length === 0) return 0;
    return this.seriesRepo.countSeries({ libraryIds, contentFilters: user.isSuperuser ? undefined : user.contentFilters });
  }

  async findBooks(user: RequestUser, seriesId: number, dto: ListSeriesBooksDto): Promise<SeriesBooksPage> {
    const page = dto.page ?? 0;
    const size = dto.size ?? 50;
    this.assertPaginationWindow(page, size);

    const libraryIds = await this.resolveLibraryIds(user, dto.libraryId);
    if (libraryIds.length === 0) {
      throw new NotFoundException('Series not found');
    }

    const [detail, bookPage] = await Promise.all([
      this.seriesRepo.findDetail({
        seriesId,
        userId: user.id,
        libraryIds,
        contentFilters: user.isSuperuser ? undefined : user.contentFilters,
      }),
      this.seriesRepo.findBookIds({
        seriesId,
        page,
        size,
        sort: dto.sort ?? 'seriesIndex',
        order: dto.order ?? 'asc',
        libraryIds,
        contentFilters: user.isSuperuser ? undefined : user.contentFilters,
      }),
    ]);

    if (!detail) {
      if (dto.libraryId) {
        const allLibraryIds = await this.resolveLibraryIds(user);
        const existsInAnyLibrary = await this.seriesRepo.findDetail({
          seriesId,
          userId: user.id,
          libraryIds: allLibraryIds,
          contentFilters: user.isSuperuser ? undefined : user.contentFilters,
        });
        if (existsInAnyLibrary) {
          const emptyInfo: SeriesDetail = {
            id: existsInAnyLibrary.id,
            name: existsInAnyLibrary.name,
            bookCount: 0,
            readCount: 0,
            authors: existsInAnyLibrary.authors,
            possibleGaps: [],
            expectedBookCount: existsInAnyLibrary.expectedBookCount ?? null,
          };
          return { items: [], total: 0, page, size, seriesInfo: emptyInfo };
        }
      }
      throw new NotFoundException('Series not found');
    }

    const possibleGaps = this.computeGaps(detail.indices, detail.bookCount, detail.expectedBookCount);

    let items: BooksPage['items'] = [];
    if (bookPage.bookIds.length > 0) {
      const cardData = await this.bookReadService.findCardsByBookIds(bookPage.bookIds, user.id);
      const cards = assembleBookCards(
        cardData.rows,
        cardData.authorRows,
        cardData.fileRows,
        cardData.genreRows,
        cardData.progressRows,
        cardData.statusRows,
        cardData.narratorRows,
        cardData.tagRows,
        cardData.seriesMembershipRows,
      );
      const orderMap = new Map(bookPage.bookIds.map((id, i) => [id, i]));
      items = cards
        .map((card) => {
          const contextualSeries = (card.seriesMemberships ?? []).find((membership) => membership.seriesId === seriesId);
          return contextualSeries
            ? {
                ...card,
                seriesId: contextualSeries.seriesId,
                seriesName: contextualSeries.seriesName,
                seriesIndex: contextualSeries.seriesIndex,
              }
            : card;
        })
        .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
    }

    const seriesInfo: SeriesDetail = {
      id: detail.id,
      name: detail.name,
      bookCount: detail.bookCount,
      readCount: detail.readCount,
      authors: detail.authors,
      possibleGaps,
      expectedBookCount: detail.expectedBookCount ?? null,
    };

    return { items, total: bookPage.total, page, size, seriesInfo };
  }

  private computeGaps(indices: string[], bookCount: number, expectedBookCount: number | null): number[] {
    const integerIndices = indices
      .filter((idx) => /^\d+$/.test(idx))
      .map((idx) => Number(idx))
      .filter(Number.isSafeInteger);
    if (integerIndices.length === 0) return [];

    const min = Math.min(...integerIndices);
    const max = Math.max(...integerIndices);
    if (min < 1 || max > MAX_SERIES_TOTAL_BOOKS) return [];

    const expectedMax = this.resolveTrustedExpectedMax(indices, bookCount, integerIndices, expectedBookCount);

    // With no trusted total only interior holes are knowable, and one book has no interior.
    if (expectedMax === undefined) {
      if (integerIndices.length < 2) return [];
      return this.collectMissing(integerIndices, min, max);
    }

    return this.collectMissing(integerIndices, 1, expectedMax);
  }

  /**
   * A provider total turns "the books you own" into "the books the series has", which is the whole
   * point, but it also lets us name books as missing. Only trust it when nothing about the local
   * data contradicts it, because a false "you are missing #5" is worse than staying quiet.
   */
  private resolveTrustedExpectedMax(
    indices: string[],
    bookCount: number,
    integerIndices: number[],
    expectedBookCount: number | null,
  ): number | undefined {
    const expected = normalizeSeriesTotalBooks(expectedBookCount);
    if (expected === undefined) return undefined;

    // An owned book with no usable index would be reported missing, so every book must be numbered.
    if (indices.length !== bookCount || integerIndices.length !== indices.length) return undefined;

    // Owning a book numbered past the total means the total is stale or matched the wrong series.
    if (Math.max(...integerIndices) > expected) return undefined;

    return expected;
  }

  private collectMissing(integerIndices: number[], from: number, to: number): number[] {
    const present = new Set(integerIndices);
    const gaps: number[] = [];
    for (let i = from; i <= to; i++) {
      if (!present.has(i)) {
        gaps.push(i);
      }
    }
    return gaps;
  }

  /**
   * Backs the reader's end-of-book handoff. A neighbour the user cannot see, a book with no
   * readable file, and a book outside any series all resolve to null rather than an error, so
   * the reader can ask about every book it opens.
   */
  async findNextBook(user: RequestUser, seriesId: number, bookId: number, dto: FindNextSeriesBookDto): Promise<SeriesNextBookResponse> {
    const libraryIds = await this.resolveLibraryIds(user);
    if (libraryIds.length === 0) return { next: null };

    const row = await this.seriesRepo.findNextReadableBook({
      seriesId,
      bookId,
      libraryIds,
      formats: dto.formatGroup ? getOpenableFormatsForGroup(dto.formatGroup) : [...READER_OPENABLE_FORMATS],
      contentFilters: user.isSuperuser ? undefined : user.contentFilters,
    });

    if (!row?.format) return { next: null };

    return {
      next: {
        bookId: row.bookId,
        fileId: row.fileId,
        format: row.format,
        title: row.title,
        seriesIndex: row.seriesIndex,
      },
    };
  }

  private async resolveLibraryIds(user: RequestUser, scopedLibraryId?: number): Promise<number[]> {
    const libraries = await this.libraryService.findAll(user);
    const accessibleIds = libraries.map((library) => library.id);

    if (!scopedLibraryId) return accessibleIds;
    return accessibleIds.includes(scopedLibraryId) ? [scopedLibraryId] : [];
  }
}
