import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateBy,
  ValidateNested,
  ValidationOptions,
} from 'class-validator';
import type { ReadAloudAudioExclusion, ReadAloudChapterDecision } from '@bookorbit/types';

const CHAPTER_DECISIONS = new Set<ReadAloudChapterDecision>(['excluded', 'included', 'approved']);
const MAX_CHAPTERS = 2_000;
const MAX_HREF_LENGTH = 500;

function IsChapterDecisionMap(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isChapterDecisionMap',
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          return (
            entries.length <= MAX_CHAPTERS &&
            entries.every(
              ([href, decision]) => href.length > 0 && href.length <= MAX_HREF_LENGTH && CHAPTER_DECISIONS.has(decision as ReadAloudChapterDecision),
            )
          );
        },
        defaultMessage: () => 'chapters must map chapter hrefs to "excluded", "included" or "approved"',
      },
    },
    options,
  );
}

export class ReadAloudAudioExclusionDto implements ReadAloudAudioExclusion {
  @IsString()
  @MaxLength(MAX_HREF_LENGTH)
  track!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  start!: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  end!: number | null;
}

export class ReadAloudDecisionsDto {
  @IsChapterDecisionMap()
  chapters!: Record<string, ReadAloudChapterDecision>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReadAloudAudioExclusionDto)
  audio?: ReadAloudAudioExclusionDto[];
}

export class ResyncReadAloudJobDto {
  @ValidateNested()
  @Type(() => ReadAloudDecisionsDto)
  decisions!: ReadAloudDecisionsDto;
}
