import { IsString, MaxLength, registerDecorator, ValidationOptions } from 'class-validator';
import { validatePattern } from '@projectx/types';

function IsValidPattern(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidPattern',
      target: object.constructor,
      propertyName,
      options: { message: 'Pattern contains invalid characters', ...options },
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          return validatePattern(value);
        },
      },
    });
  };
}

export class UpdateUploadPatternDto {
  @IsString()
  @MaxLength(500)
  @IsValidPattern()
  pattern: string;
}
