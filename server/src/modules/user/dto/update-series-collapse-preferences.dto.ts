import { IsBoolean, IsOptional, registerDecorator, ValidationOptions } from 'class-validator';

function IsBooleanOrNullRecord(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isBooleanOrNullRecord',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'boolean' || v === null);
        },
        defaultMessage() {
          return `${propertyName} must be a record with string keys and boolean or null values`;
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
  @IsBooleanOrNullRecord()
  libraries?: Record<string, boolean | null>;

  @IsOptional()
  @IsBooleanOrNullRecord()
  collections?: Record<string, boolean | null>;
}
