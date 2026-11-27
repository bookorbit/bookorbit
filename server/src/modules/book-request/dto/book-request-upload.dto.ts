import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BOOK_REQUEST_UPLOAD_MAX_FILES, BOOK_REQUEST_UPLOAD_MAX_PATH_LENGTH } from '@bookorbit/types';

/**
 * A picked file by name and size. Two thousand of these is a large body, so the routes taking it
 * raise the body limit to match; see `UPLOAD_PLAN_BODY_LIMIT_BYTES`.
 */
export class BookRequestUploadFileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(BOOK_REQUEST_UPLOAD_MAX_PATH_LENGTH)
  path!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeBytes!: number;
}

export class PlanBookRequestUploadDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BOOK_REQUEST_UPLOAD_MAX_FILES)
  @ValidateNested({ each: true })
  @Type(() => BookRequestUploadFileDto)
  files!: BookRequestUploadFileDto[];
}

export class StartBookRequestUploadDto extends PlanBookRequestUploadDto {
  @IsOptional()
  @IsBoolean()
  holdForReview?: boolean;
}

/** Every path at its longest, with room for the JSON around it. */
export const UPLOAD_PLAN_BODY_LIMIT_BYTES = BOOK_REQUEST_UPLOAD_MAX_FILES * (BOOK_REQUEST_UPLOAD_MAX_PATH_LENGTH + 64) + 1_024;
