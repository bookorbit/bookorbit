import { Transform, Type } from 'class-transformer';
import type { MediaType, SmartScopeFilter, SortField, SortSpec } from '@bookorbit/types';
import { ICON_VALUE_MAX_LENGTH, MEDIA_TYPES, isSortField } from '@bookorbit/types';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

const SORT_DIRECTIONS: ReadonlyArray<SortSpec['dir']> = ['asc', 'desc'];

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function IsSortField(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isSortField',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isSortField(value);
        },
        defaultMessage() {
          return `${propertyName} must be a built-in sort field or a custom metadata field reference`;
        },
      },
    });
  };
}

export class SortSpecDto {
  @IsSortField()
  field: SortField;

  @IsIn(SORT_DIRECTIONS)
  dir: SortSpec['dir'];
}

export class CreateSmartScopeDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(ICON_VALUE_MAX_LENGTH)
  icon: string;

  /** Defaults to books, so existing book-scope callers need no change. */
  @IsOptional()
  @IsIn(MEDIA_TYPES)
  mediaType?: MediaType;

  /** Required for podcast scopes, which evaluate episodes inside one library. */
  @IsOptional()
  @IsInt()
  @Min(1)
  libraryId?: number;

  /** A book rule tree or a podcast rule set; the service validates against mediaType. */
  @IsOptional()
  @IsObject()
  filter?: SmartScopeFilter;

  /** Book sort fields only. Podcast scopes carry their sort inside the rules. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SortSpecDto)
  defaultSort?: SortSpecDto[];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  syncToKobo?: boolean;
}
