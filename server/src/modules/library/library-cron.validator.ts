import { ValidateBy, type ValidationOptions } from 'class-validator';
import { CronTime } from 'cron';
import { isFiveFieldCronExpression } from '@bookorbit/types';

import { LIBRARY_AUTO_SCAN_CRON_EXPRESSION_ERROR } from './library.constants';

export function isValidLibraryAutoScanCronExpression(value: unknown): boolean {
  if (!isFiveFieldCronExpression(value)) return false;

  try {
    new CronTime(value);
    return true;
  } catch {
    return false;
  }
}

export function IsLibraryAutoScanCronExpression(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isLibraryAutoScanCronExpression',
      validator: {
        validate: isValidLibraryAutoScanCronExpression,
        defaultMessage: () => LIBRARY_AUTO_SCAN_CRON_EXPRESSION_ERROR,
      },
    },
    validationOptions,
  );
}
