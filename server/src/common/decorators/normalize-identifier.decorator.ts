import { Transform } from 'class-transformer';
import { identifierInputKindForField, normalizeIdentifierInput } from '@bookorbit/types';

/**
 * Cleans a hand-entered identifier before validation, using the rule the client applies as the
 * user types, so `978-3426226223` is stored as `9783426226223` instead of failing `@MaxLength(13)`.
 * The rule comes from the property name; non-strings pass through so `@IsString()` still rejects them.
 */
export function NormalizeIdentifier(): PropertyDecorator {
  return (target, propertyKey) => {
    const kind = identifierInputKindForField(String(propertyKey));
    if (!kind) throw new Error(`@NormalizeIdentifier() has no identifier rule for "${String(propertyKey)}"`);
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeIdentifierInput(kind, value) : value))(target, propertyKey);
  };
}
