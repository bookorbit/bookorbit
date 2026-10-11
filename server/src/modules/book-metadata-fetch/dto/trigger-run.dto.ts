import { IsBoolean, IsOptional } from 'class-validator';

/** Optional body for a manual run; sent with no body, a run uses cached provider answers. */
export class TriggerBookMetadataFetchRunDto {
  @IsOptional()
  @IsBoolean()
  ignoreCache?: boolean;
}
