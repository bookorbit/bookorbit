import type { AnnotationWithCfi } from '../annotation.repository';

export class AnnotationResponseDto {
  id!: number;
  bookId!: number;
  cfi!: string | null;
  jumpFileId!: number | null;
  pageno!: number | null;
  text!: string;
  color!: string;
  style!: string;
  note!: string | null;
  chapterTitle!: string | null;
  origin!: string;
  positionStatus!: string | null;
  chapterIndex!: number | null;
  createdAt!: Date;

  static from(row: AnnotationWithCfi): AnnotationResponseDto {
    const dto = new AnnotationResponseDto();
    dto.id = row.id;
    dto.bookId = row.bookId;
    dto.cfi = row.cfi;
    dto.jumpFileId = row.jumpFileId;
    dto.pageno = row.pageno;
    dto.text = row.text;
    dto.color = row.color;
    dto.style = row.style;
    dto.note = row.note ?? null;
    dto.chapterTitle = row.chapterTitle ?? null;
    dto.origin = row.origin;
    dto.positionStatus = row.cfi != null || row.cfiStatus != null ? (row.cfiStatus ?? 'exact') : null;
    const chapterIndex = (row.cfiExtras as { chapterIndex?: number } | null)?.chapterIndex;
    dto.chapterIndex = typeof chapterIndex === 'number' ? chapterIndex : null;
    dto.createdAt = row.createdAt;
    return dto;
  }
}
