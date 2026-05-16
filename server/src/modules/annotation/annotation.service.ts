import { Injectable, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { AchievementEventsService, ACHIEVEMENT_EVENT_ANNOTATION_CREATED } from '../achievement/achievement-events.service';
import { DEFAULT_ANNOTATION_COLOR, DEFAULT_ANNOTATION_STYLE } from './annotation.constants';
import { AnnotationRepository } from './annotation.repository';
import { AnnotationResponseDto } from './dto/annotation-response.dto';
import { CreateAnnotationDto } from './dto/create-annotation.dto';
import { UpdateAnnotationDto } from './dto/update-annotation.dto';

@Injectable()
export class AnnotationService {
  constructor(
    private readonly annotationRepo: AnnotationRepository,
    private readonly bookService: BookService,
    private readonly achievementEvents: AchievementEventsService,
  ) {}

  async getAnnotations(bookId: number, user: RequestUser): Promise<AnnotationResponseDto[]> {
    await this.bookService.verifyBookAccess(bookId, user);
    const rows = await this.annotationRepo.findByBookId(bookId, user.id);
    return rows.map((row) => AnnotationResponseDto.from(row));
  }

  async createAnnotation(bookId: number, user: RequestUser, dto: CreateAnnotationDto): Promise<AnnotationResponseDto> {
    await this.bookService.verifyBookAccess(bookId, user);
    const row = await this.annotationRepo.create({
      userId: user.id,
      bookId,
      cfi: dto.cfi,
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
    const deleted = await this.annotationRepo.delete(bookId, annotationId, user.id);
    if (!deleted) throw new NotFoundException(this.notFoundMessage(bookId, annotationId));
  }

  private notFoundMessage(bookId: number, annotationId: number): string {
    return `Annotation ${annotationId} not found for book ${bookId}`;
  }
}
