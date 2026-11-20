import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';

import {
  STORY_GUIDE_FIX_KEY_MAX_LENGTH,
  STORY_GUIDE_FIX_KINDS,
  STORY_GUIDE_FIX_NAME_MAX_LENGTH,
  STORY_GUIDE_FIX_NAMES_MAX,
  STORY_GUIDE_FIXES_PAGE_MAX,
  type PutStoryGuideFixRequest,
  type StoryGuideFixKind,
  type StoryGuideFixPosition,
  type StoryGuideFixTarget,
} from '@bookorbit/types';

import { storyGuideFixProblem } from '../fixes/story-guide-fix-data';

const MAX_INT = 2_147_483_647;

export class StoryGuideFixTargetDto implements StoryGuideFixTarget {
  @IsString()
  @MinLength(1)
  @MaxLength(STORY_GUIDE_FIX_KEY_MAX_LENGTH)
  key!: string;

  @IsArray()
  @ArrayMaxSize(STORY_GUIDE_FIX_NAMES_MAX)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(STORY_GUIDE_FIX_NAME_MAX_LENGTH, { each: true })
  names!: string[];
}

export class StoryGuideFixPositionDto implements StoryGuideFixPosition {
  @IsInt()
  @Min(0)
  @Max(MAX_INT)
  s!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_INT)
  o!: number;
}

@ValidatorConstraint({ name: 'storyGuideFixData', async: false })
class StoryGuideFixDataConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    return problemOf(value, args) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return problemOf(args.value, args) ?? 'data is invalid';
  }
}

function problemOf(value: unknown, args: ValidationArguments): string | null {
  const fix = args.object as Partial<PutStoryGuideFixDto>;
  return storyGuideFixProblem({
    kind: String(fix.kind),
    targetKey: (fix.target as { key?: unknown } | undefined)?.key,
    data: value,
    hasFrom: !!fix.from,
    deleted: fix.deleted === true,
  });
}

export class PutStoryGuideFixDto implements PutStoryGuideFixRequest {
  @IsIn(STORY_GUIDE_FIX_KINDS)
  kind!: StoryGuideFixKind;

  @ValidateNested()
  @Type(() => StoryGuideFixTargetDto)
  target!: StoryGuideFixTargetDto;

  // Deliberately not @ValidateNested: its keys are free beyond what the kind reads.
  @Validate(StoryGuideFixDataConstraint)
  data!: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoryGuideFixPositionDto)
  from?: StoryGuideFixPositionDto | null;

  @IsISO8601({ strict: true })
  updatedAt!: string;

  @IsOptional()
  @IsBoolean()
  deleted?: boolean;
}

export class StoryGuideFixesQueryDto {
  /** A cursor this server returned. Empty or absent reads from the start. */
  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,14})?$/, { message: 'since must be a cursor returned by this endpoint' })
  since?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(STORY_GUIDE_FIXES_PAGE_MAX)
  limit?: number;
}
