import type { UserFont } from '@bookorbit/types';
import type { ServerFontRow, UserFontRow } from '../../../db/schema';

/** The columns user and server font rows have in common, which is all the wire shape needs. */
export type FontRowLike = Pick<
  UserFontRow & ServerFontRow,
  'id' | 'familyName' | 'originalFileName' | 'format' | 'weight' | 'style' | 'fileSize' | 'createdAt'
>;

export function toFontResponse(row: FontRowLike): UserFont {
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
