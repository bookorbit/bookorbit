import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
  type ValidationArguments,
  registerDecorator,
  type ValidationOptions,
  type ValidatorConstraintInterface,
  ValidatorConstraint,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { BookBucketMetadata } from '@projectx/types';

@ValidatorConstraint({ name: 'hasCompleteDefaultDestination', async: false })
class HasCompleteDefaultDestinationConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args?: ValidationArguments): boolean {
    const dto = args?.object as FinalizeBookBucketDto | undefined;
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

export class UpdateBookBucketFileDto {
  @IsOptional()
  @IsObject()
  selectedMetadata?: Partial<BookBucketMetadata>;

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
}

@HasCompleteDefaultDestination()
export class FinalizeBookBucketDto {
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

export class BookBucketMetadataFieldsDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() publisher?: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsString() isbn10?: string;
  @IsOptional() @IsString() isbn13?: string;
  @IsOptional() @IsString() seriesName?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsNumber() publishedYear?: number;
  @IsOptional() @IsNumber() pageCount?: number;
  @IsOptional() @IsNumber() seriesIndex?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) authors?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) genres?: string[];
}

export class BulkEditBookBucketDto {
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
  @Type(() => BookBucketMetadataFieldsDto)
  fields: BookBucketMetadataFieldsDto;

  @IsArray()
  @IsString({ each: true })
  enabledFields: string[];

  @IsBoolean()
  mergeArrays: boolean;
}
