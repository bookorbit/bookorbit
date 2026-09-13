import { IsIn, IsOptional } from 'class-validator';

import { READER_GROUP_DEFAULTS, type ReaderFormatGroup } from '@bookorbit/types';

const READER_FORMAT_GROUPS = Object.keys(READER_GROUP_DEFAULTS) as ReaderFormatGroup[];

export class FindNextSeriesBookDto {
  /** Restricts the next book to a file the same reader can open. Omitted means any readable format. */
  @IsOptional()
  @IsIn(READER_FORMAT_GROUPS)
  formatGroup?: ReaderFormatGroup;
}
