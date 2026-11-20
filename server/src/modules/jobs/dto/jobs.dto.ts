import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import {
  JOB_ACTION_MAX_IDS,
  JOB_ACTIONS,
  JOB_ID_PATTERN,
  JOB_LIST_DEFAULT_LIMIT,
  JOB_LIST_MAX_LIMIT,
  JOB_SCOPES,
  JOB_TYPES,
  JOB_VIEWS,
  type JobActionKind,
  type JobActionRequest,
  type JobScope,
  type JobType,
  type JobView,
} from '@bookorbit/types';

/** Far longer than any cursor this server mints; it only bounds what is decoded. */
const MAX_CURSOR_LENGTH = 1_024;

export class JobListQueryDto {
  @IsOptional()
  @IsIn(JOB_VIEWS)
  view?: JobView = 'queue';

  /** Only this type's jobs; every type the viewer sees when absent. */
  @IsOptional()
  @IsIn(JOB_TYPES)
  type?: JobType;

  @IsOptional()
  @IsIn(JOB_SCOPES)
  scope?: JobScope = 'mine';

  /** The `next` of the previous page. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CURSOR_LENGTH)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(JOB_LIST_MAX_LIMIT)
  limit?: number = JOB_LIST_DEFAULT_LIMIT;

  /** `1` adds how many jobs each counted view holds. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  counts?: boolean = false;
}

export class JobActionDto implements JobActionRequest {
  @IsIn(JOB_ACTIONS)
  action!: JobActionKind;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(JOB_ACTION_MAX_IDS)
  @IsString({ each: true })
  @Matches(new RegExp(JOB_ID_PATTERN), { each: true })
  ids!: string[];
}
