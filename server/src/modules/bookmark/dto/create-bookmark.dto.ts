import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

@ValidatorConstraint({ name: 'bookmarkLocation', async: false })
class BookmarkLocationConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CreateBookmarkDto;
    return typeof dto.cfi === 'string' || typeof dto.positionSeconds === 'number';
  }

  defaultMessage(): string {
    return 'Either cfi or positionSeconds must be provided';
  }
}

function HasBookmarkLocation(options?: ValidationOptions) {
  return function (constructor: new (...args: unknown[]) => unknown) {
    registerDecorator({
      name: 'bookmarkLocation',
      target: constructor,
      propertyName: '',
      options,
      constraints: [],
      validator: BookmarkLocationConstraint,
    });
  };
}

@HasBookmarkLocation()
export class CreateBookmarkDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  cfi?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  positionSeconds?: number;
}
