import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

import {
  AI_JOB_KINDS,
  AI_SLOT_EFFORTS,
  STORY_GUIDE_LIST_DIRECTIONS,
  STORY_GUIDE_LIST_MAX_LIMIT,
  STORY_GUIDE_LIST_MAX_QUERY,
  STORY_GUIDE_LIST_SORTS,
  type AiSlotEffort,
  type StoryGuideListDirection,
  type StoryGuideListSort,
  type StoryGuideBuildKind,
  type StoryGuideBuildRequest,
  type StoryGuideDeleteAllRequest,
  type StoryGuideFileRequest,
  type StoryGuideFixesChoice,
  type StoryGuideSpeedResetRequest,
} from '@bookorbit/types';

const MAX_ID = 2_147_483_647;
const MAX_OFFSET = 1_000_000;
const FIXES_CHOICES: readonly StoryGuideFixesChoice[] = ['keep', 'delete'];

/** `?fileId=` on status and delete: the book file the guide is for; absent picks the book's first. */
export class StoryGuideFileQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ID)
  fileId?: number;
}

export class StoryGuideDeleteQueryDto extends StoryGuideFileQueryDto {
  /** Fixes managers made to this guide: kept for a rebuild, or deleted with it. */
  @IsOptional()
  @IsIn(FIXES_CHOICES)
  fixes?: StoryGuideFixesChoice;
}

export class StoryGuideFileDto implements StoryGuideFileRequest {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_ID)
  fileId?: number;
}

export class StoryGuideBuildDto extends StoryGuideFileDto implements StoryGuideBuildRequest {
  @IsIn(AI_JOB_KINDS)
  kind!: StoryGuideBuildKind;
}

export class StoryGuideDeleteAllDto implements StoryGuideDeleteAllRequest {
  @IsIn(FIXES_CHOICES)
  fixes!: StoryGuideFixesChoice;

  @IsInt()
  @Min(0)
  @Max(MAX_ID)
  count!: number;
}

/** `?format=1` or `?format=1,2`: the payload formats the caller reads. */
export class StoryGuideContentQueryDto {
  /** The payload formats the caller reads; absent means 1. */
  @IsOptional()
  @Matches(/^[1-9][0-9]{0,2}(,[1-9][0-9]{0,2}){0,9}$/, { message: 'format must list payload format numbers, such as 1 or 1,2' })
  format?: string;
}

export class StoryGuideSpeedResetDto implements StoryGuideSpeedResetRequest {
  @IsInt()
  @Min(1)
  @Max(MAX_ID)
  connectionId!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  model!: string;

  @IsOptional()
  @IsIn(AI_SLOT_EFFORTS)
  effort?: AiSlotEffort;
}

/** `GET admin/ai/features/story-guides/guides`: a page of stored guides, newest first unless asked otherwise. */
export class StoryGuideListQueryDto {
  /** Part of a book title. */
  @IsOptional()
  @IsString()
  @MaxLength(STORY_GUIDE_LIST_MAX_QUERY)
  q?: string;

  @IsOptional()
  @IsIn(STORY_GUIDE_LIST_SORTS)
  sort?: StoryGuideListSort = 'built';

  @IsOptional()
  @IsIn(STORY_GUIDE_LIST_DIRECTIONS)
  direction?: StoryGuideListDirection = 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_OFFSET)
  offset?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(STORY_GUIDE_LIST_MAX_LIMIT)
  limit?: number = 50;
}
