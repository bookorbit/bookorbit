import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

import { BOOK_MERGE_MAX_BOOKS, type BookMergeField } from '@bookorbit/types';

/** One optional book id per pickable field (`BOOK_MERGE_FIELDS`). */
export class BookMergeFieldOverridesDto implements Partial<Record<BookMergeField, number>> {
  @IsOptional()
  @IsInt()
  @Min(1)
  title?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  subtitle?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  authors?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  description?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  publisher?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  publishedYear?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  language?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  pageCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  series?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  isbn?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  narrators?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  googleBooksId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  goodreadsId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  amazonId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  hardcoverId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  openLibraryId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  itunesId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  audibleId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  librofmId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  koboId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  comicvineId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  ranobedbId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  lubimyczytacId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  aladinId?: number;
}

export class BookMergePreviewDto {
  @IsInt()
  @Min(1)
  targetBookId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BOOK_MERGE_MAX_BOOKS - 1)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  sourceBookIds!: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  destinationBookId?: number;
}

export class BookMergeDto extends BookMergePreviewDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BookMergeFieldOverridesDto)
  fieldOverrides?: BookMergeFieldOverridesDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  includeTagIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  includeGenreIds?: number[];

  @IsOptional()
  @IsBoolean()
  deleteIdenticalCopies?: boolean;

  /** Confirms other readers may lose access to the book (`LIBRARY_ACCESS_NARROWS`). */
  @IsOptional()
  @IsBoolean()
  acknowledgeAccessLoss?: boolean;

  @IsString()
  @Length(1, 128)
  previewToken!: string;
}
