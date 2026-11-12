import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import {
  AI_JOB_ACTION_MAX_IDS,
  AI_JOB_ACTIONS,
  AI_JOB_LIST_MAX_LIMIT,
  AI_JOB_LIST_SCOPES,
  AI_JOB_LIST_VIEWS,
  type AiJobActionRequest,
  type AiJobListScope,
  type AiJobListView,
  type AiJobQueueAction,
} from '@bookorbit/types';

/** Rows past this offset are never asked for by a page; it only bounds a scan. */
const MAX_OFFSET = 1_000_000;

export class AiJobListQueryDto {
  @IsOptional()
  @IsIn(AI_JOB_LIST_VIEWS)
  view?: AiJobListView = 'queue';

  @IsOptional()
  @IsIn(AI_JOB_LIST_SCOPES)
  scope?: AiJobListScope = 'mine';

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
  @Max(AI_JOB_LIST_MAX_LIMIT)
  limit?: number = 50;
}

export class AiJobActionDto implements AiJobActionRequest {
  @IsIn(AI_JOB_ACTIONS)
  action!: AiJobQueueAction;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AI_JOB_ACTION_MAX_IDS)
  @IsUUID('all', { each: true })
  ids!: string[];
}
