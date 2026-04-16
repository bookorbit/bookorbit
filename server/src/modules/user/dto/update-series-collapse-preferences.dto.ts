import { IsBoolean, IsOptional, registerDecorator, ValidationOptions } from 'class-validator';

function IsBooleanRecord(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isBooleanRecord',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'boolean');
        },
        defaultMessage() {
          return `${propertyName} must be a record with string keys and boolean values`;
        },
      },
    });
  };
}

export class UpdateSeriesCollapsePreferencesDto {
  @IsOptional()
  @IsBoolean()
  global?: boolean;

  @IsOptional()
  @IsBooleanRecord()
  libraries?: Record<string, boolean>;

  @IsOptional()
  @IsBooleanRecord()
  collections?: Record<string, boolean>;
}
