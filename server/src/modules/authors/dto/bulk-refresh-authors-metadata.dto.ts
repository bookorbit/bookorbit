import { IsBoolean, IsOptional } from 'class-validator';

import { BulkAuthorIdsDto } from './bulk-author-ids.dto';

export class BulkRefreshAuthorsMetadataDto extends BulkAuthorIdsDto {
  /** Skip saved provider answers and ask every provider live. Absent keeps using the cache. */
  @IsOptional()
  @IsBoolean()
  ignoreCache?: boolean;
}
