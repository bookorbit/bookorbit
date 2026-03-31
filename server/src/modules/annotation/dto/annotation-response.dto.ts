import type { AnnotationRow } from '../../../db/schema';

export class AnnotationResponseDto {
  id!: number;
  bookId!: number;
  cfi!: string;
  text!: string;
  color!: string;
  style!: string;
  note!: string | null;
  chapterTitle!: string | null;
  createdAt!: Date;

  static from(row: AnnotationRow): AnnotationResponseDto {
    const dto = new AnnotationResponseDto();
    dto.id = row.id;
    dto.bookId = row.bookId;
    dto.cfi = row.cfi;
    dto.text = row.text;
    dto.color = row.color;
    dto.style = row.style;
    dto.note = row.note ?? null;
    dto.chapterTitle = row.chapterTitle ?? null;
    dto.createdAt = row.createdAt;
    return dto;
  }
}
