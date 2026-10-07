import type { BookmarkRow } from '../../../db/schema';

export class BookmarkResponseDto {
  id!: number;
  bookId!: number;
  cfi!: string | null;
  title!: string;
  positionSeconds!: number | null;
  createdAt!: Date;
  note!: string | null;
  updatedAt!: Date;
  clientId!: string;
  origin!: string;
  chapterId!: string | null;

  static from(row: BookmarkRow): BookmarkResponseDto {
    const dto = new BookmarkResponseDto();
    dto.id = row.id;
    dto.bookId = row.bookId;
    dto.cfi = row.cfi ?? null;
    dto.title = row.title;
    dto.positionSeconds = row.positionSeconds ?? null;
    dto.createdAt = row.createdAt;
    dto.note = row.note ?? null;
    dto.updatedAt = row.updatedAt;
    dto.clientId = row.clientId;
    dto.origin = row.origin;
    dto.chapterId = row.chapterId ?? null;
    return dto;
  }
}
