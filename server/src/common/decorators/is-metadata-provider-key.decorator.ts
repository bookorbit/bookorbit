import { buildMessage, ValidateBy, type ValidationOptions } from 'class-validator';
import { isMetadataProviderKeySyntax } from '@bookorbit/types';

/**
 * A built-in provider key, or one an external provider could have. Syntax only: whether the
 * provider is registered is a runtime question the service answers, and an older client re-sending
 * a provider that has since been removed must not get a 400 for the whole request.
 */
export function IsMetadataProviderKey(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isMetadataProviderKey',
      validator: {
        validate: (value: unknown) => isMetadataProviderKeySyntax(value),
        defaultMessage: buildMessage((eachPrefix) => `${eachPrefix}$property must be a metadata provider key`, options),
      },
    },
    options,
  );
}
