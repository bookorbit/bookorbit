import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import { STORY_EDITS_PAGE_MAX } from '@bookorbit/types';

export class StoryEditsQueryDto {
  /** A cursor this server returned. Empty or absent reads from the start. */
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,14})?$/, { message: 'since must be a cursor returned by this endpoint' })
  since?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(STORY_EDITS_PAGE_MAX)
  limit?: number;
}
