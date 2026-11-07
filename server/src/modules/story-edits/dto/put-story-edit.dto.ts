import {
  IsBoolean,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';

import { STORY_EDIT_DATA_MAX_BYTES, STORY_EDIT_KIND_MAX_LENGTH, type PutStoryEditRequest } from '@bookorbit/types';

export const STORY_EDIT_KIND_PATTERN = /^[a-z][a-zA-Z0-9_-]*$/;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Why `data` cannot be stored, or null when it can. Its keys and values are free-form. */
export function storyEditDataProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return 'data must be a JSON object';
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > STORY_EDIT_DATA_MAX_BYTES)
    return `data must serialise to at most ${STORY_EDIT_DATA_MAX_BYTES} bytes`;
  // Postgres jsonb refuses both, which would otherwise surface as a 500 on the write.
  if (!jsonbStorable(value)) return 'data must not contain NUL characters or unpaired surrogates';
  return null;
}

@ValidatorConstraint({ name: 'storyEditData', async: false })
class StoryEditDataConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return storyEditDataProblem(value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return storyEditDataProblem(args.value) ?? 'data is invalid';
  }
}

export class PutStoryEditDto implements PutStoryEditRequest {
  @IsString()
  @MaxLength(STORY_EDIT_KIND_MAX_LENGTH)
  @Matches(STORY_EDIT_KIND_PATTERN)
  kind!: string;

  // Deliberately not @ValidateNested: the object is opaque, so whitelisting never reaches its keys.
  @Validate(StoryEditDataConstraint)
  data!: Record<string, unknown>;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  position?: number | null;

  @IsISO8601({ strict: true })
  updatedAt!: string;

  @IsOptional()
  @IsBoolean()
  deleted?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function jsonbStorable(value: unknown): boolean {
  if (typeof value === 'string') return storableString(value);
  if (Array.isArray(value)) return value.every(jsonbStorable);
  if (value !== null && typeof value === 'object') return Object.entries(value).every(([key, entry]) => storableString(key) && jsonbStorable(entry));
  return true;
}

function storableString(value: string): boolean {
  return !value.includes('\u0000') && !LONE_SURROGATE.test(value);
}
