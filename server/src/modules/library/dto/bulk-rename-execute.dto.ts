import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { BulkRenameExecuteRequest } from '@bookorbit/types';

@ValidatorConstraint({ name: 'singleBulkRenameSelection', async: false })
class SingleSelectionConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const obj = args.object as BulkRenameExecuteDto;
    return !(obj.excludeBookIds !== undefined && obj.includeBookIds !== undefined);
  }

  defaultMessage(): string {
    return 'Only one of excludeBookIds or includeBookIds may be provided';
  }
}

function SingleSelection(options?: ValidationOptions) {
  return function (constructor: new (...args: unknown[]) => unknown) {
    registerDecorator({
      name: 'singleBulkRenameSelection',
      target: constructor,
      propertyName: '',
      options,
      constraints: [],
      validator: SingleSelectionConstraint,
    });
  };
}

/**
 * A run is narrowed from whichever side is small. The reviewer who skips a handful sends
 * `excludeBookIds`; the reviewer who starts from an empty selection sends `includeBookIds`.
 * The candidate list can run to tens of thousands and the client only holds loaded pages, so
 * it never has to state the full set. Sending neither renames every candidate.
 */
@SingleSelection()
export class BulkRenameExecuteDto implements BulkRenameExecuteRequest {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50_000)
  @IsInt({ each: true })
  excludeBookIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50_000)
  @IsInt({ each: true })
  includeBookIds?: number[];
}
