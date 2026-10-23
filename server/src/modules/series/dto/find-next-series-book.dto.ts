import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

import { READER_GROUP_DEFAULTS, type ReaderFormatGroup } from '@bookorbit/types';

const READER_FORMAT_GROUPS = Object.keys(READER_GROUP_DEFAULTS) as ReaderFormatGroup[];

export class FindNextSeriesBookDto {
  /** Restricts the next book to a file the same reader can open. Omitted means any readable format. */
  @IsOptional()
  @IsIn(READER_FORMAT_GROUPS)
  formatGroup?: ReaderFormatGroup;

  /** Released native builds cannot open DjVu, so it is offered only to a caller that asks for it. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeDjvu?: boolean;
}
