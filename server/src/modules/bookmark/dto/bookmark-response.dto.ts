import type { BookmarkRow } from '../../../db/schema';

export class BookmarkResponseDto {
  id!: number;
  bookId!: number;
  cfi!: string | null;
  title!: string;
  positionSeconds!: number | null;
  createdAt!: Date;

  static from(row: BookmarkRow): BookmarkResponseDto {
    const dto = new BookmarkResponseDto();
    dto.id = row.id;
    dto.bookId = row.bookId;
    dto.cfi = row.cfi ?? null;
    dto.title = row.title;
    dto.positionSeconds = row.positionSeconds ?? null;
    dto.createdAt = row.createdAt;
    return dto;
  }
}
