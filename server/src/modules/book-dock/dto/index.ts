import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
  type ValidationArguments,
  registerDecorator,
  type ValidationOptions,
  type ValidatorConstraintInterface,
  ValidatorConstraint,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MetadataProviderKey } from '@bookorbit/types';

@ValidatorConstraint({ name: 'hasCompleteDefaultDestination', async: false })
class HasCompleteDefaultDestinationConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args?: ValidationArguments): boolean {
    const dto = args?.object as FinalizeBookDockDto | undefined;
    if (!dto) return false;
    return (dto.defaultLibraryId === undefined) === (dto.defaultFolderId === undefined);
  }

  defaultMessage(): string {
    return 'defaultLibraryId and defaultFolderId must either both be provided or both be omitted';
  }
}

function HasCompleteDefaultDestination(options?: ValidationOptions) {
  return function (constructor: new (...args: unknown[]) => unknown) {
    registerDecorator({
      name: 'hasCompleteDefaultDestination',
      target: constructor,
      propertyName: '',
      options,
      constraints: [],
      validator: HasCompleteDefaultDestinationConstraint,
    });
  };
}

class BookDockAudiobookChapterDto {
  @IsString() title!: string;
  @IsInt() @Min(0) startMs!: number;
  @IsOptional() @IsInt() @Min(0) durationMs?: number | null;
}

class BookDockSeriesMembershipDto {
  @IsString() @MaxLength(500) seriesName!: string;
  @IsOptional() @IsNumber() seriesIndex?: number | null;
}

class BookDockCommunityRatingDto {
  @IsIn(Object.values(MetadataProviderKey)) provider!: MetadataProviderKey;
  @IsNumber() @Min(0) @Max(5) rating!: number;
  @IsOptional() @IsInt() @Min(0) ratingCount?: number | null;
}

class BookDockComicMetadataDto {
  @IsOptional() @IsString() @MaxLength(50) issueNumber?: string;
  @IsOptional() @IsString() @MaxLength(500) volumeName?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) pencillers?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) inkers?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) colorists?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) letterers?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) coverArtists?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) characters?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) teams?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) locations?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) storyArcs?: string[];
}

export class BookDockMetadataFieldsDto {
  @IsOptional() @IsString() @MaxLength(1000) title?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) subtitle?: string | null;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() @MaxLength(500) publisher?: string | null;
  @IsOptional() @IsString() @MaxLength(100) language?: string | null;
  @IsOptional() @IsString() @MaxLength(10) isbn10?: string | null;
  @IsOptional() @IsString() @MaxLength(13) isbn13?: string | null;
  @IsOptional() @IsString() @MaxLength(500) seriesName?: string | null;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) publishedDate?: string | null;
  @IsOptional() @IsInt() @Min(1000) @Max(2200) publishedYear?: number | null;
  @IsOptional() @IsInt() @Min(0) pageCount?: number | null;
  @IsOptional() @IsNumber() seriesIndex?: number | null;
  @IsOptional() @IsArray() @IsString({ each: true }) authors?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) genres?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) narrators?: string[];
  @IsOptional() @IsInt() @Min(0) durationSeconds?: number | null;
  @IsOptional() @IsBoolean() abridged?: boolean | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BookDockAudiobookChapterDto) chapters?: BookDockAudiobookChapterDto[] | null;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookDockSeriesMembershipDto)
  seriesMemberships?: BookDockSeriesMembershipDto[] | null;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookDockCommunityRatingDto)
  communityRatings?: BookDockCommunityRatingDto[] | null;
  @IsOptional() @IsString() @MaxLength(50) googleBooksId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) goodreadsId?: string | null;
  @IsOptional() @IsString() @MaxLength(20) amazonId?: string | null;
  @IsOptional() @IsString() @MaxLength(255) hardcoverId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) hardcoverEditionId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) openLibraryId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) itunesId?: string | null;
  @IsOptional() @IsString() @MaxLength(20) audibleId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) librofmId?: string | null;
  @IsOptional() @IsString() @MaxLength(255) koboId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) comicvineId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) ranobedbId?: string | null;
  @IsOptional() @IsString() @MaxLength(512) lubimyczytacId?: string | null;
  @IsOptional() @IsString() @MaxLength(20) aladinId?: string | null;
  @IsOptional() @ValidateNested() @Type(() => BookDockComicMetadataDto) comicMetadata?: BookDockComicMetadataDto | null;
}

export class UpdateBookDockFileDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BookDockMetadataFieldsDto)
  selectedMetadata?: BookDockMetadataFieldsDto;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  targetLibraryId?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  targetFolderId?: number | null;
}

class FinalizeOverrideDto {
  @IsInt()
  fileId: number;

  @IsOptional()
  @IsInt()
  libraryId?: number;

  @IsOptional()
  @IsInt()
  folderId?: number;

  @IsOptional()
  @IsBoolean()
  skipDuplicateCheck?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  targetFileName?: string;
}

@HasCompleteDefaultDestination()
export class FinalizeBookDockDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fileIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludedIds?: number[];

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  defaultLibraryId?: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  defaultFolderId?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FinalizeOverrideDto)
  overrides?: FinalizeOverrideDto[];
}

export class BulkDiscardDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fileIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludedIds?: number[];

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class PreviewNamesDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fileIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludedIds?: number[];

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  defaultLibraryId?: number;
}

export class BulkRetryFetchDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fileIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludedIds?: number[];

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class BulkApplyFetchedDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fileIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludedIds?: number[];

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class BulkSetTargetDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fileIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludedIds?: number[];

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  targetLibraryId?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  targetFolderId?: number | null;
}

export class SelectionSummaryDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fileIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludedIds?: number[];

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class BulkEditBookDockDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fileIds?: number[];

  @IsOptional()
  @IsBoolean()
  selectAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludedIds?: number[];

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @ValidateNested()
  @IsObject()
  @Type(() => BookDockMetadataFieldsDto)
  fields: BookDockMetadataFieldsDto;

  @IsArray()
  @IsString({ each: true })
  enabledFields: string[];

  @IsBoolean()
  mergeArrays: boolean;
}
