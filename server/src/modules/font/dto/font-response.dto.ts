import type { UserFont } from '@bookorbit/types';
import type { UserFontRow } from '../../../db/schema';

export function toFontResponse(row: UserFontRow): UserFont {
  return {
    id: row.id,
    familyName: row.familyName,
    originalFileName: row.originalFileName,
    format: row.format,
    weight: row.weight,
    style: row.style as 'normal' | 'italic',
    fileSize: row.fileSize,
    createdAt: row.createdAt.toISOString(),
  };
}
