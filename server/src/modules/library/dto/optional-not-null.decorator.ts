import { ValidateIf } from 'class-validator';

/**
 * The field may be left out, but not sent as null. `@IsOptional()` lets null through, and these
 * settings are NOT NULL columns, so a null used to pass validation and then fail as a 500.
 */
export function IsOptionalNotNull(): PropertyDecorator {
  return ValidateIf((_, value) => value !== undefined);
}
