import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  READING_HELP_KINDS,
  READING_HELP_MAX_PASSAGE_LENGTH,
  READING_HELP_MAX_PASSAGES,
  READING_HELP_MAX_TERM_LENGTH,
  READING_HELP_MAX_TOTAL_LENGTH,
  READING_HELP_SCOPES,
  type ReadingHelpKind,
  type ReadingHelpRequest,
  type ReadingHelpScope,
} from '@bookorbit/types';

/** Room for the passages at four UTF-8 bytes a character in the worst case, and the other fields. */
export const READING_HELP_BODY_LIMIT_BYTES = READING_HELP_MAX_TOTAL_LENGTH * 4 + 64 * 1024;

export class ReadingHelpDto implements ReadingHelpRequest {
  @IsIn(READING_HELP_KINDS)
  kind!: ReadingHelpKind;

  @IsInt()
  @Min(1)
  fileId!: number;

  @IsString()
  @MaxLength(35)
  @Matches(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/)
  language!: string;

  @IsOptional()
  @IsBoolean()
  careful?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(READING_HELP_MAX_TERM_LENGTH)
  term?: string;

  @IsOptional()
  @IsIn(READING_HELP_SCOPES)
  scope?: ReadingHelpScope;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(READING_HELP_MAX_PASSAGES)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(READING_HELP_MAX_PASSAGE_LENGTH, { each: true })
  passages!: string[];
}
