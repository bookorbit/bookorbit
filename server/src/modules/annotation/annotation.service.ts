import { Injectable, NotFoundException } from '@nestjs/common';

import type { AnnotationListResponse } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { AchievementEventsService, ACHIEVEMENT_EVENT_ANNOTATION_CREATED } from '../achievement/achievement-events.service';
import { DEFAULT_ANNOTATION_COLOR, DEFAULT_ANNOTATION_STYLE } from './annotation.constants';
import { AnnotationConversionService } from './annotation-conversion.service';
import { AnnotationRepository, type AnnotationFilters, type AnnotationSort } from './annotation.repository';
import { AnnotationResponseDto } from './dto/annotation-response.dto';
import { CreateAnnotationDto } from './dto/create-annotation.dto';
import { AnnotationQueryDto } from './dto/annotation-query.dto';
import { UpdateAnnotationDto } from './dto/update-annotation.dto';

@Injectable()
export class AnnotationService {
  constructor(
    private readonly annotationRepo: AnnotationRepository,
    private readonly bookService: BookService,
    private readonly achievementEvents: AchievementEventsService,
    private readonly conversionService: AnnotationConversionService,
  ) {}

  async getAnnotations(bookId: number, user: RequestUser): Promise<AnnotationResponseDto[]> {
    await this.bookService.verifyBookAccess(bookId, user);
    await this.conversionService.ensureCfiPositionsForBook(user.id, bookId);
    const rows = await this.annotationRepo.findByBookId(bookId, user.id);
    return rows.map((row) => AnnotationResponseDto.from(row));
  }

  async getAnnotationsPaginated(bookId: number, user: RequestUser, query: AnnotationQueryDto): Promise<AnnotationListResponse> {
    await this.bookService.verifyBookAccess(bookId, user);

    const filters = this.buildFilters(query);
    const sort = this.buildSort(query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const [{ items, total }, statsResult, chapters] = await Promise.all([
      this.annotationRepo.findPaginated(bookId, user.id, filters, sort, page, pageSize),
      this.annotationRepo.getStats(bookId, user.id, filters),
      this.annotationRepo.getDistinctChapters(bookId, user.id),
    ]);

    return {
      items: items.map((row) => {
        const dto = AnnotationResponseDto.from(row);
        return {
          id: dto.id,
          bookId: dto.bookId,
          cfi: dto.cfi,
          jumpFileId: dto.jumpFileId,
          pageno: dto.pageno,
          text: dto.text,
          color: dto.color,
          style: dto.style,
          note: dto.note,
          chapterTitle: dto.chapterTitle,
          origin: dto.origin as 'web' | 'koreader' | 'kobo',
          positionStatus: dto.positionStatus as AnnotationListResponse['items'][number]['positionStatus'],
          chapterIndex: dto.chapterIndex,
          createdAt: dto.createdAt instanceof Date ? dto.createdAt.toISOString() : String(dto.createdAt),
        };
      }),
      total,
      page,
      pageSize,
      stats: {
        ...statsResult,
        chapters,
      },
    };
  }

  async createAnnotation(bookId: number, user: RequestUser, dto: CreateAnnotationDto): Promise<AnnotationResponseDto> {
    await this.bookService.verifyBookAccess(bookId, user);
    const row = await this.annotationRepo.create({
      userId: user.id,
      bookId,
      cfi: dto.cfi,
      bookFileId: dto.bookFileId ?? null,
      text: dto.text,
      color: dto.color ?? DEFAULT_ANNOTATION_COLOR,
      style: dto.style ?? DEFAULT_ANNOTATION_STYLE,
      note: dto.note ?? null,
      chapterTitle: dto.chapterTitle ?? null,
    });
    this.achievementEvents.emit(ACHIEVEMENT_EVENT_ANNOTATION_CREATED, {
      userId: user.id,
      bookId,
      annotationId: row.id,
    });
    return AnnotationResponseDto.from(row);
  }

  async updateAnnotation(bookId: number, annotationId: number, user: RequestUser, dto: UpdateAnnotationDto): Promise<AnnotationResponseDto> {
    await this.bookService.verifyBookAccess(bookId, user);
    const row = await this.annotationRepo.update(bookId, annotationId, user.id, {
      ...(dto.note !== undefined && { note: dto.note }),
      ...(dto.color !== undefined && { color: dto.color }),
      ...(dto.style !== undefined && { style: dto.style }),
    });
    if (!row) throw new NotFoundException(this.notFoundMessage(bookId, annotationId));
    return AnnotationResponseDto.from(row);
  }

  async deleteAnnotation(bookId: number, annotationId: number, user: RequestUser): Promise<void> {
    await this.bookService.verifyBookAccess(bookId, user);
    const deleted = await this.annotationRepo.softDelete(bookId, annotationId, user.id);
    if (!deleted) throw new NotFoundException(this.notFoundMessage(bookId, annotationId));
  }

  private buildFilters(query: AnnotationQueryDto): AnnotationFilters {
    return {
      colors: query.colors
        ? query.colors
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean)
        : undefined,
      search: query.search || undefined,
      chapter: query.chapter || undefined,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    };
  }

  private buildSort(query: AnnotationQueryDto): AnnotationSort {
    return {
      by: query.sortBy ?? 'position',
      dir: query.sortDir ?? 'asc',
    };
  }

  private notFoundMessage(bookId: number, annotationId: number): string {
    return `Annotation ${annotationId} not found for book ${bookId}`;
  }
}
