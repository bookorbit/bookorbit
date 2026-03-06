import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  Min,
  IsOptional,
  IsString,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { MetadataProviderKey } from '@projectx/types';

@ValidatorConstraint({ name: 'atLeastOneSearchTerm', async: false })
class AtLeastOneSearchTermConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const obj = args.object as MetadataSearchDto;
    return !!(obj.bookId || obj.title?.trim() || obj.isbn?.trim());
  }

  defaultMessage(): string {
    return 'At least one of bookId, title, or isbn must be provided';
  }
}

function AtLeastOneSearchTerm(options?: ValidationOptions) {
  return function (constructor: new (...args: unknown[]) => unknown) {
    registerDecorator({
      name: 'atLeastOneSearchTerm',
      target: constructor,
      propertyName: '',
      options,
      constraints: [],
      validator: AtLeastOneSearchTermConstraint,
    });
  };
}

@AtLeastOneSearchTerm()
export class MetadataSearchDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  bookId?: number;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  isbn?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (Array.isArray(value)) {
      return value
        .flatMap((item) => (typeof item === 'string' ? item.split(',') : [item]))
        .map((item) => (typeof item === 'string' ? item.trim() : item))
        .filter((item): item is MetadataProviderKey => typeof item === 'string' && item.length > 0);
    }

    return value as MetadataProviderKey[];
  })
  @IsEnum(MetadataProviderKey, { each: true })
  providers?: MetadataProviderKey[];
}
