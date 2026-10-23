import { IsBoolean, IsOptional } from 'class-validator';

import { BulkBookIdsDto } from './bulk-book-ids.dto';

/** Only the metadata refresh accepts `ignoreCache`; other bulk endpoints keep rejecting it. */
export class BulkRefreshMetadataDto extends BulkBookIdsDto {
  @IsOptional()
  @IsBoolean()
  ignoreCache?: boolean;
}
