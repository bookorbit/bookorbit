import { Injectable, NotFoundException } from '@nestjs/common';

import { AnnotationRepository } from './annotation.repository';
import { CreateAnnotationDto } from './dto/create-annotation.dto';
import { UpdateAnnotationDto } from './dto/update-annotation.dto';

@Injectable()
export class AnnotationService {
  constructor(private readonly annotationRepo: AnnotationRepository) {}

  async getAnnotations(bookId: number, userId: number) {
    return this.annotationRepo.findByBookId(bookId, userId);
  }

  async createAnnotation(userId: number, bookId: number, dto: CreateAnnotationDto) {
    return this.annotationRepo.create({
      userId,
      bookId,
      cfi: dto.cfi,
      text: dto.text,
      color: dto.color ?? 'yellow',
      style: dto.style ?? 'highlight',
      note: dto.note ?? null,
      chapterTitle: dto.chapterTitle ?? null,
    });
  }

  async updateAnnotation(bookId: number, annotationId: number, userId: number, dto: UpdateAnnotationDto) {
    const row = await this.annotationRepo.update(bookId, annotationId, userId, {
      ...(dto.note !== undefined && { note: dto.note }),
      ...(dto.color !== undefined && { color: dto.color }),
      ...(dto.style !== undefined && { style: dto.style }),
    });
    if (!row) throw new NotFoundException(`Annotation ${annotationId} not found for book ${bookId}`);
    return row;
  }

  async deleteAnnotation(bookId: number, annotationId: number, userId: number) {
    const deleted = await this.annotationRepo.delete(bookId, annotationId, userId);
    if (!deleted) throw new NotFoundException(`Annotation ${annotationId} not found for book ${bookId}`);
  }
}
