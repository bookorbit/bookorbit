import type { AnnotationPdfPosition } from '@bookorbit/types';

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
  pdf!: AnnotationPdfPosition | null;

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
    dto.pdf = parsePdfPosition(row);
    dto.positionStatus = resolvePositionStatus(row);
    const chapterIndex = (row.cfiExtras as { chapterIndex?: number } | null)?.chapterIndex;
    dto.chapterIndex = typeof chapterIndex === 'number' ? chapterIndex : null;
    dto.createdAt = row.createdAt;
    return dto;
  }
}

function resolvePositionStatus(row: AnnotationWithCfi): string | null {
  if (row.cfi != null || row.cfiStatus != null) return row.cfiStatus ?? 'exact';
  if (row.pdfPos0 != null || row.pdfStatus != null) return row.pdfStatus ?? 'exact';
  return null;
}

function parsePdfPosition(row: AnnotationWithCfi): AnnotationPdfPosition | null {
  if (!row.pdfPos0) return null;
  try {
    const parsed = JSON.parse(row.pdfPos0) as Partial<AnnotationPdfPosition>;
    if (!parsed || !parsed.rect || !Array.isArray(parsed.rects)) return null;
    const page = typeof parsed.page === 'number' ? parsed.page : row.pageno != null ? row.pageno - 1 : 0;
    return { page, rect: parsed.rect, rects: parsed.rects };
  } catch {
    return null;
  }
}
