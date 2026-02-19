import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
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
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.split(',') : (value as MetadataProviderKey[])))
  @IsEnum(MetadataProviderKey, { each: true })
  providers?: MetadataProviderKey[];
}
