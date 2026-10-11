import { IsBoolean, IsOptional } from 'class-validator';

export class AuthorEnrichmentBackfillDto {
  /** Queue the authors so their enrichment skips saved provider answers. Absent keeps using the cache. */
  @IsOptional()
  @IsBoolean()
  ignoreCache?: boolean;
}
