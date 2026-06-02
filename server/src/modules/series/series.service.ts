import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { BooksPage, SeriesBooksPage, SeriesDetail, SeriesPage, SeriesSummary } from '@bookorbit/types';
import { MAX_OFFSET_ROWS, isOffsetWithinLimit } from '../../common/constants/pagination.constants';
import type { RequestUser } from '../../common/types/request-user';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import { BookReadService } from '../book/book-read.service';
import { LibraryService } from '../library/library.service';
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
          };
          return { items: [], total: 0, page, size, seriesInfo: emptyInfo };
        }
      }
      throw new NotFoundException('Series not found');
    }

    const possibleGaps = this.computeGaps(detail.indices);

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
      );
      const orderMap = new Map(bookPage.bookIds.map((id, i) => [id, i]));
      items = cards.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
    }

    const seriesInfo: SeriesDetail = {
      id: detail.id,
      name: detail.name,
      bookCount: detail.bookCount,
      readCount: detail.readCount,
      authors: detail.authors,
      possibleGaps,
    };

    return { items, total: bookPage.total, page, size, seriesInfo };
  }

  private computeGaps(indices: number[]): number[] {
    const integerIndices = indices.filter((idx) => Math.abs(Math.round(idx) - idx) < 0.01).map((idx) => Math.round(idx));

    if (integerIndices.length < 2) return [];

    const min = Math.min(...integerIndices);
    const max = Math.max(...integerIndices);

    if (min < 1 || max > 10_000) return [];

    const present = new Set(integerIndices);
    const gaps: number[] = [];
    for (let i = min; i <= max; i++) {
      if (!present.has(i)) {
        gaps.push(i);
      }
    }
    return gaps;
  }

  private async resolveLibraryIds(user: RequestUser, scopedLibraryId?: number): Promise<number[]> {
    const libraries = await this.libraryService.findAll(user);
    const accessibleIds = libraries.map((library) => library.id);

    if (!scopedLibraryId) return accessibleIds;
    return accessibleIds.includes(scopedLibraryId) ? [scopedLibraryId] : [];
  }
}
