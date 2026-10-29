import { buildMessage, ValidateBy, type ValidationOptions } from 'class-validator';
import { isExternalMetadataProviderKeySyntax, isKnownMetadataProviderKey } from '@bookorbit/types';

const MAX_ENTRIES = 50;

/**
 * A map from external provider key to a string of at most `maxLength` characters, or null to
 * clear it. Keys with a column of their own are refused: their ids have named fields, and one
 * value must not arrive two ways.
 */
export function IsExternalProviderMap(maxLength: number, options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isExternalProviderMap',
      constraints: [maxLength],
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          return (
            entries.length <= MAX_ENTRIES &&
            entries.every(
              ([key, entry]) =>
                isExternalMetadataProviderKeySyntax(key) &&
                !isKnownMetadataProviderKey(key) &&
                (entry === null || (typeof entry === 'string' && entry.length <= maxLength)),
            )
          );
        },
        defaultMessage: buildMessage(() => '$property must map external provider keys to strings or null', options),
      },
    },
    options,
  );
}
